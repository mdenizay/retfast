//! Opak oturum belirteçleri: istemciye 256 bit rastgele belirteç verilir, veritabanında yalnızca
//! SHA-256 özeti durur. Web httpOnly cookie, mobil `Authorization: Bearer` kullanır. Kısa ömürlü
//! JWT + yenileme akışı yok: arka planda konum yükleyen yerel kodun belirteç yenilemesi gerekmez.
use argon2::{
    Argon2,
    password_hash::{PasswordHasher, PasswordVerifier, phc::PasswordHash},
};
use axum::{
    extract::FromRequestParts,
    http::{header, request::Parts},
};
use axum_extra::extract::cookie::{Cookie, SameSite};
use redis::AsyncCommands;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    state::AppState,
};

pub const COOKIE: &str = "rf_session";
pub const SESSION_DAYS: i64 = 90;
const CACHE_SECS: u64 = 60;

#[derive(Clone, Copy, Debug)]
pub struct AuthUser {
    pub id: Uuid,
    pub session_id: Uuid,
    pub is_system_admin: bool,
}

/// Argon2id hesabı başına ~19 MB bellek ister. Eşzamanlı hesap sayısı sınırlanmazsa giriş
/// yağmuru sunucunun belleğini tüketir; fazlası sırada bekler.
static HASHING: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(4);

pub async fn hash_password(password: String) -> AppResult<String> {
    let _permit = HASHING.acquire().await.map_err(|e| AppError::Other(e.into()))?;
    tokio::task::spawn_blocking(move || {
        Argon2::default()
            .hash_password(password.as_bytes())
            .map(|h| h.to_string())
            .map_err(|e| AppError::Other(anyhow::anyhow!("password hash: {e}")))
    })
    .await
    .map_err(|e| AppError::Other(e.into()))?
}

pub async fn verify_password(password: String, hash: String) -> bool {
    let Ok(_permit) = HASHING.acquire().await else { return false };
    tokio::task::spawn_blocking(move || {
        PasswordHash::new(&hash).map(|parsed| Argon2::default().verify_password(password.as_bytes(), &parsed).is_ok()).unwrap_or(false)
    })
    .await
    .unwrap_or(false)
}

pub fn new_token() -> String {
    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}

pub fn token_hash(token: &str) -> Vec<u8> {
    Sha256::digest(token.as_bytes()).to_vec()
}

fn cache_key(hash: &[u8]) -> String {
    let hex: String = hash.iter().map(|b| format!("{b:02x}")).collect();
    format!("sess:{hex}")
}

pub fn session_cookie(token: String, secure: bool) -> Cookie<'static> {
    Cookie::build((COOKIE, token))
        .path("/")
        .http_only(true)
        .secure(secure)
        .same_site(SameSite::Lax)
        .max_age(time::Duration::days(SESSION_DAYS))
        .build()
}

pub async fn forget_cached(state: &AppState, token: &str) {
    forget_cached_hash(state, &token_hash(token)).await;
}

pub async fn forget_cached_hash(state: &AppState, hash: &[u8]) {
    let mut redis = state.redis.clone();
    let _: Result<(), _> = redis.del(cache_key(hash)).await;
}

pub fn token_from_parts(parts: &Parts) -> Option<String> {
    if let Some(v) = parts.headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok()) {
        return v.strip_prefix("Bearer ").map(|t| t.trim().to_string());
    }
    let cookies = parts.headers.get(header::COOKIE)?.to_str().ok()?;
    cookies.split(';').find_map(|c| c.trim().strip_prefix("rf_session=").map(str::to_string))
}

pub async fn authenticate(state: &AppState, token: &str) -> AppResult<AuthUser> {
    if token.len() != 64 {
        return Err(AppError::Unauthorized);
    }
    let hash = token_hash(token);
    let key = cache_key(&hash);
    let mut redis = state.redis.clone();
    if let Ok(Some(cached)) = redis.get::<_, Option<String>>(&key).await {
        let mut it = cached.split('|');
        if let (Some(Ok(id)), Some(Ok(session_id)), Some(admin)) =
            (it.next().map(Uuid::parse_str), it.next().map(Uuid::parse_str), it.next())
        {
            return Ok(AuthUser { id, session_id, is_system_admin: admin == "1" });
        }
    }
    // Önbellek ıskasında oturumu kaydırarak uzat; böylece en fazla dakikada bir yazma olur.
    let row: Option<(Uuid, Uuid, bool)> = sqlx::query_as(
        "update sessions s set last_used_at = now(), expires_at = now() + make_interval(days => $2)
         from users u
         where s.token_hash = $1 and s.revoked_at is null and s.expires_at > now()
           and u.id = s.user_id and u.deleted_at is null
         returning u.id, s.id, u.is_system_admin",
    )
    .bind(&hash)
    .bind(SESSION_DAYS as i32)
    .fetch_optional(&state.db)
    .await?;
    let (id, session_id, is_system_admin) = row.ok_or(AppError::Unauthorized)?;
    let _: Result<(), _> = redis.set_ex(&key, format!("{id}|{session_id}|{}", is_system_admin as u8), CACHE_SECS).await;
    Ok(AuthUser { id, session_id, is_system_admin })
}

impl FromRequestParts<AppState> for AuthUser {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let token = token_from_parts(parts).ok_or(AppError::Unauthorized)?;
        authenticate(state, &token).await
    }
}

/// Girişsiz de çalışan uçlar için.
pub struct MaybeUser(pub Option<AuthUser>);

impl FromRequestParts<AppState> for MaybeUser {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        Ok(Self(match token_from_parts(parts) {
            Some(token) => authenticate(state, &token).await.ok(),
            None => None,
        }))
    }
}

/// Redis sabit pencere hız sınırı. Redis erişilemezse isteği engellemez.
pub async fn rate_limit(state: &AppState, bucket: &str, limit: u32, window_secs: i64) -> AppResult<()> {
    if !state.config.rate_limits {
        return Ok(());
    }
    let mut redis = state.redis.clone();
    let key = format!("rl:{bucket}");
    let count: u32 = match redis.incr(&key, 1).await {
        Ok(c) => c,
        Err(_) => return Ok(()),
    };
    if count == 1 {
        let _: Result<(), _> = redis.expire(&key, window_secs).await;
    }
    if count > limit { Err(AppError::RateLimited) } else { Ok(()) }
}

use axum::{
    Json, Router,
    extract::{ConnectInfo, State},
    http::{HeaderMap, request::Parts},
    routing::{get, post},
};
use axum_extra::extract::CookieJar;
use serde::Deserialize;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{
    auth::{self, AuthUser},
    error::{AppError, AppResult, invalid},
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/auth/register", post(register))
        .route("/auth/login", post(login))
        .route("/auth/logout", post(logout))
        .route("/me", get(me).patch(update_me))
        .route("/me/consent/location", post(consent_location))
        .route("/me/events", get(my_events))
        .route("/me/notifications", get(notifications))
        .route("/me/notifications/read", post(read_notifications))
}

async fn user_json(state: &AppState, id: Uuid) -> AppResult<Value> {
    Ok(sqlx::query_scalar(
        "select jsonb_build_object(
            'id', u.id, 'email', u.email, 'first_name', u.first_name, 'last_name', u.last_name,
            'phone', u.phone, 'country', u.country, 'locale', u.locale, 'avatar_url', u.avatar_url,
            'emergency_contact_name', u.emergency_contact_name,
            'emergency_contact_phone', u.emergency_contact_phone,
            'is_system_admin', u.is_system_admin, 'location_consent_at', u.location_consent_at)
         from users u where u.id = $1 and u.deleted_at is null",
    )
    .bind(id)
    .fetch_one(&state.db)
    .await?)
}

fn client_ip(headers: &HeaderMap, peer: Option<std::net::SocketAddr>) -> String {
    headers
        .get("cf-connecting-ip")
        .or_else(|| headers.get("x-forwarded-for"))
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(',').next())
        .map(|v| v.trim().to_string())
        .or_else(|| peer.map(|p| p.ip().to_string()))
        .unwrap_or_else(|| "unknown".into())
}

#[derive(Deserialize)]
struct Device {
    #[serde(default)]
    platform: Option<String>,
    #[serde(default)]
    device_name: Option<String>,
}

async fn open_session(state: &AppState, jar: CookieJar, user_id: Uuid, device: Device) -> AppResult<(CookieJar, Json<Value>)> {
    let token = auth::new_token();
    let platform = match device.platform.as_deref() {
        Some("ios") => "ios",
        Some("android") => "android",
        _ => "web",
    };
    sqlx::query(
        "insert into sessions (id, user_id, token_hash, platform, device_name, expires_at)
         values ($1, $2, $3, $4, $5, now() + make_interval(days => $6))",
    )
    .bind(Uuid::now_v7())
    .bind(user_id)
    .bind(auth::token_hash(&token))
    .bind(platform)
    .bind(device.device_name.map(|d| d.chars().take(80).collect::<String>()))
    .bind(auth::SESSION_DAYS as i32)
    .execute(&state.db)
    .await?;
    let user = user_json(state, user_id).await?;
    let jar = jar.add(auth::session_cookie(token.clone(), state.config.cookie_secure));
    Ok((jar, Json(json!({ "user": user, "token": token }))))
}

#[derive(Deserialize)]
struct Register {
    email: String,
    password: String,
    first_name: String,
    last_name: String,
    #[serde(default)]
    locale: Option<String>,
    #[serde(flatten)]
    device: Device,
}

async fn register(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<std::net::SocketAddr>,
    headers: HeaderMap,
    jar: CookieJar,
    Json(body): Json<Register>,
) -> AppResult<(CookieJar, Json<Value>)> {
    auth::rate_limit(&state, &format!("register:{}", client_ip(&headers, Some(peer))), 10, 3600).await?;
    let email = body.email.trim().to_lowercase();
    let (first, last) = (body.first_name.trim(), body.last_name.trim());
    if !email.contains('@') || email.len() > 254 || email.contains(char::is_whitespace) {
        return Err(invalid("email is invalid"));
    }
    if body.password.chars().count() < 8 || body.password.len() > 200 {
        return Err(invalid("password must be at least 8 characters"));
    }
    if first.is_empty() || last.is_empty() || first.len() > 80 || last.len() > 80 {
        return Err(invalid("first_name and last_name are required"));
    }
    let locale = if body.locale.as_deref() == Some("tr") { "tr" } else { "en" };
    let hash = auth::hash_password(body.password).await?;
    let id = Uuid::now_v7();
    let inserted = sqlx::query(
        "insert into users (id, email, password_hash, first_name, last_name, locale)
         values ($1, $2, $3, $4, $5, $6) on conflict (email) do nothing",
    )
    .bind(id)
    .bind(&email)
    .bind(hash)
    .bind(first)
    .bind(last)
    .bind(locale)
    .execute(&state.db)
    .await?;
    if inserted.rows_affected() == 0 {
        return Err(AppError::Conflict("EMAIL_TAKEN", "an account with this email already exists"));
    }
    open_session(&state, jar, id, body.device).await
}

#[derive(Deserialize)]
struct Login {
    email: String,
    password: String,
    #[serde(flatten)]
    device: Device,
}

async fn login(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<std::net::SocketAddr>,
    headers: HeaderMap,
    jar: CookieJar,
    Json(body): Json<Login>,
) -> AppResult<(CookieJar, Json<Value>)> {
    let email = body.email.trim().to_lowercase();
    auth::rate_limit(&state, &format!("login:ip:{}", client_ip(&headers, Some(peer))), 30, 600).await?;
    auth::rate_limit(&state, &format!("login:email:{email}"), 10, 600).await?;
    let row: Option<(Uuid, Option<String>)> = sqlx::query_as("select id, password_hash from users where email = $1 and deleted_at is null")
        .bind(&email)
        .fetch_optional(&state.db)
        .await?;
    let denied = || AppError::Conflict("INVALID_CREDENTIALS", "email or password is incorrect");
    match row {
        Some((id, Some(hash))) => {
            if !auth::verify_password(body.password, hash).await {
                return Err(denied());
            }
            open_session(&state, jar, id, body.device).await
        }
        _ => {
            // Hesap yoksa da aynı işi yap; e-posta varlığı yanıt süresinden anlaşılmasın.
            let _ = auth::hash_password(body.password).await;
            Err(denied())
        }
    }
}

async fn logout(State(state): State<AppState>, user: AuthUser, parts: Parts, jar: CookieJar) -> AppResult<(CookieJar, Json<Value>)> {
    sqlx::query("update sessions set revoked_at = now() where id = $1").bind(user.session_id).execute(&state.db).await?;
    if let Some(token) = auth::token_from_parts(&parts) {
        auth::forget_cached(&state, &token).await;
    }
    Ok((jar.remove(auth::COOKIE), Json(json!({ "ok": true }))))
}

async fn me(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    Ok(Json(user_json(&state, user.id).await?))
}

#[derive(Deserialize)]
struct UpdateMe {
    first_name: Option<String>,
    last_name: Option<String>,
    phone: Option<String>,
    country: Option<String>,
    locale: Option<String>,
    emergency_contact_name: Option<String>,
    emergency_contact_phone: Option<String>,
}

async fn update_me(State(state): State<AppState>, user: AuthUser, Json(b): Json<UpdateMe>) -> AppResult<Json<Value>> {
    if b.locale.as_deref().is_some_and(|l| l != "en" && l != "tr") {
        return Err(invalid("locale must be en or tr"));
    }
    if b.first_name.as_deref().is_some_and(|v| v.trim().is_empty()) || b.last_name.as_deref().is_some_and(|v| v.trim().is_empty()) {
        return Err(invalid("name cannot be empty"));
    }
    // Boş metin alanı temizler; gönderilmeyen alan değişmez.
    sqlx::query(
        "update users set
            first_name = coalesce($2, first_name), last_name = coalesce($3, last_name),
            phone = case when $4::text is null then phone else nullif($4, '') end,
            country = case when $5::text is null then country else nullif($5, '') end,
            locale = coalesce($6, locale),
            emergency_contact_name = case when $7::text is null then emergency_contact_name else nullif($7, '') end,
            emergency_contact_phone = case when $8::text is null then emergency_contact_phone else nullif($8, '') end,
            updated_at = now()
         where id = $1",
    )
    .bind(user.id)
    .bind(b.first_name.map(|v| v.trim().to_string()))
    .bind(b.last_name.map(|v| v.trim().to_string()))
    .bind(b.phone)
    .bind(b.country)
    .bind(b.locale)
    .bind(b.emergency_contact_name)
    .bind(b.emergency_contact_phone)
    .execute(&state.db)
    .await?;
    Ok(Json(user_json(&state, user.id).await?))
}

async fn consent_location(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    sqlx::query("update users set location_consent_at = coalesce(location_consent_at, now()) where id = $1")
        .bind(user.id)
        .execute(&state.db)
        .await?;
    Ok(Json(user_json(&state, user.id).await?))
}

async fn my_events(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    let v: Value = sqlx::query_scalar(
        "select jsonb_build_object(
            'memberships', coalesce((
                select jsonb_agg(jsonb_build_object(
                    'role', m.role, 'bib', m.bib,
                    'event', jsonb_build_object('id', e.id, 'slug', e.slug, 'name', e.name, 'status', e.status,
                        'starts_at', e.starts_at, 'ends_at', e.ends_at, 'city', e.city, 'country', e.country,
                        'image_url', e.image_url)) order by e.starts_at desc)
                from event_members m join events e on e.id = m.event_id
                where m.user_id = $1 and m.status = 'active' and e.status <> 'archived'), '[]'::jsonb),
            'applications', coalesce((
                select jsonb_agg(jsonb_build_object(
                    'id', a.id, 'status', a.status, 'requested_role', a.requested_role, 'created_at', a.created_at,
                    'event', jsonb_build_object('id', e.id, 'slug', e.slug, 'name', e.name, 'starts_at', e.starts_at))
                    order by a.created_at desc)
                from applications a join events e on e.id = a.event_id
                where a.user_id = $1 and a.status in ('pending', 'rejected')), '[]'::jsonb))",
    )
    .bind(user.id)
    .fetch_one(&state.db)
    .await?;
    Ok(Json(v))
}

async fn notifications(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    let v: Value = sqlx::query_scalar(
        "select coalesce(jsonb_agg(to_jsonb(n) - 'user_id'::text order by n.created_at desc), '[]'::jsonb)
         from (select * from notifications where user_id = $1 order by created_at desc limit 100) n",
    )
    .bind(user.id)
    .fetch_one(&state.db)
    .await?;
    Ok(Json(json!({ "data": v })))
}

async fn read_notifications(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    sqlx::query("update notifications set read_at = now() where user_id = $1 and read_at is null").bind(user.id).execute(&state.db).await?;
    Ok(Json(json!({ "ok": true })))
}

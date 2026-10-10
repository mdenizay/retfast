use axum::{
    Json, Router,
    extract::{Path, Query, State},
    routing::{get, post},
};
use redis::AsyncCommands;
use serde::Deserialize;
use serde_json::{Value, json};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{
    auth::{self, AuthUser},
    authz::{Access, Role},
    error::{AppError, AppResult, invalid},
    extract::OptJson,
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/events/{id}/tracking/start", post(start))
        .route("/events/{id}/tracking/stop", post(stop))
        .route("/events/{id}/tracking/points", post(ingest))
        .route("/events/{id}/live", get(live))
        .route("/events/{id}/log", get(log))
        .route("/events/{id}/tracks/{user_id}", get(track))
}

pub const MAX_BATCH: usize = 500;

/// Cihazdaki uyarlanabilir takip parametreleri. Sunucudan gelir; uygulama güncellemesi olmadan
/// ayarlanabilir. `events.settings.tracking` aynı anahtarları ezebilir.
fn tracking_config(role: Role, settings: &Value) -> Value {
    let mut cfg = if role == Role::Retriever {
        json!({
            "moving":     { "interval_s": 10, "distance_m": 30, "accuracy": "ten_meters" },
            "slow":       { "interval_s": 20, "distance_m": 30, "accuracy": "ten_meters" },
            "stationary": { "interval_s": 120, "distance_m": 75, "accuracy": "hundred_meters" },
        })
    } else {
        json!({
            "moving":     { "interval_s": 5, "distance_m": 10, "accuracy": "best" },
            "slow":       { "interval_s": 15, "distance_m": 15, "accuracy": "ten_meters" },
            "stationary": { "interval_s": 60, "distance_m": 50, "accuracy": "hundred_meters" },
        })
    };
    let common = json!({
        "moving_speed_mps": 3.0, "stationary_speed_mps": 0.7, "stationary_after_s": 120,
        "low_battery_pct": 20, "low_battery_factor": 2.0,
        "upload_interval_s": 15, "upload_batch": 40, "max_batch": MAX_BATCH, "heartbeat_s": 120,
    });
    let obj = cfg.as_object_mut().unwrap();
    obj.extend(common.as_object().unwrap().clone());
    if let Some(overrides) = settings.get("tracking").and_then(Value::as_object) {
        obj.extend(overrides.clone());
    }
    cfg
}

#[derive(Deserialize, Default)]
struct StartBody {
    platform: Option<String>,
    app_version: Option<String>,
}

async fn start(
    State(state): State<AppState>,
    user: AuthUser,
    Path(event_id): Path<Uuid>,
    OptJson(b): OptJson<StartBody>,
) -> AppResult<Json<Value>> {
    let access = Access::load(&state.db, user, event_id).await?.member()?;
    let role = access.role.filter(|r| matches!(r, Role::Pilot | Role::Retriever)).ok_or(AppError::Forbidden)?;
    access.require_active_event()?;
    let consent: bool =
        sqlx::query_scalar("select location_consent_at is not null from users where id = $1").bind(user.id).fetch_one(&state.db).await?;
    if !consent {
        return Err(AppError::Conflict("LOCATION_CONSENT_REQUIRED", "location sharing consent is required"));
    }
    let mut tx = state.db.begin().await?;
    // Tek açık oturum: başka cihazdaki eski oturum kapanır.
    sqlx::query(
        "update tracking_sessions set ended_at = now(), end_reason = 'superseded'
         where event_id = $1 and user_id = $2 and ended_at is null",
    )
    .bind(event_id)
    .bind(user.id)
    .execute(&mut *tx)
    .await?;
    let id = Uuid::now_v7();
    sqlx::query("insert into tracking_sessions (id, event_id, user_id, platform, app_version) values ($1, $2, $3, $4, $5)")
        .bind(id)
        .bind(event_id)
        .bind(user.id)
        .bind(b.platform)
        .bind(b.app_version)
        .execute(&mut *tx)
        .await?;
    let settings: Value = sqlx::query_scalar("select settings from events where id = $1").bind(event_id).fetch_one(&mut *tx).await?;
    tx.commit().await?;
    state.hub.event(event_id, &json!({ "t": "tracking.started", "subject": user.id, "d": {} })).await;
    Ok(Json(json!({ "session_id": id, "config": tracking_config(role, &settings) })))
}

async fn stop(State(state): State<AppState>, user: AuthUser, Path(event_id): Path<Uuid>) -> AppResult<Json<Value>> {
    sqlx::query(
        "update tracking_sessions set ended_at = now(), end_reason = 'user'
         where event_id = $1 and user_id = $2 and ended_at is null",
    )
    .bind(event_id)
    .bind(user.id)
    .execute(&state.db)
    .await?;
    state.hub.event(event_id, &json!({ "t": "tracking.stopped", "subject": user.id, "d": {} })).await;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
struct Point {
    /// Fix zamanı, epoch milisaniye (cihaz GPS saati).
    t: i64,
    lat: f64,
    lon: f64,
    acc: Option<f32>,
    alt: Option<f32>,
    spd: Option<f32>,
    hdg: Option<f32>,
    bat: Option<i16>,
}

#[derive(Deserialize)]
struct Ingest {
    session_id: Uuid,
    points: Vec<Point>,
}

// Yalnızca daha yeni fix "güncel konum"un yerini alır; çevrimdışı birikmiş eski noktalar almaz.
const SET_LATEST: &str = r#"
local cur = redis.call('HGET', KEYS[1], ARGV[1])
if cur then
  local ok, v = pcall(cjson.decode, cur)
  if ok and v.t and v.t >= tonumber(ARGV[2]) then return 0 end
end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[3])
redis.call('EXPIRE', KEYS[1], 172800)
return 1
"#;

/// Toplu konum alımı. Noktalar yanıt dönmeden PostgreSQL'e yazılır; cihaz ancak 200 alınca
/// yerel kuyruğundan siler. Tekrar gönderim birincil anahtar sayesinde çoğalmaz.
async fn ingest(
    State(state): State<AppState>,
    user: AuthUser,
    Path(event_id): Path<Uuid>,
    Json(b): Json<Ingest>,
) -> AppResult<Json<Value>> {
    if b.points.len() > MAX_BATCH {
        return Err(invalid("too many points in one batch"));
    }
    auth::rate_limit(&state, &format!("ingest:{}", user.id), 120, 60).await?;
    // Oturum kapalıysa (etkinlik bitti, üyelik sonlandı, admin kapattı) cihaz takibi durdurmalı. Kullanıcının kendi
    // kapattığı veya başka cihazın devraldığı oturumun çevrimdışı kalmış kuyruğu 6 saat boyunca kabul edilir.
    let open: bool = sqlx::query_scalar(
        "select exists(select 1 from tracking_sessions s join events e on e.id = s.event_id
            where s.id = $1 and s.event_id = $2 and s.user_id = $3 and e.status = 'active'
              and exists(select 1 from event_members m where m.event_id = s.event_id and m.user_id = s.user_id
                         and m.status = 'active' and m.role in ('pilot', 'retriever'))
              and (s.ended_at is null
                   or (s.end_reason in ('user', 'superseded') and s.ended_at > now() - interval '6 hours')))",
    )
    .bind(b.session_id)
    .bind(event_id)
    .bind(user.id)
    .fetch_one(&state.db)
    .await?;
    if !open {
        return Err(AppError::Conflict("TRACKING_SESSION_CLOSED", "tracking session is closed"));
    }
    let now = OffsetDateTime::now_utc();
    let now_ms = (now.unix_timestamp_nanos() / 1_000_000) as i64;
    let n = b.points.len();
    let (mut ts, mut lat, mut lon) = (Vec::with_capacity(n), Vec::with_capacity(n), Vec::with_capacity(n));
    let (mut acc, mut alt, mut spd, mut hdg, mut bat) =
        (Vec::with_capacity(n), Vec::with_capacity(n), Vec::with_capacity(n), Vec::with_capacity(n), Vec::with_capacity(n));
    let mut latest: Option<&Point> = None;
    for p in &b.points {
        // Geçersiz veya saati bozuk noktayı at, partinin kalanını kabul et.
        let valid = (-90.0..=90.0).contains(&p.lat)
            && (-180.0..=180.0).contains(&p.lon)
            && p.t <= now_ms + 120_000
            && p.t > now_ms - 14 * 86_400_000;
        let Some(at) = valid.then(|| OffsetDateTime::from_unix_timestamp_nanos(p.t as i128 * 1_000_000).ok()).flatten() else { continue };
        ts.push(at);
        lat.push(p.lat);
        lon.push(p.lon);
        acc.push(p.acc.filter(|v| v.is_finite() && *v >= 0.0));
        alt.push(p.alt.filter(|v| v.is_finite()));
        spd.push(p.spd.filter(|v| v.is_finite() && *v >= 0.0));
        hdg.push(p.hdg.filter(|v| v.is_finite() && (0.0..=360.0).contains(v)));
        bat.push(p.bat.filter(|v| (0..=100).contains(v)));
        if latest.is_none_or(|l| p.t > l.t) {
            latest = Some(p);
        }
    }
    let valid = ts.len();
    let stored = sqlx::query(
        "insert into location_points
            (event_id, user_id, session_id, recorded_at, lat, lon, accuracy_m, altitude_m, speed_mps, heading_deg, battery_pct)
         select $1, $2, $3, * from unnest($4::timestamptz[], $5::float8[], $6::float8[], $7::real[], $8::real[],
            $9::real[], $10::real[], $11::smallint[])
         on conflict do nothing",
    )
    .bind(event_id)
    .bind(user.id)
    .bind(b.session_id)
    .bind(&ts)
    .bind(&lat)
    .bind(&lon)
    .bind(&acc)
    .bind(&alt)
    .bind(&spd)
    .bind(&hdg)
    .bind(&bat)
    .execute(&state.db)
    .await?
    .rows_affected();

    if let Some(p) = latest {
        let json = json!({ "u": user.id, "t": p.t, "rx": now_ms, "lat": p.lat, "lon": p.lon, "acc": p.acc,
                           "alt": p.alt, "spd": p.spd, "hdg": p.hdg, "bat": p.bat })
        .to_string();
        let mut redis = state.redis.clone();
        let newer: Result<i32, _> = redis::Script::new(SET_LATEST)
            .key(format!("live:{event_id}"))
            .arg(user.id.to_string())
            .arg(p.t)
            .arg(&json)
            .invoke_async(&mut redis)
            .await;
        match newer {
            Ok(1) => state.hub.pos(event_id, user.id, &json).await,
            Ok(_) => {}
            Err(e) => tracing::warn!(error = %e, "ingest: live position update failed"),
        }
    }
    Ok(Json(json!({ "accepted": valid, "stored": stored, "server_time": now_ms })))
}

/// Canlı ekranın tam durumu. İstemci WS'e bağlanınca ve her yeniden bağlanışta bunu çeker,
/// sonra `seq > last_seq` olayları üstüne uygular.
pub async fn live(State(state): State<AppState>, user: AuthUser, Path(event_id): Path<Uuid>) -> AppResult<Json<Value>> {
    let access = Access::load(&state.db, user, event_id).await?.member()?;
    let contact = access.is_staff() || access.role == Some(Role::Retriever);
    let mut v: Value = sqlx::query_scalar(
        "select jsonb_build_object(
            'last_seq', coalesce((select max(seq) from event_log where event_id = $1), 0),
            'server_time', (extract(epoch from now()) * 1000)::bigint,
            'members', coalesce((
                select jsonb_agg(jsonb_build_object(
                    'user_id', u.id, 'first_name', u.first_name, 'last_name', u.last_name, 'role', m.role,
                    'bib', m.bib, 'vehicle_id', m.vehicle_id, 'is_available', m.is_available,
                    'tracking', exists(select 1 from tracking_sessions s
                        where s.event_id = m.event_id and s.user_id = m.user_id and s.ended_at is null),
                    'pilot_state', case when m.role <> 'pilot' then null
                        when r.status = 'open' then 'awaiting_retrieve'
                        when r.status in ('assigned', 'arrived') then 'retriever_assigned'
                        when r.status = 'picked_up' then 'picked_up'
                        else coalesce(f.status, 'preparing') end)
                    || case when $2 then jsonb_build_object('phone', u.phone) else '{}'::jsonb end)
                from event_members m
                join users u on u.id = m.user_id
                left join lateral (select fl.status from flights fl
                    where fl.event_id = m.event_id and fl.pilot_id = m.user_id and fl.status <> 'cancelled'
                      and fl.created_at > now() - interval '18 hours'
                    order by fl.created_at desc limit 1) f on true
                left join retrieve_requests r on r.event_id = m.event_id and r.pilot_id = m.user_id
                    and r.status in ('open', 'assigned', 'arrived', 'picked_up')
                where m.event_id = $1 and m.status = 'active'), '[]'::jsonb),
            'flights', coalesce((select jsonb_agg(to_jsonb(fl) - 'event_id'::text)
                from flights fl where fl.event_id = $1 and fl.status in ('preparing', 'flying', 'landed')), '[]'::jsonb),
            'retrieves', coalesce((select jsonb_agg(to_jsonb(rr) - 'event_id'::text order by rr.requested_at)
                from retrieve_requests rr
                where rr.event_id = $1 and rr.status in ('open', 'assigned', 'arrived', 'picked_up')), '[]'::jsonb),
            'sos', coalesce((select jsonb_agg(to_jsonb(s) - 'event_id'::text order by s.created_at)
                from sos_alerts s where s.event_id = $1 and s.status <> 'resolved'), '[]'::jsonb))",
    )
    .bind(event_id)
    .bind(contact)
    .fetch_one(&state.db)
    .await?;
    let mut redis = state.redis.clone();
    let raw: Vec<String> = redis.hvals(format!("live:{event_id}")).await.unwrap_or_default();
    v["positions"] = raw.iter().filter_map(|s| serde_json::from_str::<Value>(s).ok()).collect();
    Ok(Json(v))
}

#[derive(Deserialize)]
struct LogQuery {
    #[serde(default)]
    after: i64,
}

/// Operasyon zaman çizelgesi ve kaçan olayların eşitlenmesi.
async fn log(
    State(state): State<AppState>,
    user: AuthUser,
    Path(event_id): Path<Uuid>,
    Query(q): Query<LogQuery>,
) -> AppResult<Json<Value>> {
    Access::load(&state.db, user, event_id).await?.member()?;
    let v: Value = sqlx::query_scalar(
        "select coalesce(jsonb_agg(jsonb_build_object('t', l.type, 'seq', l.seq,
            'at', (extract(epoch from l.created_at) * 1000)::bigint, 'actor', l.actor_id,
            'subject', l.subject_id, 'd', l.payload) order by l.seq), '[]'::jsonb)
         from (select * from event_log where event_id = $1 and seq > $2 order by seq limit 500) l",
    )
    .bind(event_id)
    .bind(q.after)
    .fetch_one(&state.db)
    .await?;
    Ok(Json(json!({ "data": v })))
}

#[derive(Deserialize)]
struct TrackQuery {
    #[serde(default, with = "time::serde::rfc3339::option")]
    from: Option<OffsetDateTime>,
    #[serde(default, with = "time::serde::rfc3339::option")]
    to: Option<OffsetDateTime>,
}

/// Geçmiş iz: kullanıcı kendi izini, yetkililer herkesinkini görür.
/// Satırlar `[t_ms, lat, lon, alt, spd]`; uzun uçuşlarda yanıtı küçük tutar.
async fn track(
    State(state): State<AppState>,
    user: AuthUser,
    Path((event_id, target)): Path<(Uuid, Uuid)>,
    Query(q): Query<TrackQuery>,
) -> AppResult<Json<Value>> {
    let access = Access::load(&state.db, user, event_id).await?.member()?;
    if target != user.id && !access.is_staff() {
        return Err(AppError::Forbidden);
    }
    let v: Value = sqlx::query_scalar(
        "select coalesce(jsonb_agg(jsonb_build_array((extract(epoch from p.recorded_at) * 1000)::bigint,
            p.lat, p.lon, p.altitude_m, p.speed_mps) order by p.recorded_at), '[]'::jsonb)
         from (select * from location_points
               where event_id = $1 and user_id = $2
                 and ($3::timestamptz is null or recorded_at >= $3) and ($4::timestamptz is null or recorded_at <= $4)
               order by recorded_at limit 50000) p",
    )
    .bind(event_id)
    .bind(target)
    .bind(q.from)
    .bind(q.to)
    .fetch_one(&state.db)
    .await?;
    Ok(Json(json!({ "columns": ["t", "lat", "lon", "alt", "spd"], "points": v })))
}

use axum::{
    Json, Router,
    extract::{Query, State},
    http::StatusCode,
    routing::get,
};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/health", get(health))
        .route("/ready", get(ready))
        .route("/admin/users", get(users))
        .route("/admin/events", get(events))
        .route("/admin/stats", get(stats))
}

async fn health() -> &'static str {
    "ok"
}

async fn ready(State(state): State<AppState>) -> Result<&'static str, StatusCode> {
    let db = sqlx::query_scalar::<_, i32>("select 1").fetch_one(&state.db).await.is_ok();
    let mut redis = state.redis.clone();
    let cache = redis::cmd("PING").query_async::<String>(&mut redis).await.is_ok();
    if db && cache { Ok("ready") } else { Err(StatusCode::SERVICE_UNAVAILABLE) }
}

fn sysadmin(user: AuthUser) -> AppResult<()> {
    if user.is_system_admin { Ok(()) } else { Err(AppError::Forbidden) }
}

#[derive(Deserialize)]
struct Search {
    q: Option<String>,
}

async fn users(State(state): State<AppState>, user: AuthUser, Query(s): Query<Search>) -> AppResult<Json<Value>> {
    sysadmin(user)?;
    let v: Value = sqlx::query_scalar(
        "select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'email', u.email, 'first_name', u.first_name,
            'last_name', u.last_name, 'phone', u.phone, 'country', u.country, 'is_system_admin', u.is_system_admin,
            'created_at', u.created_at) order by u.created_at desc), '[]'::jsonb)
         from (select * from users
               where deleted_at is null and ($1::text is null
                    or email ilike '%' || $1 || '%' or first_name || ' ' || last_name ilike '%' || $1 || '%')
               order by created_at desc limit 200) u",
    )
    .bind(s.q.filter(|q| !q.trim().is_empty()))
    .fetch_one(&state.db)
    .await?;
    Ok(Json(json!({ "data": v })))
}

/// Taslak ve arşiv dahil tüm etkinlikler.
async fn events(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    sysadmin(user)?;
    let v: Value = sqlx::query_scalar(
        "select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'slug', e.slug, 'name', e.name, 'status', e.status,
            'visibility', e.visibility, 'starts_at', e.starts_at, 'ends_at', e.ends_at, 'city', e.city,
            'members', (select count(*) from event_members m where m.event_id = e.id and m.status = 'active'),
            'pending_applications', (select count(*) from applications a where a.event_id = e.id and a.status = 'pending'))
            order by e.starts_at desc), '[]'::jsonb)
         from events e",
    )
    .fetch_one(&state.db)
    .await?;
    Ok(Json(json!({ "data": v })))
}

async fn stats(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    sysadmin(user)?;
    let mut v: Value = sqlx::query_scalar(
        "select jsonb_build_object(
            'users', (select count(*) from users where deleted_at is null),
            'active_events', (select count(*) from events where status = 'active'),
            'open_tracking_sessions', (select count(*) from tracking_sessions where ended_at is null),
            'points_last_hour', (select count(*) from location_points where received_at > now() - interval '1 hour'),
            'open_retrieves', (select count(*) from retrieve_requests where status in ('open', 'assigned', 'arrived', 'picked_up')),
            'active_sos', (select count(*) from sos_alerts where status <> 'resolved'))",
    )
    .fetch_one(&state.db)
    .await?;
    v["ws_connections"] = state.hub.connections().into();
    v["db_pool"] = json!({ "size": state.db.size(), "idle": state.db.num_idle() });
    Ok(Json(v))
}

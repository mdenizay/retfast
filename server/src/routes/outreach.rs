//! Etkinlik duyuruları ve e-posta davetleri (admin → katılımcılar / yeni kişiler).
use axum::{
    Json, Router,
    extract::{Path, State},
    routing::{delete, get, post},
};
use serde::Deserialize;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{
    auth::{self, AuthUser},
    authz::Access,
    error::{AppError, AppResult, invalid},
    mail, oplog,
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/events/{id}/announcements", get(list).post(create))
        .route("/announcements/{id}", delete(remove))
        .route("/events/{id}/invites", post(invite))
}

async fn list(State(state): State<AppState>, user: AuthUser, Path(event_id): Path<Uuid>) -> AppResult<Json<Value>> {
    Access::load(&state.db, user, event_id).await?.member()?;
    let v: Value = sqlx::query_scalar(
        "select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'title', a.title, 'body', a.body, 'created_at', a.created_at,
            'author', u.first_name || ' ' || u.last_name) order by a.created_at desc), '[]'::jsonb)
         from (select * from announcements where event_id = $1 order by created_at desc limit 50) a
         join users u on u.id = a.author_id",
    )
    .bind(event_id)
    .fetch_one(&state.db)
    .await?;
    Ok(Json(json!({ "data": v })))
}

#[derive(Deserialize)]
struct AnnouncementInput {
    title: String,
    #[serde(default)]
    body: String,
}

async fn create(
    State(state): State<AppState>,
    user: AuthUser,
    Path(event_id): Path<Uuid>,
    Json(b): Json<AnnouncementInput>,
) -> AppResult<Json<Value>> {
    Access::load(&state.db, user, event_id).await?.admin()?;
    let title = b.title.trim();
    if title.is_empty() || title.chars().count() > 120 || b.body.chars().count() > 4000 {
        return Err(invalid("title is required (max 120 chars), body max 4000 chars"));
    }
    let id = Uuid::now_v7();
    let mut tx = state.db.begin().await?;
    sqlx::query("insert into announcements (id, event_id, author_id, title, body) values ($1, $2, $3, $4, $5)")
        .bind(id)
        .bind(event_id)
        .bind(user.id)
        .bind(title)
        .bind(b.body.trim())
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "insert into notifications (id, user_id, event_id, kind, critical, payload)
         select gen_random_uuid(), m.user_id, $1, 'announcement', false, jsonb_build_object('id', $2::uuid, 'title', $3::text)
         from event_members m where m.event_id = $1 and m.status = 'active' and m.user_id <> $4",
    )
    .bind(event_id)
    .bind(id)
    .bind(title)
    .bind(user.id)
    .execute(&mut *tx)
    .await?;
    oplog::audit(&mut tx, user.id, Some(event_id), "announcement.create", Some(("announcement", id)), json!({ "title": title })).await?;
    let pending = oplog::record(&mut tx, event_id, "announcement.posted", Some(user.id), None, json!({ "id": id, "title": title })).await?;
    tx.commit().await?;
    pending.publish(&state).await;
    Ok(Json(json!({ "id": id })))
}

async fn remove(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Value>> {
    let event_id: Uuid = sqlx::query_scalar("select event_id from announcements where id = $1")
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound)?;
    Access::load(&state.db, user, event_id).await?.admin()?;
    sqlx::query("delete from announcements where id = $1").bind(id).execute(&state.db).await?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
struct InviteInput {
    emails: Vec<String>,
    #[serde(default)]
    message: String,
}

/// E-posta daveti: kayıtlı kullanıcıya ayrıca uygulama içi bildirim gider. Özel etkinlikte davet kodu e-postaya eklenir.
async fn invite(
    State(state): State<AppState>,
    user: AuthUser,
    Path(event_id): Path<Uuid>,
    Json(b): Json<InviteInput>,
) -> AppResult<Json<Value>> {
    Access::load(&state.db, user, event_id).await?.admin()?;
    if b.emails.is_empty() || b.emails.len() > 50 || b.message.chars().count() > 1000 {
        return Err(invalid("1-50 emails and a message up to 1000 chars are required"));
    }
    auth::rate_limit(&state, &format!("invites:{}", user.id), 200, 3600).await?;
    let (name, visibility, code, status): (String, String, Option<String>, String) =
        sqlx::query_as("select name, visibility, invite_code, status from events where id = $1")
            .bind(event_id)
            .fetch_one(&state.db)
            .await?;
    if status == "draft" || status == "archived" {
        return Err(AppError::Conflict("EVENT_NOT_OPEN", "invitations need a published event"));
    }
    let inviter: String =
        sqlx::query_scalar("select first_name || ' ' || last_name from users where id = $1").bind(user.id).fetch_one(&state.db).await?;
    let url = format!("{}/events/{event_id}", state.config.public_web_url);
    let mut sent = 0;
    let mut skipped = Vec::new();
    let mut tx = state.db.begin().await?;
    for raw in b.emails.iter().map(|e| e.trim().to_lowercase()).collect::<std::collections::BTreeSet<_>>() {
        if !raw.contains('@') || raw.len() > 254 || raw.contains(char::is_whitespace) {
            skipped.push(raw);
            continue;
        }
        let existing: Option<(Uuid, String)> = sqlx::query_as("select id, locale from users where email = $1 and deleted_at is null")
            .bind(&raw)
            .fetch_optional(&mut *tx)
            .await?;
        let locale = existing.as_ref().map(|e| e.1.clone()).unwrap_or_else(|| "tr".into());
        if let Some((uid, _)) = &existing {
            oplog::notify(&mut tx, *uid, Some(event_id), "event.invite", false, json!({ "event_id": event_id, "name": name })).await?;
        }
        mail::invitation(
            &state,
            raw,
            &locale,
            &name,
            &inviter,
            &url,
            if visibility == "private" { code.as_deref() } else { None },
            b.message.trim(),
        );
        sent += 1;
    }
    oplog::audit(&mut tx, user.id, Some(event_id), "invites.send", None, json!({ "count": sent })).await?;
    tx.commit().await?;
    Ok(Json(json!({ "sent": sent, "skipped": skipped })))
}

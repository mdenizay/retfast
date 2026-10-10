use axum::{
    Json, Router,
    extract::{Path, Query, State},
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{
    auth::AuthUser,
    authz::Access,
    error::{AppError, AppResult, invalid},
    mail, oplog,
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/events/{id}/applications", get(list).post(apply))
        .route("/applications/{id}/decide", post(decide))
        .route("/applications/{id}/cancel", post(cancel))
}

#[derive(Deserialize)]
struct Apply {
    requested_role: Option<String>,
    #[serde(default)]
    message: String,
    invite_code: Option<String>,
}

async fn apply(State(state): State<AppState>, user: AuthUser, Path(event_id): Path<Uuid>, Json(b): Json<Apply>) -> AppResult<Json<Value>> {
    if b.requested_role.as_deref().is_some_and(|r| !matches!(r, "pilot" | "retriever" | "observer")) {
        return Err(invalid("requested_role must be pilot, retriever or observer"));
    }
    if b.message.len() > 2000 {
        return Err(invalid("message is too long"));
    }
    let row: Option<(String, bool, Option<String>, bool)> = sqlx::query_as(
        "select e.visibility,
            (e.status in ('published', 'active') and not e.applications_closed
                and (e.applications_open_at is null or e.applications_open_at <= now())
                and (e.applications_close_at is null or e.applications_close_at > now())),
            e.invite_code,
            exists(select 1 from event_members m where m.event_id = e.id and m.user_id = $2 and m.status = 'active')
         from events e where e.id = $1 and e.status <> 'draft'",
    )
    .bind(event_id)
    .bind(user.id)
    .fetch_optional(&state.db)
    .await?;
    let (visibility, open, invite_code, is_member) = row.ok_or(AppError::NotFound)?;
    let code_ok = b.invite_code.as_deref().map(|c| c.trim().to_uppercase()) == invite_code && invite_code.is_some();
    // Özel etkinlik davet kodu olmadan yok hükmünde.
    if visibility == "private" && !code_ok {
        return Err(AppError::NotFound);
    }
    if is_member {
        return Err(AppError::Conflict("ALREADY_MEMBER", "you are already a member of this event"));
    }
    if !open {
        return Err(AppError::Conflict("APPLICATIONS_CLOSED", "applications are closed for this event"));
    }
    let id = Uuid::now_v7();
    let inserted = sqlx::query(
        "insert into applications (id, event_id, user_id, requested_role, message) values ($1, $2, $3, $4, $5)
         on conflict (event_id, user_id) where status = 'pending' do nothing",
    )
    .bind(id)
    .bind(event_id)
    .bind(user.id)
    .bind(&b.requested_role)
    .bind(b.message.trim())
    .execute(&state.db)
    .await?;
    if inserted.rows_affected() == 0 {
        return Err(AppError::Conflict("ALREADY_APPLIED", "you already have a pending application"));
    }
    Ok(Json(json!({ "id": id, "status": "pending" })))
}

#[derive(Deserialize)]
struct ListQuery {
    status: Option<String>,
}

async fn list(
    State(state): State<AppState>,
    user: AuthUser,
    Path(event_id): Path<Uuid>,
    Query(q): Query<ListQuery>,
) -> AppResult<Json<Value>> {
    Access::load(&state.db, user, event_id).await?.admin()?;
    let v: Value = sqlx::query_scalar(
        "select coalesce(jsonb_agg(jsonb_build_object(
            'id', a.id, 'status', a.status, 'requested_role', a.requested_role, 'message', a.message,
            'decided_role', a.decided_role, 'decided_at', a.decided_at, 'decision_note', a.decision_note,
            'created_at', a.created_at,
            'user', jsonb_build_object('id', u.id, 'first_name', u.first_name, 'last_name', u.last_name,
                'email', u.email, 'phone', u.phone, 'country', u.country, 'avatar_url', u.avatar_url))
            order by a.created_at), '[]'::jsonb)
         from applications a join users u on u.id = a.user_id
         where a.event_id = $1 and ($2::text is null or a.status = $2)",
    )
    .bind(event_id)
    .bind(q.status)
    .fetch_one(&state.db)
    .await?;
    Ok(Json(json!({ "data": v })))
}

#[derive(Deserialize)]
struct Decide {
    decision: String,
    role: Option<String>,
    note: Option<String>,
}

async fn decide(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>, Json(b): Json<Decide>) -> AppResult<Json<Value>> {
    let event_id: Uuid = sqlx::query_scalar("select event_id from applications where id = $1")
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound)?;
    Access::load(&state.db, user, event_id).await?.admin()?;
    let role = match (b.decision.as_str(), b.role.as_deref()) {
        ("accept", Some(r @ ("pilot" | "retriever" | "observer"))) => Some(r),
        ("reject", _) => None,
        _ => return Err(invalid("decision must be reject, or accept with role pilot/retriever/observer")),
    };
    let status = if role.is_some() { "accepted" } else { "rejected" };

    let mut tx = state.db.begin().await?;
    // Koşullu güncelleme: iki admin aynı anda karar verirse yalnızca ilki geçerli olur.
    let applicant: Option<Uuid> = sqlx::query_scalar(
        "update applications set status = $2, decided_role = $3, decided_by = $4, decided_at = now(), decision_note = $5
         where id = $1 and status = 'pending' returning user_id",
    )
    .bind(id)
    .bind(status)
    .bind(role)
    .bind(user.id)
    .bind(&b.note)
    .fetch_optional(&mut *tx)
    .await?;
    let applicant = applicant.ok_or(AppError::Conflict("ALREADY_DECIDED", "this application was already decided"))?;
    let mut pending = None;
    if let Some(role) = role {
        sqlx::query(
            "insert into event_members (event_id, user_id, role) values ($1, $2, $3)
             on conflict (event_id, user_id) do update set role = excluded.role, status = 'active', updated_at = now()",
        )
        .bind(event_id)
        .bind(applicant)
        .bind(role)
        .execute(&mut *tx)
        .await?;
        pending = Some(oplog::record(&mut tx, event_id, "member.updated", Some(user.id), Some(applicant), json!({ "role": role })).await?);
    }
    oplog::audit(
        &mut tx,
        user.id,
        Some(event_id),
        "application.decide",
        Some(("application", id)),
        json!({ "status": status, "role": role }),
    )
    .await?;
    oplog::notify(&mut tx, applicant, Some(event_id), "application.decided", false, json!({ "status": status, "role": role })).await?;
    let (email, locale, event_name): (String, String, String) =
        sqlx::query_as("select u.email::text, u.locale, e.name from users u, events e where u.id = $1 and e.id = $2")
            .bind(applicant)
            .bind(event_id)
            .fetch_one(&mut *tx)
            .await?;
    tx.commit().await?;
    if let Some(p) = pending {
        p.publish(&state).await;
    }
    mail::application_decided(&state, email, &locale, &event_name, role);
    Ok(Json(json!({ "id": id, "status": status, "role": role })))
}

async fn cancel(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Value>> {
    let changed = sqlx::query("update applications set status = 'cancelled' where id = $1 and user_id = $2 and status = 'pending'")
        .bind(id)
        .bind(user.id)
        .execute(&state.db)
        .await?;
    if changed.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(Json(json!({ "id": id, "status": "cancelled" })))
}

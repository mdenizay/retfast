//! Saha operasyonu: uçuş durumu, retrieve talepleri, retriever müsaitliği, SOS.
//! Durum geçişleri koşullu UPDATE ile yapılır; eşzamanlı iki istekten yalnızca biri kazanır.
use axum::{
    Json, Router,
    extract::{Path, State},
    routing::{post, put},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

use crate::{
    auth::AuthUser,
    authz::{Access, Role},
    error::{AppError, AppResult, invalid},
    extract::OptJson,
    oplog,
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/events/{id}/flights/takeoff", post(takeoff))
        .route("/events/{id}/flights/land", post(land))
        .route("/events/{id}/flights/complete", post(complete_flight))
        .route("/events/{id}/retrieves", post(request_retrieve))
        .route("/retrieves/{id}/{action}", post(retrieve_action))
        .route("/events/{id}/availability", put(availability))
        .route("/events/{id}/sos", post(raise_sos))
        .route("/sos/{id}/{action}", post(sos_action))
}

type Tx<'a> = Transaction<'a, Postgres>;

#[derive(Deserialize, Default)]
struct FlightBody {
    /// Yetkili (observer/admin) bir pilot adına işlem yapıyorsa.
    pilot_id: Option<Uuid>,
    lat: Option<f64>,
    lon: Option<f64>,
}

fn coords(lat: Option<f64>, lon: Option<f64>) -> AppResult<Option<(f64, f64)>> {
    match (lat, lon) {
        (Some(lat), Some(lon)) if (-90.0..=90.0).contains(&lat) && (-180.0..=180.0).contains(&lon) => Ok(Some((lat, lon))),
        (None, None) => Ok(None),
        _ => Err(invalid("lat and lon must both be valid coordinates")),
    }
}

/// Pilot kendisi için veya yetkili pilot adına. Hedefin etkinlikte aktif pilot olduğunu doğrular.
async fn pilot_target(state: &AppState, access: &Access, target: Option<Uuid>) -> AppResult<(Uuid, bool)> {
    let (pilot, on_behalf) = access.acting_for(target)?;
    if !on_behalf && access.role != Some(Role::Pilot) {
        return Err(AppError::Forbidden);
    }
    if on_behalf {
        let ok: bool = sqlx::query_scalar(
            "select exists(select 1 from event_members where event_id = $1 and user_id = $2 and role = 'pilot' and status = 'active')",
        )
        .bind(access.event_id)
        .bind(pilot)
        .fetch_one(&state.db)
        .await?;
        if !ok {
            return Err(AppError::NotFound);
        }
    }
    Ok((pilot, on_behalf))
}

async fn audit_behalf(tx: &mut Tx<'_>, access: &Access, on_behalf: bool, action: &str, pilot: Uuid) -> AppResult<()> {
    if on_behalf {
        oplog::audit(tx, access.user.id, Some(access.event_id), action, Some(("user", pilot)), json!({ "on_behalf": true })).await?;
    }
    Ok(())
}

async fn takeoff(
    State(state): State<AppState>,
    user: AuthUser,
    Path(event_id): Path<Uuid>,
    OptJson(b): OptJson<FlightBody>,
) -> AppResult<Json<Value>> {
    let access = Access::load(&state.db, user, event_id).await?.member()?;
    access.require_active_event()?;
    let (pilot, on_behalf) = pilot_target(&state, &access, b.pilot_id).await?;
    let mut tx = state.db.begin().await?;
    let id = Uuid::now_v7();
    let inserted = sqlx::query(
        "insert into flights (id, event_id, pilot_id, status, takeoff_at) values ($1, $2, $3, 'flying', now())
         on conflict (event_id, pilot_id) where status in ('preparing', 'flying', 'landed') do nothing",
    )
    .bind(id)
    .bind(event_id)
    .bind(pilot)
    .execute(&mut *tx)
    .await?;
    if inserted.rows_affected() == 0 {
        return Err(AppError::Conflict("FLIGHT_OPEN", "finish the current flight before starting a new one"));
    }
    audit_behalf(&mut tx, &access, on_behalf, "flight.takeoff", pilot).await?;
    let pending = oplog::record(&mut tx, event_id, "flight.takeoff", Some(user.id), Some(pilot), json!({ "flight_id": id })).await?;
    tx.commit().await?;
    pending.publish(&state).await;
    Ok(Json(json!({ "flight_id": id, "status": "flying" })))
}

/// İnişi işaretler. Kalkış işaretlenmemişse iniş kaydıyla birlikte uçuş açılır.
async fn mark_landed(tx: &mut Tx<'_>, event_id: Uuid, pilot: Uuid, at: Option<(f64, f64)>) -> AppResult<Option<Uuid>> {
    let (lat, lon) = at.unzip();
    let updated: Option<Uuid> = sqlx::query_scalar(
        "update flights set status = 'landed', landed_at = now(), landed_lat = $3, landed_lon = $4
         where event_id = $1 and pilot_id = $2 and status in ('preparing', 'flying') returning id",
    )
    .bind(event_id)
    .bind(pilot)
    .bind(lat)
    .bind(lon)
    .fetch_optional(&mut **tx)
    .await?;
    if updated.is_some() {
        return Ok(updated);
    }
    let id = Uuid::now_v7();
    let inserted = sqlx::query(
        "insert into flights (id, event_id, pilot_id, status, landed_at, landed_lat, landed_lon)
         values ($1, $2, $3, 'landed', now(), $4, $5)
         on conflict (event_id, pilot_id) where status in ('preparing', 'flying', 'landed') do nothing",
    )
    .bind(id)
    .bind(event_id)
    .bind(pilot)
    .bind(lat)
    .bind(lon)
    .execute(&mut **tx)
    .await?;
    Ok((inserted.rows_affected() == 1).then_some(id))
}

async fn land(
    State(state): State<AppState>,
    user: AuthUser,
    Path(event_id): Path<Uuid>,
    OptJson(b): OptJson<FlightBody>,
) -> AppResult<Json<Value>> {
    let access = Access::load(&state.db, user, event_id).await?.member()?;
    access.require_active_event()?;
    let at = coords(b.lat, b.lon)?;
    let (pilot, on_behalf) = pilot_target(&state, &access, b.pilot_id).await?;
    let mut tx = state.db.begin().await?;
    let flight =
        mark_landed(&mut tx, event_id, pilot, at).await?.ok_or(AppError::Conflict("ALREADY_LANDED", "landing is already recorded"))?;
    audit_behalf(&mut tx, &access, on_behalf, "flight.landed", pilot).await?;
    let pending = oplog::record(
        &mut tx,
        event_id,
        "flight.landed",
        Some(user.id),
        Some(pilot),
        json!({ "flight_id": flight, "lat": b.lat, "lon": b.lon }),
    )
    .await?;
    tx.commit().await?;
    pending.publish(&state).await;
    Ok(Json(json!({ "flight_id": flight, "status": "landed" })))
}

/// Pilot güvende, retrieve gerekmiyor (veya kendi imkânıyla döndü): uçuşu kapat.
async fn complete_flight(
    State(state): State<AppState>,
    user: AuthUser,
    Path(event_id): Path<Uuid>,
    OptJson(b): OptJson<FlightBody>,
) -> AppResult<Json<Value>> {
    let access = Access::load(&state.db, user, event_id).await?.member()?;
    let (pilot, on_behalf) = pilot_target(&state, &access, b.pilot_id).await?;
    let mut tx = state.db.begin().await?;
    let assigned: bool = sqlx::query_scalar(
        "select exists(select 1 from retrieve_requests where event_id = $1 and pilot_id = $2
            and status in ('assigned', 'arrived', 'picked_up'))",
    )
    .bind(event_id)
    .bind(pilot)
    .fetch_one(&mut *tx)
    .await?;
    if assigned {
        return Err(AppError::Conflict("RETRIEVE_IN_PROGRESS", "cancel or complete the retrieve first"));
    }
    let flight: Option<Uuid> = sqlx::query_scalar(
        "update flights set status = 'completed', completed_at = now()
         where event_id = $1 and pilot_id = $2 and status in ('preparing', 'flying', 'landed') returning id",
    )
    .bind(event_id)
    .bind(pilot)
    .fetch_optional(&mut *tx)
    .await?;
    let flight = flight.ok_or(AppError::NotFound)?;
    let cancelled: Option<Uuid> = sqlx::query_scalar(
        "update retrieve_requests set status = 'cancelled', cancelled_at = now(), cancel_reason = 'flight_completed'
         where event_id = $1 and pilot_id = $2 and status = 'open' returning id",
    )
    .bind(event_id)
    .bind(pilot)
    .fetch_optional(&mut *tx)
    .await?;
    audit_behalf(&mut tx, &access, on_behalf, "flight.completed", pilot).await?;
    let mut pending = Vec::new();
    if let Some(r) = cancelled {
        pending.push(oplog::record(&mut tx, event_id, "retrieve.cancelled", Some(user.id), Some(pilot), json!({ "id": r })).await?);
    }
    pending.push(oplog::record(&mut tx, event_id, "flight.completed", Some(user.id), Some(pilot), json!({ "flight_id": flight })).await?);
    tx.commit().await?;
    for p in pending {
        p.publish(&state).await;
    }
    Ok(Json(json!({ "flight_id": flight, "status": "completed" })))
}

// ── Retrieve ───────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct RetrieveBody {
    pilot_id: Option<Uuid>,
    lat: f64,
    lon: f64,
    #[serde(default)]
    note: String,
}

async fn request_retrieve(
    State(state): State<AppState>,
    user: AuthUser,
    Path(event_id): Path<Uuid>,
    Json(b): Json<RetrieveBody>,
) -> AppResult<Json<Value>> {
    let access = Access::load(&state.db, user, event_id).await?.member()?;
    access.require_active_event()?;
    let at = coords(Some(b.lat), Some(b.lon))?;
    if b.note.len() > 500 {
        return Err(invalid("note is too long"));
    }
    let (pilot, on_behalf) = pilot_target(&state, &access, b.pilot_id).await?;
    let mut tx = state.db.begin().await?;
    // Talep inişi ima eder: uçuş hâlâ "uçuyor" ise iniş de kaydedilir.
    let landed = mark_landed(&mut tx, event_id, pilot, at).await?;
    let flight: Option<Uuid> = match landed {
        Some(f) => Some(f),
        None => {
            sqlx::query_scalar("select id from flights where event_id = $1 and pilot_id = $2 and status = 'landed'")
                .bind(event_id)
                .bind(pilot)
                .fetch_optional(&mut *tx)
                .await?
        }
    };
    let id = Uuid::now_v7();
    let inserted = sqlx::query(
        "insert into retrieve_requests (id, event_id, pilot_id, flight_id, lat, lon, note) values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (event_id, pilot_id) where status in ('open', 'assigned', 'arrived', 'picked_up') do nothing",
    )
    .bind(id)
    .bind(event_id)
    .bind(pilot)
    .bind(flight)
    .bind(b.lat)
    .bind(b.lon)
    .bind(b.note.trim())
    .execute(&mut *tx)
    .await?;
    if inserted.rows_affected() == 0 {
        return Err(AppError::Conflict("RETRIEVE_EXISTS", "there is already an active retrieve request"));
    }
    audit_behalf(&mut tx, &access, on_behalf, "retrieve.requested", pilot).await?;
    // Uygulama içi bildirim: müsait retriever'lar ve yetkililer.
    sqlx::query(
        "insert into notifications (id, user_id, event_id, kind, critical, payload)
         select gen_random_uuid(), m.user_id, $1, 'retrieve.requested', true, jsonb_build_object('id', $2::uuid, 'pilot_id', $3::uuid)
         from event_members m
         where m.event_id = $1 and m.status = 'active' and m.user_id <> $3
           and (m.role in ('event_admin', 'observer') or (m.role = 'retriever' and m.is_available))",
    )
    .bind(event_id)
    .bind(id)
    .bind(pilot)
    .execute(&mut *tx)
    .await?;
    let mut pending = Vec::new();
    if let Some(f) = landed {
        pending.push(
            oplog::record(
                &mut tx,
                event_id,
                "flight.landed",
                Some(user.id),
                Some(pilot),
                json!({ "flight_id": f, "lat": b.lat, "lon": b.lon }),
            )
            .await?,
        );
    }
    pending.push(
        oplog::record(
            &mut tx,
            event_id,
            "retrieve.requested",
            Some(user.id),
            Some(pilot),
            json!({ "id": id, "lat": b.lat, "lon": b.lon, "note": b.note.trim() }),
        )
        .await?,
    );
    tx.commit().await?;
    for p in pending {
        p.publish(&state).await;
    }
    Ok(Json(json!({ "id": id, "status": "open" })))
}

#[derive(Deserialize, Default)]
struct ActionBody {
    retriever_id: Option<Uuid>,
    reason: Option<String>,
}

struct Step {
    from: &'static [&'static str],
    to: &'static str,
    event: &'static str,
}

async fn retrieve_action(
    State(state): State<AppState>,
    user: AuthUser,
    Path((id, action)): Path<(Uuid, String)>,
    OptJson(b): OptJson<ActionBody>,
) -> AppResult<Json<Value>> {
    let row: Option<(Uuid, Uuid, Option<Uuid>)> =
        sqlx::query_as("select event_id, pilot_id, retriever_id from retrieve_requests where id = $1")
            .bind(id)
            .fetch_optional(&state.db)
            .await?;
    let (event_id, pilot, current_retriever) = row.ok_or(AppError::NotFound)?;
    let access = Access::load(&state.db, user, event_id).await?.member()?;
    let staff = access.is_staff();
    let is_pilot = pilot == user.id;
    let is_assigned = current_retriever == Some(user.id);

    // (izin, geçiş, atanacak retriever)
    let (allowed, step, assignee) = match action.as_str() {
        // Retriever açık talebi kendi üstüne alır.
        "accept" => {
            (access.role == Some(Role::Retriever), Step { from: &["open"], to: "assigned", event: "retrieve.assigned" }, Some(user.id))
        }
        // Yetkili atar veya başka retriever'a devreder.
        "assign" => (
            staff,
            Step { from: &["open", "assigned", "arrived"], to: "assigned", event: "retrieve.assigned" },
            Some(b.retriever_id.ok_or_else(|| invalid("retriever_id is required"))?),
        ),
        // Retriever bırakır, pilot başka retriever ister veya yetkili atamayı kaldırır.
        "release" => {
            (staff || is_pilot || is_assigned, Step { from: &["assigned", "arrived"], to: "open", event: "retrieve.released" }, None)
        }
        "arrived" => (staff || is_assigned, Step { from: &["assigned"], to: "arrived", event: "retrieve.arrived" }, None),
        "picked-up" => (staff || is_assigned, Step { from: &["assigned", "arrived"], to: "picked_up", event: "retrieve.picked_up" }, None),
        "complete" => (staff || is_assigned, Step { from: &["picked_up"], to: "completed", event: "retrieve.completed" }, None),
        "cancel" => {
            (staff || is_pilot, Step { from: &["open", "assigned", "arrived"], to: "cancelled", event: "retrieve.cancelled" }, None)
        }
        _ => return Err(AppError::NotFound),
    };
    if !allowed {
        return Err(AppError::Forbidden);
    }
    if step.to != "cancelled" && step.to != "completed" {
        access.require_active_event()?;
    }

    let mut tx = state.db.begin().await?;
    if let Some(retriever) = assignee {
        // Atanan kişi bu etkinlikte aktif retriever olmalı ve aracında yer bulunmalı.
        let seat: Option<bool> = sqlx::query_scalar(
            "select v.capacity is null or v.capacity > (
                select count(*) from retrieve_requests r
                where r.retriever_id = m.user_id and r.event_id = m.event_id and r.id <> $3
                  and r.status in ('assigned', 'arrived', 'picked_up'))
             from event_members m left join vehicles v on v.id = m.vehicle_id
             where m.event_id = $1 and m.user_id = $2 and m.role = 'retriever' and m.status = 'active'
             for update of m",
        )
        .bind(event_id)
        .bind(retriever)
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?;
        match seat {
            None => return Err(invalid("retriever_id is not an active retriever in this event")),
            Some(false) => return Err(AppError::Conflict("VEHICLE_FULL", "the retriever's vehicle is full")),
            Some(true) => {}
        }
    }
    let from: Vec<String> = step.from.iter().map(|s| s.to_string()).collect();
    let updated: Option<Option<Uuid>> = sqlx::query_scalar(
        "update retrieve_requests r set
            status = $2,
            retriever_id = case when $2 = 'open' then null else coalesce($3, r.retriever_id) end,
            vehicle_id = case when $2 = 'open' then null
                when $3::uuid is not null then (select m.vehicle_id from event_members m where m.event_id = r.event_id and m.user_id = $3)
                else r.vehicle_id end,
            assigned_by = case when $2 = 'open' then null when $3::uuid is not null then $4 else r.assigned_by end,
            assigned_at = case when $2 = 'open' then null when $3::uuid is not null then now() else r.assigned_at end,
            arrived_at = case when $2 = 'arrived' then now() when $2 in ('open', 'assigned') then null else r.arrived_at end,
            picked_up_at = case when $2 = 'picked_up' then now() else r.picked_up_at end,
            completed_at = case when $2 = 'completed' then now() else r.completed_at end,
            cancelled_at = case when $2 = 'cancelled' then now() else r.cancelled_at end,
            cancel_reason = case when $2 = 'cancelled' then $5 else r.cancel_reason end
         where r.id = $1 and r.status = any($6)
         returning r.retriever_id",
    )
    .bind(id)
    .bind(step.to)
    .bind(assignee)
    .bind(user.id)
    .bind(&b.reason)
    .bind(&from)
    .fetch_optional(&mut *tx)
    .await?;
    // Koşul tutmadıysa başka biri önce davrandı (ör. iki retriever aynı talebi kabul etti).
    let retriever = updated.ok_or(AppError::Conflict("RETRIEVE_STATE_CHANGED", "the request is no longer in that state"))?;

    let mut pending = Vec::new();
    if step.to == "completed" {
        let flight: Option<Uuid> = sqlx::query_scalar(
            "update flights set status = 'completed', completed_at = now()
             where event_id = $1 and pilot_id = $2 and status in ('preparing', 'flying', 'landed') returning id",
        )
        .bind(event_id)
        .bind(pilot)
        .fetch_optional(&mut *tx)
        .await?;
        if let Some(f) = flight {
            pending
                .push(oplog::record(&mut tx, event_id, "flight.completed", Some(user.id), Some(pilot), json!({ "flight_id": f })).await?);
        }
    }
    // Kendi işi olmayan her müdahale denetim kaydına düşer.
    if staff && !is_pilot && !is_assigned && action != "accept" {
        oplog::audit(
            &mut tx,
            user.id,
            Some(event_id),
            step.event,
            Some(("retrieve", id)),
            json!({ "action": action, "retriever_id": retriever }),
        )
        .await?;
    }
    for target in [Some(pilot), retriever.or(current_retriever)].into_iter().flatten().filter(|t| *t != user.id) {
        oplog::notify(&mut tx, target, Some(event_id), step.event, true, json!({ "id": id })).await?;
    }
    pending.push(
        oplog::record(
            &mut tx,
            event_id,
            step.event,
            Some(user.id),
            Some(pilot),
            json!({ "id": id, "status": step.to, "retriever_id": retriever }),
        )
        .await?,
    );
    tx.commit().await?;
    for p in pending {
        p.publish(&state).await;
    }
    Ok(Json(json!({ "id": id, "status": step.to, "retriever_id": retriever })))
}

#[derive(Deserialize)]
struct Availability {
    available: bool,
    /// Gönderilmezse araç değişmez; `null` aracı kaldırır.
    #[serde(default, deserialize_with = "double_option")]
    vehicle_id: Option<Option<Uuid>>,
}

fn double_option<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<Option<Uuid>>, D::Error> {
    Option::<Uuid>::deserialize(d).map(Some)
}

async fn availability(
    State(state): State<AppState>,
    user: AuthUser,
    Path(event_id): Path<Uuid>,
    Json(b): Json<Availability>,
) -> AppResult<Json<Value>> {
    Access::load(&state.db, user, event_id).await?.role_is(Role::Retriever)?;
    if let Some(Some(vehicle)) = b.vehicle_id {
        let ok: bool = sqlx::query_scalar("select exists(select 1 from vehicles where id = $1 and event_id = $2)")
            .bind(vehicle)
            .bind(event_id)
            .fetch_one(&state.db)
            .await?;
        if !ok {
            return Err(invalid("vehicle_id does not belong to this event"));
        }
    }
    let mut tx = state.db.begin().await?;
    let vehicle: Option<Uuid> = sqlx::query_scalar(
        "update event_members set is_available = $3, vehicle_id = case when $4 then $5 else vehicle_id end, updated_at = now()
         where event_id = $1 and user_id = $2 returning vehicle_id",
    )
    .bind(event_id)
    .bind(user.id)
    .bind(b.available)
    .bind(b.vehicle_id.is_some())
    .bind(b.vehicle_id.flatten())
    .fetch_one(&mut *tx)
    .await?;
    let pending = oplog::record(
        &mut tx,
        event_id,
        "retriever.availability",
        Some(user.id),
        Some(user.id),
        json!({ "available": b.available, "vehicle_id": vehicle }),
    )
    .await?;
    tx.commit().await?;
    pending.publish(&state).await;
    Ok(Json(json!({ "available": b.available, "vehicle_id": vehicle })))
}

// ── SOS ────────────────────────────────────────────────────────────────────

#[derive(Deserialize, Default)]
struct SosBody {
    lat: Option<f64>,
    lon: Option<f64>,
    #[serde(default)]
    message: String,
}

/// Acil durum bildirimi. Etkinlik durumundan bağımsız, her aktif üye gönderebilir.
/// Tekrar gönderim güvenlidir: açık bildirim varsa aynısı döner (zayıf bağlantıda yeniden deneme).
async fn raise_sos(
    State(state): State<AppState>,
    user: AuthUser,
    Path(event_id): Path<Uuid>,
    OptJson(b): OptJson<SosBody>,
) -> AppResult<Json<Value>> {
    let access = Access::load(&state.db, user, event_id).await?.member()?;
    if access.role.is_none() {
        return Err(AppError::Forbidden);
    }
    let at = coords(b.lat, b.lon)?;
    let mut tx = state.db.begin().await?;
    let existing: Option<Uuid> =
        sqlx::query_scalar("select id from sos_alerts where event_id = $1 and user_id = $2 and status <> 'resolved' for update")
            .bind(event_id)
            .bind(user.id)
            .fetch_optional(&mut *tx)
            .await?;
    if let Some(id) = existing {
        if let Some((lat, lon)) = at {
            sqlx::query("update sos_alerts set lat = $2, lon = $3 where id = $1").bind(id).bind(lat).bind(lon).execute(&mut *tx).await?;
            tx.commit().await?;
        }
        return Ok(Json(json!({ "id": id, "status": "active", "duplicate": true })));
    }
    let id = Uuid::now_v7();
    let (lat, lon) = at.unzip();
    sqlx::query("insert into sos_alerts (id, event_id, user_id, lat, lon, message) values ($1, $2, $3, $4, $5, $6)")
        .bind(id)
        .bind(event_id)
        .bind(user.id)
        .bind(lat)
        .bind(lon)
        .bind(b.message.chars().take(500).collect::<String>())
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "insert into notifications (id, user_id, event_id, kind, critical, payload)
         select gen_random_uuid(), m.user_id, $1, 'sos.raised', true, jsonb_build_object('id', $2::uuid, 'user_id', $3::uuid)
         from event_members m
         where m.event_id = $1 and m.status = 'active' and m.user_id <> $3 and m.role in ('event_admin', 'observer', 'retriever')",
    )
    .bind(event_id)
    .bind(id)
    .bind(user.id)
    .execute(&mut *tx)
    .await?;
    let pending = oplog::record(
        &mut tx,
        event_id,
        "sos.raised",
        Some(user.id),
        Some(user.id),
        json!({ "id": id, "lat": lat, "lon": lon, "message": b.message }),
    )
    .await?;
    tx.commit().await?;
    pending.publish(&state).await;
    Ok(Json(json!({ "id": id, "status": "active" })))
}

#[derive(Deserialize, Default)]
struct SosAction {
    note: Option<String>,
}

async fn sos_action(
    State(state): State<AppState>,
    user: AuthUser,
    Path((id, action)): Path<(Uuid, String)>,
    OptJson(b): OptJson<SosAction>,
) -> AppResult<Json<Value>> {
    let row: Option<(Uuid, Uuid)> =
        sqlx::query_as("select event_id, user_id from sos_alerts where id = $1").bind(id).fetch_optional(&state.db).await?;
    let (event_id, owner) = row.ok_or(AppError::NotFound)?;
    let access = Access::load(&state.db, user, event_id).await?.member()?;
    let mut tx = state.db.begin().await?;
    let (status, changed) = match action.as_str() {
        "ack" if access.is_staff() => (
            "acknowledged",
            sqlx::query(
                "update sos_alerts set status = 'acknowledged', acknowledged_by = $2, acknowledged_at = now()
             where id = $1 and status = 'active'",
            )
            .bind(id)
            .bind(user.id)
            .execute(&mut *tx)
            .await?,
        ),
        // Yetkili kapatır; yanlışlıkla basan kullanıcı kendi bildirimini kapatabilir (kayıt kalır).
        "resolve" if access.is_staff() || owner == user.id => (
            "resolved",
            sqlx::query(
                "update sos_alerts set status = 'resolved', resolved_by = $2, resolved_at = now(), resolution_note = $3
             where id = $1 and status <> 'resolved'",
            )
            .bind(id)
            .bind(user.id)
            .bind(&b.note)
            .execute(&mut *tx)
            .await?,
        ),
        "ack" | "resolve" => return Err(AppError::Forbidden),
        _ => return Err(AppError::NotFound),
    };
    if changed.rows_affected() == 0 {
        return Err(AppError::Conflict("SOS_STATE_CHANGED", "the alert is no longer in that state"));
    }
    oplog::audit(
        &mut tx,
        user.id,
        Some(event_id),
        if status == "resolved" { "sos.resolved" } else { "sos.acknowledged" },
        Some(("sos", id)),
        json!({ "note": b.note }),
    )
    .await?;
    if owner != user.id {
        oplog::notify(
            &mut tx,
            owner,
            Some(event_id),
            if status == "resolved" { "sos.resolved" } else { "sos.acknowledged" },
            true,
            json!({ "id": id }),
        )
        .await?;
    }
    let pending = oplog::record(
        &mut tx,
        event_id,
        if status == "resolved" { "sos.resolved" } else { "sos.acknowledged" },
        Some(user.id),
        Some(owner),
        json!({ "id": id, "status": status }),
    )
    .await?;
    tx.commit().await?;
    pending.publish(&state).await;
    Ok(Json(json!({ "id": id, "status": status })))
}

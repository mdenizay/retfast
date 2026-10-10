use axum::{
    Json, Router,
    extract::{Path, Query, State},
    routing::{delete, get, post, put},
};
use serde::Deserialize;
use serde_json::{Value, json};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{
    auth::{AuthUser, MaybeUser},
    authz::{Access, Role},
    error::{AppError, AppResult, invalid},
    oplog,
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/events", get(list).post(create))
        .route("/events/{id}", get(detail).patch(update))
        .route("/events/{id}/points", post(add_point))
        .route("/events/{id}/points/{point_id}", delete(delete_point))
        .route("/events/{id}/zones", post(add_zone))
        .route("/events/{id}/zones/{zone_id}", delete(delete_zone))
        .route("/events/{id}/vehicles", post(add_vehicle))
        .route("/events/{id}/vehicles/{vehicle_id}", delete(delete_vehicle))
        .route("/events/{id}/members", get(members))
        .route("/events/{id}/members/{user_id}", put(set_member).delete(remove_member))
        .route("/events/{id}/leave", post(leave))
}

#[derive(Deserialize)]
struct ListQuery {
    #[serde(default)]
    scope: Option<String>,
}

/// Herkese açık liste: taslak ve arşiv dışındaki public etkinlikler.
async fn list(State(state): State<AppState>, Query(q): Query<ListQuery>) -> AppResult<Json<Value>> {
    let scope = q.scope.as_deref().unwrap_or("all");
    if !matches!(scope, "all" | "current" | "upcoming" | "past") {
        return Err(invalid("scope must be all, current, upcoming or past"));
    }
    let v: Value = sqlx::query_scalar(
        "select coalesce(jsonb_agg(jsonb_build_object(
            'id', e.id, 'slug', e.slug, 'name', e.name, 'description', e.description, 'image_url', e.image_url,
            'starts_at', e.starts_at, 'ends_at', e.ends_at, 'country', e.country, 'city', e.city,
            'region', e.region, 'center_lat', e.center_lat, 'center_lon', e.center_lon, 'status', e.status)
            order by e.starts_at), '[]'::jsonb)
         from events e
         where e.visibility = 'public' and e.status in ('published', 'active', 'completed')
           and case $1
                 when 'current' then e.starts_at <= now() and e.ends_at >= now()
                 when 'upcoming' then e.starts_at > now()
                 when 'past' then e.ends_at < now()
                 else true end",
    )
    .bind(scope)
    .fetch_one(&state.db)
    .await?;
    Ok(Json(json!({ "data": v })))
}

fn slugify(name: &str) -> String {
    let mut out = String::new();
    for c in name.to_lowercase().chars() {
        let c = match c {
            'ç' => 'c',
            'ğ' => 'g',
            'ı' => 'i',
            'ö' => 'o',
            'ş' => 's',
            'ü' => 'u',
            c => c,
        };
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    out.trim_end_matches('-').to_string()
}

#[derive(Deserialize)]
struct EventInput {
    name: Option<String>,
    description: Option<String>,
    image_url: Option<String>,
    #[serde(default, with = "time::serde::rfc3339::option")]
    starts_at: Option<OffsetDateTime>,
    #[serde(default, with = "time::serde::rfc3339::option")]
    ends_at: Option<OffsetDateTime>,
    timezone: Option<String>,
    country: Option<String>,
    city: Option<String>,
    region: Option<String>,
    center_lat: Option<f64>,
    center_lon: Option<f64>,
    visibility: Option<String>,
    status: Option<String>,
    #[serde(default, with = "time::serde::rfc3339::option")]
    applications_open_at: Option<OffsetDateTime>,
    #[serde(default, with = "time::serde::rfc3339::option")]
    applications_close_at: Option<OffsetDateTime>,
    applications_closed: Option<bool>,
    contact: Option<Value>,
    rules_md: Option<String>,
    settings: Option<Value>,
}

impl EventInput {
    fn validate(&self) -> AppResult<()> {
        if self.name.as_deref().is_some_and(|n| n.trim().is_empty() || n.len() > 160) {
            return Err(invalid("name is required (max 160 chars)"));
        }
        if self.visibility.as_deref().is_some_and(|v| v != "public" && v != "private") {
            return Err(invalid("visibility must be public or private"));
        }
        if self.status.as_deref().is_some_and(|s| !matches!(s, "draft" | "published" | "active" | "completed" | "archived")) {
            return Err(invalid("invalid status"));
        }
        if self.center_lat.is_some_and(|v| !(-90.0..=90.0).contains(&v)) || self.center_lon.is_some_and(|v| !(-180.0..=180.0).contains(&v))
        {
            return Err(invalid("center coordinates out of range"));
        }
        if let (Some(s), Some(e)) = (self.starts_at, self.ends_at)
            && e <= s
        {
            return Err(invalid("ends_at must be after starts_at"));
        }
        Ok(())
    }
}

async fn create(State(state): State<AppState>, user: AuthUser, Json(b): Json<EventInput>) -> AppResult<Json<Value>> {
    if !user.is_system_admin {
        return Err(AppError::Forbidden);
    }
    b.validate()?;
    let name = b.name.as_deref().map(str::trim).ok_or_else(|| invalid("name is required"))?;
    let (starts_at, ends_at) = b.starts_at.zip(b.ends_at).ok_or_else(|| invalid("starts_at and ends_at are required"))?;
    let id = Uuid::now_v7();
    let base = slugify(name);
    let slug = if base.is_empty() { id.simple().to_string() } else { base };
    let taken: bool = sqlx::query_scalar("select exists(select 1 from events where slug = $1)").bind(&slug).fetch_one(&state.db).await?;
    let slug = if taken { format!("{slug}-{}", &id.simple().to_string()[24..]) } else { slug };
    let invite_code = Uuid::new_v4().simple().to_string()[..10].to_uppercase();

    let mut tx = state.db.begin().await?;
    sqlx::query(
        "insert into events (id, slug, name, description, image_url, starts_at, ends_at, timezone, country, city,
            region, center_lat, center_lon, visibility, status, applications_open_at, applications_close_at,
            contact, rules_md, settings, invite_code, created_by)
         values ($1, $2, $3, coalesce($4, ''), $5, $6, $7, coalesce($8, 'Europe/Istanbul'), $9, $10, $11, $12, $13,
            coalesce($14, 'public'), coalesce($15, 'draft'), $16, $17, coalesce($18, '{}'::jsonb),
            coalesce($19, ''), coalesce($20, '{}'::jsonb), $21, $22)",
    )
    .bind(id)
    .bind(&slug)
    .bind(name)
    .bind(&b.description)
    .bind(&b.image_url)
    .bind(starts_at)
    .bind(ends_at)
    .bind(&b.timezone)
    .bind(&b.country)
    .bind(&b.city)
    .bind(&b.region)
    .bind(b.center_lat)
    .bind(b.center_lon)
    .bind(&b.visibility)
    .bind(&b.status)
    .bind(b.applications_open_at)
    .bind(b.applications_close_at)
    .bind(&b.contact)
    .bind(&b.rules_md)
    .bind(&b.settings)
    .bind(invite_code)
    .bind(user.id)
    .execute(&mut *tx)
    .await?;
    oplog::audit(&mut tx, user.id, Some(id), "event.create", Some(("event", id)), json!({ "name": name })).await?;
    tx.commit().await?;
    detail_json(&state, id, Some(user)).await.map(Json)
}

async fn update(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>, Json(b): Json<EventInput>) -> AppResult<Json<Value>> {
    let access = Access::load(&state.db, user, id).await?.admin()?;
    b.validate()?;
    // Arşivleme ve arşivden çıkarma yalnızca sistem admininde.
    if let Some(status) = b.status.as_deref()
        && (status == "archived" || access.event_status == "archived")
        && !user.is_system_admin
    {
        return Err(AppError::Forbidden);
    }
    let mut tx = state.db.begin().await?;
    let changed = sqlx::query(
        "update events set
            name = coalesce($2, name), description = coalesce($3, description), image_url = coalesce($4, image_url),
            starts_at = coalesce($5, starts_at), ends_at = coalesce($6, ends_at), timezone = coalesce($7, timezone),
            country = coalesce($8, country), city = coalesce($9, city), region = coalesce($10, region),
            center_lat = coalesce($11, center_lat), center_lon = coalesce($12, center_lon),
            visibility = coalesce($13, visibility), status = coalesce($14, status),
            applications_open_at = coalesce($15, applications_open_at),
            applications_close_at = coalesce($16, applications_close_at),
            applications_closed = coalesce($17, applications_closed),
            contact = coalesce($18, contact), rules_md = coalesce($19, rules_md),
            settings = coalesce($20, settings), updated_at = now()
         where id = $1 and coalesce($6, ends_at) > coalesce($5, starts_at)",
    )
    .bind(id)
    .bind(b.name.as_deref().map(str::trim))
    .bind(&b.description)
    .bind(&b.image_url)
    .bind(b.starts_at)
    .bind(b.ends_at)
    .bind(&b.timezone)
    .bind(&b.country)
    .bind(&b.city)
    .bind(&b.region)
    .bind(b.center_lat)
    .bind(b.center_lon)
    .bind(&b.visibility)
    .bind(&b.status)
    .bind(b.applications_open_at)
    .bind(b.applications_close_at)
    .bind(b.applications_closed)
    .bind(&b.contact)
    .bind(&b.rules_md)
    .bind(&b.settings)
    .execute(&mut *tx)
    .await?;
    if changed.rows_affected() == 0 {
        return Err(invalid("ends_at must be after starts_at"));
    }
    let mut pending = None;
    if let Some(status) = b.status.as_deref().filter(|s| *s != access.event_status) {
        // Etkinlik aktif olmaktan çıkınca açık takip oturumları kapanır: konum paylaşımı etkinlikle biter.
        if access.event_status == "active" {
            sqlx::query(
                "update tracking_sessions set ended_at = now(), end_reason = 'event_ended'
                 where event_id = $1 and ended_at is null",
            )
            .bind(id)
            .execute(&mut *tx)
            .await?;
        }
        oplog::audit(&mut tx, user.id, Some(id), "event.status", Some(("event", id)), json!({ "from": access.event_status, "to": status }))
            .await?;
        pending = Some(oplog::record(&mut tx, id, "event.status", Some(user.id), None, json!({ "status": status })).await?);
    } else {
        oplog::audit(&mut tx, user.id, Some(id), "event.update", Some(("event", id)), json!({})).await?;
    }
    tx.commit().await?;
    if let Some(p) = pending {
        p.publish(&state).await;
    }
    detail_json(&state, id, Some(user)).await.map(Json)
}

async fn detail_json(state: &AppState, id: Uuid, user: Option<AuthUser>) -> AppResult<Value> {
    let (uid, sysadmin) = user.map(|u| (Some(u.id), u.is_system_admin)).unwrap_or((None, false));
    let v: Option<Value> = sqlx::query_scalar(
        "with me as (
            select m.role, m.bib, m.is_available, m.vehicle_id from event_members m
            where m.event_id = $1 and m.user_id = $2 and m.status = 'active')
         select to_jsonb(e) - 'invite_code'::text - 'created_by'::text - 'settings'::text
            || jsonb_build_object(
                'membership', (select to_jsonb(me) from me),
                'application', (select jsonb_build_object('id', a.id, 'status', a.status, 'requested_role', a.requested_role)
                    from applications a where a.event_id = e.id and a.user_id = $2
                    order by a.created_at desc limit 1),
                'applications_open', (e.status in ('published', 'active') and not e.applications_closed
                    and (e.applications_open_at is null or e.applications_open_at <= now())
                    and (e.applications_close_at is null or e.applications_close_at > now())),
                'points', coalesce((select jsonb_agg(to_jsonb(p) - 'event_id'::text order by p.kind, p.name)
                    from event_points p where p.event_id = e.id), '[]'::jsonb),
                'zones', coalesce((select jsonb_agg(to_jsonb(z) - 'event_id'::text order by z.name)
                    from event_zones z where z.event_id = e.id), '[]'::jsonb),
                'vehicles', coalesce((select jsonb_agg(to_jsonb(v) - 'event_id'::text order by v.name)
                    from vehicles v where v.event_id = e.id), '[]'::jsonb),
                'member_count', (select count(*) from event_members m where m.event_id = e.id and m.status = 'active'))
            || case when $3 or exists(select 1 from me where role = 'event_admin')
                    then jsonb_build_object('invite_code', e.invite_code, 'settings', e.settings)
                    else '{}'::jsonb end
         from events e
         where e.id = $1
           and ($3 or exists(select 1 from me) or (e.status <> 'draft' and (e.visibility = 'public'
                or exists(select 1 from applications a where a.event_id = e.id and a.user_id = $2))))",
    )
    .bind(id)
    .bind(uid)
    .bind(sysadmin)
    .fetch_optional(&state.db)
    .await?;
    v.ok_or(AppError::NotFound)
}

async fn detail(State(state): State<AppState>, MaybeUser(user): MaybeUser, Path(id): Path<Uuid>) -> AppResult<Json<Value>> {
    detail_json(&state, id, user).await.map(Json)
}

// ── Harita noktaları, bölgeler, araçlar ────────────────────────────────────

#[derive(Deserialize)]
struct PointInput {
    kind: String,
    name: String,
    lat: f64,
    lon: f64,
    altitude_m: Option<f32>,
    #[serde(default)]
    description: String,
    #[serde(default)]
    instructions: String,
}

async fn add_point(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(b): Json<PointInput>,
) -> AppResult<Json<Value>> {
    Access::load(&state.db, user, id).await?.admin()?;
    if !matches!(b.kind.as_str(), "takeoff" | "landing" | "alt_landing" | "emergency_landing" | "meeting" | "hazard") {
        return Err(invalid("invalid point kind"));
    }
    if b.name.trim().is_empty() || !(-90.0..=90.0).contains(&b.lat) || !(-180.0..=180.0).contains(&b.lon) {
        return Err(invalid("name and valid coordinates are required"));
    }
    let pid = Uuid::now_v7();
    sqlx::query(
        "insert into event_points (id, event_id, kind, name, lat, lon, altitude_m, description, instructions)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    )
    .bind(pid)
    .bind(id)
    .bind(&b.kind)
    .bind(b.name.trim())
    .bind(b.lat)
    .bind(b.lon)
    .bind(b.altitude_m)
    .bind(&b.description)
    .bind(&b.instructions)
    .execute(&state.db)
    .await?;
    Ok(Json(json!({ "id": pid })))
}

async fn delete_point(State(state): State<AppState>, user: AuthUser, Path((id, point_id)): Path<(Uuid, Uuid)>) -> AppResult<Json<Value>> {
    Access::load(&state.db, user, id).await?.admin()?;
    sqlx::query("delete from event_points where id = $1 and event_id = $2").bind(point_id).bind(id).execute(&state.db).await?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
struct ZoneInput {
    kind: String,
    name: String,
    geojson: Value,
}

async fn add_zone(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>, Json(b): Json<ZoneInput>) -> AppResult<Json<Value>> {
    Access::load(&state.db, user, id).await?.admin()?;
    if !matches!(b.kind.as_str(), "boundary" | "hazard" | "flight_area") {
        return Err(invalid("invalid zone kind"));
    }
    let geometry_type = b.geojson.get("type").and_then(Value::as_str).unwrap_or("");
    if b.name.trim().is_empty() || !matches!(geometry_type, "Polygon" | "MultiPolygon") {
        return Err(invalid("name and a Polygon/MultiPolygon geometry are required"));
    }
    let zid = Uuid::now_v7();
    sqlx::query("insert into event_zones (id, event_id, kind, name, geojson) values ($1, $2, $3, $4, $5)")
        .bind(zid)
        .bind(id)
        .bind(&b.kind)
        .bind(b.name.trim())
        .bind(&b.geojson)
        .execute(&state.db)
        .await?;
    Ok(Json(json!({ "id": zid })))
}

async fn delete_zone(State(state): State<AppState>, user: AuthUser, Path((id, zone_id)): Path<(Uuid, Uuid)>) -> AppResult<Json<Value>> {
    Access::load(&state.db, user, id).await?.admin()?;
    sqlx::query("delete from event_zones where id = $1 and event_id = $2").bind(zone_id).bind(id).execute(&state.db).await?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
struct VehicleInput {
    name: String,
    plate: Option<String>,
    capacity: Option<i16>,
}

async fn add_vehicle(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(b): Json<VehicleInput>,
) -> AppResult<Json<Value>> {
    Access::load(&state.db, user, id).await?.admin()?;
    let capacity = b.capacity.unwrap_or(4);
    if b.name.trim().is_empty() || !(1..=60).contains(&capacity) {
        return Err(invalid("name is required and capacity must be 1-60"));
    }
    let vid = Uuid::now_v7();
    sqlx::query("insert into vehicles (id, event_id, name, plate, capacity) values ($1, $2, $3, $4, $5)")
        .bind(vid)
        .bind(id)
        .bind(b.name.trim())
        .bind(&b.plate)
        .bind(capacity)
        .execute(&state.db)
        .await?;
    Ok(Json(json!({ "id": vid })))
}

async fn delete_vehicle(
    State(state): State<AppState>,
    user: AuthUser,
    Path((id, vehicle_id)): Path<(Uuid, Uuid)>,
) -> AppResult<Json<Value>> {
    Access::load(&state.db, user, id).await?.admin()?;
    sqlx::query("delete from vehicles where id = $1 and event_id = $2").bind(vehicle_id).bind(id).execute(&state.db).await?;
    Ok(Json(json!({ "ok": true })))
}

// ── Üyeler ─────────────────────────────────────────────────────────────────

/// Üye listesi. Telefon ve acil durum bilgisi yalnızca yetkililere (admin/observer) ve
/// retriever'lara görünür; pilotlar birbirinin iletişim bilgisini görmez.
async fn members(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Value>> {
    let access = Access::load(&state.db, user, id).await?.member()?;
    let contact = access.is_staff() || access.role == Some(Role::Retriever);
    let v: Value = sqlx::query_scalar(
        "select coalesce(jsonb_agg(jsonb_build_object(
            'user_id', u.id, 'first_name', u.first_name, 'last_name', u.last_name, 'avatar_url', u.avatar_url,
            'country', u.country, 'role', m.role, 'bib', m.bib, 'vehicle_id', m.vehicle_id,
            'is_available', m.is_available, 'joined_at', m.joined_at)
            || case when $2 then jsonb_build_object('phone', u.phone) else '{}'::jsonb end
            || case when $3 then jsonb_build_object('email', u.email,
                'emergency_contact_name', u.emergency_contact_name,
                'emergency_contact_phone', u.emergency_contact_phone) else '{}'::jsonb end
            order by m.role, u.first_name, u.last_name), '[]'::jsonb)
         from event_members m join users u on u.id = m.user_id
         where m.event_id = $1 and m.status = 'active'",
    )
    .bind(id)
    .bind(contact)
    .bind(access.is_staff())
    .fetch_one(&state.db)
    .await?;
    Ok(Json(json!({ "data": v })))
}

#[derive(Deserialize)]
struct MemberInput {
    role: String,
    bib: Option<String>,
    vehicle_id: Option<Uuid>,
}

/// Üye ekle veya rolünü değiştir. Etkinlik admini atamak/kaldırmak yalnızca sistem admininde.
async fn set_member(
    State(state): State<AppState>,
    user: AuthUser,
    Path((id, target)): Path<(Uuid, Uuid)>,
    Json(b): Json<MemberInput>,
) -> AppResult<Json<Value>> {
    Access::load(&state.db, user, id).await?.admin()?;
    let role = Role::parse(&b.role).ok_or_else(|| invalid("invalid role"))?;
    let mut tx = state.db.begin().await?;
    let current: Option<(String, String)> =
        sqlx::query_as("select role, status from event_members where event_id = $1 and user_id = $2 for update")
            .bind(id)
            .bind(target)
            .fetch_optional(&mut *tx)
            .await?;
    let was_admin = matches!(&current, Some((r, s)) if r == "event_admin" && s == "active");
    if (role == Role::EventAdmin || was_admin) && !user.is_system_admin {
        return Err(AppError::Forbidden);
    }
    let exists: bool = sqlx::query_scalar("select exists(select 1 from users where id = $1 and deleted_at is null)")
        .bind(target)
        .fetch_one(&mut *tx)
        .await?;
    if !exists {
        return Err(AppError::NotFound);
    }
    if let Some((old, _)) = &current
        && old != &b.role
    {
        close_operations(&mut tx, id, target, "left_event").await?;
    }
    sqlx::query(
        "insert into event_members (event_id, user_id, role, bib, vehicle_id) values ($1, $2, $3, $4, $5)
         on conflict (event_id, user_id) do update set
            role = excluded.role, status = 'active', bib = coalesce(excluded.bib, event_members.bib),
            vehicle_id = excluded.vehicle_id,
            is_available = event_members.is_available and excluded.role = 'retriever', updated_at = now()",
    )
    .bind(id)
    .bind(target)
    .bind(&b.role)
    .bind(&b.bib)
    .bind(b.vehicle_id)
    .execute(&mut *tx)
    .await?;
    oplog::audit(
        &mut tx,
        user.id,
        Some(id),
        "member.set",
        Some(("user", target)),
        json!({ "role": b.role, "previous": current.as_ref().map(|c| &c.0) }),
    )
    .await?;
    oplog::notify(&mut tx, target, Some(id), "member.role", false, json!({ "role": b.role })).await?;
    let pending = oplog::record(&mut tx, id, "member.updated", Some(user.id), Some(target), json!({ "role": b.role })).await?;
    tx.commit().await?;
    pending.publish(&state).await;
    Ok(Json(json!({ "ok": true })))
}

/// Üyelik bitince veya rol değişince kullanıcının açık operasyonlarını kapat.
async fn close_operations(tx: &mut sqlx::Transaction<'_, sqlx::Postgres>, event_id: Uuid, user_id: Uuid, reason: &str) -> AppResult<()> {
    sqlx::query("update tracking_sessions set ended_at = now(), end_reason = $3 where event_id = $1 and user_id = $2 and ended_at is null")
        .bind(event_id)
        .bind(user_id)
        .bind(reason)
        .execute(&mut **tx)
        .await?;
    sqlx::query(
        "update retrieve_requests set status = 'cancelled', cancelled_at = now(), cancel_reason = 'pilot_left'
         where event_id = $1 and pilot_id = $2 and status in ('open', 'assigned', 'arrived')",
    )
    .bind(event_id)
    .bind(user_id)
    .execute(&mut **tx)
    .await?;
    // Retriever ayrılırsa henüz alınmamış pilotların talepleri yeniden açılır.
    sqlx::query(
        "update retrieve_requests set status = 'open', retriever_id = null, vehicle_id = null, assigned_by = null,
            assigned_at = null, arrived_at = null
         where event_id = $1 and retriever_id = $2 and status in ('assigned', 'arrived')",
    )
    .bind(event_id)
    .bind(user_id)
    .execute(&mut **tx)
    .await?;
    sqlx::query("update flights set status = 'cancelled' where event_id = $1 and pilot_id = $2 and status = 'preparing'")
        .bind(event_id)
        .bind(user_id)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

async fn end_membership(state: &AppState, event_id: Uuid, actor: AuthUser, target: Uuid, status: &str) -> AppResult<Json<Value>> {
    let mut tx = state.db.begin().await?;
    // Araçta pilot varken retriever; araçtayken pilot ayrılamaz: önce görev tamamlanmalı.
    let busy: bool = sqlx::query_scalar(
        "select exists(select 1 from retrieve_requests where event_id = $1 and status = 'picked_up'
            and (pilot_id = $2 or retriever_id = $2))",
    )
    .bind(event_id)
    .bind(target)
    .fetch_one(&mut *tx)
    .await?;
    if busy {
        return Err(AppError::Conflict("ACTIVE_OPERATION", "complete the active retrieve before leaving the event"));
    }
    let changed = sqlx::query(
        "update event_members set status = $3, is_available = false, updated_at = now()
         where event_id = $1 and user_id = $2 and status = 'active'",
    )
    .bind(event_id)
    .bind(target)
    .bind(status)
    .execute(&mut *tx)
    .await?;
    if changed.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    close_operations(&mut tx, event_id, target, "left_event").await?;
    oplog::audit(
        &mut tx,
        actor.id,
        Some(event_id),
        if status == "left" { "member.leave" } else { "member.remove" },
        Some(("user", target)),
        json!({}),
    )
    .await?;
    let pending = oplog::record(&mut tx, event_id, "member.removed", Some(actor.id), Some(target), json!({})).await?;
    tx.commit().await?;
    pending.publish(state).await;
    state.hub.kick(event_id, target).await;
    let mut redis = state.redis.clone();
    let _: Result<(), _> = redis::AsyncCommands::hdel(&mut redis, format!("live:{event_id}"), target.to_string()).await;
    Ok(Json(json!({ "ok": true })))
}

async fn remove_member(State(state): State<AppState>, user: AuthUser, Path((id, target)): Path<(Uuid, Uuid)>) -> AppResult<Json<Value>> {
    Access::load(&state.db, user, id).await?.admin()?;
    let is_admin_target: bool =
        sqlx::query_scalar("select exists(select 1 from event_members where event_id = $1 and user_id = $2 and role = 'event_admin')")
            .bind(id)
            .bind(target)
            .fetch_one(&state.db)
            .await?;
    if is_admin_target && !user.is_system_admin {
        return Err(AppError::Forbidden);
    }
    end_membership(&state, id, user, target, "removed").await
}

async fn leave(State(state): State<AppState>, user: AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Value>> {
    end_membership(&state, id, user, user.id, "left").await
}

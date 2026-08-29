# Database schema

PostgreSQL 15 + PostGIS. All application objects live in `public`. Geometry is
stored as `geography(Point, 4326)` for measurements in meters; zone shapes are
stored as raw GeoJSON (`jsonb`) because they are drawn and rendered as GeoJSON
and never queried spatially.

## Entity relationship overview

```
auth.users 1─1 profiles
profiles ─┬─< event_members >─ events
          ├─< participation_requests >─ events
          ├─< tasks >─ events                      (pilot flights)
          ├─< retriever_sessions >─ events         (duty periods)
          ├─1 retriever_profiles (per event)       (capacity + last position)
          ├─< devices
          └─< notifications
tasks ──< location_points >── retriever_sessions   (exactly one parent each)
tasks ──< retrieval_requests (60 s offers) ──1 retrieval_assignments
events ──< geo_zones, emergency_events, audit_logs
```

## Tables

### `profiles`
1:1 with `auth.users` (created by trigger on signup). Holds `display_name`,
`avatar_url`, `phone`, `locale`, and the global `is_system_admin` flag (only
settable via the service role).

### `events`
`name, description, starts_at, ends_at, visibility(public|unlisted|private),
invite_code (unique, hidden from clients), settings jsonb, is_archived`.
Settings is a free-form bag for event options (timezone, languages…).

### `event_members`
One row per **(event, user, role)** — a user can hold multiple roles in one
event and different roles across events. Roles: `pilot`, `retriever`,
`observer`, `event_admin`.

### `participation_requests`
`requested_role`, free-text message, `status(pending|approved|rejected|
cancelled)` + decision metadata. Partial unique index: only one *pending*
request per (event, user, role). Approval creates the membership atomically
(`decide_participation`).

### `geo_zones`
GeoJSON map objects drawn by event admins: `zone_type(takeoff|landing|
restricted|checkpoint|custom)`, `geometry` (GeoJSON geometry object),
`properties` (style/ops metadata such as `radius_m`, altitude limits).

### `tasks` (flights)
`status(active|landed|completed|cancelled)` with timestamps per transition and
`cancelled_reason`. Partial unique index enforces **one open task per pilot
per event** (`active` or `landed`). Every task owns an independent track.

### `location_points`
The high-volume table. PK is a **client-generated UUID** → batched uploads are
idempotent (`on conflict do nothing`). Each point references exactly one of
`task_id` (pilot) or `retriever_session_id` (retriever breadcrumb) — enforced
by a CHECK. Payload: `recorded_at, geom, altitude_m, heading_deg, speed_mps,
h_accuracy_m, v_accuracy_m, battery_pct, tracking_state(foreground|background|
low_power|paused)`. Ingestion goes through `ingest_location_points(jsonb)`
which validates ownership per point and drops anything unauthorized.

An `AFTER INSERT` trigger mirrors retriever breadcrumbs into
`retriever_profiles.last_geom/last_seen_at` for cheap nearest-neighbor
queries.

### `retriever_profiles`
Per (event, user): `availability(offline|available|busy)`, `vehicle_capacity`,
`occupied_seats` (derived — trigger recomputes from assignments in
`picked_up`), `vehicle_description`, `last_geom`, `last_seen_at`.

### `retriever_sessions`
Duty periods (`started_at`/`ended_at`); partial unique index allows one open
session per retriever per event. Breadcrumbs attach to the session.

### `retrieval_requests`
A pilot's offer to one retriever: `status(pending|accepted|declined|expired|
cancelled)`, `expires_at = now() + 60s`. One pending request per task
(partial unique). Expiry is lazy (checked on respond/re-request) plus a
`pg_cron` sweep when available.

### `retrieval_assignments`
The actual job: `status(assigned|en_route|picked_up|delivered|completed|
cancelled)` with a timestamp per stage. Created by acceptance or by an
observer's manual dispatch (`assigned_by`). One active assignment per task
(partial unique). Completing a job auto-completes a `landed` task.

### `emergency_events`
`geom` (last known point), message, `status(open|acknowledged|resolved)` with
acknowledger/resolver audit fields.

### `devices` / `notifications`
APNs push tokens per user; in-app notification feed (used by the emergency
fanout, extensible to other types).

### `audit_logs`
Append-only, written exclusively by SECURITY DEFINER RPCs via `log_audit()`:
actor, event, `action` (dot-namespaced, e.g. `retrieval.dispatched`), entity
ref and payload.

## Key invariants (enforced in the database)

| Invariant | Mechanism |
|---|---|
| one open task per pilot per event | partial unique index |
| one pending retrieval request per task | partial unique index |
| one active assignment per task | partial unique index |
| one open duty session per retriever per event | partial unique index |
| point belongs to exactly one of task/session | CHECK `num_nonnulls(...) = 1` |
| occupied seats = pax currently in vehicle | trigger on assignment status |
| valid state transitions only | RPC guard clauses (`transition_task`, `advance_assignment`, …) |
| idempotent point ingestion | client UUID PK + `on conflict do nothing` |

# Retfast API Contract v1 (authoritative)

This document is the coordination contract between `services/api`, `apps/web` and `apps/ios`.
The machine-readable form is `packages/api-contract/openapi.yaml` (OpenAPI 3.1), kept in sync by the backend.
If the two disagree, fix the code to match this document or change both in the same commit.

Base URL: production `https://api.retfast.com/api/v1`, local `http://localhost:8080/api/v1`
(the web dev server proxies `/api` to `localhost:8080`).

## Conventions

- JSON, UTF-8, `snake_case` fields. Timestamps are RFC 3339 UTC strings with milliseconds (`2026-11-04T12:00:00.123Z`).
- IDs are UUIDs (strings). Client-generated IDs (flights, samples, incidents, batches) are UUIDv4/v7 and make creation idempotent.
- Coordinates: `lat`, `lon` in WGS84 decimal degrees; altitudes in metres (GPS/ellipsoid-derived as reported by Core Location `altitude`, labelled `gps_alt_m`); speeds m/s; course/heading degrees 0–360 (null if invalid); accuracies metres.
- Pagination: `?limit=` (default 50, max 200) and `?cursor=` (opaque). Response `{ "items": [...], "next_cursor": "..." | null }`.
- Errors: HTTP status + body
  ```json
  { "error": { "code": "validation_failed", "message": "Human readable", "details": { "field": "reason" } } }
  ```
  Codes: `validation_failed`(400/422), `unauthorized`(401), `token_expired`(401), `password_change_required`(403), `forbidden`(403), `not_found`(404), `conflict`(409), `rate_limited`(429, with `Retry-After`), `internal`(500), `unavailable`(503).
- Auth header: `Authorization: Bearer <access_token>`.
- Every response carries `X-Request-Id`.

## Roles

Global roles (a user may hold several): `pilot`, `observer`, `event_organizer`, `rescue_operator`, `platform_admin`. `guest` = unauthenticated.
Per-event roles: `organizer`, `participant`, `observer` (table-backed). Global `event_organizer` or `platform_admin` may create events; the creator becomes the event's organizer.

## Auth — `/auth`

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/auth/register` | `{email, password, full_name}` | `201 AuthResponse` (roles `[pilot]`) |
| POST | `/auth/login` | `{email, password, client: "web"\|"ios", device_name?}` | `200 AuthResponse` |
| POST | `/auth/refresh` | `{refresh_token?}` (iOS sends it; web uses the cookie) | `200 AuthResponse` (rotated) |
| POST | `/auth/logout` | `{refresh_token?}` | `204` (revokes the session) |
| POST | `/auth/password/change` | `{current_password, new_password}` | `200 AuthResponse` (clears `must_change_password`, revokes other sessions) |
| POST | `/auth/password/forgot` | `{email}` | `202` always (no account enumeration) |
| POST | `/auth/password/reset` | `{token, new_password}` | `204` |
| POST | `/auth/email/verify` | `{token}` | `204` |
| POST | `/auth/email/verify/resend` | — (auth) | `202` |

```json
AuthResponse = {
  "access_token": "jwt", "access_expires_at": "...", "refresh_token": "opaque (omitted for client=web)",
  "refresh_expires_at": "...", "user": Me
}
```

- Access token: JWT HS256, 15 min. Refresh token: opaque, 30 days, rotated on every refresh; reuse of a rotated token revokes the whole session family.
- Web: refresh token is set as cookie `rf_refresh` (`HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth`). The web client keeps the access token in memory only and calls `/auth/refresh` with `credentials: "include"` on boot and on `token_expired`.
- Password policy: ≥ 10 chars, not equal to email, not in a small common-password list, not the bootstrap password. Error `validation_failed` with `details.new_password`.
- When `user.must_change_password` is true, every authenticated endpoint except `GET /me`, `/auth/password/change`, `/auth/logout`, `/auth/refresh` returns `403 password_change_required`. Clients must route to a "set new password" screen.
- Rate limits: login 5/min per IP+email and 20/min per IP; register/forgot 5/min per IP.

## Me / users

```json
Me = {
  "id": "uuid", "email": "...", "email_verified": true, "full_name": "...", "roles": ["pilot","platform_admin"],
  "must_change_password": false, "created_at": "...",
  "pilot": PilotProfile | null,
  "preferences": { "units": "metric"|"imperial", "default_flight_visibility": "private"|"event"|"public", "public_profile": false }
}
PilotProfile = {
  "public_id": "short slug", "display_name": "...", "bio": "", "wing": "", "license_no": "",
  "nationality": "TR", "emergency_contact_name": "", "emergency_contact_phone": "", "blood_type": ""
}
```

| Method | Path | Notes |
|---|---|---|
| GET | `/me` | `Me` |
| PATCH | `/me` | `{full_name?, preferences?}` |
| PATCH | `/me/pilot` | partial `PilotProfile` (not `public_id`) |
| POST | `/me/deletion-request` | `{reason?}` → `202 {status:"pending", requested_at}`; account is deactivated after 14 days unless cancelled |
| DELETE | `/me/deletion-request` | cancel |
| GET | `/me/export` | JSON export of own data (profile, flights, positions) |
| POST | `/me/devices` | `{device_id, platform:"ios", apns_token?, app_version, os_version}` → `204` (upsert) |
| GET | `/pilots/{public_id}` | public pilot profile — only if `public_profile`; never returns contact/emergency/license fields |
| GET | `/pilots` | organizer/admin: list `{id, full_name, public_id, roles}` (search `?q=`) |

## Events

```json
Event = {
  "id": "uuid", "slug": "cameli-paragliding-demo", "name": "...", "description": "...",
  "kind": "paragliding", "status": "draft"|"published"|"active"|"completed"|"archived",
  "is_demo": true, "visibility": "public"|"restricted",
  "location_name": "Çameli, Denizli, Türkiye", "center": {"lat":..,"lon":..} | null, "center_is_approximate": true,
  "starts_at": "...", "ends_at": "...", "cover_image_url": null,
  "settings": { "registration_open": true, "live_tracking": true, "flight_recording": true,
                "observers_allowed": true, "emergency_testing": true, "public_live_map": true },
  "organizer": {"id": "...", "full_name": "..."}, "participant_count": 3,
  "my_role": "organizer"|"participant"|"observer"|null, "created_at": "...", "updated_at": "..."
}
LaunchSite = { "id","event_id","name","position": {"lat","lon"} | null, "elevation_m": null, "notes": "", "is_verified": false }
Participant = { "user_id","full_name","public_id","role":"organizer"|"participant"|"observer","status":"active"|"removed","joined_at" }
```

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/events` | optional | public events for guests; plus restricted events the caller belongs to. Filters `?status=active,published&q=&from=&to=&near=lat,lon&radius_km=` |
| POST | `/events` | event_organizer/admin | create; `slug` generated from name if absent |
| GET | `/events/{id_or_slug}` | optional | restricted → 404 for non-members |
| PATCH | `/events/{id}` | event organizer/admin | partial update incl. `settings` |
| POST | `/events/{id}/archive` | event organizer/admin | |
| GET | `/events/{id}/participants` | members (organizers see all incl. removed) | `{items:[Participant]}` |
| POST | `/events/{id}/join` | pilot | public + registration_open, or restricted with organizer add |
| POST | `/events/{id}/leave` | member | |
| POST | `/events/{id}/participants` | organizer/admin | `{user_id, role}` |
| PATCH/DELETE | `/events/{id}/participants/{user_id}` | organizer/admin | change role / remove |
| GET/POST | `/events/{id}/launch-sites` | read: as event; write: organizer | |
| PATCH/DELETE | `/events/{id}/launch-sites/{site_id}` | organizer | |
| GET | `/events/{id}/live` | see "Live visibility" | snapshot, see below |
| GET | `/events/{id}/report` | organizer/admin | participation, flight count, durations, telemetry completeness, interruptions |

## Flights

```json
Flight = {
  "id": "uuid (client-generated)", "public_id": "short", "pilot": {"user_id","full_name","public_id"},
  "event_id": "uuid"|null, "status": "recording"|"ended"|"abandoned",
  "visibility": "private"|"event"|"public", "is_simulated": false,
  "started_at": "...", "ended_at": null, "last_position": Position | null, "last_received_at": "...",
  "stats": { "duration_s": 0, "distance_m": 0, "max_gps_alt_m": null, "min_gps_alt_m": null,
             "max_ground_speed_ms": null, "total_ascent_m": 0, "total_descent_m": 0,
             "sample_count": 0, "expected_sample_count": 0, "gap_count": 0 },
  "device": {"platform":"ios","app_version":"..."} 
}
Position = { "id": "uuid", "seq": 0, "t": "recorded (GPS) time", "received_at": "...", "lat", "lon",
             "gps_alt_m": null, "h_acc_m": 5.0, "v_acc_m": null, "speed_ms": null, "course_deg": null }
```

| Method | Path | Notes |
|---|---|---|
| POST | `/flights` | `{id, event_id?, started_at, visibility, is_simulated?, device: {...}}` → `201 Flight` or `200 Flight` if `id` already exists for this pilot (idempotent). `409` if the id belongs to someone else. Requires event membership + `live_tracking` when `event_id` set. |
| GET | `/flights` | own flights; `?pilot_id=` (organizer/admin within their events), `?event_id=`, `?status=` |
| GET | `/flights/{id_or_public_id}` | per "Flight visibility" |
| PATCH | `/flights/{id}` | owner: `{visibility?, event_id?}` |
| POST | `/flights/{id}/end` | owner: `{ended_at}` → final stats (idempotent) |
| GET | `/flights/{id}/positions` | `?after_seq=&limit=` (max 5000) and `?simplify=true` for route display; returns `{items:[Position], next_cursor}` |
| GET | `/flights/{id}/track.gpx` | GPX 1.1 (not a certified log) |

## Telemetry ingestion

`POST /telemetry/batches` (auth: the flight owner)

```json
{
  "batch_id": "uuid", "flight_id": "uuid",
  "samples": [
    { "id": "uuid", "seq": 41, "t": "2026-11-04T10:00:01.000Z", "device_t": "2026-11-04T10:00:01.050Z",
      "lat": 37.07, "lon": 29.34, "gps_alt_m": 2105.2, "h_acc_m": 4.7, "v_acc_m": 3.1,
      "speed_ms": 9.8, "course_deg": 212.4, "meta": { "profile": "cruise", "battery": 0.71, "low_power": false } }
  ]
}
```

- 1–500 samples per batch; body ≤ 512 KB (gzip `Content-Encoding` accepted).
- Response `200`:
  ```json
  { "batch_id": "...", "accepted": [41, 42], "duplicate": [40], "rejected": [{"seq": 43, "reason": "invalid_coordinates"}],
    "max_acked_seq": 42, "server_time": "..." }
  ```
  A sample is **acknowledged** if it is in `accepted` or `duplicate`; both are durable in PostgreSQL when the response is sent. The client may mark only those `synced`. `rejected` samples are permanent failures (client marks them `rejected`, keeps them locally, never retries).
- Rejection reasons: `invalid_coordinates`, `invalid_accuracy` (h_acc ≤ 0 or > 10 000), `timestamp_out_of_range` (t > server_now + 10 min or before flight `started_at` − 1 h), `flight_ended` (t > ended_at + 10 min), `invalid_speed`.
- Out-of-order and late batches are accepted; ordering is by `seq` then `t`.
- Re-sending the same `batch_id` returns the same classification (idempotent).
- `401 token_expired` → client refreshes and retries the same batch. `429` → honour `Retry-After`.

Position processing: originals are stored as received. Server-side stats skip samples with `h_acc_m > 50`.

## Live data

`GET /events/{id}/live` →
```json
{ "event_id": "...", "server_time": "...", "cursor": "redis-stream-id",
  "pilots": [ { "flight_id","pilot":{"user_id","full_name","public_id"},"is_simulated":false,
                "status":"recording","position": Position, "age_s": 3.2, "freshness": "live"|"stale"|"lost",
                "trail": [[lon,lat,gps_alt_m,t_unix_ms], ...] } ] }
```
- `freshness`: `live` < 30 s, `stale` 30 s – 5 min, `lost` > 5 min since last received position (recording flights only, plus ended flights from the last 2 h with `status:"ended"`).
- `trail`: last 15 minutes, simplified, max 300 points.

Live visibility:
- Guest / non-member on a `public` event with `public_live_map`: flights with `visibility = public` only; pilot shown by `display_name`/`public_id`; never contact or emergency data.
- Event members (participant/observer/organizer): flights with `visibility` `event` or `public` linked to the event.
- Organizers, rescue_operators, platform_admin: all flights linked to the event (any visibility) — organizers see private ones only while an incident is open on them; otherwise `event|public`. Admin/rescue see all.
- Owners always see their own flights.

## Realtime WebSocket — `GET /realtime`

Connect `wss://api.retfast.com/api/v1/realtime`. Authenticate with the first message within 10 s (guests may skip and only subscribe to public channels):

Client → server
```json
{ "type": "auth", "access_token": "..." }
{ "type": "subscribe", "channel": "event:<uuid>", "since": "<cursor>"? }
{ "type": "subscribe", "channel": "flight:<uuid>", "since": "<cursor>"? }
{ "type": "subscribe", "channel": "incidents" }            // rescue_operator, platform_admin, event organizers (scoped)
{ "type": "unsubscribe", "channel": "..." }
{ "type": "ping" }
```
Server → client
```json
{ "type": "auth_ok", "user_id": "..." }
{ "type": "subscribed", "channel": "...", "snapshot": <same shape as /events/{id}/live or Flight> , "cursor": "..." }
{ "type": "position", "channel": "event:<id>", "cursor": "...", "data": { "flight_id", "pilot", "is_simulated", "position": Position } }
{ "type": "flight", "channel": "...", "cursor": "...", "data": Flight }          // started/ended/visibility changed
{ "type": "incident", "channel": "incidents", "cursor": "...", "data": Incident }
{ "type": "error", "code": "forbidden"|"unknown_channel"|"unauthorized", "channel": "..." }
{ "type": "ping" } / { "type": "pong" }
```
- Server sends `ping` every 25 s; clients reply `pong`; a connection silent for 60 s is closed.
- `since`: if the cursor is still in the server's replay window (Redis stream, ~10 min), missed events are replayed; otherwise a fresh `snapshot` is sent. Clients must always treat `subscribed.snapshot` as the source of truth.
- Per-connection outbound queue is bounded (256 messages). A slow consumer is disconnected with close code `4008`; the client reconnects and resubscribes.
- Close codes: `4001` unauthorized, `4008` slow consumer, `1012` server restart. Clients reconnect with exponential backoff (1 s → 30 s, jitter) and resubscribe with their last cursor.
- Authorization is checked at subscribe time and filtered per message (visibility can change).

## Incidents (emergency)

```json
Incident = {
  "id": "uuid (client-generated)", "kind": "sos", "is_test": false,
  "status": "open"|"acknowledged"|"responding"|"resolved"|"cancelled",
  "pilot": {"user_id","full_name","public_id","emergency_contact_name","emergency_contact_phone","blood_type"},  // contact fields only for authorized responders
  "flight_id": "uuid"|null, "event_id": "uuid"|null,
  "position": {"lat","lon","gps_alt_m","h_acc_m","t"} | null, "last_known_position": Position | null,
  "message": "", "created_at_device": "...", "received_at": "...",
  "acknowledged_at": null, "acknowledged_by": {"user_id","full_name"} | null,
  "resolved_at": null, "assignments": [Assignment], "updates": [IncidentUpdate]
}
IncidentUpdate = { "id","kind":"created"|"acknowledged"|"status_changed"|"note"|"assigned"|"assignment_status"|"position","actor":{"user_id","full_name"}|null,"body":"","status":"...","created_at" }
Assignment = { "id","incident_id","responder":{"user_id","full_name"},"status":"assigned"|"en_route"|"on_scene"|"completed"|"withdrawn","assigned_at","updated_at","last_position": {"lat","lon","t"} | null }
```

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/incidents` | pilot | `{id, kind:"sos", is_test, flight_id?, position?, message?, created_at_device}` → `201`/`200` idempotent on `id`. `is_test:true` only allowed in events with `emergency_testing`. |
| GET | `/incidents` | pilot: own; responders: scoped | `?status=open,acknowledged,responding&event_id=` |
| GET | `/incidents/{id}` | owner or authorized responder | |
| POST | `/incidents/{id}/cancel` | owner | `{reason?}` → status `cancelled` |
| POST | `/incidents/{id}/acknowledge` | responder | sets `acknowledged` |
| POST | `/incidents/{id}/status` | responder | `{status:"responding"\|"resolved", note?}` |
| POST | `/incidents/{id}/notes` | responder | `{body}` |
| POST | `/incidents/{id}/assignments` | responder | `{responder_user_id}` |
| GET | `/rescue/assignments` | rescue_operator/admin | own assignments |
| POST | `/rescue/assignments/{id}/status` | assignee | `{status}` |
| PUT | `/rescue/me/status` | rescue_operator | `{availability:"available"\|"unavailable"}` |
| POST | `/rescue/me/position` | rescue_operator | `{lat, lon, h_acc_m, t}` (team positions on rescue map) |
| GET | `/rescue/team` | responder | `{items:[{user_id, full_name, availability, last_position, active_assignment}]}` |

Responder = `platform_admin`, `rescue_operator`, or organizer of the incident's event. Every responder action writes `audit_logs`.
Client-side SOS states (iOS) — `created_locally` → `pending_transmission` → `received_by_server` (HTTP 2xx) → `acknowledged` (incident `acknowledged_at` set, learned by polling `GET /incidents/{id}` every 10 s while open, or via push). The app never shows "help is coming" before `acknowledged`.

## Notifications

`GET /notifications` → `{items:[{id, kind:"event_update"|"flight"|"emergency_alert"|"rescue_ack"|"system", title, body, data, read_at, created_at}]}`; `POST /notifications/{id}/read`; `POST /notifications/read-all`.

## Admin — `/admin` (platform_admin)

`GET /admin/users?q=`, `PATCH /admin/users/{id}` `{roles?, disabled?}`, `POST /admin/users/{id}/reset-password` (sends reset email; returns `202`), `GET /admin/audit?actor_id=&action=&limit=`, `GET /admin/stats` (dashboard counters: active events, tracking pilots, stale sessions, open incidents, recent flights, system status).

## Health

`GET /health/live` → `200 {"status":"ok"}`; `GET /health/ready` → `200 {"status":"ok","checks":{"postgres":"ok","redis":"ok"}}` or `503`. `GET /metrics` (Prometheus) is served on the internal port only.

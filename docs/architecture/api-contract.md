# Retfast API Contract v1 (authoritative)

This document is the coordination contract between `services/api`, `apps/web` and `apps/ios`.
The machine-readable form is `packages/api-contract/openapi.yaml` (OpenAPI 3.1), kept in sync by the backend.
If the two disagree, fix the code to match this document or change both in the same commit.

Base URL: production `https://api.retfast.com/api/v1`, local `http://localhost:8080/api/v1`
(the web dev server proxies `/api` to `localhost:8080`).

## Conventions

- JSON, UTF-8, `snake_case` fields. Timestamps are RFC 3339 UTC strings with milliseconds (`2026-11-04T12:00:00.123Z`).
- IDs are UUIDs (strings). Client-generated IDs (flights, samples, retrievals, batches) are UUIDv4/v7 and make creation idempotent.
- Coordinates: `lat`, `lon` in WGS84 decimal degrees; altitudes in metres (GPS/ellipsoid-derived as reported by Core Location `altitude`, labelled `gps_alt_m`); speeds m/s; course/heading degrees 0–360 (null if invalid); accuracies metres.
- Pagination: `?limit=` (default 50, max 200) and `?cursor=` (opaque). Response `{ "items": [...], "next_cursor": "..." | null }`.
- Errors: HTTP status + body
  ```json
  { "error": { "code": "validation_failed", "message": "Human readable", "details": { "field": "reason" } } }
  ```
  Codes: `validation_failed`(400/422), `unauthorized`(401), `token_expired`(401), `password_change_required`(403), `forbidden`(403), `not_found`(404), `conflict`(409), `rate_limited`(429, with `Retry-After`), `internal`(500), `unavailable`(503).
- Auth header: `Authorization: Bearer <access_token>`.
- Every response carries `X-Request-Id`.

## Roles and the event workflow

Retfast is an **event tracking and pilot retrieval** platform, not an emergency/rescue service.

Global role: only `platform_admin` (a user may also have none). `guest` = unauthenticated.

Per-event roles:
- `organizer` — assigned by a platform admin. Manages the event, reviews applications, assigns member roles, sees everything in the event. An organizer can also hold a member role (e.g. also fly as `pilot`).
- Member role (exactly one per user per event): `pilot` | `observer` | `retriever`.

Workflow:
1. A platform admin creates the event and assigns one or more organizers.
2. Users apply to the event (`requested_role` is a wish). Organizers approve (choosing the final role: pilot, observer or retriever) or reject.
3. On the day: observers follow the event's live map (web). Pilots open the iOS app, pick the event, see the event map and start a flight; their live position appears for organizers and observers (and for other pilots of the event when `pilots_see_each_other`).
4. After landing the pilot requests a retrieve. Retrievers see open requests (pickup position, note, time) and accept one or several. Once accepted, the retriever sees that pilot's live position and phone; the pilot sees the retriever approaching. The retriever marks *picked up* and then *delivered*.

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
  "id": "uuid", "email": "...", "email_verified": true, "full_name": "...", "roles": ["platform_admin"],   // global roles only
  "must_change_password": false, "created_at": "...",
  "pilot": PilotProfile | null,
  "preferences": { "units": "metric"|"imperial", "public_profile": false }
}
PilotProfile = {
  "public_id": "short slug", "display_name": "...", "bio": "", "wing": "", "license_no": "",
  "nationality": "TR", "phone": "", "emergency_contact_name": "", "emergency_contact_phone": ""
}
// phone + emergency contact are visible only to the user, the event organizers, platform admins,
// and a retriever while they hold an accepted retrieval for this pilot.
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
| GET | `/users/search?q=` | organizer/admin: `{items:[{id, full_name, email, public_id}]}` (for adding organizers/members) |

## Events

```json
Event = {
  "id": "uuid", "slug": "cameli-paragliding-demo", "name": "...", "description": "...",
  "kind": "paragliding", "status": "draft"|"published"|"active"|"completed"|"archived",
  "is_demo": true, "visibility": "public"|"restricted",
  "location_name": "Çameli, Denizli, Türkiye", "center": {"lat":..,"lon":..} | null, "center_is_approximate": true,
  "starts_at": "...", "ends_at": "...", "cover_image_url": null,
  "settings": { "applications_open": true, "live_tracking": true, "public_live_map": false,
                "pilots_see_each_other": true, "landing_prompt": true },
  "organizers": [{"user_id","full_name"}],
  "counts": {"pilots": 0, "observers": 0, "retrievers": 0, "pending_applications": 0},   // pending only for organizers
  "me": { "is_organizer": false, "role": "pilot"|"observer"|"retriever"|null,
          "application": {"id","status":"pending"|"rejected"|"withdrawn","requested_role"} | null },
  "created_at": "...", "updated_at": "..."
}
LaunchSite = { "id","event_id","name","position": {"lat","lon"} | null, "elevation_m": null, "notes": "", "is_verified": false }
Member = { "user_id","full_name","public_id","role":"pilot"|"observer"|"retriever"|null,"is_organizer":bool,"status":"active"|"removed","joined_at",
           "phone": "" /* organizers only */ }
Application = { "id","event_id","user":{"user_id","full_name","email","public_id"},"requested_role":"pilot"|"observer"|"retriever",
                "message":"","status":"pending"|"approved"|"rejected"|"withdrawn","granted_role":null|"pilot"|"observer"|"retriever",
                "decided_by":{"user_id","full_name"}|null,"decision_note":"","created_at","decided_at" }
```

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/events` | optional | public events + restricted events where the caller is organizer/member. `?status=&q=&from=&to=&mine=true` |
| POST | `/events` | platform_admin | create; `slug` generated if absent |
| GET | `/events/{id_or_slug}` | optional | restricted → 404 for outsiders |
| PATCH | `/events/{id}` | organizer/admin | partial update incl. `settings` |
| POST | `/events/{id}/archive` | organizer/admin | |
| GET/POST | `/events/{id}/organizers` | read: members; write: admin | POST `{user_id}` |
| DELETE | `/events/{id}/organizers/{user_id}` | admin | |
| POST | `/events/{id}/applications` | any authenticated non-member | `{requested_role, message?}`; requires `applications_open`; one pending per user (409) |
| GET | `/events/{id}/applications` | organizer/admin | `?status=pending` → `{items:[Application]}` |
| POST | `/events/{id}/applications/{app_id}/approve` | organizer/admin | `{role, note?}` → creates/updates the membership |
| POST | `/events/{id}/applications/{app_id}/reject` | organizer/admin | `{note?}` |
| POST | `/events/{id}/applications/{app_id}/withdraw` | applicant | |
| GET | `/events/{id}/members` | organizer/admin: all; members: active members without phone | `?role=` → `{items:[Member]}` |
| POST | `/events/{id}/members` | organizer/admin | add directly `{user_id, role}` |
| PATCH/DELETE | `/events/{id}/members/{user_id}` | organizer/admin | change role / remove |
| POST | `/events/{id}/leave` | member | |
| GET/POST | `/events/{id}/launch-sites` | read: as event; write: organizer | |
| PATCH/DELETE | `/events/{id}/launch-sites/{site_id}` | organizer | |
| GET | `/events/{id}/live` | see "Live visibility" | snapshot |
| GET | `/events/{id}/report` | organizer/admin | members by role, flights, durations, telemetry completeness, interruptions, retrievals (count, median request→accept, accept→pickup, pickup→delivery) |

## Flights

```json
Flight = {
  "id": "uuid (client-generated)", "public_id": "short", "pilot": {"user_id","full_name","public_id"},
  "event_id": "uuid"|null, "status": "recording"|"ended"|"abandoned",
  "is_simulated": false,
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
| POST | `/flights` | `{id, event_id?, started_at, is_simulated?, device: {...}}` → `201 Flight` or `200 Flight` if `id` already exists for this pilot (idempotent). `409` if the id belongs to someone else. Requires the `pilot` role in the event + `live_tracking` when `event_id` set. A flight without an event is private to its pilot. |
| GET | `/flights` | own flights; `?pilot_id=` (organizer/admin within their events), `?event_id=`, `?status=` |
| GET | `/flights/{id_or_public_id}` | pilot; event organizers/observers; admin; guests only for `public_live_map` events |
| PATCH | `/flights/{id}` | owner: `{event_id?}` (only while recording) |
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

Live visibility (event flights only; taking part in an event means sharing flights with it — the app says so before the first flight):
- Organizers, observers, platform admins: all event flights.
- Pilots: their own flight, plus other pilots' flights when `pilots_see_each_other`.
- Retrievers: **not** the general live map. They see open retrieval requests (pickup position) and, for retrievals they accepted, the pilot's live position until delivery.
- Guests/outsiders: only when the event is `public` and `public_live_map` is on (positions and display names only).

The snapshot also contains `"retrievals": [Retrieval]` (open + last 2 h, filtered per role as in "Retrievals") and `"retrievers": [{user_id, full_name, on_duty, position, age_s, active_retrievals}]` (organizers/observers/admin; a pilot sees only the retriever who accepted them).

## Realtime WebSocket — `GET /realtime`

Connect `wss://api.retfast.com/api/v1/realtime`. Authenticate with the first message within 10 s (guests may skip and only subscribe to public channels):

Client → server
```json
{ "type": "auth", "access_token": "..." }
{ "type": "subscribe", "channel": "event:<uuid>", "since": "<cursor>"? }
{ "type": "subscribe", "channel": "flight:<uuid>", "since": "<cursor>"? }
{ "type": "subscribe", "channel": "retrievals:<event_uuid>" }   // filtered per role (see Retrievals)
{ "type": "unsubscribe", "channel": "..." }
{ "type": "ping" }
```
Server → client
```json
{ "type": "auth_ok", "user_id": "..." }
{ "type": "subscribed", "channel": "...", "snapshot": <same shape as /events/{id}/live or Flight> , "cursor": "..." }
{ "type": "position", "channel": "event:<id>", "cursor": "...", "data": { "flight_id", "pilot", "is_simulated", "position": Position } }
{ "type": "flight", "channel": "...", "cursor": "...", "data": Flight }          // started/ended
{ "type": "retrieval", "channel": "retrievals:<event_id>", "cursor": "...", "data": Retrieval }
{ "type": "retriever_position", "channel": "retrievals:<event_id>", "cursor": "...", "data": {"user_id","full_name","position":{"lat","lon","h_acc_m","t","course_deg","speed_ms"}} }
{ "type": "pilot_position", "channel": "retrievals:<event_id>", "cursor": "...", "data": {"retrieval_id","user_id","position": Position} }   // to the accepting retriever, organizers, observers
{ "type": "error", "code": "forbidden"|"unknown_channel"|"unauthorized", "channel": "..." }
{ "type": "ping" } / { "type": "pong" }
```
- Server sends `ping` every 25 s; clients reply `pong`; a connection silent for 60 s is closed.
- `since`: if the cursor is still in the server's replay window (Redis stream, ~10 min), missed events are replayed; otherwise a fresh `snapshot` is sent. Clients must always treat `subscribed.snapshot` as the source of truth.
- Per-connection outbound queue is bounded (256 messages). A slow consumer is disconnected with close code `4008`; the client reconnects and resubscribes.
- Close codes: `4001` unauthorized, `4008` slow consumer, `1012` server restart. Clients reconnect with exponential backoff (1 s → 30 s, jitter) and resubscribe with their last cursor.
- Authorization is checked at subscribe time and re-checked per message (roles can change during the event).

## Retrievals

```json
Retrieval = {
  "id": "uuid (client-generated)", "event_id": "uuid", "flight_id": "uuid"|null,
  "pilot": {"user_id","full_name","public_id","phone"},          // phone only for organizers/admin and the accepting retriever
  "status": "requested"|"accepted"|"picked_up"|"delivered"|"cancelled",
  "pickup": {"lat","lon","gps_alt_m","h_acc_m","t"},              // where the pilot asked to be picked up
  "pilot_position": Position | null,                              // latest shared position (the pilot may walk to a road)
  "note": "Yol kenarındayım, kanat toplandı",
  "retriever": {"user_id","full_name","phone"} | null,             // phone visible to the pilot after acceptance
  "retriever_position": {"lat","lon","h_acc_m","t"} | null,        // to the pilot, organizers, observers
  "requested_at","accepted_at","picked_up_at","delivered_at","cancelled_at",
  "cancelled_by": {"user_id","full_name"} | null, "cancel_reason": "", "delivery_note": "",
  "is_simulated": false,
  "updates": [{ "id","kind":"requested"|"accepted"|"released"|"assigned"|"picked_up"|"delivered"|"cancelled"|"note","actor":{"user_id","full_name"}|null,"body":"","created_at" }]
}
```

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/events/{id}/retrievals` | event pilot | `{id, flight_id?, pickup, note?}` → `201`/`200` idempotent on `id`; one open retrieval per pilot per event (409 with the open one) |
| GET | `/events/{id}/retrievals` | see visibility | `?status=requested,accepted,picked_up` |
| GET | `/retrievals/{id}` | see visibility | |
| POST | `/retrievals/{id}/position` | owning pilot | `{lat, lon, h_acc_m, t, gps_alt_m?}` while the retrieval is open (≈ every 30 s from the app) |
| POST | `/retrievals/{id}/accept` | event retriever | first one wins; `409 conflict` if already taken |
| POST | `/retrievals/{id}/release` | accepting retriever | back to `requested` |
| POST | `/retrievals/{id}/assign` | organizer/admin | `{retriever_user_id}` (must be a retriever of the event) |
| POST | `/retrievals/{id}/picked-up` | accepting retriever | |
| POST | `/retrievals/{id}/delivered` | accepting retriever | `{note?}` |
| POST | `/retrievals/{id}/cancel` | pilot (own) or organizer/admin | `{reason?}` (e.g. "kendim döndüm") |
| POST | `/retrievals/{id}/notes` | pilot, accepting retriever, organizer | `{body}` |
| POST | `/events/{id}/retrievers/me/position` | event retriever | `{lat, lon, h_acc_m, t, course_deg?, speed_ms?}` while on duty or holding an active retrieval |
| PUT | `/events/{id}/retrievers/me/duty` | event retriever | `{on_duty: bool}` — shows them as available to organizers |

Visibility: organizers/observers/admin see all retrievals of the event; retrievers see all `requested` ones plus those they accepted; pilots see their own. Every state change is written to `audit_logs` and pushed on `retrievals:<event_id>`.

## Notifications

`GET /notifications` → `{items:[{id, kind:"event_update"|"application"|"retrieval"|"flight"|"system", title, body, data, read_at, created_at}]}`; `POST /notifications/{id}/read`; `POST /notifications/read-all`.

## Admin — `/admin` (platform_admin)

`GET /admin/users?q=`, `PATCH /admin/users/{id}` `{is_platform_admin?, disabled?}`, `POST /admin/users/{id}/reset-password` (sends reset email; returns `202`), `GET /admin/audit?actor_id=&action=&limit=`, `GET /admin/stats` (active events, pilots in the air, stale sessions, open retrievals, pending applications, recent flights, system status).

## Health

`GET /health/live` → `200 {"status":"ok"}`; `GET /health/ready` → `200 {"status":"ok","checks":{"postgres":"ok","redis":"ok"}}` or `503`. `GET /metrics` (Prometheus) is served on the internal port only.

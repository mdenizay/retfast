# Security

This document covers what `services/api` implements today. The authoritative decisions are ADR-003 (auth), ADR-006 (visibility) and ADR-007 (email) in `decisions.md`. Code references are relative to `services/api`.

## 1. Threat model

### Assets

| Asset | Why it matters |
|---|---|
| Account credentials and sessions | Account takeover exposes a pilot's location history and lets an attacker create false SOS incidents. |
| Live and historical positions | Positions show where a person is, or has been, in real time. Misuse means stalking and physical risk. |
| Emergency data | Emergency contact name and phone, blood type, and incident positions. |
| Incident workflow integrity | Forged acknowledgements or resolutions could leave a pilot without help. |
| Admin capability | Role grants, account disabling, password resets, audit visibility. |

### Actors

| Actor | Definition |
|---|---|
| guest | Unauthenticated. |
| pilot | Any account; the global role `pilot` is granted at registration. |
| event member | Per-event role `participant`, `observer` or `organizer` (`event_participants`). |
| `event_organizer` | Global role that may create events. Creating an event makes the creator its organizer. |
| `rescue_operator` | Global role. Responds to all incidents. |
| `platform_admin` | Global role. Full access. |
| attacker | Remote and unauthenticated, or holding a stolen or low-privilege account. |

### Threats and mitigations

| Threat | Mitigation |
|---|---|
| Location stalking | Per-flight visibility `private\|event\|public`. Every read path (REST, live snapshot, WebSocket messages) goes through `internal/authz`, and per-message checks use current facts. Guests see only `public` flights, and only on public events with `public_live_map`. Guests see display names, never contact data. Private and restricted resources return 404, not 403. |
| Account takeover by brute force | Argon2id. Per IP+email and per IP login limits. Generic error messages. Audit of `auth.login_failed`. |
| Account enumeration | Login uses one message for an unknown email and a wrong password, and verifies against a dummy hash for unknown emails to equalise timing. `forgot` always returns 202. **Residual:** `register` returns 409 for an existing email. |
| Token theft (access) | 15-minute JWT. Session and disabled state are re-checked against the DB, so revocation takes effect within the 10 s cache. |
| Token theft (refresh) | Opaque token, stored only as SHA-256. Rotated on every use. Reuse of a rotated token revokes the whole session family and is audited. The web token lives in an HttpOnly, SameSite=Strict cookie scoped to `/api/v1/auth`. |
| CSRF on cookie-based refresh/logout | SameSite=Strict. A cookie-authenticated refresh or logout with an `Origin` header outside `CORS_ORIGINS` returns 403. CORS lets only listed origins read responses. All other endpoints use Bearer tokens, not cookies. |
| Privilege escalation | Roles are read from the DB on each request (cached 10 s), not trusted from JWT claims. Admins cannot remove their own `platform_admin` role or disable themselves. Only organizers or admins manage events; the last organizer cannot be removed or demoted. |
| Forged emergency actions | Only responders may acknowledge, change status, add notes or assign. Responder means admin, `rescue_operator`, or organizer of the incident's event. Only the owner may cancel. State machine transitions are enforced under a row lock. Incident IDs cannot be claimed by another user (409). |
| Injection | All SQL goes through sqlc-generated parameterised queries or pgx parameters. Identifiers are built only from fixed formats (partition names via `pgx.Identifier`). HTML emails use `html/template` escaping. GPX output is XML-escaped. |
| SSRF | None. The only outbound HTTP call is to the fixed Resend base URL. User-provided URLs (`cover_image_url`, https only) are stored, never fetched. |
| DoS | Body size limits (auth 8 KB; telemetry 512 KB, also enforced after gzip decompression). 30 s handler timeout. Per-user telemetry and incident limits. Bounded WebSocket queues (256) and read limit (64 KB). Page sizes capped. `ReadHeaderTimeout` 10 s. **Residual:** no global per-IP limit on non-auth endpoints (expected at Traefik or Cloudflare). |
| Sensitive data in logs | Request logs contain method, route pattern, status, duration, bytes and IP. Query strings and bodies are not logged. Secrets, tokens, passwords and coordinates are not logged. |

## 2. Authentication (`internal/auth`)

### Passwords

- Argon2id with `m=19456 KiB, t=2, p=1`, a 16-byte random salt and a 32-byte key.
- Stored in PHC format: `$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>`.
- Comparison is constant-time. Hashes with out-of-range parameters are refused.

Password policy (`ValidatePassword`), applied on register, change and reset:

- at least 10 characters (runes) and at most 256 bytes;
- not equal to the email or to its local part (case-insensitive);
- not the bootstrap password `password`;
- not in a built-in list of about 60 common passwords.

A violation returns `422 validation_failed` with `details.password` (register) or `details.new_password` (change, reset). A change must also differ from the current password.

### Access tokens

- JWT HS256, TTL 15 minutes.
- Claims: `iss=retfast-api`, `aud=retfast`, `sub` (user id), `sid` (session family id), `roles`, `pcr` (password change required), `iat`, `nbf` (−30 s), `exp`, `jti`.
- Verification pins the algorithm to HS256, requires `exp`, and validates issuer and audience.
- An expired token returns `401 token_expired`; any other failure returns `401 unauthorized`.

DB-backed actor state (`Service.ResolveToken`): for each `(sub, sid)` the API loads, and caches for 10 s per instance:

- whether the user exists and is not disabled or deleted;
- whether the session family is still active;
- the user's current roles;
- `must_change_password`.

The DB value overrides the `roles` and `pcr` claims. Logout, password change and reset, and admin changes invalidate the cache on the instance that handled the request; other instances converge within 10 s.

### Refresh tokens and sessions

- 32 random bytes, base64url, stored only as SHA-256 (`user_sessions.token_hash`). TTL 30 days.
- One row per issued token. Rows sharing `family_id` form a login session.
- On refresh, the row is locked; the presented token is marked `rotated_at` and a new row is created in the same family.
- **Reuse detection:** presenting a token that is already rotated revokes the whole family (`revoke_reason=refresh_reuse_detected`). That revocation is committed and audited, and the response is 401.
- Revoked or expired tokens return 401. Refreshing for a disabled user revokes the family.
- Logout revokes the family of the presented refresh token, or of the access token's `sid` if no refresh token is sent.

### Web cookie

The cookie is set with these attributes:

```
rf_refresh=<token>; Path=/api/v1/auth; HttpOnly; SameSite=Strict; Secure; Max-Age=2592000
```

- `Secure` is omitted only when `APP_ENV=development`.
- `Domain` is set only when `COOKIE_DOMAIN` is set.
- Web responses omit `refresh_token` from the body.
- A refresh token in the body (iOS) takes precedence over the cookie.

### Password change required (`must_change_password`)

While the flag is set, only these endpoints work:

- `GET /me`
- `POST /auth/password/change`
- `POST /auth/refresh`
- `POST /auth/logout`

Every other authenticated endpoint, including optional-auth endpoints called with a token, returns `403 password_change_required`. WebSocket `auth` with such a token fails with `password_change_required` and closes with 4001.

### Bootstrap accounts (`seed`)

- Initial password `password`, with `must_change_password=true` and `password_expires_at = now + 7 d`.
- After expiry, login is refused: `401 unauthorized` with `details.reason=password_expired`, audited as `auth.login_failed` (`bootstrap_password_expired`).
- `retfast-api seed --renew-bootstrap` re-issues the initial password, with a new 7-day expiry, only for accounts that still have `must_change_password` and have never changed their password.
- The seed never resets an account that has changed its password, and never prints the password.

### Password change

`POST /auth/password/change` requires the current password. It then:

1. stores the new hash and clears `must_change_password` and the expiry;
2. revokes **all** sessions, including the current one, and issues a new session family returned in the response (same client type as the caller's session);
3. marks pending reset tokens used;
4. queues a security notification email and writes an audit record.

### Forgot and reset

- `forgot` always returns 202.
- For an active account it creates at most 5 reset tokens per hour. Tokens are 32 random bytes, stored as SHA-256, TTL 1 h, single use.
- The emailed link is `${APP_WEB_URL}/app/reset-password?token=...`.
- `reset` sets the password, marks the tokens used, revokes all sessions, marks the email verified (the link proves control of the mailbox), queues a security email and writes an audit record.

### Operator reset link

When email is not configured, `retfast-api reset-link --email X` prints a one-hour reset link to stdout and writes the audit record `operator.reset_link_issued`. The link is never logged.

### Email verification

- Tokens are created at registration (and on `/auth/email/verify/resend`, limited to 3 per 10 min per user). They are stored as SHA-256, TTL 48 h and single use.
- A token is bound to the email address it was sent to.
- The link is `${APP_WEB_URL}/app/verify-email?token=...`.

## 3. Authorization matrix (`internal/authz/authz.go`)

Columns:

- **Member**: active participant or observer of the event.
- **Org**: organizer of that event.
- **Rescue**: global `rescue_operator`.
- **Admin**: `platform_admin`.
- **Owner**: the flight's pilot or the incident's reporter.

Cell values:

- ✓ means allowed.
- 404 means hidden; the resource is not disclosed.
- 403 means visible but forbidden.

| Resource / action | Guest | Pilot (no relation) | Member | Org | Rescue | Admin | Owner |
|---|---|---|---|---|---|---|---|
| View public, non-draft event | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – |
| View restricted event | 404 | 404 | ✓ | ✓ | 404¹ | ✓ | – |
| View draft event | 404 | 404 | 404 | ✓ | 404 | ✓ | – |
| Create event | 401 | 403 (needs `event_organizer`) | – | – | 403 | ✓ | – |
| Patch / archive event, manage participants & launch sites, report | 401 | 403 | 403 | ✓ | 403 | ✓ | – |
| Join public event (registration open) | 401 | ✓ as participant (needs `pilot`) or observer (if `observers_allowed`) | idempotent | – | – | – | – |
| Self-join restricted event | 401 | 404 | – | – | – | – | – |
| List participants | 401 | 403 | ✓ active only | ✓ incl. removed | 403 | ✓ incl. removed | – |
| Event live map / `event:` channel | public event with `public_live_map` | public event with `public_live_map` | ✓ | ✓ | ✓ (any event) | ✓ (any event) | – |
| Live: `public` flight | ✓² | ✓² | ✓ | ✓ | ✓ | ✓ | ✓ |
| Live: `event` flight | – | – | ✓ | ✓ | ✓ | ✓ | ✓ |
| Live: `private` flight | – | – | – | only while an incident is open on it | ✓ | ✓ | ✓ |
| `GET /flights/{id}`, positions, GPX, `flight:` channel | public flights | public flights | + `event` flights of that event | + private while incident open | all | all | ✓ |
| Patch / end flight, upload telemetry | – | – | – | – | – | – | ✓ only |
| Create flight in event | – | – | participant only (+ `live_tracking`) | ✓ | – | – | – |
| `GET /flights?event_id=` | 401 | 403 | non-private + own | non-private + own | all | all | – |
| `GET /flights?pilot_id=` (other pilot) | 401 | empty (organizer-scoped) | – | that pilot's non-private flights in events the caller organises | all | all | – |
| Create incident (SOS) | 401 | ✓ (own flight only) | – | – | – | – | ✓ |
| `is_test` incident | – | only if the flight's event has `emergency_testing` | | | | | |
| View incident (incl. emergency contacts) | 401 | 404 | 404 | ✓ (audited) | ✓ (audited) | ✓ (audited) | ✓ |
| Acknowledge / status / note / assign | 401 | 404 | 404 | ✓ | ✓ | ✓ | 403 |
| Cancel incident | – | 404 | – | 403 | 403 | 403 | ✓ |
| `incidents` channel | – | forbidden | forbidden | scoped to organised events | all | all | – |
| `/rescue/assignments`, `/rescue/me/*` | 401 | 403 | 403 | 403 | ✓ | ✓ | – |
| Assignment status | – | – | – | – | assignee only | assignee only | – |
| `/rescue/team` | 401 | 403 | 403 | ✓ (organises ≥ 1 event) | ✓ | ✓ | – |
| `GET /pilots` (search) | 401 | 403 | 403 | ✓ (organises ≥ 1 event or `event_organizer`) | 403 | ✓ | – |
| `GET /pilots/{public_id}` | if `public_profile` | if `public_profile` | if `public_profile` | if `public_profile` | if `public_profile` | if `public_profile` | ✓ |
| `/admin/*` | 401 | 403 | 403 | 403 | 403 | ✓ | – |
| `/me`, `/me/*`, `/notifications` | 401 | own data only | | | | | |

¹ Rescue operators and admins can open the live map of any event (`GET /events/{id}/live`, `event:` channel), but other event endpoints follow event visibility.
² Guests and non-members see only public flights, only on public events with `public_live_map`, and with display names.

Incident responders may be assigned only if they are themselves a responder for that incident (admin, rescue operator, or organizer of its event).

## 4. Rate limits (`internal/platform/ratelimit`)

Fixed-window counters in Redis (`INCR` + `EXPIRE` in a MULTI). Keys are `<prefix>rl:<rule>:<sha256(key)[:12]>:<window>`, so emails and IPs are not stored in clear in Redis.

If Redis errors (300 ms timeout), the decision is made in an in-memory map on that instance and `retfast_ratelimit_fallback_total` is incremented. Limits are then per instance rather than global. Rejections return `429 rate_limited` with `Retry-After` set to the seconds until the window resets.

| Rule | Limit | Key |
|---|---|---|
| `login_ip_email` | 5 / min | client IP + submitted email |
| `login_ip` | 20 / min | client IP |
| `register_ip` | 5 / min | client IP |
| `forgot_ip` | 5 / min | client IP |
| `reset_ip` | 10 / min | client IP (also used by `email/verify`) |
| `refresh_ip` | 60 / min | client IP |
| `verify_resend_user` | 3 / 10 min | user |
| `password_change_user` | 10 / min | user |
| `telemetry_user` | 600 / min | user |
| `incident_user` | 30 / min | user |

The client IP is the TCP peer unless the peer is in `TRUSTED_PROXIES`. In that case the right-most `X-Forwarded-For` entry that is not itself a trusted proxy is used.

## 5. Audit (`audit_logs`)

Each record stores `actor_id`, `action`, `target_type`, `target_id`, `event_id`, `ip`, `user_agent` (truncated to 300 characters), `details jsonb` and `created_at`. Most rows are written in the same transaction as the action they describe.

**Rule:** `details` never contains secrets, tokens, passwords or coordinates. `rescue.position_updated` records only that a position was set. An integration test asserts that no audit row contains a coordinate.

Recorded actions:

- **Auth:** `auth.register`, `auth.login`, `auth.login_failed` (reason: unknown_email, bad_password, disabled, bootstrap_password_expired), `auth.logout`, `auth.refresh_reuse_detected`, `auth.password_changed`, `auth.password_reset_requested`, `auth.password_reset`, `auth.email_verified`.
- **Account:** `account.deletion_requested`, `account.deletion_cancelled`, `account.deleted`.
- **Admin and operator:** `admin.user_updated` (roles before and after, disabled), `admin.password_reset_sent`, `operator.reset_link_issued`.
- **Events:** `event.created`, `event.updated`, `event.archived`, `event.joined`, `event.left`, `event.participant_added`, `event.participant_role_changed`, `event.participant_removed`, `event.launch_site_created`, `event.launch_site_updated`, `event.launch_site_deleted`.
- **Incidents (every responder action):**
  - `incident.created`, `incident.cancelled`, `incident.acknowledged`;
  - `incident.status_responding`, `incident.status_resolved`;
  - `incident.note_added`, `incident.assigned`;
  - `rescue.assignment_status`, `rescue.availability`, `rescue.position_updated`, `rescue.team_viewed`.
- **Emergency-contact access (responders only; access by the incident's own pilot is not recorded):**
  - `incident.contact_viewed`: a single incident read via REST;
  - `incident.contact_listed`: a list, with a count;
  - `incident.contact_viewed_realtime`: the `incidents` channel snapshot.

`GET /admin/audit` filters by `actor_id` and by `action`, where a prefix match on `action.` is supported.

## 6. Privacy

- **Visibility:** each flight has its own visibility. The default comes from `user_preferences.default_flight_visibility`, which defaults to `event`. A visibility change is published to realtime subscribers. Those who lose access receive `{"id", "visibility", "removed": true}`.
- **Guests** see only public flights, on public events with `public_live_map`, with the pilot's `display_name` and `public_id`. Guests never see contact or emergency data.
- **Public pilot profile** (`GET /pilots/{public_id}`): returned only if `public_profile` is true (or to the owner). It contains `public_id`, `display_name`, `bio`, `wing` and `nationality`, and never licence, emergency contact or blood type. Disabled or deleted accounts return 404.
- **Emergency contact data** appears only in incident representations, and only for the owner and the incident's responders. Every responder access is audited (section 5). The realtime `incidents` channel is available only to responders.
- **Export:** `GET /me/export` streams the profile, preferences, roles, devices (without the push token, only `has_push_token`), and all flights with their positions.

## 7. Retention

The retention table is in `telemetry.md` section 8. Summary:

- positions are kept until the flight or account is deleted;
- telemetry batches 7 days;
- email bodies purged at the terminal state, rows 30 days;
- read notifications 180 days;
- expired sessions and tokens 30 days after expiry;
- audit 730 days.

## 8. Account deletion

1. `POST /me/deletion-request` schedules deletion after `ACCOUNT_DELETION_GRACE` (default 336 h, which is 14 days) and returns 202 `{status, requested_at, scheduled_for}`.
2. `DELETE /me/deletion-request` cancels it. Both are audited.
3. The worker (`users.DeletionWorker`, every minute, `FOR UPDATE SKIP LOCKED`) processes due requests in one transaction:
   1. revokes all sessions and deletes devices and notifications;
   2. deletes all flights, which cascades to positions, sample keys and batches;
   3. wipes the pilot profile fields (display name set to "Silinmiş pilot") and turns `public_profile` off;
   4. marks event memberships removed and deletes roles;
   5. replaces the email with `deleted-<id>@deleted.invalid`, sets the name to "Silinmiş kullanıcı", sets a random password hash, sets `disabled_at` and `deleted_at`;
   6. marks the request completed and writes the audit record `account.deleted`.
4. **Retained:** `emergency_incidents` and their updates are kept as a safety record. They reference the anonymised user; the `flight_id` is set to NULL by the FK. Audit rows are kept, with `actor_id` still pointing at the anonymised user.

## 9. Logging

- JSON via `log/slog` with `service=retfast-api` and a `request_id` per request. `X-Request-Id` is accepted if it matches `[A-Za-z0-9._-]{8,64}` and is generated otherwise.
- Never logged:
  - secrets, tokens, passwords, reset or verification links;
  - request bodies and query strings;
  - precise coordinates.
- Config is logged through `Config.Redacted()`, which reports only `email_configured: bool`.
- The go-redis library logger is silenced; Redis failures are logged by Retfast at warn, at most once per 30 s per component.
- `reset-link` prints the link to stdout for the operator; this is the only place a token is ever printed.

## 10. Transport and headers

- TLS terminates at Traefik (ADR-010). The API listens on plain HTTP inside the network.
- Set `TRUSTED_PROXIES` to Traefik's address or network; otherwise `X-Forwarded-For` is ignored.
- Response headers on every response:
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Referrer-Policy: no-referrer`
  - `Cache-Control: no-store`
  - `X-Request-Id`
- CORS is an allow-list from `CORS_ORIGINS`. If unset, it defaults to `PUBLIC_WEB_URL` and `APP_WEB_URL`, plus `localhost:5173` in development. Credentials are allowed only for listed origins, and the preflight max-age is 600 s.
- The WebSocket handshake enforces the same origins as host patterns. Clients that send no `Origin` header (iOS) are accepted.
- Metrics are served only on `METRICS_ADDR`, which must not be exposed publicly.

## 11. Secrets and configuration

| Variable | Rule |
|---|---|
| `JWT_SECRET` | ≥ 32 bytes. Required outside development; the built-in development secret is rejected in staging and production. |
| `RESEND_API_KEY` | Optional. Without it, every queued email is marked `failed: provider_unconfigured` (metric `retfast_email_failures_total{reason="provider_unconfigured"}` and one warning log). A 401/403 from Resend marks the email `failed: provider_rejected` without retry. Other errors are retried up to 5 attempts with backoff of 30 s × 2ⁿ, capped at 30 min. |
| `DATABASE_URL`, `REDIS_URL` | Credentials are never logged. |
| `COOKIE_DOMAIN` | Optional. Leave unset to scope the cookie to `api.retfast.com`. |

## 12. Push notifications (APNs not configured)

- `notifications.PushSender` is the interface a real APNs client must implement (token-based `.p8`, HTTP/2).
- The only implementation shipped is `UnconfiguredAPNs`. It logs `apns_unconfigured` and increments `retfast_push_unconfigured_total`.
- The push worker sets `notification_records.push_status` as follows:

  | `push_status` | Meaning |
  |---|---|
  | `no_device` | The user has no registered push token. |
  | `unconfigured` | The user has a token but APNs is not set up. |
  | `sent` | Delivered (requires a real sender). |
  | `failed` | Delivery failed (requires a real sender). |

- In-app notifications (`GET /notifications`) are the working delivery channel today.
- iOS learns of SOS acknowledgement by polling `GET /incidents/{id}`.

## 13. Known gaps and not implemented

- No MFA or WebAuthn, and no CAPTCHA on register, login or forgot.
- Registration reveals whether an email exists (409).
- HS256 with a single key: there is no `kid`, and no tooling to rotate keys without invalidating live access tokens (15-minute impact).
- Strict refresh reuse detection: two browser tabs refreshing at the same moment can trigger reuse detection and sign the user out. There is no grace window.
- Revocation and role changes reach other instances within the 10 s cache TTL, not instantly.
- The in-memory rate-limit fallback is per instance, so limits are looser with several instances while Redis is down.
- No global per-IP rate limit on non-auth endpoints; this is expected at the edge.
- No automatic age-based retention for positions (manual partition procedure in `telemetry.md`).
- APNs is not implemented.
- Email bodies containing reset or verification links stay in `email_outbox` until the worker reaches a terminal state (normally seconds, longer during provider retries).
- WebSocket subscriptions keep their subscribe-time membership facts until resubscribe. A member removed from an event keeps receiving that event's non-private positions on an existing connection until it reconnects. Flight visibility changes, by contrast, are applied per message.
- An expired access token does not end an existing WebSocket connection. Re-`auth` updates the identity used for new subscriptions.

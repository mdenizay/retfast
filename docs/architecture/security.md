# Security

This document covers what `services/api` implements today. The authoritative decisions are ADR-003 (auth), ADR-006/ADR-012 (event roles and visibility) and ADR-007 (email) in `decisions.md`. Code references are relative to `services/api`.

## 1. Threat model

### Assets

| Asset | Why it matters |
|---|---|
| Account credentials and sessions | Account takeover exposes a pilot's location history and phone number, and lets an attacker create or hijack retrievals. |
| Live and historical positions | Positions show where a person is, or has been, in real time. Misuse means stalking and physical risk. |
| Contact data | Pilot and retriever phone numbers, emergency contact name and phone. |
| Retrieval workflow integrity | A forged accept, release or "delivered" could leave a landed pilot waiting in the field. |
| Admin capability | `platform_admin` grants, event creation, organizer assignment, account disabling, password resets, audit visibility. |

### Actors

| Actor | Definition |
|---|---|
| guest | Unauthenticated. |
| user | Any account. Users have no role of their own; all roles are per event. |
| organizer | Per event (`event_organizers`), assigned by a platform admin. Manages that event; may also hold a member role. |
| member | Per event (`event_members`), exactly one role: `pilot`, `observer` or `retriever`, granted by an organizer (application approval or direct add). |
| `platform_admin` | The only global privilege (`user_roles`). Creates events, assigns organizers, manages users; sees everything. |
| attacker | Remote and unauthenticated, or holding a stolen or low-privilege account. |

### Threats and mitigations

| Threat | Mitigation |
|---|---|
| Location stalking | Visibility follows event roles (ADR-012). Flights outside events are private to their pilot. Every read path (REST, live snapshot, WebSocket messages) goes through `internal/authz`; WebSocket subscriptions re-check each message against facts that are refreshed on every instance when a membership or event setting changes (`member_changed` / `event_changed` outbox envelopes). Retrievers never get the general live map; they see a pilot's live position only while holding that pilot's retrieval. Guests see positions only on public events with `public_live_map`, with display names, never contact data. Restricted and draft events and invisible flights/retrievals return 404, not 403. |
| Phone number exposure | Phones are revealed only to organizers/admins, to the accepting retriever (pilot's phone, while the retrieval is accepted/picked up) and to the pilot (accepting retriever's phone, same window). Every reveal is audited (`privacy.phone_revealed`, section 5). |
| Account takeover by brute force | Argon2id. Per IP+email and per IP login limits. Generic error messages. Audit of `auth.login_failed`. |
| Account enumeration | Login uses one message for an unknown email and a wrong password, and verifies against a dummy hash for unknown emails to equalise timing. `forgot` always returns 202. **Residual:** `register` returns 409 for an existing email. |
| Token theft (access) | 15-minute JWT. Session and disabled state are re-checked against the DB, so revocation takes effect within the 10 s cache. |
| Token theft (refresh) | Opaque token, stored only as SHA-256. Rotated on every use. Reuse of a rotated token revokes the whole session family and is audited. The web token lives in an HttpOnly, SameSite=Strict cookie scoped to `/api/v1/auth`. |
| CSRF on cookie-based refresh/logout | SameSite=Strict. A cookie-authenticated refresh or logout with an `Origin` header outside `CORS_ORIGINS` returns 403. CORS lets only listed origins read responses. All other endpoints use Bearer tokens, not cookies. |
| Privilege escalation | Roles are read from the DB on each request (cached 10 s), not trusted from JWT claims. Admins cannot remove their own `platform_admin` role or disable themselves. Only admins create events and assign organizers; only organizers or admins manage an event's members and applications. |
| Forged retrieval actions | Only event retrievers accept; only the accepting retriever releases, marks picked up and delivered; only organizers/admins assign; only the pilot or organizers/admins cancel. Every transition is a conditional `UPDATE … WHERE status = … [AND retriever_id = me] RETURNING`, so the first accept wins and stale actions get 409. Retrieval IDs cannot be claimed by another user (409). Simulated retrievals are flagged `is_simulated`; the simulator never acts on a real pilot's retrieval. |
| Injection | All SQL goes through sqlc-generated parameterised queries or pgx parameters. Identifiers are built only from fixed formats (partition names via `pgx.Identifier`). HTML emails use `html/template` escaping. GPX output is XML-escaped. |
| SSRF | None. The only outbound HTTP call is to the fixed Resend base URL. User-provided URLs (`cover_image_url`, https only) are stored, never fetched. |
| DoS | Body size limits (auth 8 KB; telemetry 512 KB, also enforced after gzip decompression). 30 s handler timeout. Per-user telemetry, retrieval and position limits. Bounded WebSocket queues (256) and read limit (64 KB). Page sizes capped. `ReadHeaderTimeout` 10 s. **Residual:** no global per-IP limit on non-auth endpoints (expected at Traefik or Cloudflare). |
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

Columns (per event): **Guest** (unauthenticated), **User** (signed in, no relation to the event), **Pilot**, **Observer**, **Retriever** (active member roles), **Org** (organizer of the event; may also hold a member role, in which case the union applies), **Admin** (`platform_admin`). ✓ allowed, 404 hidden (not disclosed), 403 visible but forbidden.

| Resource / action | Guest | User | Pilot | Observer | Retriever | Org | Admin |
|---|---|---|---|---|---|---|---|
| View public, non-draft event | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| View restricted event | 404 | 404 | ✓ | ✓ | ✓ | ✓ | ✓ |
| View draft event | 404 | 404 | 404 | 404 | 404 | ✓ | ✓ |
| Create event, assign/remove organizers | 401 | 403 | 403 | 403 | 403 | 403 | ✓ |
| Patch/archive event, launch-site writes, report | 401 | 403 | 403 | 403 | 403 | ✓ | ✓ |
| Apply (`applications_open`, one pending) | 401 | ✓ | 409 | 409 | 409 | ✓ (if no member role) | ✓ |
| List / approve (choose role) / reject applications | 401 | 403 | 403 | 403 | 403 | ✓ | ✓ |
| Withdraw application | – | own only (else 404) | | | | | |
| List members / organizers | 401 | 403 | active, no phones | active, no phones | active, no phones | all incl. removed + phones (audited) | same as Org |
| Add / change role / remove member | 401 | 403 | 403 | 403 | 403 | ✓ | ✓ |
| `GET /users/search` | 401 | 403 | 403 | 403 | 403 | ✓ (organizes ≥ 1 event) | ✓ |
| Live snapshot / `event:` channel | 401 | 403 | ✓ | ✓ | ✓ but `pilots: []` | ✓ | ✓ |
| … with `public_live_map` on a public event | ✓ display names | ✓ display names | | | | | |
| Live: other pilots' flights | public map only | public map only | if `pilots_see_each_other` | ✓ | never | ✓ | ✓ |
| `GET /flights/{id}`, positions, GPX, `flight:` | public map only | public map only | own + others if `pilots_see_each_other` | ✓ event flights | 404 | ✓ | ✓ all |
| Flight outside any event | 404 | 404 | owner only | | | | ✓ |
| Create flight in event | – | 403 | ✓ (+ `live_tracking`, event running) | 403 | 403 | only with pilot role | – |
| Patch (event, while recording) / end flight / upload telemetry | – | – | owner only | | | | |
| `GET /flights?event_id=` | 401 | 403 | own + others if `pilots_see_each_other` | ✓ | 403 | ✓ | ✓ |
| Create retrieval | 401 | 403 | ✓ (one open per pilot) | 403 | 403 | only with pilot role | – |
| List / view retrievals, `retrievals:` channel | 401 | 403 (404 single) | own | all, no phones | `requested` + those they hold | all + phones | all + phones |
| Pilot phone in a retrieval | – | – | own | – | while holding it | ✓ | ✓ |
| Retriever phone in a retrieval | – | – | of the accepting retriever while held | – | own | ✓ | ✓ |
| Pilot live position in a retrieval / `pilot_position` | – | – | own | ✓ | while holding it (not after delivery) | ✓ | ✓ |
| `retriever_position`, snapshot `retrievers` | – | – | only the retriever holding their open retrieval | ✓ | self | ✓ | ✓ |
| Accept | – | – | 403 | 403 | ✓ (first wins, else 409) | only with retriever role | – |
| Release / picked-up / delivered | – | – | 403 | 403 | holder only | holder only | holder only |
| Assign (to a retriever of the event) | – | – | 403 | 403 | 403 | ✓ | ✓ |
| Cancel | – | – | own | 403 | 403 | ✓ | ✓ |
| Notes | – | – | own | 403 | holder | ✓ | ✓ |
| Pilot position (`/retrievals/{id}/position`) | – | – | own, while open | | | | |
| Duty / retriever position | – | 403 | 403 | 403 | ✓ (position only on duty or while holding a retrieval) | only with retriever role | – |
| `GET /pilots/{public_id}` | if `public_profile` | if `public_profile` | … | … | … | … | … (owner always) |
| `/admin/*` | 401 | 403 | 403 | 403 | 403 | 403 | ✓ |
| `/me`, `/me/*`, `/notifications` | 401 | own data only | | | | | |

Notes:

- Retrievers see `requested` retrievals with the pickup point only: no phones, no live pilot position, no timeline. When a request they can see is accepted by someone else (or reassigned away from them) they receive `{"id","event_id","status","removed":true}`.
- Observers see every retrieval and every position but no phone numbers.
- Authorization of WebSocket messages is re-evaluated per message against current facts: role changes and settings changes take effect on open subscriptions (via internal `member_changed` / `event_changed` envelopes on the same outbox → Redis stream path).

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
| `retrieval_user` | 60 / min | user (create, accept, notes) |
| `position_user` | 240 / min | user (retrieval pilot positions, retriever positions) |

The client IP is the TCP peer unless the peer is in `TRUSTED_PROXIES`. In that case the right-most `X-Forwarded-For` entry that is not itself a trusted proxy is used.

## 5. Audit (`audit_logs`)

Each record stores `actor_id`, `action`, `target_type`, `target_id`, `event_id`, `ip`, `user_agent` (truncated to 300 characters), `details jsonb` and `created_at`. Most rows are written in the same transaction as the action they describe.

**Rule:** `details` never contains secrets, tokens, passwords or coordinates. Retrieval and duty audit rows contain statuses and user ids, never positions or phone numbers.

Recorded actions:

- **Auth:** `auth.register`, `auth.login`, `auth.login_failed` (reason: unknown_email, bad_password, disabled, bootstrap_password_expired), `auth.logout`, `auth.refresh_reuse_detected`, `auth.password_changed`, `auth.password_reset_requested`, `auth.password_reset`, `auth.email_verified`.
- **Account:** `account.deletion_requested`, `account.deletion_cancelled`, `account.deleted`.
- **Admin and operator:** `admin.user_updated` (`is_platform_admin` before and after, disabled), `admin.password_reset_sent`, `operator.reset_link_issued`.
- **Events:** `event.created`, `event.updated`, `event.archived`, `event.organizer_added`, `event.organizer_removed`, `event.application_created`, `event.application_approved` (granted role), `event.application_rejected`, `event.application_withdrawn`, `event.member_added`, `event.member_role_changed` (from/to), `event.member_removed`, `event.left`, `event.launch_site_created`, `event.launch_site_updated`, `event.launch_site_deleted`.
- **Retrievals (every state change, in the same transaction):** `retrieval.requested`, `retrieval.accepted`, `retrieval.released`, `retrieval.assigned` (previous retriever), `retrieval.picked_up`, `retrieval.delivered`, `retrieval.cancelled`, `retrieval.note`; `retriever.duty_changed`. Details: from/to status, pilot and retriever ids, `is_simulated`.
- **Phone reveals (`privacy.phone_revealed`):** written whenever a response or snapshot shows someone else's phone number — `details.context` is `retrieval`, `retrievals`, `live_snapshot`, `event_members`, `event_member`, or `retrieval_accepted` / `retrieval_assigned` (the moment an accept/assignment starts revealing phones over the realtime channel; `details.revealed_to` names the recipient). `details.user_ids` lists whose phone was shown; the number itself is never stored. Individual WebSocket `retrieval` messages are not audited one by one: the reveal is audited when it starts (accept/assign) and on every snapshot.

`GET /admin/audit` filters by `actor_id` and by `action`, where a prefix match on `action.` is supported.

## 6. Privacy

- **Visibility by role (ADR-012):** taking part in an event as a pilot means sharing that event's flights with its organizers and observers (and other pilots when `pilots_see_each_other`); the app says so before the first flight. Flights outside events are private. There is no per-flight visibility.
- **Guests** see positions only on public events with `public_live_map` (default off), with the pilot's `display_name` and `public_id`, never contact data, retrievals or retrievers.
- **Phone numbers** (`pilot_profiles.phone`) are shown only to the user, to organizers/admins of events the user takes part in (member list, retrievals), to the retriever holding the user's open retrieval, and — for a retriever's phone — to the pilot they are retrieving while the retrieval is accepted/picked up. After delivery or cancellation the retriever no longer sees the pilot's phone or live position. Emergency contact fields are returned only to the user themself (`/me`). Every reveal to someone else is audited.
- **Retriever positions** are shared only while on duty or while holding a retrieval, and only with organizers/observers/admins and the pilot being retrieved.
- **Public pilot profile** (`GET /pilots/{public_id}`): returned only if `public_profile` is true (or to the owner). It contains `public_id`, `display_name`, `bio`, `wing` and `nationality`, and never phone, licence or emergency contact. Disabled or deleted accounts return 404.
- **Export:** `GET /me/export` streams the profile, preferences, roles, devices (without the push token, only `has_push_token`), the user's retrieval requests, and all flights with their positions.

## 7. Retention

The retention table is in `telemetry.md` section 8. Summary:

- positions are kept until the flight or account is deleted;
- telemetry batches 7 days;
- email bodies purged at the terminal state, rows 30 days;
- read notifications 180 days;
- retriever positions (`retriever_positions`) and retrieval pilot positions (`retrieval_positions`) 30 days; a retriever's latest position in `retriever_states` is cleared (and duty set off) 30 days after it was received;
- expired sessions and tokens 30 days after expiry;
- audit 730 days.

## 8. Account deletion

1. `POST /me/deletion-request` schedules deletion after `ACCOUNT_DELETION_GRACE` (default 336 h, which is 14 days) and returns 202 `{status, requested_at, scheduled_for}`.
2. `DELETE /me/deletion-request` cancels it. Both are audited.
3. The worker (`users.DeletionWorker`, every minute, `FOR UPDATE SKIP LOCKED`) processes due requests in one transaction:
   1. revokes all sessions and deletes devices and notifications;
   2. deletes all flights, which cascades to positions, sample keys and batches;
   3. wipes the pilot profile fields (display name set to "Silinmiş pilot") and turns `public_profile` off;
   4. marks event memberships removed, removes organizer assignments, withdraws pending applications, deletes roles, retriever positions/states and the user's retrieval position history;
   5. replaces the email with `deleted-<id>@deleted.invalid`, sets the name to "Silinmiş kullanıcı", sets a random password hash, sets `disabled_at` and `deleted_at`;
   6. marks the request completed and writes the audit record `account.deleted`.
4. **Retained:** retrieval records (status timeline, pickup point) are kept as the event's record; they reference the anonymised user (name and phone are gone with the profile) and their `flight_id` becomes NULL when the flight is deleted. Audit rows are kept, with `actor_id` still pointing at the anonymised user.

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
- Notification kinds: `event_update`, `application` (decision → applicant; new application → organizers), `retrieval` (new request → event retrievers and organizers; accepted/assigned/picked up/delivered/released/cancelled → pilot, and the retriever where relevant), `flight`, `system`. Apps learn of retrieval changes through the `retrievals:<event_id>` channel or by polling `GET /retrievals/{id}`.

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
- WebSocket role/setting changes are applied per message after the `member_changed` / `event_changed` envelope passes through the outbox (normally < 1 s). If Redis is down, they are applied when it recovers; until then an existing subscription keeps its previous facts.
- Rate limits for retrieval state changes are per user only; a retriever spamming `accept` on many requests is bounded by `retrieval_user` (60/min).
- An expired access token does not end an existing WebSocket connection. Re-`auth` updates the identity used for new subscriptions.

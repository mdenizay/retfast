# Architecture Decisions

Short ADRs. Status is "accepted" unless noted. Date 2026-11-04.

## ADR-001 Clean rebuild on branch `rebuild`
Replace v2 (Supabase) and v3 (Rust/Next/Expo) with Go + React + native SwiftUI. Old code stays in git (`v2-final`, `v3-final`). Old data is discarded (owner-authorized clean install). `rebuild` is merged into `main` once production runs from it.

## ADR-002 Modular monolith in Go
One binary `retfast-api` (`services/api/cmd/api`) with subcommands `serve`, `migrate up|down|status`, `seed`, `simulate` is a separate binary (`cmd/simulator`). Domain packages under `internal/` (`auth`, `users`, `events`, `flights`, `tracking`, `realtime`, `emergencies`, `notifications`, `audit`, `platform/*`). Packages talk through Go interfaces/structs, never through each other's tables, except read models built for the live map. Router: chi. DB: pgx v5 + sqlc. Migrations: plain SQL files (`migrations/NNNN_name.up.sql` / `.down.sql`) applied by an embedded runner with a `schema_migrations` table and an advisory lock.

## ADR-003 Auth
Argon2id (`m=19456 KiB, t=2, p=1`, 16-byte salt, 32-byte key — OWASP baseline, chosen for a 1-host deployment where bursts of logins must not exhaust RAM). Access JWT HS256 15 min (`sub`, `roles`, `pcr` = password-change-required, `sid`). Refresh tokens are 32 random bytes, stored as SHA-256, rotated on use with family reuse detection. Sessions revocable. Web stores refresh in an HttpOnly cookie; iOS in Keychain.

Bootstrap accounts (`seed`) get `must_change_password = true` and `password_expires_at = now() + 7 days`: after expiry the bootstrap password is refused and an admin must issue a reset. While `must_change_password` is set the API allows only `/me`, `/auth/password/change`, `/auth/refresh`, `/auth/logout`. The new password may never equal the bootstrap password. The seed never logs the password.

## ADR-004 Telemetry storage and global de-duplication
`flight_positions` is RANGE-partitioned by **`received_at`** (server clock, monthly partitions + a default partition) — device clocks can be wrong, so partitioning on device time would scatter rows and break pruning.

A unique index on a partitioned table must include the partition key, so `UNIQUE(sample_id)` cannot be enforced globally on `flight_positions`. Global de-duplication is therefore done in the **unpartitioned** table `telemetry_sample_keys (flight_id uuid, seq int, sample_id uuid, PRIMARY KEY (flight_id, seq))` plus `UNIQUE (sample_id)`. Ingestion, in one transaction:

1. `INSERT INTO telemetry_sample_keys ... ON CONFLICT DO NOTHING RETURNING seq` for the batch.
2. Insert only the returned (new) samples into `flight_positions`.
3. Update the flight's running stats and `last_position` (row in `flight_sessions`).
4. Insert one row into `realtime_outbox`.
5. Commit, then respond. Samples whose key already existed are reported as `duplicate`.

A conflict on `sample_id` with a different `(flight_id, seq)` is rejected as `invalid` (client bug). Partitions are created ahead by the API at startup and daily (next 3 months).

## ADR-005 Realtime: transactional outbox → Redis Streams → WebSocket
Telemetry commits write an outbox row in the same transaction. A relay goroutine (one active instance via `pg_try_advisory_lock`) reads the outbox (`LISTEN/NOTIFY` wake-up + 1 s poll), updates the Redis latest-position hash `rf:latest:<event_id>` and `XADD rf:rt * ...` (`MAXLEN ~ 100000`), then deletes the outbox rows. If Redis is down the outbox accumulates and drains later — committed telemetry is never lost, only delayed. Every API instance tails the stream with `XREAD BLOCK` and fans out to its local subscribers. Stream IDs are the client cursors. Snapshots come from PostgreSQL (`flight_sessions.last_position` + recent positions), with Redis as a cache only. Redis Pub/Sub is not used for anything that must survive.

## ADR-006 Visibility model
Flight visibility `private | event | public`, chosen per flight by the pilot (default from preferences, default `event`). Event visibility `public | restricted`. Authorization lives in one policy package (`internal/authz`) used by REST and WebSocket. Responders (admin, rescue_operator, organizers of the incident's event) can see an incident pilot's last position and emergency contacts regardless of flight visibility, and that access is audited.

## ADR-007 Email via Resend with an outbox
`email_outbox` table + worker with bounded retries (5, exponential). If `RESEND_API_KEY` is absent or rejected, emails are marked `failed: provider_unconfigured` and a warning metric/log is emitted — no secrets or tokens logged. The previous Resend key was invalid at discovery, so production starts with email disabled until a new key is provided.

## ADR-008 Web: one SPA, two hosts
Vite + React + TypeScript + Tailwind + shadcn/ui, served by nginx. `retfast.com` serves the public routes; `app.retfast.com` serves `/app/*` (root redirects to `/app`). API on `api.retfast.com` (same site → strict cookies work). Maps: MapLibre GL with OpenFreeMap vector tiles (no key).

## ADR-009 iOS tracking engine
Swift 6, SwiftUI, iOS 17+. `CLLocationManager` is the primary engine (it exposes `activityType = .airborne`, `allowsBackgroundLocationUpdates`, `pausesLocationUpdatesAutomatically = false`, `distanceFilter`, `desiredAccuracy` per profile). A `CLBackgroundActivitySession` is held while recording (iOS 17+) and `CLServiceSession(authorization: .always)` on iOS 18+. The active session id is persisted; on relaunch (`UIApplication.LaunchOptionsKey.location` / app start) the session is restored and updates restarted. No audio/VoIP tricks. Samples are written to SQLite (GRDB, WAL) before any network use. Sync uses foreground `URLSession` data tasks with batching, backoff and jitter; nothing assumes background networking continues when the app is suspended.

## ADR-010 Deployment
Dokploy project `retfast`, environment `production` (and `staging` when resources allow): Dokploy-managed `retfast-postgres` (`postgis/postgis:17-3.5`) and `retfast-redis` (`redis:7-alpine`, AOF), internal only; one compose `retfast` (GitHub source) with `migrate` (one-shot), `api`, `web`. Domains `retfast.com`, `www`, `app` → web; `api` → api:8080. Cloudflare proxy off; TLS by Traefik/Let's Encrypt. Migrations are additive (expand → migrate → contract) so a previous image can run against the new schema.

## ADR-011 Simulated data
Flights carry `is_simulated`. The simulator (`services/api/cmd/simulator`) only creates simulated flights through the public API using real accounts, uses deterministic seeds, and never creates incidents. The UI badges simulated flights ("SIM"). Production simulation only against the demo event.

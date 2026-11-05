# retfast-api

Go modular monolith for Retfast event tracking and pilot retrieval (ADR-012): REST + WebSocket
API, telemetry ingestion, transactional outbox → Redis Streams fan-out, email outbox,
and the `retfast-simulator` load/demo tool.

Contracts and design:

- `docs/architecture/api-contract.md`: authoritative API contract
- `packages/api-contract/openapi.yaml`: OpenAPI 3.1 of what is implemented
- `docs/architecture/decisions.md`: ADRs
- `docs/architecture/telemetry.md`: ingestion, schema, dedup, outbox, retention, failure modes
- `docs/architecture/security.md`: threat model, auth, authorization matrix, rate limits, audit, privacy
- `docs/testing/backend-results.md`: measured test and load results

## Layout

```
cmd/api            retfast-api: serve | migrate up|down N|status | seed | healthcheck | reset-link
cmd/simulator      retfast-simulator
internal/app       wiring, router, workers, graceful shutdown
internal/auth      Argon2id, JWT, refresh rotation + reuse detection, password/email flows, middleware
internal/authz     the single authorization policy (pure functions over event roles, REST + WebSocket)
internal/users     /me, profiles, devices, export, account deletion worker
internal/events    events, organizers, applications, members (one role per user per event), launch sites, report
internal/flights   flights, positions, GPX, live pilots read model
internal/live      GET /events/{id}/live and WebSocket snapshots (pilots + retrievals + retrievers)
internal/retrievals  retrieval state machine, pilot positions, retriever duty/positions
internal/tracking  telemetry ingestion (ADR-004), partitions, housekeeping, stats recompute
internal/tracking/stats  running statistics (pure)
internal/realtime  outbox relay (leader), stream tailer, hub, WebSocket server; bus = outbox envelope
internal/notifications  in-app notifications, PushSender interface (APNs NOT configured: no-op)
internal/email     templates (TR first), outbox, Resend sender, worker
internal/admin     /admin
internal/seed      production bootstrap (5 users, 2 admins, Çameli demo event with organizers and members)
internal/sim       deterministic route generator + simulator runner (fixtures in testdata/)
internal/platform  config, db (pool, migration runner, sqlc dbq), redisx, httpx, log, metrics, ratelimit, geo, slug
migrations/        embedded NNNN_name.up.sql / .down.sql
queries/           sqlc queries (generated code committed in internal/platform/db/dbq)
tests/             integration tests (real PostgreSQL + Redis)
```

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | (required) | e.g. `postgres://retfast:…@retfast-postgres:5432/retfast` |
| `REDIS_URL` | `redis://localhost:6379/0` | Redis is cache + fan-out only; the API keeps ingesting if it is down |
| `REDIS_PREFIX` | `rf:` | key prefix (stream `rf:rt`, `rf:latest:<event>`, `rf:rl:*`) |
| `JWT_SECRET` | dev-only fallback | **≥ 32 bytes, required outside `development`** |
| `APP_ENV` | `development` | `development` \| `staging` \| `production` (`Secure` cookies outside development) |
| `HTTP_ADDR` | `:8080` | public API |
| `METRICS_ADDR` | `:9090` | Prometheus `/metrics`; internal network only |
| `PUBLIC_WEB_URL` | `https://retfast.com` | |
| `APP_WEB_URL` | `https://app.retfast.com` | email links: `/reset-password?token=`, `/verify-email?token=`, `/app/events/<slug>` |
| `CORS_ORIGINS` | `PUBLIC_WEB_URL,APP_WEB_URL` (+ `localhost:5173` in dev) | comma list; also the WebSocket Origin allow-list |
| `RESEND_API_KEY` | unset | unset → emails are marked `failed: provider_unconfigured` |
| `MAIL_FROM` | `Retfast <noreply@retfast.com>` | |
| `COOKIE_DOMAIN` | unset | refresh cookie domain (host-only when unset) |
| `TRUSTED_PROXIES` | unset | IPs/CIDRs (Traefik) whose `X-Forwarded-For` is trusted |
| `SHUTDOWN_TIMEOUT` | `15s` | graceful drain budget (keep below compose `stop_grace_period`, 20 s) |
| `DB_MAX_CONNS` | `20` | pgx pool size |
| `ACCOUNT_DELETION_GRACE` | `336h` | 14 days |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |
| `HTTP_PORT` | unset | used only by `retfast-api healthcheck` (falls back to `HTTP_ADDR` port, then 8080) |

## Local development

Prerequisites: Go 1.27, sqlc 1.31, PostgreSQL 17/18 with PostGIS, Redis.

```sh
createdb retfast_dev
createdb retfast_test
psql -d retfast_dev  -c 'CREATE EXTENSION postgis; CREATE EXTENSION pgcrypto; CREATE EXTENSION citext;'
psql -d retfast_test -c 'CREATE EXTENSION postgis; CREATE EXTENSION pgcrypto; CREATE EXTENSION citext;'
redis-server --daemonize yes            # if not running

cd services/api
export DATABASE_URL='postgres:///retfast_dev?host=/tmp'
go run ./cmd/api migrate up             # exits 0 when there is nothing to do
go run ./cmd/api migrate status
go run ./cmd/api seed                   # idempotent; prints counts only
go run ./cmd/api serve                  # http://localhost:8080/api/v1, metrics on :9090
```

The migration creates the extensions if they are missing. That needs a role allowed to
`CREATE EXTENSION` (PostGIS is not a trusted extension). Otherwise create them once as
a superuser, as shown above.

### Seed

`retfast-api seed [--demo-starts-at 2026-11-04T00:00:00+03:00] [--demo-window-days 90] [--renew-bootstrap]`

- Creates the five bootstrap accounts with the initial password `password`. Each one has
  `must_change_password=true`, `password_expires_at=now+7d` and a verified email. Deniz and
  Altay are `platform_admin` (the only global privilege). The seed also creates pilot profiles
  and default preferences, plus the Çameli demo event (active, public, demo; settings:
  `applications_open`, `live_tracking`, `pilots_see_each_other`, `landing_prompt` on,
  `public_live_map` off). Organizers: Deniz, Altay. Members: Deniz → pilot, Altay → observer,
  Tecelli → pilot, Emre → pilot, Kübra → retriever. The launch site "Yaylacık (Çameli)" has no
  coordinates and is unverified.
- Re-running changes nothing. It never resets a user who changed their password, never
  overwrites organizer/member assignments changed in the app, and does not move the demo
  window unless you pass the flags. It prints counts only.
- `--renew-bootstrap` re-issues `password` with a fresh 7-day expiry, and only for
  accounts that never changed it.
- The seed is safe to run in production as the controlled bootstrap. Passwords are never logged.
- When email is not configured, an operator can issue a one-hour reset link:
  `retfast-api reset-link --email someone@retfast.com`. The link is printed to stdout and
  the action is audited.

## Tests

```sh
make test               # unit tests; integration tests skip
make test-integration   # unit + integration, -race, against retfast_test and Redis db 15
make lint               # gofmt -l, go vet, sqlc diff
```

Integration tests run only when `RETFAST_TEST_DATABASE_URL` is set. Each test creates
its own PostgreSQL schema and Redis key prefix, so tests run in parallel and leave
nothing behind. The Redis-outage test starts and kills its own `redis-server` on a
random port, and skips if `redis-server` is not installed.

## Simulator

Simulator accounts must be members of the event. Accounts that are not apply to it, and an
approver (`--approver-email/--approver-password`, an organizer or platform admin of the event)
approves them with the right role. For local development create one approver once:

```sh
curl -s -X POST localhost:8080/api/v1/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"sim-organizer@sim.retfast.local","password":"Sim-Organizer-Password-2026","full_name":"SIM Organizer","client":"ios"}'
psql -d retfast_dev -c "INSERT INTO user_roles (user_id, role) SELECT id, 'platform_admin' FROM users
  WHERE email = 'sim-organizer@sim.retfast.local' ON CONFLICT DO NOTHING"   # development only
```

```sh
# development: 10 pilots that land within ~2 minutes, then request retrievals; 3 simulated
# retrievers accept, drive to them at 15 m/s, pick them up and deliver them
go run ./cmd/simulator --api http://localhost:8080/api/v1 --pilots 10 --register \
  --password 'Sim-Pilot-Password-2026' --forward-ip \
  --approver-email sim-organizer@sim.retfast.local --approver-password 'Sim-Organizer-Password-2026' \
  --retrievals --retrievers 3 --land-within 2m --duration 4m

# flights only (no retrievals), 20 pilots for 2 minutes
go run ./cmd/simulator --pilots 20 --register --password 'Sim-Pilot-Password-2026' --forward-ip \
  --approver-email sim-organizer@sim.retfast.local --approver-password 'Sim-Organizer-Password-2026' --duration 2m

# existing, already-approved accounts from CSV (email,password[,name]); no --register
go run ./cmd/simulator --api https://api.retfast.com/api/v1 --accounts-csv sims.csv \
  --retrievals --retrievers-csv sim-retrievers.csv --event cameli-paragliding-demo

# load test: 60 s, no disturbances, 2 WebSocket observers, JSON report
go run ./cmd/simulator --pilots 500 --register --password 'Sim-Pilot-Password-2026' --forward-ip \
  --approver-email … --approver-password … --load --report load.json
```

- Flights and retrievals are created with `is_simulated=true`. Simulated retrievers only
  accept retrievals that are `is_simulated` (and, when the simulator also flies the pilots,
  only those pilots' requests): they never act on a real pilot's retrieval.
- `--retrievals`: after landing, each pilot creates a retrieval (pickup = landing point, a
  short note), then posts its position every `--pilot-position-interval` (10 s), walking up
  to ~300 m towards a road; after pickup it reports the car's position. Each retriever goes
  on duty at a base on the valley road 3.5–5 km south-east of launch, posts its position
  every `--retriever-interval` (3 s), accepts the nearest open simulated request (409 races
  are counted as `accept_conflicts`), drives towards the pilot's latest position along a
  curved path at `--drive-speed` (15 m/s), waits 10 s, marks picked up, drives back to base
  (at most 3 minutes) and marks delivered. Retrievals not delivered within
  `--retrieval-timeout` (20 min) are cancelled by the pilot. The report has a `retrievals`
  section with counts.
- `--duration` bounds the flying; the retrieval phase of pilots that landed continues until
  delivery or the timeout.
- `--land-within D` starts each pilot late in its (deterministic) route so it lands within
  0.3–1.0 × D; without it, `--start-offset-max` picks a random start offset.
- It refuses `--register` when `GET /meta` reports `production`, unless you pass
  `--allow-prod-register`. In production it only works in demo events.
- Routes, start offsets, notes, retriever bases and road curvature are deterministic for a
  given `--seed`. Each pilot climbs in thermals, glides, descends and lands around Çameli.
  The fixtures are `internal/sim/testdata/*.csv`; regenerate them with
  `go test ./internal/sim -run Fixtures -update`.
- Disturbances:
  - `--gps-degrade`: h_acc rises to 25–120 m for 20–60 s.
  - `--outage-prob/--outage-min/--outage-max`: samples are buffered, then resent.
  - `--inactivity-prob`: the app is suspended and no samples are taken.
  - `--dup-prob`: a batch is resent under a new batch id.
  - `--stagger`: pilot start times are spread out, which is the default. Use
    `--stagger=false` for worst-case lockstep uploads.
- `--forward-ip` is for local load tests only. It gives each account a distinct
  `X-Forwarded-For`, so per-IP auth limits behave as they would with real phones. It
  works only when the server lists the simulator host in `TRUSTED_PROXIES`, for
  example `TRUSTED_PROXIES=127.0.0.1,::1`.

## Container

`infrastructure/docker/api.Dockerfile` (build context = repository root) produces a
distroless, non-root image. It contains `/usr/local/bin/retfast-api` and
`/usr/local/bin/retfast-simulator`, exposes 8080, and its `HEALTHCHECK` runs
`retfast-api healthcheck`. Run `retfast-api migrate up` as a one-shot before `serve`.
`serve` handles SIGTERM: it marks itself not ready, closes WebSockets with 1012, drains
in-flight requests, stops the workers and exits within `SHUTDOWN_TIMEOUT`.

## Operational notes

- Health: `GET /api/v1/health/live` and `GET /api/v1/health/ready`. Readiness returns
  503 when PostgreSQL is down or the instance is draining. It returns 200 with
  `"status":"degraded"` when only Redis is down.
- Metrics:
  - `retfast_telemetry_samples_total{result}`
  - `retfast_telemetry_ingest_seconds`
  - `retfast_outbox_depth`
  - `retfast_ws_connections`
  - `retfast_ws_dropped_total{reason}`
  - `retfast_email_failures_total{reason}`
  - `retfast_http_request_duration_seconds{method,route,status}`
  - `retfast_push_unconfigured_total`
  - `retfast_partition_maintenance_errors_total`
  - `retfast_retrieval_transitions_total{kind}`
- Retriever positions and retrieval pilot positions are pruned after 30 days by the hourly
  housekeeping (see `docs/architecture/security.md`).
- APNs is not configured. Notifications are stored and listed by `GET /notifications`.
  The push worker uses `UnconfiguredAPNs`, which logs `apns_unconfigured` and sets
  `push_status=unconfigured` (or `no_device`). A real sender only needs to implement
  `notifications.PushSender`.

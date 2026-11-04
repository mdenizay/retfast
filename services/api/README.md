# retfast-api

Go modular monolith for Retfast live tracking and search-and-rescue: REST + WebSocket
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
internal/authz     the single authorization policy (pure functions, REST + WebSocket)
internal/users     /me, profiles, devices, export, account deletion worker
internal/events    events, memberships (one table with a role column), launch sites, report
internal/flights   flights, positions, GPX, live snapshot read model
internal/tracking  telemetry ingestion (ADR-004), partitions, housekeeping, stats recompute
internal/tracking/stats  running statistics (pure)
internal/realtime  outbox relay (leader), stream tailer, hub, WebSocket server; bus = outbox envelope
internal/emergencies  incidents, state machine, rescue assignments/team, responder audit
internal/notifications  in-app notifications, PushSender interface (APNs NOT configured: no-op)
internal/email     templates (TR first), outbox, Resend sender, worker
internal/admin     /admin
internal/seed      production bootstrap (5 users + Çameli demo event)
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
  `must_change_password=true`, `password_expires_at=now+7d` and a verified email. The
  seed also creates their pilot profiles and default preferences (`event`, private
  profile), plus the Çameli demo event (active, public, all settings on). The event's
  launch site "Yaylacık (Çameli)" has no coordinates and is unverified.
- Re-running changes nothing. It never resets a user who changed their password, and it
  does not move the demo window unless you pass the flags.
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

```sh
# development: register sim-001..020@sim.retfast.local and fly them in the demo event
go run ./cmd/simulator --api http://localhost:8080/api/v1 --pilots 20 \
  --register --password 'Sim-Pilot-Password-2026' --forward-ip --duration 2m

# existing accounts from a CSV (email,password[,name]); no --register
go run ./cmd/simulator --api https://api.retfast.com/api/v1 --accounts-csv sims.csv --event cameli-paragliding-demo

# load test: 60 s, no disturbances, 2 WebSocket observers, JSON report
go run ./cmd/simulator --pilots 500 --register --password 'Sim-Pilot-Password-2026' --forward-ip --load --report load.json
```

- Flights are created with `is_simulated=true`. The simulator never creates incidents.
- It refuses `--register` when `GET /meta` reports `production`, unless you pass
  `--allow-prod-register`. In production it only flies in demo events.
- Routes are deterministic for a given `--seed`. Each pilot climbs in thermals, glides,
  descends and lands around Çameli. The fixtures are `internal/sim/testdata/*.csv`;
  regenerate them with `go test ./internal/sim -run Fixtures -update`.
- Disturbances:
  - `--gps-degrade`: h_acc rises to 25–120 m for 20–60 s.
  - `--outage-prob/--outage-min/--outage-max`: samples are buffered, then resent.
  - `--inactivity-prob`: the app is suspended and no samples are taken.
  - `--dup-prob`: a batch is resent under a new batch id.
  - `--stagger`: pilot start times are spread out, which is the default. Use
    `--stagger=false` for worst-case lockstep uploads.
- `--forward-ip` is for local load tests only. It gives each pilot a distinct
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
- APNs is not configured. Notifications are stored and listed by `GET /notifications`.
  The push worker uses `UnconfiguredAPNs`, which logs `apns_unconfigured` and sets
  `push_status=unconfigured` (or `no_device`). A real sender only needs to implement
  `notifications.PushSender`.

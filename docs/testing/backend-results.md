# Backend test and load results

Measured on 2026-11-04 against branch `rebuild` (`services/api`). Every number on this
page comes from a run made that day. Nothing is extrapolated.

## Machine and setup

| | |
|---|---|
| Machine | Apple M4, 10 cores, 16 GB RAM, macOS (Darwin 27.0.0, arm64) |
| Go | 1.27.1 |
| PostgreSQL | 18.6 (Homebrew), PostGIS 3.6.4, Unix socket, default `postgresql.conf` |
| Redis | 8.10.3, localhost, no persistence tuning |
| API | one `retfast-api serve` instance, `DB_MAX_CONNS=40`, `LOG_LEVEL=warn`, `TRUSTED_PROXIES=127.0.0.1,::1` |
| Load generator | `retfast-simulator`, on the **same machine** as the API, PostgreSQL and Redis, so all of them share the CPU |

Everything runs over loopback, so these numbers leave out network latency and TLS.
Production runs on Dokploy behind Traefik, with a different host and PostgreSQL 17.
Treat the numbers as relative capacity indicators, not production SLOs.

## Automated tests

```
gofmt -l .        → (no files)
go vet ./...      → ok
sqlc diff         → clean
RETFAST_TEST_DATABASE_URL='postgres:///retfast_test?host=/tmp' RETFAST_TEST_REDIS_URL='redis://localhost:6379/15' \
  go test -race -count=1 ./...
→ 15 packages ok, 62 top-level tests passed, 0 failed, 0 skipped (integration package: 10.9 s)
```

Integration coverage (`services/api/tests`):

- **Auth**:
  - register, login, logout, bad password;
  - refresh rotation, and reuse of a rotated token revoking the whole family (audited);
  - the web cookie's attributes, and refresh being refused from a foreign Origin;
  - the password-change gate: `/me` is allowed, other endpoints return 403 `password_change_required`;
  - the password policy, including refusing the bootstrap password;
  - bootstrap expiry and `--renew-bootstrap`;
  - forgot, reset, and single-use reset tokens;
  - email verification;
  - the login rate limit, 429 with `Retry-After`;
  - the email worker marking mail `provider_unconfigured` and purging bodies.
- **Seed**: run twice; it yields exactly 5 users, 1 event, 1 unverified launch site, 2
  organizers and 3 participants, with all bootstrap flags set. The demo window does not
  move on re-seed.
- **Events**:
  - create, join, leave and archive;
  - restricted and draft events are hidden from outsiders and guests;
  - participant listing scope, organizer-only PATCH, launch sites and the report;
  - the last organizer cannot leave, and closed registration is enforced.
- **Telemetry**:
  - the same batch twice gives an identical classification;
  - overlapping batches are reported as duplicates;
  - out-of-order batches mark stats dirty, and the recompute then fixes them;
  - a `sample_id` collision, or the same seq with a different id, is reported as `sample_conflict`;
  - an in-batch repeat is reported as a duplicate;
  - each rejection reason is checked, and Core Location sentinels are normalised;
  - 422 for structurally broken batches, gzip bodies, the `flight_ended` cut-off and GPX export;
  - rows are stored once, in a monthly partition.
- **Redis outage**: the test starts its own `redis-server` and kills it. Ingestion keeps
  returning 200, the outbox accumulates, readiness reports `degraded`, and the auth rate
  limit falls back to memory. Once Redis restarts, the outbox drains to 0 and the stream
  holds every message.
- **WebSocket**:
  - auth, subscribe, and a snapshot with a trail;
  - live position delivery;
  - a private flight is not delivered to another member;
  - a guest sees only public flights, labelled with the display name;
  - forbidden restricted-event, private-flight and incidents subscriptions;
  - `since` replays every missed message;
  - a bad token closes with 4001, and a drain closes with 1012.
- **Incidents**:
  - `is_test` is allowed only in events with `emergency_testing`;
  - idempotent create, and the id cannot be hijacked;
  - responders are notified;
  - strangers get 404, and the owner cannot acknowledge their own incident;
  - the organizer sees emergency contacts (audited) and the private flight only while
    the incident is open;
  - acknowledge, assignment state machine, rescue availability, position and team;
  - notes, responding, resolved, and terminal states refusing further changes;
  - 11 responder audit actions are present, and no audit row contains coordinates;
  - list scoping per role;
  - realtime incident delivery to rescue operators.
- **Graceful restart**: the test uses the real `App.Serve` path. Four concurrent senders
  were running when a SIGTERM-equivalent cancellation arrived. All acknowledged samples
  were durable. In the latest run, 3,000 samples were acknowledged before shutdown, and
  shutdown took 1.07 s. A fresh instance then got a full resend of every batch and
  stored exactly as many samples as were sent, with no rejections.
- **Other**:
  - `/me`, preferences and the pilot profile;
  - the public profile never shows licence or emergency data;
  - device upsert;
  - export (flights and positions, no push token);
  - deletion request, cancel, the 14-day grace, then the worker anonymising the user and
    deleting flights, positions and devices;
  - notifications and push status `no_device`;
  - admin users, roles and disable (effective immediately), reset, audit and stats;
  - the partition maintenance moving rows out of the default partition, with the GIST
    index present on the new partition.

Unit tests cover:

- Argon2id parameters and PHC parsing;
- JWT (expiry, wrong key, `alg=none`, tampering);
- password policy and email normalisation;
- the authorization matrix (live visibility, event access, flight and incident access);
- stats (haversine, incremental = recompute, 3 m hysteresis, h_acc > 50 skipped, gaps,
  glitch filter);
- sample validation and structure;
- route simplification;
- hub per-message decisions, slow-consumer 4008, pending buffer and dedup;
- incident and assignment state machines;
- email templates (escaping) and Resend error classification;
- config validation;
- the rate limiter's memory fallback and window reset;
- client-IP resolution behind trusted proxies;
- the migration loader;
- simulator route plausibility, determinism and the pinned CSV fixtures.

The `serve` binary was also checked by hand:

- `SIGTERM` to process exit took **1.01 s** after the 500-pilot runs.
- `retfast-api healthcheck` exits 0 against a ready server and 1 when nothing listens.
- `migrate up` on an up-to-date database prints `migrations applied: 0` and exits 0.

The Docker image was **not** built: Docker is not installed on this machine. The
in-image build commands were checked by cross-compiling static `linux/amd64` and
`linux/arm64` binaries (`CGO_ENABLED=0`).

## Simulator runs

All runs use the seeded demo event `cameli-paragliding-demo` and a fresh `retfast_dev`
database. Accounts `sim-NNN@sim.retfast.local` were created with `--register`, with
`--forward-ip` giving each pilot a distinct client IP. Samples are taken at 1 Hz and
uploaded in 5 s batches, which is 5 samples per batch per pilot. "Ingest latency" is the
client-measured round trip of `POST /telemetry/batches`.

The two WebSocket delays are defined as follows:

- **WS server→client** is the client receive time minus the server receive time of the
  batch (`server_received_ms`). It covers commit, NOTIFY, relay, XADD, XREAD, the hub
  and the socket.
- **WS sample t→client** is measured from the GPS timestamp of the newest sample in the
  batch, so it also includes the time the sample waited for its batch upload.

Each batch publishes one live position, its newest sample, per subscriber.

### 20 pilots, 60 s, default disturbances (`--gps-degrade 0.1 --outage-prob 0.02 --inactivity-prob 0.01 --dup-prob 0.03`, seed 42)

| metric | value |
|---|---|
| samples generated / accepted | 1,180 / 1,180 |
| batches ok / failed / retries | 249 / 0 / 0 |
| injected duplicate resends → duplicates reported | 9 → 45 |
| rejected | 0 |
| ingest latency p50 / p95 / p99 / max | 13.4 / 63.0 / 66.3 / 66.9 ms |
| WS server→client p50 / p95 / p99 | 10.7 / 53.2 / 55.8 ms (240 messages, 1 observer) |
| flights ended | 20 / 20 |
| DB check | 1,180 rows in `flight_positions` = 1,180 in `telemetry_sample_keys`, all in `flight_positions_p202611`; outbox depth 0 |

No outage was drawn in this 60 s run, so a second run turned the disturbance rates up.

### 20 pilots, 90 s, heavy disturbances (`--outage-prob 0.6 --outage-min 15s --outage-max 40s --inactivity-prob 0.3 --dup-prob 0.2 --gps-degrade 1.0`, seed 7)

| metric | value |
|---|---|
| network outages simulated | 17 (up to 40 samples buffered per pilot, all delivered afterwards) |
| samples generated / accepted | 1,389 / 1,389 (samples are missing during simulated app suspension, as intended) |
| injected duplicate resends → duplicates reported | 44 → 282 |
| batches ok / failed | 276 / 0 |
| rejected | 0 |
| ingest latency p50 / p95 / p99 | 4.9 / 21.1 / 27.6 ms |
| unsent at end / flights ended | 0 / 20 |

### Load: 100 pilots, 60 s, lockstep (all pilots upload in the same instant), 2 WS observers, seed 100

This run was made before the `--stagger` option existed, so every pilot started at the
same moment.

| metric | value |
|---|---|
| throughput | 98.6 acked samples/s, 20.4 batches/s |
| samples accepted / failures / retries / rejected | 5,800 / 0 / 0 / 0 |
| ingest latency p50 / p95 / p99 / max | 38.0 / 75.5 / 82.1 / 85.4 ms |
| WS server→client p50 / p95 / p99 / max | 13.7 / 35.8 / 68.4 / 72.5 ms (2,400 messages) |
| WS sample t→client p50 / p95 / p99 | 45.2 / 748.3 / 768.8 ms |

### Load: 500 pilots, 60 s, lockstep (`--stagger=false`), 2 WS observers, seed 500

| metric | value |
|---|---|
| throughput | 492.2 acked samples/s, 98.4 batches/s |
| samples accepted / failures / retries / rejected | 27,500 / 0 / 0 / 0 |
| ingest latency p50 / p95 / p99 / max | 49.1 / 87.0 / 108.1 / 114.8 ms |
| WS server→client p50 / p95 / p99 / max | 30.3 / 78.5 / 107.7 / 129.0 ms (11,000 messages) |
| WS sample t→client p50 / p95 / p99 | 83.8 / 127.9 / 128.7 ms |
| flights ended / unsent at end | 500 / 0 |

### Load: 500 pilots, 60 s, staggered start (default), 2 WS observers, seed 501

| metric | value |
|---|---|
| throughput | 471.8 acked samples/s, 97.8 batches/s |
| samples accepted / failures / retries / rejected | 27,246 / 0 / 0 / 0 |
| ingest latency p50 / p95 / p99 / max | 3.2 / 58.7 / 108.2 / 128.6 ms |
| WS server→client p50 / p95 / p99 / max | 3.0 / 28.5 / 55.3 / 70.4 ms (11,292 messages) |
| WS sample t→client p50 / p95 / p99 | 4.6 / 394.8 / 971.8 ms |
| flights ended / unsent at end | 500 / 0 |

Server logs held no `ERROR` lines across all runs. Outbox depth returned to 0 after
every run.

### Reading the numbers

- In the 500-pilot runs, a single instance on this laptop absorbed 500 pilots at 1 Hz, about
  490 samples/s and 100 batch transactions/s, with no failures. In the 500-pilot lockstep
  run it handled bursts of 500 simultaneous batches with a maximum of 114.8 ms.
- With desynchronised uploads, as real phones produce, the median ingest is about 3 ms
  and the median fan-out to WebSocket clients is about 3 ms.
- The "sample t→client" tail of up to about 1 s comes from samples waiting for the 5 s
  batch window, plus burst queuing at the very start and end of a run. It is not
  pipeline latency.
- **Not measured:** runs longer than 90 s (partition growth, autovacuum, memory over
  hours), more than 2 WebSocket observers, several API instances sharing one Redis
  stream, and production hardware. Each of these deserves its own run before relying
  on capacity beyond what is shown here.

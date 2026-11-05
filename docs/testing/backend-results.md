# Backend test and load results

Branch `rebuild` (`services/api`). The automated tests and the retrieval simulation were
re-run on **2026-11-05** after the event-tracking + retrieval pivot (ADR-012). The load
runs further down were measured on 2026-11-04, before the pivot; the ingestion path they
measure (telemetry batches → outbox → Redis → WebSocket) did not change, but they have not
been repeated on the new code. Nothing is extrapolated.

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

## Automated tests (2026-11-05)

```
gofmt -l .        → (no files)
go vet ./...      → ok
sqlc diff         → clean
RETFAST_TEST_DATABASE_URL='postgres:///retfast_test?host=/tmp' RETFAST_TEST_REDIS_URL='redis://localhost:6379/15' \
  go test -race -count=1 ./...
→ run 1: 15 packages ok, 0 failed (integration package 15.1 s)
→ run 2: 15 packages ok, 0 failed (integration package 12.2 s)
go test -race -count=3 ./tests/   → ok (30.7 s), no flakes
```

66 top-level tests (23 integration tests in `services/api/tests`), 0 skipped with the
integration environment set.

Integration coverage (`services/api/tests`, real PostgreSQL 18 + PostGIS and Redis):

- **Auth** (unchanged): register (now `roles: []`), login, logout, refresh rotation and
  reuse detection, web cookie and foreign-Origin refusal, password-change gate, password
  policy, bootstrap expiry and `--renew-bootstrap`, forgot/reset, email verification,
  login rate limit, email worker `provider_unconfigured`.
- **Seed** (`TestSeedIdempotent`): first run creates 5 users, 1 event, 1 launch site,
  2 organizers, 5 memberships; second run creates nothing and does not overwrite a role
  changed in between; exactly 2 `platform_admin` rows (Deniz, Altay); memberships Deniz →
  pilot, Altay → observer, Tecelli → pilot, Kübra → retriever, Emre → pilot; bootstrap
  flags; demo event fields and settings (`public_live_map` false); demo window unchanged.
- **Events/organizers** (`TestEventCreationAndOrganizers`): only platform admins create
  events (plain users and organizers get 403); default settings; organizers assigned at
  creation and via `POST /organizers` (admin-only, idempotent), removal admin-only;
  organizer PATCH/report/launch sites/archive; restricted/draft hidden; `mine=true`.
- **Applications/members** (`TestApplicationsAndMembers`): apply with a message only (no
  role), duplicate pending → 409, **4 concurrent applies → exactly one 201**; organizer-only
  listing; approve requires a role (422 without/invalid) and creates the membership in the
  same transaction; re-deciding → 409; applicant notification (`application`); member
  applying again → 409; reject with note; withdraw only by the applicant (others 404);
  `applications_open=false` → 403; direct add; organizers see phones (one
  `privacy.phone_revealed` audit row), members do not; outsiders 403; role change
  (audited, `from`/`to`); leave; remove; organizers see removed members.
- **Live visibility matrix** (`TestLiveVisibilityMatrix`): organizer/admin/observer see
  both flights + retrievals + retrievers; pilot sees both with `pilots_see_each_other`,
  only own without (and 404 on the other flight); retriever gets 200 with `pilots: []` but
  sees the open request (pickup only, no `pilot_position`), 403 on `GET /flights?event_id=`
  and 404 on a flight; outsider 403 / guest 401 without `public_live_map`; with it, guests
  and outsiders see positions with display names and no retrievals.
- **Retrieval lifecycle** (`TestRetrievalLifecycle`): only pilots create; idempotent
  create (201 then 200), foreign id 409; second open retrieval → 409 carrying the open
  one; non-holding retriever sees no phone/position/timeline; **two retrievers race on
  accept → exactly one 200, one 409**; release → requested; accept idempotent for the
  holder; phones: holder sees the pilot's, pilot sees the holder's, observer none,
  organizer both, other retriever 404; reveal audited with `revealed_to`; invalid
  transitions (delivered from accepted, picked-up by non-holder/pilot, cancel by
  retriever, release after pickup, cancel/position after delivery) → 403/409;
  assign/reassign by organizer only, to retrievers only (422 otherwise), previous holder
  loses access; pilot position owner-only and validated; notes; picked up → delivered
  (holder loses the pilot's phone after delivery); full timeline; pilot `retrieval`
  notifications; request notified retrievers and organizers; cancel by pilot (reason) and
  by organizer; per-role list counts; report medians; ≥ 14 `retrieval.*` audit rows.
- **Retriever duty/positions** (`TestRetrieverDutyAndPositions`): position refused off duty
  (409); duty by a pilot 403; observer sees all retrievers; a pilot sees none until a
  retriever accepts their retrieval, then exactly that one plus `retriever_position` in
  the retrieval; an unrelated pilot sees nothing; a retriever sees only themself; history
  row stored.
- **Retrieval realtime** (`TestRetrievalRealtimeDelivery`): guest subscription to
  `retrievals:` refused; a new request reaches both retrievers without phone/position; on
  accept the holder gets the full retrieval (pilot phone), the other retriever a
  `removed` message, the observer a phone-less copy; `pilot_position` reaches the holder,
  observer and pilot but not the other retriever or an unrelated pilot;
  `retriever_position` reaches observer, served pilot and the retriever but not the
  other retriever or the unrelated pilot (asserted with a marker message); retriever
  snapshot holds only open requests and no `pilots`; a role change (retriever → observer)
  takes effect on the open subscription.
- **WebSocket** (`TestRealtimeSubscribeFilterAndReplay`): observer snapshot with trail; a
  pilot with `pilots_see_each_other=false` receives only their own positions, and after
  the setting is switched on mid-subscription receives the other pilot's; guest without
  public map → `unauthorized`; outsider → forbidden on restricted event, flight and
  `retrievals:`; the old `incidents` channel → `unknown_channel`; `since` replay; bad
  token → 4001; drain → 1012.
- **Telemetry, Redis outage, graceful restart, partitions, me/export/deletion,
  notifications/admin**: as before (admin now toggles `is_platform_admin`; the
  demoted admin immediately loses `/admin`; `/users/search` organizer/admin only).

Unit tests: authz (event policies, the full live matrix incl. guests/outsiders/
restricted, retrieval visibility, phone and position rules, actions), the retrieval
state machine (every action × status), hub decisions (event/flight/retrievals channels,
redaction of phones/positions, `removed` variants, runtime `event_changed` and
`member_changed` fact updates), plus the unchanged auth, stats, validation,
simplification, email, config, rate limiter, migration and simulator route tests.

## Retrieval simulation (2026-11-05)

Local `retfast-api serve` (`APP_ENV=development`, `REDIS_URL=redis://localhost:6379/2`,
`TRUSTED_PROXIES=127.0.0.1,::1`) against a freshly reset and seeded `retfast_dev`. A
dev-only approver `sim-organizer@sim.retfast.local` was registered and given
`platform_admin` with SQL; every simulator account went through
**apply → approve (role chosen by the approver)** before flying (15 approved applications
in run 2). Same machine as below.

```sh
retfast-simulator --pilots 10 --register --password … --forward-ip \
  --approver-email sim-organizer@sim.retfast.local --approver-password … \
  --retrievals --retrievers N --land-within 2m --duration … --seed S
```

| | Run 1 (seed 42, 3 retrievers, `--duration 4m`) | Run 2 (seed 7, 5 retrievers, `--duration 3m`, 2 WS observers) |
|---|---|---|
| Build | before applications lost `requested_role` | **final build** |
| Pilots landed / flights ended | 10 / 10 | 10 / 10 |
| Retrievals created → accepted → picked up → **delivered** | 10 → 10 → 10 → **10** | 10 → 10 → 10 → **10** |
| Cancelled by timeout | 0 | 0 |
| Accept races lost (409, counted, then retried on another request) | 3 | 6 |
| Pilot positions / retriever positions sent | 508 / 1,185 | 214 / 846 |
| Median request→accept / accept→pickup / pickup→delivery (from the DB) | 218 s / 120 s / 110 s | 2 s / 108 s / 98 s |
| Telemetry accepted / duplicates / rejected / failed batches | 858 / 17 / 0 / 0 | 813 / 21 / 0 / 0 |
| Ingest latency p50 / p95 / p99 / max | 5.3 / 34.1 / 298.1 / 905 ms | 4.6 / 27.8 / 39.8 / 51.5 ms |
| WS server→client (event channel) p50 / p95 / max | – | 3.8 / 26.5 / 48.3 ms (334 messages) |
| Wall time | 1,220 s | 527 s |
| Client errors / server `ERROR` logs / outbox rows left | 0 / 0 / 0 | 0 / 0 / 0 |

Notes:

- Run 1's long request→accept median is queueing: 3 retrievers each serve one pilot at a
  time (drive ≈ 1–4 km at 15 m/s, 10 s pickup, drive back to base ≤ 3 min), so later
  requests waited. With 5 retrievers (run 2) most requests were accepted within seconds.
- Duplicates come from the simulator's injected re-sends (`--dup-prob 0.03`); all were
  classified `duplicate`, none stored twice.
- The simulator accounts have no phone numbers, so these runs wrote no
  `privacy.phone_revealed` rows; phone reveal and its audit are covered by the
  integration tests.
- Run 1 had one slow batch (905 ms) while 13 accounts were being registered and approved
  in parallel (Argon2id hashing on the same CPU).
- After the runs `retfast_dev` was reset again to the plain seed for the web/iOS
  end-to-end checks.

## Simulator runs (2026-11-04, pre-pivot code)

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

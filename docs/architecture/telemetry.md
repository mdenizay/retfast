# Telemetry pipeline

Describes what `services/api` implements today. Authoritative decisions: ADR-004 (storage and de-duplication) and ADR-005 (outbox → Redis Streams → WebSocket) in `decisions.md`. Wire formats: `api-contract.md`.

Code map:

| Concern | Code |
|---|---|
| Ingestion endpoint and transaction | `internal/tracking/ingest.go` |
| Statistics | `internal/tracking/stats/stats.go` |
| Partitions, housekeeping, stats recompute | `internal/tracking/maintenance.go` |
| Outbox envelope | `internal/realtime/bus/bus.go` |
| Outbox relay (leader) | `internal/realtime/relay.go` |
| Stream tailer, hub, per-message authz | `internal/realtime/hub.go` |
| WebSocket protocol | `internal/realtime/ws.go` |
| Live snapshot read model | `internal/flights/live.go` |
| Flight end, GPX, positions paging | `internal/flights/handlers.go` |
| Schema | `migrations/0001_init.up.sql`, queries in `queries/*.sql` (sqlc) |

## 1. End-to-end flow

```
iOS (SQLite buffer)
  │ POST /api/v1/telemetry/batches  (Bearer, ≤500 samples, ≤512 KB, gzip ok)
  ▼
API instance ── one PostgreSQL transaction ───────────────────────────────┐
  1. SELECT flight ... FOR UPDATE OF f        (serialises batches per flight)
  2. owner check (403 if caller is not the pilot, 404 if flight unknown)
  3. INSERT telemetry_batches ON CONFLICT DO NOTHING
       └ conflict → return the stored classification (replay), no writes
  4. per-sample validation; in-batch repeats resolved
  5. INSERT telemetry_sample_keys ... ON CONFLICT DO NOTHING RETURNING seq
  6. COPY new samples into flight_positions (routed to monthly partition)
  7. fold new samples into running stats; update last_* if seq is newest
  8. INSERT realtime_outbox (one "position" envelope) + pg_notify('rf_outbox')
  9. UPDATE telemetry_batches.response
 COMMIT ─────────────────────────────────────────────────────────────────┘
  │ 200 {accepted, duplicate, rejected, max_acked_seq, server_time}
  ▼
Relay (exactly one active instance; pg_try_advisory_lock)
  LISTEN rf_outbox, wakes on NOTIFY or every 1 s
  SELECT ≤500 rows ORDER BY id → Redis pipeline:
     HSET <prefix>latest:<event_id> <flight_id> <envelope>  (EXPIRE 24 h)
     XADD <prefix>rt MAXLEN ~ 100000 * e <envelope>
  → DELETE the published row ids
  ▼
Every API instance: Tailer  XREAD BLOCK 1 s COUNT 1000 <prefix>rt
  ▼
Hub.Dispatch → channels event:<id>, flight:<id>, retrievals:<event_id>
  per subscription: authz decision on the envelope's current facts
  ▼
WebSocket client (bounded 256-message queue per connection)
```

The HTTP response is sent only after `COMMIT`; anything listed in `accepted` or `duplicate` is durable in PostgreSQL. Redis is never on the acknowledgement path.

The default key prefix is `rf:` (`REDIS_PREFIX`), so the stream is `rf:rt` and the latest hash is `rf:latest:<event_id>`.

### Outbox envelope

`bus.Envelope` holds the authorization facts as well as rendered payloads, so the hub can filter each message without querying the database:

| Field | Meaning |
|---|---|
| `type` | `position`, `flight`, `retrieval`, `pilot_position`, `retriever_position`; internal: `member_changed`, `event_changed` |
| `event_id`, `flight_id`, `owner_id` | routing and flight ownership facts |
| `retrieval_id`, `pilot_id`, `retriever_id`, `prev_retriever_id`, `status` | retrieval facts (`prev_retriever_id` is set on release/reassignment so the previous holder learns it lost the retrieval) |
| `user_id`, `pilot_ids` | `retriever_position`: the retriever and the pilots whose open retrievals they hold; `member_changed`: the user |
| `access`, `event` | internal fact updates: a user's new `{organizer, role}` for the event, or the event's new policy facts (visibility, status, `public_live_map`, `pilots_see_each_other`, …) |
| `data` | contract payload for fully authorized viewers (for `retrieval`: the full Retrieval incl. phones; the hub strips phones, `pilot_position`, `retriever_position` and the timeline per subscriber) |
| `public_data` | guest variant of flight messages: pilot `full_name` replaced by the display name; empty means guests never receive it |
| `srv_ms` | server receive time (unix ms), rendered as `server_received_ms`, used to measure propagation delay |

Producers, all inside the transaction of the change: ingestion (one `position` per batch, carrying only the newest sample and only if it is newer than the stored last position), flight create/patch/end/abandon (`flight`), every retrieval state change and note (`retrieval`), `POST /retrievals/{id}/position` (`pilot_position`), retriever duty/position (`retriever_position`), membership/organizer changes (`member_changed`) and event patches/archive (`event_changed`). Nothing uses Redis Pub/Sub. Internal envelopes update the facts of open subscriptions on every instance and are never sent to clients.

## 2. Schema

### flight_sessions (one row per flight)

- `id uuid` PK (client-generated), `public_id` (10 chars `[a-z0-9]`, unique), `pilot_id`, `event_id` (nullable), `status` (`recording|ended|abandoned`), `is_simulated`, `started_at`, `ended_at`, `device_platform`, `device_app_version`.
- Denormalised newest position: `last_sample_id, last_seq, last_t, last_lat, last_lon, last_gps_alt_m, last_h_acc_m, last_v_acc_m, last_speed_ms, last_course_deg, last_position_received_at`, plus `last_received_at` (last time any sample was accepted).
- Statistics: `sample_count, distance_m, max_gps_alt_m, min_gps_alt_m, max_ground_speed_ms, total_ascent_m, total_descent_m, gap_count, first_sample_t, last_sample_t`; running state `stats_state jsonb` (last applied seq/t, distance anchor, hysteresis reference altitude); `stats_dirty bool`.
- Indexes: `(pilot_id, started_at DESC)`, `(event_id, status, last_received_at DESC)`, `(status, last_received_at)`, partial `(stats_dirty) WHERE stats_dirty`.

### flight_positions (partitioned)

- `PARTITION BY RANGE (received_at)`, the server clock (device clocks can be wrong). Monthly partitions named `flight_positions_pYYYYMM` with `[first day 00:00 UTC, next month)`, plus `flight_positions_default`.
- Columns: `flight_id` (FK → flight_sessions ON DELETE CASCADE), `seq`, `sample_id`, `batch_id`, `t` (GPS time), `device_t`, `received_at`, `lat`, `lon`, `gps_alt_m`, `h_acc_m`, `v_acc_m`, `speed_ms`, `course_deg`, `meta jsonb`.
- `geog geography(Point,4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lon, lat),4326)::geography) STORED`. The application never reads or writes geography; it uses `lat`/`lon`.
- Indexes are declared on the parent and therefore exist on every partition: btree `(flight_id, seq)`, GIST `(geog)`, BRIN `(received_at)`.
- Originals are stored exactly as received, except for the normalisations listed in section 4.

### telemetry_sample_keys (unpartitioned)

`PRIMARY KEY (flight_id, seq)`, `UNIQUE (sample_id)`, `received_at`. A partitioned table cannot enforce a unique constraint that excludes the partition key, so global de-duplication lives here (ADR-004).

### telemetry_batches

`batch_id` PK, `flight_id`, `user_id`, `response jsonb` (the full classification), `created_at` (indexed). Pruned after 7 days.

### realtime_outbox

`id bigserial` PK, `kind`, `event_id`, `flight_id`, `payload jsonb` (the envelope), `created_at`. Rows are deleted once they have been published.

### Retrieval data

- `retrievals`: client-generated `id`, `event_id`, `pilot_id`, `flight_id`, `status`, pickup point (`pickup_*`), `note`, `retriever_id`, per-state timestamps, `cancelled_by`, `cancel_reason`, `delivery_note`, `is_simulated`, and the latest shared pilot position (`pp_seq`, `pp_sample_id`, `pp_t`, `pp_lat`, `pp_lon`, `pp_gps_alt_m`, `pp_h_acc_m`, `pp_received_at`; initialised from the pickup). Partial unique index `(event_id, pilot_id) WHERE status IN ('requested','accepted','picked_up')` enforces one open retrieval per pilot per event. CHECKs tie `retriever_id` to the status.
- `retrieval_updates`: the timeline (`requested|accepted|released|assigned|picked_up|delivered|cancelled|note`, actor, body).
- `retrieval_positions`: history of pilot positions shared while open (pruned after 30 days).
- `retriever_states`: latest duty flag and position per (event, retriever); `retriever_positions`: history (pruned after 30 days).

## 3. De-duplication and idempotency

Classification of each submitted sample:

| Outcome | When |
|---|---|
| `accepted` | key `(flight_id, seq)` was new and the sample is stored |
| `duplicate` | `(flight_id, seq)` already exists with the **same** `sample_id` (an earlier batch), or the same sample is repeated inside the batch |
| `rejected: sample_conflict` | `(flight_id, seq)` exists with a different `sample_id`; or the `sample_id` is already used by a different `(flight_id, seq)`; or within one batch the same seq has two ids or the same id has two seqs |
| `rejected: <validation reason>` | see section 4 |

Notes:

- `accepted` and `duplicate` are both acknowledgements: the client may mark them synced. `rejected` is permanent; the client keeps the sample and does not retry it.
- `sample_conflict` is the server's name for ADR-004's "rejected as invalid (client bug)". The contract's reason list does not include it, so clients must treat unknown reasons as permanent rejections.
- **Batch replay:** re-sending a `batch_id` returns the stored response with a fresh `server_time`. A `batch_id` reused for another flight or user returns 409. Two concurrent requests with the same `batch_id` serialise on the flight row lock and the batch primary key, so the second one sees the stored result. After the 7-day prune a replayed batch is processed again; every sample then comes back as `duplicate` (still acknowledged).
- **Out-of-order and late batches** are accepted. Ordering is by `seq`, then `t`.
- **`max_acked_seq`** is the highest seq in `accepted ∪ duplicate` **of this batch**, or `null` if none. It is not a flight-wide contiguous watermark.
- **Structural errors return 422 for the whole batch:** missing or nil `batch_id` or `flight_id`, a sample count outside 1–500, a sample without a UUID `id`, or a `seq` outside `[0, 2^31)`. A per-sample outcome cannot be reported without these fields.

## 4. Validation and normalisation

Checks run in this order (`ValidateSample`); the first failure is the reason:

| Reason | Rule |
|---|---|
| `invalid_coordinates` | lat/lon missing, NaN, outside WGS84 ranges, or exactly `(0, 0)` (null island); `gps_alt_m` outside `[-1000, 15000]` |
| `invalid_accuracy` | `h_acc_m` missing, ≤ 0 or > 10 000; `v_acc_m` > 10 000 |
| `timestamp_out_of_range` | `t` missing, later than server now + 10 min, or earlier than flight `started_at` − 1 h |
| `flight_ended` | flight has `ended_at` and `t` > `ended_at` + 10 min |
| `invalid_speed` | `speed_ms` > 150 m/s |

Normalisations (the sample is kept):

- Core Location sentinels: a negative `speed_ms` becomes null, a negative `v_acc_m` becomes null, and `course_deg` outside `[0, 360]` becomes null.
- `meta` larger than 2 KB is dropped; invalid or `null` meta is stored as SQL NULL.

## 5. Statistics

`stats.State.Apply` is a pure function. The same code serves incremental ingestion and full recompute.

- Samples are applied in `(seq, t)` order. `sample_count`, `first_sample_t` and `last_sample_t` cover every stored sample.
- **Out of order:** a sample whose seq is ≤ the highest seq already applied is counted, but it is not folded into the path-dependent aggregates. `stats_dirty` is set instead. The recompute worker (every 30 s, up to 50 flights per run, each under the flight row lock) rebuilds all statistics from `flight_positions` and clears the flag. `POST /flights/{id}/end` always recomputes synchronously.
- **Gaps:** consecutive applied samples more than 10 s apart increment `gap_count`. This uses all samples, whatever their accuracy.
- Distance, altitude extremes, ascent/descent and max speed use only samples with `0 < h_acc_m ≤ 50`.
- **Distance:** haversine (R = 6 371 008.8 m) between consecutive good fixes. A jump implying more than 120 m/s moves the anchor without adding distance (GPS glitch filter).
- **Ascent and descent:** dead-band hysteresis of 3 m around a reference altitude. The reference moves, and the difference is added, only when the altitude leaves the ±3 m band.
- **Max speed:** the maximum of the reported `speed_ms`. Speed is not derived from positions.
- **`expected_sample_count`:** `floor(last_sample_t − first_sample_t in s) + 1`, which assumes a 1 Hz target. It is used for `telemetry_completeness` in `GET /events/{id}/report`.
- **`duration_s`:** `(ended_at ?? last_sample_t ?? started_at) − started_at`, floored at 0.

## 6. Live snapshot (`GET /events/{id}/live` and the WebSocket subscribe snapshot)

- Built from PostgreSQL, not Redis. Flights linked to the event with status `recording`, or `ended` with `ended_at` in the last 2 h; at most 2000 rows.
- Each flight is filtered by `authz.CanSeeLiveFlight` (organizers/observers/admins: all; pilots: own + others when `pilots_see_each_other`; retrievers: none; guests/outsiders: all only with `public_live_map` on a public event). Guests and non-members get the pilot's display name instead of the full name.
- `retrievals`: open retrievals plus those closed in the last 2 h, filtered and redacted per role; `retrievers`: event retrievers with duty, latest position, `age_s` and `active_retrievals` (organizers/observers/admins: all; a pilot: the retriever holding their open retrieval; a retriever: themself). The `retrievals:<event_id>` channel snapshot has the same shape without `pilots`.
- `freshness` is computed from `last_position_received_at`, falling back to `last_received_at`: `live` < 30 s, `stale` 30 s – 5 min, `lost` > 5 min or no data. `age_s` is in seconds.
- `trail` holds `[lon, lat, gps_alt_m|null, t_unix_ms]` for samples with `t` in the last 15 minutes (relative to now) and `h_acc_m ≤ 50`. It is simplified with Douglas–Peucker, starting at 3 m and doubling the tolerance until there are ≤ 300 points, then uniform decimation. The query also bounds `received_at > now − 20 min` so that only the newest partition is scanned. Flights silent for more than 15 min therefore have an empty trail but keep `position`.
- `cursor` is the newest stream id (`XREVRANGE + - COUNT 1`), or `0-0` if Redis is unavailable or the stream is empty.

`GET /flights/{id}/positions?simplify=true` applies the same simplifier (default tolerance 5 m, `tolerance_m` up to 1000, capped at 5000 points, `h_acc ≤ 50`) to the whole flight. Without `simplify` it pages by seq (`after_seq` or `cursor`, `limit` up to 5000).

## 7. Realtime delivery details

- **Leadership:** `pg_try_advisory_lock(hashtextextended('retfast-relay:'||current_schema(), 0))` on a dedicated pooled connection. Non-leaders retry every 2 s. If the connection breaks, the lock is lost and another instance takes over.
- **Publishing errors** (Redis down) leave rows in the outbox. The relay backs off exponentially from 0.5 s to 10 s and logs a warning at most once per 30 s.
- **Tailer:** starts from the newest stream id once Redis is reachable and then follows ids. If Redis restarts empty, the tailer's last id is ahead of the new stream's ids; see the failure table.
- **Subscribe:** the subscription is registered first, then the cursor is read, then the snapshot is built. Live messages that arrive meanwhile are buffered (≤ 256) and flushed after `subscribed` and any replay, with stream-id de-duplication.
- **`since` replay:** if `since` is ≥ the oldest stream entry, entries after it (up to 10 000) that match the channel and pass authorization are sent after `subscribed` (which still carries a full snapshot and `replayed: n`). Otherwise only the snapshot is sent. The window depends on MAXLEN ~100 000 and the message rate.
- **Per-message filtering:** every message is checked against the subscription's current facts (refreshed by `member_changed`/`event_changed`). A `flight` message the subscriber may no longer see is delivered as `{"id", "event_id", "removed": true}`; a `retrieval` that left a retriever's list (taken by someone else, cancelled, reassigned) as `{"id", "event_id", "status", "removed": true}`.
- **Connection timing:** the server sends `{"type":"ping"}` every 25 s. The first client message must arrive within 10 s (else close 4001), and a silent connection is closed after 60 s. An invalid token on `auth` closes with 4001. A full queue closes with 4008. Shutdown closes with 1012.

## 8. Retention

| Data | Policy | Mechanism |
|---|---|---|
| `flight_positions`, `telemetry_sample_keys` | Kept until the flight or the account is deleted (cascade). **No automatic age-based retention.** | manual (see below) |
| `telemetry_batches` | 7 days | hourly housekeeping |
| `realtime_outbox` | deleted once published | relay |
| `email_outbox` | bodies purged when `sent`/`failed`; rows deleted 30 days after the terminal state | worker + housekeeping |
| `notification_records` | read records deleted 180 days after `read_at` | housekeeping |
| `user_sessions`, `password_reset_tokens`, `email_verification_tokens` | deleted 30 days after expiry | housekeeping |
| `audit_logs` | 730 days | housekeeping |
| `retriever_positions`, `retrieval_positions` | 30 days after receipt | housekeeping |
| `retriever_states` latest position | cleared (duty off) 30 days after the last position | housekeeping |
| `retrievals`, `retrieval_updates` | kept with the event (event record; deleted with the event) | – |
| Recording flights with no data for 12 h | marked `abandoned` (a `flight` envelope is published). New data on an abandoned flight sets it back to `recording`. | housekeeping |

Manual retention for old position months, run as a maintenance operation (the partition must not be the current or a future month):

```sql
BEGIN;
-- remove de-duplication keys for samples stored in that partition
DELETE FROM telemetry_sample_keys k
 USING flight_positions_p202501 p
 WHERE k.flight_id = p.flight_id AND k.seq = p.seq;
ALTER TABLE flight_positions DETACH PARTITION flight_positions_p202501;
COMMIT;
DROP TABLE flight_positions_p202501;
-- flight_sessions statistics still describe the full flight; mark or delete flights as policy requires
```

If the keys are not removed, re-sent samples for those flights would be reported as `duplicate` even though the positions no longer exist.

## 9. Partition maintenance

- `EnsurePartitions` runs synchronously at startup (`app.New`) and then every 6 h (`Maintenance.RunPartitions`). It ensures partitions from the previous month through 3 months ahead. Creation is idempotent (`to_regclass` check, `CREATE TABLE IF NOT EXISTS ... PARTITION OF`).
- **Moving rows out of the default partition:** if the default partition already holds rows for the new month (maintenance did not run in time), the create fails with SQLSTATE 23514. The code then, in one transaction:
  1. locks `flight_positions_default` (ACCESS EXCLUSIVE);
  2. creates `LIKE flight_positions INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING GENERATED`;
  3. copies the month's rows from the default partition and deletes them there;
  4. runs `ATTACH PARTITION`, which adds the parent's indexes and FK.

  This path is covered by `tests/me_admin_test.go:TestPartitionMaintenanceMovesDefaultRows`.
- Failures increment `retfast_partition_maintenance_errors_total` and are logged at error. Ingestion continues because rows fall into the default partition.

## 10. Failure modes

| Failure | Effect | Behaviour / recovery |
|---|---|---|
| Redis down | Live fan-out stops; snapshots still work (`cursor` `0-0`). | Ingestion unaffected (tested: `TestRedisDownIngestionSucceedsAndOutboxDrainsLater`). Outbox accumulates and drains when Redis returns. Auth rate limits fall back to per-instance memory. `/health/ready` returns 200 with `status: degraded`. |
| Redis restarts empty (no AOF) | Stream history and `since` replay window are lost. | Auto ids are `<ms>-<seq>` from the Redis clock, so new entries sort after the tailer's last id and fan-out resumes. Clients whose `since` is older than the new stream get a snapshot. Production Redis runs with AOF (ADR-010). |
| PostgreSQL down | Ingestion returns 5xx/503; nothing is acknowledged. | Clients keep samples locally and retry. Readiness returns 503. |
| Relay crash between XADD and DELETE | The same envelope is published twice. | At-least-once delivery. The hub drops stream ids ≤ the last delivered per subscription. Clients must de-duplicate positions by `(flight_id, seq)`. |
| Relay instance dies | No publishing until another instance takes the advisory lock (retry every 2 s). | Session-scoped lock is released with the connection. |
| API instance restart (SIGTERM) | WebSockets closed with 1012; in-flight requests drained (`SHUTDOWN_TIMEOUT`, default 15 s); workers stopped. | Committed telemetry is never lost (tested: `TestGracefulRestartKeepsCommittedTelemetry`). Unacknowledged batches are re-sent by clients and classified accepted/duplicate. |
| Slow WebSocket consumer | Queue of 256 full. | Close 4008; the client reconnects with `since`. |
| Device clock skew | Samples outside `[started_at − 1 h, now + 10 min]` are rejected. | Partitioning uses `received_at`, so skew never scatters partitions. Freshness uses server receive time. |
| Duplicate resend storms | Extra load only. | Batch replay is answered from `telemetry_batches`. Per-user limit is 600 batches/min (429 + `Retry-After`). |
| Partition missing | Rows go to the default partition. | Next maintenance run moves them (section 9). Alert on `retfast_partition_maintenance_errors_total`. |
| Outbox growth | Realtime lag. | Monitor `retfast_outbox_depth` (sampled every 5 s by every instance) and `retfast_outbox_relay_errors_total`. |
| Out-of-order data | Temporarily inaccurate path statistics. | `stats_dirty` → recompute within about 30 s, or on `/end`. |

## 11. Metrics (served on `METRICS_ADDR`, `/metrics`)

| Metric | Type / labels |
|---|---|
| `retfast_telemetry_samples_total` | counter, `result` = accepted, duplicate, rejected |
| `retfast_telemetry_batches_total` | counter, `outcome` = processed, replayed, error |
| `retfast_telemetry_ingest_seconds` | histogram, batch transaction latency |
| `retfast_outbox_depth` | gauge |
| `retfast_outbox_relayed_total` | counter |
| `retfast_outbox_relay_errors_total` | counter |
| `retfast_ws_connections` | gauge |
| `retfast_ws_dropped_total` | counter, `reason` = slow_consumer, idle, no_first_message, unauthorized, shutdown |
| `retfast_ws_messages_sent_total` | counter, messages queued to clients |
| `retfast_http_request_duration_seconds` | histogram, `method`, `route` (chi pattern), `status` |
| `retfast_partition_maintenance_errors_total` | counter |
| `retfast_retrieval_transitions_total` | counter, `kind` = requested, accepted, released, assigned, picked_up, delivered, cancelled, note |

Also exported: `retfast_rate_limited_total{rule}`, `retfast_ratelimit_fallback_total`, `retfast_email_sent_total`, `retfast_email_failures_total{reason}`, `retfast_push_unconfigured_total`, and the Go runtime and process collectors.

## 12. Capacity

Measured throughput, latency percentiles and WebSocket propagation delay (with the machine they were measured on) are recorded in `docs/testing/backend-results.md`. No numbers are stated here.

Design notes that bound cost per batch:

- one row lock;
- one multi-row key insert;
- one `COPY`;
- one flight update;
- one outbox row.

Realtime traffic is one message per batch per flight, not one per sample.

-- name: ClaimBatch :one
INSERT INTO telemetry_batches (batch_id, flight_id, user_id, response)
VALUES (@batch_id, @flight_id, @user_id, '{}'::jsonb)
ON CONFLICT (batch_id) DO NOTHING
RETURNING batch_id;

-- name: GetBatch :one
SELECT * FROM telemetry_batches WHERE batch_id = $1;

-- name: SetBatchResponse :exec
UPDATE telemetry_batches SET response = @response WHERE batch_id = @batch_id;

-- name: InsertSampleKeys :many
INSERT INTO telemetry_sample_keys (flight_id, seq, sample_id, received_at)
SELECT @flight_id::uuid, unnest(@seqs::int[]), unnest(@sample_ids::uuid[]), @received_at::timestamptz
ON CONFLICT DO NOTHING
RETURNING seq;

-- name: GetSampleKeysBySeq :many
SELECT seq, sample_id FROM telemetry_sample_keys WHERE flight_id = @flight_id AND seq = ANY (@seqs::int[]);

-- name: GetSampleKeysByID :many
SELECT sample_id, flight_id, seq FROM telemetry_sample_keys WHERE sample_id = ANY (@sample_ids::uuid[]);

-- name: CopyPositions :copyfrom
INSERT INTO flight_positions (flight_id, seq, sample_id, batch_id, t, device_t, received_at, lat, lon, gps_alt_m,
    h_acc_m, v_acc_m, speed_ms, course_deg, meta)
VALUES (@flight_id, @seq, @sample_id, @batch_id, @t, @device_t, @received_at, @lat, @lon, @gps_alt_m, @h_acc_m,
    @v_acc_m, @speed_ms, @course_deg, @meta);

-- name: UpdateFlightAfterIngest :exec
UPDATE flight_sessions SET
    last_sample_id = sqlc.narg('last_sample_id'), last_seq = sqlc.narg('last_seq'), last_t = sqlc.narg('last_t'),
    last_lat = sqlc.narg('last_lat'), last_lon = sqlc.narg('last_lon'), last_gps_alt_m = sqlc.narg('last_gps_alt_m'),
    last_h_acc_m = sqlc.narg('last_h_acc_m'), last_v_acc_m = sqlc.narg('last_v_acc_m'),
    last_speed_ms = sqlc.narg('last_speed_ms'), last_course_deg = sqlc.narg('last_course_deg'),
    last_position_received_at = sqlc.narg('last_position_received_at'),
    last_received_at = @last_received_at,
    sample_count = @sample_count, distance_m = @distance_m, max_gps_alt_m = sqlc.narg('max_gps_alt_m'),
    min_gps_alt_m = sqlc.narg('min_gps_alt_m'), max_ground_speed_ms = sqlc.narg('max_ground_speed_ms'),
    total_ascent_m = @total_ascent_m, total_descent_m = @total_descent_m, gap_count = @gap_count,
    first_sample_t = sqlc.narg('first_sample_t'), last_sample_t = sqlc.narg('last_sample_t'),
    stats_state = @stats_state, stats_dirty = @stats_dirty,
    status = CASE WHEN status = 'abandoned' THEN 'recording' ELSE status END, updated_at = now()
WHERE id = @id;

-- name: InsertOutbox :exec
INSERT INTO realtime_outbox (kind, event_id, flight_id, payload)
VALUES (@kind, sqlc.narg('event_id'), sqlc.narg('flight_id'), @payload);

-- name: NotifyOutbox :exec
SELECT pg_notify('rf_outbox', '');

-- name: FetchOutbox :many
SELECT id, kind, event_id, flight_id, payload, created_at FROM realtime_outbox ORDER BY id LIMIT @lim;

-- name: DeleteOutbox :exec
DELETE FROM realtime_outbox WHERE id = ANY (@ids::bigint[]);

-- name: CountOutbox :one
SELECT count(*) FROM realtime_outbox;

-- name: PruneBatches :execrows
DELETE FROM telemetry_batches WHERE created_at < @before;

-- name: LockFlightWithPilot :one
SELECT sqlc.embed(f), u.full_name AS pilot_name, COALESCE(p.public_id, '') AS pilot_public_id,
       COALESCE(p.display_name, u.full_name) AS pilot_display_name
FROM flight_sessions f
JOIN users u ON u.id = f.pilot_id
LEFT JOIN pilot_profiles p ON p.user_id = f.pilot_id
WHERE f.id = $1
FOR UPDATE OF f;

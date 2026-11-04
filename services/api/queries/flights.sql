-- name: InsertFlight :one
INSERT INTO flight_sessions (id, public_id, pilot_id, event_id, visibility, is_simulated, started_at,
    device_platform, device_app_version)
VALUES (@id, @public_id, @pilot_id, sqlc.narg('event_id'), @visibility, @is_simulated, @started_at,
    @device_platform, @device_app_version)
ON CONFLICT (id) DO NOTHING
RETURNING id;

-- name: GetFlight :one
SELECT sqlc.embed(f), u.full_name AS pilot_name, COALESCE(p.public_id, '') AS pilot_public_id
FROM flight_sessions f
JOIN users u ON u.id = f.pilot_id
LEFT JOIN pilot_profiles p ON p.user_id = f.pilot_id
WHERE f.id = $1;

-- name: GetFlightByPublicID :one
SELECT sqlc.embed(f), u.full_name AS pilot_name, COALESCE(p.public_id, '') AS pilot_public_id
FROM flight_sessions f
JOIN users u ON u.id = f.pilot_id
LEFT JOIN pilot_profiles p ON p.user_id = f.pilot_id
WHERE f.public_id = $1;

-- name: FlightPublicIDExists :one
SELECT EXISTS (SELECT 1 FROM flight_sessions WHERE public_id = $1);

-- name: LockFlight :one
SELECT * FROM flight_sessions WHERE id = $1 FOR UPDATE;

-- name: UpdateFlightSharing :exec
UPDATE flight_sessions SET visibility = @visibility, event_id = sqlc.narg('event_id'), updated_at = now()
WHERE id = @id;

-- name: EndFlight :exec
UPDATE flight_sessions SET status = 'ended', ended_at = @ended_at, updated_at = now()
WHERE id = @id AND status = 'recording';

-- name: AbandonStaleFlights :many
UPDATE flight_sessions SET status = 'abandoned', updated_at = now()
WHERE status = 'recording' AND COALESCE(last_received_at, created_at) < @before::timestamptz
RETURNING id, event_id;

-- name: ListFlights :many
SELECT sqlc.embed(f), u.full_name AS pilot_name, COALESCE(p.public_id, '') AS pilot_public_id
FROM flight_sessions f
JOIN users u ON u.id = f.pilot_id
LEFT JOIN pilot_profiles p ON p.user_id = f.pilot_id
WHERE (sqlc.narg('pilot_id')::uuid IS NULL OR f.pilot_id = sqlc.narg('pilot_id')::uuid)
  AND (sqlc.narg('event_id')::uuid IS NULL OR f.event_id = sqlc.narg('event_id')::uuid)
  AND (cardinality(@statuses::text[]) = 0 OR f.status = ANY (@statuses::text[]))
  AND (
      f.pilot_id = @viewer_id
      OR @see_all::bool
      OR (f.visibility <> 'private' AND f.event_id IN (
            SELECT m.event_id FROM event_participants m
            WHERE m.user_id = @viewer_id AND m.status = 'active'
              AND (m.role = 'organizer' OR NOT @organizer_only::bool)))
  )
  AND (sqlc.narg('after_started')::timestamptz IS NULL
       OR (f.started_at, f.id) < (sqlc.narg('after_started')::timestamptz, sqlc.narg('after_id')::uuid))
ORDER BY f.started_at DESC, f.id DESC
LIMIT @lim;

-- name: ListPositions :many
SELECT flight_id, seq, sample_id, t, device_t, received_at, lat, lon, gps_alt_m, h_acc_m, v_acc_m, speed_ms, course_deg
FROM flight_positions
WHERE flight_id = @flight_id AND seq > @after_seq
ORDER BY seq, t
LIMIT @lim;

-- name: ListAllPositions :many
SELECT flight_id, seq, sample_id, t, device_t, received_at, lat, lon, gps_alt_m, h_acc_m, v_acc_m, speed_ms, course_deg
FROM flight_positions
WHERE flight_id = $1
ORDER BY seq, t;

-- name: LiveFlightsForEvent :many
SELECT sqlc.embed(f), u.full_name AS pilot_name, COALESCE(p.public_id, '') AS pilot_public_id,
       COALESCE(p.display_name, u.full_name) AS pilot_display_name,
       EXISTS (SELECT 1 FROM emergency_incidents i WHERE i.flight_id = f.id
               AND i.status IN ('open', 'acknowledged', 'responding'))::bool AS incident_open
FROM flight_sessions f
JOIN users u ON u.id = f.pilot_id
LEFT JOIN pilot_profiles p ON p.user_id = f.pilot_id
WHERE f.event_id = $1
  AND (f.status = 'recording' OR (f.status = 'ended' AND f.ended_at > now() - interval '2 hours'))
ORDER BY f.last_received_at DESC NULLS LAST
LIMIT 2000;

-- name: RecentPositionsForFlights :many
SELECT flight_id, seq, t, lat, lon, gps_alt_m, h_acc_m
FROM flight_positions
WHERE flight_id = ANY (@flight_ids::uuid[]) AND received_at > @since AND t > @since_t
ORDER BY flight_id, seq;

-- name: FlightHasOpenIncident :one
SELECT EXISTS (SELECT 1 FROM emergency_incidents WHERE flight_id = $1 AND status IN ('open', 'acknowledged', 'responding'));

-- name: ListDirtyFlights :many
SELECT id FROM flight_sessions WHERE stats_dirty ORDER BY updated_at LIMIT @lim;

-- name: UpdateFlightStats :exec
UPDATE flight_sessions SET sample_count = @sample_count, distance_m = @distance_m, max_gps_alt_m = sqlc.narg('max_gps_alt_m'),
    min_gps_alt_m = sqlc.narg('min_gps_alt_m'), max_ground_speed_ms = sqlc.narg('max_ground_speed_ms'),
    total_ascent_m = @total_ascent_m, total_descent_m = @total_descent_m, gap_count = @gap_count,
    first_sample_t = sqlc.narg('first_sample_t'), last_sample_t = sqlc.narg('last_sample_t'),
    stats_state = @stats_state, stats_dirty = @stats_dirty, updated_at = now()
WHERE id = @id;

-- name: CountFlightsForUser :one
SELECT count(*) FROM flight_sessions WHERE pilot_id = $1;

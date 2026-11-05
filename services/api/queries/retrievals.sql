-- name: InsertRetrieval :one
INSERT INTO retrievals (id, event_id, pilot_id, flight_id, pickup_lat, pickup_lon, pickup_gps_alt_m, pickup_h_acc_m,
    pickup_t, note, is_simulated, pp_seq, pp_sample_id, pp_t, pp_lat, pp_lon, pp_gps_alt_m, pp_h_acc_m, pp_received_at)
VALUES (@id, @event_id, @pilot_id, sqlc.narg('flight_id'), @pickup_lat, @pickup_lon, sqlc.narg('pickup_gps_alt_m'),
    sqlc.narg('pickup_h_acc_m'), @pickup_t, @note, @is_simulated, 0, gen_random_uuid(), @pickup_t, @pickup_lat, @pickup_lon,
    sqlc.narg('pickup_gps_alt_m'), sqlc.narg('pickup_h_acc_m'), now())
ON CONFLICT (id) DO NOTHING
RETURNING id;

-- name: GetRetrieval :one
SELECT r.*, pu.full_name AS pilot_name, COALESCE(pp.public_id, '')::text AS pilot_public_id,
    COALESCE(pp.phone, '')::text AS pilot_phone,
    COALESCE(ru.full_name, '')::text AS retriever_name, COALESCE(rp.phone, '')::text AS retriever_phone,
    COALESCE(cu.full_name, '')::text AS cancelled_by_name,
    rs.lat AS rv_lat, rs.lon AS rv_lon, rs.h_acc_m AS rv_h_acc_m, rs.t AS rv_t
FROM retrievals r
JOIN users pu ON pu.id = r.pilot_id
LEFT JOIN pilot_profiles pp ON pp.user_id = r.pilot_id
LEFT JOIN users ru ON ru.id = r.retriever_id
LEFT JOIN pilot_profiles rp ON rp.user_id = r.retriever_id
LEFT JOIN users cu ON cu.id = r.cancelled_by
LEFT JOIN retriever_states rs ON rs.event_id = r.event_id AND rs.user_id = r.retriever_id
WHERE r.id = $1;

-- name: ListRetrievalsForEvent :many
SELECT r.*, pu.full_name AS pilot_name, COALESCE(pp.public_id, '')::text AS pilot_public_id,
    COALESCE(pp.phone, '')::text AS pilot_phone,
    COALESCE(ru.full_name, '')::text AS retriever_name, COALESCE(rp.phone, '')::text AS retriever_phone,
    COALESCE(cu.full_name, '')::text AS cancelled_by_name,
    rs.lat AS rv_lat, rs.lon AS rv_lon, rs.h_acc_m AS rv_h_acc_m, rs.t AS rv_t
FROM retrievals r
JOIN users pu ON pu.id = r.pilot_id
LEFT JOIN pilot_profiles pp ON pp.user_id = r.pilot_id
LEFT JOIN users ru ON ru.id = r.retriever_id
LEFT JOIN pilot_profiles rp ON rp.user_id = r.retriever_id
LEFT JOIN users cu ON cu.id = r.cancelled_by
LEFT JOIN retriever_states rs ON rs.event_id = r.event_id AND rs.user_id = r.retriever_id
WHERE r.event_id = @event_id
  AND (cardinality(@statuses::text[]) = 0 OR r.status = ANY (@statuses::text[]))
  AND (sqlc.narg('closed_since')::timestamptz IS NULL OR r.status IN ('requested', 'accepted', 'picked_up')
       OR r.updated_at >= sqlc.narg('closed_since')::timestamptz)
ORDER BY r.requested_at DESC, r.id
LIMIT @lim;

-- name: ListRetrievalUpdates :many
SELECT ru.id, ru.retrieval_id, ru.kind, ru.actor_id, COALESCE(u.full_name, '')::text AS actor_name, ru.body, ru.created_at
FROM retrieval_updates ru LEFT JOIN users u ON u.id = ru.actor_id
WHERE ru.retrieval_id = ANY (@retrieval_ids::uuid[])
ORDER BY ru.created_at, ru.id;

-- name: InsertRetrievalUpdate :exec
INSERT INTO retrieval_updates (retrieval_id, kind, actor_id, body) VALUES (@retrieval_id, @kind, sqlc.narg('actor_id'), @body);

-- name: OpenRetrievalForPilot :one
SELECT id FROM retrievals WHERE event_id = @event_id AND pilot_id = @pilot_id AND status IN ('requested', 'accepted', 'picked_up');

-- name: AcceptRetrieval :one
-- First accept wins: only a row still in 'requested' is updated.
UPDATE retrievals SET status = 'accepted', retriever_id = @retriever_id, accepted_at = now(), updated_at = now()
WHERE id = @id AND status = 'requested'
RETURNING id;

-- name: AssignRetrieval :one
UPDATE retrievals SET status = 'accepted', retriever_id = @retriever_id, accepted_at = now(), updated_at = now()
WHERE id = @id AND status IN ('requested', 'accepted')
RETURNING id;

-- name: ReleaseRetrieval :one
UPDATE retrievals SET status = 'requested', retriever_id = NULL, accepted_at = NULL, updated_at = now()
WHERE id = @id AND status = 'accepted' AND retriever_id = @retriever_id
RETURNING id;

-- name: PickUpRetrieval :one
UPDATE retrievals SET status = 'picked_up', picked_up_at = now(), updated_at = now()
WHERE id = @id AND status = 'accepted' AND retriever_id = @retriever_id
RETURNING id;

-- name: DeliverRetrieval :one
UPDATE retrievals SET status = 'delivered', delivered_at = now(), delivery_note = @delivery_note, updated_at = now()
WHERE id = @id AND status = 'picked_up' AND retriever_id = @retriever_id
RETURNING id;

-- name: CancelRetrieval :one
UPDATE retrievals SET status = 'cancelled', cancelled_at = now(), cancelled_by = sqlc.narg('cancelled_by'),
    cancel_reason = @cancel_reason, updated_at = now()
WHERE id = @id AND status IN ('requested', 'accepted', 'picked_up')
RETURNING id;

-- name: TouchRetrieval :exec
UPDATE retrievals SET updated_at = now() WHERE id = $1;

-- name: UpdateRetrievalPilotPosition :one
UPDATE retrievals SET pp_seq = pp_seq + 1, pp_sample_id = gen_random_uuid(), pp_t = @t, pp_lat = @lat, pp_lon = @lon,
    pp_gps_alt_m = sqlc.narg('gps_alt_m'), pp_h_acc_m = @h_acc_m, pp_received_at = now(), updated_at = now()
WHERE id = @id AND pilot_id = @pilot_id AND status IN ('requested', 'accepted', 'picked_up')
RETURNING pp_seq, pp_sample_id, pp_received_at;

-- name: InsertRetrievalPosition :exec
INSERT INTO retrieval_positions (retrieval_id, seq, t, lat, lon, gps_alt_m, h_acc_m)
VALUES (@retrieval_id, @seq, @t, @lat, @lon, sqlc.narg('gps_alt_m'), @h_acc_m);

-- name: GetRetrieverState :one
SELECT rs.*, u.full_name FROM retriever_states rs JOIN users u ON u.id = rs.user_id
WHERE rs.event_id = @event_id AND rs.user_id = @user_id;

-- name: SetRetrieverDuty :exec
INSERT INTO retriever_states (event_id, user_id, on_duty, duty_changed_at) VALUES (@event_id, @user_id, @on_duty, now())
ON CONFLICT (event_id, user_id) DO UPDATE SET on_duty = EXCLUDED.on_duty,
    duty_changed_at = CASE WHEN retriever_states.on_duty <> EXCLUDED.on_duty THEN now() ELSE retriever_states.duty_changed_at END,
    updated_at = now();

-- name: SetRetrieverPosition :exec
INSERT INTO retriever_states (event_id, user_id, lat, lon, h_acc_m, t, course_deg, speed_ms, position_received_at)
VALUES (@event_id, @user_id, @lat, @lon, @h_acc_m, @t, sqlc.narg('course_deg'), sqlc.narg('speed_ms'), now())
ON CONFLICT (event_id, user_id) DO UPDATE SET lat = EXCLUDED.lat, lon = EXCLUDED.lon, h_acc_m = EXCLUDED.h_acc_m,
    t = EXCLUDED.t, course_deg = EXCLUDED.course_deg, speed_ms = EXCLUDED.speed_ms,
    position_received_at = now(), updated_at = now();

-- name: InsertRetrieverPosition :exec
INSERT INTO retriever_positions (event_id, user_id, t, lat, lon, h_acc_m, course_deg, speed_ms)
VALUES (@event_id, @user_id, @t, @lat, @lon, @h_acc_m, sqlc.narg('course_deg'), sqlc.narg('speed_ms'));

-- name: ListRetrieversForEvent :many
-- Active retriever members with their latest state and number of open retrievals they hold.
SELECT m.user_id, u.full_name, COALESCE(rs.on_duty, false)::bool AS on_duty,
    rs.lat, rs.lon, rs.h_acc_m, rs.t, rs.course_deg, rs.speed_ms, rs.position_received_at,
    (SELECT count(*) FROM retrievals r WHERE r.event_id = m.event_id AND r.retriever_id = m.user_id
        AND r.status IN ('accepted', 'picked_up'))::int AS active_retrievals
FROM event_members m
JOIN users u ON u.id = m.user_id
LEFT JOIN retriever_states rs ON rs.event_id = m.event_id AND rs.user_id = m.user_id
WHERE m.event_id = $1 AND m.status = 'active' AND m.role = 'retriever'
ORDER BY u.full_name;

-- name: ActiveRetrievalPilotsForRetriever :many
SELECT pilot_id FROM retrievals
WHERE event_id = @event_id AND retriever_id = @retriever_id AND status IN ('accepted', 'picked_up');

-- name: CountActiveRetrievalsForRetriever :one
SELECT count(*)::int FROM retrievals
WHERE event_id = @event_id AND retriever_id = @retriever_id AND status IN ('accepted', 'picked_up');

-- name: ListRetrievalsForPilot :many
SELECT id, event_id, flight_id, status, pickup_lat, pickup_lon, pickup_t, note, requested_at, accepted_at,
    picked_up_at, delivered_at, cancelled_at, is_simulated
FROM retrievals WHERE pilot_id = $1 ORDER BY requested_at;

-- name: PruneRetrievalPositions :execrows
DELETE FROM retrieval_positions WHERE received_at < @before;

-- name: PruneRetrieverPositions :execrows
DELETE FROM retriever_positions WHERE received_at < @before;

-- name: ClearStaleRetrieverStates :execrows
UPDATE retriever_states SET lat = NULL, lon = NULL, h_acc_m = NULL, t = NULL, course_deg = NULL, speed_ms = NULL,
    position_received_at = NULL, on_duty = false, updated_at = now()
WHERE position_received_at < @before;

-- name: DeleteUserRetrieverData :exec
DELETE FROM retriever_positions WHERE user_id = $1;

-- name: DeleteUserRetrieverStates :exec
DELETE FROM retriever_states WHERE user_id = $1;

-- name: DeleteUserRetrievalPositions :exec
DELETE FROM retrieval_positions WHERE retrieval_id IN (SELECT id FROM retrievals WHERE pilot_id = $1);

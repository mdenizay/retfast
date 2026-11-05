-- name: InsertIncident :one
INSERT INTO emergency_incidents (id, kind, is_test, pilot_id, flight_id, event_id, lat, lon, gps_alt_m, h_acc_m,
    position_t, message, created_at_device)
VALUES (@id, @kind, @is_test, @pilot_id, sqlc.narg('flight_id'), sqlc.narg('event_id'), sqlc.narg('lat'),
    sqlc.narg('lon'), sqlc.narg('gps_alt_m'), sqlc.narg('h_acc_m'), sqlc.narg('position_t'), @message, @created_at_device)
ON CONFLICT (id) DO NOTHING
RETURNING id;

-- name: GetIncident :one
SELECT * FROM emergency_incidents WHERE id = $1;

-- name: LockIncident :one
SELECT * FROM emergency_incidents WHERE id = $1 FOR UPDATE;

-- name: ListIncidents :many
SELECT * FROM emergency_incidents i
WHERE (cardinality(@statuses::text[]) = 0 OR i.status = ANY (@statuses::text[]))
  AND (sqlc.narg('event_id')::uuid IS NULL OR i.event_id = sqlc.narg('event_id')::uuid)
  AND (
      (@own_only::bool AND i.pilot_id = @viewer_id)
      OR (NOT @own_only::bool AND (
          @see_all::bool OR i.pilot_id = @viewer_id
          OR i.event_id IN (SELECT m.event_id FROM event_participants m
                            WHERE m.user_id = @viewer_id AND m.role = 'organizer' AND m.status = 'active')))
  )
  AND (sqlc.narg('after_received')::timestamptz IS NULL
       OR (i.received_at, i.id) < (sqlc.narg('after_received')::timestamptz, sqlc.narg('after_id')::uuid))
ORDER BY i.received_at DESC, i.id DESC
LIMIT @lim;

-- name: UpdateIncidentStatus :exec
UPDATE emergency_incidents SET status = @status,
    acknowledged_at = CASE WHEN @set_ack::bool THEN COALESCE(acknowledged_at, now()) ELSE acknowledged_at END,
    acknowledged_by = CASE WHEN @set_ack::bool THEN COALESCE(acknowledged_by, sqlc.narg('actor_id')::uuid) ELSE acknowledged_by END,
    resolved_at = CASE WHEN @status = 'resolved' THEN now() ELSE resolved_at END,
    cancelled_at = CASE WHEN @status = 'cancelled' THEN now() ELSE cancelled_at END,
    cancel_reason = CASE WHEN @status = 'cancelled' THEN @cancel_reason ELSE cancel_reason END,
    updated_at = now()
WHERE id = @id;

-- name: TouchIncident :exec
UPDATE emergency_incidents SET updated_at = now() WHERE id = $1;

-- name: InsertIncidentUpdate :exec
INSERT INTO emergency_updates (incident_id, kind, actor_id, body, status)
VALUES (@incident_id, @kind, sqlc.narg('actor_id'), @body, @status);

-- name: ListIncidentUpdates :many
SELECT u.id, u.incident_id, u.kind, u.actor_id, COALESCE(a.full_name, '') AS actor_name, u.body, u.status, u.created_at
FROM emergency_updates u LEFT JOIN users a ON a.id = u.actor_id
WHERE u.incident_id = ANY (@incident_ids::uuid[])
ORDER BY u.created_at, u.id;

-- name: UpsertAssignment :one
INSERT INTO rescue_assignments (incident_id, responder_id, assigned_by)
VALUES (@incident_id, @responder_id, sqlc.narg('assigned_by'))
ON CONFLICT (incident_id, responder_id) DO UPDATE SET
    status = CASE WHEN rescue_assignments.status IN ('completed', 'withdrawn') THEN 'assigned' ELSE rescue_assignments.status END,
    updated_at = now()
RETURNING id;

-- name: ListAssignmentsForIncidents :many
SELECT a.id, a.incident_id, a.responder_id, u.full_name AS responder_name, a.status, a.assigned_at, a.updated_at,
       r.last_lat, r.last_lon, r.last_t
FROM rescue_assignments a
JOIN users u ON u.id = a.responder_id
LEFT JOIN rescue_responders r ON r.user_id = a.responder_id
WHERE a.incident_id = ANY (@incident_ids::uuid[])
ORDER BY a.assigned_at;

-- name: ListAssignmentsForResponder :many
SELECT a.id, a.incident_id, a.responder_id, u.full_name AS responder_name, a.status, a.assigned_at, a.updated_at,
       r.last_lat, r.last_lon, r.last_t
FROM rescue_assignments a
JOIN users u ON u.id = a.responder_id
LEFT JOIN rescue_responders r ON r.user_id = a.responder_id
WHERE a.responder_id = $1
ORDER BY a.assigned_at DESC
LIMIT 200;

-- name: LockAssignment :one
SELECT * FROM rescue_assignments WHERE id = $1 FOR UPDATE;

-- name: UpdateAssignmentStatus :exec
UPDATE rescue_assignments SET status = @status, updated_at = now() WHERE id = @id;

-- name: UpsertResponderAvailability :exec
INSERT INTO rescue_responders (user_id, availability) VALUES (@user_id, @availability)
ON CONFLICT (user_id) DO UPDATE SET availability = EXCLUDED.availability, updated_at = now();

-- name: UpsertResponderPosition :exec
INSERT INTO rescue_responders (user_id, last_lat, last_lon, last_h_acc_m, last_t)
VALUES (@user_id, @lat, @lon, @h_acc_m, @t)
ON CONFLICT (user_id) DO UPDATE SET last_lat = EXCLUDED.last_lat, last_lon = EXCLUDED.last_lon,
    last_h_acc_m = EXCLUDED.last_h_acc_m, last_t = EXCLUDED.last_t, updated_at = now();

-- name: ListRescueTeam :many
SELECT u.id AS user_id, u.full_name, COALESCE(r.availability, 'unavailable') AS availability,
       r.last_lat, r.last_lon, r.last_h_acc_m, r.last_t,
       (SELECT a.id FROM rescue_assignments a WHERE a.responder_id = u.id
          AND a.status IN ('assigned', 'en_route', 'on_scene') ORDER BY a.assigned_at DESC LIMIT 1) AS active_assignment_id
FROM users u
LEFT JOIN rescue_responders r ON r.user_id = u.id
WHERE u.deleted_at IS NULL AND u.disabled_at IS NULL
  AND EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role IN ('rescue_operator', 'platform_admin'))
ORDER BY u.full_name;

-- name: ListGlobalResponderIDs :many
SELECT DISTINCT ur.user_id FROM user_roles ur JOIN users u ON u.id = ur.user_id
WHERE ur.role IN ('rescue_operator', 'platform_admin') AND u.disabled_at IS NULL AND u.deleted_at IS NULL;

-- name: CountOpenIncidents :one
SELECT count(*) FROM emergency_incidents WHERE status IN ('open', 'acknowledged', 'responding');

-- name: UpdateIncidentPosition :exec
UPDATE emergency_incidents SET lat = @lat, lon = @lon, gps_alt_m = sqlc.narg('gps_alt_m'), h_acc_m = sqlc.narg('h_acc_m'),
    position_t = @position_t, updated_at = now()
WHERE id = @id;

-- name: GetUserRolesFor :many
SELECT role FROM user_roles WHERE user_id = $1;

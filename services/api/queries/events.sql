-- name: CreateEvent :one
INSERT INTO events (slug, name, description, kind, status, is_demo, visibility, location_name, center_lat, center_lon,
    center_is_approximate, starts_at, ends_at, cover_image_url, registration_open, live_tracking, flight_recording,
    observers_allowed, emergency_testing, public_live_map, organizer_id)
VALUES (@slug, @name, @description, @kind, @status, @is_demo, @visibility, @location_name, sqlc.narg('center_lat'),
    sqlc.narg('center_lon'), @center_is_approximate, @starts_at, @ends_at, sqlc.narg('cover_image_url'),
    @registration_open, @live_tracking, @flight_recording, @observers_allowed, @emergency_testing, @public_live_map,
    sqlc.narg('organizer_id'))
RETURNING id;

-- name: GetEventByID :one
SELECT id, slug, name, description, kind, status, is_demo, visibility, location_name, center_lat, center_lon,
    center_is_approximate, starts_at, ends_at, cover_image_url, registration_open, live_tracking, flight_recording,
    observers_allowed, emergency_testing, public_live_map, organizer_id, created_at, updated_at
FROM events WHERE id = $1;

-- name: GetEventBySlug :one
SELECT id, slug, name, description, kind, status, is_demo, visibility, location_name, center_lat, center_lon,
    center_is_approximate, starts_at, ends_at, cover_image_url, registration_open, live_tracking, flight_recording,
    observers_allowed, emergency_testing, public_live_map, organizer_id, created_at, updated_at
FROM events WHERE slug = @slug::text;

-- name: EventSlugExists :one
SELECT EXISTS (SELECT 1 FROM events WHERE slug = @slug::text);

-- name: UpdateEvent :exec
UPDATE events SET slug = @slug, name = @name, description = @description, kind = @kind, status = @status,
    visibility = @visibility, location_name = @location_name, center_lat = sqlc.narg('center_lat'),
    center_lon = sqlc.narg('center_lon'), center_is_approximate = @center_is_approximate, starts_at = @starts_at,
    ends_at = @ends_at, cover_image_url = sqlc.narg('cover_image_url'), registration_open = @registration_open,
    live_tracking = @live_tracking, flight_recording = @flight_recording, observers_allowed = @observers_allowed,
    emergency_testing = @emergency_testing, public_live_map = @public_live_map, updated_at = now()
WHERE id = @id;

-- name: UpdateEventSchedule :exec
UPDATE events SET starts_at = @starts_at, ends_at = @ends_at, updated_at = now() WHERE id = @id;

-- name: ListEvents :many
SELECT e.id, e.slug, e.name, e.description, e.kind, e.status, e.is_demo, e.visibility, e.location_name, e.center_lat,
    e.center_lon, e.center_is_approximate, e.starts_at, e.ends_at, e.cover_image_url, e.registration_open,
    e.live_tracking, e.flight_recording, e.observers_allowed, e.emergency_testing, e.public_live_map, e.organizer_id,
    e.created_at, e.updated_at
FROM events e
LEFT JOIN event_participants m ON m.event_id = e.id AND m.user_id = sqlc.narg('viewer_id')::uuid AND m.status = 'active'
WHERE (@is_admin::bool OR (e.visibility = 'public' AND e.status <> 'draft') OR m.user_id IS NOT NULL)
  AND (@is_admin::bool OR e.status <> 'draft' OR m.role = 'organizer')
  AND (cardinality(@statuses::text[]) = 0 OR e.status = ANY (@statuses::text[]))
  AND (@q::text = '' OR e.name ILIKE '%' || @q::text || '%' OR e.location_name ILIKE '%' || @q::text || '%')
  AND (sqlc.narg('from_t')::timestamptz IS NULL OR e.ends_at >= sqlc.narg('from_t')::timestamptz)
  AND (sqlc.narg('to_t')::timestamptz IS NULL OR e.starts_at <= sqlc.narg('to_t')::timestamptz)
  AND (sqlc.narg('near_lat')::float8 IS NULL OR ST_DWithin(e.center,
        ST_SetSRID(ST_MakePoint(sqlc.narg('near_lon')::float8, sqlc.narg('near_lat')::float8), 4326)::geography,
        @radius_m::float8))
  AND (sqlc.narg('after_starts')::timestamptz IS NULL
       OR (e.starts_at, e.id) < (sqlc.narg('after_starts')::timestamptz, sqlc.narg('after_id')::uuid))
ORDER BY e.starts_at DESC, e.id DESC
LIMIT @lim;

-- name: CountActiveParticipants :many
SELECT event_id, count(*)::int AS n FROM event_participants
WHERE event_id = ANY (@event_ids::uuid[]) AND status = 'active' AND role = 'participant'
GROUP BY event_id;

-- name: GetMembership :one
SELECT * FROM event_participants WHERE event_id = @event_id AND user_id = @user_id;

-- name: ListMembershipsForUser :many
SELECT event_id, role FROM event_participants WHERE user_id = $1 AND status = 'active';

-- name: UpsertParticipant :exec
INSERT INTO event_participants (event_id, user_id, role, status, added_by)
VALUES (@event_id, @user_id, @role, 'active', sqlc.narg('added_by'))
ON CONFLICT (event_id, user_id) DO UPDATE SET role = EXCLUDED.role, status = 'active', updated_at = now();

-- name: EnsureParticipant :exec
INSERT INTO event_participants (event_id, user_id, role, status, added_by)
VALUES (@event_id, @user_id, @role, 'active', sqlc.narg('added_by'))
ON CONFLICT (event_id, user_id) DO NOTHING;

-- name: SetParticipantRole :execrows
UPDATE event_participants SET role = @role, updated_at = now() WHERE event_id = @event_id AND user_id = @user_id;

-- name: RemoveParticipant :execrows
UPDATE event_participants SET status = 'removed', updated_at = now()
WHERE event_id = @event_id AND user_id = @user_id AND status = 'active';

-- name: CountOrganizers :one
SELECT count(*) FROM event_participants WHERE event_id = $1 AND role = 'organizer' AND status = 'active';

-- name: ListParticipants :many
SELECT m.user_id, u.full_name, p.public_id, m.role, m.status, m.joined_at
FROM event_participants m
JOIN users u ON u.id = m.user_id
LEFT JOIN pilot_profiles p ON p.user_id = m.user_id
WHERE m.event_id = @event_id AND (@include_removed::bool OR m.status = 'active')
ORDER BY CASE m.role WHEN 'organizer' THEN 0 WHEN 'participant' THEN 1 ELSE 2 END, u.full_name;

-- name: ListEventOrganizerIDs :many
SELECT user_id FROM event_participants WHERE event_id = $1 AND role = 'organizer' AND status = 'active';

-- name: GetUserName :one
SELECT id, full_name FROM users WHERE id = $1;

-- name: CreateLaunchSite :one
INSERT INTO launch_sites (event_id, name, lat, lon, elevation_m, notes, is_verified)
VALUES (@event_id, @name, sqlc.narg('lat'), sqlc.narg('lon'), sqlc.narg('elevation_m'), @notes, @is_verified)
RETURNING id, event_id, name, lat, lon, elevation_m, notes, is_verified, created_at, updated_at;

-- name: ListLaunchSites :many
SELECT id, event_id, name, lat, lon, elevation_m, notes, is_verified, created_at, updated_at
FROM launch_sites WHERE event_id = $1 ORDER BY name;

-- name: GetLaunchSite :one
SELECT id, event_id, name, lat, lon, elevation_m, notes, is_verified, created_at, updated_at
FROM launch_sites WHERE id = @id AND event_id = @event_id;

-- name: GetLaunchSiteByName :one
SELECT id, event_id, name, lat, lon, elevation_m, notes, is_verified, created_at, updated_at
FROM launch_sites WHERE event_id = @event_id AND name = @name;

-- name: UpdateLaunchSite :exec
UPDATE launch_sites SET name = @name, lat = sqlc.narg('lat'), lon = sqlc.narg('lon'),
    elevation_m = sqlc.narg('elevation_m'), notes = @notes, is_verified = @is_verified, updated_at = now()
WHERE id = @id AND event_id = @event_id;

-- name: DeleteLaunchSite :execrows
DELETE FROM launch_sites WHERE id = @id AND event_id = @event_id;

-- name: EventReportParticipation :one
SELECT
    count(*) FILTER (WHERE role = 'participant' AND status = 'active')::int AS participants,
    count(*) FILTER (WHERE role = 'observer' AND status = 'active')::int AS observers,
    count(*) FILTER (WHERE role = 'organizer' AND status = 'active')::int AS organizers,
    count(*) FILTER (WHERE status = 'removed')::int AS removed
FROM event_participants WHERE event_id = $1;

-- name: EventReportFlights :many
SELECT f.id, f.pilot_id, u.full_name, f.status, f.is_simulated, f.started_at, f.ended_at, f.sample_count,
       f.first_sample_t, f.last_sample_t, f.gap_count, f.distance_m, f.max_gps_alt_m, f.last_received_at
FROM flight_sessions f JOIN users u ON u.id = f.pilot_id
WHERE f.event_id = $1
ORDER BY f.started_at;

-- name: CreateEvent :one
INSERT INTO events (slug, name, description, kind, status, is_demo, visibility, location_name, center_lat, center_lon,
    center_is_approximate, starts_at, ends_at, cover_image_url, applications_open, live_tracking, public_live_map,
    pilots_see_each_other, landing_prompt, created_by)
VALUES (@slug, @name, @description, @kind, @status, @is_demo, @visibility, @location_name, sqlc.narg('center_lat'),
    sqlc.narg('center_lon'), @center_is_approximate, @starts_at, @ends_at, sqlc.narg('cover_image_url'),
    @applications_open, @live_tracking, @public_live_map, @pilots_see_each_other, @landing_prompt,
    sqlc.narg('created_by'))
RETURNING id;

-- name: GetEventByID :one
SELECT id, slug, name, description, kind, status, is_demo, visibility, location_name, center_lat, center_lon,
    center_is_approximate, starts_at, ends_at, cover_image_url, applications_open, live_tracking, public_live_map,
    pilots_see_each_other, landing_prompt, created_by, created_at, updated_at
FROM events WHERE id = $1;

-- name: GetEventBySlug :one
SELECT id, slug, name, description, kind, status, is_demo, visibility, location_name, center_lat, center_lon,
    center_is_approximate, starts_at, ends_at, cover_image_url, applications_open, live_tracking, public_live_map,
    pilots_see_each_other, landing_prompt, created_by, created_at, updated_at
FROM events WHERE slug = @slug::text;

-- name: EventSlugExists :one
SELECT EXISTS (SELECT 1 FROM events WHERE slug = @slug::text);

-- name: UpdateEvent :exec
UPDATE events SET slug = @slug, name = @name, description = @description, kind = @kind, status = @status,
    visibility = @visibility, location_name = @location_name, center_lat = sqlc.narg('center_lat'),
    center_lon = sqlc.narg('center_lon'), center_is_approximate = @center_is_approximate, starts_at = @starts_at,
    ends_at = @ends_at, cover_image_url = sqlc.narg('cover_image_url'), applications_open = @applications_open,
    live_tracking = @live_tracking, public_live_map = @public_live_map,
    pilots_see_each_other = @pilots_see_each_other, landing_prompt = @landing_prompt, updated_at = now()
WHERE id = @id;

-- name: UpdateEventSchedule :exec
UPDATE events SET starts_at = @starts_at, ends_at = @ends_at, updated_at = now() WHERE id = @id;

-- name: ListEvents :many
SELECT e.id, e.slug, e.name, e.description, e.kind, e.status, e.is_demo, e.visibility, e.location_name, e.center_lat,
    e.center_lon, e.center_is_approximate, e.starts_at, e.ends_at, e.cover_image_url, e.applications_open,
    e.live_tracking, e.public_live_map, e.pilots_see_each_other, e.landing_prompt, e.created_by,
    e.created_at, e.updated_at
FROM events e
LEFT JOIN event_members m ON m.event_id = e.id AND m.user_id = sqlc.narg('viewer_id')::uuid AND m.status = 'active'
LEFT JOIN event_organizers o ON o.event_id = e.id AND o.user_id = sqlc.narg('viewer_id')::uuid
WHERE (@is_admin::bool OR (e.visibility = 'public' AND e.status <> 'draft') OR m.user_id IS NOT NULL OR o.user_id IS NOT NULL)
  AND (@is_admin::bool OR e.status <> 'draft' OR o.user_id IS NOT NULL)
  AND (NOT @mine::bool OR m.user_id IS NOT NULL OR o.user_id IS NOT NULL)
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

-- name: EventCounts :many
SELECT e.id AS event_id,
    (SELECT count(*) FROM event_members m WHERE m.event_id = e.id AND m.status = 'active' AND m.role = 'pilot')::int AS pilots,
    (SELECT count(*) FROM event_members m WHERE m.event_id = e.id AND m.status = 'active' AND m.role = 'observer')::int AS observers,
    (SELECT count(*) FROM event_members m WHERE m.event_id = e.id AND m.status = 'active' AND m.role = 'retriever')::int AS retrievers,
    (SELECT count(*) FROM event_applications a WHERE a.event_id = e.id AND a.status = 'pending')::int AS pending_applications
FROM events e WHERE e.id = ANY (@event_ids::uuid[]);

-- name: ListOrganizersForEvents :many
SELECT o.event_id, o.user_id, u.full_name, o.assigned_at
FROM event_organizers o JOIN users u ON u.id = o.user_id
WHERE o.event_id = ANY (@event_ids::uuid[])
ORDER BY o.assigned_at, u.full_name;

-- name: GetEventAccess :one
SELECT EXISTS (SELECT 1 FROM event_organizers o WHERE o.event_id = @event_id AND o.user_id = @user_id)::bool AS is_organizer,
    COALESCE((SELECT m.role FROM event_members m WHERE m.event_id = @event_id AND m.user_id = @user_id AND m.status = 'active'), '')::text AS role;

-- name: ListAccessForUser :many
SELECT e.id AS event_id,
    EXISTS (SELECT 1 FROM event_organizers o WHERE o.event_id = e.id AND o.user_id = @user_id)::bool AS is_organizer,
    COALESCE((SELECT m.role FROM event_members m WHERE m.event_id = e.id AND m.user_id = @user_id AND m.status = 'active'), '')::text AS role
FROM events e WHERE e.id = ANY (@event_ids::uuid[]);

-- name: UserOrganizesAny :one
SELECT EXISTS (SELECT 1 FROM event_organizers WHERE user_id = $1)::bool;

-- name: AddOrganizer :execrows
INSERT INTO event_organizers (event_id, user_id, assigned_by) VALUES (@event_id, @user_id, sqlc.narg('assigned_by'))
ON CONFLICT DO NOTHING;

-- name: RemoveOrganizer :execrows
DELETE FROM event_organizers WHERE event_id = @event_id AND user_id = @user_id;

-- name: GetMember :one
SELECT * FROM event_members WHERE event_id = @event_id AND user_id = @user_id;

-- name: UpsertMember :exec
INSERT INTO event_members (event_id, user_id, role, status, added_by)
VALUES (@event_id, @user_id, @role, 'active', sqlc.narg('added_by'))
ON CONFLICT (event_id, user_id) DO UPDATE SET role = EXCLUDED.role, status = 'active', updated_at = now(),
    joined_at = CASE WHEN event_members.status = 'removed' THEN now() ELSE event_members.joined_at END;

-- name: EnsureMember :execrows
INSERT INTO event_members (event_id, user_id, role, status, added_by)
VALUES (@event_id, @user_id, @role, 'active', sqlc.narg('added_by'))
ON CONFLICT (event_id, user_id) DO NOTHING;

-- name: RemoveMember :execrows
UPDATE event_members SET status = 'removed', updated_at = now()
WHERE event_id = @event_id AND user_id = @user_id AND status = 'active';

-- name: ListMembers :many
-- Union of organizers and members; role is NULL for organizers without a member role.
SELECT u.id AS user_id, u.full_name, p.public_id, COALESCE(p.phone, '')::text AS phone,
    m.role AS role, COALESCE(m.status, 'active')::text AS status,
    (o.user_id IS NOT NULL)::bool AS is_organizer,
    COALESCE(m.joined_at, o.assigned_at)::timestamptz AS joined_at
FROM users u
LEFT JOIN event_members m ON m.event_id = @event_id AND m.user_id = u.id
LEFT JOIN event_organizers o ON o.event_id = @event_id AND o.user_id = u.id
LEFT JOIN pilot_profiles p ON p.user_id = u.id
WHERE (m.user_id IS NOT NULL OR o.user_id IS NOT NULL)
  AND (@include_removed::bool OR o.user_id IS NOT NULL OR m.status = 'active')
  AND (@role::text = '' OR m.role = @role::text)
ORDER BY (o.user_id IS NULL), CASE m.role WHEN 'pilot' THEN 0 WHEN 'retriever' THEN 1 ELSE 2 END, u.full_name;

-- name: ListActiveMemberIDs :many
SELECT user_id FROM event_members WHERE event_id = $1 AND status = 'active';

-- name: ListMemberIDsByRole :many
SELECT user_id FROM event_members WHERE event_id = @event_id AND status = 'active' AND role = @role;

-- name: ListOrganizerIDs :many
SELECT user_id FROM event_organizers WHERE event_id = $1;

-- name: GetUserName :one
SELECT id, full_name FROM users WHERE id = $1;

-- name: CreateApplication :one
INSERT INTO event_applications (event_id, user_id, message)
VALUES (@event_id, @user_id, @message)
RETURNING id;

-- name: GetApplication :one
SELECT * FROM event_applications WHERE id = @id AND event_id = @event_id;

-- name: LockApplication :one
SELECT * FROM event_applications WHERE id = @id AND event_id = @event_id FOR UPDATE;

-- name: DecideApplication :execrows
UPDATE event_applications SET status = @status, granted_role = sqlc.narg('granted_role'),
    decided_by = sqlc.narg('decided_by'), decision_note = @decision_note, decided_at = now(), updated_at = now()
WHERE id = @id AND status = 'pending';

-- name: ApprovePendingApplicationsForUser :execrows
UPDATE event_applications SET status = 'approved', granted_role = @granted_role, decided_by = sqlc.narg('decided_by'),
    decision_note = 'added directly', decided_at = now(), updated_at = now()
WHERE event_id = @event_id AND user_id = @user_id AND status = 'pending';

-- name: ListApplications :many
SELECT a.*, u.full_name, u.email, p.public_id, COALESCE(d.full_name, '')::text AS decided_by_name
FROM event_applications a
JOIN users u ON u.id = a.user_id
LEFT JOIN pilot_profiles p ON p.user_id = a.user_id
LEFT JOIN users d ON d.id = a.decided_by
WHERE a.event_id = @event_id AND (cardinality(@statuses::text[]) = 0 OR a.status = ANY (@statuses::text[]))
  AND (sqlc.narg('only_id')::uuid IS NULL OR a.id = sqlc.narg('only_id')::uuid)
ORDER BY a.created_at, a.id;

-- name: LatestApplicationsForUser :many
SELECT DISTINCT ON (event_id) id, event_id, status
FROM event_applications
WHERE user_id = @user_id AND event_id = ANY (@event_ids::uuid[])
ORDER BY event_id, created_at DESC, id DESC;

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

-- name: EventReportMembers :one
SELECT
    count(*) FILTER (WHERE m.role = 'pilot' AND m.status = 'active')::int AS pilots,
    count(*) FILTER (WHERE m.role = 'observer' AND m.status = 'active')::int AS observers,
    count(*) FILTER (WHERE m.role = 'retriever' AND m.status = 'active')::int AS retrievers,
    count(*) FILTER (WHERE m.status = 'removed')::int AS removed
FROM event_members m WHERE m.event_id = $1;

-- name: CountOrganizers :one
SELECT count(*)::int FROM event_organizers o WHERE o.event_id = $1;

-- name: CountPendingApplications :one
SELECT count(*)::int FROM event_applications a WHERE a.event_id = $1 AND a.status = 'pending';

-- name: EventReportFlights :many
SELECT f.id, f.pilot_id, u.full_name, f.status, f.is_simulated, f.started_at, f.ended_at, f.sample_count,
       f.first_sample_t, f.last_sample_t, f.gap_count, f.distance_m, f.max_gps_alt_m, f.last_received_at
FROM flight_sessions f JOIN users u ON u.id = f.pilot_id
WHERE f.event_id = $1
ORDER BY f.started_at;

-- name: EventReportRetrievals :one
SELECT
    count(*)::int AS total,
    count(*) FILTER (WHERE status = 'requested')::int AS requested,
    count(*) FILTER (WHERE status = 'accepted')::int AS accepted,
    count(*) FILTER (WHERE status = 'picked_up')::int AS picked_up,
    count(*) FILTER (WHERE status = 'delivered')::int AS delivered,
    count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
    count(*) FILTER (WHERE is_simulated)::int AS simulated,
    COALESCE((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM accepted_at - requested_at))
        FILTER (WHERE accepted_at IS NOT NULL)), -1)::float8 AS median_request_to_accept_s,
    COALESCE((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM picked_up_at - accepted_at))
        FILTER (WHERE picked_up_at IS NOT NULL AND accepted_at IS NOT NULL)), -1)::float8 AS median_accept_to_pickup_s,
    COALESCE((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM delivered_at - picked_up_at))
        FILTER (WHERE delivered_at IS NOT NULL AND picked_up_at IS NOT NULL)), -1)::float8 AS median_pickup_to_delivery_s
FROM retrievals WHERE event_id = $1;

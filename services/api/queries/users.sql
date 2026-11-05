-- name: CreateUser :one
INSERT INTO users (email, password_hash, full_name, email_verified_at, must_change_password, password_expires_at)
VALUES (@email, @password_hash, @full_name, sqlc.narg('email_verified_at'), @must_change_password, sqlc.narg('password_expires_at'))
RETURNING *;

-- name: GetUserByID :one
SELECT * FROM users WHERE id = $1;

-- name: GetUserByEmail :one
SELECT * FROM users WHERE email = @email::text;

-- name: ListUserRoles :many
SELECT role FROM user_roles WHERE user_id = $1 ORDER BY role;

-- name: AddUserRole :exec
INSERT INTO user_roles (user_id, role, granted_by) VALUES (@user_id, @role, sqlc.narg('granted_by'))
ON CONFLICT DO NOTHING;

-- name: RemoveUserRole :exec
DELETE FROM user_roles WHERE user_id = @user_id AND role = @role;

-- name: UpdateUserPassword :exec
UPDATE users SET password_hash = @password_hash, must_change_password = @must_change_password,
    password_expires_at = sqlc.narg('password_expires_at'), password_changed_at = sqlc.narg('password_changed_at'),
    updated_at = now()
WHERE id = @id;

-- name: UpdateUserFullName :exec
UPDATE users SET full_name = @full_name, updated_at = now() WHERE id = @id;

-- name: SetEmailVerified :exec
UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()), updated_at = now() WHERE id = $1;

-- name: SetUserDisabled :exec
UPDATE users SET disabled_at = CASE WHEN @disabled::bool THEN COALESCE(disabled_at, now()) ELSE NULL END,
    updated_at = now()
WHERE id = @id;

-- name: GetPilotProfile :one
SELECT * FROM pilot_profiles WHERE user_id = $1;

-- name: GetPilotProfileByPublicID :one
SELECT p.*, u.full_name, pr.public_profile, u.disabled_at, u.deleted_at
FROM pilot_profiles p
JOIN users u ON u.id = p.user_id
LEFT JOIN user_preferences pr ON pr.user_id = p.user_id
WHERE p.public_id = $1;

-- name: CreatePilotProfile :exec
INSERT INTO pilot_profiles (user_id, public_id, display_name) VALUES (@user_id, @public_id, @display_name)
ON CONFLICT (user_id) DO NOTHING;

-- name: PilotPublicIDExists :one
SELECT EXISTS (SELECT 1 FROM pilot_profiles WHERE public_id = $1);

-- name: UpdatePilotProfile :exec
UPDATE pilot_profiles SET display_name = @display_name, bio = @bio, wing = @wing, license_no = @license_no,
    nationality = @nationality, phone = @phone, emergency_contact_name = @emergency_contact_name,
    emergency_contact_phone = @emergency_contact_phone, updated_at = now()
WHERE user_id = @user_id;

-- name: GetPreferences :one
SELECT * FROM user_preferences WHERE user_id = $1;

-- name: UpsertPreferences :exec
INSERT INTO user_preferences (user_id, units, public_profile)
VALUES (@user_id, @units, @public_profile)
ON CONFLICT (user_id) DO UPDATE SET units = EXCLUDED.units,
    public_profile = EXCLUDED.public_profile, updated_at = now();

-- name: EnsurePreferences :exec
INSERT INTO user_preferences (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING;

-- name: UpsertDevice :exec
INSERT INTO devices (user_id, device_id, platform, apns_token, app_version, os_version)
VALUES (@user_id, @device_id, @platform, sqlc.narg('apns_token'), @app_version, @os_version)
ON CONFLICT (user_id, device_id) DO UPDATE SET platform = EXCLUDED.platform,
    apns_token = COALESCE(EXCLUDED.apns_token, devices.apns_token), app_version = EXCLUDED.app_version,
    os_version = EXCLUDED.os_version, last_seen_at = now();

-- name: ListPushDevices :many
SELECT user_id, device_id, apns_token FROM devices
WHERE user_id = ANY (@user_ids::uuid[]) AND apns_token IS NOT NULL;

-- name: ListDevicesForUser :many
SELECT * FROM devices WHERE user_id = $1 ORDER BY created_at;

-- name: SearchUsers :many
SELECT u.id, u.email, u.full_name, u.disabled_at, u.created_at, u.email_verified_at, u.must_change_password,
       p.public_id,
       COALESCE((SELECT array_agg(r.role ORDER BY r.role) FROM user_roles r WHERE r.user_id = u.id), '{}')::text[] AS roles
FROM users u
LEFT JOIN pilot_profiles p ON p.user_id = u.id
WHERE u.deleted_at IS NULL
  AND (@q::text = '' OR u.full_name ILIKE '%' || @q::text || '%' OR u.email::text ILIKE '%' || @q::text || '%'
       OR p.public_id ILIKE '%' || @q::text || '%')
  AND (sqlc.narg('after_name')::text IS NULL OR (u.full_name, u.id) > (sqlc.narg('after_name')::text, sqlc.narg('after_id')::uuid))
ORDER BY u.full_name, u.id
LIMIT @lim;

-- name: CountUsers :one
SELECT count(*) FROM users WHERE deleted_at IS NULL;

-- name: CreateDeletionRequest :one
INSERT INTO account_deletion_requests (user_id, reason, scheduled_for)
VALUES (@user_id, @reason, @scheduled_for)
ON CONFLICT (user_id) WHERE status = 'pending' DO UPDATE SET reason = EXCLUDED.reason
RETURNING *;

-- name: CancelDeletionRequest :execrows
UPDATE account_deletion_requests SET status = 'cancelled', cancelled_at = now()
WHERE user_id = $1 AND status = 'pending';

-- name: GetPendingDeletion :one
SELECT * FROM account_deletion_requests WHERE user_id = $1 AND status = 'pending';

-- name: ListDueDeletions :many
SELECT * FROM account_deletion_requests WHERE status = 'pending' AND scheduled_for <= now()
ORDER BY scheduled_for LIMIT 20 FOR UPDATE SKIP LOCKED;

-- name: CompleteDeletionRequest :exec
UPDATE account_deletion_requests SET status = 'completed', completed_at = now() WHERE id = $1;

-- name: AnonymizeUser :exec
UPDATE users SET email = 'deleted-' || id::text || '@deleted.invalid', full_name = 'Silinmiş kullanıcı',
    password_hash = @password_hash, must_change_password = false, password_expires_at = NULL,
    email_verified_at = NULL, disabled_at = COALESCE(disabled_at, now()), deleted_at = now(), updated_at = now()
WHERE id = @id;

-- name: AnonymizePilotProfile :exec
UPDATE pilot_profiles SET display_name = 'Silinmiş pilot', bio = '', wing = '', license_no = '', nationality = '',
    phone = '', emergency_contact_name = '', emergency_contact_phone = '', updated_at = now()
WHERE user_id = $1;

-- name: DeleteUserDevices :exec
DELETE FROM devices WHERE user_id = $1;

-- name: DeleteUserFlights :execrows
DELETE FROM flight_sessions WHERE pilot_id = $1;

-- name: DeleteUserRoles :exec
DELETE FROM user_roles WHERE user_id = $1;

-- name: SetPublicProfileOff :exec
UPDATE user_preferences SET public_profile = false, updated_at = now() WHERE user_id = $1;

-- name: RemoveUserMemberships :exec
UPDATE event_members SET status = 'removed', updated_at = now() WHERE user_id = $1;

-- name: RemoveUserOrganizerships :exec
DELETE FROM event_organizers WHERE user_id = $1;

-- name: WithdrawUserApplications :exec
UPDATE event_applications SET status = 'withdrawn', updated_at = now() WHERE user_id = $1 AND status = 'pending';

-- name: SearchUsersBasic :many
SELECT u.id, u.full_name, u.email, p.public_id
FROM users u LEFT JOIN pilot_profiles p ON p.user_id = u.id
WHERE u.deleted_at IS NULL AND u.disabled_at IS NULL
  AND (@q::text = '' OR u.full_name ILIKE '%' || @q::text || '%' OR u.email::text ILIKE '%' || @q::text || '%'
       OR p.public_id ILIKE '%' || @q::text || '%')
ORDER BY u.full_name, u.id
LIMIT @lim;

-- name: DeleteUserNotifications :exec
DELETE FROM notification_records WHERE user_id = $1;

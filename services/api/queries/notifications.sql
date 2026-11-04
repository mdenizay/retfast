-- name: InsertNotification :one
INSERT INTO notification_records (user_id, kind, title, body, data)
VALUES (@user_id, @kind, @title, @body, @data)
RETURNING id;

-- name: ListNotifications :many
SELECT id, kind, title, body, data, read_at, created_at FROM notification_records
WHERE user_id = @user_id
  AND (sqlc.narg('after_created')::timestamptz IS NULL
       OR (created_at, id) < (sqlc.narg('after_created')::timestamptz, sqlc.narg('after_id')::uuid))
ORDER BY created_at DESC, id DESC
LIMIT @lim;

-- name: MarkNotificationRead :execrows
UPDATE notification_records SET read_at = COALESCE(read_at, now()) WHERE id = @id AND user_id = @user_id;

-- name: MarkAllNotificationsRead :exec
UPDATE notification_records SET read_at = now() WHERE user_id = $1 AND read_at IS NULL;

-- name: ClaimPendingPush :many
SELECT id, user_id, kind, title, body, data FROM notification_records
WHERE push_status = 'pending' ORDER BY created_at LIMIT 100 FOR UPDATE SKIP LOCKED;

-- name: SetPushStatus :exec
UPDATE notification_records SET push_status = @push_status, push_attempted_at = now() WHERE id = ANY (@ids::uuid[]);

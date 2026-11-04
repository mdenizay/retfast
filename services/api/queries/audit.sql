-- name: InsertAudit :exec
INSERT INTO audit_logs (actor_id, action, target_type, target_id, event_id, ip, user_agent, details)
VALUES (sqlc.narg('actor_id'), @action, @target_type, @target_id, sqlc.narg('event_id'), @ip, @user_agent, @details);

-- name: ListAudit :many
SELECT a.id, a.actor_id, COALESCE(u.full_name, '') AS actor_name, a.action, a.target_type, a.target_id, a.event_id,
       a.ip, a.details, a.created_at
FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
WHERE (sqlc.narg('actor_id')::uuid IS NULL OR a.actor_id = sqlc.narg('actor_id')::uuid)
  AND (@action::text = '' OR a.action = @action::text OR a.action LIKE @action::text || '.%')
  AND (sqlc.narg('before_id')::bigint IS NULL OR a.id < sqlc.narg('before_id')::bigint)
ORDER BY a.id DESC
LIMIT @lim;

-- name: PruneExpiredSessions :execrows
DELETE FROM user_sessions WHERE expires_at < now() - interval '30 days';

-- name: PruneResetTokens :execrows
DELETE FROM password_reset_tokens WHERE expires_at < now() - interval '30 days';

-- name: PruneVerificationTokens :execrows
DELETE FROM email_verification_tokens WHERE expires_at < now() - interval '30 days';

-- name: PruneEmailOutbox :execrows
DELETE FROM email_outbox WHERE status IN ('sent', 'failed') AND updated_at < now() - interval '30 days';

-- name: PruneReadNotifications :execrows
DELETE FROM notification_records WHERE read_at IS NOT NULL AND read_at < now() - interval '180 days';

-- name: PruneAuditLogs :execrows
DELETE FROM audit_logs WHERE created_at < now() - interval '730 days';

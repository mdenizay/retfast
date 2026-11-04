-- name: CreateSession :exec
INSERT INTO user_sessions (id, family_id, user_id, token_hash, client, device_name, ip, user_agent, expires_at)
VALUES (@id, @family_id, @user_id, @token_hash, @client, @device_name, @ip, @user_agent, @expires_at);

-- name: GetSessionByHashForUpdate :one
SELECT * FROM user_sessions WHERE token_hash = $1 FOR UPDATE;

-- name: MarkSessionRotated :exec
UPDATE user_sessions SET rotated_at = now() WHERE id = $1;

-- name: RevokeFamily :execrows
UPDATE user_sessions SET revoked_at = now(), revoke_reason = @reason
WHERE family_id = @family_id AND revoked_at IS NULL;

-- name: RevokeUserSessionsExcept :exec
UPDATE user_sessions SET revoked_at = now(), revoke_reason = @reason
WHERE user_id = @user_id AND family_id <> @keep_family_id AND revoked_at IS NULL;

-- name: RevokeAllUserSessions :exec
UPDATE user_sessions SET revoked_at = now(), revoke_reason = @reason
WHERE user_id = @user_id AND revoked_at IS NULL;

-- name: FamilyActive :one
SELECT EXISTS (
    SELECT 1 FROM user_sessions
    WHERE family_id = $1 AND revoked_at IS NULL AND rotated_at IS NULL AND expires_at > now()
);

-- name: CreatePasswordResetToken :exec
INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (@user_id, @token_hash, @expires_at);

-- name: GetPasswordResetTokenForUpdate :one
SELECT * FROM password_reset_tokens WHERE token_hash = $1 FOR UPDATE;

-- name: MarkPasswordResetTokensUsed :exec
UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL;

-- name: CountRecentResetTokens :one
SELECT count(*) FROM password_reset_tokens WHERE user_id = $1 AND created_at > now() - interval '1 hour';

-- name: CreateEmailVerificationToken :exec
INSERT INTO email_verification_tokens (user_id, email, token_hash, expires_at)
VALUES (@user_id, @email, @token_hash, @expires_at);

-- name: GetEmailVerificationTokenForUpdate :one
SELECT * FROM email_verification_tokens WHERE token_hash = $1 FOR UPDATE;

-- name: MarkEmailVerificationTokenUsed :exec
UPDATE email_verification_tokens SET used_at = now() WHERE id = $1;

-- name: GetFamilyClient :one
SELECT client FROM user_sessions WHERE family_id = $1 ORDER BY created_at DESC LIMIT 1;

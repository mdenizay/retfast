-- name: EnqueueEmail :one
INSERT INTO email_outbox (to_email, template, subject, text_body, html_body)
VALUES (@to_email, @template, @subject, @text_body, @html_body)
RETURNING id;

-- name: ClaimEmails :many
SELECT id, to_email, template, subject, text_body, html_body, attempts FROM email_outbox
WHERE status = 'pending' AND next_attempt_at <= now()
ORDER BY next_attempt_at LIMIT @lim FOR UPDATE SKIP LOCKED;

-- name: MarkEmailSent :exec
UPDATE email_outbox SET status = 'sent', attempts = attempts + 1, sent_at = now(), provider_id = @provider_id,
    text_body = '', html_body = '', last_error = '', updated_at = now()
WHERE id = @id;

-- name: MarkEmailRetry :exec
UPDATE email_outbox SET attempts = attempts + 1, next_attempt_at = @next_attempt_at, last_error = @last_error,
    updated_at = now()
WHERE id = @id;

-- name: MarkEmailFailed :exec
UPDATE email_outbox SET status = 'failed', attempts = attempts + 1, last_error = @last_error,
    text_body = '', html_body = '', updated_at = now()
WHERE id = @id;

-- name: GetEmail :one
SELECT * FROM email_outbox WHERE id = $1;

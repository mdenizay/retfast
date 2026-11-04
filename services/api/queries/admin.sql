-- name: AdminStats :one
SELECT
    (SELECT count(*) FROM events WHERE status = 'active')::int AS active_events,
    (SELECT count(*) FROM flight_sessions WHERE status = 'recording' AND last_received_at > now() - interval '30 seconds')::int AS tracking_pilots,
    (SELECT count(*) FROM flight_sessions WHERE status = 'recording'
        AND COALESCE(last_received_at, created_at) < now() - interval '5 minutes')::int AS stale_sessions,
    (SELECT count(*) FROM emergency_incidents WHERE status IN ('open', 'acknowledged', 'responding'))::int AS open_incidents,
    (SELECT count(*) FROM flight_sessions WHERE started_at > now() - interval '24 hours')::int AS recent_flights,
    (SELECT count(*) FROM users WHERE deleted_at IS NULL)::int AS users,
    (SELECT count(*) FROM realtime_outbox)::int AS outbox_depth,
    (SELECT count(*) FROM email_outbox WHERE status = 'failed' AND updated_at > now() - interval '24 hours')::int AS email_failed_24h,
    (SELECT count(*) FROM email_outbox WHERE status = 'pending')::int AS email_pending;

# Realtime strategy

Supabase Realtime (`postgres_changes` over WAL) is the live transport. The
`supabase_realtime` publication carries: `tasks`, `location_points`,
`retriever_profiles`, `retrieval_requests`, `retrieval_assignments`,
`emergency_events`, `participation_requests`, `notifications`.

RLS is enforced per subscriber by Realtime's WAL filtering — a client only
receives rows its policies allow it to SELECT. Subscriptions therefore never
need to be "trusted"; filters below are for bandwidth, not security.

## Channels per surface

### Web — live operations map (observer/admin)
```
channel: ops:{eventId}
  postgres_changes INSERT  location_points       filter event_id=eq.{eventId}
  postgres_changes *       tasks                 filter event_id=eq.{eventId}
  postgres_changes *       retriever_profiles    filter event_id=eq.{eventId}
  postgres_changes *       retrieval_requests    filter event_id=eq.{eventId}
  postgres_changes *       retrieval_assignments filter event_id=eq.{eventId}
  postgres_changes *       emergency_events      filter event_id=eq.{eventId}
```
The map keeps an in-memory "latest position per actor" store; INSERTs update
markers, task/assignment changes update side panels, emergency INSERTs raise
the alarm banner (plus audible alert).

### iOS — pilot in flight
```
channel: pilot:{taskId}
  postgres_changes *  retrieval_requests    filter task_id=eq.{taskId}
  postgres_changes *  retrieval_assignments filter task_id=eq.{taskId}
```
The pilot doesn't subscribe to their own points (they produce them). They only
watch their retrieval state (accept/decline/en-route/pickup).

### iOS — retriever on duty
```
channel: retriever:{eventId}:{userId}
  postgres_changes INSERT retrieval_requests    filter retriever_id=eq.{userId}
  postgres_changes *      retrieval_assignments filter retriever_id=eq.{userId}
```
On a new pending request the app shows the 60-second acceptance sheet
(server-side `expires_at` is authoritative; the countdown is cosmetic). For an
active job, the retriever additionally subscribes to
`location_points` INSERTs filtered by the pilot's `task_id` (RLS grants this
exactly while assigned/offered).

### Notifications (all clients)
```
channel: user:{userId}
  postgres_changes INSERT notifications filter user_id=eq.{userId}
```

## Volume control

- Pilots upload in batches (default 10–30 s cadence, see
  [ios-tracking.md](ios-tracking.md)), so `location_points` INSERTs arrive in
  bursts of 3–30 rows; the ops map renders the newest point per task and
  appends to the trail — no per-row re-render.
- `location_points` uses default replica identity (PK only) — inserts only,
  no updates, keeps WAL lean. The small state tables use
  `REPLICA IDENTITY FULL` so UPDATE events carry old rows.
- If an event ever outgrows CDC fanout (hundreds of pilots), the escape hatch
  is Realtime **broadcast** channels fed by an Edge Function, without schema
  changes; the channel names above are already per-event, so clients would
  migrate transparently.

## Reconnect semantics

Clients treat Realtime as *ephemeral*: on subscribe/reconnect they first fetch
current state via PostgREST (latest point per task, open assignments, open
emergencies), then apply live events on top. Missing a WAL event is therefore
never fatal — the next full fetch reconverges.

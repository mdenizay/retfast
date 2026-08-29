# RLS & authorization model

Authorization lives entirely in Postgres. Clients are untrusted; the anon key
only allows signup/login through GoTrue — **`anon` has no grants on any
application table**.

## Three layers

1. **Row Level Security** — who can *read* which rows (and the few direct
   writes that are safe).
2. **SECURITY DEFINER RPCs** — the only way to perform state transitions.
   Tables with invariants (memberships, tasks, points, retrieval, emergencies)
   have *no* insert/update policies at all; the RPCs validate roles, state
   machines and ownership, then write as the function owner.
3. **Column-level grants** — on top of RLS for sensitive columns:
   - `events.invite_code`: not selectable/updatable by any client role;
     admins use the `event_invite_code(event, rotate)` RPC.
   - `profiles.is_system_admin`: not updatable by clients (service role only).
   - `participation_requests`: clients may only update `status` (withdrawal).
   - `retriever_profiles`: clients may only update vehicle fields.
   - `notifications`: clients may only update `read_at`.

## Helper predicates

`SECURITY DEFINER, STABLE` SQL functions used inside policies (definer avoids
recursive RLS evaluation on `event_members`):

- `is_system_admin()`
- `has_event_role(event, role)` / `is_event_member(event)`
- `is_event_admin(event)` = event_admin role ∨ system admin
- `is_event_operator(event)` = event admin ∨ observer
- `shares_event_with(user)` — profile visibility

## Access matrix (SELECT)

| Table | pilot | retriever | observer | event admin | system admin |
|---|---|---|---|---|---|
| profiles | self + event co-members | same | same | same | all |
| events | public + own memberships | same | same | same | all |
| event_members | own event rosters | same | same | same | all |
| participation_requests | own | own | — | event's | all |
| geo_zones | event's | event's | event's | event's | all |
| tasks | event's (incl. own) | event's | event's | event's | all |
| location_points | **own only** | own + tasks assigned/offered to them | event's | event's | all |
| retriever_profiles | event's (to pick a retriever) | event's | event's | event's | all |
| retriever_sessions | own | own | event's | event's | all |
| retrieval_requests | own (as pilot) | own (as target) | event's | event's | all |
| retrieval_assignments | own | own | event's | event's | all |
| emergency_events | event's | event's | event's | event's | all |
| devices / notifications | own | own | own | own | own |
| audit_logs | — | — | — | event's | all |

The deliberate asymmetry: **pilots do not see other pilots' live tracks**
(competitive + privacy), while operators see everything in their event and
retrievers see exactly the pilots they are being asked to fetch (pending
request or active assignment).

## Write paths

| Action | Path | Guard |
|---|---|---|
| update own profile | direct UPDATE | RLS self + column grant |
| create event | direct INSERT | `is_system_admin()` |
| edit event / zones | direct UPDATE/INSERT/DELETE | `is_event_admin()` |
| join by code / request role | `join_event_by_code`, `request_participation` | code check in definer |
| approve/reject/grant/revoke | `decide_participation`, `grant_event_role`, `revoke_event_role` | `is_event_admin()` |
| flight lifecycle | `start_task`, `transition_task` | pilot ownership + state machine |
| location upload | `ingest_location_points` | per-point ownership, open task/session only |
| duty & vehicle | `start/end_retriever_duty`, `update_retriever_vehicle` | retriever role |
| retrieval | `request_retrieval`, `respond_retrieval`, `cancel_retrieval_request` | pilot/target checks, expiry |
| manual dispatch | `create_assignment` | `is_event_operator()` |
| job progress | `advance_assignment` | assignee or operator + state machine |
| SOS | `raise_emergency`, `update_emergency` | member / operator |
| push token | `register_device` | self |

Every RPC writes an `audit_logs` row via the internal `log_audit()` (no client
role has execute on it).

## Notes

- `service_role` bypasses RLS (Supabase default) — used only by the seed
  script and Edge Functions.
- Realtime subscriptions are filtered by the same RLS policies (Realtime
  evaluates them per subscriber), so a pilot cannot subscribe their way into
  another pilot's track.
- All helper functions and RPCs pin `search_path = public` and are revoked
  from `public`/`anon`.

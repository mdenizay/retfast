# RETFAST — Architecture

## 1. System overview

```
┌─────────────┐        ┌──────────────────────────────────────────┐
│  iOS app    │  HTTPS │  Self-hosted Supabase (Dokploy)          │
│  (SwiftUI)  ├───────►│  Kong ─► GoTrue (Auth)                   │
│  Pilot /    │  WSS   │       ─► PostgREST (REST + RPC)          │
│  Retriever  ├───────►│       ─► Realtime (Postgres CDC + WS)    │
└─────────────┘        │       ─► Storage                         │
┌─────────────┐        │       ─► Edge Functions (Deno)           │
│  Web app    ├───────►│  Postgres 15 + PostGIS                   │
│  (React)    │        └──────────────┬───────────────────────────┘
│  Observer / │                       │ SMTP (Resend)
│  Admins     │                       ▼
└─────────────┘                  email delivery
```

There is **no custom application server**. All authorization lives in Postgres
Row Level Security (see [rls.md](rls.md)); all writes go through PostgREST
(tables + `SECURITY DEFINER` RPC functions) so the database is the single
source of truth. Edge Functions are reserved for the few things SQL cannot do
(push-notification fanout via APNs, transactional email via Resend).

## 2. Roles

Global (on `profiles`):

- **user** — any authenticated account.
- **system_admin** — full administrative access, may create events.

Per-event (rows in `event_members`, one row per role, so a user can hold
several roles in one event and different roles across events):

- **pilot** — flies tasks, streams location, requests retrieval, can SOS.
- **retriever** — shares location while on duty, executes retrieval jobs.
- **observer** — read access to the event's live operations, may assign
  pilots to retrievers from the dashboard.
- **event_admin** — administers a single event (zones, approvals, roles).

## 3. Core flows

### Event lifecycle
1. System admin creates event (name, description, dates, visibility
   `public | unlisted | private`, invitation code, settings JSON).
2. Users discover public events, or join unlisted/private ones by invitation
   code (`join_event_by_code` RPC — the code is never readable via RLS).
3. Users file `participation_requests` with a desired role; event/system
   admins approve → an `event_members` row is created atomically.

### Pilot task (flight)
`draft` is not modelled — a task exists once started.

```
start_task ──► active ──► mark landed ──► landed ──► finish ──► completed
                 │                          │
                 └── cancel(reason) ────────┴──► cancelled
                 │
                 └── SOS ──► emergency_events row (task keeps its own status)
```

Each task owns an independent track (`location_points.task_id`), replayable
with a timeline. A pilot may run several tasks in one event (sequential;
starting a new task auto-finishes nothing — the app enforces one *active*
task and the DB enforces it with a partial unique index).

### Retrieval
```
pilot requests ─► retrieval_requests(status=pending, expires_at=now()+60s)
   retriever accepts within window ─► retrieval_assignments created
      en_route ─► picked_up ─► delivered ─► completed
   retriever declines / timeout ─► pilot picks another retriever
observer may create an assignment directly (manual dispatch)
```

Retriever capacity (`vehicle_capacity` vs. occupied seats) is derived in the
database: `occupied = count(assignments in status picked_up)` and enforced by
triggers, never trusted from the client.

### Emergency
`raise_emergency` RPC inserts an `emergency_events` row with last known
location; Realtime pushes it to the ops dashboard; an Edge Function fans out
push + Resend email to admins/observers/nearby retrievers. Emergencies are
acknowledged and resolved from the web dashboard with a full audit trail.

## 4. Clients

### iOS (`apps/ios`)
Native SwiftUI targeting Pilots and Retrievers. Key subsystems:

- `TrackingEngine` — CoreLocation wrapper: high-accuracy background updates,
  adaptive frequency, battery-aware throttling. See
  [ios-tracking.md](ios-tracking.md).
- `PointBuffer` — local SQLite queue; every point gets a client-generated
  UUID so batched upload is idempotent (`ingest_location_points` RPC upserts
  on the UUID).
- `SyncEngine` — batches points (25–100 per request), retries with backoff,
  survives app relaunch, drains the queue when connectivity returns.
- Retriever mode: split screen (map on top, jobs below), availability toggle,
  job workflow buttons, hand-off to Apple/Google/Yandex Maps for navigation.

### Web (`apps/web`)
React SPA for Observers/Event Admins/System Admins: auth, event CRUD,
application/role management, GeoJSON zone editor (MapLibre + terra-draw),
live operations map, retrieval dispatch, emergency monitor, flight history
with route/timeline replay, user management, audit log viewer.

Maps go through `src/lib/map/` — a provider abstraction that currently binds
MapLibre with configurable raster/vector style URLs, so the tile provider can
be swapped via env without touching feature code.

## 5. Internationalization

Both clients are multi-language from day one (initially `en`, `tr`):

- Web: a tiny typed i18n layer (`src/i18n/`) with per-locale JSON catalogs;
  locale persisted per user in `profiles.locale`.
- iOS: `String(localized:)` catalogs (`Localizable.xcstrings`), same keys
  where concepts overlap.
- Database enums/labels are language-neutral codes; all display strings live
  client-side.

## 6. Configuration & secrets

All secrets come from environment (`.env`, gitignored). Clients only ever see
the **anon/publishable** key; the **service-role** key is used exclusively by
the seed script and Edge Functions. See `.env.example` files in each app.

## 7. Deployment

- Supabase runs on Dokploy (docker compose) behind Kong; public URL
  `https://supa.retfast.com` (currently the sslip.io preview URL).
- Web app: static Vite build served by nginx via Dokploy, `panel.retfast.com`.
- DNS on Cloudflare (`retfast.com`).
- iOS distributed through TestFlight/App Store (`com.mizibu.retfast`).

## 8. Design priorities

Ordered: tracking reliability → safety (SOS) → offline resilience →
authorization correctness → battery efficiency → everything else. Features
were modelled in the database first (see [database.md](database.md)) so every
client is a thin, replaceable view over the same authorized API.

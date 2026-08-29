# RETFAST — Supabase layer

Self-hosted Supabase (Dokploy). This directory is the source of truth for the
database schema, authorization model and server-side logic.

## Layout

- `migrations/` — ordered SQL migrations, applied with plain `psql`:
  - `0001_schema.sql` — extensions (PostGIS), enums, tables, indexes, integrity triggers
  - `0002_functions.sql` — RLS helper predicates + the entire RPC surface
  - `0003_rls.sql` — RLS policies, column-level grants, realtime publication
- `seed/` — idempotent dev seed (**Çameli XC-Open 2026**), runs with the service-role key
- `functions/notify-emergency/` — Edge Function: emergency email fanout via Resend

## Applying migrations

```sh
for f in supabase/migrations/*.sql; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
done
```

`DATABASE_URL` is the direct Postgres connection (or the Supavisor session
pooler). Migrations are transactional; each file is safe to apply exactly once
and in order. Track applied files manually or via a `schema_migrations` table
if the set grows.

## Seed

```sh
cd supabase/seed
cp .env.example .env   # fill SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
npm install && npm run seed
```

Creates 8 users (password `retfast2026`), the public event
**Çameli XC-Open 2026** (invite code `CAMELI26`), four geo zones, a completed
replayable flight, a landed-out pilot with an en-route retrieval, a pending
participation request and a resolved emergency.

## Design docs

- [Schema](../docs/database.md) · [RLS model](../docs/rls.md) ·
  [Realtime](../docs/realtime.md)

## Conventions

- Clients talk to tables for **reads** (RLS-guarded) and to **RPC functions**
  for every state transition; tables with invariants have no insert/update
  policies at all.
- `events.invite_code` and `profiles.is_system_admin` are additionally locked
  down with column grants — no client role can select/update them directly.
- The service-role key is used only by the seed script and Edge Functions.

-- RETFAST 0001 — extensions, enums, tables, indexes, integrity triggers
-- Applied with: psql "$DATABASE_URL" -f supabase/migrations/0001_schema.sql

begin;

create extension if not exists postgis;
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.event_visibility as enum ('public', 'unlisted', 'private');
create type public.event_role as enum ('pilot', 'retriever', 'observer', 'event_admin');
create type public.request_status as enum ('pending', 'approved', 'rejected', 'cancelled');
create type public.zone_type as enum ('takeoff', 'landing', 'restricted', 'checkpoint', 'custom');
create type public.task_status as enum ('active', 'landed', 'completed', 'cancelled');
create type public.tracking_state as enum ('foreground', 'background', 'low_power', 'paused');
create type public.retriever_availability as enum ('offline', 'available', 'busy');
create type public.retrieval_request_status as enum ('pending', 'accepted', 'declined', 'expired', 'cancelled');
create type public.assignment_status as enum ('assigned', 'en_route', 'picked_up', 'delivered', 'completed', 'cancelled');
create type public.emergency_status as enum ('open', 'acknowledged', 'resolved');

-- ---------------------------------------------------------------------------
-- Profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------

create table public.profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  display_name    text not null default '',
  avatar_url      text,
  phone           text,
  locale          text not null default 'en',
  is_system_admin boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, locale)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data ->> 'locale', 'en')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Events & membership
-- ---------------------------------------------------------------------------

create table public.events (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  description  text not null default '',
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  visibility   public.event_visibility not null default 'public',
  -- Never exposed through RLS selects; joining goes through join_event_by_code().
  invite_code  text not null unique default upper(encode(gen_random_bytes(5), 'hex')),
  settings     jsonb not null default '{}'::jsonb,
  is_archived  boolean not null default false,
  created_by   uuid not null references public.profiles (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint events_dates check (ends_at > starts_at)
);

create table public.event_members (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  role       public.event_role not null,
  added_by   uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (event_id, user_id, role)
);

create index event_members_user_idx on public.event_members (user_id);
create index event_members_event_role_idx on public.event_members (event_id, role);

create table public.participation_requests (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid not null references public.events (id) on delete cascade,
  user_id        uuid not null references public.profiles (id) on delete cascade,
  requested_role public.event_role not null,
  message        text not null default '',
  status         public.request_status not null default 'pending',
  decided_by     uuid references public.profiles (id),
  decided_at     timestamptz,
  created_at     timestamptz not null default now()
);

create unique index participation_requests_one_pending
  on public.participation_requests (event_id, user_id, requested_role)
  where status = 'pending';
create index participation_requests_event_idx on public.participation_requests (event_id, status);

-- ---------------------------------------------------------------------------
-- Geo zones (GeoJSON map objects drawn by event admins)
-- ---------------------------------------------------------------------------

create table public.geo_zones (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events (id) on delete cascade,
  name       text not null,
  zone_type  public.zone_type not null default 'custom',
  -- A GeoJSON *geometry* object (Point / LineString / Polygon / Multi*)
  geometry   jsonb not null,
  -- Presentation + operational metadata (color override, min/max altitude, radius…)
  properties jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index geo_zones_event_idx on public.geo_zones (event_id);

-- ---------------------------------------------------------------------------
-- Tasks (flights)
-- ---------------------------------------------------------------------------

create table public.tasks (
  id               uuid primary key default gen_random_uuid(),
  event_id         uuid not null references public.events (id) on delete cascade,
  pilot_id         uuid not null references public.profiles (id) on delete cascade,
  title            text not null default '',
  status           public.task_status not null default 'active',
  started_at       timestamptz not null default now(),
  landed_at        timestamptz,
  finished_at      timestamptz,
  cancelled_reason text,
  created_at       timestamptz not null default now()
);

-- One in-flight (active or landed-but-not-finished) task per pilot per event.
create unique index tasks_one_open_per_pilot
  on public.tasks (event_id, pilot_id)
  where status in ('active', 'landed');
create index tasks_event_idx on public.tasks (event_id, status);
create index tasks_pilot_idx on public.tasks (pilot_id, started_at desc);

-- ---------------------------------------------------------------------------
-- Retriever duty & capacity
-- ---------------------------------------------------------------------------

create table public.retriever_profiles (
  event_id            uuid not null references public.events (id) on delete cascade,
  user_id             uuid not null references public.profiles (id) on delete cascade,
  availability        public.retriever_availability not null default 'offline',
  vehicle_capacity    integer not null default 3 check (vehicle_capacity between 1 and 20),
  occupied_seats      integer not null default 0 check (occupied_seats >= 0),
  vehicle_description text not null default '',
  last_geom           geography(point, 4326),
  last_seen_at        timestamptz,
  updated_at          timestamptz not null default now(),
  primary key (event_id, user_id)
);

create table public.retriever_sessions (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at   timestamptz
);

create unique index retriever_sessions_one_open
  on public.retriever_sessions (event_id, user_id)
  where ended_at is null;

-- ---------------------------------------------------------------------------
-- Location points (pilot tracks + retriever breadcrumbs)
-- ---------------------------------------------------------------------------

create table public.location_points (
  -- Client-generated UUID: batched uploads upsert on this key, making
  -- ingestion idempotent across retries and reconnects.
  id                   uuid primary key,
  event_id             uuid not null references public.events (id) on delete cascade,
  user_id              uuid not null references public.profiles (id) on delete cascade,
  task_id              uuid references public.tasks (id) on delete cascade,
  retriever_session_id uuid references public.retriever_sessions (id) on delete cascade,
  recorded_at          timestamptz not null,
  geom                 geography(point, 4326) not null,
  altitude_m           double precision,
  heading_deg          double precision,
  speed_mps            double precision,
  h_accuracy_m         double precision,
  v_accuracy_m         double precision,
  battery_pct          smallint check (battery_pct between 0 and 100),
  tracking_state       public.tracking_state not null default 'foreground',
  created_at           timestamptz not null default now(),
  constraint location_points_one_source
    check (num_nonnulls(task_id, retriever_session_id) = 1)
);

create index location_points_task_idx on public.location_points (task_id, recorded_at);
create index location_points_session_idx on public.location_points (retriever_session_id, recorded_at);
create index location_points_event_idx on public.location_points (event_id, recorded_at desc);

-- Keep retriever_profiles.last_geom fresh from breadcrumbs.
create or replace function public.touch_retriever_last_seen()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.retriever_session_id is not null then
    update public.retriever_profiles
       set last_geom = new.geom,
           last_seen_at = greatest(coalesce(last_seen_at, new.recorded_at), new.recorded_at),
           updated_at = now()
     where event_id = new.event_id and user_id = new.user_id;
  end if;
  return new;
end;
$$;

create trigger location_points_touch_retriever
  after insert on public.location_points
  for each row execute function public.touch_retriever_last_seen();

-- ---------------------------------------------------------------------------
-- Retrieval workflow
-- ---------------------------------------------------------------------------

create table public.retrieval_requests (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.events (id) on delete cascade,
  task_id      uuid not null references public.tasks (id) on delete cascade,
  pilot_id     uuid not null references public.profiles (id) on delete cascade,
  retriever_id uuid not null references public.profiles (id) on delete cascade,
  status       public.retrieval_request_status not null default 'pending',
  expires_at   timestamptz not null default now() + interval '60 seconds',
  responded_at timestamptz,
  created_at   timestamptz not null default now()
);

create unique index retrieval_requests_one_pending_per_task
  on public.retrieval_requests (task_id)
  where status = 'pending';
create index retrieval_requests_retriever_idx on public.retrieval_requests (retriever_id, status);

create table public.retrieval_assignments (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.events (id) on delete cascade,
  task_id      uuid not null references public.tasks (id) on delete cascade,
  pilot_id     uuid not null references public.profiles (id) on delete cascade,
  retriever_id uuid not null references public.profiles (id) on delete cascade,
  request_id   uuid references public.retrieval_requests (id) on delete set null,
  -- Null when created by a retriever accepting a request; set when an
  -- observer/admin dispatches manually.
  assigned_by  uuid references public.profiles (id),
  status       public.assignment_status not null default 'assigned',
  en_route_at  timestamptz,
  picked_up_at timestamptz,
  delivered_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at   timestamptz not null default now()
);

create unique index retrieval_assignments_one_active_per_task
  on public.retrieval_assignments (task_id)
  where status in ('assigned', 'en_route', 'picked_up');
create index retrieval_assignments_retriever_idx on public.retrieval_assignments (retriever_id, status);
create index retrieval_assignments_event_idx on public.retrieval_assignments (event_id, status);

-- Derive occupied seats + busy flag whenever an assignment changes state.
create or replace function public.recompute_retriever_capacity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event uuid := coalesce(new.event_id, old.event_id);
  v_retriever uuid := coalesce(new.retriever_id, old.retriever_id);
  v_occupied integer;
  v_active integer;
begin
  select
    count(*) filter (where status = 'picked_up'),
    count(*) filter (where status in ('assigned', 'en_route', 'picked_up'))
  into v_occupied, v_active
  from public.retrieval_assignments
  where event_id = v_event and retriever_id = v_retriever;

  update public.retriever_profiles
     set occupied_seats = v_occupied,
         availability = (case
           when availability = 'offline' then 'offline'
           when v_active > 0 and v_occupied >= vehicle_capacity then 'busy'
           else 'available'
         end)::public.retriever_availability,
         updated_at = now()
   where event_id = v_event and user_id = v_retriever;
  return coalesce(new, old);
end;
$$;

create trigger retrieval_assignments_capacity
  after insert or update of status or delete on public.retrieval_assignments
  for each row execute function public.recompute_retriever_capacity();

-- ---------------------------------------------------------------------------
-- Emergencies
-- ---------------------------------------------------------------------------

create table public.emergency_events (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references public.events (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  task_id         uuid references public.tasks (id) on delete set null,
  geom            geography(point, 4326),
  message         text not null default '',
  status          public.emergency_status not null default 'open',
  acknowledged_by uuid references public.profiles (id),
  acknowledged_at timestamptz,
  resolved_by     uuid references public.profiles (id),
  resolved_at     timestamptz,
  created_at      timestamptz not null default now()
);

create index emergency_events_event_idx on public.emergency_events (event_id, status, created_at desc);

-- ---------------------------------------------------------------------------
-- Devices, notifications, audit
-- ---------------------------------------------------------------------------

create table public.devices (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  platform    text not null default 'ios' check (platform in ('ios')),
  push_token  text not null,
  model       text not null default '',
  app_version text not null default '',
  locale      text not null default 'en',
  last_seen_at timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  unique (user_id, push_token)
);

create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  type       text not null,
  title      text not null default '',
  body       text not null default '',
  payload    jsonb not null default '{}'::jsonb,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_idx on public.notifications (user_id, created_at desc);

create table public.audit_logs (
  id         bigint generated always as identity primary key,
  actor_id   uuid references public.profiles (id) on delete set null,
  event_id   uuid references public.events (id) on delete set null,
  action     text not null,
  entity     text not null,
  entity_id  text,
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_logs_event_idx on public.audit_logs (event_id, created_at desc);

-- updated_at maintenance
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger touch_profiles before update on public.profiles
  for each row execute function public.touch_updated_at();
create trigger touch_events before update on public.events
  for each row execute function public.touch_updated_at();
create trigger touch_geo_zones before update on public.geo_zones
  for each row execute function public.touch_updated_at();

commit;

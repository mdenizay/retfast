-- RETFAST 0003 — Row Level Security, table/column grants, realtime publication
--
-- Principles (docs/rls.md):
--  * anon has NO access to any application table.
--  * Reads are granted by RLS policies below.
--  * Every state-changing write with invariants goes through the SECURITY
--    DEFINER RPCs in 0002; those tables simply have no INSERT/UPDATE policies.
--  * Sensitive columns (events.invite_code, profiles.is_system_admin) are
--    protected with column-level grants on top of RLS.

begin;

-- ---------------------------------------------------------------------------
-- Baseline grants
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon;

alter default privileges in schema public revoke all on tables from anon;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;

create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_system_admin() or public.shares_event_with(id));

create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Nobody flips their own admin bit: is_system_admin is only writable by the
-- service role (seed script / SQL console).
revoke update on public.profiles from authenticated;
grant update (display_name, avatar_url, phone, locale) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- events (invite_code never selectable; use event_invite_code() RPC)
-- ---------------------------------------------------------------------------

alter table public.events enable row level security;

create policy events_select on public.events for select to authenticated
  using (
    (visibility = 'public' and not is_archived)
    or public.is_event_member(id)
    or public.is_system_admin()
  );

create policy events_insert on public.events for insert to authenticated
  with check (public.is_system_admin() and created_by = auth.uid());

create policy events_update on public.events for update to authenticated
  using (public.is_event_admin(id))
  with check (public.is_event_admin(id));

create policy events_delete on public.events for delete to authenticated
  using (public.is_system_admin());

revoke select, insert, update on public.events from authenticated;
grant select (id, name, description, starts_at, ends_at, visibility, settings,
              is_archived, created_by, created_at, updated_at)
  on public.events to authenticated;
grant insert (id, name, description, starts_at, ends_at, visibility, settings, created_by)
  on public.events to authenticated;
grant update (name, description, starts_at, ends_at, visibility, settings, is_archived)
  on public.events to authenticated;

-- ---------------------------------------------------------------------------
-- event_members (writes only via grant/revoke RPCs)
-- ---------------------------------------------------------------------------

alter table public.event_members enable row level security;

create policy event_members_select on public.event_members for select to authenticated
  using (user_id = auth.uid() or public.is_event_member(event_id) or public.is_system_admin());

-- ---------------------------------------------------------------------------
-- participation_requests (insert via request_participation, decisions via RPC;
-- requester may withdraw a pending request)
-- ---------------------------------------------------------------------------

alter table public.participation_requests enable row level security;

create policy participation_requests_select on public.participation_requests for select to authenticated
  using (user_id = auth.uid() or public.is_event_admin(event_id));

create policy participation_requests_cancel on public.participation_requests for update to authenticated
  using (user_id = auth.uid() and status = 'pending')
  with check (user_id = auth.uid() and status = 'cancelled');

revoke update on public.participation_requests from authenticated;
grant update (status) on public.participation_requests to authenticated;

-- ---------------------------------------------------------------------------
-- geo_zones (admins manage, members view)
-- ---------------------------------------------------------------------------

alter table public.geo_zones enable row level security;

create policy geo_zones_select on public.geo_zones for select to authenticated
  using (public.is_event_member(event_id) or public.is_system_admin());

create policy geo_zones_insert on public.geo_zones for insert to authenticated
  with check (public.is_event_admin(event_id) and created_by = auth.uid());

create policy geo_zones_update on public.geo_zones for update to authenticated
  using (public.is_event_admin(event_id))
  with check (public.is_event_admin(event_id));

create policy geo_zones_delete on public.geo_zones for delete to authenticated
  using (public.is_event_admin(event_id));

-- ---------------------------------------------------------------------------
-- tasks (lifecycle via start_task/transition_task)
-- ---------------------------------------------------------------------------

alter table public.tasks enable row level security;

create policy tasks_select on public.tasks for select to authenticated
  using (pilot_id = auth.uid() or public.is_event_member(event_id) or public.is_system_admin());

-- ---------------------------------------------------------------------------
-- retriever_profiles (vehicle fields self-editable; rest via RPC/triggers)
-- ---------------------------------------------------------------------------

alter table public.retriever_profiles enable row level security;

create policy retriever_profiles_select on public.retriever_profiles for select to authenticated
  using (public.is_event_member(event_id) or public.is_system_admin());

create policy retriever_profiles_update on public.retriever_profiles for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

revoke update on public.retriever_profiles from authenticated;
grant update (vehicle_capacity, vehicle_description) on public.retriever_profiles to authenticated;

-- ---------------------------------------------------------------------------
-- retriever_sessions (via duty RPCs)
-- ---------------------------------------------------------------------------

alter table public.retriever_sessions enable row level security;

create policy retriever_sessions_select on public.retriever_sessions for select to authenticated
  using (user_id = auth.uid() or public.is_event_operator(event_id) or public.is_system_admin());

-- ---------------------------------------------------------------------------
-- location_points (ingest via RPC only)
--   * own points: always
--   * operators (observer/event_admin) and system admins: everything in event
--   * retrievers: points of tasks they are assigned to or asked to retrieve
-- ---------------------------------------------------------------------------

alter table public.location_points enable row level security;

create policy location_points_select on public.location_points for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_event_operator(event_id)
    or public.is_system_admin()
    or (task_id is not null and exists (
          select 1 from public.retrieval_assignments a
          where a.task_id = location_points.task_id
            and a.retriever_id = auth.uid()
            and a.status in ('assigned', 'en_route', 'picked_up')
        ))
    or (task_id is not null and exists (
          select 1 from public.retrieval_requests r
          where r.task_id = location_points.task_id
            and r.retriever_id = auth.uid()
            and r.status = 'pending'
        ))
  );

-- ---------------------------------------------------------------------------
-- retrieval workflow (all writes via RPC)
-- ---------------------------------------------------------------------------

alter table public.retrieval_requests enable row level security;

create policy retrieval_requests_select on public.retrieval_requests for select to authenticated
  using (
    pilot_id = auth.uid() or retriever_id = auth.uid()
    or public.is_event_operator(event_id) or public.is_system_admin()
  );

alter table public.retrieval_assignments enable row level security;

create policy retrieval_assignments_select on public.retrieval_assignments for select to authenticated
  using (
    pilot_id = auth.uid() or retriever_id = auth.uid()
    or public.is_event_operator(event_id) or public.is_system_admin()
  );

-- ---------------------------------------------------------------------------
-- emergency_events (raised via RPC; visible to the whole event so nearby
-- members can react)
-- ---------------------------------------------------------------------------

alter table public.emergency_events enable row level security;

create policy emergency_events_select on public.emergency_events for select to authenticated
  using (user_id = auth.uid() or public.is_event_member(event_id) or public.is_system_admin());

-- ---------------------------------------------------------------------------
-- devices / notifications (strictly personal)
-- ---------------------------------------------------------------------------

alter table public.devices enable row level security;

create policy devices_all on public.devices for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

alter table public.notifications enable row level security;

create policy notifications_select on public.notifications for select to authenticated
  using (user_id = auth.uid());

create policy notifications_mark_read on public.notifications for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

-- ---------------------------------------------------------------------------
-- audit_logs (read-only for admins; written by definer functions)
-- ---------------------------------------------------------------------------

alter table public.audit_logs enable row level security;

create policy audit_logs_select on public.audit_logs for select to authenticated
  using (public.is_system_admin() or (event_id is not null and public.is_event_admin(event_id)));

-- ---------------------------------------------------------------------------
-- Realtime: publish operational tables (RLS is enforced per-subscriber by
-- Realtime's WAL filtering). location_points is intentionally published —
-- live maps subscribe filtered by event_id.
-- ---------------------------------------------------------------------------

do $rt$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end
$rt$;

alter publication supabase_realtime add table
  public.tasks,
  public.location_points,
  public.retriever_profiles,
  public.retrieval_requests,
  public.retrieval_assignments,
  public.emergency_events,
  public.participation_requests,
  public.notifications;

-- UPDATE/DELETE change feeds need full old-row images on the small tables.
alter table public.tasks replica identity full;
alter table public.retriever_profiles replica identity full;
alter table public.retrieval_requests replica identity full;
alter table public.retrieval_assignments replica identity full;
alter table public.emergency_events replica identity full;
alter table public.participation_requests replica identity full;

-- ---------------------------------------------------------------------------
-- Housekeeping: expire stale retrieval offers every minute when pg_cron is
-- available (responders also expire lazily, so this is belt-and-braces).
-- ---------------------------------------------------------------------------

do $cron$
begin
  perform 1 from pg_extension where extname = 'pg_cron';
  if found then
    perform cron.schedule('retfast-expire-retrieval-requests', '* * * * *',
                          $$select public.expire_retrieval_requests()$$);
  end if;
exception when others then
  raise notice 'pg_cron not available; skipping schedule';
end
$cron$;

commit;

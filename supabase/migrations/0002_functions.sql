-- RETFAST 0002 — authorization helpers + RPC surface
-- All state transitions with invariants go through SECURITY DEFINER functions
-- so clients can never skip validation, capacity math or audit logging.

begin;

-- ---------------------------------------------------------------------------
-- Authorization helper predicates (used by RLS policies and RPCs)
-- ---------------------------------------------------------------------------

create or replace function public.is_system_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_system_admin from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.has_event_role(p_event uuid, p_role public.event_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.event_members
    where event_id = p_event and user_id = auth.uid() and role = p_role
  );
$$;

create or replace function public.is_event_member(p_event uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.event_members
    where event_id = p_event and user_id = auth.uid()
  );
$$;

create or replace function public.is_event_admin(p_event uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_system_admin() or public.has_event_role(p_event, 'event_admin');
$$;

-- Observers and event admins run operations; both see everything in the event.
create or replace function public.is_event_operator(p_event uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_event_admin(p_event) or public.has_event_role(p_event, 'observer');
$$;

-- Do two users share at least one event? (profile visibility)
create or replace function public.shares_event_with(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.event_members me
    join public.event_members them on them.event_id = me.event_id
    where me.user_id = auth.uid() and them.user_id = p_user
  );
$$;

create or replace function public.log_audit(
  p_event uuid, p_action text, p_entity text, p_entity_id text, p_payload jsonb default '{}'::jsonb
) returns void language sql security definer set search_path = public as $$
  insert into public.audit_logs (actor_id, event_id, action, entity, entity_id, payload)
  values (auth.uid(), p_event, p_action, p_entity, p_entity_id, coalesce(p_payload, '{}'::jsonb));
$$;

-- ---------------------------------------------------------------------------
-- Event discovery & participation
-- ---------------------------------------------------------------------------

-- Look up an event by invitation code (works for private/unlisted events the
-- caller cannot select). Returns a minimal preview; never leaks other codes.
create or replace function public.join_event_by_code(p_code text)
returns table (id uuid, name text, description text, starts_at timestamptz, ends_at timestamptz, visibility public.event_visibility)
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  return query
    select e.id, e.name, e.description, e.starts_at, e.ends_at, e.visibility
    from public.events e
    where e.invite_code = upper(trim(p_code)) and not e.is_archived;
  if not found then
    raise exception 'invalid invitation code' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.request_participation(
  p_event uuid, p_role public.event_role, p_message text default '', p_invite_code text default null
) returns public.participation_requests
language plpgsql security definer set search_path = public as $$
declare
  v_event public.events;
  v_req public.participation_requests;
begin
  select * into v_event from public.events where id = p_event and not is_archived;
  if not found then
    raise exception 'event not found' using errcode = 'P0002';
  end if;
  if p_role = 'event_admin' and not public.is_system_admin() then
    raise exception 'event_admin role cannot be requested' using errcode = '42501';
  end if;
  if v_event.visibility <> 'public'
     and v_event.invite_code <> upper(trim(coalesce(p_invite_code, '')))
     and not public.is_event_member(p_event)
     and not public.is_system_admin() then
    raise exception 'invitation code required' using errcode = '42501';
  end if;
  if public.has_event_role(p_event, p_role) then
    raise exception 'already a member with this role' using errcode = '23505';
  end if;

  insert into public.participation_requests (event_id, user_id, requested_role, message)
  values (p_event, auth.uid(), p_role, coalesce(p_message, ''))
  returning * into v_req;

  perform public.log_audit(p_event, 'participation.requested', 'participation_request', v_req.id::text,
                           jsonb_build_object('role', p_role));
  return v_req;
end;
$$;

create or replace function public.decide_participation(
  p_request uuid, p_approve boolean, p_role_override public.event_role default null
) returns public.participation_requests
language plpgsql security definer set search_path = public as $$
declare
  v_req public.participation_requests;
  v_role public.event_role;
begin
  select * into v_req from public.participation_requests where id = p_request for update;
  if not found then
    raise exception 'request not found' using errcode = 'P0002';
  end if;
  if not public.is_event_admin(v_req.event_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'request already decided' using errcode = 'P0001';
  end if;

  v_role := coalesce(p_role_override, v_req.requested_role);
  update public.participation_requests
     set status = case when p_approve then 'approved' else 'rejected' end::public.request_status,
         decided_by = auth.uid(), decided_at = now()
   where id = p_request
   returning * into v_req;

  if p_approve then
    perform public.grant_event_role(v_req.event_id, v_req.user_id, v_role);
  end if;
  perform public.log_audit(v_req.event_id,
    case when p_approve then 'participation.approved' else 'participation.rejected' end,
    'participation_request', v_req.id::text, jsonb_build_object('role', v_role));
  return v_req;
end;
$$;

-- Direct role grant (also used by approval). Ensures retriever_profiles row.
create or replace function public.grant_event_role(p_event uuid, p_user uuid, p_role public.event_role)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_event_admin(p_event) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  insert into public.event_members (event_id, user_id, role, added_by)
  values (p_event, p_user, p_role, auth.uid())
  on conflict (event_id, user_id, role) do nothing;

  if p_role = 'retriever' then
    insert into public.retriever_profiles (event_id, user_id)
    values (p_event, p_user)
    on conflict do nothing;
  end if;
  perform public.log_audit(p_event, 'role.granted', 'event_member', p_user::text,
                           jsonb_build_object('role', p_role));
end;
$$;

create or replace function public.revoke_event_role(p_event uuid, p_user uuid, p_role public.event_role)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_event_admin(p_event) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  delete from public.event_members
   where event_id = p_event and user_id = p_user and role = p_role;
  perform public.log_audit(p_event, 'role.revoked', 'event_member', p_user::text,
                           jsonb_build_object('role', p_role));
end;
$$;

-- ---------------------------------------------------------------------------
-- Task (flight) lifecycle — pilot only
-- ---------------------------------------------------------------------------

create or replace function public.start_task(p_event uuid, p_title text default '')
returns public.tasks
language plpgsql security definer set search_path = public as $$
declare v_task public.tasks;
begin
  if not public.has_event_role(p_event, 'pilot') then
    raise exception 'pilot role required' using errcode = '42501';
  end if;
  insert into public.tasks (event_id, pilot_id, title)
  values (p_event, auth.uid(), coalesce(nullif(trim(p_title), ''),
          'Flight ' || to_char(now(), 'YYYY-MM-DD HH24:MI')))
  returning * into v_task;
  perform public.log_audit(p_event, 'task.started', 'task', v_task.id::text, '{}'::jsonb);
  return v_task;
exception when unique_violation then
  raise exception 'you already have an open task in this event' using errcode = 'P0001';
end;
$$;

create or replace function public.transition_task(p_task uuid, p_action text, p_reason text default null)
returns public.tasks
language plpgsql security definer set search_path = public as $$
declare v public.tasks;
begin
  select * into v from public.tasks where id = p_task for update;
  if not found then
    raise exception 'task not found' using errcode = 'P0002';
  end if;
  if v.pilot_id <> auth.uid() and not public.is_event_admin(v.event_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if p_action = 'landed' and v.status = 'active' then
    update public.tasks set status = 'landed', landed_at = now() where id = p_task returning * into v;
  elsif p_action = 'finish' and v.status in ('active', 'landed') then
    update public.tasks
       set status = 'completed', landed_at = coalesce(landed_at, now()), finished_at = now()
     where id = p_task returning * into v;
  elsif p_action = 'cancel' and v.status in ('active', 'landed') then
    update public.tasks
       set status = 'cancelled', cancelled_reason = coalesce(p_reason, ''), finished_at = now()
     where id = p_task returning * into v;
    update public.retrieval_requests set status = 'cancelled', responded_at = now()
     where task_id = p_task and status = 'pending';
    update public.retrieval_assignments set status = 'cancelled', cancelled_at = now()
     where task_id = p_task and status in ('assigned', 'en_route');
  else
    raise exception 'invalid transition % from %', p_action, v.status using errcode = 'P0001';
  end if;

  perform public.log_audit(v.event_id, 'task.' || p_action, 'task', v.id::text,
                           jsonb_build_object('reason', p_reason));
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- Location ingestion (idempotent batch upsert)
-- ---------------------------------------------------------------------------

-- points: [{id, task_id | retriever_session_id, recorded_at, lat, lng,
--           altitude_m?, heading_deg?, speed_mps?, h_accuracy_m?,
--           v_accuracy_m?, battery_pct?, tracking_state?}, ...]
create or replace function public.ingest_location_points(p_points jsonb)
returns integer
language plpgsql security definer set search_path = public as $$
declare v_inserted integer;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_points) <> 'array' or jsonb_array_length(p_points) > 500 then
    raise exception 'expected an array of at most 500 points' using errcode = '22023';
  end if;

  with pts as (
    select
      (p ->> 'id')::uuid                                   as id,
      (p ->> 'task_id')::uuid                              as task_id,
      (p ->> 'retriever_session_id')::uuid                 as session_id,
      (p ->> 'recorded_at')::timestamptz                   as recorded_at,
      (p ->> 'lat')::double precision                      as lat,
      (p ->> 'lng')::double precision                      as lng,
      (p ->> 'altitude_m')::double precision               as altitude_m,
      (p ->> 'heading_deg')::double precision              as heading_deg,
      (p ->> 'speed_mps')::double precision                as speed_mps,
      (p ->> 'h_accuracy_m')::double precision             as h_accuracy_m,
      (p ->> 'v_accuracy_m')::double precision             as v_accuracy_m,
      (p ->> 'battery_pct')::smallint                      as battery_pct,
      coalesce(p ->> 'tracking_state', 'foreground')::public.tracking_state as tracking_state
    from jsonb_array_elements(p_points) p
  ),
  authorized as (
    -- A point is accepted only when it references a task or duty session the
    -- caller owns; anything else in the batch is silently dropped.
    select pts.*, coalesce(t.event_id, s.event_id) as event_id
    from pts
    left join public.tasks t
      on t.id = pts.task_id and t.pilot_id = auth.uid() and t.status in ('active', 'landed')
    left join public.retriever_sessions s
      on s.id = pts.session_id and s.user_id = auth.uid() and s.ended_at is null
    where num_nonnulls(t.id, s.id) = 1
      and pts.lat between -90 and 90 and pts.lng between -180 and 180
  ),
  ins as (
    insert into public.location_points
      (id, event_id, user_id, task_id, retriever_session_id, recorded_at, geom,
       altitude_m, heading_deg, speed_mps, h_accuracy_m, v_accuracy_m, battery_pct, tracking_state)
    select id, event_id, auth.uid(),
           case when task_id is not null then task_id end,
           case when task_id is null then session_id end,
           recorded_at,
           st_setsrid(st_makepoint(lng, lat), 4326)::geography,
           altitude_m, heading_deg, speed_mps, h_accuracy_m, v_accuracy_m, battery_pct, tracking_state
    from authorized
    on conflict (id) do nothing
    returning 1
  )
  select count(*) into v_inserted from ins;
  return v_inserted;
end;
$$;

-- ---------------------------------------------------------------------------
-- Retriever duty & dispatch
-- ---------------------------------------------------------------------------

create or replace function public.start_retriever_duty(p_event uuid)
returns public.retriever_sessions
language plpgsql security definer set search_path = public as $$
declare v public.retriever_sessions;
begin
  if not public.has_event_role(p_event, 'retriever') then
    raise exception 'retriever role required' using errcode = '42501';
  end if;
  select * into v from public.retriever_sessions
   where event_id = p_event and user_id = auth.uid() and ended_at is null;
  if not found then
    insert into public.retriever_sessions (event_id, user_id)
    values (p_event, auth.uid()) returning * into v;
  end if;
  update public.retriever_profiles
     set availability = (case when occupied_seats >= vehicle_capacity then 'busy' else 'available' end)::public.retriever_availability,
         updated_at = now()
   where event_id = p_event and user_id = auth.uid();
  perform public.log_audit(p_event, 'retriever.duty_started', 'retriever_session', v.id::text, '{}'::jsonb);
  return v;
end;
$$;

create or replace function public.end_retriever_duty(p_event uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.retriever_sessions set ended_at = now()
   where event_id = p_event and user_id = auth.uid() and ended_at is null;
  update public.retriever_profiles set availability = 'offline', updated_at = now()
   where event_id = p_event and user_id = auth.uid();
  perform public.log_audit(p_event, 'retriever.duty_ended', 'retriever_session', null, '{}'::jsonb);
end;
$$;

create or replace function public.update_retriever_vehicle(
  p_event uuid, p_capacity integer, p_description text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_event_role(p_event, 'retriever') then
    raise exception 'retriever role required' using errcode = '42501';
  end if;
  update public.retriever_profiles
     set vehicle_capacity = coalesce(p_capacity, vehicle_capacity),
         vehicle_description = coalesce(p_description, vehicle_description),
         updated_at = now()
   where event_id = p_event and user_id = auth.uid();
end;
$$;

-- Nearest available retrievers for a pilot (or operator) to choose from.
create or replace function public.nearby_retrievers(p_event uuid, p_lat double precision, p_lng double precision, p_limit integer default 5)
returns table (
  user_id uuid, display_name text, availability public.retriever_availability,
  vehicle_capacity integer, occupied_seats integer, vehicle_description text,
  distance_m double precision, last_seen_at timestamptz, lat double precision, lng double precision
)
language sql stable security definer set search_path = public as $$
  select rp.user_id, pr.display_name, rp.availability, rp.vehicle_capacity,
         rp.occupied_seats, rp.vehicle_description,
         st_distance(rp.last_geom, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography) as distance_m,
         rp.last_seen_at,
         st_y(rp.last_geom::geometry) as lat, st_x(rp.last_geom::geometry) as lng
  from public.retriever_profiles rp
  join public.profiles pr on pr.id = rp.user_id
  where rp.event_id = p_event
    and (public.is_event_member(p_event) or public.is_system_admin())
    and rp.availability = 'available'
    and rp.last_geom is not null
    and rp.occupied_seats < rp.vehicle_capacity
  order by rp.last_geom <-> st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography
  limit least(greatest(coalesce(p_limit, 5), 1), 20);
$$;

create or replace function public.request_retrieval(p_task uuid, p_retriever uuid)
returns public.retrieval_requests
language plpgsql security definer set search_path = public as $$
declare
  v_task public.tasks;
  v_req public.retrieval_requests;
begin
  select * into v_task from public.tasks where id = p_task for update;
  if not found or v_task.pilot_id <> auth.uid() then
    raise exception 'not your task' using errcode = '42501';
  end if;
  if v_task.status not in ('active', 'landed') then
    raise exception 'task is closed' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.event_members
                 where event_id = v_task.event_id and user_id = p_retriever and role = 'retriever') then
    raise exception 'target is not a retriever in this event' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.retrieval_assignments
             where task_id = p_task and status in ('assigned', 'en_route', 'picked_up')) then
    raise exception 'task already has an active assignment' using errcode = 'P0001';
  end if;
  -- Lazily expire a stale pending request so the partial unique index frees up.
  update public.retrieval_requests set status = 'expired', responded_at = now()
   where task_id = p_task and status = 'pending' and expires_at <= now();

  insert into public.retrieval_requests (event_id, task_id, pilot_id, retriever_id)
  values (v_task.event_id, p_task, auth.uid(), p_retriever)
  returning * into v_req;
  perform public.log_audit(v_task.event_id, 'retrieval.requested', 'retrieval_request', v_req.id::text,
                           jsonb_build_object('retriever_id', p_retriever));
  return v_req;
exception when unique_violation then
  raise exception 'a request is already pending for this task' using errcode = 'P0001';
end;
$$;

create or replace function public.cancel_retrieval_request(p_request uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v public.retrieval_requests;
begin
  select * into v from public.retrieval_requests where id = p_request for update;
  if not found or (v.pilot_id <> auth.uid() and not public.is_event_operator(v.event_id)) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v.status = 'pending' then
    update public.retrieval_requests set status = 'cancelled', responded_at = now() where id = p_request;
    perform public.log_audit(v.event_id, 'retrieval.request_cancelled', 'retrieval_request', v.id::text, '{}'::jsonb);
  end if;
end;
$$;

create or replace function public.respond_retrieval(p_request uuid, p_accept boolean)
returns public.retrieval_requests
language plpgsql security definer set search_path = public as $$
declare
  v public.retrieval_requests;
begin
  select * into v from public.retrieval_requests where id = p_request for update;
  if not found or v.retriever_id <> auth.uid() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v.status <> 'pending' then
    raise exception 'request is no longer pending' using errcode = 'P0001';
  end if;
  if v.expires_at <= now() then
    update public.retrieval_requests set status = 'expired', responded_at = now()
     where id = p_request returning * into v;
    return v;
  end if;

  update public.retrieval_requests
     set status = case when p_accept then 'accepted' else 'declined' end::public.retrieval_request_status,
         responded_at = now()
   where id = p_request returning * into v;

  if p_accept then
    insert into public.retrieval_assignments (event_id, task_id, pilot_id, retriever_id, request_id)
    values (v.event_id, v.task_id, v.pilot_id, v.retriever_id, v.id);
  end if;
  perform public.log_audit(v.event_id,
    case when p_accept then 'retrieval.accepted' else 'retrieval.declined' end,
    'retrieval_request', v.id::text, '{}'::jsonb);
  return v;
end;
$$;

-- Observer/admin manual dispatch from the ops dashboard.
create or replace function public.create_assignment(p_task uuid, p_retriever uuid)
returns public.retrieval_assignments
language plpgsql security definer set search_path = public as $$
declare
  v_task public.tasks;
  v public.retrieval_assignments;
begin
  select * into v_task from public.tasks where id = p_task for update;
  if not found then
    raise exception 'task not found' using errcode = 'P0002';
  end if;
  if not public.is_event_operator(v_task.event_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_task.status not in ('active', 'landed') then
    raise exception 'task is closed' using errcode = 'P0001';
  end if;
  update public.retrieval_requests set status = 'cancelled', responded_at = now()
   where task_id = p_task and status = 'pending';

  insert into public.retrieval_assignments (event_id, task_id, pilot_id, retriever_id, assigned_by)
  values (v_task.event_id, p_task, v_task.pilot_id, p_retriever, auth.uid())
  returning * into v;
  perform public.log_audit(v.event_id, 'retrieval.dispatched', 'retrieval_assignment', v.id::text,
                           jsonb_build_object('retriever_id', p_retriever));
  return v;
exception when unique_violation then
  raise exception 'task already has an active assignment' using errcode = 'P0001';
end;
$$;

create or replace function public.advance_assignment(p_assignment uuid, p_action text)
returns public.retrieval_assignments
language plpgsql security definer set search_path = public as $$
declare v public.retrieval_assignments;
begin
  select * into v from public.retrieval_assignments where id = p_assignment for update;
  if not found then
    raise exception 'assignment not found' using errcode = 'P0002';
  end if;
  if v.retriever_id <> auth.uid() and not public.is_event_operator(v.event_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if p_action = 'en_route' and v.status = 'assigned' then
    update public.retrieval_assignments set status = 'en_route', en_route_at = now()
     where id = p_assignment returning * into v;
  elsif p_action = 'picked_up' and v.status in ('assigned', 'en_route') then
    update public.retrieval_assignments
       set status = 'picked_up', en_route_at = coalesce(en_route_at, now()), picked_up_at = now()
     where id = p_assignment returning * into v;
  elsif p_action = 'delivered' and v.status = 'picked_up' then
    update public.retrieval_assignments set status = 'delivered', delivered_at = now()
     where id = p_assignment returning * into v;
  elsif p_action = 'completed' and v.status = 'delivered' then
    update public.retrieval_assignments set status = 'completed', completed_at = now()
     where id = p_assignment returning * into v;
    -- Closing the retrieval closes a landed task.
    update public.tasks set status = 'completed', finished_at = coalesce(finished_at, now())
     where id = v.task_id and status = 'landed';
  elsif p_action = 'cancel' and v.status in ('assigned', 'en_route', 'picked_up') then
    update public.retrieval_assignments set status = 'cancelled', cancelled_at = now()
     where id = p_assignment returning * into v;
  else
    raise exception 'invalid transition % from %', p_action, v.status using errcode = 'P0001';
  end if;

  perform public.log_audit(v.event_id, 'retrieval.' || p_action, 'retrieval_assignment', v.id::text, '{}'::jsonb);
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- Emergencies
-- ---------------------------------------------------------------------------

create or replace function public.raise_emergency(
  p_event uuid, p_task uuid default null,
  p_lat double precision default null, p_lng double precision default null,
  p_message text default ''
) returns public.emergency_events
language plpgsql security definer set search_path = public as $$
declare v public.emergency_events;
begin
  if not public.is_event_member(p_event) then
    raise exception 'not a member of this event' using errcode = '42501';
  end if;
  insert into public.emergency_events (event_id, user_id, task_id, geom, message)
  values (
    p_event, auth.uid(), p_task,
    case when p_lat is not null and p_lng is not null
         then st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography end,
    coalesce(p_message, '')
  ) returning * into v;
  perform public.log_audit(p_event, 'emergency.raised', 'emergency_event', v.id::text,
                           jsonb_build_object('task_id', p_task));
  return v;
end;
$$;

create or replace function public.update_emergency(p_emergency uuid, p_action text)
returns public.emergency_events
language plpgsql security definer set search_path = public as $$
declare v public.emergency_events;
begin
  select * into v from public.emergency_events where id = p_emergency for update;
  if not found then
    raise exception 'emergency not found' using errcode = 'P0002';
  end if;
  if not public.is_event_operator(v.event_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_action = 'acknowledge' and v.status = 'open' then
    update public.emergency_events
       set status = 'acknowledged', acknowledged_by = auth.uid(), acknowledged_at = now()
     where id = p_emergency returning * into v;
  elsif p_action = 'resolve' and v.status in ('open', 'acknowledged') then
    update public.emergency_events
       set status = 'resolved', resolved_by = auth.uid(), resolved_at = now(),
           acknowledged_by = coalesce(acknowledged_by, auth.uid()),
           acknowledged_at = coalesce(acknowledged_at, now())
     where id = p_emergency returning * into v;
  else
    raise exception 'invalid transition % from %', p_action, v.status using errcode = 'P0001';
  end if;
  perform public.log_audit(v.event_id, 'emergency.' || p_action, 'emergency_event', v.id::text, '{}'::jsonb);
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- Devices
-- ---------------------------------------------------------------------------

create or replace function public.register_device(
  p_push_token text, p_model text default '', p_app_version text default '', p_locale text default 'en'
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  insert into public.devices (user_id, push_token, model, app_version, locale)
  values (auth.uid(), p_push_token, coalesce(p_model, ''), coalesce(p_app_version, ''), coalesce(p_locale, 'en'))
  on conflict (user_id, push_token) do update
    set model = excluded.model, app_version = excluded.app_version,
        locale = excluded.locale, last_seen_at = now();
end;
$$;

-- ---------------------------------------------------------------------------
-- Track replay: raw points + simplified line + summary stats in one call
-- ---------------------------------------------------------------------------

create or replace function public.task_track(p_task uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_task public.tasks;
  v jsonb;
begin
  select * into v_task from public.tasks where id = p_task;
  if not found then
    raise exception 'task not found' using errcode = 'P0002';
  end if;
  if v_task.pilot_id <> auth.uid()
     and not public.is_event_member(v_task.event_id)
     and not public.is_system_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  with pts as (
    select * from public.location_points
    where task_id = p_task
    order by recorded_at
  ),
  line as (
    select st_makeline(geom::geometry order by recorded_at) as g from pts
  )
  select jsonb_build_object(
    'task', to_jsonb(v_task),
    'points', coalesce((select jsonb_agg(jsonb_build_object(
        'recorded_at', p.recorded_at,
        'lat', st_y(p.geom::geometry), 'lng', st_x(p.geom::geometry),
        'altitude_m', p.altitude_m, 'speed_mps', p.speed_mps,
        'heading_deg', p.heading_deg, 'battery_pct', p.battery_pct
      ) order by p.recorded_at) from pts p), '[]'::jsonb),
    'simplified', (select case when g is null or st_npoints(g) < 2 then null
                          else st_asgeojson(st_simplify(g, 0.0001))::jsonb end from line),
    'stats', (select jsonb_build_object(
        'point_count', count(*),
        'distance_m', coalesce((select st_length(g::geography) from line), 0),
        'max_altitude_m', max(p.altitude_m),
        'max_speed_mps', max(p.speed_mps),
        'first_at', min(p.recorded_at),
        'last_at', max(p.recorded_at)
      ) from pts p)
  ) into v;
  return v;
end;
$$;

-- Sweep stale pending retrieval requests (call from pg_cron or opportunistically).
create or replace function public.expire_retrieval_requests()
returns integer language sql security definer set search_path = public as $$
  with upd as (
    update public.retrieval_requests
       set status = 'expired', responded_at = now()
     where status = 'pending' and expires_at <= now()
     returning 1
  )
  select count(*)::integer from upd;
$$;

-- Event admins may read/rotate the invitation code only through this RPC —
-- the column itself is not selectable (see 0003 column grants).
create or replace function public.event_invite_code(p_event uuid, p_rotate boolean default false)
returns text
language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if not public.is_event_admin(p_event) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_rotate then
    update public.events set invite_code = upper(encode(gen_random_bytes(5), 'hex'))
     where id = p_event returning invite_code into v_code;
    perform public.log_audit(p_event, 'event.invite_code_rotated', 'event', p_event::text, '{}'::jsonb);
  else
    select invite_code into v_code from public.events where id = p_event;
  end if;
  return v_code;
end;
$$;

-- Lock down execution: the RPC surface is callable by authenticated users
-- only (helper predicates included, since RLS policies evaluate them as the
-- calling role). PostGIS & friends keep their default grants.
do $lockdown$
declare fn text;
begin
  foreach fn in array array[
    'public.is_system_admin()',
    'public.is_event_member(uuid)',
    'public.is_event_admin(uuid)',
    'public.is_event_operator(uuid)',
    'public.has_event_role(uuid, public.event_role)',
    'public.shares_event_with(uuid)',
    'public.join_event_by_code(text)',
    'public.request_participation(uuid, public.event_role, text, text)',
    'public.decide_participation(uuid, boolean, public.event_role)',
    'public.grant_event_role(uuid, uuid, public.event_role)',
    'public.revoke_event_role(uuid, uuid, public.event_role)',
    'public.start_task(uuid, text)',
    'public.transition_task(uuid, text, text)',
    'public.ingest_location_points(jsonb)',
    'public.start_retriever_duty(uuid)',
    'public.end_retriever_duty(uuid)',
    'public.update_retriever_vehicle(uuid, integer, text)',
    'public.nearby_retrievers(uuid, double precision, double precision, integer)',
    'public.request_retrieval(uuid, uuid)',
    'public.cancel_retrieval_request(uuid)',
    'public.respond_retrieval(uuid, boolean)',
    'public.create_assignment(uuid, uuid)',
    'public.advance_assignment(uuid, text)',
    'public.raise_emergency(uuid, uuid, double precision, double precision, text)',
    'public.update_emergency(uuid, text)',
    'public.register_device(text, text, text, text)',
    'public.task_track(uuid)',
    'public.expire_retrieval_requests()',
    'public.event_invite_code(uuid, boolean)'
  ]
  loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
  -- log_audit is internal: SECURITY DEFINER callers run as the owner, so no
  -- client role ever needs (or gets) execute on it.
  execute 'revoke execute on function public.log_audit(uuid, text, text, text, jsonb) from public, anon, authenticated';
end
$lockdown$;

commit;

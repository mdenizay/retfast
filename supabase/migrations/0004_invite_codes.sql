-- RETFAST 0004 — move invitation codes into a dedicated locked-down table.
--
-- Column-level grants on events.invite_code broke `select *` for clients
-- (PostgREST expands * to all columns). A separate table with RLS enabled and
-- ZERO policies is cleaner: no client role can ever read codes; all access
-- goes through the SECURITY DEFINER RPCs.

begin;

create table public.event_invite_codes (
  event_id   uuid primary key references public.events (id) on delete cascade,
  code       text not null unique,
  updated_at timestamptz not null default now()
);

alter table public.event_invite_codes enable row level security;
revoke all on public.event_invite_codes from anon, authenticated;

-- migrate existing codes
insert into public.event_invite_codes (event_id, code)
select id, invite_code from public.events
on conflict (event_id) do nothing;

-- every new event gets a code automatically
create or replace function public.handle_new_event()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.event_invite_codes (event_id, code)
  values (new.id, upper(encode(gen_random_bytes(5), 'hex')))
  on conflict (event_id) do nothing;
  return new;
end;
$$;

create trigger events_create_invite_code
  after insert on public.events
  for each row execute function public.handle_new_event();

-- rewire the RPCs that used events.invite_code
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
    join public.event_invite_codes c on c.event_id = e.id
    where c.code = upper(trim(p_code)) and not e.is_archived;
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
  v_code text;
  v_req public.participation_requests;
begin
  select * into v_event from public.events where id = p_event and not is_archived;
  if not found then
    raise exception 'event not found' using errcode = 'P0002';
  end if;
  if p_role = 'event_admin' and not public.is_system_admin() then
    raise exception 'event_admin role cannot be requested' using errcode = '42501';
  end if;
  select code into v_code from public.event_invite_codes where event_id = p_event;
  if v_event.visibility <> 'public'
     and (v_code is null or v_code <> upper(trim(coalesce(p_invite_code, ''))))
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

create or replace function public.event_invite_code(p_event uuid, p_rotate boolean default false)
returns text
language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if not public.is_event_admin(p_event) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_rotate then
    update public.event_invite_codes
       set code = upper(encode(gen_random_bytes(5), 'hex')), updated_at = now()
     where event_id = p_event
     returning code into v_code;
    perform public.log_audit(p_event, 'event.invite_code_rotated', 'event', p_event::text, '{}'::jsonb);
  else
    select code into v_code from public.event_invite_codes where event_id = p_event;
  end if;
  return v_code;
end;
$$;

-- drop the old column and restore plain table grants for events
alter table public.events drop column invite_code;

grant select on public.events to authenticated;
grant insert (id, name, description, starts_at, ends_at, visibility, settings, created_by)
  on public.events to authenticated;
grant update (name, description, starts_at, ends_at, visibility, settings, is_archived)
  on public.events to authenticated;

notify pgrst, 'reload schema';

commit;

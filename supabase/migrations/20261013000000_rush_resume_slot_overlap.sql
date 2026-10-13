-- PNM resumes (private `rush` bucket) and overlapping-timeslot protection.

-- ---------------------------------------------------------------------------
-- Resumes: the PNM's latest upload, plus the one attached to each application
-- ---------------------------------------------------------------------------

alter table public.pnms add column if not exists resume_path text;
alter table public.rush_applications add column if not exists resume_path text;

-- ---------------------------------------------------------------------------
-- rush_book_slot: a person can't hold two timeslots that overlap in time,
-- in the same event (actives in multi-slot mode) or across events.
-- Back-to-back slots (one ends exactly when the next starts) are fine; a slot
-- without an end time is treated as an instant at its start.
-- ---------------------------------------------------------------------------

create or replace function public.rush_book_slot(
  p_slot_id uuid,
  p_pnm_id uuid default null,
  p_user_id uuid default null,
  p_admin boolean default false
) returns uuid language plpgsql set search_path = '' as $$
declare
  s public.rush_event_slots%rowtype;
  e public.rush_events%rowtype;
  existing public.rush_slot_signups%rowtype;
  existing_slot public.rush_event_slots%rowtype;
  taken integer;
  result_id uuid;
begin
  if (p_pnm_id is null) = (p_user_id is null) then
    raise exception 'INVALID_SIGNUP';
  end if;

  select * into s from public.rush_event_slots where id = p_slot_id for update;
  if not found then raise exception 'SLOT_NOT_FOUND'; end if;

  select * into e from public.rush_events where id = s.event_id;
  if not e.has_timeslots then raise exception 'NO_TIMESLOTS'; end if;

  if not p_admin and s.starts_at <= now() then
    raise exception 'SLOT_STARTED';
  end if;

  -- Serialize per person so the one-slot and no-overlap rules hold under
  -- races, including bookings in different events.
  perform pg_advisory_xact_lock(
    hashtextextended('rush_book_slot:' || coalesce(p_pnm_id, p_user_id)::text, 0)
  );

  if p_pnm_id is not null then
    select * into existing from public.rush_slot_signups
     where event_id = e.id and pnm_id = p_pnm_id;
  elsif not e.actives_multi_slot then
    select * into existing from public.rush_slot_signups
     where event_id = e.id and user_id = p_user_id
     order by created_at limit 1;
  else
    select * into existing from public.rush_slot_signups
     where slot_id = p_slot_id and user_id = p_user_id;
  end if;

  if existing.id is not null and existing.slot_id = p_slot_id then
    return existing.id;
  end if;

  -- Moving an existing booking counts as a change.
  if existing.id is not null and not p_admin then
    if e.self_change_mode = 'admin_only' then
      raise exception 'CHANGES_LOCKED';
    end if;
    select * into existing_slot from public.rush_event_slots where id = existing.slot_id;
    if now() > existing_slot.starts_at - make_interval(mins => e.change_cutoff_minutes) then
      raise exception 'PAST_CUTOFF';
    end if;
  end if;

  -- No overlapping signups. The booking being moved doesn't count, nor (for
  -- single-slot actives) the extras in this event that are dropped below.
  if exists (
    select 1
      from public.rush_slot_signups other
      join public.rush_event_slots os on os.id = other.slot_id
     where (other.pnm_id = p_pnm_id or other.user_id = p_user_id)
       and other.id is distinct from existing.id
       and not (p_user_id is not null and not e.actives_multi_slot and other.event_id = e.id)
       and (
         os.starts_at = s.starts_at
         or (os.starts_at < coalesce(s.ends_at, s.starts_at)
             and s.starts_at < coalesce(os.ends_at, os.starts_at))
       )
  ) then
    raise exception 'SLOT_OVERLAP';
  end if;

  if not p_admin then
    if p_pnm_id is not null then
      select count(*) into taken from public.rush_slot_signups
       where slot_id = p_slot_id and pnm_id is not null;
      if taken >= s.pnm_capacity then raise exception 'SLOT_FULL'; end if;
    else
      select count(*) into taken from public.rush_slot_signups
       where slot_id = p_slot_id and user_id is not null;
      if taken >= s.active_capacity then raise exception 'SLOT_FULL'; end if;
    end if;
  end if;

  if existing.id is not null then
    update public.rush_slot_signups
       set slot_id = p_slot_id, created_at = now()
     where id = existing.id
    returning id into result_id;
    -- An active switching to single-slot mode may hold extras; drop them.
    if p_user_id is not null and not e.actives_multi_slot then
      delete from public.rush_slot_signups
       where event_id = e.id and user_id = p_user_id and id <> existing.id;
    end if;
  else
    insert into public.rush_slot_signups (event_id, slot_id, pnm_id, user_id)
    values (e.id, p_slot_id, p_pnm_id, p_user_id)
    returning id into result_id;
  end if;

  return result_id;
end
$$;
revoke all on function public.rush_book_slot(uuid, uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.rush_book_slot(uuid, uuid, uuid, boolean) to service_role;

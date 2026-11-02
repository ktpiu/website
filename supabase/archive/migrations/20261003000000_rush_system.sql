-- Applied to project ulensjpqjptqvghjtggv on 2026-10-03 as "rush_system". Kept here for reference/local dev.
--
-- End-to-end rush tooling: rush cycles (term + year + open/closed), PNM
-- records and accounts, events with QR check-in and timeslots, evaluation and
-- application forms, and live deliberation sessions with private voting.
--
-- Every table is read and written by the API with the secret key. RLS is
-- enabled everywhere; the only authenticated SELECT policies are the ones the
-- deliberation realtime subscriptions need. delib_ballots has no policies at
-- all and is never published to realtime, so individual votes stay private.

-- ---------------------------------------------------------------------------
-- Cycles
-- ---------------------------------------------------------------------------

create table if not exists public.rush_cycles (
  id uuid primary key default gen_random_uuid(),
  term text not null check (term in ('fall', 'spring')),
  year integer not null check (year between 2000 and 2100),
  kind text not null check (kind in ('open', 'closed')),
  label text generated always as (
    initcap(term) || ' ' || year::text || ' · ' || initcap(kind) || ' Rush'
  ) stored,
  starts_on date,
  ends_on date,
  is_active boolean not null default false,
  applications_open boolean not null default false,
  application_template_id uuid,
  created_at timestamptz not null default now(),
  unique (term, year, kind)
);

-- Only one cycle is "current" at a time.
create unique index if not exists rush_cycles_single_active
  on public.rush_cycles (is_active) where is_active;

-- ---------------------------------------------------------------------------
-- PNMs
-- ---------------------------------------------------------------------------

create table if not exists public.pnms (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(btrim(email))),
  name text not null,
  is_iu_email boolean generated always as (email like '%@iu.edu') stored,
  phone text,
  major text,
  grad_year integer,
  photo_path text,
  status text not null default 'open' check (status in ('open', 'closed', 'pledge', 'former')),
  clerk_user_id text unique,
  linked_user_id uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pnm_cycle_entries (
  id uuid primary key default gen_random_uuid(),
  pnm_id uuid not null references public.pnms (id) on delete cascade,
  cycle_id uuid not null references public.rush_cycles (id) on delete cascade,
  "group" text not null default 'undecided' check ("group" in ('undecided', 'yes', 'no', 'come_back')),
  outcome text check (outcome in ('advanced', 'pledged', 'former')),
  decided_by uuid references public.users (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (pnm_id, cycle_id)
);

create index if not exists pnm_cycle_entries_cycle_idx on public.pnm_cycle_entries (cycle_id);

-- ---------------------------------------------------------------------------
-- Events, timeslots, attendance
-- ---------------------------------------------------------------------------

create table if not exists public.rush_events (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.rush_cycles (id) on delete cascade,
  title text not null,
  description text not null default '',
  starts_at timestamptz not null,
  ends_at timestamptz,
  location_name text not null default '',
  location_url text,
  dress_code text,
  image_path text,
  visibility text not null default 'public' check (visibility in ('public', 'pnm_portal')),
  checkin_token text not null unique default encode(extensions.gen_random_bytes(18), 'hex'),
  checkin_open boolean not null default false,
  has_timeslots boolean not null default false,
  actives_multi_slot boolean not null default false,
  self_change_mode text not null default 'cutoff' check (self_change_mode in ('cutoff', 'admin_only')),
  change_cutoff_minutes integer not null default 0 check (change_cutoff_minutes >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists rush_events_cycle_idx on public.rush_events (cycle_id, starts_at);

create table if not exists public.rush_event_slots (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.rush_events (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz,
  location_name text not null default '',
  location_url text,
  notes text,
  pnm_capacity integer not null default 0 check (pnm_capacity >= 0),
  active_capacity integer not null default 0 check (active_capacity >= 0),
  created_at timestamptz not null default now()
);

create index if not exists rush_event_slots_event_idx on public.rush_event_slots (event_id, starts_at);

create table if not exists public.rush_slot_signups (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.rush_events (id) on delete cascade,
  slot_id uuid not null references public.rush_event_slots (id) on delete cascade,
  pnm_id uuid references public.pnms (id) on delete cascade,
  user_id uuid references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  check ((pnm_id is null) <> (user_id is null))
);

-- One slot per PNM per event; an active never holds the same slot twice.
create unique index if not exists rush_slot_signups_pnm_event
  on public.rush_slot_signups (event_id, pnm_id) where pnm_id is not null;
create unique index if not exists rush_slot_signups_user_slot
  on public.rush_slot_signups (slot_id, user_id) where user_id is not null;
create index if not exists rush_slot_signups_slot_idx on public.rush_slot_signups (slot_id);

create table if not exists public.rush_event_attendance (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.rush_events (id) on delete cascade,
  slot_id uuid references public.rush_event_slots (id) on delete set null,
  pnm_id uuid not null references public.pnms (id) on delete cascade,
  checked_in_at timestamptz not null default now(),
  method text not null default 'self' check (method in ('self', 'manual', 'reconciled')),
  checked_in_by uuid references public.users (id) on delete set null,
  unique (event_id, pnm_id)
);

create index if not exists rush_event_attendance_pnm_idx on public.rush_event_attendance (pnm_id);

create table if not exists public.rush_unmatched_checkins (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.rush_events (id) on delete cascade,
  name text not null,
  email text not null,
  submitted_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'linked', 'dismissed')),
  linked_pnm_id uuid references public.pnms (id) on delete set null,
  resolved_by uuid references public.users (id) on delete set null,
  resolved_at timestamptz
);

create index if not exists rush_unmatched_checkins_pending_idx
  on public.rush_unmatched_checkins (event_id) where status = 'pending';

-- ---------------------------------------------------------------------------
-- Forms and applications
-- ---------------------------------------------------------------------------

create table if not exists public.rush_form_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  kind text not null default 'evaluation' check (kind in ('evaluation', 'application')),
  fields jsonb not null default '[]'::jsonb check (jsonb_typeof(fields) = 'array'),
  hide_author_in_deliberation boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  cycle_id uuid references public.rush_cycles (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'rush_cycles_application_template_fk'
  ) then
    alter table public.rush_cycles
      add constraint rush_cycles_application_template_fk
      foreign key (application_template_id) references public.rush_form_templates (id) on delete set null;
  end if;
end
$$;

create table if not exists public.rush_form_responses (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.rush_form_templates (id) on delete cascade,
  cycle_id uuid not null references public.rush_cycles (id) on delete cascade,
  pnm_id uuid not null references public.pnms (id) on delete cascade,
  author_user_id uuid references public.users (id) on delete set null,
  answers jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists rush_form_responses_pnm_idx on public.rush_form_responses (pnm_id, cycle_id);
create index if not exists rush_form_responses_author_idx on public.rush_form_responses (author_user_id);

create table if not exists public.rush_applications (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.rush_cycles (id) on delete cascade,
  pnm_id uuid not null references public.pnms (id) on delete cascade,
  template_id uuid references public.rush_form_templates (id) on delete set null,
  name text not null,
  email text not null,
  is_iu_email boolean generated always as (lower(email) like '%@iu.edu') stored,
  answers jsonb not null default '{}'::jsonb,
  photo_path text,
  submitted_at timestamptz not null default now(),
  unique (cycle_id, pnm_id)
);

create table if not exists public.rush_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users (id) on delete cascade,
  title text not null default '',
  public_email text,
  public_phone text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Deliberation
-- ---------------------------------------------------------------------------

create table if not exists public.delib_sessions (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.rush_cycles (id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'ended')),
  started_by uuid references public.users (id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  current_pnm_id uuid references public.pnms (id) on delete set null,
  current_round_id uuid
);

create unique index if not exists delib_sessions_single_active
  on public.delib_sessions (status) where status = 'active';

create table if not exists public.delib_participants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.delib_sessions (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  status text not null default 'requested' check (status in ('requested', 'admitted', 'denied', 'removed')),
  requested_at timestamptz not null default now(),
  decided_by uuid references public.users (id) on delete set null,
  decided_at timestamptz,
  unique (session_id, user_id)
);

create table if not exists public.delib_vote_rounds (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.delib_sessions (id) on delete cascade,
  cycle_id uuid not null references public.rush_cycles (id) on delete cascade,
  pnm_id uuid not null references public.pnms (id) on delete cascade,
  status text not null default 'open' check (status in ('open', 'closed')),
  yes_count integer not null default 0,
  no_count integer not null default 0,
  abstain_count integer not null default 0,
  opened_by uuid references public.users (id) on delete set null,
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);

create index if not exists delib_vote_rounds_pnm_idx on public.delib_vote_rounds (pnm_id, cycle_id);
create unique index if not exists delib_vote_rounds_single_open
  on public.delib_vote_rounds (session_id) where status = 'open';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'delib_sessions_current_round_fk'
  ) then
    alter table public.delib_sessions
      add constraint delib_sessions_current_round_fk
      foreign key (current_round_id) references public.delib_vote_rounds (id) on delete set null;
  end if;
end
$$;

-- Individual ballots. No RLS policies, not published to realtime, and deleted
-- when the round closes: only the totals on delib_vote_rounds survive.
create table if not exists public.delib_ballots (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.delib_vote_rounds (id) on delete cascade,
  voter_user_id uuid not null references public.users (id) on delete cascade,
  choice text not null check (choice in ('yes', 'no', 'abstain')),
  updated_at timestamptz not null default now(),
  unique (round_id, voter_user_id)
);

create or replace function public.delib_recount_round()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  target uuid := coalesce(new.round_id, old.round_id);
begin
  -- Ballots of a closed round are purged; keep the saved totals.
  if exists (select 1 from public.delib_vote_rounds r where r.id = target and r.status = 'closed') then
    return null;
  end if;

  update public.delib_vote_rounds r
     set yes_count = c.yes,
         no_count = c.no,
         abstain_count = c.abstain
    from (
      select count(*) filter (where b.choice = 'yes') as yes,
             count(*) filter (where b.choice = 'no') as no,
             count(*) filter (where b.choice = 'abstain') as abstain
        from public.delib_ballots b
       where b.round_id = target
    ) c
   where r.id = target;
  return null;
end
$$;

drop trigger if exists delib_ballots_recount on public.delib_ballots;
create trigger delib_ballots_recount
  after insert or update or delete on public.delib_ballots
  for each row execute function public.delib_recount_round();

-- ---------------------------------------------------------------------------
-- Slot booking (row lock on the slot so concurrent bookings cannot overfill)
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

  -- Serialize per person per event so the one-slot rule holds under races.
  perform pg_advisory_xact_lock(
    hashtextextended(e.id::text || ':' || coalesce(p_pnm_id, p_user_id)::text, 0)
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

create or replace function public.rush_cancel_signup(
  p_signup_id uuid,
  p_admin boolean default false
) returns void language plpgsql set search_path = '' as $$
declare
  su public.rush_slot_signups%rowtype;
  s public.rush_event_slots%rowtype;
  e public.rush_events%rowtype;
begin
  select * into su from public.rush_slot_signups where id = p_signup_id;
  if not found then raise exception 'SIGNUP_NOT_FOUND'; end if;

  if not p_admin then
    select * into s from public.rush_event_slots where id = su.slot_id;
    select * into e from public.rush_events where id = su.event_id;
    if e.self_change_mode = 'admin_only' then
      raise exception 'CHANGES_LOCKED';
    end if;
    if now() > s.starts_at - make_interval(mins => e.change_cutoff_minutes) then
      raise exception 'PAST_CUTOFF';
    end if;
  end if;

  delete from public.rush_slot_signups where id = p_signup_id;
end
$$;

revoke all on function public.rush_book_slot(uuid, uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.rush_cancel_signup(uuid, boolean) from public, anon, authenticated;
grant execute on function public.rush_book_slot(uuid, uuid, uuid, boolean) to service_role;
grant execute on function public.rush_cancel_signup(uuid, boolean) to service_role;
revoke all on function public.delib_recount_round() from public, anon, authenticated;

-- Content-free broadcast so open schedule screens refetch their own
-- role-filtered data. Carries no signup details (PNMs must not see actives).
create or replace function public.rush_broadcast_slots_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  target uuid := coalesce(new.event_id, old.event_id);
begin
  perform realtime.send('{}'::jsonb, 'slots_changed', 'rush-event:' || target::text, false);
  return null;
end
$$;

revoke all on function public.rush_broadcast_slots_changed() from public, anon, authenticated;

drop trigger if exists rush_slot_signups_broadcast on public.rush_slot_signups;
create trigger rush_slot_signups_broadcast
  after insert or update or delete on public.rush_slot_signups
  for each row execute function public.rush_broadcast_slots_changed();

drop trigger if exists rush_event_slots_broadcast on public.rush_event_slots;
create trigger rush_event_slots_broadcast
  after insert or update or delete on public.rush_event_slots
  for each row execute function public.rush_broadcast_slots_changed();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'rush_cycles', 'pnms', 'pnm_cycle_entries', 'rush_events', 'rush_event_slots',
    'rush_slot_signups', 'rush_event_attendance', 'rush_unmatched_checkins',
    'rush_form_templates', 'rush_form_responses', 'rush_applications', 'rush_contacts',
    'delib_sessions', 'delib_participants', 'delib_vote_rounds', 'delib_ballots'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "Disaffiliated members are blocked" on public.%I', t);
    execute format(
      'create policy "Disaffiliated members are blocked" on public.%I as restrictive for all to authenticated using (not (select public.current_user_is_disaffiliated())) with check (not (select public.current_user_is_disaffiliated()))',
      t
    );
  end loop;
end
$$;

-- Realtime reads for deliberation. Everything else goes through the API.
drop policy if exists "Members can see deliberation sessions" on public.delib_sessions;
create policy "Members can see deliberation sessions" on public.delib_sessions
  for select to authenticated
  using ((select public.current_app_user_id()) is not null);

drop policy if exists "Participants see their own row; admins see all" on public.delib_participants;
create policy "Participants see their own row; admins see all" on public.delib_participants
  for select to authenticated
  using (
    user_id = (select public.current_app_user_id())
    or (select public.current_user_has_permission('rush.deliberation.manage'))
  );

drop policy if exists "Admitted participants and admins see vote rounds" on public.delib_vote_rounds;
create policy "Admitted participants and admins see vote rounds" on public.delib_vote_rounds
  for select to authenticated
  using (
    (select public.current_user_has_permission('rush.deliberation.manage'))
    or exists (
      select 1 from public.delib_participants p
       where p.session_id = delib_vote_rounds.session_id
         and p.user_id = (select public.current_app_user_id())
         and p.status = 'admitted'
    )
  );

do $$
declare
  t text;
begin
  foreach t in array array['delib_sessions', 'delib_participants', 'delib_vote_rounds'] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- Storage: private bucket for PNM photos and event images
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('rush', 'rush', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Permissions and roles
-- ---------------------------------------------------------------------------

insert into public.permissions (key, description)
select v.key, v.description
  from (values
    ('rush.view', 'View rush PNMs, attendance, applications and evaluations'),
    ('rush.manage', 'Manage rush cycles, events, forms and PNMs'),
    ('rush.deliberation.manage', 'Run deliberation sessions and see voting history')
  ) as v(key, description)
 where not exists (select 1 from public.permissions p where p.key = v.key);

insert into public.roles (name, description, type, priority, hidden)
select 'Rush Committee', 'Members of the rush committee', 'general',
       coalesce((select max(priority) from public.roles), 0) + 1, false
 where not exists (select 1 from public.roles where name = 'Rush Committee');

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
  from public.roles r
  join public.permissions p on p.key in ('rush.view', 'rush.manage', 'rush.deliberation.manage')
 where r.name in ('President', 'VP of Membership', 'Director of Rush Committee')
   and not exists (
     select 1 from public.role_permissions rp where rp.role_id = r.id and rp.permission_id = p.id
   );

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
  from public.roles r
  join public.permissions p on p.key = 'rush.view'
 where r.name = 'Rush Committee'
   and not exists (
     select 1 from public.role_permissions rp where rp.role_id = r.id and rp.permission_id = p.id
   );

-- ---------------------------------------------------------------------------
-- Default form templates
-- ---------------------------------------------------------------------------

insert into public.rush_form_templates (name, description, kind, fields, hide_author_in_deliberation, sort_order)
select v.name, v.description, v.kind, v.fields::jsonb, v.hide_author, v.sort_order
  from (values
    ('Red Flag', 'Report a concern about a PNM.', 'evaluation',
     '[{"id":"what","label":"What happened?","type":"textarea","required":true},
       {"id":"severity","label":"Severity","type":"select","required":true,"options":["Minor","Moderate","Serious"]},
       {"id":"witnessed","label":"Did you witness this directly?","type":"yesno","required":true}]',
     true, 1),
    ('Standout', 'Highlight a PNM who stood out positively.', 'evaluation',
     '[{"id":"why","label":"What made them stand out?","type":"textarea","required":true},
       {"id":"rating","label":"Overall impression","type":"rating","required":true}]',
     false, 2),
    ('Conflict of Interest', 'Disclose a personal relationship with a PNM.', 'evaluation',
     '[{"id":"relationship","label":"Describe your relationship","type":"textarea","required":true},
       {"id":"recuse","label":"Will you abstain from voting on this PNM?","type":"yesno","required":true}]',
     true, 3),
    ('Dinner Evaluation', 'Evaluate a PNM after a rush dinner.', 'evaluation',
     '[{"id":"engagement","label":"Engagement","type":"rating","required":true},
       {"id":"fit","label":"Culture fit","type":"rating","required":true},
       {"id":"tech","label":"Interest in technology","type":"rating","required":true},
       {"id":"notes","label":"Notes","type":"textarea","required":false}]',
     false, 4),
    ('Interview Evaluation', 'Evaluate a PNM after their interview.', 'evaluation',
     '[{"id":"communication","label":"Communication","type":"rating","required":true},
       {"id":"technical","label":"Technical ability","type":"rating","required":true},
       {"id":"motivation","label":"Motivation for joining","type":"rating","required":true},
       {"id":"recommend","label":"Recommendation","type":"select","required":true,"options":["Strong yes","Yes","Unsure","No"]},
       {"id":"notes","label":"Notes","type":"textarea","required":false}]',
     false, 5),
    ('Application', 'Default rush application.', 'application',
     '[{"id":"major","label":"Major(s)","type":"text","required":true},
       {"id":"grad_year","label":"Expected graduation year","type":"text","required":true},
       {"id":"phone","label":"Phone number","type":"text","required":false},
       {"id":"why_ktp","label":"Why do you want to join Kappa Theta Pi?","type":"textarea","required":true},
       {"id":"project","label":"Tell us about a project or experience you are proud of.","type":"textarea","required":true},
       {"id":"anything_else","label":"Anything else we should know?","type":"textarea","required":false}]',
     false, 0)
  ) as v(name, description, kind, fields, hide_author, sort_order)
 where not exists (
   select 1 from public.rush_form_templates t where t.name = v.name and t.cycle_id is null
 );

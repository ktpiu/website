-- Rush: open/closed forms, multi-submitter forms, event-linked forms and
-- responses, active + PNM attendance statuses, application drafts, and the
-- granular permissions that go with them.

-- ---------------------------------------------------------------------------
-- Form templates: open/closed, submission mode and participant roles
-- ---------------------------------------------------------------------------

alter table public.rush_form_templates
  add column if not exists is_open boolean not null default true,
  add column if not exists submission_mode text not null default 'single'
    check (submission_mode in ('single', 'multiple')),
  -- [{ "id": "interviewers", "label": "Interviewers", "required": true }]
  add column if not exists participant_roles jsonb not null default '[]'::jsonb
    check (jsonb_typeof(participant_roles) = 'array');

-- ---------------------------------------------------------------------------
-- Events: linked form and attendance settings
-- ---------------------------------------------------------------------------

alter table public.rush_events
  add column if not exists form_template_id uuid references public.rush_form_templates (id) on delete set null,
  -- When off, attendance isn't taken but no-shows can still be flagged.
  add column if not exists attendance_enabled boolean not null default true,
  -- When off, actives signed up for the event mark PNMs present/late/no-show.
  add column if not exists qr_checkin_enabled boolean not null default true;

-- ---------------------------------------------------------------------------
-- Responses: event link and everyone who was in the room
-- ---------------------------------------------------------------------------

alter table public.rush_form_responses
  add column if not exists event_id uuid references public.rush_events (id) on delete set null,
  -- [{ "userId": "...", "role": "interviewers" }]
  add column if not exists participants jsonb not null default '[]'::jsonb
    check (jsonb_typeof(participants) = 'array');

create index if not exists rush_form_responses_event_idx on public.rush_form_responses (event_id);

-- ---------------------------------------------------------------------------
-- Attendance: actives as well as PNMs, with a status
-- ---------------------------------------------------------------------------

alter table public.rush_event_attendance alter column pnm_id drop not null;

alter table public.rush_event_attendance
  add column if not exists user_id uuid references public.users (id) on delete cascade,
  add column if not exists status text not null default 'present'
    check (status in ('present', 'late', 'no_show'));

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rush_event_attendance_one_subject') then
    alter table public.rush_event_attendance
      add constraint rush_event_attendance_one_subject check ((pnm_id is null) <> (user_id is null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'rush_event_attendance_event_user_key') then
    alter table public.rush_event_attendance
      add constraint rush_event_attendance_event_user_key unique (event_id, user_id);
  end if;
end
$$;

create index if not exists rush_event_attendance_user_idx on public.rush_event_attendance (user_id);

-- ---------------------------------------------------------------------------
-- In-progress applications (PNMs signed into their account)
-- ---------------------------------------------------------------------------

create table if not exists public.rush_application_drafts (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.rush_cycles (id) on delete cascade,
  pnm_id uuid not null references public.pnms (id) on delete cascade,
  name text not null default '',
  answers jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (cycle_id, pnm_id)
);

alter table public.rush_application_drafts enable row level security;
revoke all on public.rush_application_drafts from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

insert into public.permissions (key, description)
select v.key, v.description
  from (values
    ('rush.forms.manage', 'Open and close rush forms'),
    ('rush.attendance.view_actives', 'View and track active member attendance at rush events')
  ) as v(key, description)
 where not exists (select 1 from public.permissions p where p.key = v.key);

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
  from public.roles r
  join public.permissions p on p.key in ('rush.forms.manage', 'rush.attendance.view_actives')
 where r.name in ('President', 'VP of Membership', 'Director of Rush Committee')
   and not exists (
     select 1 from public.role_permissions rp where rp.role_id = r.id and rp.permission_id = p.id
   );

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
  from public.roles r
  join public.permissions p on p.key = 'rush.attendance.view_actives'
 where r.name = 'VP of Internal Affairs'
   and not exists (
     select 1 from public.role_permissions rp where rp.role_id = r.id and rp.permission_id = p.id
   );

-- ---------------------------------------------------------------------------
-- Default templates: interview evals are multi-submitter; conflicts use the
-- new people selector (PNMs the active has a conflict with).
-- ---------------------------------------------------------------------------

update public.rush_form_templates
   set submission_mode = 'multiple',
       participant_roles = '[{"id":"interviewers","label":"Interviewers","required":true},
                             {"id":"notetakers","label":"Notetakers","required":false},
                             {"id":"others","label":"Other actives in the room","required":false}]'::jsonb
 where name = 'Interview Evaluation' and cycle_id is null and submission_mode = 'single';

update public.rush_form_templates
   set fields = '[{"id":"conflicts","label":"Which PNMs do you have a conflict of interest with?","type":"people","required":true,
                   "people":{"source":"pnms","multiple":true,"conflict":true}},
                  {"id":"relationship","label":"Describe your relationship","type":"textarea","required":false}]'::jsonb,
       hide_author_in_deliberation = false
 where name = 'Conflict of Interest' and cycle_id is null
   and not (fields @> '[{"type":"people"}]'::jsonb);

-- Baseline: builds the whole KTP database on an empty Supabase project.
--
-- Rebuilt on 2026-10-29 from the live schema of ktp-database
-- (ulensjpqjptqvghjtggv), so it replaces every earlier migration; those are
-- kept for history in supabase/archive/migrations/. It is already reflected in
-- prod, so prod records it as applied without running it
-- (`supabase migration repair --status applied 20261029000000`).
--
-- Contents, in dependency order: extensions, tables, constraints, indexes,
-- functions, views, triggers, RLS, policies, grants, realtime, storage
-- buckets, and the seed rows the app needs (permissions, roles and their
-- permissions, global rush form templates). No member data.
--
-- The Elections section at the end is written to be re-runnable (if not
-- exists / create or replace / on conflict) so it can also be applied on its
-- own to a database that already has everything above, such as prod.
--
-- Supabase-provided objects it relies on: auth.jwt(), realtime.send(), the
-- supabase_realtime publication, the storage schema, and the anon,
-- authenticated and service_role roles.

set search_path = public, extensions;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.announcements (
  id uuid default gen_random_uuid() not null,
  title text not null,
  content text not null,
  author_id uuid not null,
  author_name text not null,
  created_at timestamp without time zone default CURRENT_TIMESTAMP,
  updated_at timestamp without time zone default CURRENT_TIMESTAMP,
  hidden boolean default false not null
);

create table if not exists public.customers (
  id uuid default gen_random_uuid() not null,
  created_at timestamp with time zone default now() not null,
  user_id uuid not null,
  stripe_id text not null
);

create table if not exists public.delib_ballots (
  id uuid default gen_random_uuid() not null,
  round_id uuid not null,
  voter_user_id uuid not null,
  choice text not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.delib_participants (
  id uuid default gen_random_uuid() not null,
  session_id uuid not null,
  user_id uuid not null,
  status text default 'requested'::text not null,
  requested_at timestamp with time zone default now() not null,
  decided_by uuid,
  decided_at timestamp with time zone
);

create table if not exists public.delib_sessions (
  id uuid default gen_random_uuid() not null,
  cycle_id uuid not null,
  status text default 'active'::text not null,
  started_by uuid,
  started_at timestamp with time zone default now() not null,
  ended_at timestamp with time zone,
  current_pnm_id uuid,
  current_round_id uuid,
  stage text default 'open'::text not null
);

create table if not exists public.delib_vote_rounds (
  id uuid default gen_random_uuid() not null,
  session_id uuid not null,
  cycle_id uuid not null,
  pnm_id uuid not null,
  status text default 'open'::text not null,
  yes_count integer default 0 not null,
  no_count integer default 0 not null,
  abstain_count integer default 0 not null,
  opened_by uuid,
  opened_at timestamp with time zone default now() not null,
  closed_at timestamp with time zone,
  stage text default 'open'::text not null
);

create table if not exists public.finance_charge_targets (
  id uuid default gen_random_uuid() not null,
  charge_id uuid not null,
  target_type text not null,
  target_id uuid not null,
  mode text not null,
  amount_cents integer,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.finance_charges (
  id uuid default gen_random_uuid() not null,
  title text not null,
  description text,
  due_at timestamp with time zone,
  default_amount_cents integer,
  currency text default 'usd'::text not null,
  created_by_user_id uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.finance_obligations (
  id uuid default gen_random_uuid() not null,
  charge_id uuid not null,
  user_id uuid not null,
  customer_id uuid,
  amount_cents integer not null,
  due_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  exempted_at timestamp with time zone,
  exempted_by_user_id uuid
);

create table if not exists public.finance_payment_allocations (
  id uuid default gen_random_uuid() not null,
  payment_id uuid not null,
  obligation_id uuid not null,
  amount_cents integer not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.finance_payments (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  customer_id uuid,
  source text not null,
  status text not null,
  amount_cents integer not null,
  currency text default 'usd'::text not null,
  stripe_payment_intent_id text,
  payment_method_label text,
  allocation_mode text not null,
  pending_allocations_json jsonb,
  created_by_user_id uuid,
  notes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.permissions (
  id uuid default gen_random_uuid() not null,
  created_at timestamp with time zone default now() not null,
  key text not null,
  description text not null
);

create table if not exists public.pnm_cycle_entries (
  id uuid default gen_random_uuid() not null,
  pnm_id uuid not null,
  cycle_id uuid not null,
  "group" text default 'undecided'::text not null,
  outcome text,
  decided_by uuid,
  decided_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  stage text default 'open'::text not null
);

create table if not exists public.pnms (
  id uuid default gen_random_uuid() not null,
  email text not null,
  name text not null,
  is_iu_email boolean generated always as ((email ~~ '%@iu.edu'::text)) stored,
  phone text,
  major text,
  grad_year integer,
  photo_path text,
  status text default 'open'::text not null,
  clerk_user_id text,
  linked_user_id uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  resume_path text
);

create table if not exists public.role_permissions (
  role_id uuid not null,
  permission_id uuid not null
);

create table if not exists public.roles (
  id uuid default gen_random_uuid() not null,
  created_at timestamp with time zone default now() not null,
  name text not null,
  description text,
  hidden boolean default false not null,
  priority bigint default '0'::bigint not null,
  type text default 'general'::text not null,
  is_initiated boolean default false not null
);

create table if not exists public.rush_application_drafts (
  id uuid default gen_random_uuid() not null,
  cycle_id uuid not null,
  pnm_id uuid not null,
  name text default ''::text not null,
  answers jsonb default '{}'::jsonb not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.rush_applications (
  id uuid default gen_random_uuid() not null,
  cycle_id uuid not null,
  pnm_id uuid not null,
  template_id uuid,
  name text not null,
  email text not null,
  is_iu_email boolean generated always as ((lower(email) ~~ '%@iu.edu'::text)) stored,
  answers jsonb default '{}'::jsonb not null,
  photo_path text,
  submitted_at timestamp with time zone default now() not null,
  resume_path text
);

create table if not exists public.rush_contacts (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  title text default ''::text not null,
  public_email text,
  public_phone text,
  sort_order integer default 0 not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.rush_cycles (
  id uuid default gen_random_uuid() not null,
  term text not null,
  year integer not null,
  starts_on date,
  ends_on date,
  is_active boolean default false not null,
  applications_open boolean default false not null,
  application_template_id uuid,
  created_at timestamp with time zone default now() not null,
  phase text default 'open'::text not null,
  label text generated always as (((initcap(term) || ' '::text) || (year)::text)) stored
);

create table if not exists public.rush_event_attendance (
  id uuid default gen_random_uuid() not null,
  event_id uuid not null,
  slot_id uuid,
  pnm_id uuid,
  checked_in_at timestamp with time zone default now() not null,
  method text default 'self'::text not null,
  checked_in_by uuid,
  user_id uuid,
  status text default 'present'::text not null
);

create table if not exists public.rush_event_slots (
  id uuid default gen_random_uuid() not null,
  event_id uuid not null,
  starts_at timestamp with time zone not null,
  ends_at timestamp with time zone,
  location_name text default ''::text not null,
  location_url text,
  notes text,
  pnm_capacity integer default 0 not null,
  active_capacity integer default 0 not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.rush_events (
  id uuid default gen_random_uuid() not null,
  cycle_id uuid not null,
  title text not null,
  description text default ''::text not null,
  starts_at timestamp with time zone not null,
  ends_at timestamp with time zone,
  location_name text default ''::text not null,
  location_url text,
  dress_code text,
  image_path text,
  visibility text default 'public'::text not null,
  checkin_token text default encode(gen_random_bytes(18), 'hex'::text) not null,
  checkin_open boolean default false not null,
  has_timeslots boolean default false not null,
  actives_multi_slot boolean default false not null,
  self_change_mode text default 'cutoff'::text not null,
  change_cutoff_minutes integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  slot_grid text default 'time_rows'::text not null,
  form_template_id uuid,
  attendance_enabled boolean default true not null,
  qr_checkin_enabled boolean default true not null
);

create table if not exists public.rush_form_responses (
  id uuid default gen_random_uuid() not null,
  template_id uuid not null,
  cycle_id uuid not null,
  pnm_id uuid not null,
  author_user_id uuid,
  answers jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  event_id uuid,
  participants jsonb default '[]'::jsonb not null
);

create table if not exists public.rush_form_templates (
  id uuid default gen_random_uuid() not null,
  name text not null,
  description text default ''::text not null,
  kind text default 'evaluation'::text not null,
  fields jsonb default '[]'::jsonb not null,
  hide_author_in_deliberation boolean default false not null,
  is_active boolean default true not null,
  sort_order integer default 0 not null,
  cycle_id uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  is_open boolean default true not null,
  submission_mode text default 'single'::text not null,
  participant_roles jsonb default '[]'::jsonb not null,
  is_default boolean default false not null
);

create table if not exists public.rush_slot_signups (
  id uuid default gen_random_uuid() not null,
  event_id uuid not null,
  slot_id uuid not null,
  pnm_id uuid,
  user_id uuid,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.rush_unmatched_checkins (
  id uuid default gen_random_uuid() not null,
  event_id uuid not null,
  name text not null,
  email text not null,
  submitted_at timestamp with time zone default now() not null,
  status text default 'pending'::text not null,
  linked_pnm_id uuid,
  resolved_by uuid,
  resolved_at timestamp with time zone
);

create table if not exists public.user_access_reviews (
  clerk_user_id text not null,
  email text,
  name text,
  status text default 'denied'::text not null,
  note text,
  reviewed_by uuid,
  reviewed_at timestamp with time zone default now() not null
);

create table if not exists public.user_roles (
  user_id uuid not null,
  role_id uuid not null
);

create table if not exists public.users (
  id uuid default gen_random_uuid() not null,
  name text not null,
  email text not null,
  role text default 'newmember'::text not null,
  created_at timestamp without time zone default CURRENT_TIMESTAMP,
  avatar text,
  socials jsonb,
  major text,
  title text,
  locked boolean default false not null,
  phone bigint,
  clerk_user_id text,
  graduation_year integer,
  is_inactive boolean default false not null,
  account_status text default 'public'::text not null,
  website_visibility text default 'auto'::text not null,
  is_alumni boolean generated always as ((account_status = 'alumni'::text)) stored,
  is_disaffiliated boolean generated always as ((account_status = ANY (ARRAY['dropped'::text, 'disaffiliated'::text]))) stored,
  is_hidden boolean generated always as ((website_visibility = 'hidden'::text)) stored
);

-- ---------------------------------------------------------------------------
-- Primary keys, unique and check constraints
-- ---------------------------------------------------------------------------

alter table public.announcements add constraint announcements_pkey PRIMARY KEY (id);
alter table public.customers add constraint customers_duplicate_pkey PRIMARY KEY (id);
alter table public.delib_ballots add constraint delib_ballots_pkey PRIMARY KEY (id);
alter table public.delib_participants add constraint delib_participants_pkey PRIMARY KEY (id);
alter table public.delib_sessions add constraint delib_sessions_pkey PRIMARY KEY (id);
alter table public.delib_vote_rounds add constraint delib_vote_rounds_pkey PRIMARY KEY (id);
alter table public.finance_charge_targets add constraint finance_charge_targets_pkey PRIMARY KEY (id);
alter table public.finance_charges add constraint finance_charges_pkey PRIMARY KEY (id);
alter table public.finance_obligations add constraint finance_obligations_pkey PRIMARY KEY (id);
alter table public.finance_payment_allocations add constraint finance_payment_allocations_pkey PRIMARY KEY (id);
alter table public.finance_payments add constraint finance_payments_pkey PRIMARY KEY (id);
alter table public.permissions add constraint permissions_pkey PRIMARY KEY (id);
alter table public.pnm_cycle_entries add constraint pnm_cycle_entries_pkey PRIMARY KEY (id);
alter table public.pnms add constraint pnms_pkey PRIMARY KEY (id);
alter table public.role_permissions add constraint role_permissions_pkey PRIMARY KEY (role_id, permission_id);
alter table public.roles add constraint roles_pkey PRIMARY KEY (id);
alter table public.rush_application_drafts add constraint rush_application_drafts_pkey PRIMARY KEY (id);
alter table public.rush_applications add constraint rush_applications_pkey PRIMARY KEY (id);
alter table public.rush_contacts add constraint rush_contacts_pkey PRIMARY KEY (id);
alter table public.rush_cycles add constraint rush_cycles_pkey PRIMARY KEY (id);
alter table public.rush_event_attendance add constraint rush_event_attendance_pkey PRIMARY KEY (id);
alter table public.rush_event_slots add constraint rush_event_slots_pkey PRIMARY KEY (id);
alter table public.rush_events add constraint rush_events_pkey PRIMARY KEY (id);
alter table public.rush_form_responses add constraint rush_form_responses_pkey PRIMARY KEY (id);
alter table public.rush_form_templates add constraint rush_form_templates_pkey PRIMARY KEY (id);
alter table public.rush_slot_signups add constraint rush_slot_signups_pkey PRIMARY KEY (id);
alter table public.rush_unmatched_checkins add constraint rush_unmatched_checkins_pkey PRIMARY KEY (id);
alter table public.user_access_reviews add constraint user_access_reviews_pkey PRIMARY KEY (clerk_user_id);
alter table public.user_roles add constraint user_roles_pkey PRIMARY KEY (user_id, role_id);
alter table public.users add constraint users_pkey PRIMARY KEY (id);

alter table public.customers add constraint customers_duplicate_stripe_id_key UNIQUE (stripe_id);
alter table public.customers add constraint customers_duplicate_user_id_key UNIQUE (user_id);
alter table public.delib_ballots add constraint delib_ballots_round_id_voter_user_id_key UNIQUE (round_id, voter_user_id);
alter table public.delib_participants add constraint delib_participants_session_id_user_id_key UNIQUE (session_id, user_id);
alter table public.finance_obligations add constraint finance_obligations_unique UNIQUE (charge_id, user_id);
alter table public.finance_payment_allocations add constraint finance_payment_allocations_unique UNIQUE (payment_id, obligation_id);
alter table public.finance_payments add constraint finance_payments_stripe_payment_intent_id_key UNIQUE (stripe_payment_intent_id);
alter table public.permissions add constraint permissions_key_key UNIQUE (key);
alter table public.pnm_cycle_entries add constraint pnm_cycle_entries_pnm_id_cycle_id_key UNIQUE (pnm_id, cycle_id);
alter table public.pnms add constraint pnms_clerk_user_id_key UNIQUE (clerk_user_id);
alter table public.pnms add constraint pnms_email_key UNIQUE (email);
alter table public.rush_application_drafts add constraint rush_application_drafts_cycle_id_pnm_id_key UNIQUE (cycle_id, pnm_id);
alter table public.rush_applications add constraint rush_applications_cycle_id_pnm_id_key UNIQUE (cycle_id, pnm_id);
alter table public.rush_contacts add constraint rush_contacts_user_id_key UNIQUE (user_id);
alter table public.rush_cycles add constraint rush_cycles_term_year_key UNIQUE (term, year);
alter table public.rush_event_attendance add constraint rush_event_attendance_event_id_pnm_id_key UNIQUE (event_id, pnm_id);
alter table public.rush_event_attendance add constraint rush_event_attendance_event_user_key UNIQUE (event_id, user_id);
alter table public.rush_events add constraint rush_events_checkin_token_key UNIQUE (checkin_token);
alter table public.users add constraint users_email_key UNIQUE (email);
alter table public.users add constraint users_phone_key UNIQUE (phone);

alter table public.delib_ballots add constraint delib_ballots_choice_check CHECK ((choice = ANY (ARRAY['yes'::text, 'no'::text, 'abstain'::text])));
alter table public.delib_participants add constraint delib_participants_status_check CHECK ((status = ANY (ARRAY['requested'::text, 'admitted'::text, 'denied'::text, 'removed'::text])));
alter table public.delib_sessions add constraint delib_sessions_stage_check CHECK ((stage = ANY (ARRAY['open'::text, 'closed'::text])));
alter table public.delib_sessions add constraint delib_sessions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'ended'::text])));
alter table public.delib_vote_rounds add constraint delib_vote_rounds_stage_check CHECK ((stage = ANY (ARRAY['open'::text, 'closed'::text])));
alter table public.delib_vote_rounds add constraint delib_vote_rounds_status_check CHECK ((status = ANY (ARRAY['open'::text, 'closed'::text])));
alter table public.finance_charge_targets add constraint finance_charge_targets_amount_cents_check CHECK (((amount_cents IS NULL) OR (amount_cents > 0)));
alter table public.finance_charge_targets add constraint finance_charge_targets_mode_check CHECK ((mode = ANY (ARRAY['include'::text, 'exclude'::text])));
alter table public.finance_charge_targets add constraint finance_charge_targets_target_type_check CHECK ((target_type = ANY (ARRAY['role'::text, 'user'::text])));
alter table public.finance_charges add constraint finance_charges_default_amount_nonnegative CHECK (((default_amount_cents IS NULL) OR (default_amount_cents > 0)));
alter table public.finance_obligations add constraint finance_obligations_amount_positive CHECK ((amount_cents > 0));
alter table public.finance_payment_allocations add constraint finance_payment_allocations_amount_positive CHECK ((amount_cents > 0));
alter table public.finance_payments add constraint finance_payments_allocation_mode_check CHECK ((allocation_mode = ANY (ARRAY['auto_fifo'::text, 'manual_selection'::text])));
alter table public.finance_payments add constraint finance_payments_amount_positive CHECK ((amount_cents > 0));
alter table public.finance_payments add constraint finance_payments_source_check CHECK ((source = ANY (ARRAY['stripe'::text, 'manual'::text])));
alter table public.finance_payments add constraint finance_payments_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'completed'::text, 'failed'::text, 'canceled'::text])));
alter table public.pnm_cycle_entries add constraint pnm_cycle_entries_group_check CHECK (("group" = ANY (ARRAY['undecided'::text, 'yes'::text, 'no'::text, 'come_back'::text])));
alter table public.pnm_cycle_entries add constraint pnm_cycle_entries_outcome_check CHECK ((outcome = ANY (ARRAY['advanced'::text, 'pledged'::text, 'former'::text])));
alter table public.pnm_cycle_entries add constraint pnm_cycle_entries_stage_check CHECK ((stage = ANY (ARRAY['open'::text, 'closed'::text])));
alter table public.pnms add constraint pnms_email_check CHECK ((email = lower(btrim(email))));
alter table public.pnms add constraint pnms_status_check CHECK ((status = ANY (ARRAY['open'::text, 'closed'::text, 'pledge'::text, 'former'::text])));
alter table public.roles add constraint roles_type_check CHECK ((type = ANY (ARRAY['general'::text, 'pledge_class'::text, 'exec'::text, 'director'::text])));
alter table public.rush_cycles add constraint rush_cycles_phase_check CHECK ((phase = ANY (ARRAY['open'::text, 'closed'::text, 'concluded'::text])));
alter table public.rush_cycles add constraint rush_cycles_term_check CHECK ((term = ANY (ARRAY['fall'::text, 'spring'::text])));
alter table public.rush_cycles add constraint rush_cycles_year_check CHECK (((year >= 2000) AND (year <= 2100)));
alter table public.rush_event_attendance add constraint rush_event_attendance_method_check CHECK ((method = ANY (ARRAY['self'::text, 'manual'::text, 'reconciled'::text])));
alter table public.rush_event_attendance add constraint rush_event_attendance_one_subject CHECK (((pnm_id IS NULL) <> (user_id IS NULL)));
alter table public.rush_event_attendance add constraint rush_event_attendance_status_check CHECK ((status = ANY (ARRAY['present'::text, 'late'::text, 'no_show'::text])));
alter table public.rush_event_slots add constraint rush_event_slots_active_capacity_check CHECK ((active_capacity >= 0));
alter table public.rush_event_slots add constraint rush_event_slots_pnm_capacity_check CHECK ((pnm_capacity >= 0));
alter table public.rush_events add constraint rush_events_change_cutoff_minutes_check CHECK ((change_cutoff_minutes >= 0));
alter table public.rush_events add constraint rush_events_self_change_mode_check CHECK ((self_change_mode = ANY (ARRAY['cutoff'::text, 'admin_only'::text])));
alter table public.rush_events add constraint rush_events_slot_grid_check CHECK ((slot_grid = ANY (ARRAY['time_rows'::text, 'location_rows'::text])));
alter table public.rush_events add constraint rush_events_visibility_check CHECK ((visibility = ANY (ARRAY['public'::text, 'pnm_portal'::text])));
alter table public.rush_form_responses add constraint rush_form_responses_participants_check CHECK ((jsonb_typeof(participants) = 'array'::text));
alter table public.rush_form_templates add constraint rush_form_templates_default_is_global_application CHECK (((NOT is_default) OR ((kind = 'application'::text) AND (cycle_id IS NULL))));
alter table public.rush_form_templates add constraint rush_form_templates_fields_check CHECK ((jsonb_typeof(fields) = 'array'::text));
alter table public.rush_form_templates add constraint rush_form_templates_kind_check CHECK ((kind = ANY (ARRAY['evaluation'::text, 'application'::text])));
alter table public.rush_form_templates add constraint rush_form_templates_participant_roles_check CHECK ((jsonb_typeof(participant_roles) = 'array'::text));
alter table public.rush_form_templates add constraint rush_form_templates_submission_mode_check CHECK ((submission_mode = ANY (ARRAY['single'::text, 'multiple'::text])));
alter table public.rush_slot_signups add constraint rush_slot_signups_check CHECK (((pnm_id IS NULL) <> (user_id IS NULL)));
alter table public.rush_unmatched_checkins add constraint rush_unmatched_checkins_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'linked'::text, 'dismissed'::text])));
alter table public.user_access_reviews add constraint user_access_reviews_status_check CHECK ((status = 'denied'::text));
alter table public.users add constraint users_account_status_check CHECK ((account_status = ANY (ARRAY['public'::text, 'rushee'::text, 'pledge'::text, 'active'::text, 'alumni'::text, 'dropped'::text, 'disaffiliated'::text])));
alter table public.users add constraint users_graduation_year_check CHECK (((graduation_year IS NULL) OR ((graduation_year >= 2000) AND (graduation_year <= 2100))));
alter table public.users add constraint users_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'exec'::text, 'director'::text, 'member'::text, 'newmember'::text])));
alter table public.users add constraint users_website_visibility_check CHECK ((website_visibility = ANY (ARRAY['auto'::text, 'shown'::text, 'hidden'::text])));

-- ---------------------------------------------------------------------------
-- Foreign keys
-- ---------------------------------------------------------------------------

alter table public.announcements add constraint announcements_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;
alter table public.customers add constraint customers_duplicate_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;
alter table public.delib_ballots add constraint delib_ballots_round_id_fkey FOREIGN KEY (round_id) REFERENCES public.delib_vote_rounds(id) ON DELETE CASCADE;
alter table public.delib_ballots add constraint delib_ballots_voter_user_id_fkey FOREIGN KEY (voter_user_id) REFERENCES public.users(id) ON DELETE CASCADE;
alter table public.delib_participants add constraint delib_participants_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public.users(id) ON DELETE SET NULL;
alter table public.delib_participants add constraint delib_participants_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.delib_sessions(id) ON DELETE CASCADE;
alter table public.delib_participants add constraint delib_participants_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
alter table public.delib_sessions add constraint delib_sessions_current_pnm_id_fkey FOREIGN KEY (current_pnm_id) REFERENCES public.pnms(id) ON DELETE SET NULL;
alter table public.delib_sessions add constraint delib_sessions_current_round_fk FOREIGN KEY (current_round_id) REFERENCES public.delib_vote_rounds(id) ON DELETE SET NULL;
alter table public.delib_sessions add constraint delib_sessions_cycle_id_fkey FOREIGN KEY (cycle_id) REFERENCES public.rush_cycles(id) ON DELETE CASCADE;
alter table public.delib_sessions add constraint delib_sessions_started_by_fkey FOREIGN KEY (started_by) REFERENCES public.users(id) ON DELETE SET NULL;
alter table public.delib_vote_rounds add constraint delib_vote_rounds_cycle_id_fkey FOREIGN KEY (cycle_id) REFERENCES public.rush_cycles(id) ON DELETE CASCADE;
alter table public.delib_vote_rounds add constraint delib_vote_rounds_opened_by_fkey FOREIGN KEY (opened_by) REFERENCES public.users(id) ON DELETE SET NULL;
alter table public.delib_vote_rounds add constraint delib_vote_rounds_pnm_id_fkey FOREIGN KEY (pnm_id) REFERENCES public.pnms(id) ON DELETE CASCADE;
alter table public.delib_vote_rounds add constraint delib_vote_rounds_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.delib_sessions(id) ON DELETE CASCADE;
alter table public.finance_charge_targets add constraint finance_charge_targets_charge_id_fkey FOREIGN KEY (charge_id) REFERENCES public.finance_charges(id);
alter table public.finance_charges add constraint finance_charges_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;
alter table public.finance_obligations add constraint finance_obligations_charge_id_fkey FOREIGN KEY (charge_id) REFERENCES public.finance_charges(id) ON DELETE CASCADE;
alter table public.finance_obligations add constraint finance_obligations_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;
alter table public.finance_obligations add constraint finance_obligations_exempted_by_user_id_fkey FOREIGN KEY (exempted_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;
alter table public.finance_obligations add constraint finance_obligations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT;
alter table public.finance_payment_allocations add constraint finance_payment_allocations_obligation_id_fkey FOREIGN KEY (obligation_id) REFERENCES public.finance_obligations(id) ON DELETE CASCADE;
alter table public.finance_payment_allocations add constraint finance_payment_allocations_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.finance_payments(id) ON DELETE CASCADE;
alter table public.finance_payments add constraint finance_payments_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;
alter table public.finance_payments add constraint finance_payments_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;
alter table public.finance_payments add constraint finance_payments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT;
alter table public.pnm_cycle_entries add constraint pnm_cycle_entries_cycle_id_fkey FOREIGN KEY (cycle_id) REFERENCES public.rush_cycles(id) ON DELETE CASCADE;
alter table public.pnm_cycle_entries add constraint pnm_cycle_entries_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public.users(id) ON DELETE SET NULL;
alter table public.pnm_cycle_entries add constraint pnm_cycle_entries_pnm_id_fkey FOREIGN KEY (pnm_id) REFERENCES public.pnms(id) ON DELETE CASCADE;
alter table public.pnms add constraint pnms_linked_user_id_fkey FOREIGN KEY (linked_user_id) REFERENCES public.users(id) ON DELETE SET NULL;
alter table public.role_permissions add constraint role_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES public.permissions(id) ON UPDATE CASCADE ON DELETE CASCADE;
alter table public.role_permissions add constraint role_permissions_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON UPDATE CASCADE ON DELETE CASCADE;
alter table public.rush_application_drafts add constraint rush_application_drafts_cycle_id_fkey FOREIGN KEY (cycle_id) REFERENCES public.rush_cycles(id) ON DELETE CASCADE;
alter table public.rush_application_drafts add constraint rush_application_drafts_pnm_id_fkey FOREIGN KEY (pnm_id) REFERENCES public.pnms(id) ON DELETE CASCADE;
alter table public.rush_applications add constraint rush_applications_cycle_id_fkey FOREIGN KEY (cycle_id) REFERENCES public.rush_cycles(id) ON DELETE CASCADE;
alter table public.rush_applications add constraint rush_applications_pnm_id_fkey FOREIGN KEY (pnm_id) REFERENCES public.pnms(id) ON DELETE CASCADE;
alter table public.rush_applications add constraint rush_applications_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.rush_form_templates(id) ON DELETE SET NULL;
alter table public.rush_contacts add constraint rush_contacts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
alter table public.rush_cycles add constraint rush_cycles_application_template_fk FOREIGN KEY (application_template_id) REFERENCES public.rush_form_templates(id) ON DELETE SET NULL;
alter table public.rush_event_attendance add constraint rush_event_attendance_checked_in_by_fkey FOREIGN KEY (checked_in_by) REFERENCES public.users(id) ON DELETE SET NULL;
alter table public.rush_event_attendance add constraint rush_event_attendance_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.rush_events(id) ON DELETE CASCADE;
alter table public.rush_event_attendance add constraint rush_event_attendance_pnm_id_fkey FOREIGN KEY (pnm_id) REFERENCES public.pnms(id) ON DELETE CASCADE;
alter table public.rush_event_attendance add constraint rush_event_attendance_slot_id_fkey FOREIGN KEY (slot_id) REFERENCES public.rush_event_slots(id) ON DELETE SET NULL;
alter table public.rush_event_attendance add constraint rush_event_attendance_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
alter table public.rush_event_slots add constraint rush_event_slots_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.rush_events(id) ON DELETE CASCADE;
alter table public.rush_events add constraint rush_events_cycle_id_fkey FOREIGN KEY (cycle_id) REFERENCES public.rush_cycles(id) ON DELETE CASCADE;
alter table public.rush_events add constraint rush_events_form_template_id_fkey FOREIGN KEY (form_template_id) REFERENCES public.rush_form_templates(id) ON DELETE SET NULL;
alter table public.rush_form_responses add constraint rush_form_responses_author_user_id_fkey FOREIGN KEY (author_user_id) REFERENCES public.users(id) ON DELETE SET NULL;
alter table public.rush_form_responses add constraint rush_form_responses_cycle_id_fkey FOREIGN KEY (cycle_id) REFERENCES public.rush_cycles(id) ON DELETE CASCADE;
alter table public.rush_form_responses add constraint rush_form_responses_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.rush_events(id) ON DELETE SET NULL;
alter table public.rush_form_responses add constraint rush_form_responses_pnm_id_fkey FOREIGN KEY (pnm_id) REFERENCES public.pnms(id) ON DELETE CASCADE;
alter table public.rush_form_responses add constraint rush_form_responses_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.rush_form_templates(id) ON DELETE CASCADE;
alter table public.rush_form_templates add constraint rush_form_templates_cycle_id_fkey FOREIGN KEY (cycle_id) REFERENCES public.rush_cycles(id) ON DELETE CASCADE;
alter table public.rush_slot_signups add constraint rush_slot_signups_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.rush_events(id) ON DELETE CASCADE;
alter table public.rush_slot_signups add constraint rush_slot_signups_pnm_id_fkey FOREIGN KEY (pnm_id) REFERENCES public.pnms(id) ON DELETE CASCADE;
alter table public.rush_slot_signups add constraint rush_slot_signups_slot_id_fkey FOREIGN KEY (slot_id) REFERENCES public.rush_event_slots(id) ON DELETE CASCADE;
alter table public.rush_slot_signups add constraint rush_slot_signups_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
alter table public.rush_unmatched_checkins add constraint rush_unmatched_checkins_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.rush_events(id) ON DELETE CASCADE;
alter table public.rush_unmatched_checkins add constraint rush_unmatched_checkins_linked_pnm_id_fkey FOREIGN KEY (linked_pnm_id) REFERENCES public.pnms(id) ON DELETE SET NULL;
alter table public.rush_unmatched_checkins add constraint rush_unmatched_checkins_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.users(id) ON DELETE SET NULL;
alter table public.user_access_reviews add constraint user_access_reviews_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(id) ON DELETE SET NULL;
alter table public.user_roles add constraint user_roles_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON UPDATE CASCADE ON DELETE CASCADE;
alter table public.user_roles add constraint user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- Indexes (those not created by a constraint)
-- ---------------------------------------------------------------------------

CREATE INDEX idx_announcements_created_at ON public.announcements USING btree (created_at DESC);
CREATE UNIQUE INDEX delib_sessions_single_active ON public.delib_sessions USING btree (status) WHERE (status = 'active'::text);
CREATE INDEX delib_vote_rounds_pnm_idx ON public.delib_vote_rounds USING btree (pnm_id, cycle_id);
CREATE UNIQUE INDEX delib_vote_rounds_single_open ON public.delib_vote_rounds USING btree (session_id) WHERE (status = 'open'::text);
CREATE INDEX finance_charge_targets_charge_id_idx ON public.finance_charge_targets USING btree (charge_id);
CREATE INDEX idx_finance_obligations_charge_id ON public.finance_obligations USING btree (charge_id);
CREATE INDEX idx_finance_obligations_user_id ON public.finance_obligations USING btree (user_id);
CREATE INDEX idx_finance_payment_allocations_obligation_id ON public.finance_payment_allocations USING btree (obligation_id);
CREATE INDEX idx_finance_payments_stripe_payment_intent_id ON public.finance_payments USING btree (stripe_payment_intent_id);
CREATE INDEX idx_finance_payments_user_status ON public.finance_payments USING btree (user_id, status);
CREATE INDEX pnm_cycle_entries_cycle_idx ON public.pnm_cycle_entries USING btree (cycle_id);
CREATE UNIQUE INDEX pnms_linked_user_id_key ON public.pnms USING btree (linked_user_id) WHERE (linked_user_id IS NOT NULL);
CREATE UNIQUE INDEX rush_cycles_single_active ON public.rush_cycles USING btree (is_active) WHERE is_active;
CREATE INDEX rush_event_attendance_pnm_idx ON public.rush_event_attendance USING btree (pnm_id);
CREATE INDEX rush_event_attendance_user_idx ON public.rush_event_attendance USING btree (user_id);
CREATE INDEX rush_event_slots_event_idx ON public.rush_event_slots USING btree (event_id, starts_at);
CREATE INDEX rush_events_cycle_idx ON public.rush_events USING btree (cycle_id, starts_at);
CREATE INDEX rush_form_responses_author_idx ON public.rush_form_responses USING btree (author_user_id);
CREATE INDEX rush_form_responses_event_idx ON public.rush_form_responses USING btree (event_id);
CREATE INDEX rush_form_responses_pnm_idx ON public.rush_form_responses USING btree (pnm_id, cycle_id);
CREATE UNIQUE INDEX rush_form_templates_one_default_application ON public.rush_form_templates USING btree (kind) WHERE is_default;
CREATE UNIQUE INDEX rush_slot_signups_pnm_event ON public.rush_slot_signups USING btree (event_id, pnm_id) WHERE (pnm_id IS NOT NULL);
CREATE INDEX rush_slot_signups_slot_idx ON public.rush_slot_signups USING btree (slot_id);
CREATE UNIQUE INDEX rush_slot_signups_user_slot ON public.rush_slot_signups USING btree (slot_id, user_id) WHERE (user_id IS NOT NULL);
CREATE INDEX rush_unmatched_checkins_pending_idx ON public.rush_unmatched_checkins USING btree (event_id) WHERE (status = 'pending'::text);
CREATE INDEX users_account_status_idx ON public.users USING btree (account_status);
CREATE UNIQUE INDEX users_clerk_user_id_key ON public.users USING btree (clerk_user_id) WHERE (clerk_user_id IS NOT NULL);
CREATE UNIQUE INDEX users_email_lower_key ON public.users USING btree (lower(email));

-- ---------------------------------------------------------------------------
-- Functions (ordered so SQL functions follow the ones they call)
-- ---------------------------------------------------------------------------

-- Member portal access and public listing: active or alumni.
CREATE OR REPLACE FUNCTION public.account_has_portal_access(p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.users u
     where u.id = p_user_id
       and u.account_status in ('active', 'alumni')
  )
$function$
;

-- Linked account plus permission keys in one round trip (lib/server-auth.ts).
CREATE OR REPLACE FUNCTION public.app_user_context(p_clerk_user_id text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'user', to_jsonb(u),
    'portal_access', public.account_has_portal_access(u.id),
    'permissions', coalesce((
      select jsonb_agg(distinct p.key)
        from public.user_roles ur
        join public.role_permissions rp on rp.role_id = ur.role_id
        join public.permissions p on p.id = rp.permission_id
       where ur.user_id = u.id
    ), '[]'::jsonb)
  )
  from public.users u
  where u.clerk_user_id = p_clerk_user_id
$function$
;

-- Clerk is a third-party auth provider: its user id is the JWT "sub".
CREATE OR REPLACE FUNCTION public.clerk_user_id()
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select auth.jwt() ->> 'sub'
$function$
;

CREATE OR REPLACE FUNCTION public.current_app_user_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select u.id
  from public.users u
  where u.clerk_user_id = (select auth.jwt() ->> 'sub')
    and public.account_has_portal_access(u.id)
  limit 1
$function$
;

CREATE OR REPLACE FUNCTION public.current_user_has_permission(permission_key text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.user_roles ur
    join public.role_permissions rp on rp.role_id = ur.role_id
    join public.permissions p on p.id = rp.permission_id
    where ur.user_id = (select public.current_app_user_id())
      and p.key = permission_key
  )
$function$
;

CREATE OR REPLACE FUNCTION public.current_user_is_disaffiliated()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.users u
    where u.clerk_user_id = (select public.clerk_user_id())
      and u.is_disaffiliated
  )
$function$
;

-- Casting and closing are serialized on the round row: a ballot takes a
-- FOR SHARE lock and requires the round to be open; closing takes FOR UPDATE,
-- stores the final totals, marks the round closed and deletes its ballots in
-- one transaction. Callable only with the secret key (the API checks admission).
CREATE OR REPLACE FUNCTION public.delib_cast_ballot(p_round_id uuid, p_user_id uuid, p_choice text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  r public.delib_vote_rounds%rowtype;
begin
  select * into r from public.delib_vote_rounds where id = p_round_id for share;
  if not found or r.status <> 'open' then
    raise exception 'ROUND_CLOSED';
  end if;
  insert into public.delib_ballots (round_id, voter_user_id, choice, updated_at)
  values (p_round_id, p_user_id, p_choice, now())
  on conflict (round_id, voter_user_id)
  do update set choice = excluded.choice, updated_at = now();
end
$function$
;

CREATE OR REPLACE FUNCTION public.delib_close_round(p_round_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  perform 1 from public.delib_vote_rounds where id = p_round_id and status = 'open' for update;
  if not found then
    raise exception 'ROUND_CLOSED';
  end if;

  update public.delib_vote_rounds r
     set yes_count = c.yes,
         no_count = c.no,
         abstain_count = c.abstain,
         status = 'closed',
         closed_at = now()
    from (
      select count(*) filter (where b.choice = 'yes') as yes,
             count(*) filter (where b.choice = 'no') as no,
             count(*) filter (where b.choice = 'abstain') as abstain
        from public.delib_ballots b
       where b.round_id = p_round_id
    ) c
   where r.id = p_round_id;

  delete from public.delib_ballots where round_id = p_round_id;
end
$function$
;

CREATE OR REPLACE FUNCTION public.delib_recount_round()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  target uuid := coalesce(new.round_id, old.round_id);
begin
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
$function$
;

-- True for the secret key and for direct connections (migrations, SQL editor).
CREATE OR REPLACE FUNCTION public.is_service_request()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select auth.jwt() is null or (auth.jwt() ->> 'role') = 'service_role'
$function$
;

CREATE OR REPLACE FUNCTION public.protect_roles_initiation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if (select public.is_service_request()) then
    return new;
  end if;
  if (tg_op = 'INSERT' and new.is_initiated)
     or (tg_op = 'UPDATE' and new.is_initiated is distinct from old.is_initiated) then
    raise exception 'Initiate a pledge class from the Roles page.'
      using errcode = '42501';
  end if;
  return new;
end
$function$
;

CREATE OR REPLACE FUNCTION public.protect_users_privileged_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if (select public.is_service_request()) then
    return new;
  end if;

  if new.account_status is distinct from old.account_status then
    raise exception 'Account status can only be changed from User Management.'
      using errcode = '42501';
  end if;

  if (select public.current_user_has_permission('admin.users.edit')) then
    return new;
  end if;

  if new.role is distinct from old.role
     or new.email is distinct from old.email
     or new.clerk_user_id is distinct from old.clerk_user_id
     or new.locked is distinct from old.locked
     or new.major is distinct from old.major
     or new.title is distinct from old.title
     or new.phone is distinct from old.phone
     or new.socials is distinct from old.socials
     or new.graduation_year is distinct from old.graduation_year
     or new.website_visibility is distinct from old.website_visibility
     or new.is_inactive is distinct from old.is_inactive
     or new.created_at is distinct from old.created_at then
    raise exception 'You do not have permission to change protected profile fields.'
      using errcode = '42501';
  end if;

  return new;
end
$function$
;

-- A person can't hold two timeslots that overlap in time, in the same event
-- (actives in multi-slot mode) or across events. Back-to-back slots are fine;
-- a slot without an end time is treated as an instant at its start.
CREATE OR REPLACE FUNCTION public.rush_book_slot(p_slot_id uuid, p_pnm_id uuid DEFAULT NULL::uuid, p_user_id uuid DEFAULT NULL::uuid, p_admin boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.rush_broadcast_slots_changed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  target uuid := coalesce(new.event_id, old.event_id);
begin
  perform realtime.send('{}'::jsonb, 'slots_changed', 'rush-event:' || target::text, false);
  return null;
end
$function$
;

CREATE OR REPLACE FUNCTION public.rush_cancel_signup(p_signup_id uuid, p_admin boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.set_role_permissions(p_role_id uuid, p_permission_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if (select public.current_user_is_disaffiliated())
     or not (select public.current_user_has_permission('admin.roles.edit')) then
    raise exception 'Editing role permissions requires admin.roles.edit'
      using errcode = '42501';
  end if;

  delete from public.role_permissions where role_id = p_role_id;

  insert into public.role_permissions (role_id, permission_id)
  select p_role_id, permission_id
    from unnest(coalesce(p_permission_ids, '{}')) as permission_id
  on conflict do nothing;
end
$function$
;

-- The only public (anon) read of member data: display columns for the
-- members page, exec board and directors.
CREATE OR REPLACE FUNCTION public.website_members()
 RETURNS TABLE(id uuid, name text, avatar text, socials jsonb, major text, graduation_year integer, is_alumni boolean, roles jsonb, on_members_page boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with base as (
    select
      u.id, u.name, u.avatar, u.socials, u.major, u.graduation_year, u.is_alumni,
      u.website_visibility,
      coalesce((
        select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'type', r.type, 'priority', r.priority))
          from public.user_roles ur
          join public.roles r on r.id = ur.role_id
         where ur.user_id = u.id
           and r.type in ('pledge_class', 'exec', 'director')
      ), '[]'::jsonb) as roles
    from public.users u
    where u.account_status in ('pledge', 'active', 'alumni')
      and u.website_visibility <> 'hidden'
      and public.account_has_portal_access(u.id)
  ), listed as (
    select b.*,
      b.website_visibility = 'shown'
      or (
        coalesce(btrim(b.avatar), '') <> ''
        and coalesce(btrim(b.major), '') <> ''
        and b.roles @> '[{"type":"pledge_class"}]'::jsonb
      ) as on_members_page
    from base b
  )
  select l.id, l.name, l.avatar, l.socials, l.major, l.graduation_year, l.is_alumni, l.roles, l.on_members_page
    from listed l
   where l.on_members_page
      or l.roles @> '[{"type":"exec"}]'::jsonb
      or l.roles @> '[{"type":"director"}]'::jsonb
   order by l.name
$function$
;

-- ---------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------

create or replace view public.finance_obligation_balances as
 SELECT fo.id,
    fo.charge_id,
    fo.user_id,
    fo.customer_id,
    fo.amount_cents,
    fo.due_at,
    fo.created_at,
    fo.updated_at,
    COALESCE(sum(
        CASE
            WHEN fp.status = 'completed'::text THEN fpa.amount_cents
            ELSE 0
        END), 0::bigint)::integer AS paid_cents,
        CASE
            WHEN fo.exempted_at IS NOT NULL THEN 0
            ELSE GREATEST(fo.amount_cents - COALESCE(sum(
            CASE
                WHEN fp.status = 'completed'::text THEN fpa.amount_cents
                ELSE 0
            END), 0::bigint), 0::bigint)::integer
        END AS remaining_cents,
        CASE
            WHEN fo.exempted_at IS NOT NULL THEN 'exempt'::text
            WHEN GREATEST(fo.amount_cents - COALESCE(sum(
            CASE
                WHEN fp.status = 'completed'::text THEN fpa.amount_cents
                ELSE 0
            END), 0::bigint), 0::bigint) = 0 THEN 'paid'::text
            WHEN COALESCE(sum(
            CASE
                WHEN fp.status = 'completed'::text THEN fpa.amount_cents
                ELSE 0
            END), 0::bigint) > 0 THEN 'partial'::text
            ELSE 'unpaid'::text
        END AS payment_state,
    fo.exempted_at IS NULL AND GREATEST(fo.amount_cents - COALESCE(sum(
        CASE
            WHEN fp.status = 'completed'::text THEN fpa.amount_cents
            ELSE 0
        END), 0::bigint), 0::bigint) > 0 AND fo.due_at IS NOT NULL AND fo.due_at < now() AS is_overdue,
    fo.exempted_at
   FROM public.finance_obligations fo
     LEFT JOIN public.finance_payment_allocations fpa ON fpa.obligation_id = fo.id
     LEFT JOIN public.finance_payments fp ON fp.id = fpa.payment_id
  GROUP BY fo.id, fo.charge_id, fo.user_id, fo.customer_id, fo.amount_cents, fo.due_at, fo.created_at, fo.updated_at, fo.exempted_at;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

CREATE TRIGGER delib_ballots_recount AFTER INSERT OR DELETE OR UPDATE ON public.delib_ballots FOR EACH ROW EXECUTE FUNCTION public.delib_recount_round();
CREATE TRIGGER protect_roles_initiation BEFORE INSERT OR UPDATE ON public.roles FOR EACH ROW EXECUTE FUNCTION public.protect_roles_initiation();
CREATE TRIGGER rush_event_slots_broadcast AFTER INSERT OR DELETE OR UPDATE ON public.rush_event_slots FOR EACH ROW EXECUTE FUNCTION public.rush_broadcast_slots_changed();
CREATE TRIGGER rush_slot_signups_broadcast AFTER INSERT OR DELETE OR UPDATE ON public.rush_slot_signups FOR EACH ROW EXECUTE FUNCTION public.rush_broadcast_slots_changed();
CREATE TRIGGER protect_users_privileged_columns BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.protect_users_privileged_columns();

-- ---------------------------------------------------------------------------
-- Row level security (on for every table; finance, customers and rush tables
-- have no policies, so only the secret key reaches them)
-- ---------------------------------------------------------------------------

alter table public.announcements enable row level security;
alter table public.customers enable row level security;
alter table public.delib_ballots enable row level security;
alter table public.delib_participants enable row level security;
alter table public.delib_sessions enable row level security;
alter table public.delib_vote_rounds enable row level security;
alter table public.finance_charge_targets enable row level security;
alter table public.finance_charges enable row level security;
alter table public.finance_obligations enable row level security;
alter table public.finance_payment_allocations enable row level security;
alter table public.finance_payments enable row level security;
alter table public.permissions enable row level security;
alter table public.pnm_cycle_entries enable row level security;
alter table public.pnms enable row level security;
alter table public.role_permissions enable row level security;
alter table public.roles enable row level security;
alter table public.rush_application_drafts enable row level security;
alter table public.rush_applications enable row level security;
alter table public.rush_contacts enable row level security;
alter table public.rush_cycles enable row level security;
alter table public.rush_event_attendance enable row level security;
alter table public.rush_event_slots enable row level security;
alter table public.rush_events enable row level security;
alter table public.rush_form_responses enable row level security;
alter table public.rush_form_templates enable row level security;
alter table public.rush_slot_signups enable row level security;
alter table public.rush_unmatched_checkins enable row level security;
alter table public.user_access_reviews enable row level security;
alter table public.user_roles enable row level security;
alter table public.users enable row level security;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

create policy "Authors and admins can update announcements" on public.announcements as permissive for update to authenticated
  using (((author_id = ( SELECT public.current_app_user_id() AS current_app_user_id)) OR ( SELECT public.current_user_has_permission('admin.view'::text) AS current_user_has_permission)))
  with check (((author_id = ( SELECT public.current_app_user_id() AS current_app_user_id)) OR ( SELECT public.current_user_has_permission('admin.view'::text) AS current_user_has_permission)));

create policy "Enable read access for all users" on public.announcements as permissive for select to authenticated
  using (true);

create policy "Members can post announcements" on public.announcements as permissive for insert to authenticated
  with check ((author_id = ( SELECT public.current_app_user_id() AS current_app_user_id)));

create policy "Participants see their own row; admins see all" on public.delib_participants as permissive for select to authenticated
  using (((user_id = ( SELECT public.current_app_user_id() AS current_app_user_id)) OR ( SELECT public.current_user_has_permission('rush.deliberation.manage'::text) AS current_user_has_permission)));

create policy "Members can see deliberation sessions" on public.delib_sessions as permissive for select to authenticated
  using ((( SELECT public.current_app_user_id() AS current_app_user_id) IS NOT NULL));

create policy "Admitted participants and admins see vote rounds" on public.delib_vote_rounds as permissive for select to authenticated
  using ((( SELECT public.current_user_has_permission('rush.deliberation.manage'::text) AS current_user_has_permission) OR (EXISTS ( SELECT 1
   FROM public.delib_participants p
  WHERE ((p.session_id = delib_vote_rounds.session_id) AND (p.user_id = ( SELECT public.current_app_user_id() AS current_app_user_id)) AND (p.status = 'admitted'::text))))));

create policy "Members can read permissions" on public.permissions as permissive for select to authenticated
  using ((( SELECT public.current_app_user_id() AS current_app_user_id) IS NOT NULL));

create policy "Permission admins can delete permissions" on public.permissions as permissive for delete to authenticated
  using (( SELECT public.current_user_has_permission('admin.permissions.edit'::text) AS current_user_has_permission));

create policy "Permission admins can insert permissions" on public.permissions as permissive for insert to authenticated
  with check (( SELECT public.current_user_has_permission('admin.permissions.edit'::text) AS current_user_has_permission));

create policy "Permission admins can update permissions" on public.permissions as permissive for update to authenticated
  using (( SELECT public.current_user_has_permission('admin.permissions.edit'::text) AS current_user_has_permission))
  with check (( SELECT public.current_user_has_permission('admin.permissions.edit'::text) AS current_user_has_permission));

create policy "Members can read role permissions" on public.role_permissions as permissive for select to authenticated
  using ((( SELECT public.current_app_user_id() AS current_app_user_id) IS NOT NULL));

create policy "Role admins can delete role permissions" on public.role_permissions as permissive for delete to authenticated
  using (( SELECT public.current_user_has_permission('admin.roles.edit'::text) AS current_user_has_permission));

create policy "Role admins can insert role permissions" on public.role_permissions as permissive for insert to authenticated
  with check (( SELECT public.current_user_has_permission('admin.roles.edit'::text) AS current_user_has_permission));

create policy "Role admins can update role permissions" on public.role_permissions as permissive for update to authenticated
  using (( SELECT public.current_user_has_permission('admin.roles.edit'::text) AS current_user_has_permission))
  with check (( SELECT public.current_user_has_permission('admin.roles.edit'::text) AS current_user_has_permission));

create policy "Members can read roles" on public.roles as permissive for select to authenticated
  using ((( SELECT public.current_app_user_id() AS current_app_user_id) IS NOT NULL));

create policy "Role admins can delete roles" on public.roles as permissive for delete to authenticated
  using (( SELECT public.current_user_has_permission('admin.roles.edit'::text) AS current_user_has_permission));

create policy "Role admins can insert roles" on public.roles as permissive for insert to authenticated
  with check (( SELECT public.current_user_has_permission('admin.roles.edit'::text) AS current_user_has_permission));

create policy "Role admins can update roles" on public.roles as permissive for update to authenticated
  using (( SELECT public.current_user_has_permission('admin.roles.edit'::text) AS current_user_has_permission))
  with check (( SELECT public.current_user_has_permission('admin.roles.edit'::text) AS current_user_has_permission));

create policy "Members can read role assignments" on public.user_roles as permissive for select to authenticated
  using ((((( SELECT public.current_app_user_id() AS current_app_user_id) IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = user_roles.user_id) AND (u.account_status = ANY (ARRAY['pledge'::text, 'active'::text, 'alumni'::text, 'dropped'::text, 'disaffiliated'::text])))))) OR ( SELECT public.current_user_has_permission('admin.view'::text) AS current_user_has_permission)));

create policy "User admins can delete user roles" on public.user_roles as permissive for delete to authenticated
  using (( SELECT public.current_user_has_permission('admin.users.edit'::text) AS current_user_has_permission));

create policy "User admins can insert user roles" on public.user_roles as permissive for insert to authenticated
  with check (( SELECT public.current_user_has_permission('admin.users.edit'::text) AS current_user_has_permission));

create policy "User admins can update user roles" on public.user_roles as permissive for update to authenticated
  using (( SELECT public.current_user_has_permission('admin.users.edit'::text) AS current_user_has_permission))
  with check (( SELECT public.current_user_has_permission('admin.users.edit'::text) AS current_user_has_permission));

create policy "Admins can read every profile" on public.users as permissive for select to authenticated
  using (( SELECT public.current_user_has_permission('admin.view'::text) AS current_user_has_permission));

create policy "Members can read member profiles" on public.users as permissive for select to authenticated
  using (((( SELECT public.current_app_user_id() AS current_app_user_id) IS NOT NULL) AND (account_status = ANY (ARRAY['pledge'::text, 'active'::text, 'alumni'::text, 'dropped'::text, 'disaffiliated'::text]))));

create policy "Members can update their own profile" on public.users as permissive for update to authenticated
  using ((id = ( SELECT public.current_app_user_id() AS current_app_user_id)))
  with check ((id = ( SELECT public.current_app_user_id() AS current_app_user_id)));

create policy "User admins can delete profiles" on public.users as permissive for delete to authenticated
  using (( SELECT public.current_user_has_permission('admin.users.delete'::text) AS current_user_has_permission));

create policy "User admins can update any profile" on public.users as permissive for update to authenticated
  using (( SELECT public.current_user_has_permission('admin.users.edit'::text) AS current_user_has_permission))
  with check (( SELECT public.current_user_has_permission('admin.users.edit'::text) AS current_user_has_permission));

-- Restrictive: dropped and disaffiliated accounts are blocked everywhere a
-- signed-in client can reach.
do $$
declare
  t text;
begin
  foreach t in array array[
    'announcements', 'delib_ballots', 'delib_participants', 'delib_sessions',
    'delib_vote_rounds', 'permissions', 'pnm_cycle_entries', 'pnms',
    'role_permissions', 'roles', 'rush_applications', 'rush_contacts',
    'rush_cycles', 'rush_event_attendance', 'rush_event_slots', 'rush_events',
    'rush_form_responses', 'rush_form_templates', 'rush_slot_signups',
    'rush_unmatched_checkins', 'user_roles', 'users'
  ] loop
    execute format(
      'create policy "Disaffiliated members are blocked" on public.%I as restrictive for all to authenticated
         using ((not (select public.current_user_is_disaffiliated())))
         with check ((not (select public.current_user_is_disaffiliated())))',
      t
    );
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- Grants. Supabase's default privileges give anon and authenticated full
-- access to every new table and function; narrow them to what prod allows.
-- service_role keeps everything.
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

grant select, insert, update, delete, truncate, references, trigger on public.announcements to anon, authenticated;
grant select on public.delib_participants, public.delib_sessions, public.delib_vote_rounds to authenticated;
grant select, insert, update, delete, references, trigger
  on public.permissions, public.role_permissions, public.roles, public.user_roles to authenticated;
grant select, update, delete on public.users to authenticated;

grant execute on function
  public.clerk_user_id(),
  public.current_app_user_id(),
  public.current_user_has_permission(text),
  public.current_user_is_disaffiliated(),
  public.is_service_request(),
  public.website_members()
to anon, authenticated;
grant execute on function public.set_role_permissions(uuid, uuid[]) to authenticated;
grant execute on function public.protect_users_privileged_columns() to public;

-- ---------------------------------------------------------------------------
-- Realtime (deliberation screens)
-- ---------------------------------------------------------------------------

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
-- Storage buckets. Neither has storage policies: the server uploads and signs
-- URLs with the secret key.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars', 'avatars', true, 10485760, array['image/*']),
  ('rush', 'rush', false, null, null)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Seed: permissions, roles and their permissions, global rush form templates.
-- Role and template ids match prod.
-- ---------------------------------------------------------------------------

insert into public.permissions (key, description) values
  ('admin.finance.edit', 'Edit finance admin panel'),
  ('admin.finance.view', 'View finance admin panel'),
  ('admin.permissions.edit', 'Edit Permissions'),
  ('admin.roles.edit', 'Edit Roles'),
  ('admin.users.delete', 'Delete or Suspend Users'),
  ('admin.users.edit', 'Edit Users'),
  ('admin.view', 'View Admin Section'),
  ('messages.send', 'Send Messages'),
  ('rush.attendance.view_actives', 'View and track active member attendance at rush events'),
  ('rush.deliberation.manage', 'Run deliberation sessions and see voting history'),
  ('rush.forms.manage', 'Open and close rush forms'),
  ('rush.manage', 'Manage rush cycles, events, forms and PNMs'),
  ('rush.view', 'View rush PNMs, attendance, applications and evaluations'),
  ('users.activate', 'Move pledges to active members'),
  ('users.rush.manage', 'Register accounts for rush and move rushees to pledge; view rushee, pledge and public accounts in User Management')
on conflict (key) do nothing;

insert into public.roles (id, name, description, hidden, priority, type) values
  ('dd0fb015-890f-45fc-84c5-45e4dab718c0', 'President', '', false, 25, 'exec'),
  ('0f029164-451b-48fc-8b5d-d8d789ec0d22', 'VP of Technical Infrastructure', '', false, 24, 'exec'),
  ('1b7bd64e-3cac-46d7-a1d1-3baf0c9ac2c9', 'VP of Membership', '', false, 23, 'exec'),
  ('bc37c2f4-daaf-4871-8a59-44d7318071a1', 'VP of Finance', '', false, 22, 'exec'),
  ('a4f2b433-c617-46e2-ace3-4eda3926d4f9', 'VP of Internal Affairs', '', false, 21, 'exec'),
  ('eb3c5965-d0e8-49d0-8dce-53356a86a094', 'VP of External Affairs', '', false, 20, 'exec'),
  ('c7de4547-e7f5-4c4b-9a36-49fb633c52e8', 'VP of Marketing', '', false, 19, 'exec'),
  ('25a1df81-0a7d-4c03-ab14-4c24c0f2d730', 'VP of Operations', '', false, 18, 'exec'),
  ('a0bcae1b-8dec-4d77-a6ec-ccaca94b3ce1', 'VP of Social Engagement', '', false, 17, 'exec'),
  ('f07e2236-ae77-45ef-942d-91568da92cdf', 'VP of Professional Development', '', false, 16, 'exec'),
  ('b088d3a5-88f8-4ecb-bc5c-8c7ea1671abb', 'Director of Community Engagement', '', false, 15, 'director'),
  ('61001bff-9c08-4792-8668-0231caa97d48', 'Director of Merch Committee', '', false, 14, 'director'),
  ('46d8054b-8f50-49a7-970a-6f220574ed51', 'Director of Procurement Committee', '', false, 13, 'director'),
  ('9caaa87a-e1ec-40ef-bc59-536d7ca4ee37', 'Director of Rush Committee', '', false, 12, 'director'),
  ('f346e69a-6efd-4293-8c43-4454206e9978', 'Rush Committee', 'Members of the rush committee', false, 11, 'general'),
  ('11d910a0-04f0-4acc-bcb2-03f45ee47aeb', 'Director of New Member Education', '', false, 10, 'director'),
  ('209896fa-3e77-4138-b9ee-5e63931fb819', 'Standards Board', '', false, 9, 'general'),
  ('f5acfd7f-7819-4032-9005-549227c557ea', 'Founding Father', '', false, 8, 'general'),
  ('4687f83a-885f-4ce5-bfa4-4b15e9ae7681', 'PNM (Bid)', '', false, 3, 'general'),
  ('15db9035-2153-457d-bfb1-10c24d3cef97', 'PNM (Closed)', '', false, 2, 'general'),
  ('bfd9f89c-1547-406b-b75a-76c99d9cb304', 'PNM (Open)', '', false, 1, 'general'),
  ('fd7588d4-7f4f-4693-bdce-6a6553d737e3', 'PNM (Former)', '', false, 0, 'general')
on conflict (id) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
  from (values
    ('President', array['admin.finance.edit', 'admin.finance.view', 'admin.permissions.edit', 'admin.roles.edit', 'admin.users.delete', 'admin.users.edit', 'admin.view', 'messages.send', 'rush.attendance.view_actives', 'rush.deliberation.manage', 'rush.forms.manage', 'rush.manage', 'rush.view', 'users.activate', 'users.rush.manage']),
    ('VP of Technical Infrastructure', array['admin.finance.edit', 'admin.finance.view', 'admin.permissions.edit', 'admin.roles.edit', 'admin.users.delete', 'admin.users.edit', 'admin.view', 'messages.send', 'rush.attendance.view_actives', 'rush.deliberation.manage', 'rush.forms.manage', 'rush.manage', 'rush.view', 'users.activate', 'users.rush.manage']),
    ('VP of Membership', array['admin.users.delete', 'admin.users.edit', 'admin.view', 'messages.send', 'rush.attendance.view_actives', 'rush.deliberation.manage', 'rush.forms.manage', 'rush.manage', 'rush.view', 'users.activate', 'users.rush.manage']),
    ('VP of Finance', array['admin.finance.edit', 'admin.finance.view', 'admin.view']),
    ('VP of Internal Affairs', array['admin.view', 'rush.attendance.view_actives']),
    ('VP of External Affairs', array['admin.view']),
    ('VP of Marketing', array['admin.view']),
    ('VP of Operations', array['admin.view']),
    ('VP of Social Engagement', array['admin.view']),
    ('VP of Professional Development', array['admin.view']),
    ('Director of Rush Committee', array['rush.attendance.view_actives', 'rush.deliberation.manage', 'rush.forms.manage', 'rush.manage', 'rush.view', 'users.rush.manage']),
    ('Rush Committee', array['rush.view']),
    ('Director of New Member Education', array['users.activate'])
  ) as v(role_name, keys)
  join public.roles r on r.name = v.role_name
  join public.permissions p on p.key = any (v.keys)
on conflict do nothing;

insert into public.rush_form_templates
  (id, name, description, kind, fields, hide_author_in_deliberation, is_active, sort_order, is_open, submission_mode, participant_roles, is_default)
values
  ('44140187-0c24-4c1a-b647-a1c784770af8', 'Red Flag', 'Report a concern about a PNM.', 'evaluation',
   '[{"id":"what","type":"textarea","label":"What happened?","required":true}]',
   true, true, 0, true, 'single', '[]', false),
  ('2c5ec775-a7c4-4c10-8a89-632e6d9c12be', 'Standout', 'Highlight a PNM who stood out positively.', 'evaluation',
   '[{"id":"why","type":"textarea","label":"What made them stand out?","required":true}]',
   false, true, 0, true, 'single', '[]', false),
  ('888c2474-facb-4ab9-af75-1e8f073359c2', 'Dinner Evaluation', 'Evaluate a PNM after a rush dinner.', 'evaluation',
   '[{"id":"engagement","type":"rating","label":"Professionalism","required":true},
     {"id":"fit","type":"rating","label":"Ease of Engagement","required":true},
     {"id":"notes","type":"textarea","label":"Notes","required":false}]',
   false, true, 0, true, 'single', '[]', false),
  ('1e6e6561-224e-4f55-94c1-0c11903f0825', 'Interview Evaluation',
   'Evaluate a PNM after their interview. If you ask any curveball questions please note them in the notes section.', 'evaluation',
   '[{"id":"communication","type":"rating","label":"Tell Me About Yourself","required":true},
     {"id":"technical","type":"rating","label":"Resume","required":true},
     {"id":"motivation","type":"rating","label":"Behavioral","required":true},
     {"id":"recommend","type":"select","label":"What thinking questions did you choose","options":["Estimation/Fermi-style","Brainteasers","Creative/Strategy"],"required":true},
     {"id":"q_2p7x3u","type":"rating","label":"Thinking Question","required":true},
     {"id":"notes","type":"textarea","label":"Notes","required":true}]',
   false, true, 0, true, 'multiple',
   '[{"id":"interviewers","label":"Interviewers","required":true},
     {"id":"notetakers","label":"Notetakers","required":false},
     {"id":"others","label":"Other actives in the room","required":false}]',
   false),
  ('b39652cd-f162-417c-a12a-02f8a3d71046', 'Conflict of Interest', 'Disclose a personal relationship with a PNM.', 'evaluation',
   '[{"id":"conflicts","type":"people","label":"Which PNMs do you have a conflict of interest with?","people":{"source":"pnms","conflict":true,"multiple":true},"required":true}]',
   false, true, 0, true, 'single', '[]', false),
  ('4d8ed3ad-3317-4c7f-bee5-04a58d9b6344', 'Closed Rush Application', 'Apply to be a part of KTP''s closed rush process.', 'application',
   '[{"id":"phone","type":"text","label":"Phone number","required":true},
     {"id":"grad_year","type":"text","label":"Expected graduation year","required":true},
     {"id":"major","type":"text","label":"Major(s)","required":true},
     {"id":"q_6xuj97","type":"text","label":"Minor(s)","required":false},
     {"id":"why_ktp","type":"textarea","label":"Who were three actives you spoke to during rush, and what did you talk about?","required":true},
     {"id":"project","type":"textarea","label":"Why KTP?","required":true},
     {"id":"anything_else","type":"textarea","label":"If you were a member of KTP and you were stuck in the airport with your fellow brothers for a couple hours, what would you talk about?","required":true},
     {"id":"q_6h0o89","type":"people","label":"What actives did you already know before rushing?","people":{"source":"actives","conflict":true,"multiple":true},"required":false},
     {"id":"q_bfuw9b","type":"text","label":"Video URL","required":true}]',
   false, true, 0, true, 'single', '[]', true)
on conflict (id) do nothing;

-- ===========================================================================
-- Elections
--
-- Executive board and director elections run by the Standards Board:
-- applications -> approval -> campaign materials and endorsements -> review
-- -> live voting at chapter -> results. Every table is server-only (RLS on, no
-- policies, no client grants); the API checks elections.manage and active
-- status.
--
-- Phases: setup, applications, campaign, voting, closed. "Review" is not
-- stored: it is the campaign phase once submission_deadline has passed.
--
-- Ballot secrecy: a vote writes a receipt (who voted in a round) and bumps a
-- tally (how many votes a choice has) in one transaction. Nothing stores a
-- voter next to a choice, and votes are final.
-- ===========================================================================

create or replace function public.election_word_count(p_text text)
 returns integer
 language sql
 immutable
 set search_path = ''
as $$
  select case
    when coalesce(btrim(p_text), '') = '' then 0
    else array_length(regexp_split_to_array(btrim(p_text), '\s+'), 1)
  end
$$;

-- Initiative and endorsement videos are links only (no uploads).
create or replace function public.election_is_video_link(p_url text)
 returns boolean
 language sql
 immutable
 set search_path = ''
as $$
  select coalesce(p_url ~* '^https://((www|m)\.)?(youtube\.com|youtu\.be|drive\.google\.com)/', false)
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.elections (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  phase text not null default 'setup'
    check (phase in ('setup', 'applications', 'campaign', 'voting', 'closed')),
  -- Entered and shown in America/New_York by the app.
  submission_deadline timestamptz not null,
  max_positions_per_candidate integer not null default 2
    check (max_positions_per_candidate between 1 and 5),
  candidates_finalized_at timestamptz,
  -- Shown on the projector during voting; rotated by the app.
  voting_join_code text,
  voting_join_code_set_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);

-- At most one election is underway at a time.
create unique index if not exists elections_single_running
  on public.elections ((phase in ('applications', 'campaign', 'voting')))
  where phase in ('applications', 'campaign', 'voting');

-- Seats on the ballot, copied from exec/director roles in Roles page order.
create table if not exists public.election_positions (
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null references public.elections(id) on delete cascade,
  role_id uuid references public.roles(id) on delete set null,
  title text not null check (btrim(title) <> ''),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (election_id, role_id)
);

create index if not exists election_positions_election_idx
  on public.election_positions (election_id, sort_order);

-- One profile per member per election. Applications must include a
-- transcript; campaigners added by the Standards Board upload it later.
create table if not exists public.election_candidates (
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null references public.elections(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  source text not null default 'application' check (source in ('application', 'manual')),
  intro text check (public.election_word_count(intro) <= 300),
  awards text,
  -- Private `elections` bucket. Only the candidate and
  -- elections.transcripts.view may get a signed URL for it.
  transcript_path text,
  applied_at timestamptz not null default now(),
  added_by uuid references public.users(id) on delete set null,
  submitted_at timestamptz,
  materials_updated_at timestamptz,
  materials_updated_by uuid references public.users(id) on delete set null,
  unique (election_id, user_id),
  check (source = 'manual' or transcript_path is not null)
);

create table if not exists public.election_candidate_photos (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.election_candidates(id) on delete cascade,
  path text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists election_candidate_photos_candidate_idx
  on public.election_candidate_photos (candidate_id, sort_order);

-- A candidate's run for one seat. Lifecycle: pending -> approved | denied;
-- approved -> voided | withdrawn | won | lost; won -> declined (when the
-- candidate keeps another seat). Denials and voids need a reason, which the
-- candidate sees.
create table if not exists public.election_candidacies (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.election_candidates(id) on delete cascade,
  position_id uuid not null references public.election_positions(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'denied', 'voided', 'withdrawn', 'won', 'lost', 'declined')),
  video_url text check (video_url is null or public.election_is_video_link(video_url)),
  decision_reason text,
  decided_by uuid references public.users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (candidate_id, position_id),
  check (status not in ('denied', 'voided') or coalesce(btrim(decision_reason), '') <> '')
);

create index if not exists election_candidacies_position_idx
  on public.election_candidacies (position_id, status);

-- One endorsement per member per candidate; editing sends it back to pending.
create table if not exists public.election_endorsements (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.election_candidates(id) on delete cascade,
  author_user_id uuid not null references public.users(id) on delete cascade,
  kind text not null check (kind in ('text', 'video')),
  body text,
  video_url text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references public.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (candidate_id, author_user_id),
  check (
    (kind = 'text' and coalesce(btrim(body), '') <> ''
       and public.election_word_count(body) <= 100 and video_url is null)
    or (kind = 'video' and public.election_is_video_link(video_url) and body is null)
  )
);

create index if not exists election_endorsements_candidate_idx
  on public.election_endorsements (candidate_id, status);

-- Members admitted to vote at chapter (joined with the projector code, or
-- added by an election manager).
create table if not exists public.election_participants (
  election_id uuid not null references public.elections(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  status text not null default 'admitted' check (status in ('admitted', 'removed')),
  joined_at timestamptz not null default now(),
  decided_by uuid references public.users(id) on delete set null,
  primary key (election_id, user_id)
);

-- One vote per seat; runoffs (ties) and re-votes (declined seats) point at
-- the round they follow.
create table if not exists public.election_rounds (
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null references public.elections(id) on delete cascade,
  position_id uuid not null references public.election_positions(id) on delete cascade,
  parent_round_id uuid references public.election_rounds(id) on delete set null,
  kind text not null default 'initial' check (kind in ('initial', 'runoff', 'revote')),
  status text not null default 'open' check (status in ('open', 'closed', 'tied')),
  tied_candidacy_ids uuid[] not null default '{}',
  winner_candidacy_id uuid references public.election_candidacies(id) on delete set null,
  opened_by uuid references public.users(id) on delete set null,
  opened_at timestamptz not null default now(),
  closed_by uuid references public.users(id) on delete set null,
  closed_at timestamptz
);

create unique index if not exists election_rounds_single_open
  on public.election_rounds (election_id) where status = 'open';
create index if not exists election_rounds_position_idx
  on public.election_rounds (position_id, opened_at);

-- Who has voted in a round. Deliberately no choice and no timestamp.
create table if not exists public.election_vote_receipts (
  round_id uuid not null references public.election_rounds(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  primary key (round_id, user_id)
);

-- Vote counts per choice: an election_candidacies id (as text) or 'abstain'.
-- Rows are created when the round opens. Never shown while the round is open.
create table if not exists public.election_tallies (
  round_id uuid not null references public.election_rounds(id) on delete cascade,
  choice text not null,
  online_count integer not null default 0 check (online_count >= 0),
  paper_count integer not null default 0 check (paper_count >= 0),
  primary key (round_id, choice)
);

-- Where each seat stands. provisional: won, but the winner is still in
-- another race. awaiting_selection: the winner holds two seats and must pick.
-- tied: needs a runoff. vacant: nobody left to take it.
create table if not exists public.election_results (
  position_id uuid primary key references public.election_positions(id) on delete cascade,
  election_id uuid not null references public.elections(id) on delete cascade,
  winner_candidacy_id uuid references public.election_candidacies(id) on delete set null,
  status text not null
    check (status in ('provisional', 'awaiting_selection', 'tied', 'final', 'vacant')),
  resolution text check (resolution in ('outright', 'runner_up', 'runoff', 'revote')),
  source_round_id uuid references public.election_rounds(id) on delete set null,
  tied_candidacy_ids uuid[] not null default '{}',
  decided_by uuid references public.users(id) on delete set null,
  decided_at timestamptz not null default now()
);

create index if not exists election_results_election_idx
  on public.election_results (election_id);

-- ---------------------------------------------------------------------------
-- Integrity triggers
-- ---------------------------------------------------------------------------

-- A candidacy's seat must belong to the candidate's election, and a
-- candidate runs for at most max_positions_per_candidate seats (denied and
-- withdrawn ones don't count).
create or replace function public.election_candidacies_guard()
 returns trigger
 language plpgsql
 set search_path = ''
as $$
declare
  cand public.election_candidates%rowtype;
  max_positions integer;
  running integer;
begin
  select * into cand from public.election_candidates where id = new.candidate_id for update;

  if not exists (
    select 1 from public.election_positions p
     where p.id = new.position_id and p.election_id = cand.election_id
  ) then
    raise exception 'POSITION_NOT_IN_ELECTION';
  end if;

  if new.status not in ('denied', 'withdrawn') then
    select e.max_positions_per_candidate into max_positions
      from public.elections e where e.id = cand.election_id;
    select count(*) into running
      from public.election_candidacies c
     where c.candidate_id = new.candidate_id
       and c.id <> new.id
       and c.status not in ('denied', 'withdrawn');
    if running + 1 > max_positions then
      raise exception 'TOO_MANY_POSITIONS';
    end if;
  end if;

  return new;
end
$$;

drop trigger if exists election_candidacies_guard on public.election_candidacies;
create trigger election_candidacies_guard
  before insert or update of candidate_id, position_id, status on public.election_candidacies
  for each row execute function public.election_candidacies_guard();

create or replace function public.election_photos_limit()
 returns trigger
 language plpgsql
 set search_path = ''
as $$
begin
  perform 1 from public.election_candidates where id = new.candidate_id for update;
  if (select count(*) from public.election_candidate_photos where candidate_id = new.candidate_id) >= 5 then
    raise exception 'TOO_MANY_PHOTOS';
  end if;
  return new;
end
$$;

drop trigger if exists election_photos_limit on public.election_candidate_photos;
create trigger election_photos_limit
  before insert on public.election_candidate_photos
  for each row execute function public.election_photos_limit();

create or replace function public.election_endorsements_guard()
 returns trigger
 language plpgsql
 set search_path = ''
as $$
begin
  if exists (
    select 1 from public.election_candidates c
     where c.id = new.candidate_id and c.user_id = new.author_user_id
  ) then
    raise exception 'SELF_ENDORSEMENT';
  end if;
  return new;
end
$$;

drop trigger if exists election_endorsements_guard on public.election_endorsements;
create trigger election_endorsements_guard
  before insert or update of candidate_id, author_user_id on public.election_endorsements
  for each row execute function public.election_endorsements_guard();

-- Voting screens listen on the public broadcast topic "election:<id>". The
-- message carries no data; clients refetch. Tallies never broadcast.
create or replace function public.election_broadcast_changed()
 returns trigger
 language plpgsql
 security definer
 set search_path = ''
as $$
declare
  target uuid;
begin
  if tg_table_name = 'elections' then
    target := coalesce(new.id, old.id);
  elsif tg_table_name = 'election_vote_receipts' then
    select r.election_id into target
      from public.election_rounds r where r.id = coalesce(new.round_id, old.round_id);
  else
    target := coalesce(new.election_id, old.election_id);
  end if;
  if target is not null then
    perform realtime.send('{}'::jsonb, 'changed', 'election:' || target::text, false);
  end if;
  return null;
end
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'elections', 'election_participants', 'election_rounds',
    'election_vote_receipts', 'election_results'
  ] loop
    execute format('drop trigger if exists %I on public.%I', t || '_broadcast', t);
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function public.election_broadcast_changed()',
      t || '_broadcast', t
    );
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- Voting functions. Callable only with the secret key. Casting takes a
-- FOR SHARE lock on the round and requires it open; closing takes FOR UPDATE,
-- so no vote lands after the count.
-- ---------------------------------------------------------------------------

create or replace function public.election_cast_vote(p_round_id uuid, p_user_id uuid, p_choice text)
 returns void
 language plpgsql
 set search_path = ''
as $$
declare
  r public.election_rounds%rowtype;
begin
  select * into r from public.election_rounds where id = p_round_id for share;
  if not found or r.status <> 'open' then
    raise exception 'ROUND_CLOSED';
  end if;

  if not exists (
    select 1
      from public.election_participants p
      join public.users u on u.id = p.user_id
     where p.election_id = r.election_id
       and p.user_id = p_user_id
       and p.status = 'admitted'
       and u.account_status = 'active'
  ) then
    raise exception 'NOT_ADMITTED';
  end if;

  insert into public.election_vote_receipts (round_id, user_id)
  values (p_round_id, p_user_id)
  on conflict do nothing;
  if not found then
    raise exception 'ALREADY_VOTED';
  end if;

  update public.election_tallies
     set online_count = online_count + 1
   where round_id = p_round_id and choice = p_choice;
  if not found then
    raise exception 'INVALID_CHOICE';
  end if;
end
$$;

-- Hand-counted ballots, as {"<choice>": count}. Replaces the round's paper
-- counts for the choices given.
create or replace function public.election_record_paper_counts(p_round_id uuid, p_counts jsonb)
 returns void
 language plpgsql
 set search_path = ''
as $$
begin
  perform 1 from public.election_rounds where id = p_round_id and status = 'open' for share;
  if not found then
    raise exception 'ROUND_CLOSED';
  end if;
  update public.election_tallies t
     set paper_count = (p_counts ->> t.choice)::integer
   where t.round_id = p_round_id and p_counts ? t.choice;
end
$$;

-- Re-derives each decided seat's status: a winner holding another won seat
-- must choose (awaiting_selection); a winner still running elsewhere is
-- provisional; otherwise final.
create or replace function public.election_refresh_results(p_election_id uuid)
 returns void
 language plpgsql
 set search_path = ''
as $$
begin
  update public.election_results res
     set status = case
       when exists (
         select 1
           from public.election_candidacies mine
           join public.election_candidacies other
             on other.candidate_id = mine.candidate_id and other.id <> mine.id
          where mine.id = res.winner_candidacy_id and other.status = 'won'
       ) then 'awaiting_selection'
       when exists (
         select 1
           from public.election_candidacies mine
           join public.election_candidacies other
             on other.candidate_id = mine.candidate_id and other.id <> mine.id
          where mine.id = res.winner_candidacy_id and other.status = 'approved'
       ) then 'provisional'
       else 'final'
     end
   where res.election_id = p_election_id
     and res.winner_candidacy_id is not null
     and res.status in ('provisional', 'awaiting_selection', 'final');
end
$$;

create or replace function public.election_award_seat(
  p_position_id uuid,
  p_candidacy_id uuid,
  p_resolution text,
  p_round_id uuid,
  p_user_id uuid
) returns void
 language plpgsql
 set search_path = ''
as $$
begin
  update public.election_candidacies set status = 'won' where id = p_candidacy_id;

  insert into public.election_results
    (position_id, election_id, winner_candidacy_id, status, resolution, source_round_id,
     tied_candidacy_ids, decided_by, decided_at)
  select p.id, p.election_id, p_candidacy_id, 'provisional', p_resolution, p_round_id,
         '{}', p_user_id, now()
    from public.election_positions p
   where p.id = p_position_id
  on conflict (position_id) do update
     set winner_candidacy_id = excluded.winner_candidacy_id,
         status = excluded.status,
         resolution = excluded.resolution,
         source_round_id = excluded.source_round_id,
         tied_candidacy_ids = '{}',
         decided_by = excluded.decided_by,
         decided_at = excluded.decided_at;
end
$$;

-- Marks a seat tied (no winner) so an election manager can start a runoff.
create or replace function public.election_mark_tied(
  p_position_id uuid,
  p_candidacy_ids uuid[],
  p_round_id uuid,
  p_user_id uuid
) returns void
 language plpgsql
 set search_path = ''
as $$
begin
  insert into public.election_results
    (position_id, election_id, winner_candidacy_id, status, resolution, source_round_id,
     tied_candidacy_ids, decided_by, decided_at)
  select p.id, p.election_id, null, 'tied', null, p_round_id, p_candidacy_ids, p_user_id, now()
    from public.election_positions p
   where p.id = p_position_id
  on conflict (position_id) do update
     set winner_candidacy_id = null,
         status = 'tied',
         resolution = null,
         source_round_id = excluded.source_round_id,
         tied_candidacy_ids = excluded.tied_candidacy_ids,
         decided_by = excluded.decided_by,
         decided_at = excluded.decided_at;
end
$$;

-- Opens a round. initial: every approved candidacy for the seat, once.
-- runoff: the tied candidacies of a tied seat. revote: the given candidacies
-- of a seat whose winner declined (undoes any runner-up award first).
create or replace function public.election_open_round(
  p_position_id uuid,
  p_kind text,
  p_candidacy_ids uuid[],
  p_user_id uuid
) returns uuid
 language plpgsql
 set search_path = ''
as $$
declare
  pos public.election_positions%rowtype;
  e public.elections%rowtype;
  res public.election_results%rowtype;
  ids uuid[];
  v_round_id uuid;
begin
  select * into pos from public.election_positions where id = p_position_id;
  if not found then raise exception 'POSITION_NOT_FOUND'; end if;

  select * into e from public.elections where id = pos.election_id for update;
  if e.phase <> 'voting' then raise exception 'NOT_VOTING'; end if;
  if exists (select 1 from public.election_rounds where election_id = e.id and status = 'open') then
    raise exception 'ROUND_ALREADY_OPEN';
  end if;

  select * into res from public.election_results where position_id = p_position_id;

  if p_kind = 'initial' then
    if res.position_id is not null then raise exception 'ALREADY_DECIDED'; end if;
    select coalesce(array_agg(c.id order by c.created_at), '{}') into ids
      from public.election_candidacies c
     where c.position_id = p_position_id and c.status = 'approved';
  elsif p_kind = 'runoff' then
    if res.status is distinct from 'tied' then raise exception 'NOT_TIED'; end if;
    ids := res.tied_candidacy_ids;
  elsif p_kind = 'revote' then
    if not exists (
      select 1 from public.election_candidacies c
       where c.position_id = p_position_id and c.status = 'declined'
    ) then
      raise exception 'NOTHING_TO_REVOTE';
    end if;
    -- Undo a runner-up award or tie on this seat before re-voting it.
    if res.winner_candidacy_id is not null then
      update public.election_candidacies set status = 'lost'
       where id = res.winner_candidacy_id and status = 'won';
    end if;
    delete from public.election_results where position_id = p_position_id;
    select coalesce(array_agg(c.id order by c.created_at), '{}') into ids
      from public.election_candidacies c
     where c.position_id = p_position_id
       and c.id = any (coalesce(p_candidacy_ids, '{}'))
       and c.status in ('approved', 'lost');
  else
    raise exception 'INVALID_KIND';
  end if;

  if coalesce(array_length(ids, 1), 0) = 0 then
    raise exception 'NO_CANDIDATES';
  end if;

  update public.election_candidacies set status = 'approved'
   where id = any (ids) and status = 'lost';

  insert into public.election_rounds (election_id, position_id, parent_round_id, kind, opened_by)
  values (e.id, p_position_id, res.source_round_id, p_kind, p_user_id)
  returning id into v_round_id;

  insert into public.election_tallies (round_id, choice)
  select v_round_id, c::text from unnest(ids) as c
  union all
  select v_round_id, 'abstain';

  perform public.election_refresh_results(e.id);
  return v_round_id;
end
$$;

-- Closes a round and applies plurality. A tie at the top marks the seat tied
-- for a manual runoff; otherwise the leader wins and everyone else in the
-- round loses.
create or replace function public.election_close_round(p_round_id uuid, p_user_id uuid)
 returns void
 language plpgsql
 set search_path = ''
as $$
declare
  r public.election_rounds%rowtype;
  top integer;
  leaders text[];
  leader_ids uuid[];
begin
  select * into r from public.election_rounds where id = p_round_id and status = 'open' for update;
  if not found then raise exception 'ROUND_CLOSED'; end if;

  select max(t.online_count + t.paper_count) into top
    from public.election_tallies t
   where t.round_id = p_round_id and t.choice <> 'abstain';

  select coalesce(array_agg(t.choice), '{}') into leaders
    from public.election_tallies t
   where t.round_id = p_round_id and t.choice <> 'abstain'
     and t.online_count + t.paper_count = top;
  leader_ids := leaders::uuid[];

  update public.election_candidacies c
     set status = 'lost'
    from public.election_tallies t
   where t.round_id = p_round_id
     and t.choice = c.id::text
     and c.status = 'approved'
     and not (c.id = any (leader_ids));

  if array_length(leader_ids, 1) > 1 then
    update public.election_rounds
       set status = 'tied', tied_candidacy_ids = leader_ids, closed_by = p_user_id, closed_at = now()
     where id = p_round_id;
    perform public.election_mark_tied(r.position_id, leader_ids, p_round_id, p_user_id);
  else
    update public.election_rounds
       set status = 'closed', winner_candidacy_id = leader_ids[1], closed_by = p_user_id, closed_at = now()
     where id = p_round_id;
    perform public.election_award_seat(
      r.position_id,
      leader_ids[1],
      case r.kind when 'initial' then 'outright' else r.kind end,
      p_round_id,
      p_user_id
    );
  end if;

  perform public.election_refresh_results(r.election_id);
end
$$;

-- Gives a declined seat to the runner-up of the round that decided it. Ties
-- for runner-up mark the seat tied; nobody left makes it vacant.
create or replace function public.election_reconcile_position(p_position_id uuid, p_user_id uuid)
 returns void
 language plpgsql
 set search_path = ''
as $$
declare
  res public.election_results%rowtype;
  top integer;
  leaders text[];
  leader_ids uuid[];
begin
  select * into res from public.election_results where position_id = p_position_id for update;
  if not found then raise exception 'RESULT_NOT_FOUND'; end if;

  select max(t.online_count + t.paper_count) into top
    from public.election_tallies t
    join public.election_candidacies c on c.id::text = t.choice
   where t.round_id = res.source_round_id and c.status = 'lost';

  if top is null then
    update public.election_results
       set winner_candidacy_id = null, status = 'vacant', resolution = 'runner_up',
           tied_candidacy_ids = '{}', decided_by = p_user_id, decided_at = now()
     where position_id = p_position_id;
    return;
  end if;

  select coalesce(array_agg(t.choice), '{}') into leaders
    from public.election_tallies t
    join public.election_candidacies c on c.id::text = t.choice
   where t.round_id = res.source_round_id and c.status = 'lost'
     and t.online_count + t.paper_count = top;
  leader_ids := leaders::uuid[];

  if array_length(leader_ids, 1) > 1 then
    update public.election_candidacies set status = 'approved' where id = any (leader_ids);
    perform public.election_mark_tied(p_position_id, leader_ids, res.source_round_id, p_user_id);
  else
    perform public.election_award_seat(p_position_id, leader_ids[1], 'runner_up', res.source_round_id, p_user_id);
  end if;
end
$$;

-- A candidate who won two seats keeps one (chosen by them or an election
-- manager); every other seat they won is declined and reconciled.
create or replace function public.election_select_seat(p_candidate_id uuid, p_keep_candidacy_id uuid, p_user_id uuid)
 returns void
 language plpgsql
 set search_path = ''
as $$
declare
  cand public.election_candidates%rowtype;
  d record;
begin
  select * into cand from public.election_candidates where id = p_candidate_id for update;
  if not found then raise exception 'CANDIDATE_NOT_FOUND'; end if;

  if not exists (
    select 1 from public.election_candidacies
     where id = p_keep_candidacy_id and candidate_id = p_candidate_id and status = 'won'
  ) then
    raise exception 'INVALID_SELECTION';
  end if;

  if not exists (
    select 1 from public.election_candidacies
     where candidate_id = p_candidate_id and status = 'won' and id <> p_keep_candidacy_id
  ) then
    raise exception 'NO_SELECTION_NEEDED';
  end if;

  for d in
    select id, position_id from public.election_candidacies
     where candidate_id = p_candidate_id and status = 'won' and id <> p_keep_candidacy_id
  loop
    update public.election_candidacies set status = 'declined' where id = d.id;
    perform public.election_reconcile_position(d.position_id, p_user_id);
  end loop;

  perform public.election_refresh_results(cand.election_id);
end
$$;

-- ---------------------------------------------------------------------------
-- RLS and grants: server-only
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'elections', 'election_positions', 'election_candidates', 'election_candidate_photos',
    'election_candidacies', 'election_endorsements', 'election_participants',
    'election_rounds', 'election_vote_receipts', 'election_tallies', 'election_results'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end
$$;

revoke execute on function
  public.election_word_count(text),
  public.election_is_video_link(text),
  public.election_candidacies_guard(),
  public.election_photos_limit(),
  public.election_endorsements_guard(),
  public.election_broadcast_changed(),
  public.election_cast_vote(uuid, uuid, text),
  public.election_record_paper_counts(uuid, jsonb),
  public.election_refresh_results(uuid),
  public.election_award_seat(uuid, uuid, text, uuid, uuid),
  public.election_mark_tied(uuid, uuid[], uuid, uuid),
  public.election_open_round(uuid, text, uuid[], uuid),
  public.election_close_round(uuid, uuid),
  public.election_reconcile_position(uuid, uuid),
  public.election_select_seat(uuid, uuid, uuid)
from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Storage: transcripts and candidate photos, private, signed URLs only
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('elections', 'elections', false, 5242880,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Permissions. The Standards Board runs elections and checks transcripts;
-- VP of Technical Infrastructure (site admin) gets the same.
-- ---------------------------------------------------------------------------

insert into public.permissions (key, description) values
  ('elections.manage', 'Run elections: applications, candidates, endorsements and voting'),
  ('elections.transcripts.view', 'View candidate transcripts')
on conflict (key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
  from public.roles r
  join public.permissions p on p.key in ('elections.manage', 'elections.transcripts.view')
 where r.name in ('Standards Board', 'VP of Technical Infrastructure')
on conflict do nothing;

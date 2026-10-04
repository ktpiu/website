-- Applied to project ulensjpqjptqvghjtggv on 2026-10-04 as "rush_cycle_stages". Kept here for reference/local dev.
--
-- A rush cycle is now just a term + year ("Fall 2026"). Open vs closed rush is
-- a stage on each PNM's cycle entry instead of a separate cycle; admins move
-- PNMs from open to closed (or to former). The cycle's `phase` says where the
-- semester is overall and drives the public rush page. Deliberation sessions
-- and vote rounds record which stage they were for, so data stays split by
-- semester and by open/closed rush. Events get a configurable timeslot grid.

alter table public.rush_cycles drop constraint if exists rush_cycles_term_year_kind_key;
alter table public.rush_cycles drop column if exists label;
alter table public.rush_cycles drop column if exists kind;
alter table public.rush_cycles
  add column if not exists phase text not null default 'open'
    check (phase in ('open', 'closed', 'concluded'));
alter table public.rush_cycles
  add column if not exists label text generated always as (initcap(term) || ' ' || year::text) stored;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rush_cycles_term_year_key') then
    alter table public.rush_cycles add constraint rush_cycles_term_year_key unique (term, year);
  end if;
end
$$;

alter table public.pnm_cycle_entries
  add column if not exists stage text not null default 'open' check (stage in ('open', 'closed'));

alter table public.delib_sessions
  add column if not exists stage text not null default 'open' check (stage in ('open', 'closed'));

alter table public.delib_vote_rounds
  add column if not exists stage text not null default 'open' check (stage in ('open', 'closed'));

-- time_rows: rows are times, columns are locations (interviews).
-- location_rows: rows are locations, columns are times (dinners).
alter table public.rush_events
  add column if not exists slot_grid text not null default 'time_rows'
    check (slot_grid in ('time_rows', 'location_rows'));

-- Elections: one ballot for every race, races with several winners, a planned
-- election date, an optional join code, and no limit on positions per
-- candidate.
--
-- Every race opens together and members submit one ballot covering all of
-- them. A position has `seats` winners: members pick up to that many, and the
-- top vote-getters win. A tie for the last seat(s) goes to a runoff for only
-- the seats still open.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

alter table public.elections
  -- When the election is planned to happen; the only date general members see.
  -- Entered and shown in America/New_York by the app. Voting still opens by hand.
  add column if not exists election_date timestamptz,
  -- Off means any active member can vote from anywhere while voting is open.
  add column if not exists require_join_code boolean not null default true;

alter table public.election_positions
  add column if not exists seats integer not null default 1 check (seats between 1 and 20);

alter table public.election_rounds
  -- How many winners this round picks (a runoff picks only the seats left).
  add column if not exists seats integer not null default 1 check (seats >= 1),
  add column if not exists winner_candidacy_ids uuid[] not null default '{}';

update public.election_rounds
   set winner_candidacy_ids = array[winner_candidacy_id]
 where winner_candidacy_id is not null;

alter table public.election_rounds drop column if exists winner_candidacy_id;

alter table public.election_results
  add column if not exists winner_candidacy_ids uuid[] not null default '{}';

update public.election_results
   set winner_candidacy_ids = array[winner_candidacy_id]
 where winner_candidacy_id is not null;

alter table public.election_results drop column if exists winner_candidacy_id;

drop index if exists public.election_rounds_single_open;
create unique index if not exists election_rounds_position_single_open
  on public.election_rounds (position_id) where status = 'open';

-- ---------------------------------------------------------------------------
-- No limit on positions per candidate
-- ---------------------------------------------------------------------------

create or replace function public.election_candidacies_guard()
 returns trigger
 language plpgsql
 set search_path = ''
as $$
declare
  cand public.election_candidates%rowtype;
begin
  select * into cand from public.election_candidates where id = new.candidate_id for update;

  if not exists (
    select 1 from public.election_positions p
     where p.id = new.position_id and p.election_id = cand.election_id
  ) then
    raise exception 'POSITION_NOT_IN_ELECTION';
  end if;

  return new;
end
$$;

alter table public.elections drop column if exists max_positions_per_candidate;

-- ---------------------------------------------------------------------------
-- Voting functions
-- ---------------------------------------------------------------------------

drop function if exists public.election_cast_vote(uuid, uuid, text);
drop function if exists public.election_award_seat(uuid, uuid, text, uuid, uuid);

-- One submission for every open race the member hasn't voted in, as
-- {"<round id>": ["<choice>", ...]}. A race takes up to `seats` candidates, or
-- ["abstain"]. All of it lands or none of it does. Nothing stores a voter next
-- to a choice: each race gets a receipt and anonymous tally bumps.
create or replace function public.election_cast_ballot(p_election_id uuid, p_user_id uuid, p_votes jsonb)
 returns void
 language plpgsql
 set search_path = ''
as $$
declare
  e public.elections%rowtype;
  r public.election_rounds%rowtype;
  choices text[];
  bumped integer;
  cast_any boolean := false;
begin
  select * into e from public.elections where id = p_election_id for share;
  if not found or e.phase <> 'voting' then
    raise exception 'NOT_VOTING';
  end if;

  if not exists (select 1 from public.users u where u.id = p_user_id and u.account_status = 'active') then
    raise exception 'NOT_ADMITTED';
  end if;
  if e.require_join_code and not exists (
    select 1 from public.election_participants p
     where p.election_id = p_election_id and p.user_id = p_user_id and p.status = 'admitted'
  ) then
    raise exception 'NOT_ADMITTED';
  end if;

  if exists (
    select 1 from jsonb_object_keys(p_votes) as k
     where not exists (
       select 1 from public.election_rounds x
        where x.id::text = k and x.election_id = p_election_id and x.status = 'open'
     )
  ) then
    raise exception 'ROUND_CLOSED';
  end if;

  -- Same lock order as closing, so a ballot can't deadlock against it.
  for r in
    select * from public.election_rounds
     where election_id = p_election_id and status = 'open'
     order by id
     for share
  loop
    if exists (
      select 1 from public.election_vote_receipts v where v.round_id = r.id and v.user_id = p_user_id
    ) then
      if p_votes ? r.id::text then raise exception 'ALREADY_VOTED'; end if;
      continue;
    end if;

    if not (p_votes ? r.id::text) then raise exception 'INCOMPLETE_BALLOT'; end if;

    select coalesce(array_agg(distinct c), '{}') into choices
      from jsonb_array_elements_text(p_votes -> r.id::text) as c;

    if cardinality(choices) = 0 or cardinality(choices) <> jsonb_array_length(p_votes -> r.id::text) then
      raise exception 'INVALID_CHOICE';
    end if;
    if 'abstain' = any (choices) and cardinality(choices) > 1 then
      raise exception 'INVALID_CHOICE';
    end if;
    if cardinality(choices) > r.seats then
      raise exception 'TOO_MANY_CHOICES';
    end if;

    insert into public.election_vote_receipts (round_id, user_id) values (r.id, p_user_id);

    update public.election_tallies
       set online_count = online_count + 1
     where round_id = r.id and choice = any (choices);
    get diagnostics bumped = row_count;
    if bumped <> cardinality(choices) then
      raise exception 'INVALID_CHOICE';
    end if;
    cast_any := true;
  end loop;

  if not cast_any then
    raise exception 'ROUND_CLOSED';
  end if;
end
$$;

-- Re-derives each decided seat's status: a winner holding another won seat
-- must choose (awaiting_selection); a winner still running elsewhere is
-- provisional; otherwise final. Tied seats stay tied until their runoff.
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
          where mine.id = any (res.winner_candidacy_ids) and other.status = 'won'
       ) then 'awaiting_selection'
       when exists (
         select 1
           from public.election_candidacies mine
           join public.election_candidacies other
             on other.candidate_id = mine.candidate_id and other.id <> mine.id
          where mine.id = any (res.winner_candidacy_ids) and other.status = 'approved'
       ) then 'provisional'
       else 'final'
     end
   where res.election_id = p_election_id
     and cardinality(res.winner_candidacy_ids) > 0
     and res.status in ('provisional', 'awaiting_selection', 'final');
end
$$;

-- Adds winners to a position, keeping any it already has.
create or replace function public.election_award_seats(
  p_position_id uuid,
  p_candidacy_ids uuid[],
  p_resolution text,
  p_round_id uuid,
  p_user_id uuid
) returns void
 language plpgsql
 set search_path = ''
as $$
begin
  update public.election_candidacies set status = 'won' where id = any (p_candidacy_ids);

  insert into public.election_results
    (position_id, election_id, winner_candidacy_ids, status, resolution, source_round_id,
     tied_candidacy_ids, decided_by, decided_at)
  select p.id, p.election_id, p_candidacy_ids, 'provisional', p_resolution, p_round_id,
         '{}', p_user_id, now()
    from public.election_positions p
   where p.id = p_position_id
  on conflict (position_id) do update
     set winner_candidacy_ids = array(
           select distinct w
             from unnest(public.election_results.winner_candidacy_ids || excluded.winner_candidacy_ids) as w
         ),
         status = excluded.status,
         resolution = excluded.resolution,
         source_round_id = excluded.source_round_id,
         tied_candidacy_ids = '{}',
         decided_by = excluded.decided_by,
         decided_at = excluded.decided_at;
end
$$;

-- Marks a seat tied so an election manager can start a runoff. Winners already
-- decided on this position keep their seats.
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
    (position_id, election_id, status, resolution, source_round_id,
     tied_candidacy_ids, decided_by, decided_at)
  select p.id, p.election_id, 'tied', null, p_round_id, p_candidacy_ids, p_user_id, now()
    from public.election_positions p
   where p.id = p_position_id
  on conflict (position_id) do update
     set status = 'tied',
         resolution = null,
         source_round_id = excluded.source_round_id,
         tied_candidacy_ids = excluded.tied_candidacy_ids,
         decided_by = excluded.decided_by,
         decided_at = excluded.decided_at;
end
$$;

-- Opens a round. initial: every approved candidacy for the seat, once.
-- runoff: the tied candidacies, for the seats still open. revote: the given
-- candidacies of a one-winner seat whose winner declined (undoes any runner-up
-- award first).
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
  v_seats integer;
  v_round_id uuid;
begin
  select * into pos from public.election_positions where id = p_position_id;
  if not found then raise exception 'POSITION_NOT_FOUND'; end if;

  select * into e from public.elections where id = pos.election_id for update;
  if e.phase <> 'voting' then raise exception 'NOT_VOTING'; end if;
  if exists (
    select 1 from public.election_rounds where position_id = p_position_id and status = 'open'
  ) then
    raise exception 'ROUND_ALREADY_OPEN';
  end if;

  select * into res from public.election_results where position_id = p_position_id;
  v_seats := pos.seats;

  if p_kind = 'initial' then
    if res.position_id is not null then raise exception 'ALREADY_DECIDED'; end if;
    select coalesce(array_agg(c.id order by c.created_at), '{}') into ids
      from public.election_candidacies c
     where c.position_id = p_position_id and c.status = 'approved';
  elsif p_kind = 'runoff' then
    if res.status is distinct from 'tied' then raise exception 'NOT_TIED'; end if;
    ids := res.tied_candidacy_ids;
    v_seats := pos.seats - cardinality(res.winner_candidacy_ids);
  elsif p_kind = 'revote' then
    if pos.seats > 1 then raise exception 'REVOTE_SINGLE_SEAT'; end if;
    if not exists (
      select 1 from public.election_candidacies c
       where c.position_id = p_position_id and c.status = 'declined'
    ) then
      raise exception 'NOTHING_TO_REVOTE';
    end if;
    -- Undo a runner-up award or tie on this seat before re-voting it.
    update public.election_candidacies set status = 'lost'
     where id = any (coalesce(res.winner_candidacy_ids, '{}')) and status = 'won';
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

  insert into public.election_rounds (election_id, position_id, parent_round_id, kind, opened_by, seats)
  values (e.id, p_position_id, res.source_round_id, p_kind, p_user_id, v_seats)
  returning id into v_round_id;

  insert into public.election_tallies (round_id, choice)
  select v_round_id, c::text from unnest(ids) as c
  union all
  select v_round_id, 'abstain';

  perform public.election_refresh_results(e.id);
  return v_round_id;
end
$$;

-- Starts voting: every position with a candidate opens together.
create or replace function public.election_start_voting(p_election_id uuid, p_join_code text, p_user_id uuid)
 returns void
 language plpgsql
 set search_path = ''
as $$
declare
  e public.elections%rowtype;
  p record;
begin
  select * into e from public.elections where id = p_election_id for update;
  if not found or e.phase <> 'campaign' then raise exception 'NOT_CAMPAIGN'; end if;

  update public.elections
     set phase = 'voting',
         voting_join_code = p_join_code,
         voting_join_code_set_at = case when p_join_code is null then null else now() end,
         updated_by = p_user_id,
         updated_at = now()
   where id = p_election_id;

  for p in
    select distinct pos.id, pos.sort_order
      from public.election_positions pos
      join public.election_candidacies c on c.position_id = pos.id
     where pos.election_id = p_election_id and c.status = 'approved'
     order by pos.sort_order
  loop
    perform public.election_open_round(p.id, 'initial', null, p_user_id);
  end loop;

  if not exists (select 1 from public.election_rounds where election_id = p_election_id) then
    raise exception 'NO_CANDIDATES';
  end if;
end
$$;

-- Closes a round and applies plurality for its seats. A tie for the last
-- seat(s) marks the position tied for a manual runoff; candidates clear of the
-- tie still win, and everyone below it loses.
create or replace function public.election_close_round(p_round_id uuid, p_user_id uuid)
 returns void
 language plpgsql
 set search_path = ''
as $$
declare
  r public.election_rounds%rowtype;
  running integer;
  cut integer;
  next_votes integer;
  win_ids uuid[] := '{}';
  tied_ids uuid[] := '{}';
begin
  select * into r from public.election_rounds where id = p_round_id and status = 'open' for update;
  if not found then raise exception 'ROUND_CLOSED'; end if;

  select count(*) into running
    from public.election_tallies t
   where t.round_id = p_round_id and t.choice <> 'abstain';

  if running <= r.seats then
    select coalesce(array_agg(t.choice::uuid), '{}') into win_ids
      from public.election_tallies t
     where t.round_id = p_round_id and t.choice <> 'abstain';
  else
    select t.online_count + t.paper_count into cut
      from public.election_tallies t
     where t.round_id = p_round_id and t.choice <> 'abstain'
     order by t.online_count + t.paper_count desc
     offset r.seats - 1 limit 1;

    select t.online_count + t.paper_count into next_votes
      from public.election_tallies t
     where t.round_id = p_round_id and t.choice <> 'abstain'
     order by t.online_count + t.paper_count desc
     offset r.seats limit 1;

    if cut > next_votes then
      select coalesce(array_agg(t.choice::uuid), '{}') into win_ids
        from public.election_tallies t
       where t.round_id = p_round_id and t.choice <> 'abstain'
         and t.online_count + t.paper_count >= cut;
    else
      select coalesce(array_agg(t.choice::uuid), '{}') into win_ids
        from public.election_tallies t
       where t.round_id = p_round_id and t.choice <> 'abstain'
         and t.online_count + t.paper_count > cut;
      select coalesce(array_agg(t.choice::uuid), '{}') into tied_ids
        from public.election_tallies t
       where t.round_id = p_round_id and t.choice <> 'abstain'
         and t.online_count + t.paper_count = cut;
    end if;
  end if;

  update public.election_candidacies c
     set status = 'lost'
    from public.election_tallies t
   where t.round_id = p_round_id
     and t.choice = c.id::text
     and c.status = 'approved'
     and not (c.id = any (win_ids || tied_ids));

  update public.election_rounds
     set status = case when cardinality(tied_ids) > 0 then 'tied' else 'closed' end,
         tied_candidacy_ids = tied_ids,
         winner_candidacy_ids = win_ids,
         closed_by = p_user_id,
         closed_at = now()
   where id = p_round_id;

  if cardinality(win_ids) > 0 then
    perform public.election_award_seats(
      r.position_id,
      win_ids,
      case r.kind when 'initial' then 'outright' else r.kind end,
      p_round_id,
      p_user_id
    );
  end if;
  if cardinality(tied_ids) > 0 then
    perform public.election_mark_tied(r.position_id, tied_ids, p_round_id, p_user_id);
  end if;

  perform public.election_refresh_results(r.election_id);
end
$$;

-- Closes every open race at once.
create or replace function public.election_close_voting(p_election_id uuid, p_user_id uuid)
 returns void
 language plpgsql
 set search_path = ''
as $$
declare
  r record;
  closed_any boolean := false;
begin
  for r in
    select id from public.election_rounds
     where election_id = p_election_id and status = 'open'
     order by id
     for update
  loop
    perform public.election_close_round(r.id, p_user_id);
    closed_any := true;
  end loop;
  if not closed_any then raise exception 'ROUND_CLOSED'; end if;
end
$$;

-- Refills a position after a winner declines, from the runners-up of the round
-- that decided it. A tie for what's left marks the seat tied; nobody left
-- leaves the seat unfilled (vacant when it has no winners at all).
create or replace function public.election_reconcile_position(p_position_id uuid, p_user_id uuid)
 returns void
 language plpgsql
 set search_path = ''
as $$
declare
  res public.election_results%rowtype;
  total integer;
  winners uuid[];
  open_seats integer;
  top integer;
  leader_ids uuid[];
begin
  select * into res from public.election_results where position_id = p_position_id for update;
  if not found then raise exception 'RESULT_NOT_FOUND'; end if;

  select p.seats into total from public.election_positions p where p.id = p_position_id;

  select coalesce(array_agg(c.id), '{}') into winners
    from public.election_candidacies c
   where c.id = any (res.winner_candidacy_ids) and c.status = 'won';

  update public.election_results
     set winner_candidacy_ids = winners
   where position_id = p_position_id;

  -- A pending runoff already fills whatever is open.
  if res.status = 'tied' then return; end if;

  open_seats := total - cardinality(winners);

  while open_seats > 0 loop
    select max(t.online_count + t.paper_count) into top
      from public.election_tallies t
      join public.election_candidacies c on c.id::text = t.choice
     where t.round_id = res.source_round_id and c.status = 'lost';

    exit when top is null;

    select coalesce(array_agg(c.id), '{}') into leader_ids
      from public.election_tallies t
      join public.election_candidacies c on c.id::text = t.choice
     where t.round_id = res.source_round_id and c.status = 'lost'
       and t.online_count + t.paper_count = top;

    if cardinality(leader_ids) > open_seats then
      update public.election_candidacies set status = 'approved' where id = any (leader_ids);
      perform public.election_mark_tied(p_position_id, leader_ids, res.source_round_id, p_user_id);
      return;
    end if;

    perform public.election_award_seats(p_position_id, leader_ids, 'runner_up', res.source_round_id, p_user_id);
    open_seats := open_seats - cardinality(leader_ids);
  end loop;

  if not exists (
    select 1 from public.election_results
     where position_id = p_position_id and cardinality(winner_candidacy_ids) > 0
  ) then
    update public.election_results
       set status = 'vacant', resolution = 'runner_up', tied_candidacy_ids = '{}',
           decided_by = p_user_id, decided_at = now()
     where position_id = p_position_id;
  end if;
end
$$;

revoke execute on function
  public.election_cast_ballot(uuid, uuid, jsonb),
  public.election_award_seats(uuid, uuid[], text, uuid, uuid),
  public.election_start_voting(uuid, text, uuid),
  public.election_close_voting(uuid, uuid)
from public, anon, authenticated;

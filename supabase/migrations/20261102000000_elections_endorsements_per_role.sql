-- Elections: endorsements belong to one role, not the whole candidate.
--
-- A candidate running for two positions now has a separate profile for each,
-- with its own video (already per candidacy) and its own endorsements. Photos,
-- awards and the introduction stay shared on election_candidates.

alter table public.election_endorsements
  add column if not exists candidacy_id uuid references public.election_candidacies(id) on delete cascade;

alter table public.election_endorsements
  drop constraint if exists election_endorsements_candidate_id_author_user_id_key;

-- Now also checks that the candidacy is this candidate's.
create or replace function public.election_endorsements_guard()
 returns trigger
 language plpgsql
 set search_path = ''
as $$
begin
  if new.candidacy_id is not null and not exists (
    select 1 from public.election_candidacies c
     where c.id = new.candidacy_id and c.candidate_id = new.candidate_id
  ) then
    raise exception 'ENDORSEMENT_WRONG_CANDIDATE';
  end if;
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
  before insert or update of candidate_id, candidacy_id, author_user_id on public.election_endorsements
  for each row execute function public.election_endorsements_guard();

-- An existing endorsement was of the person, so it carries over to every role
-- they're on the ballot for, keeping its review status. Ones with no such role
-- were never shown to anyone and are dropped.
insert into public.election_endorsements
  (candidate_id, candidacy_id, author_user_id, kind, body, video_url, status,
   reviewed_by, reviewed_at, created_at, updated_at)
select e.candidate_id, c.id, e.author_user_id, e.kind, e.body, e.video_url, e.status,
       e.reviewed_by, e.reviewed_at, e.created_at, e.updated_at
  from public.election_endorsements e
  join public.election_candidacies c on c.candidate_id = e.candidate_id
 where e.candidacy_id is null
   and c.status in ('approved', 'won', 'lost', 'declined');

delete from public.election_endorsements where candidacy_id is null;

alter table public.election_endorsements
  alter column candidacy_id set not null;

alter table public.election_endorsements
  add constraint election_endorsements_candidacy_author_key unique (candidacy_id, author_user_id);

-- Applied to project ulensjpqjptqvghjtggv on 2026-10-03 as "delib_ballot_functions". Kept here for reference/local dev.
--
-- Casting and closing are serialized on the round row: a ballot takes a
-- FOR SHARE lock and requires the round to be open; closing takes FOR UPDATE,
-- stores the final totals, marks the round closed and deletes its ballots in
-- one transaction. So no ballot can land after the tally, and only totals
-- survive. Callable only with the secret key (the API checks admission).

create or replace function public.delib_cast_ballot(
  p_round_id uuid,
  p_user_id uuid,
  p_choice text
) returns void language plpgsql set search_path = '' as $$
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
$$;

create or replace function public.delib_close_round(p_round_id uuid)
returns void language plpgsql set search_path = '' as $$
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
$$;

revoke all on function public.delib_cast_ballot(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.delib_close_round(uuid) from public, anon, authenticated;
grant execute on function public.delib_cast_ballot(uuid, uuid, text) to service_role;
grant execute on function public.delib_close_round(uuid) to service_role;

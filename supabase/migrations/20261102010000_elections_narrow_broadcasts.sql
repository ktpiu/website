-- Elections: broadcast only the rare changes every voting screen shows.
--
-- One ballot writes one receipt per race and each join writes a participant
-- row, so these triggers made every open screen refetch throughout voting.
-- Only the manager panel shows those counts, and it now polls for them.

drop trigger if exists election_vote_receipts_broadcast on public.election_vote_receipts;
drop trigger if exists election_participants_broadcast on public.election_participants;

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
  else
    target := coalesce(new.election_id, old.election_id);
  end if;
  if target is not null then
    perform realtime.send('{}'::jsonb, 'changed', 'election:' || target::text, false);
  end if;
  return null;
end
$$;

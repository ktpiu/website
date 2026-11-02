-- Applied to project ulensjpqjptqvghjtggv on 2026-10-03 as "rush_system_revoke_client_grants". Kept here for reference/local dev.
--
-- Rush tables are only read and written by the API with the secret key. Drop
-- the default anon/authenticated grants so they are not even discoverable
-- through PostgREST/GraphQL. Signed-in members keep SELECT on the three
-- deliberation tables that realtime subscriptions read (still filtered by RLS).
-- delib_ballots is never readable by any client role.

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
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
  foreach t in array array['delib_sessions', 'delib_participants', 'delib_vote_rounds'] loop
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end
$$;

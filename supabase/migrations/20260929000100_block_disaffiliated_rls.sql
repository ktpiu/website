-- Applied to project ulensjpqjptqvghjtggv on 2026-09-29 as "block_disaffiliated_rls". Kept here for reference/local dev.
--
-- Disaffiliated members (users.is_disaffiliated) are blocked at the API in
-- lib/server-auth.ts; this makes the block hold for their Supabase token too.
-- A RESTRICTIVE policy is ANDed with every permissive policy, so an
-- authenticated request from a disaffiliated member matches no rows and can
-- write nothing on these tables. anon and service_role are unaffected.

create or replace function public.current_user_is_disaffiliated()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.users u
    where u.clerk_user_id = (select public.clerk_user_id())
      and u.is_disaffiliated
  )
$$;

revoke all on function public.current_user_is_disaffiliated() from public;
grant execute on function public.current_user_is_disaffiliated() to anon, authenticated, service_role;

do $$
declare
  t text;
begin
  foreach t in array array[
    'users', 'user_roles', 'roles', 'permissions', 'role_permissions', 'announcements'
  ] loop
    execute format('drop policy if exists "Disaffiliated members are blocked" on public.%I', t);
    execute format(
      'create policy "Disaffiliated members are blocked" on public.%I as restrictive for all to authenticated using (not (select public.current_user_is_disaffiliated())) with check (not (select public.current_user_is_disaffiliated()))',
      t
    );
  end loop;
end
$$;

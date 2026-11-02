-- Applied to project ulensjpqjptqvghjtggv on 2026-10-13 as "pledge_status". Kept here for reference/local dev.
--
-- Renames the post-bid account status from 'pnm' to 'pledge' ("PNM" means
-- someone rushing, not someone who accepted a bid), and the matching
-- permission users.pnm.activate -> users.activate.

alter table public.users drop constraint if exists users_account_status_check;
update public.users set account_status = 'pledge' where account_status = 'pnm';
alter table public.users
  add constraint users_account_status_check
  check (account_status in ('public', 'rushee', 'pledge', 'active', 'alumni', 'dropped', 'disaffiliated'));

create or replace function public.current_app_user_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select u.id
  from public.users u
  where u.clerk_user_id = (select auth.jwt() ->> 'sub')
    and u.account_status in ('pledge', 'active', 'alumni')
  limit 1
$$;

drop policy if exists "Members can read member profiles" on public.users;
create policy "Members can read member profiles"
  on public.users for select to authenticated
  using (
    (select public.current_app_user_id()) is not null
    and account_status in ('pledge', 'active', 'alumni', 'dropped', 'disaffiliated')
  );

drop policy if exists "Members can read role assignments" on public.user_roles;
create policy "Members can read role assignments"
  on public.user_roles for select to authenticated
  using (
    (select public.current_app_user_id()) is not null
    and exists (
      select 1 from public.users u
       where u.id = user_roles.user_id
         and u.account_status in ('pledge', 'active', 'alumni', 'dropped', 'disaffiliated')
    )
    or (select public.current_user_has_permission('admin.view'))
  );

update public.permissions
   set key = 'users.activate',
       description = 'Move pledges to active members'
 where key = 'users.pnm.activate';

update public.permissions
   set description = 'Register accounts for rush and move rushees to pledge; view rushee, pledge and public accounts in User Management'
 where key = 'users.rush.manage';

-- Applied to project ulensjpqjptqvghjtggv on 2026-10-13 as "account_status_users_rls"
-- (plus "finance_balances_view_server_only" for the view revoke at the end).
-- Kept here for reference/local dev.
--
-- Unified accounts, account-status RBAC, and RLS on member data.
--
-- 1. Every Clerk account now gets a public.users row ("public" by default);
--    rush candidates are users too. users.account_status is the lifecycle:
--      public -> rushee -> pnm -> active -> alumni | dropped | disaffiliated
--    Only pnm / active / alumni can use the member portal. public and rushee
--    accounts use the rush portal. Status changes go through the API only
--    (lib/account-status.ts), which checks a permission per transition.
-- 2. users.website_visibility replaces is_hidden: 'auto' follows the
--    members-page rules, 'shown' / 'hidden' are manual overrides.
--    is_alumni, is_disaffiliated and is_hidden stay as generated columns so
--    existing reads keep working.
-- 3. users and the RBAC tables are no longer world-readable. Anonymous
--    visitors get exactly what the public members / alumni / board sections
--    render through public.website_members(). Portal members can read member
--    profiles; public and rushee rows are visible only to admins (admin.view)
--    and to the server.
-- 4. Finance tables (RLS was off) become server-only; customers rows are
--    written by /api/stripe/customer/create.
-- 5. New permissions: users.rush.manage (register accounts for rush, move
--    rushees to PNM, rush view of User Management) and users.pnm.activate
--    (move PNMs to active).

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

alter table public.users
  add column if not exists account_status text not null default 'public'
    check (account_status in ('public', 'rushee', 'pnm', 'active', 'alumni', 'dropped', 'disaffiliated')),
  add column if not exists website_visibility text not null default 'auto'
    check (website_visibility in ('auto', 'shown', 'hidden'));

-- Every existing profile is a member (rush candidates lived in public.pnms).
update public.users
   set account_status = case
         when is_disaffiliated then 'disaffiliated'
         when is_alumni then 'alumni'
         else 'active'
       end,
       website_visibility = case when is_hidden then 'hidden' else 'auto' end;

alter table public.users alter column role set default 'newmember';

alter table public.users drop column is_alumni;
alter table public.users drop column is_disaffiliated;
alter table public.users drop column is_hidden;

alter table public.users
  add column is_alumni boolean generated always as (account_status = 'alumni') stored,
  add column is_disaffiliated boolean generated always as (account_status in ('dropped', 'disaffiliated')) stored,
  add column is_hidden boolean generated always as (website_visibility = 'hidden') stored;

create index if not exists users_account_status_idx on public.users (account_status);

-- ---------------------------------------------------------------------------
-- Rush records belong to an account
-- ---------------------------------------------------------------------------

-- Give every existing rush record an account row (linked on first sign-in by email).
insert into public.users (email, name, role, avatar, major, title, socials, account_status)
select p.email, p.name, 'newmember', '', coalesce(p.major, ''), '', '[]'::jsonb,
       case p.status when 'pledge' then 'pnm' when 'former' then 'public' else 'rushee' end
  from public.pnms p
 where p.linked_user_id is null
   and not exists (select 1 from public.users u where lower(u.email) = p.email);

update public.pnms p
   set linked_user_id = u.id
  from public.users u
 where p.linked_user_id is null
   and lower(u.email) = p.email;

create unique index if not exists pnms_linked_user_id_key
  on public.pnms (linked_user_id) where linked_user_id is not null;

-- ---------------------------------------------------------------------------
-- RLS helpers: only portal accounts count as "the current member"
-- ---------------------------------------------------------------------------

create or replace function public.current_app_user_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select u.id
  from public.users u
  where u.clerk_user_id = (select auth.jwt() ->> 'sub')
    and u.account_status in ('pnm', 'active', 'alumni')
  limit 1
$$;

-- ---------------------------------------------------------------------------
-- Protected columns
-- ---------------------------------------------------------------------------

create or replace function public.protect_users_privileged_columns()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select public.is_service_request()) then
    return new;
  end if;

  -- Lifecycle moves are permission-checked per transition by the API.
  if new.account_status is distinct from old.account_status then
    raise exception 'Account status can only be changed from User Management.'
      using errcode = '42501';
  end if;

  if (select public.current_user_has_permission('admin.users.edit')) then
    return new;
  end if;

  -- Members may only change their own name and profile picture.
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
$$;

-- ---------------------------------------------------------------------------
-- users policies
-- ---------------------------------------------------------------------------

revoke all on table public.users from anon;
revoke insert, truncate, references, trigger on table public.users from authenticated;

drop policy if exists "Profiles are publicly readable" on public.users;
drop policy if exists "Members can read member profiles" on public.users;
drop policy if exists "Admins can read every profile" on public.users;

create policy "Members can read member profiles"
  on public.users for select to authenticated
  using (
    (select public.current_app_user_id()) is not null
    and account_status in ('pnm', 'active', 'alumni', 'dropped', 'disaffiliated')
  );

create policy "Admins can read every profile"
  on public.users for select to authenticated
  using ((select public.current_user_has_permission('admin.view')));

-- ---------------------------------------------------------------------------
-- RBAC tables: portal members only
-- ---------------------------------------------------------------------------

revoke all on table public.roles, public.user_roles, public.permissions, public.role_permissions from anon;

drop policy if exists "Roles are publicly readable" on public.roles;
drop policy if exists "Members can read roles" on public.roles;
create policy "Members can read roles"
  on public.roles for select to authenticated
  using ((select public.current_app_user_id()) is not null);

drop policy if exists "User roles are publicly readable" on public.user_roles;
drop policy if exists "Members can read role assignments" on public.user_roles;
create policy "Members can read role assignments"
  on public.user_roles for select to authenticated
  using (
    (select public.current_app_user_id()) is not null
    and exists (
      select 1 from public.users u
       where u.id = user_roles.user_id
         and u.account_status in ('pnm', 'active', 'alumni', 'dropped', 'disaffiliated')
    )
    or (select public.current_user_has_permission('admin.view'))
  );

drop policy if exists "Permissions are publicly readable" on public.permissions;
drop policy if exists "Members can read permissions" on public.permissions;
create policy "Members can read permissions"
  on public.permissions for select to authenticated
  using ((select public.current_app_user_id()) is not null);

drop policy if exists "Role permissions are publicly readable" on public.role_permissions;
drop policy if exists "Members can read role permissions" on public.role_permissions;
create policy "Members can read role permissions"
  on public.role_permissions for select to authenticated
  using ((select public.current_app_user_id()) is not null);

-- ---------------------------------------------------------------------------
-- Public website: exactly what the members / alumni / board sections show
-- ---------------------------------------------------------------------------

-- Rows: active and alumni members who are on the members page (see
-- lib/members.ts isListedOnWebsite) or hold a board role. Columns: only
-- what those sections render. Roles are limited to the public role types.
create or replace function public.website_members()
returns table (
  id uuid,
  name text,
  avatar text,
  socials jsonb,
  major text,
  graduation_year integer,
  is_alumni boolean,
  roles jsonb,
  on_members_page boolean
) language sql stable security definer set search_path = '' as $$
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
    where u.account_status in ('active', 'alumni')
      and u.website_visibility <> 'hidden'
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
$$;

revoke all on function public.website_members() from public;
grant execute on function public.website_members() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Finance: server only
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'customers', 'finance_charges', 'finance_charge_targets', 'finance_obligations',
    'finance_payments', 'finance_payment_allocations'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable row level security', t);
      execute format('revoke all on table public.%I from anon, authenticated', t);
    end if;
  end loop;
end
$$;

-- Security-definer view over the finance tables; only the server reads it.
revoke all on table public.finance_obligation_balances from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

insert into public.permissions (key, description)
select v.key, v.description
  from (values
    ('users.rush.manage', 'Register accounts for rush and move rushees to PNM; view rushee, PNM and public accounts in User Management'),
    ('users.pnm.activate', 'Move PNMs to active members')
  ) as v(key, description)
 where not exists (select 1 from public.permissions p where p.key = v.key);

-- Whoever runs deliberation already decides bids.
insert into public.role_permissions (role_id, permission_id)
select distinct rp.role_id, p.id
  from public.role_permissions rp
  join public.permissions dp on dp.id = rp.permission_id and dp.key = 'rush.deliberation.manage'
  join public.permissions p on p.key = 'users.rush.manage'
 where not exists (
   select 1 from public.role_permissions x where x.role_id = rp.role_id and x.permission_id = p.id
 );

-- Pledge educators and VP of Membership.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
  from public.roles r
  join public.permissions p on p.key = 'users.pnm.activate'
 where r.name in ('VP of Membership', 'Director of New Member Education')
   and not exists (
     select 1 from public.role_permissions x where x.role_id = r.id and x.permission_id = p.id
   );

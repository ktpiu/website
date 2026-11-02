-- Applied to project ulensjpqjptqvghjtggv on 2026-10-13 as "pledge_class_initiation". Kept here for reference/local dev.
--
-- Pledge-class initiation gates member access.
--
-- roles.is_initiated (meaningful for pledge_class roles, toggled on the Roles
-- page): until a member's pledge class is initiated they can't use the member
-- portal and aren't on the public website. Pledges need an initiated pledge
-- class; actives and alumni lose access only while holding an uninitiated one.
-- Every pledge class that exists today is marked initiated so current members
-- keep their access.

alter table public.roles add column if not exists is_initiated boolean not null default false;
update public.roles set is_initiated = true where type = 'pledge_class';

-- The single rule for member-portal access and public listing.
create or replace function public.account_has_portal_access(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.users u
     where u.id = p_user_id
       and u.account_status in ('pledge', 'active', 'alumni')
       and not exists (
         select 1 from public.user_roles ur
           join public.roles r on r.id = ur.role_id
          where ur.user_id = u.id and r.type = 'pledge_class' and not r.is_initiated
       )
       and (
         u.account_status <> 'pledge'
         or exists (
           select 1 from public.user_roles ur
             join public.roles r on r.id = ur.role_id
            where ur.user_id = u.id and r.type = 'pledge_class' and r.is_initiated
         )
       )
  )
$$;

revoke all on function public.account_has_portal_access(uuid) from public, anon, authenticated;
grant execute on function public.account_has_portal_access(uuid) to service_role;

create or replace function public.current_app_user_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select u.id
  from public.users u
  where u.clerk_user_id = (select auth.jwt() ->> 'sub')
    and public.account_has_portal_access(u.id)
  limit 1
$$;

-- The server's per-request context now says whether the account may use the portal.
create or replace function public.app_user_context(p_clerk_user_id text)
returns jsonb language sql stable set search_path = '' as $$
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
$$;

revoke all on function public.app_user_context(text) from public, anon, authenticated;
grant execute on function public.app_user_context(text) to service_role;

-- Public website: only members with portal access (initiated), plus the
-- existing visibility rules. Pledges of an initiated class are listed too.
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
$$;

revoke all on function public.website_members() from public;
grant execute on function public.website_members() to anon, authenticated, service_role;

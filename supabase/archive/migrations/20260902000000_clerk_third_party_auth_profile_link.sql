-- Applied to project ulensjpqjptqvghjtggv on 2026-09-02 as
-- "clerk_third_party_auth_profile_link". Kept here for reference/local dev.
--
-- Links Clerk identities (Supabase third-party auth; JWT "sub" claim) to
-- public.users profiles and enables RLS on profiles keyed off that link.
-- Note: auth.uid() casts "sub" to uuid and does not work with Clerk tokens;
-- use public.current_app_user_id() in policies instead.

alter table public.users
  add column if not exists clerk_user_id text;

create unique index if not exists users_clerk_user_id_key
  on public.users (clerk_user_id)
  where clerk_user_id is not null;

create unique index if not exists users_email_lower_key
  on public.users (lower(email));

create or replace function public.clerk_user_id()
returns text language sql stable set search_path = '' as $$
  select auth.jwt() ->> 'sub'
$$;

create or replace function public.is_service_request()
returns boolean language sql stable set search_path = '' as $$
  select auth.jwt() is null or (auth.jwt() ->> 'role') = 'service_role'
$$;

create or replace function public.current_app_user_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select u.id
  from public.users u
  where u.clerk_user_id = (select auth.jwt() ->> 'sub')
  limit 1
$$;

create or replace function public.current_user_has_permission(permission_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.role_permissions rp on rp.role_id = ur.role_id
    join public.permissions p on p.id = rp.permission_id
    where ur.user_id = (select public.current_app_user_id())
      and p.key = permission_key
  )
$$;

revoke all on function public.clerk_user_id() from public;
revoke all on function public.is_service_request() from public;
revoke all on function public.current_app_user_id() from public;
revoke all on function public.current_user_has_permission(text) from public;
grant execute on function public.clerk_user_id() to anon, authenticated, service_role;
grant execute on function public.is_service_request() to anon, authenticated, service_role;
grant execute on function public.current_app_user_id() to anon, authenticated, service_role;
grant execute on function public.current_user_has_permission(text) to anon, authenticated, service_role;

create or replace function public.protect_users_privileged_columns()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select public.is_service_request()) then
    return new;
  end if;

  if (select public.current_user_has_permission('admin.users.edit')) then
    return new;
  end if;

  if new.role is distinct from old.role
     or new.email is distinct from old.email
     or new.clerk_user_id is distinct from old.clerk_user_id
     or new.locked is distinct from old.locked then
    raise exception 'You do not have permission to change protected profile fields.'
      using errcode = '42501';
  end if;

  return new;
end
$$;

drop trigger if exists protect_users_privileged_columns on public.users;
create trigger protect_users_privileged_columns
  before update on public.users
  for each row execute function public.protect_users_privileged_columns();

alter table public.users enable row level security;

drop policy if exists "Profiles are publicly readable" on public.users;
drop policy if exists "Members can update their own profile" on public.users;
drop policy if exists "User admins can update any profile" on public.users;
drop policy if exists "User admins can delete profiles" on public.users;

create policy "Profiles are publicly readable"
  on public.users for select to anon, authenticated using (true);

create policy "Members can update their own profile"
  on public.users for update to authenticated
  using (id = (select public.current_app_user_id()))
  with check (id = (select public.current_app_user_id()));

create policy "User admins can update any profile"
  on public.users for update to authenticated
  using ((select public.current_user_has_permission('admin.users.edit')))
  with check ((select public.current_user_has_permission('admin.users.edit')));

create policy "User admins can delete profiles"
  on public.users for delete to authenticated
  using ((select public.current_user_has_permission('admin.users.delete')));

-- Profile creation/linking is server-side (secret key); no insert policy for end users.

drop policy if exists "Members can post announcements" on public.announcements;
drop policy if exists "Authors and admins can update announcements" on public.announcements;

create policy "Members can post announcements"
  on public.announcements for insert to authenticated
  with check (author_id = (select public.current_app_user_id()));

create policy "Authors and admins can update announcements"
  on public.announcements for update to authenticated
  using (
    author_id = (select public.current_app_user_id())
    or (select public.current_user_has_permission('admin.view'))
  )
  with check (
    author_id = (select public.current_app_user_id())
    or (select public.current_user_has_permission('admin.view'))
  );

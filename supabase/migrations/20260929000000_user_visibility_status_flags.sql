-- Applied to project ulensjpqjptqvghjtggv on 2026-09-29 as "user_visibility_status_flags". Kept here for reference/local dev.
--
-- Adds admin-managed status flags to public.users:
--   is_hidden        hide the member from all public pages
--   is_inactive      temporarily inactive (e.g. study abroad); informational
--   is_disaffiliated dropped/disaffiliated: hidden publicly and blocked from the
--                    member portal (enforced in lib/server-auth.ts)
-- Only admins with admin.users.edit (or service requests) may change them.

alter table public.users
  add column if not exists is_hidden boolean not null default false,
  add column if not exists is_inactive boolean not null default false,
  add column if not exists is_disaffiliated boolean not null default false;

create or replace function public.protect_users_privileged_columns()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select public.is_service_request()) then
    return new;
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
     or new.is_alumni is distinct from old.is_alumni
     or new.is_hidden is distinct from old.is_hidden
     or new.is_inactive is distinct from old.is_inactive
     or new.is_disaffiliated is distinct from old.is_disaffiliated
     or new.created_at is distinct from old.created_at then
    raise exception 'You do not have permission to change protected profile fields.'
      using errcode = '42501';
  end if;

  return new;
end
$$;

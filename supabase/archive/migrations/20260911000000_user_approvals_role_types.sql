-- Applied to project ulensjpqjptqvghjtggv on 2026-09-11 as
-- "user_approvals_role_types". Kept here for reference/local dev.
--
-- 1. Adds "exec" and "director" role types and classifies the existing
--    executive-board / director roles. Backfills user_roles from users.title
--    so every current exec and director holds the matching role, and grants
--    admin.view to exec-type roles so admin-panel access (previously gated on
--    users.role = 'exec') is preserved once the app gates on the permission.
-- 2. Adds public.user_access_reviews, which records Clerk accounts an admin
--    has denied. New Clerk sign-ups no longer auto-create a profile; they wait
--    for an admin to approve (creating the profile) or deny.
-- 3. Tightens the profile-protection trigger so members without
--    admin.users.edit can only change their own name and avatar.

-- Role types -----------------------------------------------------------------

alter table public.roles drop constraint if exists roles_type_check;
alter table public.roles
  add constraint roles_type_check
  check (type in ('general', 'pledge_class', 'exec', 'director'));

update public.roles
  set type = 'exec'
  where type = 'general'
    and (name = 'President' or name like 'VP of %');

update public.roles
  set type = 'director'
  where type = 'general'
    and name like 'Director of %';

-- Give every current exec/director the role matching their legacy title.
insert into public.user_roles (user_id, role_id)
select u.id, r.id
from public.users u
join public.roles r
  on lower(r.name) = lower(trim(u.title))
 and r.type in ('exec', 'director')
where u.title is not null and trim(u.title) <> ''
on conflict do nothing;

-- Admin-panel visibility moves from users.role = 'exec' to admin.view.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.type = 'exec' and p.key = 'admin.view'
on conflict do nothing;

-- Access reviews ---------------------------------------------------------------

create table if not exists public.user_access_reviews (
  clerk_user_id text primary key,
  email text,
  name text,
  status text not null default 'denied' check (status in ('denied')),
  note text,
  reviewed_by uuid references public.users(id) on delete set null,
  reviewed_at timestamptz not null default now()
);

comment on table public.user_access_reviews is
  'Clerk accounts an admin has denied portal access. Approval creates a public.users row instead, so only denials are stored here. Server-only (secret key).';

alter table public.user_access_reviews enable row level security;
revoke all on table public.user_access_reviews from anon, authenticated;

-- Self-service profile edits -------------------------------------------------

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
     or new.created_at is distinct from old.created_at then
    raise exception 'You do not have permission to change protected profile fields.'
      using errcode = '42501';
  end if;

  return new;
end
$$;

-- Applied to project ulensjpqjptqvghjtggv on 2026-10-13 as "initiation_sets_status". Kept here for reference/local dev.
--
-- Initiating a pledge class now changes status instead of gating access.
--
-- Turning roles.is_initiated on (POST /api/admin/roles/[roleId]/initiation)
-- moves every pledge in that class to active; individuals can still be moved
-- either way by hand. So member-portal access and public listing follow
-- account_status alone: active and alumni. Pledges use the rush portal.
--
-- is_initiated can only be changed by the server, so the status change that
-- goes with it can't be skipped by writing the column from the browser.

create or replace function public.account_has_portal_access(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.users u
     where u.id = p_user_id
       and u.account_status in ('active', 'alumni')
  )
$$;

create or replace function public.protect_roles_initiation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select public.is_service_request()) then
    return new;
  end if;
  if (tg_op = 'INSERT' and new.is_initiated)
     or (tg_op = 'UPDATE' and new.is_initiated is distinct from old.is_initiated) then
    raise exception 'Initiate a pledge class from the Roles page.'
      using errcode = '42501';
  end if;
  return new;
end
$$;

revoke all on function public.protect_roles_initiation() from public, anon, authenticated;

drop trigger if exists protect_roles_initiation on public.roles;
create trigger protect_roles_initiation
  before insert or update on public.roles
  for each row execute function public.protect_roles_initiation();

-- Applied to project ulensjpqjptqvghjtggv on 2026-09-09 as "rbac_tables_rls".
-- Kept here for reference/local dev.
--
-- Locks down the RBAC tables (roles, user_roles, permissions, role_permissions).
--
-- Before this migration these tables had RLS disabled and anon/authenticated
-- held INSERT/UPDATE/DELETE/TRUNCATE grants, so anyone holding the public
-- Supabase key could grant themselves any role or permission.
--
-- Reads stay public: the public members page nests user_roles -> roles in an
-- anonymous select, and lib/permissions.ts resolves permission keys through
-- user_roles -> role_permissions -> permissions from the browser client.
--
-- Writes are gated on public.current_user_has_permission(...). That helper is
-- SECURITY DEFINER, so it can still read user_roles/role_permissions/permissions
-- after RLS is enabled. Policies use `(select ...)` so the check is evaluated
-- once per statement instead of once per row.
--
-- Server code using the secret key bypasses RLS and is unaffected.

-- Nobody but the owner/service role should be able to truncate these tables.
revoke truncate on table
  public.roles,
  public.user_roles,
  public.permissions,
  public.role_permissions
from anon, authenticated;

alter table public.roles enable row level security;
alter table public.user_roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;

-- roles ----------------------------------------------------------------------

drop policy if exists "Roles are publicly readable" on public.roles;
drop policy if exists "Role admins can insert roles" on public.roles;
drop policy if exists "Role admins can update roles" on public.roles;
drop policy if exists "Role admins can delete roles" on public.roles;

create policy "Roles are publicly readable"
  on public.roles for select to anon, authenticated using (true);

create policy "Role admins can insert roles"
  on public.roles for insert to authenticated
  with check ((select public.current_user_has_permission('admin.roles.edit')));

create policy "Role admins can update roles"
  on public.roles for update to authenticated
  using ((select public.current_user_has_permission('admin.roles.edit')))
  with check ((select public.current_user_has_permission('admin.roles.edit')));

create policy "Role admins can delete roles"
  on public.roles for delete to authenticated
  using ((select public.current_user_has_permission('admin.roles.edit')));

-- role_permissions -----------------------------------------------------------

drop policy if exists "Role permissions are publicly readable" on public.role_permissions;
drop policy if exists "Role admins can insert role permissions" on public.role_permissions;
drop policy if exists "Role admins can update role permissions" on public.role_permissions;
drop policy if exists "Role admins can delete role permissions" on public.role_permissions;

create policy "Role permissions are publicly readable"
  on public.role_permissions for select to anon, authenticated using (true);

create policy "Role admins can insert role permissions"
  on public.role_permissions for insert to authenticated
  with check ((select public.current_user_has_permission('admin.roles.edit')));

create policy "Role admins can update role permissions"
  on public.role_permissions for update to authenticated
  using ((select public.current_user_has_permission('admin.roles.edit')))
  with check ((select public.current_user_has_permission('admin.roles.edit')));

create policy "Role admins can delete role permissions"
  on public.role_permissions for delete to authenticated
  using ((select public.current_user_has_permission('admin.roles.edit')));

-- user_roles -----------------------------------------------------------------

drop policy if exists "User roles are publicly readable" on public.user_roles;
drop policy if exists "User admins can insert user roles" on public.user_roles;
drop policy if exists "User admins can update user roles" on public.user_roles;
drop policy if exists "User admins can delete user roles" on public.user_roles;

create policy "User roles are publicly readable"
  on public.user_roles for select to anon, authenticated using (true);

create policy "User admins can insert user roles"
  on public.user_roles for insert to authenticated
  with check ((select public.current_user_has_permission('admin.users.edit')));

create policy "User admins can update user roles"
  on public.user_roles for update to authenticated
  using ((select public.current_user_has_permission('admin.users.edit')))
  with check ((select public.current_user_has_permission('admin.users.edit')));

create policy "User admins can delete user roles"
  on public.user_roles for delete to authenticated
  using ((select public.current_user_has_permission('admin.users.edit')));

-- permissions ----------------------------------------------------------------

drop policy if exists "Permissions are publicly readable" on public.permissions;
drop policy if exists "Permission admins can insert permissions" on public.permissions;
drop policy if exists "Permission admins can update permissions" on public.permissions;
drop policy if exists "Permission admins can delete permissions" on public.permissions;

create policy "Permissions are publicly readable"
  on public.permissions for select to anon, authenticated using (true);

create policy "Permission admins can insert permissions"
  on public.permissions for insert to authenticated
  with check ((select public.current_user_has_permission('admin.permissions.edit')));

create policy "Permission admins can update permissions"
  on public.permissions for update to authenticated
  using ((select public.current_user_has_permission('admin.permissions.edit')))
  with check ((select public.current_user_has_permission('admin.permissions.edit')));

create policy "Permission admins can delete permissions"
  on public.permissions for delete to authenticated
  using ((select public.current_user_has_permission('admin.permissions.edit')));

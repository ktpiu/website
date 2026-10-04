-- Applied to project ulensjpqjptqvghjtggv on 2026-10-04 as "set_role_permissions_rpc". Kept here for reference/local dev.
--
-- Replaces a role's permission set in one transaction. The roles page used to
-- DELETE then INSERT as two requests, so a failed insert could leave a role
-- with no permissions, and an RLS-blocked delete "succeeded" silently.
-- SECURITY INVOKER keeps the role_permissions RLS policies in force; the
-- explicit check just turns a silent no-op delete into a clear error.

create or replace function public.set_role_permissions(p_role_id uuid, p_permission_ids uuid[])
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if not (select public.current_user_has_permission('admin.roles.edit')) then
    raise exception 'Editing role permissions requires admin.roles.edit'
      using errcode = '42501';
  end if;

  delete from public.role_permissions where role_id = p_role_id;

  insert into public.role_permissions (role_id, permission_id)
  select p_role_id, permission_id
    from unnest(coalesce(p_permission_ids, '{}')) as permission_id
  on conflict do nothing;
end
$$;

revoke all on function public.set_role_permissions(uuid, uuid[]) from public, anon;
grant execute on function public.set_role_permissions(uuid, uuid[]) to authenticated, service_role;

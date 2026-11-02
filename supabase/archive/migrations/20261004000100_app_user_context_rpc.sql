-- Applied to project ulensjpqjptqvghjtggv on 2026-10-04 as "app_user_context_rpc". Kept here for reference/local dev.
--
-- Resolves a Clerk user id to its linked profile plus permission keys in one
-- round trip. Used by requireAppAuthContext() on every API request, which
-- previously made 4-5 sequential queries plus a Clerk API call. Returns null
-- when the Clerk account is not linked yet (the slow path handles linking).
-- Callable only with the secret key.

create or replace function public.app_user_context(p_clerk_user_id text)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'user', to_jsonb(u),
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

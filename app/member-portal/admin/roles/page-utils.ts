import { DragEvent } from "react";
import { supabase } from "@/lib/supabase";
import {
  areSetsEqual,
  clonePermissionMap,
  compareRoles,
  getPermissionId,
  getPermissionKey,
  getPermissionSection,
  normalizeRole,
  withSequentialPriorities,
} from "@/lib/utils";
import {
  PermissionRecord,
  RolePermissionRow,
  RoleRecord,
} from "@/types";

export type RolesDataBundle = {
  roles: RoleRecord[];
  permissions: PermissionRecord[];
  permissionMap: Record<string, Set<string>>;
};

export function groupPermissionsBySection(permissions: PermissionRecord[]) {
  const grouped = new Map<string, PermissionRecord[]>();

  for (const permission of permissions) {
    const section = getPermissionSection(permission.key);
    const current = grouped.get(section) ?? [];
    current.push(permission);
    grouped.set(section, current);
  }

  return Array.from(grouped.entries())
    .map(
      ([section, items]) =>
        [
          section,
          [...items].sort((a, b) => a.key.localeCompare(b.key)),
        ] as const,
    )
    .sort(([a], [b]) => a.localeCompare(b));
}

export function mapPermissionIdByKey(permissions: PermissionRecord[]) {
  const map = new Map<string, string>();
  for (const permission of permissions) {
    if (permission.id) {
      map.set(permission.key, permission.id);
    }
  }
  return map;
}

export function resolveSelectedRoleId(
  roles: RoleRecord[],
  selectedRoleId: string | null,
) {
  if (roles.length === 0) return null;
  if (!selectedRoleId) return null;
  return roles.some((role) => role.id === selectedRoleId) ? selectedRoleId : null;
}

export function hasUnsavedRoleChanges(
  baseRoles: RoleRecord[],
  draftRoles: RoleRecord[],
  baseRolePermissions: Record<string, Set<string>>,
  draftRolePermissions: Record<string, Set<string>>,
) {
  const baseById = new Map(baseRoles.map((role) => [role.id, role]));
  const draftById = new Map(draftRoles.map((role) => [role.id, role]));

  if (baseById.size !== draftById.size) return true;

  for (const [roleId, draftRole] of draftById) {
    const baseRole = baseById.get(roleId);
    if (!baseRole) return true;
    if (
      baseRole.name !== draftRole.name ||
      baseRole.description !== draftRole.description ||
      baseRole.hidden !== draftRole.hidden ||
      baseRole.priority !== draftRole.priority ||
      baseRole.type !== draftRole.type
    ) {
      return true;
    }
  }

  const roleIds = new Set([
    ...Object.keys(baseRolePermissions),
    ...Object.keys(draftRolePermissions),
  ]);

  for (const roleId of roleIds) {
    const baseSet = baseRolePermissions[roleId] ?? new Set<string>();
    const draftSet = draftRolePermissions[roleId] ?? new Set<string>();
    if (!areSetsEqual(baseSet, draftSet)) return true;
  }

  return false;
}

export function installUnsavedNavigationGuard(onBlocked: () => void) {
  const handleBeforeUnload = (event: BeforeUnloadEvent) => {
    event.preventDefault();
    event.returnValue = "";
  };

  const handleDocumentClick = (event: MouseEvent) => {
    if (event.defaultPrevented) return;
    if (event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const target = event.target as HTMLElement | null;
    const anchor = target?.closest("a[href]") as HTMLAnchorElement | null;
    if (!anchor) return;
    if (anchor.target === "_blank" || anchor.hasAttribute("download")) return;

    const href = anchor.getAttribute("href");
    if (!href || href.startsWith("#")) return;

    const currentUrl = new URL(window.location.href);
    const nextUrl = new URL(anchor.href, window.location.href);
    const sameLocation =
      nextUrl.pathname === currentUrl.pathname &&
      nextUrl.search === currentUrl.search &&
      nextUrl.hash === currentUrl.hash;

    if (sameLocation) return;

    event.preventDefault();
    event.stopPropagation();
    onBlocked();
  };

  history.pushState({ unsavedGuard: true }, "", window.location.href);

  const handlePopState = () => {
    history.pushState({ unsavedGuard: true }, "", window.location.href);
    onBlocked();
  };

  window.addEventListener("beforeunload", handleBeforeUnload);
  window.addEventListener("popstate", handlePopState);
  document.addEventListener("click", handleDocumentClick, true);

  return () => {
    window.removeEventListener("beforeunload", handleBeforeUnload);
    window.removeEventListener("popstate", handlePopState);
    document.removeEventListener("click", handleDocumentClick, true);
  };
}

export async function fetchRolesData(): Promise<RolesDataBundle> {
  const [rolesRes, permissionsRes, rolePermissionsRes] = await Promise.all([
    supabase
      .from("roles")
      .select("id, name, description, hidden, priority, type")
      .order("priority", { ascending: false })
      .order("name", { ascending: true }),
    supabase.from("permissions").select("*").order("key", { ascending: true }),
    supabase.from("role_permissions").select("*"),
  ]);

  if (rolesRes.error) throw rolesRes.error;
  if (permissionsRes.error) throw permissionsRes.error;
  if (rolePermissionsRes.error) throw rolePermissionsRes.error;

  const roles = (rolesRes.data ?? [])
    .map((role) => normalizeRole(role))
    .sort(compareRoles);

  const permissions = (permissionsRes.data ?? [])
    .map((permission) => ({
      id: typeof permission.id === "string" ? permission.id : undefined,
      key:
        typeof permission.key === "string"
          ? permission.key
          : typeof permission.permission_key === "string"
            ? permission.permission_key
            : "",
      description:
        typeof permission.description === "string" ? permission.description : "",
    }))
    .filter((permission) => permission.key.length > 0);

  const permissionKeyById = new Map<string, string>();
  for (const permission of permissions) {
    if (permission.id) {
      permissionKeyById.set(permission.id, permission.key);
    }
  }

  const permissionMap: Record<string, Set<string>> = {};
  for (const role of roles) {
    permissionMap[role.id] = new Set();
  }

  for (const row of (rolePermissionsRes.data ?? []) as RolePermissionRow[]) {
    const roleId = row.role_id;
    const permissionKey =
      getPermissionKey(row) ??
      (() => {
        const permissionId = getPermissionId(row);
        if (!permissionId) return null;
        return permissionKeyById.get(permissionId) ?? null;
      })();

    if (!roleId || !permissionKey) continue;
    permissionMap[roleId] = permissionMap[roleId] ?? new Set();
    permissionMap[roleId].add(permissionKey);
  }

  return { roles, permissions, permissionMap };
}

export async function createRoleRecord(input: {
  name: string;
  description: string;
  hidden: boolean;
  type: RoleRecord["type"];
}) {
  const { data, error } = await supabase
    .from("roles")
    .insert({
      name: input.name,
      description: input.description,
      hidden: input.hidden,
      priority: 0,
      type: input.type,
    })
    .select("id, name, description, hidden, priority, type")
    .single();

  if (error) throw error;
  return normalizeRole(data);
}

export function applyRoleUpdates(
  roles: RoleRecord[],
  selectedRoleId: string,
  updates: Partial<RoleRecord>,
) {
  return roles
    .map((role) => (role.id === selectedRoleId ? { ...role, ...updates } : role))
    .sort(compareRoles);
}

export function reorderRolesLive(
  roles: RoleRecord[],
  sourceRoleId: string,
  targetRoleId: string,
  position: "before" | "after",
) {
  if (sourceRoleId === targetRoleId && position === "before") return roles;

  const sourceIndex = roles.findIndex((role) => role.id === sourceRoleId);
  const targetIndex = roles.findIndex((role) => role.id === targetRoleId);
  if (sourceIndex < 0 || targetIndex < 0) return roles;

  let insertIndex = targetIndex + (position === "after" ? 1 : 0);

  const next = [...roles];
  const [movedRole] = next.splice(sourceIndex, 1);

  if (sourceIndex < insertIndex) insertIndex -= 1;
  if (insertIndex < 0) insertIndex = 0;
  if (insertIndex > next.length) insertIndex = next.length;
  if (insertIndex === sourceIndex) return roles;

  next.splice(insertIndex, 0, movedRole);
  return withSequentialPriorities(next);
}

export function nextDropPosition(
  event: DragEvent<HTMLButtonElement>,
): "before" | "after" {
  const rect = (event.currentTarget as HTMLButtonElement).getBoundingClientRect();
  return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
}

export function togglePermissionForRole(
  permissionMap: Record<string, Set<string>>,
  roleId: string,
  permissionKey: string,
  checked: boolean,
) {
  const next = clonePermissionMap(permissionMap);
  const current = new Set(next[roleId] ?? []);
  if (checked) current.add(permissionKey);
  else current.delete(permissionKey);
  next[roleId] = current;
  return next;
}

export function toggleAllPermissionsForRole(
  permissionMap: Record<string, Set<string>>,
  roleId: string,
  permissions: PermissionRecord[],
  checked: boolean,
) {
  const next = clonePermissionMap(permissionMap);
  next[roleId] = checked
    ? new Set(permissions.map((permission) => permission.key))
    : new Set();
  return next;
}

export function toggleSectionPermissionsForRole(
  permissionMap: Record<string, Set<string>>,
  roleId: string,
  sectionPermissions: PermissionRecord[],
  checked: boolean,
) {
  const next = clonePermissionMap(permissionMap);
  const current = new Set(next[roleId] ?? []);

  for (const permission of sectionPermissions) {
    if (checked) current.add(permission.key);
    else current.delete(permission.key);
  }

  next[roleId] = current;
  return next;
}

export async function persistRoleDrafts(params: {
  baseRoles: RoleRecord[];
  draftRoles: RoleRecord[];
  baseRolePermissions: Record<string, Set<string>>;
  draftRolePermissions: Record<string, Set<string>>;
  permissionIdByKey: Map<string, string>;
}) {
  const {
    baseRoles,
    draftRoles,
    baseRolePermissions,
    draftRolePermissions,
    permissionIdByKey,
  } = params;

  const baseById = new Map(baseRoles.map((role) => [role.id, role]));

  for (const role of draftRoles) {
    const baseRole = baseById.get(role.id);
    if (!baseRole) continue;

    const changed =
      baseRole.name !== role.name ||
      baseRole.description !== role.description ||
      baseRole.hidden !== role.hidden ||
      baseRole.priority !== role.priority ||
      baseRole.type !== role.type;
    if (!changed) continue;

    const { error } = await supabase
      .from("roles")
      .update({
        name: role.name,
        description: role.description,
        hidden: role.hidden,
        priority: role.priority,
        type: role.type,
      })
      .eq("id", role.id);

    if (error) throw error;
  }

  const permissionSyncRoleIds = new Set([
    ...draftRoles.map((role) => role.id),
    ...Object.keys(baseRolePermissions),
  ]);

  for (const roleId of permissionSyncRoleIds) {
    const baseSet = baseRolePermissions[roleId] ?? new Set<string>();
    const draftSet = draftRolePermissions[roleId] ?? new Set<string>();
    if (areSetsEqual(baseSet, draftSet)) continue;

    const permissionIds = [...draftSet].map((permissionKey) => {
      const permissionId = permissionIdByKey.get(permissionKey);
      if (!permissionId) {
        throw new Error(`Unknown permission "${permissionKey}".`);
      }
      return permissionId;
    });

    // Delete + insert run in one transaction server-side, so a failure can't
    // leave the role with no permissions.
    const { error } = await supabase.rpc("set_role_permissions", {
      p_role_id: roleId,
      p_permission_ids: permissionIds,
    });
    if (error) throw error;
  }
}

export async function deleteRoleRecord(roleId: string) {
  const deleteJoinRes = await supabase
    .from("role_permissions")
    .delete()
    .eq("role_id", roleId);
  if (deleteJoinRes.error) throw deleteJoinRes.error;

  const deleteRoleRes = await supabase.from("roles").delete().eq("id", roleId);
  if (deleteRoleRes.error) throw deleteRoleRes.error;
}

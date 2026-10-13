import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const EMPTY_CREATE_FORM = {
  name: "",
  description: "",
  hidden: false,
  type: "general" as const,
}

type RoleLike = {
  name: string
  priority: number
}

type RolePermissionRowLike = {
  permission_id?: string | null
  permission_key?: string | null
  permission?: string | null
  key?: string | null
}

export function compareRoles<T extends RoleLike>(a: T, b: T) {
  if (a.priority !== b.priority) return b.priority - a.priority
  return a.name.localeCompare(b.name)
}

export function clonePermissionMap(input: Record<string, Set<string>>) {
  return Object.fromEntries(
    Object.entries(input).map(([roleId, permissions]) => [
      roleId,
      new Set(permissions),
    ])
  )
}

export function areSetsEqual(a: Set<string>, b: Set<string>) {
  if (a.size !== b.size) return false
  for (const value of a) {
    if (!b.has(value)) return false
  }
  return true
}

export function getPermissionSection(permissionKey: string) {
  const [section] = permissionKey.split(".")
  return section || "general"
}

export function getPermissionKey(row: RolePermissionRowLike) {
  if (typeof row.permission_key === "string") return row.permission_key
  if (typeof row.permission === "string") return row.permission
  if (typeof row.key === "string") return row.key
  return null
}

export function getPermissionId(row: RolePermissionRowLike) {
  if (typeof row.permission_id === "string") return row.permission_id
  return null
}

const ROLE_TYPES = ["general", "pledge_class", "exec", "director"] as const
export type NormalizedRoleType = (typeof ROLE_TYPES)[number]

export function normalizeRoleType(type: unknown): NormalizedRoleType {
  return (ROLE_TYPES as readonly string[]).includes(type as string)
    ? (type as NormalizedRoleType)
    : "general"
}

export function normalizeRole(
  role: Partial<{
    id: string
    name: string
    description: string
    hidden: boolean
    priority: number
    type: string
    is_initiated: boolean
  }>
) {
  return {
    id: role.id ?? "",
    name: role.name ?? "",
    description: role.description ?? "",
    hidden: Boolean(role.hidden),
    priority: Number(role.priority ?? 0),
    type: normalizeRoleType(role.type),
    is_initiated: Boolean(role.is_initiated),
  }
}

export function withSequentialPriorities<T extends { priority: number }>(
  roles: T[]
) {
  const total = roles.length
  return roles.map((role, index) => ({
    ...role,
    priority: total - index - 1,
  }))
}

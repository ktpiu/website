import { supabase } from "@/lib/supabase";
import type { Role, User } from "@/lib/supabase";
import { isProfileIncomplete } from "@/lib/profile-completeness";

/**
 * Member classification helpers built on the roles system.
 *
 * - Grade is derived from users.graduation_year relative to the current
 *   academic year. The academic year rolls over on June 1, so a member
 *   graduating in 2027 is a Senior from June 2026 through May 2027.
 * - Pledge class comes from a role whose type is "pledge_class".
 * - Alumni are flagged manually via users.is_alumni.
 */

const ACADEMIC_YEAR_ROLLOVER_MONTH = 5; // June (0-indexed)

export type PublicMemberRole = Pick<Role, "id" | "name" | "type" | "priority">;

export type PublicMember = Pick<
  User,
  | "id"
  | "name"
  | "avatar"
  | "socials"
  | "major"
  | "graduation_year"
  | "is_alumni"
> & {
  roles: PublicMemberRole[];
};

/** The calendar year in which the current academic year ends. */
export function getAcademicYearEnd(now: Date = new Date()) {
  const year = now.getFullYear();
  return now.getMonth() >= ACADEMIC_YEAR_ROLLOVER_MONTH ? year + 1 : year;
}

export function getGradeLabel(
  graduationYear: number | null | undefined,
  isAlumni: boolean,
  now: Date = new Date(),
): string | null {
  if (isAlumni) return "Alumni";
  if (typeof graduationYear !== "number" || Number.isNaN(graduationYear)) {
    return null;
  }

  const yearsRemaining = graduationYear - getAcademicYearEnd(now);
  switch (yearsRemaining) {
    case 0:
      return "Senior";
    case 1:
      return "Junior";
    case 2:
      return "Sophomore";
    case 3:
      return "Freshman";
    default:
      return `Class of ${graduationYear}`;
  }
}

export function getPledgeClassRole<T extends { type: Role["type"]; priority: number }>(
  roles: T[],
): T | null {
  const pledgeClasses = roles
    .filter((role) => role.type === "pledge_class")
    .sort((a, b) => b.priority - a.priority);
  return pledgeClasses[0] ?? null;
}

type UserWithRolesRow = Omit<PublicMember, "roles"> & {
  user_roles:
    | Array<{ roles: PublicMemberRole | PublicMemberRole[] | null }>
    | null;
};

function flattenRoles(row: UserWithRolesRow): PublicMemberRole[] {
  const roles: PublicMemberRole[] = [];
  for (const entry of row.user_roles ?? []) {
    const joined = entry.roles;
    if (!joined) continue;
    const list = Array.isArray(joined) ? joined : [joined];
    for (const role of list) {
      if (role && typeof role.id === "string") roles.push(role);
    }
  }
  return roles;
}

/**
 * Loads every profile that holds a pledge-class role, with its roles attached.
 * Works for anonymous visitors: profiles are publicly readable and the roles
 * tables have no row-level restrictions.
 */
export async function fetchPublicMembers(): Promise<PublicMember[]> {
  const { data, error } = await supabase
    .from("users")
    .select(
      "id, name, avatar, socials, major, graduation_year, is_alumni, user_roles(roles(id, name, type, priority))",
    )
    .eq("is_hidden", false)
    .eq("is_disaffiliated", false)
    .order("name", { ascending: true });

  if (error) throw error;

  return ((data ?? []) as unknown as UserWithRolesRow[])
    .map((row) => ({
      id: row.id,
      name: row.name,
      avatar: row.avatar,
      socials: row.socials,
      major: row.major,
      graduation_year: row.graduation_year,
      is_alumni: row.is_alumni,
      roles: flattenRoles(row),
    }))
    .filter((member) => getPledgeClassRole(member.roles) !== null)
    .filter((member) => !isProfileIncomplete(member, member.roles));
}

export type BoardMember = PublicMember & { position: PublicMemberRole };

type BoardMemberRow = UserWithRolesRow & { title: string | null };

/**
 * Loads every member holding at least one role of the given board type.
 * `position` is the member's highest-priority role of that type, so someone
 * holding two exec roles appears once. Sorted by position priority (desc),
 * then by name. Publicly readable, like fetchPublicMembers.
 */
export async function fetchBoardMembers(
  type: "exec" | "director",
): Promise<BoardMember[]> {
  const { data, error } = await supabase
    .from("users")
    .select(
      "id, name, avatar, socials, major, graduation_year, is_alumni, title, user_roles(roles(id, name, type, priority))",
    )
    .eq("is_hidden", false)
    .eq("is_disaffiliated", false)
    .order("name", { ascending: true });

  if (error) throw error;

  const members: BoardMember[] = [];
  for (const row of (data ?? []) as unknown as BoardMemberRow[]) {
    const roles = flattenRoles(row);
    const position = roles
      .filter((role) => role.type === type)
      .sort((a, b) => b.priority - a.priority)[0];
    if (!position) continue;

    members.push({
      id: row.id,
      name: row.name,
      avatar: row.avatar,
      socials: row.socials,
      major: row.major,
      graduation_year: row.graduation_year,
      is_alumni: row.is_alumni,
      roles,
      position,
    });
  }

  return members.sort(
    (a, b) =>
      b.position.priority - a.position.priority ||
      a.name.localeCompare(b.name),
  );
}

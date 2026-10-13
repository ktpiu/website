import { supabase } from "@/lib/supabase";
import type { Role, User } from "@/lib/supabase";
import { isProfileIncomplete } from "@/lib/profile-completeness";
import { hasPortalAccess } from "@/lib/account-status";

/**
 * Member classification helpers built on the roles system.
 *
 * - Grade is derived from users.graduation_year relative to the current
 *   academic year. The academic year rolls over on June 1, so a member
 *   graduating in 2027 is a Senior from June 2026 through May 2027.
 * - Pledge class comes from a role whose type is "pledge_class".
 * - Alumni are users with account_status "alumni" (users.is_alumni).
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

type WebsiteMemberRow = Omit<PublicMember, "roles"> & {
  roles: PublicMemberRole[] | null;
  on_members_page: boolean;
};

/**
 * Whether a member appears on the public members / alumni pages. Mirrors
 * public.website_members() in the database, which is what anonymous visitors
 * actually read: active or alumni, not hidden, and
 * either forced "shown" or holding a pledge class with a complete profile.
 */
export function isListedOnWebsite(
  user: Pick<User, "account_status" | "website_visibility" | "avatar" | "major">,
  roles: Array<{ type: Role["type"] }>,
) {
  if (!hasPortalAccess(user.account_status)) return false;
  if (user.website_visibility === "hidden") return false;
  if (user.website_visibility === "shown") return true;
  // A complete profile includes a pledge-class role.
  return !isProfileIncomplete(user, roles);
}

/**
 * Everyone the public website may show, through public.website_members():
 * only the columns these pages render, only members who are listed or hold a
 * board role. Works for anonymous visitors; public.users itself is not
 * publicly readable.
 */
async function fetchWebsiteMembers(): Promise<WebsiteMemberRow[]> {
  const { data, error } = await supabase.rpc("website_members");
  if (error) throw error;
  return (data ?? []) as WebsiteMemberRow[];
}

function toPublicMember(row: WebsiteMemberRow): PublicMember {
  return {
    id: row.id,
    name: row.name,
    avatar: row.avatar,
    socials: row.socials,
    major: row.major,
    graduation_year: row.graduation_year,
    is_alumni: row.is_alumni,
    roles: row.roles ?? [],
  };
}

/** Members on the public members / alumni pages, with their public roles. */
export async function fetchPublicMembers(): Promise<PublicMember[]> {
  const rows = await fetchWebsiteMembers();
  return rows
    .filter((row) => row.on_members_page)
    .map((row) => toPublicMember(row));
}

export type BoardMember = PublicMember & { position: PublicMemberRole };

/**
 * Loads every member holding at least one role of the given board type.
 * `position` is the member's highest-priority role of that type, so someone
 * holding two exec roles appears once. Sorted by position priority (desc),
 * then by name. Publicly readable, like fetchPublicMembers.
 */
export async function fetchBoardMembers(
  type: "exec" | "director",
): Promise<BoardMember[]> {
  const rows = await fetchWebsiteMembers();

  const members: BoardMember[] = [];
  for (const row of rows) {
    const member = toPublicMember(row);
    const position = member.roles
      .filter((role) => role.type === type)
      .sort((a, b) => b.priority - a.priority)[0];
    if (!position) continue;
    members.push({ ...member, position });
  }

  return members.sort(
    (a, b) =>
      b.position.priority - a.position.priority ||
      a.name.localeCompare(b.name),
  );
}

import { supabase, RoleType, User as SupabaseUser } from "@/lib/supabase";
import { getGradeLabel } from "@/lib/members";
import { isProfileIncomplete } from "@/lib/profile-completeness";

export type EditableFields = Pick<
  SupabaseUser,
  | "name"
  | "email"
  | "major"
  | "avatar"
  | "socials"
  | "graduation_year"
  | "is_alumni"
  | "is_hidden"
  | "is_inactive"
  | "is_disaffiliated"
>;

export type SocialPlatform = "insta" | "linkedin";

export type SocialEntry = {
  platform: SocialPlatform;
  url: string;
};

/** Admin-managed boolean flags edited from the dialog's status switches. */
export const STATUS_FLAGS = [
  {
    key: "isHidden",
    column: "is_hidden",
    label: "Hidden",
    description: "Hides this member from all public pages.",
  },
  {
    key: "isInactive",
    column: "is_inactive",
    label: "Temporarily inactive",
    description: "For members away for a while (e.g. studying abroad).",
  },
  {
    key: "isDisaffiliated",
    column: "is_disaffiliated",
    label: "Disaffiliated / dropped",
    description:
      "Hides this member from public pages and blocks them from the member portal.",
  },
  {
    key: "isAlumni",
    column: "is_alumni",
    label: "Alumni",
    description: "Lists this member under Alumni on the public members page.",
  },
] as const;

export type StatusFlagKey = (typeof STATUS_FLAGS)[number]["key"];
export type StatusFlagColumn = (typeof STATUS_FLAGS)[number]["column"];

export type EditState = Partial<
  Omit<EditableFields, "graduation_year" | StatusFlagColumn>
> & {
  linkedinUrl?: string;
  instagramUrl?: string;
  /** Raw text from the input; parsed to a number (or null) on save. */
  graduationYear?: string;
} & Partial<Record<StatusFlagKey, boolean>>;

export type RoleOption = {
  id: string;
  name: string;
  priority: number;
  type: RoleType;
};

export const GRADE_FILTER_OPTIONS = [
  "Freshman",
  "Sophomore",
  "Junior",
  "Senior",
  "Alumni",
  "No year",
] as const;

export type GradeFilter = (typeof GRADE_FILTER_OPTIONS)[number];

export type UserFilters = {
  /** Case-insensitive match against name, email, and major. */
  search: string;
  /** Any of these role ids (OR). Empty means no role filter. */
  roleIds: string[];
  /** Any of these pledge-class role ids (OR). Empty means no filter. */
  pledgeClassRoleIds: string[];
  /** Any of these grade labels (OR). Empty means no filter. */
  grades: GradeFilter[];
  /** Grade buckets to leave out (NOT). Applied after `grades`. */
  excludeGrades: GradeFilter[];
  /**
   * Status criteria. "include" keeps only members matching the status,
   * "exclude" drops them (e.g. alumni: "exclude" = not alumni).
   */
  statuses: Partial<Record<StatusFilterKey, StatusFilterMode>>;
};

export type StatusFilterMode = "include" | "exclude";

export const STATUS_FILTER_OPTIONS = [
  { key: "hidden", label: "Hidden from public" },
  { key: "inactive", label: "Temporarily inactive" },
  { key: "disaffiliated", label: "Disaffiliated / dropped" },
  { key: "alumni", label: "Alumni" },
  { key: "incompleteProfile", label: "Incomplete profile" },
  { key: "notLinked", label: "Not linked to a sign-in" },
  { key: "noRoles", label: "No roles" },
] as const;

export type StatusFilterKey = (typeof STATUS_FILTER_OPTIONS)[number]["key"];

export const EMPTY_USER_FILTERS: UserFilters = {
  search: "",
  roleIds: [],
  pledgeClassRoleIds: [],
  grades: [],
  excludeGrades: [],
  statuses: {},
};

export type SortKey =
  | "name"
  | "email"
  | "major"
  | "graduation_year"
  | "created_at";

type UserRoleJoinRow = {
  user_id: string | null;
  role_id: string | null;
  roles?:
    | { id?: string | null; name?: string | null }
    | Array<{ id?: string | null; name?: string | null }>
    | null;
};

type LoadUsersDataResult = {
  users: SupabaseUser[];
  roles: RoleOption[];
  userRoleIds: Record<string, string[]>;
};

export const userTableColumns: Array<{
  label: string;
  sortKey?: SortKey;
}> = [
  { label: "User", sortKey: "name" },
  { label: "Roles", sortKey: undefined },
  { label: "Major", sortKey: "major" },
  { label: "Year", sortKey: "graduation_year" },
  { label: "Created", sortKey: "created_at" },
  { label: "", sortKey: undefined },
];

const ROLE_TYPES: RoleType[] = ["general", "pledge_class", "exec", "director"];

function isRoleType(value: unknown): value is RoleType {
  return typeof value === "string" && (ROLE_TYPES as string[]).includes(value);
}

export async function loadUsersData(): Promise<LoadUsersDataResult> {
  const [usersRes, rolesRes, userRolesRes] = await Promise.all([
    supabase.from("users").select("*").order("name", { ascending: true }),
    supabase
      .from("roles")
      .select("id, name, priority, type")
      .order("priority", { ascending: false })
      .order("name", { ascending: true }),
    supabase.from("user_roles").select("user_id, role_id, roles(id, name)"),
  ]);

  if (usersRes.error) throw usersRes.error;
  if (rolesRes.error) throw rolesRes.error;
  if (userRolesRes.error) throw userRolesRes.error;

  const roles = (rolesRes.data ?? []).flatMap((role) => {
    if (typeof role.id !== "string" || typeof role.name !== "string") {
      return [];
    }

    return [
      {
        id: role.id,
        name: role.name,
        priority: typeof role.priority === "number" ? role.priority : 0,
        type: isRoleType(role.type) ? role.type : "general",
      },
    ];
  });

  const userRoleIds: Record<string, string[]> = {};
  for (const row of (userRolesRes.data ?? []) as UserRoleJoinRow[]) {
    const userId = row.user_id;
    const joinedRole = Array.isArray(row.roles) ? row.roles[0] : row.roles;
    const roleId =
      row.role_id ??
      (joinedRole && typeof joinedRole.id === "string" ? joinedRole.id : null);

    if (!userId || !roleId) continue;
    userRoleIds[userId] = userRoleIds[userId] ?? [];
    if (!userRoleIds[userId].includes(roleId)) {
      userRoleIds[userId].push(roleId);
    }
  }

  return {
    users: usersRes.data ?? [],
    roles,
    userRoleIds,
  };
}

export function getEditableValue(
  currentUser: SupabaseUser,
  editState: Record<string, EditState>,
  field: Exclude<keyof EditState, StatusFlagKey>,
) {
  const override = editState[currentUser.id]?.[field];
  if (typeof override === "string") return override;
  if (field === "graduationYear") {
    return typeof currentUser.graduation_year === "number"
      ? String(currentUser.graduation_year)
      : "";
  }
  const value = currentUser[field as keyof SupabaseUser];
  return value ? String(value) : "";
}

export function getEditableFlags(
  currentUser: SupabaseUser,
  editState: Record<string, EditState>,
): Record<StatusFlagKey, boolean> {
  const flags = {} as Record<StatusFlagKey, boolean>;
  for (const { key, column } of STATUS_FLAGS) {
    const override = editState[currentUser.id]?.[key];
    flags[key] = typeof override === "boolean" ? override : Boolean(currentUser[column]);
  }
  return flags;
}

/**
 * Parses the graduation-year input. Returns undefined when untouched, null when
 * cleared, or the parsed year. Throws on non-numeric or out-of-range input.
 */
export function parseGraduationYearInput(
  value: string | undefined,
): number | null | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 2000 || parsed > 2100) {
    throw new Error("Graduation year must be a four-digit year.");
  }
  return parsed;
}

export function getSocialUrl(
  currentUser: Pick<SupabaseUser, "socials">,
  platform: SocialPlatform,
) {
  const socials = currentUser.socials as unknown;
  let entries: SocialEntry[] = [];

  const fromRecord = (record: Record<string, unknown>) => {
    const linkedin = typeof record.linkedin === "string" ? record.linkedin : "";
    const insta =
      typeof record.insta === "string"
        ? record.insta
        : typeof record.instagram === "string"
          ? record.instagram
          : "";
    entries = [
      ...(linkedin ? [{ platform: "linkedin" as const, url: linkedin }] : []),
      ...(insta ? [{ platform: "insta" as const, url: insta }] : []),
    ];
  };

  if (Array.isArray(socials)) {
    entries = socials
      .filter(
        (item): item is { platform: SocialPlatform; url: string } =>
          Boolean(item) &&
          typeof item === "object" &&
          "platform" in item &&
          "url" in item &&
          ((item as { platform?: string }).platform === "insta" ||
            (item as { platform?: string }).platform === "linkedin") &&
          typeof (item as { url?: unknown }).url === "string",
      )
      .map((item) => ({ platform: item.platform, url: item.url }));
  } else if (socials && typeof socials === "object") {
    const record = socials as Record<string, unknown>;
    if (typeof record.platform === "string" && typeof record.url === "string") {
      const normalizedPlatform =
        record.platform === "instagram" ? "insta" : record.platform;
      if (normalizedPlatform === "insta" || normalizedPlatform === "linkedin") {
        entries = [{ platform: normalizedPlatform, url: record.url }];
      }
    } else {
      fromRecord(record);
    }
  } else if (typeof socials === "string") {
    try {
      const parsed = JSON.parse(socials) as unknown;
      if (Array.isArray(parsed)) {
        entries = parsed
          .filter(
            (item): item is { platform: SocialPlatform; url: string } =>
              Boolean(item) &&
              typeof item === "object" &&
              "platform" in item &&
              "url" in item &&
              ((item as { platform?: string }).platform === "insta" ||
                (item as { platform?: string }).platform === "linkedin") &&
              typeof (item as { url?: unknown }).url === "string",
          )
          .map((item) => ({ platform: item.platform, url: item.url }));
      } else if (parsed && typeof parsed === "object") {
        fromRecord(parsed as Record<string, unknown>);
      }
    } catch {
      entries = [];
    }
  }

  return entries.find((entry) => entry.platform === platform)?.url ?? "";
}

export function getRoleNameMap(roles: RoleOption[]) {
  return new Map(roles.map((role) => [role.id, role.name]));
}

export function sortRoles(roles: RoleOption[]) {
  return [...roles].sort(
    (a, b) => b.priority - a.priority || a.name.localeCompare(b.name),
  );
}

export function sortUsers(
  users: SupabaseUser[],
  sortKey: SortKey,
  sortDirection: "asc" | "desc",
) {
  return [...users].sort((a, b) => {
    const key = sortKey;
    const aValue = a[key] ?? "";
    const bValue = b[key] ?? "";

    if (key === "created_at") {
      const aDate = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bDate = b.created_at ? new Date(b.created_at).getTime() : 0;
      return sortDirection === "asc" ? aDate - bDate : bDate - aDate;
    }

    if (key === "graduation_year") {
      const aYear = a.graduation_year ?? Number.POSITIVE_INFINITY;
      const bYear = b.graduation_year ?? Number.POSITIVE_INFINITY;
      return sortDirection === "asc" ? aYear - bYear : bYear - aYear;
    }

    const aText = String(aValue).toLowerCase();
    const bText = String(bValue).toLowerCase();
    if (aText < bText) return sortDirection === "asc" ? -1 : 1;
    if (aText > bText) return sortDirection === "asc" ? 1 : -1;
    return 0;
  });
}

/** Maps a member to one of the grade filter buckets. */
export function getGradeFilterBucket(
  user: Pick<SupabaseUser, "graduation_year" | "is_alumni">,
  now: Date = new Date(),
): GradeFilter {
  const label = getGradeLabel(user.graduation_year, user.is_alumni, now);
  if (label === null) return "No year";
  if ((GRADE_FILTER_OPTIONS as readonly string[]).includes(label)) {
    return label as GradeFilter;
  }
  // "Class of XXXX" (outside the four undergraduate years) has no bucket of
  // its own; treat far-future/past years as having a year but no grade.
  return "No year";
}

export function getUserRoles(
  userId: string,
  userRoleIds: Record<string, string[]>,
  rolesById: Map<string, RoleOption>,
): RoleOption[] {
  return (userRoleIds[userId] ?? []).flatMap((roleId) => {
    const role = rolesById.get(roleId);
    return role ? [role] : [];
  });
}

export function hasActiveUserFilters(filters: UserFilters) {
  return (
    filters.search.trim() !== "" ||
    filters.roleIds.length > 0 ||
    filters.pledgeClassRoleIds.length > 0 ||
    filters.grades.length > 0 ||
    filters.excludeGrades.length > 0 ||
    Object.values(filters.statuses).some(Boolean)
  );
}

function matchesStatus(
  key: StatusFilterKey,
  user: SupabaseUser,
  ownRoleIds: string[],
  ownRoles: RoleOption[],
): boolean {
  switch (key) {
    case "hidden":
      return Boolean(user.is_hidden);
    case "inactive":
      return Boolean(user.is_inactive);
    case "disaffiliated":
      return Boolean(user.is_disaffiliated);
    case "alumni":
      return Boolean(user.is_alumni);
    case "incompleteProfile":
      return isProfileIncomplete(user, ownRoles);
    case "notLinked":
      return !user.clerk_user_id;
    case "noRoles":
      return ownRoleIds.length === 0;
  }
}

/**
 * Pure filter over the loaded member list. All active criteria must match
 * (AND across criteria); multi-select criteria match any selected value.
 */
export function filterUsers(
  users: SupabaseUser[],
  userRoleIds: Record<string, string[]>,
  roles: RoleOption[],
  filters: UserFilters,
  now: Date = new Date(),
): SupabaseUser[] {
  const rolesById = new Map(roles.map((role) => [role.id, role]));
  const search = filters.search.trim().toLowerCase();
  const roleIdSet = new Set(filters.roleIds);
  const pledgeClassIdSet = new Set(filters.pledgeClassRoleIds);
  const gradeSet = new Set<GradeFilter>(filters.grades);
  const excludeGradeSet = new Set<GradeFilter>(filters.excludeGrades);
  const statusEntries = Object.entries(filters.statuses).filter(
    (entry): entry is [StatusFilterKey, StatusFilterMode] => Boolean(entry[1]),
  );

  return users.filter((user) => {
    const ownRoleIds = userRoleIds[user.id] ?? [];
    const ownRoles = getUserRoles(user.id, userRoleIds, rolesById);

    if (search) {
      const haystack = [user.name, user.email, user.major]
        .filter((value): value is string => typeof value === "string")
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(search)) return false;
    }

    if (roleIdSet.size > 0 && !ownRoleIds.some((id) => roleIdSet.has(id))) {
      return false;
    }

    if (
      pledgeClassIdSet.size > 0 &&
      !ownRoleIds.some((id) => pledgeClassIdSet.has(id))
    ) {
      return false;
    }

    if (gradeSet.size > 0 && !gradeSet.has(getGradeFilterBucket(user, now))) {
      return false;
    }

    if (
      excludeGradeSet.size > 0 &&
      excludeGradeSet.has(getGradeFilterBucket(user, now))
    ) {
      return false;
    }

    for (const [key, mode] of statusEntries) {
      const matches = matchesStatus(key, user, ownRoleIds, ownRoles);
      if (mode === "include" ? !matches : matches) return false;
    }

    return true;
  });
}

export function toggleRoleIds(
  currentRoleIds: string[],
  roleId: string,
  checked: boolean,
) {
  return checked
    ? Array.from(new Set([...currentRoleIds, roleId]))
    : currentRoleIds.filter((id) => id !== roleId);
}

export function getRoleDiff(currentRoleIds: string[], nextRoleIds: string[]) {
  const currentRoleIdSet = new Set(currentRoleIds);
  const nextRoleIdSet = new Set(nextRoleIds);

  const roleIdsToInsert = nextRoleIds.filter(
    (roleId) => !currentRoleIdSet.has(roleId),
  );
  const roleIdsToDelete = Array.from(currentRoleIdSet).filter(
    (roleId) => !nextRoleIdSet.has(roleId),
  );

  return {
    roleIdsToInsert,
    roleIdsToDelete,
    rolesChanged: roleIdsToInsert.length > 0 || roleIdsToDelete.length > 0,
  };
}

export function buildSocialsUpdate(
  currentUser: SupabaseUser,
  nextState: EditState,
): EditableFields["socials"] | undefined {
  const socialsWereEdited =
    nextState.linkedinUrl !== undefined || nextState.instagramUrl !== undefined;
  if (!socialsWereEdited) return undefined;

  const linkedinUrl = (
    nextState.linkedinUrl ?? getSocialUrl(currentUser, "linkedin")
  ).trim();
  const instagramUrl = (
    nextState.instagramUrl ?? getSocialUrl(currentUser, "insta")
  ).trim();

  return [
    ...(instagramUrl ? [{ platform: "insta", url: instagramUrl }] : []),
    ...(linkedinUrl ? [{ platform: "linkedin", url: linkedinUrl }] : []),
  ] as unknown as EditableFields["socials"];
}

export async function updateUserRecord(
  userId: string,
  updates: Partial<EditableFields>,
) {
  const { data, error } = await supabase
    .from("users")
    .update(updates)
    .eq("id", userId)
    .select("*")
    .single();

  if (error) throw error;
  return data as SupabaseUser;
}

export async function syncUserRoles(
  userId: string,
  roleIdsToInsert: string[],
  roleIdsToDelete: string[],
) {
  if (roleIdsToDelete.length > 0) {
    const { error } = await supabase
      .from("user_roles")
      .delete()
      .eq("user_id", userId)
      .in("role_id", roleIdsToDelete);

    if (error) throw error;
  }

  if (roleIdsToInsert.length > 0) {
    const { error } = await supabase.from("user_roles").insert(
      roleIdsToInsert.map((roleId) => ({
        user_id: userId,
        role_id: roleId,
      })),
    );

    if (error) throw error;
  }
}

export async function deleteUserRecord(userId: string) {
  const { error } = await supabase.from("users").delete().eq("id", userId);
  if (error) throw error;
}

export async function uploadUserAvatar(userId: string, file: File) {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(
    `/api/admin/users/${encodeURIComponent(userId)}/avatar`,
    { method: "POST", body: formData },
  );

  const payload = (await response.json().catch(() => null)) as {
    user?: SupabaseUser;
    error?: string;
  } | null;

  if (!response.ok || !payload?.user) {
    throw new Error(payload?.error ?? "Failed to upload profile picture.");
  }

  return payload.user;
}

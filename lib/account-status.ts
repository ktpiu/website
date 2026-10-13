import {
  ADMIN_USERS_EDIT,
  ADMIN_VIEW,
  RUSH_VIEW,
  RUSH_MANAGE,
  USERS_ACTIVATE,
  USERS_RUSH_MANAGE,
  hasAnyPermission,
  hasPermission,
} from "@/lib/permissions";

/**
 * Account lifecycle (users.account_status). Every Clerk account starts as
 * "public". Rush registers it ("rushee"), accepting a bid makes it a
 * "pledge", and initiating their pledge class (Roles page) or an individual
 * move makes it
 * initiation makes it "active". Actives can leave as alumni, dropped or
 * disaffiliated. Moves are permission-checked per transition on the server
 * (lib/account-status-server.ts); the database trigger rejects any other
 * status write.
 */
export const ACCOUNT_STATUSES = [
  "public",
  "rushee",
  "pledge",
  "active",
  "alumni",
  "dropped",
  "disaffiliated",
] as const;

export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const ACCOUNT_STATUS_LABELS: Record<AccountStatus, string> = {
  public: "Public",
  rushee: "Rushee",
  pledge: "Pledge",
  active: "Active",
  alumni: "Alumni",
  dropped: "Dropped",
  disaffiliated: "Disaffiliated",
};

export const ACCOUNT_STATUS_DESCRIPTIONS: Record<AccountStatus, string> = {
  public: "Signed up, not affiliated. Rush portal only.",
  rushee: "Registered for rush. Rush portal only.",
  pledge: "Accepted a bid. No member portal access until initiated.",
  active: "Initiated member.",
  alumni: "Graduated member.",
  dropped: "Dropped. No portal access.",
  disaffiliated: "Disaffiliated. No portal access.",
};

/**
 * Statuses that can sign in to the member portal and appear on the public
 * website (public.account_has_portal_access). Pledges get in once they're
 * initiated: initiating their pledge class moves them to active.
 */
export const PORTAL_STATUSES: readonly AccountStatus[] = ["active", "alumni"];

/** Statuses that use the rush portal instead. */
export const RUSH_PORTAL_STATUSES: readonly AccountStatus[] = ["public", "rushee"];

/** What a rush-scoped viewer (rush directors) may see in User Management. */
export const RUSH_SCOPE_STATUSES: readonly AccountStatus[] = ["public", "rushee", "pledge"];

export function isAccountStatus(value: unknown): value is AccountStatus {
  return typeof value === "string" && (ACCOUNT_STATUSES as readonly string[]).includes(value);
}

export function hasPortalAccess(status: AccountStatus | null | undefined) {
  return Boolean(status && PORTAL_STATUSES.includes(status));
}

type Permissions = Iterable<string> | null | undefined;

/**
 * The permission each move needs. Moves run both ways so mistakes can be
 * undone by whoever could make them.
 */
const TRANSITIONS: Array<{ from: AccountStatus; to: AccountStatus; permission: string }> = [
  // Rush committee: registration and bids.
  { from: "public", to: "rushee", permission: USERS_RUSH_MANAGE },
  { from: "rushee", to: "public", permission: USERS_RUSH_MANAGE },
  { from: "rushee", to: "pledge", permission: USERS_RUSH_MANAGE },
  { from: "pledge", to: "rushee", permission: USERS_RUSH_MANAGE },
  // Pledge educators / VP of Membership: initiation.
  { from: "pledge", to: "active", permission: USERS_ACTIVATE },
  { from: "active", to: "pledge", permission: USERS_ACTIVATE },
  // Anyone who can modify accounts: leaving the chapter (and coming back).
  { from: "pledge", to: "dropped", permission: ADMIN_USERS_EDIT },
  { from: "active", to: "alumni", permission: ADMIN_USERS_EDIT },
  { from: "active", to: "dropped", permission: ADMIN_USERS_EDIT },
  { from: "active", to: "disaffiliated", permission: ADMIN_USERS_EDIT },
  { from: "alumni", to: "active", permission: ADMIN_USERS_EDIT },
  { from: "dropped", to: "active", permission: ADMIN_USERS_EDIT },
  { from: "disaffiliated", to: "active", permission: ADMIN_USERS_EDIT },
  { from: "dropped", to: "public", permission: ADMIN_USERS_EDIT },
];

export function transitionPermission(from: AccountStatus, to: AccountStatus) {
  return TRANSITIONS.find((t) => t.from === from && t.to === to)?.permission ?? null;
}

export function canTransition(permissions: Permissions, from: AccountStatus, to: AccountStatus) {
  const permission = transitionPermission(from, to);
  return Boolean(permission && hasPermission(permissions, permission));
}

/** Statuses the viewer may move an account in `from` to. */
export function allowedTransitions(permissions: Permissions, from: AccountStatus): AccountStatus[] {
  return TRANSITIONS.filter((t) => t.from === from && hasPermission(permissions, t.permission)).map(
    (t) => t.to,
  );
}

/**
 * Who sees User Management and how much of it:
 *  - "all": admin.view
 *  - "rush": rush directors / committee (users.rush.manage, rush.view, rush.manage)
 *    see public, rushee and pledge accounts only
 */
export type UserDirectoryScope = "all" | "rush";

export function getUserDirectoryScope(permissions: Permissions): UserDirectoryScope | null {
  if (hasPermission(permissions, ADMIN_VIEW)) return "all";
  if (hasAnyPermission(permissions, [USERS_RUSH_MANAGE, RUSH_VIEW, RUSH_MANAGE])) return "rush";
  return null;
}

export function statusesInScope(scope: UserDirectoryScope): readonly AccountStatus[] {
  return scope === "all" ? ACCOUNT_STATUSES : RUSH_SCOPE_STATUSES;
}

/** Initial statuses an admin may give a profile they create by hand. */
export function creatableStatuses(permissions: Permissions): AccountStatus[] {
  if (hasPermission(permissions, ADMIN_USERS_EDIT)) return [...ACCOUNT_STATUSES];
  if (hasPermission(permissions, USERS_RUSH_MANAGE)) return ["public", "rushee"];
  return [];
}

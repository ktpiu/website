import { auth, currentUser } from "@clerk/nextjs/server";
import {
  ADMIN_FINANCE_EDIT,
  ADMIN_FINANCE_VIEW,
  ADMIN_USERS_EDIT,
  ADMIN_VIEW,
  RUSH_DELIBERATION_MANAGE,
  RUSH_FORMS_MANAGE,
  RUSH_MANAGE,
  RUSH_VIEW,
} from "@/lib/permissions";
import { resolveAppUser } from "@/lib/app-user";
import { getUserDirectoryScope } from "@/lib/account-status";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { User as SupabaseUser } from "@/lib/supabase";

export type AppUser = {
  id: string;
  name: string;
  email: string;
  role: string | null;
};

export type AppAuthContext = {
  appUser: AppUser;
  profile: SupabaseUser;
  permissions: Set<string>;
};

/**
 * Why a signed-in account has no member-portal access. "rush" is a public or
 * rushee account: it belongs in /rush/portal. "disaffiliated" covers dropped
 * and disaffiliated members.
 */
export type AccessStatus = "rush" | "disaffiliated";

export const RUSH_ACCOUNT_MESSAGE =
  "This account doesn't have member portal access. Head to the rush portal.";

export const DISAFFILIATED_MESSAGE =
  "This account is no longer affiliated with KTP and cannot access the member portal.";

export class RouteAuthError extends Error {
  status: number;
  /** Set when the 403 is an approval-state outcome rather than a permission miss. */
  accessStatus?: AccessStatus;

  constructor(status: number, message: string, accessStatus?: AccessStatus) {
    super(message);
    this.status = status;
    this.accessStatus = accessStatus;
  }

  toResponseBody() {
    return this.accessStatus
      ? { error: this.message, status: this.accessStatus }
      : { error: this.message };
  }
}

function parseAppUser(row: unknown): AppUser | null {
  if (!row || typeof row !== "object") return null;

  const value = row as {
    id?: unknown;
    name?: unknown;
    email?: unknown;
    role?: unknown;
  };

  if (typeof value.id !== "string") return null;
  if (typeof value.email !== "string") return null;

  return {
    id: value.id,
    name: typeof value.name === "string" ? value.name : "",
    email: value.email,
    role: typeof value.role === "string" ? value.role : null,
  };
}

export async function getSignedInIdentity() {
  const authState = await auth();

  if (!authState.userId) {
    return null;
  }

  const clerkUser = await currentUser();
  if (!clerkUser) {
    return null;
  }

  const primaryEmail = clerkUser.primaryEmailAddress?.emailAddress;
  const firstEmail = clerkUser.emailAddresses[0]?.emailAddress;
  const email =
    typeof primaryEmail === "string" && primaryEmail.length > 0
      ? primaryEmail
      : typeof firstEmail === "string" && firstEmail.length > 0
        ? firstEmail
        : null;

  if (!email) {
    return null;
  }

  const fullName =
    clerkUser.fullName ||
    [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") ||
    null;

  return {
    clerkUserId: authState.userId,
    email,
    name: fullName,
  };
}

/**
 * Short per-instance cache so a page that fires several API calls at once
 * resolves the member once. Permission or status changes take effect within
 * CONTEXT_TTL_MS; /api/auth/me always reads fresh.
 */
const CONTEXT_TTL_MS = 10_000;
const contextCache = new Map<string, { value: AppAuthContext; expires: number }>();

function cacheContext(clerkUserId: string, value: AppAuthContext) {
  if (contextCache.size > 1000) contextCache.clear();
  contextCache.set(clerkUserId, { value, expires: Date.now() + CONTEXT_TTL_MS });
  return value;
}

/** Fast path: one RPC returns the linked account and its permission keys. */
async function loadLinkedContext(clerkUserId: string) {
  const { data, error } = await supabaseAdmin.rpc("app_user_context", {
    p_clerk_user_id: clerkUserId,
  });
  if (error) throw new RouteAuthError(500, error.message || "Failed to load user context.");
  const row = data as { user: SupabaseUser; permissions: string[]; portal_access: boolean } | null;
  return row?.user
    ? { profile: row.user, permissions: row.permissions, portalAccess: Boolean(row.portal_access) }
    : null;
}

export type SignedInAccount = {
  profile: SupabaseUser;
  permissions: string[];
  /**
   * May use the member portal: active or alumni
   * (public.account_has_portal_access). Pledges get in once initiated.
   */
  portalAccess: boolean;
};

/**
 * The signed-in Clerk session's account, whatever its status. First sign-in
 * links an email-matched row or creates a "public" account. Used by the rush
 * portal, which public, rushee and pledge accounts use.
 */
export async function requireSignedInAccount(): Promise<SignedInAccount> {
  const { userId } = await auth();
  if (!userId) throw new RouteAuthError(401, "Unauthorized.");

  const linked = await loadLinkedContext(userId);
  if (linked) return linked;

  const identity = await getSignedInIdentity();
  if (!identity) throw new RouteAuthError(401, "Unauthorized.");

  try {
    await resolveAppUser(identity);
  } catch (error) {
    const message =
      error instanceof Error && error.message ? error.message : "Failed to load your account.";
    throw new RouteAuthError(500, message);
  }
  const resolved = await loadLinkedContext(userId);
  if (!resolved) throw new RouteAuthError(500, "Failed to load your account.");
  return resolved;
}

function buildContext({ profile, permissions, portalAccess }: SignedInAccount): AppAuthContext {
  if (profile.account_status === "dropped" || profile.account_status === "disaffiliated") {
    throw new RouteAuthError(403, DISAFFILIATED_MESSAGE, "disaffiliated");
  }
  // Public, rushee and pledge accounts use the rush portal.
  if (!portalAccess) {
    throw new RouteAuthError(403, RUSH_ACCOUNT_MESSAGE, "rush");
  }
  const appUser = parseAppUser(profile);
  if (!appUser) {
    throw new RouteAuthError(403, "Not authorized for this application.");
  }
  return { appUser, profile, permissions: new Set(permissions) };
}

/**
 * Verifies the Clerk session, resolves its account and loads its permission
 * keys. Only accounts with portal access pass (actives, alumni); public,
 * rushee and pledge accounts get a 403
 * tagged "rush", dropped and disaffiliated ones a 403 tagged "disaffiliated".
 * Runs with the Supabase secret key.
 */
export async function requireAppAuthContext(
  options: { fresh?: boolean } = {},
): Promise<AppAuthContext> {
  const { userId } = await auth();
  if (!userId) {
    throw new RouteAuthError(401, "Unauthorized.");
  }

  if (!options.fresh) {
    const cached = contextCache.get(userId);
    if (cached && cached.expires > Date.now()) return cached.value;
  }

  return cacheContext(userId, buildContext(await requireSignedInAccount()));
}

export function assertFinanceViewPermission(context: AppAuthContext) {
  if (
    !context.permissions.has(ADMIN_FINANCE_VIEW) &&
    !context.permissions.has(ADMIN_FINANCE_EDIT)
  ) {
    throw new RouteAuthError(403, "Missing finance admin view permission.");
  }
}

export function assertFinanceEditPermission(context: AppAuthContext) {
  if (!context.permissions.has(ADMIN_FINANCE_EDIT)) {
    throw new RouteAuthError(403, "Missing finance admin edit permission.");
  }
}

export function assertAdminViewPermission(context: AppAuthContext) {
  if (!context.permissions.has(ADMIN_VIEW)) {
    throw new RouteAuthError(403, "Missing admin view permission.");
  }
}

/** Viewer may open User Management (all accounts, or the rush-scoped view). */
export function assertUserDirectoryPermission(context: AppAuthContext) {
  const scope = getUserDirectoryScope(context.permissions);
  if (!scope) throw new RouteAuthError(403, "Missing user management permission.");
  return scope;
}

export function assertUsersEditPermission(context: AppAuthContext) {
  if (!context.permissions.has(ADMIN_USERS_EDIT)) {
    throw new RouteAuthError(403, "Missing user admin edit permission.");
  }
}

export function assertRushViewPermission(context: AppAuthContext) {
  if (!context.permissions.has(RUSH_VIEW) && !context.permissions.has(RUSH_MANAGE)) {
    throw new RouteAuthError(403, "Missing rush view permission.");
  }
}

export function assertRushManagePermission(context: AppAuthContext) {
  if (!context.permissions.has(RUSH_MANAGE)) {
    throw new RouteAuthError(403, "Missing rush manage permission.");
  }
}

export function assertDeliberationManagePermission(context: AppAuthContext) {
  if (!context.permissions.has(RUSH_DELIBERATION_MANAGE)) {
    throw new RouteAuthError(403, "Missing deliberation admin permission.");
  }
}

export function assertRushFormsManagePermission(context: AppAuthContext) {
  if (!context.permissions.has(RUSH_FORMS_MANAGE) && !context.permissions.has(RUSH_MANAGE)) {
    throw new RouteAuthError(403, "Missing rush forms permission.");
  }
}

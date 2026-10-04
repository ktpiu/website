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
  fetchUserPermissionKeys,
} from "@/lib/permissions";
import { resolveAppUser } from "@/lib/app-user";
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
 * Why a signed-in Clerk account has no portal access. "pnm" is a rush
 * candidate's account: it belongs in /rush/portal, never the member portal.
 */
export type AccessStatus = "pending" | "denied" | "disaffiliated" | "pnm";

export const PENDING_APPROVAL_MESSAGE =
  "Your account is waiting for an administrator to approve it.";
export const ACCESS_DENIED_MESSAGE =
  "An administrator has declined portal access for this account.";

export const PNM_ACCOUNT_MESSAGE =
  "This is a rush account. Head to the rush portal to see your events.";

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
 * Verifies the Clerk session, links it to its public.users profile (an
 * email-matched profile is linked on first sign-in; nothing is created), and
 * loads the user's permission keys. Throws a 403 tagged "pending", "denied" or "disaffiliated"
 * when the account has not been approved. Runs with the Supabase secret key.
 */
/**
 * Short per-instance cache so a page that fires several API calls at once
 * resolves the member once. Permission or affiliation changes take effect
 * within CONTEXT_TTL_MS; /api/auth/me always reads fresh.
 */
const CONTEXT_TTL_MS = 10_000;
const contextCache = new Map<string, { value: AppAuthContext; expires: number }>();

function cacheContext(clerkUserId: string, value: AppAuthContext) {
  if (contextCache.size > 1000) contextCache.clear();
  contextCache.set(clerkUserId, { value, expires: Date.now() + CONTEXT_TTL_MS });
  return value;
}

/** Fast path: one RPC returns the linked profile and its permission keys. */
async function loadLinkedContext(clerkUserId: string) {
  const { data, error } = await supabaseAdmin.rpc("app_user_context", {
    p_clerk_user_id: clerkUserId,
  });
  if (error) throw new RouteAuthError(500, error.message || "Failed to load user context.");
  const row = data as { user: SupabaseUser; permissions: string[] } | null;
  return row?.user ? row : null;
}

function buildContext(profile: SupabaseUser, permissionKeys: string[]): AppAuthContext {
  if (profile.is_disaffiliated) {
    throw new RouteAuthError(403, DISAFFILIATED_MESSAGE, "disaffiliated");
  }
  const appUser = parseAppUser(profile);
  if (!appUser) {
    throw new RouteAuthError(403, "Not authorized for this application.");
  }
  return { appUser, profile, permissions: new Set(permissionKeys) };
}

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

  // Already-linked members (nearly every request) skip the Clerk API call.
  const linked = await loadLinkedContext(userId);
  if (linked) {
    return cacheContext(userId, buildContext(linked.user, linked.permissions));
  }

  // Slow path: first sign-in (link by email), pending, denied or a PNM account.
  const identity = await getSignedInIdentity();
  if (!identity) {
    throw new RouteAuthError(401, "Unauthorized.");
  }

  let profile: SupabaseUser;
  try {
    const resolved = await resolveAppUser(identity);
    if (resolved.status === "pending") {
      const { data: pnm } = await supabaseAdmin
        .from("pnms")
        .select("id")
        .eq("clerk_user_id", identity.clerkUserId)
        .maybeSingle();
      if (pnm) {
        throw new RouteAuthError(403, PNM_ACCOUNT_MESSAGE, "pnm");
      }
      throw new RouteAuthError(403, PENDING_APPROVAL_MESSAGE, "pending");
    }
    if (resolved.status === "denied") {
      throw new RouteAuthError(403, ACCESS_DENIED_MESSAGE, "denied");
    }
    profile = resolved.user;
  } catch (error) {
    if (error instanceof RouteAuthError) throw error;
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Failed to load user context.";
    throw new RouteAuthError(500, message);
  }

  const permissionKeys = await fetchUserPermissionKeys(profile.id, supabaseAdmin);
  return cacheContext(userId, buildContext(profile, permissionKeys));
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

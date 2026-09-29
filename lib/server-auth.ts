import { auth, currentUser } from "@clerk/nextjs/server";
import {
  ADMIN_FINANCE_EDIT,
  ADMIN_FINANCE_VIEW,
  ADMIN_USERS_EDIT,
  ADMIN_VIEW,
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

/** Why a signed-in Clerk account has no portal access. */
export type AccessStatus = "pending" | "denied" | "disaffiliated";

export const PENDING_APPROVAL_MESSAGE =
  "Your account is waiting for an administrator to approve it.";
export const ACCESS_DENIED_MESSAGE =
  "An administrator has declined portal access for this account.";

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
export async function requireAppAuthContext(): Promise<AppAuthContext> {
  const identity = await getSignedInIdentity();
  if (!identity) {
    throw new RouteAuthError(401, "Unauthorized.");
  }

  let profile: SupabaseUser;
  try {
    const resolved = await resolveAppUser(identity);
    if (resolved.status === "pending") {
      throw new RouteAuthError(403, PENDING_APPROVAL_MESSAGE, "pending");
    }
    if (resolved.status === "denied") {
      throw new RouteAuthError(403, ACCESS_DENIED_MESSAGE, "denied");
    }
    if (resolved.user.is_disaffiliated) {
      throw new RouteAuthError(403, DISAFFILIATED_MESSAGE, "disaffiliated");
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

  const appUser = parseAppUser(profile);
  if (!appUser) {
    throw new RouteAuthError(403, "Not authorized for this application.");
  }

  const permissionKeys = await fetchUserPermissionKeys(appUser.id, supabaseAdmin);

  return {
    appUser,
    profile,
    permissions: new Set(permissionKeys),
  };
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

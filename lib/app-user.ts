import { supabaseAdmin } from "@/lib/supabase-admin";
import type { User as SupabaseUser } from "@/lib/supabase";
import type { AccountStatus } from "@/lib/account-status";

/**
 * Server-only. Resolves a verified Clerk identity to its public.users account.
 *
 * Every Clerk account has an account row. Sign-in links the Clerk account to
 * an unlinked row with the same email (a member profile an admin created, or
 * a rushee created by a check-in or application); otherwise it creates a new
 * row with account_status "public". What the account can reach is decided by
 * its status and roles (lib/account-status.ts), not by whether it exists.
 *
 * RLS resolves the current member through users.clerk_user_id, and only
 * counts portal statuses (see current_app_user_id()).
 */

export type ClerkIdentity = {
  clerkUserId: string;
  email: string;
  name?: string | null;
};

const UNIQUE_VIOLATION = "23505";

export function buildFallbackName(email: string) {
  const localPart = email.split("@")[0] ?? "Member";
  const tokens = localPart
    .split(/[._-]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length === 0) return "Member";

  return tokens
    .map((token) => token[0].toUpperCase() + token.slice(1))
    .join(" ");
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function normalizeName(name: string | null | undefined, email: string) {
  const value = name?.trim();
  return value && value.length > 0 ? value : buildFallbackName(email);
}

function buildNewUserPayload({
  clerkUserId,
  email,
  name,
  status,
}: {
  clerkUserId: string | null;
  email: string;
  name: string;
  status: AccountStatus;
}): Record<string, unknown> {
  return {
    clerk_user_id: clerkUserId,
    email,
    name,
    role: "newmember",
    avatar: "",
    major: "",
    graduation_year: null,
    account_status: status,
    website_visibility: "auto",
    is_inactive: false,
    title: "",
    socials: [],
  };
}

export async function findAppUserByClerkId(clerkUserId: string) {
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("*")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();

  if (error) throw error;

  return (data as SupabaseUser | null) ?? null;
}

export async function findAppUserByEmail(email: string) {
  const normalizedEmail = normalizeEmail(email);

  const { data, error } = await supabaseAdmin
    .from("users")
    .select("*")
    .ilike("email", normalizedEmail)
    .maybeSingle();

  if (error) throw error;

  return (data as SupabaseUser | null) ?? null;
}

/** Keeps the rush record's account mirror in sync with the account. */
async function syncPnmClerkLink(userId: string, clerkUserId: string | null) {
  const { error } = await supabaseAdmin
    .from("pnms")
    .update({ clerk_user_id: clerkUserId, updated_at: new Date().toISOString() })
    .eq("linked_user_id", userId);
  if (error) throw error;
}

/**
 * Links an unlinked account row to a Clerk account. Returns null when the row
 * was already linked (lost a race, or linked to someone else).
 */
export async function linkAppUserToClerk(userId: string, clerkUserId: string) {
  const { data, error } = await supabaseAdmin
    .from("users")
    .update({ clerk_user_id: clerkUserId })
    .eq("id", userId)
    .is("clerk_user_id", null)
    .select("*")
    .maybeSingle();

  if (error) throw error;
  if (data) await syncPnmClerkLink(userId, clerkUserId);

  return (data as SupabaseUser | null) ?? null;
}

/**
 * Returns the account for a Clerk identity: the linked row, else an
 * email-matched unlinked row (now linked), else a new "public" account.
 */
export async function resolveAppUser({
  clerkUserId,
  email,
  name,
}: ClerkIdentity): Promise<{ user: SupabaseUser; linked: boolean; created: boolean }> {
  const normalizedEmail = normalizeEmail(email);

  const linkedUser = await findAppUserByClerkId(clerkUserId);
  if (linkedUser) {
    return { user: linkedUser, linked: false, created: false };
  }

  const existingByEmail = await findAppUserByEmail(normalizedEmail);
  if (existingByEmail) {
    if (
      existingByEmail.clerk_user_id &&
      existingByEmail.clerk_user_id !== clerkUserId
    ) {
      throw new Error(
        `The profile for ${normalizedEmail} is already linked to a different sign-in account.`,
      );
    }

    const linked = await linkAppUserToClerk(existingByEmail.id, clerkUserId);
    if (linked) {
      return { user: linked, linked: true, created: false };
    }

    // Lost a race with a concurrent link; re-read the row.
    const raced = await findAppUserByClerkId(clerkUserId);
    if (raced) {
      return { user: raced, linked: false, created: false };
    }

    throw new Error(`Failed to link profile for ${normalizedEmail}.`);
  }

  const { data, error } = await supabaseAdmin
    .from("users")
    .insert(
      buildNewUserPayload({
        clerkUserId,
        email: normalizedEmail,
        name: normalizeName(name, normalizedEmail),
        status: "public",
      }),
    )
    .select("*")
    .single();

  if (!error && data) {
    return { user: data as SupabaseUser, linked: false, created: true };
  }
  if (error?.code === UNIQUE_VIOLATION) {
    // A concurrent sign-in (or the Clerk webhook) created it first.
    const raced =
      (await findAppUserByClerkId(clerkUserId)) ??
      (await findAppUserByEmail(normalizedEmail));
    if (raced?.clerk_user_id === clerkUserId) {
      return { user: raced, linked: false, created: false };
    }
  }
  throw error ?? new Error(`Failed to create an account for ${normalizedEmail}.`);
}

/**
 * Creates (or reuses) an account row for an email with no Clerk account yet:
 * an admin-created profile, or a rushee registered by a check-in. Their first
 * sign-in links it through the email match in resolveAppUser().
 */
export async function preprovisionAppUserByEmail({
  email,
  name,
  status = "public",
  roleIds = [],
}: {
  email: string;
  name?: string | null;
  status?: AccountStatus;
  roleIds?: string[];
}): Promise<{ user: SupabaseUser; created: boolean }> {
  const normalizedEmail = normalizeEmail(email);
  let user = await findAppUserByEmail(normalizedEmail);
  let created = false;

  if (!user) {
    const payload = buildNewUserPayload({
      clerkUserId: null,
      email: normalizedEmail,
      name: normalizeName(name, normalizedEmail),
      status,
    });

    const { data, error } = await supabaseAdmin.from("users").insert(payload).select("*").single();
    if (error?.code === UNIQUE_VIOLATION) {
      user = await findAppUserByEmail(normalizedEmail);
    } else if (error) {
      throw error;
    } else {
      user = data as SupabaseUser;
      created = true;
    }
    if (!user) throw new Error(`Failed to create a profile for ${normalizedEmail}.`);
  }

  await addUserRoles(user.id, roleIds);
  return { user, created };
}

export async function addUserRoles(userId: string, roleIds: string[]) {
  if (roleIds.length === 0) return;
  const { error } = await supabaseAdmin.from("user_roles").upsert(
    roleIds.map((roleId) => ({ user_id: userId, role_id: roleId })),
    { onConflict: "user_id,role_id", ignoreDuplicates: true },
  );
  if (error) throw error;
}

/**
 * Admin action: attaches a Clerk account to an existing profile that has no
 * sign-in yet. If the Clerk account already owns an empty "public" account
 * (made automatically at sign-in), that placeholder is removed first.
 */
export async function linkClerkAccountToProfile({
  clerkUserId,
  targetUserId,
}: {
  clerkUserId: string;
  targetUserId: string;
}): Promise<SupabaseUser> {
  const { data: target, error: targetError } = await supabaseAdmin
    .from("users")
    .select("*")
    .eq("id", targetUserId)
    .maybeSingle();
  if (targetError) throw targetError;
  if (!target) throw new Error("Profile not found.");
  if (target.clerk_user_id === clerkUserId) return target as SupabaseUser;
  if (target.clerk_user_id) {
    throw new Error("That profile is already linked to a different sign-in.");
  }

  const placeholder = await findAppUserByClerkId(clerkUserId);
  if (placeholder) {
    if (placeholder.account_status !== "public") {
      throw new Error(
        `This sign-in already belongs to ${placeholder.name} (${placeholder.account_status}). Unlink it there first.`,
      );
    }
    const { count, error: rushError } = await supabaseAdmin
      .from("pnms")
      .select("id", { count: "exact", head: true })
      .eq("linked_user_id", placeholder.id);
    if (rushError) throw rushError;
    if (count) throw new Error("This sign-in has rush history. Unlink it there first.");

    const { error: deleteError } = await supabaseAdmin.from("users").delete().eq("id", placeholder.id);
    if (deleteError) {
      throw new Error(
        "The automatic account for this sign-in has other records attached, so it can't be merged.",
      );
    }
  }

  const linked = await linkAppUserToClerk(targetUserId, clerkUserId);
  if (!linked) throw new Error("That profile was linked by someone else just now.");
  return linked;
}

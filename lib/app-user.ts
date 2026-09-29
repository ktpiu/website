import { supabaseAdmin } from "@/lib/supabase-admin";
import type { User as SupabaseUser } from "@/lib/supabase";

/**
 * Server-only. Resolves a verified Clerk identity to a public.users profile.
 *
 * Sign-in never creates a profile on its own. A Clerk account is linked to a
 * pre-existing profile that shares its email (the historical "whitelist"
 * flow); otherwise it is *pending* until an administrator approves it from
 * User Management, which calls provisionAppUser(). Denials are recorded in
 * public.user_access_reviews so the member sees a clear "denied" screen.
 *
 * RLS policies resolve the current user through users.clerk_user_id, so every
 * signed-in member with portal access must be linked here.
 */

export type ClerkIdentity = {
  clerkUserId: string;
  email: string;
  name?: string | null;
};

export type AccessReview = {
  clerk_user_id: string;
  email: string | null;
  name: string | null;
  status: "denied";
  note: string | null;
  reviewed_by: string | null;
  reviewed_at: string;
};

export type ResolveAppUserResult =
  | { status: "active"; user: SupabaseUser; linked: boolean }
  | { status: "pending" }
  | { status: "denied"; review: AccessReview };

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
}: {
  clerkUserId: string;
  email: string;
  name: string;
}): Record<string, unknown> {
  return {
    clerk_user_id: clerkUserId,
    email,
    name,
    role: "newmember",
    avatar: "",
    major: "",
    graduation_year: null,
    is_alumni: false,
    is_hidden: false,
    is_inactive: false,
    is_disaffiliated: false,
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

export async function findAccessReview(clerkUserId: string) {
  const { data, error } = await supabaseAdmin
    .from("user_access_reviews")
    .select("*")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();

  if (error) throw error;

  return (data as AccessReview | null) ?? null;
}

/**
 * Links an unlinked profile to a Clerk account. Returns null when the row was
 * already linked (lost a race, or linked to someone else).
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

  return (data as SupabaseUser | null) ?? null;
}

/**
 * Attaches a Clerk identity to its profile when one exists (by Clerk id, then
 * by email). Never creates a profile.
 */
export async function resolveAppUser({
  clerkUserId,
  email,
}: ClerkIdentity): Promise<ResolveAppUserResult> {
  const normalizedEmail = normalizeEmail(email);

  const linkedUser = await findAppUserByClerkId(clerkUserId);
  if (linkedUser) {
    return { status: "active", user: linkedUser, linked: false };
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
      return { status: "active", user: linked, linked: true };
    }

    // Lost a race with a concurrent link; re-read the row.
    const raced = await findAppUserByClerkId(clerkUserId);
    if (raced) {
      return { status: "active", user: raced, linked: false };
    }

    throw new Error(`Failed to link profile for ${normalizedEmail}.`);
  }

  const review = await findAccessReview(clerkUserId);
  if (review) {
    return { status: "denied", review };
  }

  return { status: "pending" };
}

export type ProvisionAppUserParams = ClerkIdentity & {
  /** Role ids to assign on creation (e.g. a pledge class). */
  roleIds?: string[];
};

/**
 * Admin approval path: creates the profile for a Clerk account (or links an
 * email-matched profile that already exists), assigns any requested roles and
 * clears a previous denial. Runs with the secret key.
 */
export async function provisionAppUser({
  clerkUserId,
  email,
  name,
  roleIds = [],
}: ProvisionAppUserParams): Promise<{ user: SupabaseUser; created: boolean }> {
  const normalizedEmail = normalizeEmail(email);
  const displayName = normalizeName(name, normalizedEmail);

  let user: SupabaseUser | null = null;
  let created = false;

  const resolved = await resolveAppUser({ clerkUserId, email: normalizedEmail });
  if (resolved.status === "active") {
    user = resolved.user;
  } else {
    const payload = buildNewUserPayload({
      clerkUserId,
      email: normalizedEmail,
      name: displayName,
    });

    const { data, error } = await supabaseAdmin
      .from("users")
      .insert(payload)
      .select("*")
      .single();

    if (!error && data) {
      user = data as SupabaseUser;
      created = true;
    } else if (error?.code === UNIQUE_VIOLATION) {
      user =
        (await findAppUserByClerkId(clerkUserId)) ??
        (await findAppUserByEmail(normalizedEmail));
    }

    if (!user) {
      throw error ?? new Error("Failed to provision app user.");
    }
  }

  if (!created && name && name.trim() && user.name !== name.trim()) {
    const { data, error } = await supabaseAdmin
      .from("users")
      .update({ name: name.trim() })
      .eq("id", user.id)
      .select("*")
      .single();
    if (error) throw error;
    user = data as SupabaseUser;
  }

  if (roleIds.length > 0) {
    const { error } = await supabaseAdmin.from("user_roles").upsert(
      roleIds.map((roleId) => ({ user_id: user!.id, role_id: roleId })),
      { onConflict: "user_id,role_id", ignoreDuplicates: true },
    );
    if (error) throw error;
  }

  const { error: reviewError } = await supabaseAdmin
    .from("user_access_reviews")
    .delete()
    .eq("clerk_user_id", clerkUserId);
  if (reviewError) throw reviewError;

  return { user, created };
}

export async function denyAppUserAccess({
  clerkUserId,
  email,
  name,
  note,
  reviewedBy,
}: ClerkIdentity & { note?: string | null; reviewedBy: string }) {
  const { data, error } = await supabaseAdmin
    .from("user_access_reviews")
    .upsert(
      {
        clerk_user_id: clerkUserId,
        email: normalizeEmail(email),
        name: name?.trim() || null,
        status: "denied",
        note: note?.trim() || null,
        reviewed_by: reviewedBy,
        reviewed_at: new Date().toISOString(),
      },
      { onConflict: "clerk_user_id" },
    )
    .select("*")
    .single();

  if (error) throw error;
  return data as AccessReview;
}

export async function clearAppUserDenial(clerkUserId: string) {
  const { error } = await supabaseAdmin
    .from("user_access_reviews")
    .delete()
    .eq("clerk_user_id", clerkUserId);
  if (error) throw error;
}

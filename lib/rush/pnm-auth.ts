import "server-only";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { RouteAuthError } from "@/lib/server-auth";
import type { PnmRow } from "@/lib/rush/server";

/**
 * Resolves the signed-in Clerk session to its PNM record. PNM accounts are
 * created by /api/rush/account/setup and linked through pnms.clerk_user_id.
 */
export async function requirePnmAuthContext(): Promise<{ pnm: PnmRow; clerkUserId: string }> {
  const { userId } = await auth();
  if (!userId) throw new RouteAuthError(401, "Unauthorized.");

  const { data, error } = await supabaseAdmin
    .from("pnms")
    .select("*")
    .eq("clerk_user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new RouteAuthError(403, "This account is not a rush account.");

  return { pnm: data as PnmRow, clerkUserId: userId };
}

/** The PNM for the current session, or null when signed out / not a PNM. */
export async function getOptionalPnm(): Promise<PnmRow | null> {
  try {
    return (await requirePnmAuthContext()).pnm;
  } catch {
    return null;
  }
}

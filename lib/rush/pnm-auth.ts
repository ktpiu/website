import "server-only";
import { requireSignedInAccount, RouteAuthError } from "@/lib/server-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { findPnmForUser, type PnmRow } from "@/lib/rush/server";
import type { User as SupabaseUser } from "@/lib/supabase";

/**
 * The signed-in account and its rush record, if any. Every account may use
 * the rush portal; `pnm` is null until they register for rush (check-in,
 * application, self-registration, or the rush committee).
 */
export async function getRushAccount(): Promise<{
  account: SupabaseUser;
  pnm: PnmRow | null;
  /** May use the member portal (see requireSignedInAccount). */
  portalAccess: boolean;
}> {
  const { profile, portalAccess } = await requireSignedInAccount();
  const pnm = await findPnmForUser(profile);
  // Records found by legacy Clerk id or email get linked to this account.
  if (pnm && !pnm.linked_user_id) {
    const { error } = await supabaseAdmin
      .from("pnms")
      .update({ linked_user_id: profile.id, clerk_user_id: profile.clerk_user_id ?? null })
      .eq("id", pnm.id)
      .is("linked_user_id", null);
    if (error) throw error;
    pnm.linked_user_id = profile.id;
  }
  return { account: profile, pnm, portalAccess };
}

/** The signed-in account's rush record; 403 when they haven't registered. */
export async function requirePnmAuthContext(): Promise<{ pnm: PnmRow; account: SupabaseUser }> {
  const { account, pnm } = await getRushAccount();
  if (!pnm) throw new RouteAuthError(403, "This account isn't registered for rush yet.");
  return { pnm, account };
}

/** The PNM for the current session, or null when signed out / not registered. */
export async function getOptionalPnm(): Promise<PnmRow | null> {
  try {
    return (await requirePnmAuthContext()).pnm;
  } catch {
    return null;
  }
}

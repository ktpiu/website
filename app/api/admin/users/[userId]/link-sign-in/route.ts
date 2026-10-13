import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { assertUsersEditPermission, requireAppAuthContext } from "@/lib/server-auth";
import { linkClerkAccountToProfile } from "@/lib/app-user";
import { adminUsersErrorResponse } from "@/lib/admin-users-server";
import { readJson, RushError, str } from "@/lib/rush/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ userId: string }> };

/**
 * Moves a public account's sign-in onto an existing profile that has none
 * (the person signed up with a different email than their member profile),
 * then removes the now-empty public account.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const context = await requireAppAuthContext();
    assertUsersEditPermission(context);
    const { userId } = await params;
    const body = await readJson(request);
    const targetUserId = str(body.targetUserId, 64);
    if (!targetUserId || targetUserId === userId) throw new RushError(400, "Pick a different profile.");

    const { data: source, error } = await supabaseAdmin
      .from("users")
      .select("id, clerk_user_id, account_status")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw error;
    if (!source) throw new RushError(404, "Account not found.");
    if (!source.clerk_user_id) throw new RushError(400, "This account has no sign-in to move.");
    if (source.account_status !== "public") {
      throw new RushError(400, "Only public accounts can be merged into another profile.");
    }

    const user = await linkClerkAccountToProfile({ clerkUserId: source.clerk_user_id, targetUserId });
    return NextResponse.json({ user, removedUserId: userId });
  } catch (error) {
    return adminUsersErrorResponse(error, "Failed to link the sign-in.");
  }
}

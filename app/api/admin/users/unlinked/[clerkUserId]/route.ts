import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { assertUsersEditPermission, requireAppAuthContext } from "@/lib/server-auth";
import { creatableStatuses, isAccountStatus } from "@/lib/account-status";
import { findAppUserByEmail, linkClerkAccountToProfile, resolveAppUser } from "@/lib/app-user";
import { adminUsersErrorResponse } from "@/lib/admin-users-server";
import { getClerkEmail, getClerkName, getClerkUser } from "@/lib/clerk-admin";
import { readJson, RushError, str } from "@/lib/rush/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ clerkUserId: string }> };

/**
 * Resolves an unlinked sign-in account:
 *  - { action: "link", userId }: attach it to an existing profile that has
 *    no sign-in yet (e.g. a member whose profile uses a different email).
 *  - { action: "create", name?, status }: create a profile for it. The email
 *    always comes from Clerk.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const context = await requireAppAuthContext();
    assertUsersEditPermission(context);
    const { clerkUserId } = await params;
    const body = await readJson(request);

    if (!process.env.CLERK_SECRET_KEY) throw new RushError(503, "CLERK_SECRET_KEY is not configured.");
    const clerkUser = await getClerkUser(clerkUserId);
    if (!clerkUser) throw new RushError(404, "Sign-in account not found.");

    if (body.action === "link") {
      const userId = str(body.userId, 64);
      if (!userId) throw new RushError(400, "Pick a profile to link.");
      const user = await linkClerkAccountToProfile({ clerkUserId, targetUserId: userId });
      return NextResponse.json({ user });
    }

    if (body.action === "create") {
      const email = getClerkEmail(clerkUser);
      if (!email) throw new RushError(400, "This sign-in account has no email address.");
      const status = body.status ?? "public";
      if (!isAccountStatus(status) || !creatableStatuses(context.permissions).includes(status)) {
        throw new RushError(403, "You can't create accounts with that status.");
      }
      if (status === "rushee") {
        throw new RushError(400, "Create it as public, then move it to Rushee to register them for rush.");
      }
      const existing = await findAppUserByEmail(email);
      if (existing && existing.clerk_user_id && existing.clerk_user_id !== clerkUserId) {
        throw new RushError(409, `${email} already belongs to ${existing.name}.`);
      }

      const { user, created } = await resolveAppUser({
        clerkUserId,
        email,
        name: str(body.name, 120) || getClerkName(clerkUser),
      });
      // Only a brand-new profile takes the chosen status; a linked one keeps its own.
      if (created && status !== "public") {
        const { error } = await supabaseAdmin.from("users").update({ account_status: status }).eq("id", user.id);
        if (error) throw error;
        user.account_status = status;
      }
      return NextResponse.json({ user }, { status: created ? 201 : 200 });
    }

    throw new RushError(400, "Unknown action.");
  } catch (error) {
    return adminUsersErrorResponse(error, "Failed to update the sign-in account.");
  }
}

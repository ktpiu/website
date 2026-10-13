import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { assertAdminViewPermission, requireAppAuthContext } from "@/lib/server-auth";
import { adminUsersErrorResponse } from "@/lib/admin-users-server";
import { getClerkEmail, getClerkName, listAllClerkUsers } from "@/lib/clerk-admin";
import type { UnlinkedClerkAccount } from "@/components/member-portal/admin/users/users-utils";

export const dynamic = "force-dynamic";

/**
 * Clerk accounts with no public.users row. Sign-in normally links or creates
 * one, so these are accounts that haven't signed in since accounts were
 * unified, or whose automatic link failed. `matchingProfile` is an unlinked
 * profile with the same email.
 */
export async function GET() {
  try {
    const context = await requireAppAuthContext();
    assertAdminViewPermission(context);

    if (!process.env.CLERK_SECRET_KEY) {
      return NextResponse.json(
        { error: "CLERK_SECRET_KEY is not configured, so sign-in accounts cannot be listed." },
        { status: 503 },
      );
    }

    const [clerkUsers, profilesRes] = await Promise.all([
      listAllClerkUsers(),
      supabaseAdmin.from("users").select("id, name, email, clerk_user_id"),
    ]);
    if (profilesRes.error) throw profilesRes.error;

    const profiles = (profilesRes.data ?? []) as Array<{
      id: string;
      name: string | null;
      email: string | null;
      clerk_user_id: string | null;
    }>;
    const linked = new Set(profiles.flatMap((p) => (p.clerk_user_id ? [p.clerk_user_id] : [])));
    const unlinkedByEmail = new Map(
      profiles.filter((p) => !p.clerk_user_id && p.email).map((p) => [p.email!.toLowerCase(), p]),
    );

    const accounts: UnlinkedClerkAccount[] = clerkUsers
      .filter((user) => !linked.has(user.id))
      .map((user) => {
        const email = getClerkEmail(user);
        const match = email ? unlinkedByEmail.get(email.toLowerCase()) : undefined;
        return {
          clerkUserId: user.id,
          email,
          name: getClerkName(user),
          imageUrl: user.imageUrl || null,
          createdAt: new Date(user.createdAt).toISOString(),
          lastSignInAt: user.lastSignInAt ? new Date(user.lastSignInAt).toISOString() : null,
          matchingProfile: match ? { id: match.id, name: match.name ?? "" } : null,
        };
      });

    return NextResponse.json({ accounts }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return adminUsersErrorResponse(error, "Failed to load sign-in accounts.");
  }
}

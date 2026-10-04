import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAppAuthContext } from "@/lib/server-auth";
import { canManageRush } from "@/lib/permissions";
import { getActiveSession } from "@/lib/rush/deliberation";
import { rushErrorResponse } from "@/lib/rush/server";

export const dynamic = "force-dynamic";

/** Sidebar badges: live deliberation and (for managers) check-ins to reconcile. */
export async function GET() {
  try {
    const context = await requireAppAuthContext();
    const [session, unmatched] = await Promise.all([
      getActiveSession(),
      canManageRush(context.permissions)
        ? supabaseAdmin
            .from("rush_unmatched_checkins")
            .select("id", { count: "exact", head: true })
            .eq("status", "pending")
        : Promise.resolve({ count: 0, error: null }),
    ]);
    if (unmatched.error) throw unmatched.error;
    return NextResponse.json(
      { deliberationLive: Boolean(session), unmatchedPending: unmatched.count ?? 0 },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return rushErrorResponse(error, "Failed to load rush status.");
  }
}

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAppAuthContext } from "@/lib/server-auth";
import { canManageRush } from "@/lib/permissions";
import { getActiveSession } from "@/lib/rush/deliberation";
import { getActiveCycle, rushErrorResponse } from "@/lib/rush/server";

export const dynamic = "force-dynamic";

/** Sidebar state: live deliberation, check-ins to reconcile (managers) and the cycle phase. */
export async function GET() {
  try {
    const context = await requireAppAuthContext();
    const [session, cycle, unmatched] = await Promise.all([
      getActiveSession(),
      getActiveCycle(),
      canManageRush(context.permissions)
        ? supabaseAdmin
            .from("rush_unmatched_checkins")
            .select("id", { count: "exact", head: true })
            .eq("status", "pending")
        : Promise.resolve({ count: 0, error: null }),
    ]);
    if (unmatched.error) throw unmatched.error;
    return NextResponse.json(
      { deliberationLive: Boolean(session), unmatchedPending: unmatched.count ?? 0, cyclePhase: cycle?.phase ?? null },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return rushErrorResponse(error, "Failed to load rush status.");
  }
}

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { assertDeliberationManagePermission, requireAppAuthContext } from "@/lib/server-auth";
import { getActiveSession } from "@/lib/rush/deliberation";
import { readJson, RushError, rushErrorResponse, str } from "@/lib/rush/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ pnmId: string }> };

const GROUPS = new Set(["undecided", "yes", "no", "come_back"]);

/** Move a PNM into a deliberation group for one cycle. */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const context = await requireAppAuthContext();
    assertDeliberationManagePermission(context);
    const { pnmId } = await params;
    const body = await readJson(request);
    const cycleId = str(body.cycleId, 64);
    const group = String(body.group);
    if (!cycleId || !GROUPS.has(group)) throw new RushError(400, "Choose a cycle and group.");

    const { data, error } = await supabaseAdmin
      .from("pnm_cycle_entries")
      .update({ group, decided_by: context.appUser.id, decided_at: new Date().toISOString() })
      .eq("pnm_id", pnmId)
      .eq("cycle_id", cycleId)
      .select("id");
    if (error) throw error;
    if (!data?.length) throw new RushError(404, "This PNM is not in that cycle.");

    // Nudge live deliberation screens (they refetch on any session change).
    const session = await getActiveSession();
    if (session?.cycle_id === cycleId) {
      await supabaseAdmin
        .from("delib_sessions")
        .update({ current_pnm_id: session.current_pnm_id })
        .eq("id", session.id);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return rushErrorResponse(error, "Failed to update the group.");
  }
}

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { assertDeliberationManagePermission, requireAppAuthContext } from "@/lib/server-auth";
import { getOpenRound, requireActiveSession } from "@/lib/rush/deliberation";
import { getCycleEntry, readJson, RushError, rushErrorResponse, str } from "@/lib/rush/server";

export const dynamic = "force-dynamic";

/** Bring a PNM up on everyone's screen ({ pnmId: null } clears it). */
export async function POST(request: Request) {
  try {
    const context = await requireAppAuthContext();
    assertDeliberationManagePermission(context);
    const session = await requireActiveSession();
    const pnmId = str((await readJson(request)).pnmId, 64) || null;

    if (pnmId) {
      const entry = await getCycleEntry(pnmId, session.cycle_id);
      if (!entry || entry.stage !== session.stage) {
        throw new RushError(400, `That PNM isn't in ${session.stage} rush this cycle.`);
      }
    }
    const open = await getOpenRound(session.id);
    if (open && open.pnm_id !== pnmId) throw new RushError(409, "Close the current vote before switching PNMs.");

    const { error } = await supabaseAdmin
      .from("delib_sessions")
      .update({ current_pnm_id: pnmId, current_round_id: open?.id ?? null })
      .eq("id", session.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return rushErrorResponse(error, "Failed to present the PNM.");
  }
}

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { assertDeliberationManagePermission, requireAppAuthContext } from "@/lib/server-auth";
import { closeRound, getOpenRound, requireActiveSession } from "@/lib/rush/deliberation";
import { RushError, rushErrorResponse } from "@/lib/rush/server";

export const dynamic = "force-dynamic";

/**
 * Close the open vote: final totals are saved to the PNM's voting history and
 * every individual ballot is deleted in the same transaction.
 */
export async function POST() {
  try {
    const context = await requireAppAuthContext();
    assertDeliberationManagePermission(context);
    const session = await requireActiveSession();
    const open = await getOpenRound(session.id);
    if (!open) throw new RushError(409, "There is no open vote.");
    await closeRound(open.id);
    // Touch the session so every client refreshes its view.
    await supabaseAdmin.from("delib_sessions").update({ current_round_id: open.id }).eq("id", session.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return rushErrorResponse(error, "Failed to close the vote.");
  }
}

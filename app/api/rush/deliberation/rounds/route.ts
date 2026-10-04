import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { assertDeliberationManagePermission, requireAppAuthContext } from "@/lib/server-auth";
import { getOpenRound, requireActiveSession } from "@/lib/rush/deliberation";
import { RushError, rushErrorResponse } from "@/lib/rush/server";

export const dynamic = "force-dynamic";

/** Open a vote on the PNM currently being presented. */
export async function POST() {
  try {
    const context = await requireAppAuthContext();
    assertDeliberationManagePermission(context);
    const session = await requireActiveSession();
    if (!session.current_pnm_id) throw new RushError(400, "Present a PNM before starting a vote.");
    if (await getOpenRound(session.id)) throw new RushError(409, "A vote is already open.");

    const { data, error } = await supabaseAdmin
      .from("delib_vote_rounds")
      .insert({
        session_id: session.id,
        cycle_id: session.cycle_id,
        stage: session.stage,
        pnm_id: session.current_pnm_id,
        opened_by: context.appUser.id,
      })
      .select("id")
      .single();
    if (error?.code === "23505") throw new RushError(409, "A vote is already open.");
    if (error) throw error;

    const roundId = (data as { id: string }).id;
    const { error: sessionError } = await supabaseAdmin
      .from("delib_sessions")
      .update({ current_round_id: roundId })
      .eq("id", session.id);
    if (sessionError) throw sessionError;
    return NextResponse.json({ id: roundId }, { status: 201 });
  } catch (error) {
    return rushErrorResponse(error, "Failed to start the vote.");
  }
}

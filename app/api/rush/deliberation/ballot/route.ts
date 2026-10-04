import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAppAuthContext } from "@/lib/server-auth";
import { canManageDeliberation } from "@/lib/permissions";
import { getParticipantStatus, requireActiveSession } from "@/lib/rush/deliberation";
import { readJson, RushError, rushErrorResponse, str } from "@/lib/rush/server";

export const dynamic = "force-dynamic";

const CHOICES = new Set(["yes", "no", "abstain"]);

/** Cast or change a vote while the round is open. */
export async function POST(request: Request) {
  try {
    const context = await requireAppAuthContext();
    const session = await requireActiveSession();
    const body = await readJson(request);
    const roundId = str(body.roundId, 64);
    const choice = String(body.choice);
    if (!roundId || !CHOICES.has(choice)) throw new RushError(400, "Choose yes, no or abstain.");

    const status = await getParticipantStatus(session.id, context.appUser.id);
    if (status !== "admitted" && !canManageDeliberation(context.permissions)) {
      throw new RushError(403, "You haven't been admitted to this deliberation.");
    }

    const { data: round, error: roundError } = await supabaseAdmin
      .from("delib_vote_rounds")
      .select("id")
      .eq("id", roundId)
      .eq("session_id", session.id)
      .maybeSingle();
    if (roundError) throw roundError;
    if (!round) throw new RushError(404, "Vote not found.");

    const { error } = await supabaseAdmin.rpc("delib_cast_ballot", {
      p_round_id: roundId,
      p_user_id: context.appUser.id,
      p_choice: choice,
    });
    if (error?.message?.includes("ROUND_CLOSED")) throw new RushError(409, "Voting has closed.");
    if (error) throw error;
    return NextResponse.json({ ok: true, choice });
  } catch (error) {
    return rushErrorResponse(error, "Failed to record your vote.");
  }
}

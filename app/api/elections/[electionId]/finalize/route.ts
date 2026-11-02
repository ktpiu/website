import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { assertElectionsManagePermission, requireAppAuthContext } from "@/lib/server-auth";
import { RushError, rushErrorResponse } from "@/lib/rush/server";
import { getElection } from "@/lib/elections/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ electionId: string }> };

/**
 * Locks the candidate list and starts the campaign: approved candidates submit
 * materials until the deadline and members can endorse. Refused while any
 * application is still pending.
 */
export async function POST(_request: Request, { params }: Params) {
  try {
    const context = await requireAppAuthContext();
    assertElectionsManagePermission(context);
    const { electionId } = await params;
    const election = await getElection(electionId);
    if (election.candidates_finalized_at) throw new RushError(409, "Candidates are already finalized.");
    if (election.phase !== "applications") throw new RushError(409, "Open applications before finalizing candidates.");

    const { data: seats, error } = await supabaseAdmin
      .from("election_candidacies")
      .select("status, election_candidates!inner(election_id)")
      .eq("election_candidates.election_id", electionId);
    if (error) throw error;
    const pending = (seats ?? []).filter((s) => s.status === "pending").length;
    if (pending > 0) {
      throw new RushError(409, `Approve or deny the ${pending} pending application${pending === 1 ? "" : "s"} first.`);
    }
    if (!(seats ?? []).some((s) => s.status === "approved")) {
      throw new RushError(409, "Approve at least one candidate first.");
    }

    const now = new Date().toISOString();
    const { data, error: updateError } = await supabaseAdmin
      .from("elections")
      .update({ phase: "campaign", candidates_finalized_at: now, updated_by: context.appUser.id, updated_at: now })
      .eq("id", electionId)
      .is("candidates_finalized_at", null)
      .select("*")
      .maybeSingle();
    if (updateError) throw updateError;
    if (!data) throw new RushError(409, "Candidates are already finalized.");
    return NextResponse.json({ election: data });
  } catch (error) {
    return rushErrorResponse(error, "Failed to finalize candidates.");
  }
}

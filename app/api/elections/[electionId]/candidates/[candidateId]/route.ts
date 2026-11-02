import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { assertElectionsManagePermission, requireAppAuthContext } from "@/lib/server-auth";
import { readJson, RushError, rushErrorResponse } from "@/lib/rush/server";
import {
  addCandidacies,
  getElection,
  getPositions,
  listCandidates,
  parsePositionIds,
} from "@/lib/elections/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ electionId: string; candidateId: string }> };

/**
 * Changes which positions a candidate is running for, until voting starts and
 * even after candidates are finalized. `positionIds` is the full list: new
 * seats are approved immediately, and pending or approved seats left out are
 * deleted along with their video and endorsements. Denied and voided seats
 * stay as decided.
 */
export async function PUT(request: Request, { params }: Params) {
  try {
    const context = await requireAppAuthContext();
    assertElectionsManagePermission(context);
    const { electionId, candidateId } = await params;
    const election = await getElection(electionId);
    if (!["setup", "applications", "campaign"].includes(election.phase)) {
      throw new RushError(409, "Positions can't be changed once voting starts.");
    }
    const positions = await getPositions(electionId);
    const positionIds = parsePositionIds((await readJson(request)).positionIds, positions);

    const { data: candidate, error } = await supabaseAdmin
      .from("election_candidates")
      .select("id, election_candidacies(id, position_id, status)")
      .eq("id", candidateId)
      .eq("election_id", electionId)
      .maybeSingle();
    if (error) throw error;
    if (!candidate) throw new RushError(404, "Candidate not found.");

    const seats = candidate.election_candidacies as Array<{ id: string; position_id: string; status: string }>;
    const active = seats.filter((s) => s.status === "pending" || s.status === "approved");
    const closed = new Set(seats.filter((s) => !active.includes(s)).map((s) => s.position_id));
    if (positionIds.some((id) => closed.has(id))) {
      throw new RushError(409, "A denied or voided position can't be added back here.");
    }

    // Add first, so a failure can't leave them running for nothing.
    await addCandidacies(candidateId, positionIds, "approved", context.appUser.id);
    const kept = new Set(positionIds);
    const dropped = active.filter((s) => !kept.has(s.position_id)).map((s) => s.id);
    if (dropped.length > 0) {
      const { error: deleteError } = await supabaseAdmin.from("election_candidacies").delete().in("id", dropped);
      if (deleteError) throw deleteError;
    }
    return NextResponse.json({ candidates: await listCandidates(electionId) });
  } catch (error) {
    return rushErrorResponse(error, "Failed to update the positions.");
  }
}

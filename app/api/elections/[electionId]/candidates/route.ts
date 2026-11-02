import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { assertElectionsManagePermission, requireAppAuthContext } from "@/lib/server-auth";
import { readJson, RushError, rushErrorResponse, str } from "@/lib/rush/server";
import { isLatePosition } from "@/lib/elections/types";
import {
  addCandidacies,
  getCandidateRow,
  getElection,
  getPositions,
  isActiveMember,
  listActiveMembers,
  listCandidates,
  parsePositionIds,
} from "@/lib/elections/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ electionId: string }> };

/** Every candidate and their seats, plus active members for adding campaigners. */
export async function GET(_request: Request, { params }: Params) {
  try {
    const context = await requireAppAuthContext();
    assertElectionsManagePermission(context);
    const { electionId } = await params;
    await getElection(electionId);
    const [candidates, members] = await Promise.all([listCandidates(electionId), listActiveMembers()]);
    return NextResponse.json({ candidates, members });
  } catch (error) {
    return rushErrorResponse(error, "Failed to load candidates.");
  }
}

/**
 * Adds a campaigner by hand (or more seats for an existing candidate). Their
 * seats are approved immediately; the transcript can be uploaded later by
 * them or an election manager. Once candidates are finalized, the list stays
 * locked except for seats added after that, until those seats are voted on.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const context = await requireAppAuthContext();
    assertElectionsManagePermission(context);
    const { electionId } = await params;
    const election = await getElection(electionId);
    if (election.phase === "closed") throw new RushError(409, "This election is closed.");
    const body = await readJson(request);
    const userId = str(body.userId, 64);
    if (!userId || !(await isActiveMember(userId))) throw new RushError(400, "Choose an active member.");
    const positions = await getPositions(electionId);
    const positionIds = parsePositionIds(body.positionIds, positions);
    if (election.candidates_finalized_at) {
      const late = new Set(positions.filter((p) => isLatePosition(election, p)).map((p) => p.id));
      if (positionIds.some((id) => !late.has(id))) {
        throw new RushError(409, "Candidates are finalized. Only positions added since then can take new campaigners.");
      }
      const { count, error } = await supabaseAdmin
        .from("election_rounds")
        .select("id", { count: "exact", head: true })
        .in("position_id", positionIds);
      if (error) throw error;
      if (count) throw new RushError(409, "That position has already been voted on.");
    }

    let candidate = await getCandidateRow(electionId, userId);
    if (!candidate) {
      const { error } = await supabaseAdmin.from("election_candidates").insert({
        election_id: electionId,
        user_id: userId,
        source: "manual",
        added_by: context.appUser.id,
      });
      if (error && error.code !== "23505") throw error;
      candidate = await getCandidateRow(electionId, userId);
      if (!candidate) throw new Error("Failed to add the campaigner.");
    }
    await addCandidacies(candidate.id, positionIds, "approved", context.appUser.id);
    return NextResponse.json({ candidates: await listCandidates(electionId) }, { status: 201 });
  } catch (error) {
    return rushErrorResponse(error, "Failed to add the campaigner.");
  }
}

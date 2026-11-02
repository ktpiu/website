import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { assertElectionsManagePermission, requireAppAuthContext } from "@/lib/server-auth";
import { readJson, RushError, rushErrorResponse, str } from "@/lib/rush/server";
import {
  assertDatesInOrder,
  getElection,
  getPositions,
  parseDeadline,
  parseElectionDate,
  removeElectionObject,
} from "@/lib/elections/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ electionId: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const context = await requireAppAuthContext();
    assertElectionsManagePermission(context);
    const { electionId } = await params;
    const [election, positions] = await Promise.all([getElection(electionId), getPositions(electionId)]);
    return NextResponse.json({ election, positions });
  } catch (error) {
    return rushErrorResponse(error, "Failed to load the election.");
  }
}

/**
 * Edits the settings (name, materials deadline, election date, join code) and opens
 * applications. Later phases have their own actions.
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const context = await requireAppAuthContext();
    assertElectionsManagePermission(context);
    const { electionId } = await params;
    const election = await getElection(electionId);
    if (election.phase === "closed") throw new RushError(409, "This election is closed.");
    const body = await readJson(request);

    const patch: Record<string, unknown> = {};
    if ("name" in body) {
      const name = str(body.name, 120);
      if (!name) throw new RushError(400, "Name the election.");
      patch.name = name;
    }
    if ("submissionDeadline" in body) patch.submission_deadline = parseDeadline(body.submissionDeadline);
    if ("electionDate" in body) patch.election_date = parseElectionDate(body.electionDate);
    assertDatesInOrder(
      (patch.submission_deadline as string | undefined) ?? election.submission_deadline,
      (patch.election_date as string | undefined) ?? election.election_date,
    );
    if ("requireJoinCode" in body && Boolean(body.requireJoinCode) !== election.require_join_code) {
      if (election.phase === "voting") throw new RushError(409, "Voting has started, so the join code setting is locked.");
      patch.require_join_code = Boolean(body.requireJoinCode);
    }
    if (body.phase === "applications") {
      if (election.phase !== "setup") throw new RushError(409, "Applications can only open from setup.");
      patch.phase = "applications";
    }
    if (Object.keys(patch).length === 0) throw new RushError(400, "Nothing to update.");

    patch.updated_by = context.appUser.id;
    patch.updated_at = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from("elections")
      .update(patch)
      .eq("id", electionId)
      .select("*")
      .single();
    if (error?.code === "23505") throw new RushError(409, "Another election is already underway.");
    if (error) throw error;
    return NextResponse.json({ election: data });
  } catch (error) {
    return rushErrorResponse(error, "Failed to update the election.");
  }
}

/**
 * Permanently deletes an election in any phase. Its positions, candidates,
 * votes and results cascade; the uploaded files are removed afterwards.
 */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const context = await requireAppAuthContext();
    assertElectionsManagePermission(context);
    const { electionId } = await params;
    await getElection(electionId);

    const [candidates, photos] = await Promise.all([
      supabaseAdmin.from("election_candidates").select("transcript_path").eq("election_id", electionId),
      supabaseAdmin
        .from("election_candidate_photos")
        .select("path, election_candidates!inner(election_id)")
        .eq("election_candidates.election_id", electionId),
    ]);
    if (candidates.error) throw candidates.error;
    if (photos.error) throw photos.error;

    const { error } = await supabaseAdmin.from("elections").delete().eq("id", electionId);
    if (error) throw error;

    await Promise.all([
      ...(candidates.data ?? []).map((c) => removeElectionObject(c.transcript_path)),
      ...(photos.data ?? []).map((p) => removeElectionObject(p.path)),
    ]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return rushErrorResponse(error, "Failed to delete the election.");
  }
}

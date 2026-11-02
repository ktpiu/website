import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { assertActiveMember, requireAppAuthContext } from "@/lib/server-auth";
import { RushError, rushErrorResponse } from "@/lib/rush/server";
import {
  addCandidacies,
  getCandidateRow,
  getMyCandidacy,
  getPositions,
  getRunningElection,
  parsePositionIds,
  removeElectionObject,
  uploadTranscript,
} from "@/lib/elections/server";

export const dynamic = "force-dynamic";

/**
 * Applies to run, or updates an application while applications are open.
 * Multipart: `positionIds` (JSON array) and `transcript` (PDF). A first
 * application needs a transcript; later ones may replace it. Seats still
 * pending review that are left out are withdrawn; decided ones stay.
 */
export async function POST(request: Request) {
  try {
    const context = await requireAppAuthContext();
    assertActiveMember(context);
    const election = await getRunningElection();
    if (!election || election.phase !== "applications" || election.candidates_finalized_at) {
      throw new RushError(409, "Applications aren't open right now.");
    }

    const form = await request.formData().catch(() => null);
    if (!form) throw new RushError(400, "Invalid request body.");
    let requested: unknown = null;
    try {
      requested = JSON.parse(String(form.get("positionIds") ?? "[]"));
    } catch {
      throw new RushError(400, "Choose at least one position.");
    }
    const positions = await getPositions(election.id);
    const positionIds = parsePositionIds(requested, positions);
    const transcript = form.get("transcript");
    const transcriptFile = transcript instanceof File && transcript.size > 0 ? transcript : null;

    const userId = context.appUser.id;
    const existing = await getCandidateRow(election.id, userId);
    if (!existing && !transcriptFile) throw new RushError(400, "Attach your unofficial IU transcript.");

    // Checked up front (the database enforces it too) so a rejected update
    // doesn't withdraw pending seats first. Approved seats count; denied and
    // withdrawn ones don't.
    const kept = new Set(positionIds);
    const current = existing?.election_candidacies ?? [];
    const approvedCount = current.filter((c) => c.status === "approved").length;
    const requestedCount = positionIds.filter(
      (id) => !current.some((c) => c.position_id === id && c.status !== "pending"),
    ).length;
    if (approvedCount + requestedCount > election.max_positions_per_candidate) {
      throw new RushError(409, `You can run for up to ${election.max_positions_per_candidate} positions.`);
    }

    const transcriptPath = transcriptFile ? await uploadTranscript(election.id, userId, transcriptFile) : null;
    try {
      let candidateId = existing?.id;
      if (!existing) {
        const { data, error } = await supabaseAdmin
          .from("election_candidates")
          .insert({
            election_id: election.id,
            user_id: userId,
            source: "application",
            transcript_path: transcriptPath,
            added_by: userId,
          })
          .select("id")
          .single();
        if (error?.code === "23505") throw new RushError(409, "You've already applied. Refresh to see your application.");
        if (error) throw error;
        candidateId = data.id as string;
      } else if (transcriptPath) {
        const { error } = await supabaseAdmin
          .from("election_candidates")
          .update({ transcript_path: transcriptPath })
          .eq("id", existing.id);
        if (error) throw error;
      }

      const dropped = (existing?.election_candidacies ?? [])
        .filter((c) => c.status === "pending" && !kept.has(c.position_id))
        .map((c) => c.id);
      if (dropped.length > 0) {
        const { error } = await supabaseAdmin.from("election_candidacies").delete().in("id", dropped);
        if (error) throw error;
      }
      await addCandidacies(candidateId!, positionIds, "pending", null);
    } catch (error) {
      await removeElectionObject(transcriptPath);
      throw error;
    }

    if (transcriptPath && existing?.transcript_path) await removeElectionObject(existing.transcript_path);
    return NextResponse.json({ mine: await getMyCandidacy(election.id, userId) });
  } catch (error) {
    return rushErrorResponse(error, "Failed to submit your application.");
  }
}

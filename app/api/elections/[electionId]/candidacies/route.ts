import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { assertElectionsManagePermission, requireAppAuthContext } from "@/lib/server-auth";
import { readJson, RushError, rushErrorResponse, str } from "@/lib/rush/server";
import { getElection, listCandidates, toElectionError } from "@/lib/elections/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ electionId: string }> };

type Decision = { candidacyId: string; status: "approved" | "denied" | "voided"; reason: string | null };

function parseDecisions(value: unknown): Decision[] {
  if (!Array.isArray(value) || value.length === 0) throw new RushError(400, "Nothing to decide.");
  return value.map((item) => {
    const row = (item ?? {}) as Record<string, unknown>;
    const candidacyId = str(row.candidacyId, 64);
    const status = row.status === "approved" || row.status === "denied" || row.status === "voided" ? row.status : null;
    if (!candidacyId || !status) throw new RushError(400, "Each decision needs a seat and approve, deny or void.");
    const reason = str(row.reason, 1000) || null;
    if (status !== "approved" && !reason) throw new RushError(400, "Give a reason. The candidate sees it.");
    return { candidacyId, status, reason: status === "approved" ? null : reason };
  });
}

/**
 * Approves or denies applications, one seat at a time (Approve all / Deny all
 * send several). Decisions can change until candidates are finalized. After
 * that, an approved candidacy can only be voided (for not meeting the
 * requirements), with a reason, until voting starts.
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const context = await requireAppAuthContext();
    assertElectionsManagePermission(context);
    const { electionId } = await params;
    const election = await getElection(electionId);
    const decisions = parseDecisions((await readJson(request)).decisions);
    const finalized = Boolean(election.candidates_finalized_at);
    if (finalized) {
      if (election.phase !== "campaign") throw new RushError(409, "Candidacies can't be voided once voting starts.");
      if (decisions.some((d) => d.status !== "voided")) {
        throw new RushError(409, "Candidates are finalized, so decisions are locked. You can still void a candidacy.");
      }
    } else {
      if (!["setup", "applications"].includes(election.phase)) throw new RushError(409, "Decisions are locked.");
      if (decisions.some((d) => d.status === "voided")) throw new RushError(409, "Deny the application instead.");
    }

    // Only seats in this election.
    const { data: seats, error } = await supabaseAdmin
      .from("election_candidacies")
      .select("id, status, election_candidates!inner(election_id)")
      .in("id", decisions.map((d) => d.candidacyId))
      .eq("election_candidates.election_id", electionId);
    if (error) throw error;
    const known = new Map((seats ?? []).map((s) => [s.id as string, s.status as string]));
    if (decisions.some((d) => !known.has(d.candidacyId))) throw new RushError(404, "Application not found.");
    const allowedFrom = finalized ? ["approved"] : ["pending", "approved", "denied"];
    if (decisions.some((d) => !allowedFrom.includes(known.get(d.candidacyId)!))) {
      throw new RushError(409, finalized ? "Only approved candidacies can be voided." : "Withdrawn applications can't be decided.");
    }

    const decidedAt = new Date().toISOString();
    for (const d of decisions) {
      const { error: updateError } = await supabaseAdmin
        .from("election_candidacies")
        .update({ status: d.status, decision_reason: d.reason, decided_by: context.appUser.id, decided_at: decidedAt })
        .eq("id", d.candidacyId);
      if (updateError) throw toElectionError(updateError);
    }
    return NextResponse.json({ candidates: await listCandidates(electionId) });
  } catch (error) {
    return rushErrorResponse(error, "Failed to save the decision.");
  }
}

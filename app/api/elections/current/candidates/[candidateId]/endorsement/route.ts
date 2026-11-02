import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { assertActiveMember, requireAppAuthContext } from "@/lib/server-auth";
import { readJson, RushError, rushErrorResponse } from "@/lib/rush/server";
import { getRunningElection } from "@/lib/elections/server";
import { parseEndorsement } from "@/lib/elections/endorsements";
import { endorsementsOpen, ON_BALLOT_STATUSES } from "@/lib/elections/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ candidateId: string }> };

/** The candidate, if they're on the current ballot and endorsements are open. */
async function resolveTarget(candidateId: string) {
  const election = await getRunningElection();
  if (!election || !endorsementsOpen(election)) throw new RushError(409, "Endorsements aren't open right now.");
  const { data, error } = await supabaseAdmin
    .from("election_candidates")
    .select("id, user_id, election_candidacies!inner(status)")
    .eq("id", candidateId)
    .eq("election_id", election.id)
    .in("election_candidacies.status", ON_BALLOT_STATUSES)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new RushError(404, "Candidate not found.");
  return data as { id: string; user_id: string };
}

/**
 * Writes the member's one endorsement of this candidate: text (up to 100
 * words) or a video link (up to 1.5 minutes). Any edit goes back to the
 * Standards Board for approval.
 */
export async function PUT(request: Request, { params }: Params) {
  try {
    const context = await requireAppAuthContext();
    assertActiveMember(context);
    const { candidateId } = await params;
    const target = await resolveTarget(candidateId);
    if (target.user_id === context.appUser.id) throw new RushError(400, "You can't endorse yourself.");
    const endorsement = parseEndorsement(await readJson(request));

    const { data, error } = await supabaseAdmin
      .from("election_endorsements")
      .upsert(
        {
          candidate_id: candidateId,
          author_user_id: context.appUser.id,
          ...endorsement,
          status: "pending",
          reviewed_by: null,
          reviewed_at: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "candidate_id,author_user_id" },
      )
      .select("id, kind, body, video_url, status")
      .single();
    if (error?.message?.includes("SELF_ENDORSEMENT")) throw new RushError(400, "You can't endorse yourself.");
    if (error) throw error;
    return NextResponse.json({ endorsement: data });
  } catch (error) {
    return rushErrorResponse(error, "Failed to save your endorsement.");
  }
}

/** Withdraws the member's endorsement. */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const context = await requireAppAuthContext();
    assertActiveMember(context);
    const { candidateId } = await params;
    await resolveTarget(candidateId);
    const { error } = await supabaseAdmin
      .from("election_endorsements")
      .delete()
      .eq("candidate_id", candidateId)
      .eq("author_user_id", context.appUser.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return rushErrorResponse(error, "Failed to withdraw your endorsement.");
  }
}

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { assertActiveMember, requireAppAuthContext } from "@/lib/server-auth";
import { readJson, RushError, rushErrorResponse } from "@/lib/rush/server";
import { getRunningElection } from "@/lib/elections/server";
import { parseEndorsement } from "@/lib/elections/endorsements";
import { endorsementsOpen, ON_BALLOT_STATUSES } from "@/lib/elections/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ candidateId: string }> };

/** The candidate's role from `?candidacyId=`, if on the current ballot and endorsements are open. */
async function resolveTarget(request: Request, candidateId: string) {
  const candidacyId = new URL(request.url).searchParams.get("candidacyId");
  if (!candidacyId) throw new RushError(400, "Choose a position to endorse.");
  const election = await getRunningElection();
  if (!election || !endorsementsOpen(election)) throw new RushError(409, "Endorsements aren't open right now.");
  const { data, error } = await supabaseAdmin
    .from("election_candidates")
    .select("id, user_id, election_candidacies!inner(id, status)")
    .eq("id", candidateId)
    .eq("election_id", election.id)
    .eq("election_candidacies.id", candidacyId)
    .in("election_candidacies.status", ON_BALLOT_STATUSES)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new RushError(404, "Candidate not found.");
  return { ...(data as { id: string; user_id: string }), candidacyId };
}

/**
 * Writes the member's one endorsement of this candidate for this role: text (up to 100
 * words) or a video link (up to 1.5 minutes). Any edit goes back to the
 * Standards Board for approval.
 */
export async function PUT(request: Request, { params }: Params) {
  try {
    const context = await requireAppAuthContext();
    assertActiveMember(context);
    const { candidateId } = await params;
    const target = await resolveTarget(request, candidateId);
    if (target.user_id === context.appUser.id) throw new RushError(400, "You can't endorse yourself.");
    const endorsement = parseEndorsement(await readJson(request));

    const { data, error } = await supabaseAdmin
      .from("election_endorsements")
      .upsert(
        {
          candidate_id: candidateId,
          candidacy_id: target.candidacyId,
          author_user_id: context.appUser.id,
          ...endorsement,
          status: "pending",
          reviewed_by: null,
          reviewed_at: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "candidacy_id,author_user_id" },
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
export async function DELETE(request: Request, { params }: Params) {
  try {
    const context = await requireAppAuthContext();
    assertActiveMember(context);
    const { candidateId } = await params;
    const { candidacyId } = await resolveTarget(request, candidateId);
    const { error } = await supabaseAdmin
      .from("election_endorsements")
      .delete()
      .eq("candidacy_id", candidacyId)
      .eq("author_user_id", context.appUser.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return rushErrorResponse(error, "Failed to withdraw your endorsement.");
  }
}

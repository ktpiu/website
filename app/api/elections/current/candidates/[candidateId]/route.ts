import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { assertActiveMember, requireAppAuthContext } from "@/lib/server-auth";
import { RushError, rushErrorResponse } from "@/lib/rush/server";
import { getPositions, getRunningElection } from "@/lib/elections/server";
import { getCandidatePhotos } from "@/lib/elections/materials";
import { ON_BALLOT_STATUSES, profilesOpen, type CandidateProfile, type MyEndorsement } from "@/lib/elections/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ candidateId: string }> };

type Row = {
  id: string;
  user_id: string;
  intro: string | null;
  awards: string | null;
  users: { name: string; avatar: string | null } | null;
  election_candidacies: Array<{ position_id: string; status: string; video_url: string | null }>;
};

type EndorsementRow = MyEndorsement & {
  author_user_id: string;
  author: { name: string } | null;
};

/**
 * A candidate's profile for active members once registration closes, with
 * approved endorsements. Their materials follow at the deadline (candidates
 * can preview their own earlier). Never includes the transcript.
 */
export async function GET(_request: Request, { params }: Params) {
  try {
    const context = await requireAppAuthContext();
    assertActiveMember(context);
    const { candidateId } = await params;
    const election = await getRunningElection();
    if (!election?.candidates_finalized_at) throw new RushError(404, "Candidate not found.");

    const { data, error } = await supabaseAdmin
      .from("election_candidates")
      .select(
        "id, user_id, intro, awards, users!election_candidates_user_id_fkey(name, avatar), election_candidacies(position_id, status, video_url)",
      )
      .eq("id", candidateId)
      .eq("election_id", election.id)
      .maybeSingle();
    if (error) throw error;
    const row = data as unknown as Row | null;
    const onBallot = (row?.election_candidacies ?? []).filter((c) => (ON_BALLOT_STATUSES as string[]).includes(c.status));
    if (!row || onBallot.length === 0) throw new RushError(404, "Candidate not found.");

    const isMe = row.user_id === context.appUser.id;
    const materialsVisible = isMe || profilesOpen(election);

    const [positions, photos, endorsements] = await Promise.all([
      getPositions(election.id),
      materialsVisible ? getCandidatePhotos(row.id) : [],
      supabaseAdmin
        .from("election_endorsements")
        .select("id, kind, body, video_url, status, author_user_id, author:users!election_endorsements_author_user_id_fkey(name)")
        .eq("candidate_id", row.id)
        .order("created_at"),
    ]);
    if (endorsements.error) throw endorsements.error;
    const order = new Map(positions.map((p) => [p.id, p]));
    const endorsementRows = (endorsements.data ?? []) as unknown as EndorsementRow[];
    const mine = endorsementRows.find((e) => e.author_user_id === context.appUser.id);

    const profile: CandidateProfile = {
      candidate_id: row.id,
      name: row.users?.name ?? "",
      avatar: row.users?.avatar ?? null,
      is_me: isMe,
      materials_visible: materialsVisible,
      intro: materialsVisible ? (row.intro ?? "") : "",
      awards: materialsVisible ? (row.awards ?? "") : "",
      photos,
      seats: onBallot
        .filter((c) => order.has(c.position_id))
        .sort((a, b) => order.get(a.position_id)!.sort_order - order.get(b.position_id)!.sort_order)
        .map((c) => ({ position_id: c.position_id, title: order.get(c.position_id)!.title, video_url: materialsVisible ? c.video_url : null })),
      endorsements: endorsementRows
        .filter((e) => e.status === "approved")
        .map((e) => ({
          id: e.id,
          author_name: e.author?.name ?? "A member",
          kind: e.kind,
          body: e.body,
          video_url: e.video_url,
        })),
      my_endorsement: mine
        ? { id: mine.id, kind: mine.kind, body: mine.body, video_url: mine.video_url, status: mine.status }
        : null,
    };
    return NextResponse.json({ election, profile });
  } catch (error) {
    return rushErrorResponse(error, "Failed to load the candidate.");
  }
}

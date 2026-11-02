import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { RushError } from "@/lib/rush/server";
import { getPositions } from "@/lib/elections/server";
import {
  ENDORSEMENT_MAX_WORDS,
  isVideoLink,
  ON_BALLOT_STATUSES,
  wordCount,
  type BallotCandidate,
  type EndorsementKind,
  type MyEndorsement,
} from "@/lib/elections/types";

type BallotRow = {
  id: string;
  user_id: string;
  users: { name: string; avatar: string | null } | null;
  election_candidacies: Array<{ id: string; position_id: string; status: string }>;
};

/**
 * Candidates on the ballot (any seat approved or since decided), in ballot
 * order, with the viewer's own endorsement for each role. Nothing private: no
 * transcript, and only a count of approved endorsements once `showEndorsements`.
 */
export async function listBallotCandidates(
  electionId: string,
  viewerId: string,
  showEndorsements: boolean,
): Promise<BallotCandidate[]> {
  const [positions, candidates, mine, approved] = await Promise.all([
    getPositions(electionId),
    supabaseAdmin
      .from("election_candidates")
      .select("id, user_id, users!election_candidates_user_id_fkey(name, avatar), election_candidacies(id, position_id, status)")
      .eq("election_id", electionId),
    supabaseAdmin
      .from("election_endorsements")
      .select("id, candidacy_id, kind, body, video_url, status, election_candidates!inner(election_id)")
      .eq("author_user_id", viewerId)
      .eq("election_candidates.election_id", electionId),
    showEndorsements
      ? supabaseAdmin
          .from("election_endorsements")
          .select("candidacy_id, election_candidates!inner(election_id)")
          .eq("status", "approved")
          .eq("election_candidates.election_id", electionId)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (candidates.error) throw candidates.error;
  if (mine.error) throw mine.error;
  if (approved.error) throw approved.error;

  const endorsementCounts = new Map<string, number>();
  for (const e of (approved.data ?? []) as unknown as Array<{ candidacy_id: string }>) {
    endorsementCounts.set(e.candidacy_id, (endorsementCounts.get(e.candidacy_id) ?? 0) + 1);
  }

  const order = new Map(positions.map((p) => [p.id, p]));
  const myByCandidacy = new Map(
    ((mine.data ?? []) as unknown as Array<MyEndorsement & { candidacy_id: string }>).map((e) => [
      e.candidacy_id,
      { id: e.id, kind: e.kind, body: e.body, video_url: e.video_url, status: e.status },
    ]),
  );

  return ((candidates.data ?? []) as unknown as BallotRow[])
    .map((row) => {
      const seats = row.election_candidacies
        .filter((c) => (ON_BALLOT_STATUSES as string[]).includes(c.status) && order.has(c.position_id))
        .sort((a, b) => order.get(a.position_id)!.sort_order - order.get(b.position_id)!.sort_order)
        .map((c) => ({
          candidacy_id: c.id,
          position_id: c.position_id,
          title: order.get(c.position_id)!.title,
          endorsement_count: endorsementCounts.get(c.id) ?? 0,
          my_endorsement: myByCandidacy.get(c.id) ?? null,
        }));
      return {
        candidate_id: row.id,
        name: row.users?.name ?? "",
        avatar: row.users?.avatar ?? null,
        is_me: row.user_id === viewerId,
        seats,
      };
    })
    .filter((c) => c.seats.length > 0)
    .sort(
      (a, b) =>
        order.get(a.seats[0].position_id)!.sort_order - order.get(b.seats[0].position_id)!.sort_order ||
        a.name.localeCompare(b.name),
    );
}

export function parseEndorsement(body: Record<string, unknown>): {
  kind: EndorsementKind;
  body: string | null;
  video_url: string | null;
} {
  if (body.kind === "text") {
    const text = typeof body.body === "string" ? body.body.trim() : "";
    if (!text) throw new RushError(400, "Write your endorsement.");
    if (wordCount(text) > ENDORSEMENT_MAX_WORDS) {
      throw new RushError(400, `Keep written endorsements to ${ENDORSEMENT_MAX_WORDS} words.`);
    }
    return { kind: "text", body: text, video_url: null };
  }
  if (body.kind === "video") {
    const url = typeof body.videoUrl === "string" ? body.videoUrl.trim().slice(0, 500) : "";
    if (!isVideoLink(url)) {
      throw new RushError(400, "Video endorsements must be a YouTube or Google Drive link (starting with https://).");
    }
    return { kind: "video", body: null, video_url: url };
  }
  throw new RushError(400, "Choose a written or video endorsement.");
}

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
  election_candidacies: Array<{ position_id: string; status: string }>;
};

/**
 * Candidates on the ballot (any seat approved or since decided), in ballot
 * order, with the viewer's own endorsement of each. Nothing private: no
 * transcript, no other members' endorsements.
 */
export async function listBallotCandidates(electionId: string, viewerId: string): Promise<BallotCandidate[]> {
  const [positions, candidates, mine] = await Promise.all([
    getPositions(electionId),
    supabaseAdmin
      .from("election_candidates")
      .select("id, user_id, users!election_candidates_user_id_fkey(name, avatar), election_candidacies(position_id, status)")
      .eq("election_id", electionId),
    supabaseAdmin
      .from("election_endorsements")
      .select("id, candidate_id, kind, body, video_url, status, election_candidates!inner(election_id)")
      .eq("author_user_id", viewerId)
      .eq("election_candidates.election_id", electionId),
  ]);
  if (candidates.error) throw candidates.error;
  if (mine.error) throw mine.error;

  const order = new Map(positions.map((p) => [p.id, p]));
  const myByCandidate = new Map(
    ((mine.data ?? []) as Array<MyEndorsement & { candidate_id: string }>).map((e) => [
      e.candidate_id,
      { id: e.id, kind: e.kind, body: e.body, video_url: e.video_url, status: e.status },
    ]),
  );

  return ((candidates.data ?? []) as unknown as BallotRow[])
    .map((row) => {
      const seats = row.election_candidacies
        .filter((c) => (ON_BALLOT_STATUSES as string[]).includes(c.status) && order.has(c.position_id))
        .sort((a, b) => order.get(a.position_id)!.sort_order - order.get(b.position_id)!.sort_order)
        .map((c) => ({ position_id: c.position_id, title: order.get(c.position_id)!.title }));
      return {
        candidate_id: row.id,
        name: row.users?.name ?? "",
        avatar: row.users?.avatar ?? null,
        is_me: row.user_id === viewerId,
        seats,
        my_endorsement: myByCandidate.get(row.id) ?? null,
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

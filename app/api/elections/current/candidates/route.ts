import { NextResponse } from "next/server";
import { assertActiveMember, requireAppAuthContext } from "@/lib/server-auth";
import { rushErrorResponse } from "@/lib/rush/server";
import { getPositions, getRunningElection } from "@/lib/elections/server";
import { listBallotCandidates } from "@/lib/elections/endorsements";

export const dynamic = "force-dynamic";

/** The finalized candidates of the election underway, for active members. */
export async function GET() {
  try {
    const context = await requireAppAuthContext();
    assertActiveMember(context);
    const election = await getRunningElection();
    if (!election || !election.candidates_finalized_at) {
      return NextResponse.json({ election, positions: [], candidates: [] });
    }
    const [positions, candidates] = await Promise.all([
      getPositions(election.id),
      listBallotCandidates(election.id, context.appUser.id),
    ]);
    return NextResponse.json({ election, positions, candidates });
  } catch (error) {
    return rushErrorResponse(error, "Failed to load candidates.");
  }
}

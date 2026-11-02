import { NextResponse } from "next/server";
import { assertActiveMember, requireAppAuthContext } from "@/lib/server-auth";
import { rushErrorResponse } from "@/lib/rush/server";
import { getMyCandidacy, getPositions, getRunningElection } from "@/lib/elections/server";

export const dynamic = "force-dynamic";

/** The election underway, its seats, and the signed-in member's own candidacy. */
export async function GET() {
  try {
    const context = await requireAppAuthContext();
    assertActiveMember(context);
    const election = await getRunningElection();
    if (!election) return NextResponse.json({ election: null, positions: [], mine: null });
    const [positions, mine] = await Promise.all([
      getPositions(election.id),
      getMyCandidacy(election.id, context.appUser.id),
    ]);
    return NextResponse.json({ election, positions, mine });
  } catch (error) {
    return rushErrorResponse(error, "Failed to load the election.");
  }
}

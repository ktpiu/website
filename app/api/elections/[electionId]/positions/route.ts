import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { assertElectionsManagePermission, requireAppAuthContext } from "@/lib/server-auth";
import { readJson, RushError, rushErrorResponse } from "@/lib/rush/server";
import { getElection, getPositions, parseRoleIds, parseSeats, syncPositions } from "@/lib/elections/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ electionId: string }> };

/**
 * Replaces the seats on the ballot with `roleIds`. Seats can be added at any
 * point until the election closes; one with candidates can't be removed.
 * Once voting starts, existing seats keep their number of winners.
 */
export async function PUT(request: Request, { params }: Params) {
  try {
    const context = await requireAppAuthContext();
    assertElectionsManagePermission(context);
    const { electionId } = await params;
    const election = await getElection(electionId);
    if (election.phase === "closed") throw new RushError(409, "This election is closed.");
    const body = await readJson(request);
    const seats = parseSeats(body.seats);
    if (election.phase === "voting") {
      for (const p of await getPositions(electionId)) if (p.role_id) seats[p.role_id] = p.seats;
    }
    await syncPositions(electionId, parseRoleIds(body.roleIds), seats);

    const { error } = await supabaseAdmin
      .from("elections")
      .update({ updated_by: context.appUser.id, updated_at: new Date().toISOString() })
      .eq("id", electionId);
    if (error) throw error;
    return NextResponse.json({ positions: await getPositions(electionId) });
  } catch (error) {
    return rushErrorResponse(error, "Failed to update positions.");
  }
}

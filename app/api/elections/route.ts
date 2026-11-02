import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { assertElectionsManagePermission, requireAppAuthContext } from "@/lib/server-auth";
import { readJson, RushError, rushErrorResponse, str } from "@/lib/rush/server";
import {
  getBallotRoles,
  parseDeadline,
  parseMaxPositions,
  parseRoleIds,
  syncPositions,
} from "@/lib/elections/server";

export const dynamic = "force-dynamic";

/** Every election, newest first, plus the roles that can go on a ballot. */
export async function GET() {
  try {
    const context = await requireAppAuthContext();
    assertElectionsManagePermission(context);
    const [{ data, error }, roles] = await Promise.all([
      supabaseAdmin.from("elections").select("*").order("created_at", { ascending: false }),
      getBallotRoles(),
    ]);
    if (error) throw error;
    return NextResponse.json({ elections: data ?? [], roles });
  } catch (error) {
    return rushErrorResponse(error, "Failed to load elections.");
  }
}

/** Creates an election in setup with its seats. */
export async function POST(request: Request) {
  try {
    const context = await requireAppAuthContext();
    assertElectionsManagePermission(context);
    const body = await readJson(request);

    const name = str(body.name, 120);
    if (!name) throw new RushError(400, "Name the election.");
    const deadline = parseDeadline(body.submissionDeadline);
    const maxPositions = parseMaxPositions(body.maxPositionsPerCandidate ?? 2);
    const roleIds = parseRoleIds(body.roleIds);

    const { data, error } = await supabaseAdmin
      .from("elections")
      .insert({
        name,
        submission_deadline: deadline,
        max_positions_per_candidate: maxPositions,
        created_by: context.appUser.id,
        updated_by: context.appUser.id,
      })
      .select("*")
      .single();
    if (error) throw error;

    try {
      await syncPositions(data.id, roleIds);
    } catch (positionsError) {
      await supabaseAdmin.from("elections").delete().eq("id", data.id);
      throw positionsError;
    }
    return NextResponse.json({ election: data }, { status: 201 });
  } catch (error) {
    return rushErrorResponse(error, "Failed to create the election.");
  }
}

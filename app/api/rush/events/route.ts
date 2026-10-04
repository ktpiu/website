import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { assertRushManagePermission, requireAppAuthContext } from "@/lib/server-auth";
import { parseEventBody } from "@/lib/rush/events";
import { loadMemberEvents } from "@/lib/rush/member-events";
import { readJson, resolveCycle, RushError, rushErrorResponse, str } from "@/lib/rush/server";

export const dynamic = "force-dynamic";

/** A cycle's events with timeslot rosters (see loadMemberEvents). */
export async function GET(request: Request) {
  try {
    const context = await requireAppAuthContext();
    const cycle = await resolveCycle(request);
    if (!cycle) return NextResponse.json({ cycle: null, events: [] });
    const events = await loadMemberEvents(context, request, { cycleId: cycle.id });
    return NextResponse.json({ cycle, events });
  } catch (error) {
    return rushErrorResponse(error, "Failed to load rush events.");
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireAppAuthContext();
    assertRushManagePermission(context);
    const body = await readJson(request);
    const cycleId = str(body.cycleId, 64);
    if (!cycleId) throw new RushError(400, "Choose a rush cycle.");

    const { data, error } = await supabaseAdmin
      .from("rush_events")
      .insert({ cycle_id: cycleId, ...parseEventBody(body, false) })
      .select("id")
      .single();
    if (error) throw error;
    return NextResponse.json({ id: (data as { id: string }).id }, { status: 201 });
  } catch (error) {
    return rushErrorResponse(error, "Failed to create the event.");
  }
}

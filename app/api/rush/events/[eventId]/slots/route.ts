import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { assertRushManagePermission, requireAppAuthContext } from "@/lib/server-auth";
import { getEvent, parseSlotBody } from "@/lib/rush/events";
import { readJson, rushErrorResponse } from "@/lib/rush/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ eventId: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const context = await requireAppAuthContext();
    assertRushManagePermission(context);
    const { eventId } = await params;
    const event = await getEvent(eventId);
    const { data, error } = await supabaseAdmin
      .from("rush_event_slots")
      .insert({ event_id: event.id, ...parseSlotBody(await readJson(request), false) })
      .select("id")
      .single();
    if (error) throw error;
    if (!event.has_timeslots) {
      await supabaseAdmin.from("rush_events").update({ has_timeslots: true }).eq("id", event.id);
    }
    return NextResponse.json({ id: (data as { id: string }).id }, { status: 201 });
  } catch (error) {
    return rushErrorResponse(error, "Failed to add the timeslot.");
  }
}

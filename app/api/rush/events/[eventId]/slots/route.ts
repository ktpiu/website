import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { assertRushManagePermission, requireAppAuthContext } from "@/lib/server-auth";
import { getEvent, parseSlotBody } from "@/lib/rush/events";
import { readJson, RushError, rushErrorResponse } from "@/lib/rush/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ eventId: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const context = await requireAppAuthContext();
    assertRushManagePermission(context);
    const { eventId } = await params;
    const event = await getEvent(eventId);
    const body = await readJson(request);
    // Accepts one slot, or { slots: [...] } to add a whole row/column at once.
    const items = Array.isArray(body.slots) ? (body.slots as Record<string, unknown>[]) : [body];
    if (items.length === 0 || items.length > 200) throw new RushError(400, "Add between 1 and 200 timeslots at a time.");
    const { data, error } = await supabaseAdmin
      .from("rush_event_slots")
      .insert(items.map((item) => ({ event_id: event.id, ...parseSlotBody(item, false) })))
      .select("id");
    if (error) throw error;
    if (!event.has_timeslots) {
      await supabaseAdmin.from("rush_events").update({ has_timeslots: true }).eq("id", event.id);
    }
    const ids = (data as { id: string }[]).map((r) => r.id);
    return NextResponse.json({ id: ids[0], ids }, { status: 201 });
  } catch (error) {
    return rushErrorResponse(error, "Failed to add the timeslot.");
  }
}

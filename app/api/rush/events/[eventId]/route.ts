import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { assertRushManagePermission, requireAppAuthContext } from "@/lib/server-auth";
import { getEvent, parseEventBody } from "@/lib/rush/events";
import { loadMemberEvents } from "@/lib/rush/member-events";
import { readJson, removeRushObject, RushError, rushErrorResponse } from "@/lib/rush/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ eventId: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const context = await requireAppAuthContext();
    const { eventId } = await params;
    const [event] = await loadMemberEvents(context, request, { eventId });
    if (!event) throw new RushError(404, "Event not found.");
    return NextResponse.json({ event });
  } catch (error) {
    return rushErrorResponse(error, "Failed to load the event.");
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const context = await requireAppAuthContext();
    assertRushManagePermission(context);
    const { eventId } = await params;
    await getEvent(eventId);
    const patch = parseEventBody(await readJson(request), true);
    const { error } = await supabaseAdmin
      .from("rush_events")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", eventId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return rushErrorResponse(error, "Failed to update the event.");
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const context = await requireAppAuthContext();
    assertRushManagePermission(context);
    const { eventId } = await params;
    const event = await getEvent(eventId);
    const { error } = await supabaseAdmin.from("rush_events").delete().eq("id", eventId);
    if (error) throw error;
    await removeRushObject(event.image_path);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return rushErrorResponse(error, "Failed to delete the event.");
  }
}

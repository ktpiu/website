import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { assertRushManagePermission, requireAppAuthContext } from "@/lib/server-auth";
import { getSlot, parseSlotBody } from "@/lib/rush/events";
import { readJson, rushErrorResponse } from "@/lib/rush/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slotId: string }> };

/**
 * Edit a slot. Lowering a capacity below current signups keeps everyone who
 * is already booked; it only blocks new bookings.
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const context = await requireAppAuthContext();
    assertRushManagePermission(context);
    const { slotId } = await params;
    await getSlot(slotId);
    const { error } = await supabaseAdmin
      .from("rush_event_slots")
      .update(parseSlotBody(await readJson(request), true))
      .eq("id", slotId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return rushErrorResponse(error, "Failed to update the timeslot.");
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const context = await requireAppAuthContext();
    assertRushManagePermission(context);
    const { slotId } = await params;
    const { error } = await supabaseAdmin.from("rush_event_slots").delete().eq("id", slotId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return rushErrorResponse(error, "Failed to delete the timeslot.");
  }
}

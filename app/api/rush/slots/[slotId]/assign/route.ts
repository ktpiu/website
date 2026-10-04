import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { assertRushManagePermission, requireAppAuthContext } from "@/lib/server-auth";
import { getEvent, getSlot } from "@/lib/rush/events";
import { notifySlotUpdate } from "@/lib/rush/notify";
import { getPnm, readJson, RushError, rushErrorResponse, str, toSlotError } from "@/lib/rush/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slotId: string }> };

/**
 * Admin placement of a PNM or active into a slot, ignoring capacity, cutoff
 * and admin-only locks. A PNM already in another slot of the event is moved.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const context = await requireAppAuthContext();
    assertRushManagePermission(context);
    const { slotId } = await params;
    const body = await readJson(request);
    const pnmId = str(body.pnmId, 64) || null;
    const userId = str(body.userId, 64) || null;
    if (!pnmId === !userId) throw new RushError(400, "Choose a PNM or an active.");

    const slot = await getSlot(slotId);
    const event = await getEvent(slot.event_id);

    let previous: string | null = null;
    if (pnmId) {
      const { data } = await supabaseAdmin
        .from("rush_slot_signups")
        .select("slot_id")
        .eq("event_id", event.id)
        .eq("pnm_id", pnmId)
        .maybeSingle();
      previous = (data as { slot_id: string } | null)?.slot_id ?? null;
    }

    const { error } = await supabaseAdmin.rpc("rush_book_slot", {
      p_slot_id: slot.id,
      p_pnm_id: pnmId,
      p_user_id: userId,
      p_admin: true,
    });
    const slotError = toSlotError(error);
    if (slotError) throw slotError;

    if (pnmId && previous !== slot.id) {
      notifySlotUpdate(await getPnm(pnmId), event.title, previous ? "moved" : "booked", slot, request);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return rushErrorResponse(error, "Failed to assign the timeslot.");
  }
}

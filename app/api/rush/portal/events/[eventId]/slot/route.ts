import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requirePnmAuthContext } from "@/lib/rush/pnm-auth";
import { getVisibleEventForPnm } from "@/lib/rush/portal";
import { notifySlotUpdate } from "@/lib/rush/notify";
import { readJson, RushError, rushErrorResponse, str, toSlotError } from "@/lib/rush/server";
import type { RushSlotRecord } from "@/lib/rush/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ eventId: string }> };

async function loadSlot(slotId: string) {
  const { data, error } = await supabaseAdmin.from("rush_event_slots").select("*").eq("id", slotId).maybeSingle();
  if (error) throw error;
  return data as RushSlotRecord | null;
}

/** Book (or move to) a slot. Capacity, one-slot and change rules run in Postgres. */
export async function POST(request: Request, { params }: Params) {
  try {
    const { eventId } = await params;
    const { pnm } = await requirePnmAuthContext();
    const event = await getVisibleEventForPnm(pnm, eventId);
    const slotId = str((await readJson(request)).slotId, 64);
    const slot = slotId ? await loadSlot(slotId) : null;
    if (!slot || slot.event_id !== event.id) throw new RushError(404, "Timeslot not found.");

    const { data: before } = await supabaseAdmin
      .from("rush_slot_signups")
      .select("slot_id")
      .eq("event_id", event.id)
      .eq("pnm_id", pnm.id)
      .maybeSingle();

    const { error } = await supabaseAdmin.rpc("rush_book_slot", { p_slot_id: slot.id, p_pnm_id: pnm.id });
    const slotError = toSlotError(error);
    if (slotError) throw slotError;

    const previous = (before as { slot_id: string } | null)?.slot_id;
    if (previous !== slot.id) {
      notifySlotUpdate(pnm, event.title, previous ? "moved" : "booked", slot, request);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return rushErrorResponse(error, "Failed to book the timeslot.");
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    const { eventId } = await params;
    const { pnm } = await requirePnmAuthContext();
    const event = await getVisibleEventForPnm(pnm, eventId);

    const { data: signup, error: lookupError } = await supabaseAdmin
      .from("rush_slot_signups")
      .select("id")
      .eq("event_id", event.id)
      .eq("pnm_id", pnm.id)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (!signup) throw new RushError(404, "You don't have a timeslot for this event.");

    const { error } = await supabaseAdmin.rpc("rush_cancel_signup", { p_signup_id: (signup as { id: string }).id });
    const slotError = toSlotError(error);
    if (slotError) throw slotError;

    notifySlotUpdate(pnm, event.title, "cancelled", null, request);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return rushErrorResponse(error, "Failed to cancel the timeslot.");
  }
}

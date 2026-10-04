import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAppAuthContext } from "@/lib/server-auth";
import { canManageRush, canViewActiveAttendance } from "@/lib/permissions";
import { getEvent } from "@/lib/rush/events";
import { ensureCycleEntry, getPnm, readJson, RushError, rushErrorResponse, str } from "@/lib/rush/server";
import type { AttendanceStatus } from "@/lib/rush/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ eventId: string }> };

const STATUSES: AttendanceStatus[] = ["present", "late", "no_show"];

/**
 * Marks a PNM ({ pnmId }) or an active ({ userId }) present, late or no-show;
 * status null clears the mark.
 * - Rush managers can mark anyone.
 * - Holders of the active-attendance permission can mark actives.
 * - Actives signed up for the event can mark PNMs when QR check-in is off
 *   (only no-shows when the event doesn't take attendance).
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const context = await requireAppAuthContext();
    const { eventId } = await params;
    const event = await getEvent(eventId);
    const body = await readJson(request);

    const status = body.status === null ? null : (str(body.status, 16) as AttendanceStatus);
    if (status !== null && !STATUSES.includes(status)) throw new RushError(400, "Choose present, late or no-show.");
    const pnmId = str(body.pnmId, 64);
    const userId = str(body.userId, 64);
    if (Boolean(pnmId) === Boolean(userId)) throw new RushError(400, "Choose one person to mark.");

    const manage = canManageRush(context.permissions);
    if (userId) {
      if (!manage && !canViewActiveAttendance(context.permissions)) {
        throw new RushError(403, "You can't change active attendance.");
      }
    } else if (!manage) {
      const { data, error } = await supabaseAdmin
        .from("rush_slot_signups")
        .select("id")
        .eq("event_id", event.id)
        .eq("user_id", context.appUser.id)
        .limit(1);
      if (error) throw error;
      if ((data ?? []).length === 0) throw new RushError(403, "Only actives signed up for this event can mark PNMs.");
      if (event.attendance_enabled && event.qr_checkin_enabled) {
        throw new RushError(403, "PNMs check in with the QR code for this event.");
      }
      if (!event.attendance_enabled && status !== null && status !== "no_show") {
        throw new RushError(403, "This event only tracks no-shows.");
      }
    }

    const subject = userId ? { user_id: userId } : { pnm_id: pnmId };
    const conflict = userId ? "event_id,user_id" : "event_id,pnm_id";

    if (status === null) {
      const { error } = await supabaseAdmin.from("rush_event_attendance").delete().eq("event_id", event.id).match(subject);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    let slotId: string | null = null;
    if (pnmId) {
      const pnm = await getPnm(pnmId);
      await ensureCycleEntry(pnm, event.cycle_id);
      const { data } = await supabaseAdmin
        .from("rush_slot_signups")
        .select("slot_id")
        .eq("event_id", event.id)
        .eq("pnm_id", pnmId)
        .maybeSingle();
      slotId = (data as { slot_id: string } | null)?.slot_id ?? null;
    }

    const { error } = await supabaseAdmin.from("rush_event_attendance").upsert(
      {
        event_id: event.id,
        ...subject,
        slot_id: slotId,
        status,
        method: "manual",
        checked_in_by: context.appUser.id,
        checked_in_at: new Date().toISOString(),
      },
      { onConflict: conflict },
    );
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return rushErrorResponse(error, "Failed to mark attendance.");
  }
}

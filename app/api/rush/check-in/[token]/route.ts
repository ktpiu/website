import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { normalizeEmail } from "@/lib/app-user";
import {
  clientIp,
  ensureCycleEntry,
  findOrCreatePnm,
  findPnmByEmail,
  getCycleEntry,
  isActiveClosedEntry,
  rateLimit,
  readJson,
  RushError,
  rushErrorResponse,
  str,
} from "@/lib/rush/server";
import { getOptionalPnm } from "@/lib/rush/pnm-auth";
import { requireAppAuthContext } from "@/lib/server-auth";
import { notifyCheckIn } from "@/lib/rush/notify";
import { looksLikeEmail } from "@/lib/rush/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ token: string }> };

type EventRow = {
  id: string;
  cycle_id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  location_name: string;
  visibility: "public" | "pnm_portal";
  checkin_open: boolean;
  has_timeslots: boolean;
  attendance_enabled: boolean;
  qr_checkin_enabled: boolean;
};

/** The signed-in active member, or null (signed out, PNM, or not approved). */
async function getOptionalMember() {
  try {
    return (await requireAppAuthContext()).appUser;
  } catch {
    return null;
  }
}

async function loadEvent(token: string) {
  const { data, error } = await supabaseAdmin
    .from("rush_events")
    .select("id, cycle_id, title, starts_at, ends_at, location_name, visibility, checkin_open, has_timeslots, attendance_enabled, qr_checkin_enabled")
    .eq("checkin_token", token)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new RushError(404, "This check-in link is not valid.");
  return data as EventRow;
}

/** Event summary for the check-in page, prefilled for a signed-in PNM. */
export async function GET(_request: Request, { params }: Params) {
  try {
    const { token } = await params;
    const event = await loadEvent(token);
    const [pnm, member] = await Promise.all([getOptionalPnm(), getOptionalMember()]);
    return NextResponse.json({
      member: member ? { name: member.name } : null,
      event: {
        title: event.title,
        startsAt: event.starts_at,
        endsAt: event.ends_at,
        locationName: event.location_name,
        checkinOpen: event.checkin_open && event.attendance_enabled && event.qr_checkin_enabled,
      },
      prefill: pnm ? { name: pnm.name, email: pnm.email } : null,
    });
  } catch (error) {
    return rushErrorResponse(error, "Failed to load event.");
  }
}

/**
 * QR self check-in with name + email.
 * - Public (open rush) events create or match the PNM by email.
 * - Closed rush events only match PNMs invited to closed rush this cycle;
 *   anything else is held in rush_unmatched_checkins for admins to reconcile.
 * The response is the same either way so the page never reveals who is in
 * closed rush.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const { token } = await params;
    const body = await readJson(request);

    // Honeypot: bots fill every field. Pretend it worked.
    if (str(body.website)) return NextResponse.json({ ok: true });

    const event = await loadEvent(token);
    if (!event.checkin_open || !event.attendance_enabled || !event.qr_checkin_enabled) {
      throw new RushError(403, "Check-in for this event is closed.");
    }

    // Signed-in actives check themselves in with their account.
    const member = await getOptionalMember();
    if (member) {
      const { error } = await supabaseAdmin
        .from("rush_event_attendance")
        .upsert(
          { event_id: event.id, user_id: member.id, method: "self", status: "present" },
          { onConflict: "event_id,user_id", ignoreDuplicates: true },
        );
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    const name = str(body.name, 120);
    const email = normalizeEmail(str(body.email, 254));
    if (!name) throw new RushError(400, "Enter your name.");
    if (!looksLikeEmail(email)) throw new RushError(400, "Enter a valid email address.");

    rateLimit(`checkin:${clientIp(request)}`, 20, 60_000);
    rateLimit(`checkin:${email}`, 5, 60_000);

    if (event.visibility === "public") {
      const { pnm } = await findOrCreatePnm({ email, name });
      await ensureCycleEntry(pnm, event.cycle_id);
      const recorded = await recordAttendance(event, pnm.id);
      if (recorded) notifyCheckIn(pnm, event, request);
      return NextResponse.json({ ok: true });
    }

    const pnm = await findPnmByEmail(email);
    if (pnm && isActiveClosedEntry(await getCycleEntry(pnm.id, event.cycle_id))) {
      const recorded = await recordAttendance(event, pnm.id);
      if (recorded) notifyCheckIn(pnm, event, request);
      return NextResponse.json({ ok: true });
    }

    // Not a PNM in this cycle: hold for reconciliation (once per email per event).
    const { data: existing, error: lookupError } = await supabaseAdmin
      .from("rush_unmatched_checkins")
      .select("id")
      .eq("event_id", event.id)
      .eq("email", email)
      .eq("status", "pending")
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (!existing) {
      const { error } = await supabaseAdmin
        .from("rush_unmatched_checkins")
        .insert({ event_id: event.id, name, email });
      if (error) throw error;
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return rushErrorResponse(error, "Check-in failed. Please try again.");
  }
}

/** Idempotent; returns true only for a new check-in (so emails send once). */
async function recordAttendance(event: EventRow, pnmId: string) {
  let slotId: string | null = null;
  if (event.has_timeslots) {
    const { data } = await supabaseAdmin
      .from("rush_slot_signups")
      .select("slot_id")
      .eq("event_id", event.id)
      .eq("pnm_id", pnmId)
      .maybeSingle();
    slotId = (data as { slot_id: string } | null)?.slot_id ?? null;
  }

  const { data, error } = await supabaseAdmin
    .from("rush_event_attendance")
    .upsert(
      { event_id: event.id, pnm_id: pnmId, slot_id: slotId, method: "self" },
      { onConflict: "event_id,pnm_id", ignoreDuplicates: true },
    )
    .select("id");
  if (error) throw error;
  return (data ?? []).length > 0;
}

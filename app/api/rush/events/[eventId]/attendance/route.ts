import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  assertRushManagePermission,
  assertRushViewPermission,
  requireAppAuthContext,
} from "@/lib/server-auth";
import { canManageRush } from "@/lib/permissions";
import { getEvent, suggestMatches } from "@/lib/rush/events";
import { normalizeEmail } from "@/lib/app-user";
import {
  ensureCycleEntry,
  findOrCreatePnm,
  getPnm,
  readJson,
  RushError,
  rushErrorResponse,
  signRushPaths,
  str,
} from "@/lib/rush/server";
import { looksLikeEmail } from "@/lib/rush/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ eventId: string }> };

/** Who checked in, plus (for managers) unmatched check-ins with suggestions. */
export async function GET(_request: Request, { params }: Params) {
  try {
    const context = await requireAppAuthContext();
    assertRushViewPermission(context);
    const { eventId } = await params;
    const event = await getEvent(eventId);

    const [attendanceRes, unmatchedRes, cyclePnmsRes] = await Promise.all([
      supabaseAdmin
        .from("rush_event_attendance")
        .select("id, method, checked_in_at, slot_id, pnms(id, name, email, photo_path)")
        .eq("event_id", event.id)
        .order("checked_in_at"),
      canManageRush(context.permissions)
        ? supabaseAdmin
            .from("rush_unmatched_checkins")
            .select("id, name, email, submitted_at")
            .eq("event_id", event.id)
            .eq("status", "pending")
            .order("submitted_at")
        : Promise.resolve({ data: [], error: null }),
      supabaseAdmin
        .from("pnm_cycle_entries")
        .select("pnms(id, name, email)")
        .eq("cycle_id", event.cycle_id),
    ]);
    for (const res of [attendanceRes, unmatchedRes, cyclePnmsRes]) if (res.error) throw res.error;

    type Row = {
      id: string;
      method: string;
      checked_in_at: string;
      slot_id: string | null;
      pnms: { id: string; name: string; email: string; photo_path: string | null } | null;
    };
    const rows = ((attendanceRes.data ?? []) as unknown as Row[]).filter((r) => r.pnms);
    const urls = await signRushPaths(rows.map((r) => r.pnms!.photo_path));
    const cyclePnms = ((cyclePnmsRes.data ?? []) as unknown as Array<{ pnms: { id: string; name: string; email: string } | null }>)
      .flatMap((e) => (e.pnms ? [e.pnms] : []));

    return NextResponse.json({
      attendance: rows.map((r) => ({
        id: r.id,
        method: r.method,
        checkedInAt: r.checked_in_at,
        slotId: r.slot_id,
        pnm: {
          id: r.pnms!.id,
          name: r.pnms!.name,
          email: r.pnms!.email,
          photoUrl: r.pnms!.photo_path ? urls.get(r.pnms!.photo_path) ?? null : null,
        },
      })),
      unmatched: ((unmatchedRes.data ?? []) as Array<{ id: string; name: string; email: string; submitted_at: string }>).map(
        (u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          submittedAt: u.submitted_at,
          suggestions: suggestMatches(u, cyclePnms),
        }),
      ),
      cyclePnms,
    });
  } catch (error) {
    return rushErrorResponse(error, "Failed to load attendance.");
  }
}

/**
 * Manual check-in by a rush manager: an existing PNM ({ pnmId }) or, for
 * public events, a new walk-in ({ name, email }).
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const context = await requireAppAuthContext();
    assertRushManagePermission(context);
    const { eventId } = await params;
    const event = await getEvent(eventId);
    const body = await readJson(request);

    const existingId = str(body.pnmId, 64);
    let pnm;
    if (existingId) {
      pnm = await getPnm(existingId);
    } else {
      const name = str(body.name, 120);
      const email = normalizeEmail(str(body.email, 254));
      if (!name || !looksLikeEmail(email)) throw new RushError(400, "Enter a name and a valid email.");
      pnm = (await findOrCreatePnm({ name, email })).pnm;
    }
    await ensureCycleEntry(pnm, event.cycle_id);
    const pnmId = pnm.id;

    const { error } = await supabaseAdmin.from("rush_event_attendance").upsert(
      { event_id: event.id, pnm_id: pnmId, method: "manual", checked_in_by: context.appUser.id },
      { onConflict: "event_id,pnm_id", ignoreDuplicates: true },
    );
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return rushErrorResponse(error, "Failed to check in the PNM.");
  }
}

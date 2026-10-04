import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { assertRushManagePermission, requireAppAuthContext } from "@/lib/server-auth";
import { getEvent } from "@/lib/rush/events";
import { ensureCycleEntry, getPnm, readJson, RushError, rushErrorResponse, str } from "@/lib/rush/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ checkinId: string }> };

/** Resolve an unmatched check-in: { action: "link", pnmId } or { action: "dismiss" }. */
export async function POST(request: Request, { params }: Params) {
  try {
    const context = await requireAppAuthContext();
    assertRushManagePermission(context);
    const { checkinId } = await params;
    const body = await readJson(request);

    const { data, error: lookupError } = await supabaseAdmin
      .from("rush_unmatched_checkins")
      .select("id, event_id, status")
      .eq("id", checkinId)
      .maybeSingle();
    if (lookupError) throw lookupError;
    const checkin = data as { id: string; event_id: string; status: string } | null;
    if (!checkin) throw new RushError(404, "Check-in not found.");
    if (checkin.status !== "pending") throw new RushError(409, "This check-in was already resolved.");

    const resolved = { resolved_by: context.appUser.id, resolved_at: new Date().toISOString() };

    if (body.action === "dismiss") {
      const { error } = await supabaseAdmin
        .from("rush_unmatched_checkins")
        .update({ status: "dismissed", ...resolved })
        .eq("id", checkin.id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (body.action !== "link") throw new RushError(400, "Unknown action.");
    const pnm = await getPnm(str(body.pnmId, 64));
    const event = await getEvent(checkin.event_id);
    await ensureCycleEntry(pnm, event.cycle_id);

    const { error: attendanceError } = await supabaseAdmin.from("rush_event_attendance").upsert(
      { event_id: event.id, pnm_id: pnm.id, method: "reconciled", checked_in_by: context.appUser.id },
      { onConflict: "event_id,pnm_id", ignoreDuplicates: true },
    );
    if (attendanceError) throw attendanceError;

    const { error } = await supabaseAdmin
      .from("rush_unmatched_checkins")
      .update({ status: "linked", linked_pnm_id: pnm.id, ...resolved })
      .eq("id", checkin.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return rushErrorResponse(error, "Failed to resolve the check-in.");
  }
}

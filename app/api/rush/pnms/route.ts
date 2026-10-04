import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  assertRushManagePermission,
  assertRushViewPermission,
  requireAppAuthContext,
} from "@/lib/server-auth";
import { normalizeEmail } from "@/lib/app-user";
import {
  ensureCycleEntry,
  findOrCreatePnm,
  getCycle,
  readJson,
  resolveCycle,
  RushError,
  rushErrorResponse,
  signRushPaths,
  str,
} from "@/lib/rush/server";
import { looksLikeEmail } from "@/lib/rush/types";

export const dynamic = "force-dynamic";

type EntryRow = {
  stage: string;
  group: string;
  outcome: string | null;
  pnms: {
    id: string;
    name: string;
    email: string;
    is_iu_email: boolean;
    status: string;
    photo_path: string | null;
    clerk_user_id: string | null;
    major: string | null;
    grad_year: number | null;
  } | null;
};

/** PNMs in a cycle with attendance / application / evaluation counts. */
export async function GET(request: Request) {
  try {
    const context = await requireAppAuthContext();
    assertRushViewPermission(context);
    const cycle = await resolveCycle(request);
    if (!cycle) return NextResponse.json({ cycle: null, pnms: [], eventCount: 0 });

    const [entriesRes, eventsRes, applicationsRes, responsesRes] = await Promise.all([
      supabaseAdmin
        .from("pnm_cycle_entries")
        .select("stage, group, outcome, pnms(id, name, email, is_iu_email, status, photo_path, clerk_user_id, major, grad_year)")
        .eq("cycle_id", cycle.id),
      supabaseAdmin.from("rush_events").select("id").eq("cycle_id", cycle.id),
      supabaseAdmin.from("rush_applications").select("pnm_id").eq("cycle_id", cycle.id),
      supabaseAdmin.from("rush_form_responses").select("pnm_id").eq("cycle_id", cycle.id),
    ]);
    for (const res of [entriesRes, eventsRes, applicationsRes, responsesRes]) if (res.error) throw res.error;

    const eventIds = ((eventsRes.data ?? []) as Array<{ id: string }>).map((e) => e.id);
    const attendanceRes = eventIds.length
      ? await supabaseAdmin.from("rush_event_attendance").select("pnm_id").in("event_id", eventIds)
      : { data: [], error: null };
    if (attendanceRes.error) throw attendanceRes.error;

    const tally = (rows: Array<{ pnm_id: string }>) => {
      const map = new Map<string, number>();
      for (const r of rows) map.set(r.pnm_id, (map.get(r.pnm_id) ?? 0) + 1);
      return map;
    };
    const attended = tally((attendanceRes.data ?? []) as Array<{ pnm_id: string }>);
    const applied = tally((applicationsRes.data ?? []) as Array<{ pnm_id: string }>);
    const responses = tally((responsesRes.data ?? []) as Array<{ pnm_id: string }>);

    const entries = ((entriesRes.data ?? []) as unknown as EntryRow[]).filter((e) => e.pnms);
    const urls = await signRushPaths(entries.map((e) => e.pnms!.photo_path));

    return NextResponse.json({
      cycle,
      eventCount: eventIds.length,
      pnms: entries
        .map((e) => {
          const p = e.pnms!;
          return {
            id: p.id,
            name: p.name,
            email: p.email,
            isIuEmail: p.is_iu_email,
            status: p.status,
            major: p.major,
            gradYear: p.grad_year,
            photoUrl: p.photo_path ? urls.get(p.photo_path) ?? null : null,
            hasAccount: Boolean(p.clerk_user_id),
            stage: e.stage,
            group: e.group,
            outcome: e.outcome,
            eventsAttended: attended.get(p.id) ?? 0,
            hasApplication: applied.has(p.id),
            responseCount: responses.get(p.id) ?? 0,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  } catch (error) {
    return rushErrorResponse(error, "Failed to load PNMs.");
  }
}

/** Manually add a PNM to a cycle. */
export async function POST(request: Request) {
  try {
    const context = await requireAppAuthContext();
    assertRushManagePermission(context);
    const body = await readJson(request);
    const cycle = await getCycle(str(body.cycleId, 64));
    const name = str(body.name, 120);
    const email = normalizeEmail(str(body.email, 254));
    if (!name || !looksLikeEmail(email)) throw new RushError(400, "Enter a name and a valid email.");

    const { pnm } = await findOrCreatePnm({ name, email });
    await ensureCycleEntry(pnm, cycle.id);
    return NextResponse.json({ id: pnm.id }, { status: 201 });
  } catch (error) {
    return rushErrorResponse(error, "Failed to add the PNM.");
  }
}

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { assertActiveAttendancePermission, requireAppAuthContext } from "@/lib/server-auth";
import { listActives } from "@/lib/rush/people";
import { resolveCycle, rushErrorResponse } from "@/lib/rush/server";
import type { AttendanceStatus } from "@/lib/rush/types";

export const dynamic = "force-dynamic";

/**
 * Active attendance across a cycle's events: every active, and for each event
 * whether they signed up and how they were marked.
 */
export async function GET(request: Request) {
  try {
    const context = await requireAppAuthContext();
    assertActiveAttendancePermission(context);
    const cycle = await resolveCycle(request);
    if (!cycle) return NextResponse.json({ cycle: null, events: [], actives: [] });

    const { data: eventRows, error: eventError } = await supabaseAdmin
      .from("rush_events")
      .select("id, title, starts_at, attendance_enabled")
      .eq("cycle_id", cycle.id)
      .order("starts_at");
    if (eventError) throw eventError;
    const events = (eventRows ?? []) as Array<{ id: string; title: string; starts_at: string; attendance_enabled: boolean }>;
    const ids = events.map((e) => e.id);

    const empty = Promise.resolve({ data: [], error: null });
    const [actives, signupsRes, attendanceRes] = await Promise.all([
      listActives(),
      ids.length ? supabaseAdmin.from("rush_slot_signups").select("event_id, user_id").in("event_id", ids).not("user_id", "is", null) : empty,
      ids.length
        ? supabaseAdmin.from("rush_event_attendance").select("event_id, user_id, status").in("event_id", ids).not("user_id", "is", null)
        : empty,
    ]);
    if (signupsRes.error) throw signupsRes.error;
    if (attendanceRes.error) throw attendanceRes.error;

    const signedUp = new Set(
      ((signupsRes.data ?? []) as Array<{ event_id: string; user_id: string }>).map((s) => `${s.event_id}:${s.user_id}`),
    );
    const statuses = new Map(
      ((attendanceRes.data ?? []) as Array<{ event_id: string; user_id: string; status: AttendanceStatus }>).map((a) => [
        `${a.event_id}:${a.user_id}`,
        a.status,
      ]),
    );

    return NextResponse.json({
      cycle: { id: cycle.id, label: cycle.label },
      events: events.map((e) => ({ id: e.id, title: e.title, startsAt: e.starts_at, attendanceEnabled: e.attendance_enabled })),
      actives: actives.map((a) => {
        const userId = a.key.replace("user:", "");
        return {
          userId,
          name: a.name,
          avatar: a.avatar,
          events: Object.fromEntries(
            events.map((e) => [e.id, { signedUp: signedUp.has(`${e.id}:${userId}`), status: statuses.get(`${e.id}:${userId}`) ?? null }]),
          ),
        };
      }),
    });
  } catch (error) {
    return rushErrorResponse(error, "Failed to load active attendance.");
  }
}

import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { AppAuthContext } from "@/lib/server-auth";
import { canManageRush, canViewRush } from "@/lib/permissions";
import { getSiteUrl } from "@/lib/rush/links";
import { signRushPaths } from "@/lib/rush/server";
import type { RushEventRecord, RushSlotRecord } from "@/lib/rush/types";

type SignupRow = { id: string; slot_id: string; pnm_id: string | null; user_id: string | null };

/**
 * Events for the member portal (one cycle, or a single event). Every member
 * sees each timeslot's PNM and active signups (PNMs never get this view).
 * Managers also get the check-in link and attendance / reconciliation counts.
 */
export async function loadMemberEvents(
  context: AppAuthContext,
  request: Request,
  filter: { cycleId: string } | { eventId: string },
) {
  const manage = canManageRush(context.permissions);
  const view = canViewRush(context.permissions);

  let eventQuery = supabaseAdmin.from("rush_events").select("*").order("starts_at");
  eventQuery = "cycleId" in filter ? eventQuery.eq("cycle_id", filter.cycleId) : eventQuery.eq("id", filter.eventId);
  const { data: eventRows, error } = await eventQuery;
  if (error) throw error;
  const events = (eventRows ?? []) as RushEventRecord[];
  const eventIds = events.map((e) => e.id);
  const empty = Promise.resolve({ data: [], error: null });
  const [slotsRes, signupsRes, attendanceRes, unmatchedRes, pnmMarksRes] = await Promise.all([
    eventIds.length ? supabaseAdmin.from("rush_event_slots").select("*").in("event_id", eventIds).order("starts_at") : empty,
    eventIds.length ? supabaseAdmin.from("rush_slot_signups").select("id, slot_id, pnm_id, user_id").in("event_id", eventIds) : empty,
    view && eventIds.length ? supabaseAdmin.from("rush_event_attendance").select("event_id").in("event_id", eventIds).not("pnm_id", "is", null).neq("status", "no_show") : empty,
    manage && eventIds.length
      ? supabaseAdmin.from("rush_unmatched_checkins").select("event_id").in("event_id", eventIds).eq("status", "pending")
      : empty,
    eventIds.length
      ? supabaseAdmin.from("rush_event_attendance").select("event_id, pnm_id, status").in("event_id", eventIds).not("pnm_id", "is", null)
      : empty,
  ]);
  for (const res of [slotsRes, signupsRes, attendanceRes, unmatchedRes, pnmMarksRes]) if (res.error) throw res.error;

  const slots = (slotsRes.data ?? []) as RushSlotRecord[];
  const signups = (signupsRes.data ?? []) as SignupRow[];
  const pnmIds = Array.from(new Set(signups.flatMap((s) => (s.pnm_id ? [s.pnm_id] : []))));
  const userIds = Array.from(new Set(signups.flatMap((s) => (s.user_id ? [s.user_id] : []))));

  const [pnmsRes, usersRes] = await Promise.all([
    pnmIds.length ? supabaseAdmin.from("pnms").select("id, name, photo_path").in("id", pnmIds) : empty,
    userIds.length ? supabaseAdmin.from("users").select("id, name, avatar").in("id", userIds) : empty,
  ]);
  if (pnmsRes.error) throw pnmsRes.error;
  if (usersRes.error) throw usersRes.error;

  const pnms = new Map(
    ((pnmsRes.data ?? []) as Array<{ id: string; name: string; photo_path: string | null }>).map((p) => [p.id, p]),
  );
  const users = new Map(
    ((usersRes.data ?? []) as Array<{ id: string; name: string; avatar: string | null }>).map((u) => [u.id, u]),
  );
  const urls = await signRushPaths([
    ...Array.from(pnms.values()).map((p) => p.photo_path),
    ...events.map((e) => e.image_path),
  ]);

  const count = (rows: Array<{ event_id: string }>) => {
    const map = new Map<string, number>();
    for (const r of rows) map.set(r.event_id, (map.get(r.event_id) ?? 0) + 1);
    return map;
  };
  const attendanceCounts = count((attendanceRes.data ?? []) as Array<{ event_id: string }>);
  const unmatchedCounts = count((unmatchedRes.data ?? []) as Array<{ event_id: string }>);
  const siteUrl = getSiteUrl(request);
  const me = context.appUser.id;
  const marks = new Map(
    ((pnmMarksRes.data ?? []) as Array<{ event_id: string; pnm_id: string; status: string }>).map((m) => [
      `${m.event_id}:${m.pnm_id}`,
      m.status,
    ]),
  );
  const signedUpEvents = new Set(signups.filter((s) => s.user_id === me).map((s) => events.find((e) => e.id === slots.find((sl) => sl.id === s.slot_id)?.event_id)?.id));
  /** Managers always; signed-up actives only when QR check-in isn't the way in. */
  const canMark = (event: RushEventRecord) =>
    manage || (signedUpEvents.has(event.id) && !(event.attendance_enabled && event.qr_checkin_enabled));

  return events.map((event) => ({
        id: event.id,
        cycleId: event.cycle_id,
        title: event.title,
        description: event.description,
        startsAt: event.starts_at,
        endsAt: event.ends_at,
        locationName: event.location_name,
        locationUrl: event.location_url,
        dressCode: event.dress_code,
        imageUrl: event.image_path ? urls.get(event.image_path) ?? null : null,
        visibility: event.visibility,
        checkinOpen: event.checkin_open,
        hasTimeslots: event.has_timeslots,
        activesMultiSlot: event.actives_multi_slot,
        selfChangeMode: event.self_change_mode,
        changeCutoffMinutes: event.change_cutoff_minutes,
        slotGrid: event.slot_grid,
        formTemplateId: event.form_template_id,
        attendanceEnabled: event.attendance_enabled,
        qrCheckinEnabled: event.qr_checkin_enabled,
        ...(manage ? { checkinUrl: `${siteUrl}/rush/check-in/${event.checkin_token}` } : {}),
        canMarkPnms: canMark(event),
        attendanceCount: view ? attendanceCounts.get(event.id) ?? 0 : undefined,
        unmatchedCount: manage ? unmatchedCounts.get(event.id) ?? 0 : undefined,
        slots: slots
          .filter((s) => s.event_id === event.id)
          .map((slot) => {
            const here = signups.filter((s) => s.slot_id === slot.id);
            return {
              id: slot.id,
              startsAt: slot.starts_at,
              endsAt: slot.ends_at,
              locationName: slot.location_name,
              locationUrl: slot.location_url,
              notes: slot.notes,
              pnmCapacity: slot.pnm_capacity,
              activeCapacity: slot.active_capacity,
              pnms: here.flatMap((s) => {
                const p = s.pnm_id ? pnms.get(s.pnm_id) : null;
                return p
                  ? [
                      {
                        signupId: s.id,
                        pnmId: p.id,
                        name: p.name,
                        photoUrl: p.photo_path ? urls.get(p.photo_path) ?? null : null,
                        attendance: canMark(event) || view ? marks.get(`${event.id}:${p.id}`) ?? null : null,
                      },
                    ]
                  : [];
              }),
              actives: here.flatMap((s) => {
                const u = s.user_id ? users.get(s.user_id) : null;
                return u ? [{ signupId: s.id, userId: u.id, name: u.name, avatar: u.avatar || null, isMe: u.id === me }] : [];
              }),
            };
          }),
      }));
}

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getRushAccount } from "@/lib/rush/pnm-auth";
import { getRegistrationState } from "@/lib/rush/registration";
import { loadVisibleEventsForPnm, canSelfChange } from "@/lib/rush/portal";
import { getCyclePhases, rushErrorResponse, signRushPaths, type PnmRow } from "@/lib/rush/server";
import type { RushSlotRecord } from "@/lib/rush/types";

export const dynamic = "force-dynamic";

/** Never reveal an accepted bid in the portal; a pledge still reads as closed rush. */
function hideBid(status: PnmRow["status"]): PnmRow["status"] {
  return status === "pledge" ? "closed" : status;
}

/**
 * Everything the rush portal shows. Accounts that haven't registered for rush
 * get `kind: "unregistered"` plus whether they can register themselves;
 * member-portal accounts get `kind: "member"`. Timeslots only expose PNM
 * capacity and the PNM's own booking: active-member signups never leave the
 * server here.
 */
export async function GET() {
  try {
    const { account, pnm, portalAccess } = await getRushAccount();
    const noStore = { headers: { "Cache-Control": "no-store" } };
    // Pledges get the member portal once they're initiated (status active).
    // Until then they keep seeing their rush portal exactly as before: bids
    // are delivered by PFC, not the portal (see hideBid below).
    if (portalAccess) {
      return NextResponse.json({ kind: "member" }, noStore);
    }
    const registration = await getRegistrationState(account, pnm);
    if (!pnm) {
      return NextResponse.json(
        {
          kind: "unregistered",
          account: {
            name: account.name,
            email: account.email,
            graduationYear: account.graduation_year,
            status: account.account_status,
          },
          registration,
        },
        noStore,
      );
    }
    const events = await loadVisibleEventsForPnm(pnm);
    const slotEventIds = events.filter((e) => e.has_timeslots).map((e) => e.id);

    const phases = await getCyclePhases(events.map((e) => e.cycle_id));
    const isConcluded = (event: { cycle_id: string }) => phases.get(event.cycle_id) === "concluded";

    const [attendanceRes, applicationsRes, slotsRes, pnmSignupsRes, mySignupsRes, urls] = await Promise.all([
      supabaseAdmin
        .from("rush_event_attendance")
        .select("event_id, checked_in_at, rush_events(title, starts_at)")
        .eq("pnm_id", pnm.id),
      supabaseAdmin
        .from("rush_applications")
        .select("submitted_at, rush_cycles(label)")
        .eq("pnm_id", pnm.id),
      slotEventIds.length
        ? supabaseAdmin.from("rush_event_slots").select("*").in("event_id", slotEventIds).order("starts_at")
        : Promise.resolve({ data: [], error: null }),
      slotEventIds.length
        ? supabaseAdmin
            .from("rush_slot_signups")
            .select("slot_id")
            .in("event_id", slotEventIds)
            .not("pnm_id", "is", null)
        : Promise.resolve({ data: [], error: null }),
      supabaseAdmin.from("rush_slot_signups").select("id, event_id, slot_id").eq("pnm_id", pnm.id),
      signRushPaths([pnm.photo_path, ...events.map((e) => e.image_path)]),
    ]);
    for (const res of [attendanceRes, applicationsRes, slotsRes, pnmSignupsRes, mySignupsRes]) {
      if (res.error) throw res.error;
    }

    const taken = new Map<string, number>();
    for (const row of (pnmSignupsRes.data ?? []) as Array<{ slot_id: string }>) {
      taken.set(row.slot_id, (taken.get(row.slot_id) ?? 0) + 1);
    }
    const slots = (slotsRes.data ?? []) as RushSlotRecord[];
    const mySignups = (mySignupsRes.data ?? []) as Array<{ id: string; event_id: string; slot_id: string }>;
    const attended = new Set(
      ((attendanceRes.data ?? []) as Array<{ event_id: string }>).map((a) => a.event_id),
    );

    type AttendanceRow = { event_id: string; checked_in_at: string; rush_events: { title: string; starts_at: string } | null };
    type ApplicationRow = { submitted_at: string; rush_cycles: { label: string } | null };

    return NextResponse.json(
      {
        kind: "pnm",
        registration,
        pnm: {
          name: pnm.name,
          email: pnm.email,
          status: hideBid(pnm.status),
          isIuEmail: pnm.is_iu_email,
          photoUrl: pnm.photo_path ? urls.get(pnm.photo_path) ?? null : null,
        },
        attendance: ((attendanceRes.data ?? []) as unknown as AttendanceRow[])
          .filter((a) => a.rush_events)
          .map((a) => ({ eventId: a.event_id, title: a.rush_events!.title, startsAt: a.rush_events!.starts_at }))
          .sort((a, b) => b.startsAt.localeCompare(a.startsAt)),
        applications: ((applicationsRes.data ?? []) as unknown as ApplicationRow[]).map((a) => ({
          cycleLabel: a.rush_cycles?.label ?? "",
          submittedAt: a.submitted_at,
        })),
        events: events.map((event) => {
          const mine = mySignups.find((s) => s.event_id === event.id) ?? null;
          const mySlot = mine ? slots.find((s) => s.id === mine.slot_id) : null;
          return {
            id: event.id,
            title: event.title,
            description: event.description,
            startsAt: event.starts_at,
            endsAt: event.ends_at,
            locationName: event.location_name,
            locationUrl: event.location_url,
            dressCode: event.dress_code,
            imageUrl: event.image_path ? urls.get(event.image_path) ?? null : null,
            isClosed: event.visibility === "pnm_portal",
            attended: attended.has(event.id),
            hasTimeslots: event.has_timeslots,
            // Rush is over: the portal shows the event but nothing can change.
            concluded: isConcluded(event),
            selfChangeMode: event.self_change_mode,
            changeCutoffMinutes: event.change_cutoff_minutes,
            slotGrid: event.slot_grid,
            mySignup: mine
              ? {
                  id: mine.id,
                  slotId: mine.slot_id,
                  canChange: !isConcluded(event) && mySlot ? canSelfChange(event, mySlot) : false,
                }
              : null,
            slots: event.has_timeslots
              ? slots
                  .filter((s) => s.event_id === event.id)
                  // Cells the admin hasn't allocated PNM spots to stay hidden.
                  .filter((s) => s.pnm_capacity > 0 || (taken.get(s.id) ?? 0) > 0)
                  .map((s) => ({
                    id: s.id,
                    startsAt: s.starts_at,
                    endsAt: s.ends_at,
                    locationName: s.location_name,
                    locationUrl: s.location_url,
                    notes: s.notes,
                    spotsLeft: Math.max(0, s.pnm_capacity - (taken.get(s.id) ?? 0)),
                    started: new Date(s.starts_at).getTime() <= Date.now(),
                  }))
              : [],
          };
        }),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return rushErrorResponse(error, "Failed to load your rush portal.");
  }
}

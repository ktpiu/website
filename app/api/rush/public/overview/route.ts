import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getActiveCycle, rushErrorResponse, signRushPaths } from "@/lib/rush/server";

export const dynamic = "force-dynamic";

/**
 * Public data for /rush: the current cycle, its public events and the rush
 * contacts. Only public fields are returned (no check-in tokens, no PNM data).
 */
export async function GET() {
  try {
    const cycle = await getActiveCycle();

    const [eventsRes, contactsRes] = await Promise.all([
      cycle
        ? supabaseAdmin
            .from("rush_events")
            .select("id, title, description, starts_at, ends_at, location_name, location_url, dress_code, image_path, has_timeslots")
            .eq("cycle_id", cycle.id)
            .eq("visibility", "public")
            .order("starts_at")
        : Promise.resolve({ data: [], error: null }),
      supabaseAdmin
        .from("rush_contacts")
        .select("id, title, public_email, public_phone, sort_order, users(name, avatar, socials)")
        .order("sort_order"),
    ]);
    if (eventsRes.error) throw eventsRes.error;
    if (contactsRes.error) throw contactsRes.error;

    type EventRow = {
      id: string;
      title: string;
      description: string;
      starts_at: string;
      ends_at: string | null;
      location_name: string;
      location_url: string | null;
      dress_code: string | null;
      image_path: string | null;
      has_timeslots: boolean;
    };
    const events = (eventsRes.data ?? []) as EventRow[];
    const imageUrls = await signRushPaths(events.map((e) => e.image_path));

    type ContactRow = {
      id: string;
      title: string;
      public_email: string | null;
      public_phone: string | null;
      users: { name: string | null; avatar: string | null; socials: unknown } | null;
    };

    return NextResponse.json(
      {
        cycle: cycle
          ? { label: cycle.label, phase: cycle.phase, applicationsOpen: cycle.applications_open }
          : null,
        events: events.map((e) => ({
          id: e.id,
          title: e.title,
          description: e.description,
          startsAt: e.starts_at,
          endsAt: e.ends_at,
          locationName: e.location_name,
          locationUrl: e.location_url,
          dressCode: e.dress_code,
          hasTimeslots: e.has_timeslots,
          imageUrl: e.image_path ? imageUrls.get(e.image_path) ?? null : null,
        })),
        contacts: ((contactsRes.data ?? []) as unknown as ContactRow[]).map((c) => ({
          id: c.id,
          name: c.users?.name ?? "",
          avatar: c.users?.avatar || null,
          title: c.title,
          email: c.public_email,
          phone: c.public_phone,
        })),
      },
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } },
    );
  } catch (error) {
    return rushErrorResponse(error, "Failed to load rush info.");
  }
}

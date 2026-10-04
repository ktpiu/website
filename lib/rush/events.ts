import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { optStr, RushError, str } from "@/lib/rush/server";
import type { RushEventRecord, RushSlotRecord } from "@/lib/rush/types";

function parseDate(value: unknown, label: string, required: boolean) {
  if (value === null || value === undefined || value === "") {
    if (required) throw new RushError(400, `${label} is required.`);
    return null;
  }
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new RushError(400, `${label} is not a valid date.`);
  return date.toISOString();
}

function capacity(value: unknown, label: string) {
  const n = Number(value ?? 0);
  if (!Number.isInteger(n) || n < 0 || n > 1000) throw new RushError(400, `${label} must be a whole number.`);
  return n;
}

/** Validates an event payload. `partial` allows PATCHing a subset of fields. */
export function parseEventBody(body: Record<string, unknown>, partial: boolean) {
  const patch: Record<string, unknown> = {};
  const has = (key: string) => !partial || key in body;

  if (has("title")) {
    patch.title = str(body.title, 160);
    if (!patch.title) throw new RushError(400, "Give the event a title.");
  }
  if (has("description")) patch.description = str(body.description, 4000);
  if (has("startsAt")) patch.starts_at = parseDate(body.startsAt, "Start time", true);
  if (has("endsAt")) patch.ends_at = parseDate(body.endsAt, "End time", false);
  if (has("locationName")) patch.location_name = str(body.locationName, 200);
  if (has("locationUrl")) patch.location_url = optStr(body.locationUrl, 500);
  if (has("dressCode")) patch.dress_code = optStr(body.dressCode, 120);
  if (has("visibility")) patch.visibility = body.visibility === "pnm_portal" ? "pnm_portal" : "public";
  if (has("checkinOpen")) patch.checkin_open = Boolean(body.checkinOpen);
  if (has("hasTimeslots")) patch.has_timeslots = Boolean(body.hasTimeslots);
  if (has("activesMultiSlot")) patch.actives_multi_slot = Boolean(body.activesMultiSlot);
  if (has("selfChangeMode")) patch.self_change_mode = body.selfChangeMode === "admin_only" ? "admin_only" : "cutoff";
  if (has("slotGrid")) patch.slot_grid = body.slotGrid === "location_rows" ? "location_rows" : "time_rows";
  if (has("changeCutoffMinutes")) {
    const n = Number(body.changeCutoffMinutes ?? 0);
    if (!Number.isInteger(n) || n < 0 || n > 60 * 24 * 30) {
      throw new RushError(400, "Cutoff must be a whole number of minutes (0 or more).");
    }
    patch.change_cutoff_minutes = n;
  }
  if (patch.starts_at && patch.ends_at && String(patch.ends_at) < String(patch.starts_at)) {
    throw new RushError(400, "The event can't end before it starts.");
  }
  return patch;
}

export function parseSlotBody(body: Record<string, unknown>, partial: boolean) {
  const patch: Record<string, unknown> = {};
  const has = (key: string) => !partial || key in body;
  if (has("startsAt")) patch.starts_at = parseDate(body.startsAt, "Start time", true);
  if (has("endsAt")) patch.ends_at = parseDate(body.endsAt, "End time", false);
  if (has("locationName")) patch.location_name = str(body.locationName, 200);
  if (has("locationUrl")) patch.location_url = optStr(body.locationUrl, 500);
  if (has("notes")) patch.notes = optStr(body.notes, 500);
  if (has("pnmCapacity")) patch.pnm_capacity = capacity(body.pnmCapacity, "PNM capacity");
  if (has("activeCapacity")) patch.active_capacity = capacity(body.activeCapacity, "Active capacity");
  return patch;
}

export async function getEvent(eventId: string): Promise<RushEventRecord> {
  const { data, error } = await supabaseAdmin.from("rush_events").select("*").eq("id", eventId).maybeSingle();
  if (error) throw error;
  if (!data) throw new RushError(404, "Event not found.");
  return data as RushEventRecord;
}

export async function getSlot(slotId: string): Promise<RushSlotRecord> {
  const { data, error } = await supabaseAdmin.from("rush_event_slots").select("*").eq("id", slotId).maybeSingle();
  if (error) throw error;
  if (!data) throw new RushError(404, "Timeslot not found.");
  return data as RushSlotRecord;
}

/** Ranks a cycle's PNMs as likely matches for an unmatched check-in. */
export function suggestMatches(
  checkin: { name: string; email: string },
  pnms: Array<{ id: string; name: string; email: string }>,
) {
  const tokens = (s: string) =>
    new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1));
  const local = (e: string) => e.toLowerCase().split("@")[0] ?? "";
  const nameTokens = tokens(checkin.name);
  const localPart = local(checkin.email);

  return pnms
    .map((pnm) => {
      let score = 0;
      if (pnm.email === checkin.email.toLowerCase()) score += 100;
      if (local(pnm.email) === localPart) score += 60;
      else if (localPart.length > 3 && local(pnm.email).includes(localPart.slice(0, 4))) score += 15;
      const pnmTokens = tokens(pnm.name);
      for (const t of nameTokens) if (pnmTokens.has(t)) score += 25;
      return { id: pnm.id, name: pnm.name, email: pnm.email, score };
    })
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

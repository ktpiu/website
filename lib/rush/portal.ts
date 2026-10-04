import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getActiveCycle, RushError, type PnmRow } from "@/lib/rush/server";
import type { RushEventRecord, RushSlotRecord } from "@/lib/rush/types";

/** How far back the PNM portal keeps showing an event after it starts. */
const RECENT_MS = 12 * 60 * 60 * 1000;

/**
 * Events a PNM may see: public events of the current cycle, plus closed rush
 * (PNM-portal) events of any cycle where they've been invited to closed rush
 * and haven't been moved to former / pledge yet.
 */
export async function loadVisibleEventsForPnm(pnm: PnmRow): Promise<RushEventRecord[]> {
  const [cycle, entriesRes] = await Promise.all([
    getActiveCycle(),
    supabaseAdmin.from("pnm_cycle_entries").select("cycle_id, stage, outcome").eq("pnm_id", pnm.id),
  ]);
  if (entriesRes.error) throw entriesRes.error;

  const portalCycleIds =
    pnm.status === "former"
      ? []
      : ((entriesRes.data ?? []) as Array<{ cycle_id: string; stage: string; outcome: string | null }>)
          .filter((e) => e.stage === "closed" && e.outcome === null)
          .map((e) => e.cycle_id);

  const filters: string[] = [];
  if (cycle) filters.push(`and(visibility.eq.public,cycle_id.eq.${cycle.id})`);
  if (portalCycleIds.length) filters.push(`and(visibility.eq.pnm_portal,cycle_id.in.(${portalCycleIds.join(",")}))`);
  if (filters.length === 0) return [];

  const { data, error } = await supabaseAdmin
    .from("rush_events")
    .select("*")
    .or(filters.join(","))
    .gte("starts_at", new Date(Date.now() - RECENT_MS).toISOString())
    .order("starts_at");
  if (error) throw error;
  return (data ?? []) as RushEventRecord[];
}

export async function getVisibleEventForPnm(pnm: PnmRow, eventId: string) {
  const events = await loadVisibleEventsForPnm(pnm);
  const event = events.find((e) => e.id === eventId);
  if (!event) throw new RushError(404, "Event not found.");
  return event;
}

/** Whether the signup holder may still change a booking in this slot. */
export function canSelfChange(event: RushEventRecord, slot: Pick<RushSlotRecord, "starts_at">) {
  if (event.self_change_mode === "admin_only") return false;
  return Date.now() <= new Date(slot.starts_at).getTime() - event.change_cutoff_minutes * 60_000;
}

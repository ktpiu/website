import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { personKey, type PeopleSource } from "@/lib/rush/types";

export type PersonOption = {
  /** "user:<id>" or "pnm:<id>" */
  key: string;
  name: string;
  kind: "active" | "pnm";
  avatar: string | null;
};

/** Current members: not alumni, hidden, or disaffiliated. */
export async function listActives(): Promise<PersonOption[]> {
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("id, name, avatar")
    .eq("is_alumni", false)
    .eq("is_hidden", false)
    .eq("is_disaffiliated", false)
    .order("name");
  if (error) throw error;
  return ((data ?? []) as Array<{ id: string; name: string | null; avatar: string | null }>)
    .filter((u) => u.name)
    .map((u) => ({ key: personKey("user", u.id), name: u.name!, kind: "active", avatar: u.avatar || null }));
}

export async function listCyclePnms(cycleId: string): Promise<PersonOption[]> {
  const { data, error } = await supabaseAdmin
    .from("pnm_cycle_entries")
    .select("pnms(id, name, status)")
    .eq("cycle_id", cycleId);
  if (error) throw error;
  return ((data ?? []) as unknown as Array<{ pnms: { id: string; name: string; status: string } | null }>)
    .flatMap((e) => (e.pnms && e.pnms.status !== "former" ? [e.pnms] : []))
    .map((p) => ({ key: personKey("pnm", p.id), name: p.name, kind: "pnm" as const, avatar: null }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function listPeople(source: PeopleSource, cycleId: string | null) {
  const [actives, pnms] = await Promise.all([
    source === "pnms" ? [] : listActives(),
    source === "actives" || !cycleId ? [] : listCyclePnms(cycleId),
  ]);
  return [...actives, ...pnms];
}

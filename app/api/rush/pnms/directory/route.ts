import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAppAuthContext } from "@/lib/server-auth";
import { resolveCycle, rushErrorResponse, signRushPaths } from "@/lib/rush/server";

export const dynamic = "force-dynamic";

/**
 * Name + photo of every PNM in a cycle, for actives filling out evaluation
 * forms. Deliberately excludes contact info, groups and statuses.
 */
export async function GET(request: Request) {
  try {
    await requireAppAuthContext();
    const cycle = await resolveCycle(request);
    if (!cycle) return NextResponse.json({ cycle: null, pnms: [] });

    const { data, error } = await supabaseAdmin
      .from("pnm_cycle_entries")
      .select("pnms(id, name, photo_path, status)")
      .eq("cycle_id", cycle.id);
    if (error) throw error;

    const pnms = ((data ?? []) as unknown as Array<{ pnms: { id: string; name: string; photo_path: string | null; status: string } | null }>)
      .flatMap((e) => (e.pnms && e.pnms.status !== "former" ? [e.pnms] : []));
    const urls = await signRushPaths(pnms.map((p) => p.photo_path));

    return NextResponse.json({
      cycle: { id: cycle.id, label: cycle.label },
      pnms: pnms
        .map((p) => ({ id: p.id, name: p.name, photoUrl: p.photo_path ? urls.get(p.photo_path) ?? null : null }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  } catch (error) {
    return rushErrorResponse(error, "Failed to load PNMs.");
  }
}

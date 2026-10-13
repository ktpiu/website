import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { assertDeliberationManagePermission, requireAppAuthContext } from "@/lib/server-auth";
import { notifyClosedRushInvite } from "@/lib/rush/notify";
import {
  ensurePnmAccount,
  getCycle,
  readJson,
  RushError,
  rushErrorResponse,
  str,
  writeAccountStatus,
  type PnmRow,
} from "@/lib/rush/server";

export const dynamic = "force-dynamic";

type Action = "advance" | "former";

/** Which stage a PNM must be in for each move. */
const REQUIRED_STAGE: Record<Action, "open" | "closed" | null> = {
  advance: "open",
  former: null,
};

/**
 * Moves PNMs within a cycle:
 *  - open rush:   "advance" (invite to closed rush) or "former"
 *  - closed rush: "former"
 * Accepting a bid is not part of deliberation: the rush committee moves
 * rushees to pledge from User Management.
 * Former PNMs lose access to closed rush events and their account goes back
 * to public; their portal thanks them and invites them back next semester.
 */
export async function POST(request: Request) {
  try {
    const context = await requireAppAuthContext();
    assertDeliberationManagePermission(context);
    const body = await readJson(request);

    const cycle = await getCycle(str(body.cycleId, 64));
    const action = String(body.action) as Action;
    if (!(action in REQUIRED_STAGE)) throw new RushError(400, "Unknown action.");
    const pnmIds = Array.isArray(body.pnmIds)
      ? body.pnmIds.filter((id): id is string => typeof id === "string").slice(0, 500)
      : [];
    if (pnmIds.length === 0) throw new RushError(400, "Select at least one PNM.");

    const { data: entryRows, error: entriesError } = await supabaseAdmin
      .from("pnm_cycle_entries")
      .select("pnm_id, stage, outcome, pnms(*)")
      .eq("cycle_id", cycle.id)
      .in("pnm_id", pnmIds);
    if (entriesError) throw entriesError;

    type Row = { pnm_id: string; stage: string; outcome: string | null; pnms: PnmRow | null };
    const rows = ((entryRows ?? []) as unknown as Row[]).filter((r) => r.pnms);
    const required = REQUIRED_STAGE[action];
    const eligible = rows.filter((r) => r.outcome === null && (!required || r.stage === required));
    if (eligible.length === 0) {
      throw new RushError(
        400,
        required === "open"
          ? "Only open rush PNMs can be invited to closed rush."
          : "None of those PNMs are still rushing this cycle.",
      );
    }

    const now = new Date().toISOString();
    const decided = { decided_by: context.appUser.id, decided_at: now };
    const pnms = eligible.map((r) => r.pnms!);
    const ids = pnms.map((p) => p.id);

    const update = async (entry: Record<string, unknown>, status: PnmRow["status"]) => {
      const [entryRes, pnmRes] = await Promise.all([
        supabaseAdmin.from("pnm_cycle_entries").update({ ...entry, ...decided }).eq("cycle_id", cycle.id).in("pnm_id", ids),
        supabaseAdmin.from("pnms").update({ status, updated_at: now }).in("id", ids),
      ]);
      if (entryRes.error) throw entryRes.error;
      if (pnmRes.error) throw pnmRes.error;
    };

    const accounts = await Promise.all(pnms.map((pnm) => ensurePnmAccount(pnm)));

    if (action === "former") {
      await update({ outcome: "former" }, "former");
      await writeAccountStatus(
        accounts.filter((a) => a.account_status === "rushee").map((a) => a.id),
        "public",
      );
    } else {
      // Deliberation groups restart for closed rush.
      await update({ stage: "closed", group: "undecided" }, "closed");
      for (const pnm of pnms) notifyClosedRushInvite(pnm, `${cycle.label} closed rush`, request);
    }

    return NextResponse.json({ ok: true, moved: ids.length, skipped: pnmIds.length - ids.length });
  } catch (error) {
    return rushErrorResponse(error, "Failed to move the PNMs.");
  }
}

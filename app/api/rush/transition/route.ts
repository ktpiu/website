import { NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { assertDeliberationManagePermission, requireAppAuthContext } from "@/lib/server-auth";
import { preprovisionAppUserByEmail } from "@/lib/app-user";
import { notifyClosedRushInvite } from "@/lib/rush/notify";
import { getCycle, readJson, RushError, rushErrorResponse, str, type PnmRow } from "@/lib/rush/server";

export const dynamic = "force-dynamic";

type Action = "advance" | "pledge" | "former";

/** Which stage a PNM must be in for each move. */
const REQUIRED_STAGE: Record<Action, "open" | "closed" | null> = {
  advance: "open",
  pledge: "closed",
  former: null,
};

/**
 * Moves PNMs within a cycle:
 *  - open rush:   "advance" (invite to closed rush) or "former"
 *  - closed rush: "pledge" (creates their member profile) or "former"
 * Former PNMs lose access to closed rush events; their portal thanks them and
 * invites them back next semester.
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
          : required === "closed"
            ? "Only closed rush PNMs can be made pledges."
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

    if (action === "former") {
      await update({ outcome: "former" }, "former");
    } else if (action === "advance") {
      // Deliberation groups restart for closed rush.
      await update({ stage: "closed", group: "undecided" }, "closed");
      for (const pnm of pnms) notifyClosedRushInvite(pnm, `${cycle.label} closed rush`, request);
    } else {
      // Pledge: create (or reuse) each member profile with the chosen pledge class.
      const roleIds = typeof body.pledgeRoleId === "string" && body.pledgeRoleId ? [body.pledgeRoleId] : [];
      const client = await clerkClient();
      for (const pnm of pnms) {
        const user = await preprovisionAppUserByEmail({ email: pnm.email, name: pnm.name, roleIds });
        const { error } = await supabaseAdmin.from("pnms").update({ linked_user_id: user.id }).eq("id", pnm.id);
        if (error) throw error;
        if (pnm.clerk_user_id) {
          // Lets their next sign-in link to the new member profile by email.
          await client.users.updateUserMetadata(pnm.clerk_user_id, {
            publicMetadata: { accountType: null, pnmId: pnm.id },
          });
        }
      }
      await update({ outcome: "pledged" }, "pledge");
    }

    return NextResponse.json({ ok: true, moved: ids.length, skipped: pnmIds.length - ids.length });
  } catch (error) {
    return rushErrorResponse(error, "Failed to move the PNMs.");
  }
}

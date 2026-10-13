import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { addUserRoles } from "@/lib/app-user";
import { canTransition, ACCOUNT_STATUS_LABELS, type AccountStatus } from "@/lib/account-status";
import {
  ensureCycleEntry,
  findOrCreatePnm,
  findPnmForUser,
  getActiveCycle,
  RushError,
  writeAccountStatus,
  type PnmRow,
} from "@/lib/rush/server";
import type { User as SupabaseUser } from "@/lib/supabase";

type Actor = { userId: string; permissions: Iterable<string> };

export type StatusChangeResult = {
  changed: string[];
  skipped: Array<{ id: string; name: string; reason: string }>;
};

/**
 * Keeps the rush record in line with a status move:
 *  - public -> rushee: registers them in the current cycle (creating the
 *    rush record if needed). Needs an active cycle.
 *  - rushee -> pledge: they accepted a bid; the open cycle entry is "pledged".
 *  - rushee -> public: their rush ends; the open cycle entry is "former".
 *  - pledge -> rushee: undoes a bid.
 */
async function syncRushRecord(
  user: SupabaseUser,
  from: AccountStatus,
  to: AccountStatus,
  actorId: string,
  cycleId: string | null,
) {
  if (to === "rushee" && from === "public") {
    if (!cycleId) throw new RushError(400, "There's no active rush cycle to register them for.");
    const { pnm } = await findOrCreatePnm({ email: user.email, name: user.name });
    if (!pnm.linked_user_id) {
      const { error } = await supabaseAdmin
        .from("pnms")
        .update({ linked_user_id: user.id, clerk_user_id: user.clerk_user_id ?? null })
        .eq("id", pnm.id);
      if (error) throw error;
      pnm.linked_user_id = user.id;
    }
    await ensureCycleEntry(pnm, cycleId);
    return;
  }

  const pnm: PnmRow | null = await findPnmForUser(user);
  if (!pnm) return;

  const now = new Date().toISOString();
  const setPnm = async (status: PnmRow["status"]) => {
    const { error } = await supabaseAdmin.from("pnms").update({ status, updated_at: now }).eq("id", pnm.id);
    if (error) throw error;
  };
  const setEntry = async (outcome: string | null, onlyUndecided: boolean) => {
    if (!cycleId) return;
    let query = supabaseAdmin
      .from("pnm_cycle_entries")
      .update({ outcome, decided_by: outcome ? actorId : null, decided_at: outcome ? now : null })
      .eq("pnm_id", pnm.id)
      .eq("cycle_id", cycleId);
    query = onlyUndecided ? query.is("outcome", null) : query;
    const { error } = await query;
    if (error) throw error;
  };

  if (from === "rushee" && to === "pledge") {
    await setPnm("pledge");
    await setEntry("pledged", true);
  } else if (from === "rushee" && to === "public") {
    await setPnm("former");
    await setEntry("former", true);
  } else if (from === "pledge" && to === "rushee") {
    const { data } = cycleId
      ? await supabaseAdmin.from("pnm_cycle_entries").select("stage").eq("pnm_id", pnm.id).eq("cycle_id", cycleId).maybeSingle()
      : { data: null };
    await setPnm((data as { stage?: "open" | "closed" } | null)?.stage ?? "open");
    await setEntry(null, false);
  }
}

/**
 * Moves accounts to `to`, checking the actor's permission for each account's
 * current status (see TRANSITIONS in lib/account-status.ts). Accounts the
 * actor can't move are skipped with a reason rather than failing the batch.
 */
export async function changeAccountStatus({
  userIds,
  to,
  actor,
  pledgeRoleId,
}: {
  userIds: string[];
  to: AccountStatus;
  actor: Actor;
  /** Pledge class to assign when moving rushees to pledge. */
  pledgeRoleId?: string | null;
}): Promise<StatusChangeResult> {
  const { data, error } = await supabaseAdmin.from("users").select("*").in("id", userIds);
  if (error) throw error;
  const users = (data ?? []) as SupabaseUser[];

  const result: StatusChangeResult = { changed: [], skipped: [] };
  const needsCycle = users.some((u) => u.account_status === "rushee" || u.account_status === "pledge" || to === "rushee");
  const cycleId = needsCycle ? ((await getActiveCycle())?.id ?? null) : null;

  for (const user of users) {
    const from = user.account_status;
    if (from === to) {
      result.skipped.push({ id: user.id, name: user.name, reason: `Already ${ACCOUNT_STATUS_LABELS[to]}.` });
      continue;
    }
    if (!canTransition(actor.permissions, from, to)) {
      result.skipped.push({
        id: user.id,
        name: user.name,
        reason: `You can't move ${ACCOUNT_STATUS_LABELS[from]} accounts to ${ACCOUNT_STATUS_LABELS[to]}.`,
      });
      continue;
    }
    try {
      await syncRushRecord(user, from, to, actor.userId, cycleId);
      // public -> rushee is written by ensureCycleEntry; write it anyway so
      // the move holds if the account had already been registered.
      await writeAccountStatus([user.id], to);
      if (to === "pledge" && pledgeRoleId) await addUserRoles(user.id, [pledgeRoleId]);
      result.changed.push(user.id);
    } catch (moveError) {
      result.skipped.push({
        id: user.id,
        name: user.name,
        reason: moveError instanceof Error ? moveError.message : "Failed to move this account.",
      });
    }
  }

  return result;
}

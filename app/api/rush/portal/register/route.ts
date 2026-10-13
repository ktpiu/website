import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getRushAccount } from "@/lib/rush/pnm-auth";
import {
  ensureCycleEntry,
  findOrCreatePnm,
  getActiveCycle,
  readJson,
  RushError,
  rushErrorResponse,
} from "@/lib/rush/server";
import { isSelfRegisterGrade, saveGraduationYear } from "@/lib/rush/registration";

export const dynamic = "force-dynamic";

/**
 * A signed-in public account says they're rushing. Freshmen and sophomores
 * (by graduation year) may register themselves during open rush; everyone
 * else is registered by checking in to an event, applying, or by the rush
 * committee. Registering makes the account a rushee.
 */
export async function POST(request: Request) {
  try {
    const { account, pnm: existing } = await getRushAccount();
    if (account.account_status !== "public" && account.account_status !== "rushee") {
      throw new RushError(403, "This account can't register for rush.");
    }

    const cycle = await getActiveCycle();
    if (!cycle || cycle.phase !== "open") {
      throw new RushError(403, "Open rush isn't running right now.");
    }

    const body = await readJson(request);
    const graduationYear = Number(body.graduationYear);
    if (!Number.isInteger(graduationYear)) throw new RushError(400, "Pick your graduation year.");
    if (!isSelfRegisterGrade(graduationYear)) {
      throw new RushError(
        403,
        "Only freshmen and sophomores can register here. Check in at an open rush event or apply instead.",
      );
    }

    await saveGraduationYear(account.id, graduationYear);
    const pnm = existing ?? (await findOrCreatePnm({ email: account.email, name: account.name })).pnm;
    const { error } = await supabaseAdmin
      .from("pnms")
      .update({
        linked_user_id: account.id,
        clerk_user_id: account.clerk_user_id ?? null,
        grad_year: graduationYear,
        updated_at: new Date().toISOString(),
      })
      .eq("id", pnm.id);
    if (error) throw error;
    pnm.linked_user_id = account.id;

    await ensureCycleEntry(pnm, cycle.id);
    return NextResponse.json({ ok: true, cycleLabel: cycle.label }, { status: 201 });
  } catch (error) {
    return rushErrorResponse(error, "Failed to register you for rush.");
  }
}

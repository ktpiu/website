import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { assertDeliberationManagePermission, requireAppAuthContext } from "@/lib/server-auth";
import { admitAdmin, closeRound, getActiveSession, getOpenRound } from "@/lib/rush/deliberation";
import { getCycle, readJson, RushError, rushErrorResponse, str } from "@/lib/rush/server";

export const dynamic = "force-dynamic";

/** Start a session for a cycle's open or closed rush. Only one session runs at a time. */
export async function POST(request: Request) {
  try {
    const context = await requireAppAuthContext();
    assertDeliberationManagePermission(context);
    const body = await readJson(request);
    const cycle = await getCycle(str(body.cycleId, 64));
    const stage = body.stage === "closed" ? "closed" : "open";
    if (await getActiveSession()) throw new RushError(409, "A deliberation session is already running.");

    const { data, error } = await supabaseAdmin
      .from("delib_sessions")
      .insert({ cycle_id: cycle.id, stage, started_by: context.appUser.id })
      .select("id")
      .single();
    if (error?.code === "23505") throw new RushError(409, "A deliberation session is already running.");
    if (error) throw error;
    await admitAdmin((data as { id: string }).id, context.appUser.id);
    return NextResponse.json({ id: (data as { id: string }).id }, { status: 201 });
  } catch (error) {
    return rushErrorResponse(error, "Failed to start the session.");
  }
}

/** End the running session, closing any open vote first. */
export async function DELETE() {
  try {
    const context = await requireAppAuthContext();
    assertDeliberationManagePermission(context);
    const session = await getActiveSession();
    if (!session) return NextResponse.json({ ok: true });

    const open = await getOpenRound(session.id);
    if (open) await closeRound(open.id);

    const { error } = await supabaseAdmin
      .from("delib_sessions")
      .update({ status: "ended", ended_at: new Date().toISOString(), current_round_id: null })
      .eq("id", session.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return rushErrorResponse(error, "Failed to end the session.");
  }
}

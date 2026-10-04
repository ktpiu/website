import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAppAuthContext } from "@/lib/server-auth";
import { canManageDeliberation } from "@/lib/permissions";
import { admitAdmin, getParticipantStatus, requireActiveSession } from "@/lib/rush/deliberation";
import { RushError, rushErrorResponse } from "@/lib/rush/server";

export const dynamic = "force-dynamic";

/** Ask to join the running session (admins are admitted immediately). */
export async function POST() {
  try {
    const context = await requireAppAuthContext();
    const session = await requireActiveSession();
    const me = context.appUser.id;

    if (canManageDeliberation(context.permissions)) {
      await admitAdmin(session.id, me);
      return NextResponse.json({ status: "admitted" });
    }

    const current = await getParticipantStatus(session.id, me);
    if (current === "admitted" || current === "requested") return NextResponse.json({ status: current });
    if (current === "removed") throw new RushError(403, "A deliberation admin removed you from this session.");

    const { error } = await supabaseAdmin.from("delib_participants").upsert(
      { session_id: session.id, user_id: me, status: "requested", requested_at: new Date().toISOString(), decided_by: null, decided_at: null },
      { onConflict: "session_id,user_id" },
    );
    if (error) throw error;
    return NextResponse.json({ status: "requested" });
  } catch (error) {
    return rushErrorResponse(error, "Failed to request to join.");
  }
}

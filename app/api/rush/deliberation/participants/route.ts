import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { assertDeliberationManagePermission, requireAppAuthContext } from "@/lib/server-auth";
import { requireActiveSession } from "@/lib/rush/deliberation";
import { readJson, RushError, rushErrorResponse } from "@/lib/rush/server";

export const dynamic = "force-dynamic";

const STATUSES = new Set(["admitted", "denied", "removed"]);

/**
 * Admit / deny / remove participants: { ids: string[], status } or
 * { allRequested: true, status: "admitted" } to admit the whole waiting room.
 */
export async function PATCH(request: Request) {
  try {
    const context = await requireAppAuthContext();
    assertDeliberationManagePermission(context);
    const session = await requireActiveSession();
    const body = await readJson(request);
    const status = String(body.status);
    if (!STATUSES.has(status)) throw new RushError(400, "Unknown participant status.");

    let query = supabaseAdmin
      .from("delib_participants")
      .update({ status, decided_by: context.appUser.id, decided_at: new Date().toISOString() })
      .eq("session_id", session.id);

    if (body.allRequested === true) {
      query = query.eq("status", "requested");
    } else {
      const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === "string") : [];
      if (ids.length === 0) throw new RushError(400, "Choose at least one person.");
      query = query.in("id", ids);
    }

    const { error } = await query;
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return rushErrorResponse(error, "Failed to update participants.");
  }
}

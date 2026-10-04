import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAppAuthContext } from "@/lib/server-auth";
import { canManageRush } from "@/lib/permissions";
import { getEvent } from "@/lib/rush/events";
import { notifySlotUpdate } from "@/lib/rush/notify";
import { getPnm, RushError, rushErrorResponse, toSlotError } from "@/lib/rush/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ signupId: string }> };

/**
 * Removes a signup. Actives can cancel their own (subject to the event's
 * change policy); rush managers can remove anyone at any time.
 */
export async function DELETE(request: Request, { params }: Params) {
  try {
    const context = await requireAppAuthContext();
    const { signupId } = await params;
    const { data, error: lookupError } = await supabaseAdmin
      .from("rush_slot_signups")
      .select("id, event_id, pnm_id, user_id")
      .eq("id", signupId)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (!data) throw new RushError(404, "Signup not found.");
    const signup = data as { id: string; event_id: string; pnm_id: string | null; user_id: string | null };

    const own = signup.user_id === context.appUser.id;
    const admin = canManageRush(context.permissions);
    if (!own && !admin) throw new RushError(403, "You can only cancel your own signup.");

    const { error } = await supabaseAdmin.rpc("rush_cancel_signup", {
      p_signup_id: signup.id,
      p_admin: admin,
    });
    const slotError = toSlotError(error);
    if (slotError) throw slotError;

    if (signup.pnm_id) {
      const event = await getEvent(signup.event_id);
      notifySlotUpdate(await getPnm(signup.pnm_id), event.title, "cancelled", null, request);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return rushErrorResponse(error, "Failed to cancel the signup.");
  }
}

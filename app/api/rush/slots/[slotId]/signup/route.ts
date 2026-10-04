import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAppAuthContext } from "@/lib/server-auth";
import { rushErrorResponse, toSlotError } from "@/lib/rush/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slotId: string }> };

/** An active signing themself up. Event rules are enforced in rush_book_slot. */
export async function POST(_request: Request, { params }: Params) {
  try {
    const context = await requireAppAuthContext();
    const { slotId } = await params;
    const { data, error } = await supabaseAdmin.rpc("rush_book_slot", {
      p_slot_id: slotId,
      p_user_id: context.appUser.id,
    });
    const slotError = toSlotError(error);
    if (slotError) throw slotError;
    return NextResponse.json({ signupId: data });
  } catch (error) {
    return rushErrorResponse(error, "Failed to sign up for the timeslot.");
  }
}

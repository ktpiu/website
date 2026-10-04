import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { assertRushManagePermission, requireAppAuthContext } from "@/lib/server-auth";
import { rushErrorResponse } from "@/lib/rush/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ attendanceId: string }> };

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const context = await requireAppAuthContext();
    assertRushManagePermission(context);
    const { attendanceId } = await params;
    const { error } = await supabaseAdmin.from("rush_event_attendance").delete().eq("id", attendanceId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return rushErrorResponse(error, "Failed to remove the check-in.");
  }
}

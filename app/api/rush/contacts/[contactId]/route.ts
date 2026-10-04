import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { assertRushManagePermission, requireAppAuthContext } from "@/lib/server-auth";
import { optStr, readJson, rushErrorResponse, str } from "@/lib/rush/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ contactId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const context = await requireAppAuthContext();
    assertRushManagePermission(context);
    const { contactId } = await params;
    const body = await readJson(request);
    const { error } = await supabaseAdmin
      .from("rush_contacts")
      .update({
        title: str(body.title, 120),
        public_email: optStr(body.publicEmail, 254),
        public_phone: optStr(body.publicPhone, 40),
        sort_order: Number.isInteger(body.sortOrder) ? (body.sortOrder as number) : 0,
      })
      .eq("id", contactId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return rushErrorResponse(error, "Failed to update the contact.");
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const context = await requireAppAuthContext();
    assertRushManagePermission(context);
    const { contactId } = await params;
    const { error } = await supabaseAdmin.from("rush_contacts").delete().eq("id", contactId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return rushErrorResponse(error, "Failed to remove the contact.");
  }
}

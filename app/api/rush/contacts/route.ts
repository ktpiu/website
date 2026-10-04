import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { assertRushManagePermission, requireAppAuthContext } from "@/lib/server-auth";
import { optStr, readJson, RushError, rushErrorResponse, str } from "@/lib/rush/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const context = await requireAppAuthContext();
    assertRushManagePermission(context);
    const { data, error } = await supabaseAdmin
      .from("rush_contacts")
      .select("id, user_id, title, public_email, public_phone, sort_order, users(name, avatar)")
      .order("sort_order");
    if (error) throw error;
    return NextResponse.json({ contacts: data ?? [] });
  } catch (error) {
    return rushErrorResponse(error, "Failed to load rush contacts.");
  }
}

function contactPatch(body: Record<string, unknown>) {
  return {
    title: str(body.title, 120),
    public_email: optStr(body.publicEmail, 254),
    public_phone: optStr(body.publicPhone, 40),
    sort_order: Number.isInteger(body.sortOrder) ? (body.sortOrder as number) : 0,
  };
}

export async function POST(request: Request) {
  try {
    const context = await requireAppAuthContext();
    assertRushManagePermission(context);
    const body = await readJson(request);
    const userId = str(body.userId, 64);
    if (!userId) throw new RushError(400, "Choose a member.");

    const { data, error } = await supabaseAdmin
      .from("rush_contacts")
      .insert({ user_id: userId, ...contactPatch(body) })
      .select("*")
      .single();
    if (error?.code === "23505") throw new RushError(409, "That member is already a contact.");
    if (error) throw error;
    return NextResponse.json({ contact: data }, { status: 201 });
  } catch (error) {
    return rushErrorResponse(error, "Failed to add the contact.");
  }
}

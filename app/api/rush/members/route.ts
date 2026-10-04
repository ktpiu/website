import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { assertRushManagePermission, requireAppAuthContext } from "@/lib/server-auth";
import { rushErrorResponse } from "@/lib/rush/server";

export const dynamic = "force-dynamic";

/** Current members, for picking rush contacts and assigning actives to slots. */
export async function GET() {
  try {
    const context = await requireAppAuthContext();
    assertRushManagePermission(context);
    const { data, error } = await supabaseAdmin
      .from("users")
      .select("id, name, email, avatar")
      .eq("is_disaffiliated", false)
      .eq("is_alumni", false)
      .order("name");
    if (error) throw error;
    return NextResponse.json({ members: data ?? [] });
  } catch (error) {
    return rushErrorResponse(error, "Failed to load members.");
  }
}

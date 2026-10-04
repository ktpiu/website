import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { assertRushFormsManagePermission, requireAppAuthContext } from "@/lib/server-auth";
import { readJson, RushError, rushErrorResponse } from "@/lib/rush/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ templateId: string }> };

/** Opens or closes a form. While closed, actives can't submit or edit responses. */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const context = await requireAppAuthContext();
    assertRushFormsManagePermission(context);
    const { templateId } = await params;
    const body = await readJson(request);
    if (typeof body.isOpen !== "boolean") throw new RushError(400, "Say whether the form is open.");

    const { data, error } = await supabaseAdmin
      .from("rush_form_templates")
      .update({ is_open: body.isOpen, updated_at: new Date().toISOString() })
      .eq("id", templateId)
      .select("id, is_open")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new RushError(404, "Form not found.");
    return NextResponse.json({ isOpen: (data as { is_open: boolean }).is_open });
  } catch (error) {
    return rushErrorResponse(error, "Failed to update the form.");
  }
}

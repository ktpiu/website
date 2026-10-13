import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { assertRushManagePermission, requireAppAuthContext } from "@/lib/server-auth";
import { RushError, rushErrorResponse } from "@/lib/rush/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ templateId: string }> };

/** Makes an application form the default for cycles without their own. */
export async function POST(_request: Request, { params }: Params) {
  try {
    const context = await requireAppAuthContext();
    assertRushManagePermission(context);
    const { templateId } = await params;

    const { data: template, error: loadError } = await supabaseAdmin
      .from("rush_form_templates")
      .select("id, kind, cycle_id, is_active")
      .eq("id", templateId)
      .maybeSingle();
    if (loadError) throw loadError;
    if (!template) throw new RushError(404, "Form not found.");
    if (template.kind !== "application") throw new RushError(400, "Only application forms can be the default.");
    if (template.cycle_id) throw new RushError(400, "Forms tied to one cycle can't be the default.");
    if (!template.is_active) throw new RushError(400, "Enable this form before making it the default.");

    // Clear first: a unique index allows only one default.
    const { error: clearError } = await supabaseAdmin
      .from("rush_form_templates")
      .update({ is_default: false })
      .eq("is_default", true)
      .neq("id", templateId);
    if (clearError) throw clearError;

    const { error } = await supabaseAdmin.from("rush_form_templates").update({ is_default: true }).eq("id", templateId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return rushErrorResponse(error, "Failed to set the default application.");
  }
}

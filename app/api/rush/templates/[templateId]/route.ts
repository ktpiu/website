import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { assertRushManagePermission, requireAppAuthContext } from "@/lib/server-auth";
import { readJson, RushError, rushErrorResponse, toTemplate } from "@/lib/rush/server";
import { parseTemplateBody } from "@/lib/rush/templates";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ templateId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const context = await requireAppAuthContext();
    assertRushManagePermission(context);
    const { templateId } = await params;
    const template = parseTemplateBody(await readJson(request));
    if (!template.name) throw new RushError(400, "Give the form a name.");
    if (template.fields.length === 0) throw new RushError(400, "Add at least one question.");

    const { data, error } = await supabaseAdmin
      .from("rush_form_templates")
      .update({ ...template, updated_at: new Date().toISOString() })
      .eq("id", templateId)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new RushError(404, "Form not found.");
    return NextResponse.json({ template: toTemplate(data) });
  } catch (error) {
    return rushErrorResponse(error, "Failed to update the form.");
  }
}

/** Forms with responses are archived (deactivated) instead of deleted. */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const context = await requireAppAuthContext();
    assertRushManagePermission(context);
    const { templateId } = await params;

    const { count, error: countError } = await supabaseAdmin
      .from("rush_form_responses")
      .select("id", { count: "exact", head: true })
      .eq("template_id", templateId);
    if (countError) throw countError;

    if ((count ?? 0) > 0) {
      const { error } = await supabaseAdmin
        .from("rush_form_templates")
        .update({ is_active: false })
        .eq("id", templateId);
      if (error) throw error;
      return NextResponse.json({ archived: true });
    }

    const { error } = await supabaseAdmin.from("rush_form_templates").delete().eq("id", templateId);
    if (error) throw error;
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return rushErrorResponse(error, "Failed to delete the form.");
  }
}

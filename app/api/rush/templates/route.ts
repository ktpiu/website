import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { assertRushManagePermission, requireAppAuthContext } from "@/lib/server-auth";
import { canManageRush } from "@/lib/permissions";
import { readJson, RushError, rushErrorResponse, toTemplate } from "@/lib/rush/server";
import { resolveCycleId } from "@/lib/rush/server";
import { parseTemplateBody } from "@/lib/rush/templates";

export const dynamic = "force-dynamic";

/**
 * Form templates. Members get the active evaluation forms for a cycle (global
 * templates plus that cycle's own); rush managers get every template.
 */
export async function GET(request: Request) {
  try {
    const context = await requireAppAuthContext();
    const cycleId = await resolveCycleId(request);
    const manage = canManageRush(context.permissions);

    let query = supabaseAdmin.from("rush_form_templates").select("*").order("sort_order").order("name");
    if (!manage) query = query.eq("kind", "evaluation").eq("is_active", true);
    if (cycleId) query = query.or(`cycle_id.is.null,cycle_id.eq.${cycleId}`);

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ templates: (data ?? []).map(toTemplate) });
  } catch (error) {
    return rushErrorResponse(error, "Failed to load forms.");
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireAppAuthContext();
    assertRushManagePermission(context);
    const template = parseTemplateBody(await readJson(request));
    if (!template.name) throw new RushError(400, "Give the form a name.");
    if (template.fields.length === 0) throw new RushError(400, "Add at least one question.");

    const { data, error } = await supabaseAdmin.from("rush_form_templates").insert(template).select("*").single();
    if (error) throw error;
    return NextResponse.json({ template: toTemplate(data) }, { status: 201 });
  } catch (error) {
    return rushErrorResponse(error, "Failed to create the form.");
  }
}

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAppAuthContext } from "@/lib/server-auth";
import { canManageRush } from "@/lib/permissions";
import { validateResponse } from "@/lib/rush/responses";
import { readJson, RushError, rushErrorResponse } from "@/lib/rush/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ responseId: string }> };

async function loadOwnResponse(responseId: string, userId: string, allowManager: boolean) {
  const { data, error } = await supabaseAdmin
    .from("rush_form_responses")
    .select("id, template_id, author_user_id")
    .eq("id", responseId)
    .maybeSingle();
  if (error) throw error;
  const row = data as { id: string; template_id: string; author_user_id: string | null } | null;
  if (!row) throw new RushError(404, "Submission not found.");
  if (row.author_user_id !== userId && !allowManager) {
    throw new RushError(403, "You can only change your own submissions.");
  }
  return row;
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const context = await requireAppAuthContext();
    const { responseId } = await params;
    const row = await loadOwnResponse(responseId, context.appUser.id, false);
    const { answers } = await validateResponse(row.template_id, (await readJson(request)).answers);
    const { error } = await supabaseAdmin
      .from("rush_form_responses")
      .update({ answers, updated_at: new Date().toISOString() })
      .eq("id", row.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return rushErrorResponse(error, "Failed to update the submission.");
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const context = await requireAppAuthContext();
    const { responseId } = await params;
    const row = await loadOwnResponse(responseId, context.appUser.id, canManageRush(context.permissions));
    const { error } = await supabaseAdmin.from("rush_form_responses").delete().eq("id", row.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return rushErrorResponse(error, "Failed to delete the submission.");
  }
}

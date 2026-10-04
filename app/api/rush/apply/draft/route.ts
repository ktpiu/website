import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getActiveCycle, getApplicationTemplate, readJson, RushError, rushErrorResponse, str } from "@/lib/rush/server";
import { requirePnmAuthContext } from "@/lib/rush/pnm-auth";
import { sanitizeAnswers } from "@/lib/rush/types";

export const dynamic = "force-dynamic";

/**
 * Saves an in-progress application for the signed-in PNM (one draft per
 * cycle). Answers aren't validated until the application is submitted.
 */
export async function PUT(request: Request) {
  try {
    const { pnm } = await requirePnmAuthContext();
    const cycle = await getActiveCycle();
    if (!cycle || cycle.phase !== "open" || !cycle.applications_open) {
      throw new RushError(403, "Applications are closed right now.");
    }
    const template = await getApplicationTemplate(cycle);
    if (!template) throw new RushError(404, "No application is open.");

    const body = await readJson(request);
    const answers = sanitizeAnswers(template.fields, body.answers);
    const { error } = await supabaseAdmin.from("rush_application_drafts").upsert(
      {
        cycle_id: cycle.id,
        pnm_id: pnm.id,
        name: str(body.name, 120),
        answers,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "cycle_id,pnm_id" },
    );
    if (error) throw error;
    return NextResponse.json({ savedAt: new Date().toISOString() });
  } catch (error) {
    return rushErrorResponse(error, "Failed to save your draft.");
  }
}

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { assertRushManagePermission, requireAppAuthContext } from "@/lib/server-auth";
import { getCycle, optStr, readJson, rushErrorResponse } from "@/lib/rush/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ cycleId: string }> };

/** Set current, phase (open / closed / concluded), applications, form, dates. */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const context = await requireAppAuthContext();
    assertRushManagePermission(context);
    const { cycleId } = await params;
    await getCycle(cycleId);
    const body = await readJson(request);

    const patch: Record<string, unknown> = {};
    if (typeof body.applicationsOpen === "boolean") patch.applications_open = body.applicationsOpen;
    if (body.phase === "open" || body.phase === "closed" || body.phase === "concluded") {
      patch.phase = body.phase;
      // Applications belong to open rush.
      if (body.phase !== "open") patch.applications_open = false;
    }
    if ("applicationTemplateId" in body) patch.application_template_id = optStr(body.applicationTemplateId, 64);
    if ("startsOn" in body) patch.starts_on = optStr(body.startsOn, 10);
    if ("endsOn" in body) patch.ends_on = optStr(body.endsOn, 10);

    if (body.isActive === true) {
      // Only one current cycle: clear the old one first.
      const { error } = await supabaseAdmin
        .from("rush_cycles")
        .update({ is_active: false })
        .eq("is_active", true)
        .neq("id", cycleId);
      if (error) throw error;
      patch.is_active = true;
    } else if (body.isActive === false) {
      patch.is_active = false;
    }

    const { data, error } = await supabaseAdmin
      .from("rush_cycles")
      .update(patch)
      .eq("id", cycleId)
      .select("*")
      .single();
    if (error) throw error;
    return NextResponse.json({ cycle: data });
  } catch (error) {
    return rushErrorResponse(error, "Failed to update the rush cycle.");
  }
}

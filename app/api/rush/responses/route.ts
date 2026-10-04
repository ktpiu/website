import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAppAuthContext } from "@/lib/server-auth";
import { conflictField, validateEventLink, validateParticipants, validateResponse } from "@/lib/rush/responses";
import { parsePersonKey } from "@/lib/rush/types";
import { hasCycleEntry, readJson, RushError, rushErrorResponse, str } from "@/lib/rush/server";
import { resolveCycleId } from "@/lib/rush/server";

export const dynamic = "force-dynamic";

/** The signed-in member's own submissions (optionally for one cycle). */
export async function GET(request: Request) {
  try {
    const context = await requireAppAuthContext();
    const cycleId = await resolveCycleId(request);
    let query = supabaseAdmin
      .from("rush_form_responses")
      .select("id, template_id, cycle_id, pnm_id, event_id, answers, participants, created_at, updated_at, pnms(name), rush_form_templates(name), rush_events(title)")
      .eq("author_user_id", context.appUser.id)
      .order("created_at", { ascending: false });
    if (cycleId) query = query.eq("cycle_id", cycleId);
    const { data, error } = await query;
    if (error) throw error;

    type Row = {
      id: string;
      template_id: string;
      cycle_id: string;
      pnm_id: string;
      event_id: string | null;
      participants: Array<{ userId: string; role: string }>;
      answers: Record<string, unknown>;
      created_at: string;
      updated_at: string;
      pnms: { name: string } | null;
      rush_form_templates: { name: string } | null;
      rush_events: { title: string } | null;
    };
    return NextResponse.json({
      responses: ((data ?? []) as unknown as Row[]).map((r) => ({
        id: r.id,
        templateId: r.template_id,
        templateName: r.rush_form_templates?.name ?? "Form",
        cycleId: r.cycle_id,
        pnmId: r.pnm_id,
        pnmName: r.pnms?.name ?? "",
        eventId: r.event_id,
        eventTitle: r.rush_events?.title ?? null,
        participants: r.participants ?? [],
        answers: r.answers,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    });
  } catch (error) {
    return rushErrorResponse(error, "Failed to load your submissions.");
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireAppAuthContext();
    const body = await readJson(request);
    const cycleId = str(body.cycleId, 64);
    if (!cycleId) throw new RushError(400, "Choose a rush cycle.");

    const { template, answers } = await validateResponse(str(body.templateId, 64), body.answers);

    // Conflict forms name the PNMs themselves; one response is stored per PNM.
    const conflict = conflictField(template);
    const pnmIds = conflict
      ? ((answers[conflict.id] as string[] | undefined) ?? []).flatMap((k) => {
          const parsed = parsePersonKey(k);
          return parsed?.kind === "pnm" ? [parsed.id] : [];
        })
      : [str(body.pnmId, 64)].filter(Boolean);
    if (pnmIds.length === 0) throw new RushError(400, "Choose a PNM.");
    for (const pnmId of pnmIds) {
      if (!(await hasCycleEntry(pnmId, cycleId))) throw new RushError(400, "That PNM isn't in this rush cycle.");
    }

    const eventId = await validateEventLink(template, cycleId, str(body.eventId, 64) || null);
    const participants = await validateParticipants(template, body.participants, context.appUser.id);

    const { data, error } = await supabaseAdmin
      .from("rush_form_responses")
      .insert(
        pnmIds.map((pnmId) => ({
          template_id: template.id,
          cycle_id: cycleId,
          pnm_id: pnmId,
          event_id: eventId,
          author_user_id: context.appUser.id,
          participants,
          answers,
        })),
      )
      .select("id");
    if (error) throw error;
    return NextResponse.json({ id: (data as Array<{ id: string }>)[0]?.id, count: pnmIds.length }, { status: 201 });
  } catch (error) {
    return rushErrorResponse(error, "Failed to submit the form.");
  }
}

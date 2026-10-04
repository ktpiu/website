import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getPnm, signRushPaths, toTemplate } from "@/lib/rush/server";
import type { DelibGroup, PnmStatus, RushAnswers, RushFormField, RushStage } from "@/lib/rush/types";

/**
 * Everything the rush committee knows about one PNM: profile, attendance,
 * applications, evaluations and (optionally) voting history. Shared by the
 * admin PNM page and the deliberation "presenting" view.
 */

export type PnmDossier = {
  pnm: {
    id: string;
    name: string;
    email: string;
    isIuEmail: boolean;
    phone: string | null;
    major: string | null;
    gradYear: number | null;
    status: PnmStatus;
    photoUrl: string | null;
    hasAccount: boolean;
    createdAt: string;
  };
  entries: Array<{ cycleId: string; cycleLabel: string; stage: RushStage; group: DelibGroup; outcome: string | null }>;
  attendance: Array<{
    id: string;
    eventId: string;
    eventTitle: string;
    startsAt: string;
    cycleLabel: string;
    method: string;
    checkedInAt: string;
  }>;
  applications: Array<{
    id: string;
    cycleLabel: string;
    submittedAt: string;
    email: string;
    isIuEmail: boolean;
    fields: RushFormField[];
    answers: RushAnswers;
  }>;
  responses: Array<{
    templateId: string;
    templateName: string;
    fields: RushFormField[];
    entries: Array<{ id: string; author: string | null; createdAt: string; answers: RushAnswers }>;
  }>;
  votes?: Array<{
    id: string;
    cycleLabel: string;
    openedAt: string;
    closedAt: string | null;
    status: string;
    stage: RushStage;
    yes: number;
    no: number;
    abstain: number;
  }>;
};

type Options = {
  /** Limit evaluations/applications to one cycle; null = all cycles. */
  cycleId?: string | null;
  /** When false, authors of templates with hide_author_in_deliberation are hidden. */
  showAllAuthors?: boolean;
  includeVotes?: boolean;
  includeContact?: boolean;
};

type Named = { id: string; label?: string; title?: string; name?: string };

export async function loadPnmDossier(pnmId: string, options: Options = {}): Promise<PnmDossier> {
  const { cycleId = null, showAllAuthors = true, includeVotes = false, includeContact = true } = options;
  const pnm = await getPnm(pnmId);

  let applicationsQuery = supabaseAdmin.from("rush_applications").select("*").eq("pnm_id", pnmId);
  let responsesQuery = supabaseAdmin
    .from("rush_form_responses")
    .select("id, template_id, author_user_id, answers, created_at")
    .eq("pnm_id", pnmId);
  if (cycleId) {
    applicationsQuery = applicationsQuery.eq("cycle_id", cycleId);
    responsesQuery = responsesQuery.eq("cycle_id", cycleId);
  }

  const [cyclesRes, entriesRes, attendanceRes, applicationsRes, responsesRes, votesRes] = await Promise.all([
    supabaseAdmin.from("rush_cycles").select("id, label"),
    supabaseAdmin.from("pnm_cycle_entries").select("cycle_id, stage, group, outcome").eq("pnm_id", pnmId),
    supabaseAdmin
      .from("rush_event_attendance")
      .select("id, event_id, method, checked_in_at, rush_events(id, title, starts_at, cycle_id)")
      .eq("pnm_id", pnmId),
    applicationsQuery,
    responsesQuery.order("created_at"),
    includeVotes
      ? supabaseAdmin
          .from("delib_vote_rounds")
          .select("id, cycle_id, stage, status, yes_count, no_count, abstain_count, opened_at, closed_at")
          .eq("pnm_id", pnmId)
          .order("opened_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);

  for (const res of [cyclesRes, entriesRes, attendanceRes, applicationsRes, responsesRes, votesRes]) {
    if (res.error) throw res.error;
  }

  const cycleLabels = new Map(((cyclesRes.data ?? []) as Named[]).map((c) => [c.id, c.label ?? ""]));

  const responses = (responsesRes.data ?? []) as Array<{
    id: string;
    template_id: string;
    author_user_id: string | null;
    answers: RushAnswers;
    created_at: string;
  }>;
  const applications = (applicationsRes.data ?? []) as Array<{
    id: string;
    cycle_id: string;
    template_id: string | null;
    email: string;
    is_iu_email: boolean;
    answers: RushAnswers;
    submitted_at: string;
  }>;

  const templateIds = Array.from(
    new Set([
      ...responses.map((r) => r.template_id),
      ...applications.flatMap((a) => (a.template_id ? [a.template_id] : [])),
    ]),
  );
  const authorIds = Array.from(new Set(responses.flatMap((r) => (r.author_user_id ? [r.author_user_id] : []))));

  const [templatesRes, authorsRes, photoUrls] = await Promise.all([
    templateIds.length
      ? supabaseAdmin.from("rush_form_templates").select("*").in("id", templateIds)
      : Promise.resolve({ data: [], error: null }),
    authorIds.length
      ? supabaseAdmin.from("users").select("id, name").in("id", authorIds)
      : Promise.resolve({ data: [], error: null }),
    signRushPaths([pnm.photo_path]),
  ]);
  if (templatesRes.error) throw templatesRes.error;
  if (authorsRes.error) throw authorsRes.error;

  const templates = new Map(
    ((templatesRes.data ?? []) as Record<string, unknown>[]).map((row) => {
      const t = toTemplate(row);
      return [t.id, t];
    }),
  );
  const authors = new Map(((authorsRes.data ?? []) as Named[]).map((u) => [u.id, u.name ?? ""]));

  const grouped = new Map<string, PnmDossier["responses"][number]>();
  for (const response of responses) {
    const template = templates.get(response.template_id);
    if (!template) continue;
    let group = grouped.get(template.id);
    if (!group) {
      group = { templateId: template.id, templateName: template.name, fields: template.fields, entries: [] };
      grouped.set(template.id, group);
    }
    const hideAuthor = !showAllAuthors && template.hide_author_in_deliberation;
    group.entries.push({
      id: response.id,
      author: hideAuthor ? null : (response.author_user_id && authors.get(response.author_user_id)) || "Former member",
      createdAt: response.created_at,
      answers: response.answers ?? {},
    });
  }

  type AttendanceRow = {
    id: string;
    event_id: string;
    method: string;
    checked_in_at: string;
    rush_events: { title: string; starts_at: string; cycle_id: string } | null;
  };

  return {
    pnm: {
      id: pnm.id,
      name: pnm.name,
      email: includeContact ? pnm.email : "",
      isIuEmail: pnm.is_iu_email,
      phone: includeContact ? pnm.phone : null,
      major: pnm.major,
      gradYear: pnm.grad_year,
      status: pnm.status,
      photoUrl: pnm.photo_path ? photoUrls.get(pnm.photo_path) ?? null : null,
      hasAccount: Boolean(pnm.clerk_user_id),
      createdAt: pnm.created_at,
    },
    entries: (
      (entriesRes.data ?? []) as Array<{ cycle_id: string; stage: RushStage; group: DelibGroup; outcome: string | null }>
    ).map((e) => ({
      cycleId: e.cycle_id,
      cycleLabel: cycleLabels.get(e.cycle_id) ?? "",
      stage: e.stage,
      group: e.group,
      outcome: e.outcome,
    })),
    attendance: ((attendanceRes.data ?? []) as unknown as AttendanceRow[])
      .filter((a) => a.rush_events)
      .map((a) => ({
        id: a.id,
        eventId: a.event_id,
        eventTitle: a.rush_events!.title,
        startsAt: a.rush_events!.starts_at,
        cycleLabel: cycleLabels.get(a.rush_events!.cycle_id) ?? "",
        method: a.method,
        checkedInAt: a.checked_in_at,
      }))
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    applications: applications.map((a) => ({
      id: a.id,
      cycleLabel: cycleLabels.get(a.cycle_id) ?? "",
      submittedAt: a.submitted_at,
      email: includeContact ? a.email : "",
      isIuEmail: a.is_iu_email,
      fields: (a.template_id && templates.get(a.template_id)?.fields) || [],
      answers: a.answers ?? {},
    })),
    responses: Array.from(grouped.values()),
    ...(includeVotes
      ? {
          votes: (
            (votesRes.data ?? []) as Array<{
              id: string;
              cycle_id: string;
              stage: RushStage;
              status: string;
              yes_count: number;
              no_count: number;
              abstain_count: number;
              opened_at: string;
              closed_at: string | null;
            }>
          ).map((v) => ({
            id: v.id,
            cycleLabel: cycleLabels.get(v.cycle_id) ?? "",
            openedAt: v.opened_at,
            closedAt: v.closed_at,
            status: v.status,
            stage: v.stage,
            yes: v.yes_count,
            no: v.no_count,
            abstain: v.abstain_count,
          })),
        }
      : {}),
  };
}

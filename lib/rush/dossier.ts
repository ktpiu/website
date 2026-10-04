import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getPnm, signRushPaths, toTemplate } from "@/lib/rush/server";
import {
  parsePersonKey,
  type AttendanceStatus,
  type DelibGroup,
  type PnmStatus,
  type RushAnswers,
  type RushFormField,
  type RushStage,
} from "@/lib/rush/types";

export type DelibEventActive = {
  userId: string;
  name: string;
  /** attended (green), late, missed (flagged) or unknown (attendance isn't taken). */
  status: "attended" | "late" | "missed" | "unknown";
};

export type DelibEvent = {
  eventId: string;
  title: string;
  startsAt: string;
  attendanceEnabled: boolean;
  /** How this PNM was marked at the event, when tracked. */
  pnmStatus: AttendanceStatus | null;
  /** Actives signed up for the PNM's timeslot (or the event). */
  signedUp: DelibEventActive[];
  /** Actives who submitted an evaluation for this PNM but weren't signed up. */
  others: Array<{ userId: string; name: string }>;
};

export type DelibConflict = { userId: string; name: string; reportedBy: Array<"A" | "PNM"> };

export type ScoreAverage = { fieldId: string; label: string; average: number; count: number };

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
    eventId: string | null;
    eventTitle: string | null;
    /** Each rating question averaged across this group's submissions. */
    averages: ScoreAverage[];
    entries: Array<{
      id: string;
      author: string | null;
      /** Everyone who shared the submission (multi-person forms); empty when the author is hidden. */
      participants: Array<{ name: string; role: string }>;
      createdAt: string;
      answers: RushAnswers;
    }>;
  }>;
  events?: DelibEvent[];
  conflicts?: DelibConflict[];
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
  /** Dinner/interview rosters with attendance, plus reported conflicts. */
  includeDelibData?: boolean;
};

type Named = { id: string; label?: string; title?: string; name?: string };

export async function loadPnmDossier(pnmId: string, options: Options = {}): Promise<PnmDossier> {
  const { cycleId = null, showAllAuthors = true, includeVotes = false, includeContact = true, includeDelibData = false } = options;
  const pnm = await getPnm(pnmId);

  let applicationsQuery = supabaseAdmin.from("rush_applications").select("*").eq("pnm_id", pnmId);
  let responsesQuery = supabaseAdmin
    .from("rush_form_responses")
    .select("id, template_id, event_id, author_user_id, participants, answers, created_at")
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
      .select("id, event_id, method, status, checked_in_at, rush_events(id, title, starts_at, cycle_id)")
      .eq("pnm_id", pnmId)
      .neq("status", "no_show"),
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
    event_id: string | null;
    author_user_id: string | null;
    participants: Array<{ userId: string; role: string }> | null;
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
  const eventIds = Array.from(new Set(responses.flatMap((r) => (r.event_id ? [r.event_id] : []))));
  const personIds = collectPersonIds([...responses.map((r) => r.answers), ...applications.map((a) => a.answers)]);
  const authorIds = Array.from(
    new Set([
      ...responses.flatMap((r) => (r.author_user_id ? [r.author_user_id] : [])),
      ...responses.flatMap((r) => (r.participants ?? []).map((p) => p.userId)),
      ...personIds.users,
    ]),
  );

  const [templatesRes, authorsRes, photoUrls, eventsRes, pnmNamesRes] = await Promise.all([
    templateIds.length
      ? supabaseAdmin.from("rush_form_templates").select("*").in("id", templateIds)
      : Promise.resolve({ data: [], error: null }),
    authorIds.length
      ? supabaseAdmin.from("users").select("id, name").in("id", authorIds)
      : Promise.resolve({ data: [], error: null }),
    signRushPaths([pnm.photo_path]),
    eventIds.length
      ? supabaseAdmin.from("rush_events").select("id, title").in("id", eventIds)
      : Promise.resolve({ data: [], error: null }),
    personIds.pnms.length
      ? supabaseAdmin.from("pnms").select("id, name").in("id", personIds.pnms)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (eventsRes.error) throw eventsRes.error;
  if (pnmNamesRes.error) throw pnmNamesRes.error;
  if (templatesRes.error) throw templatesRes.error;
  if (authorsRes.error) throw authorsRes.error;

  const templates = new Map(
    ((templatesRes.data ?? []) as Record<string, unknown>[]).map((row) => {
      const t = toTemplate(row);
      return [t.id, t];
    }),
  );
  const authors = new Map(((authorsRes.data ?? []) as Named[]).map((u) => [u.id, u.name ?? ""]));

  const eventTitles = new Map(((eventsRes.data ?? []) as Array<{ id: string; title: string }>).map((e) => [e.id, e.title]));
  const pnmNames = new Map(((pnmNamesRes.data ?? []) as Array<{ id: string; name: string }>).map((p) => [p.id, p.name]));
  const nameOf = (userId: string) => authors.get(userId) || "Former member";

  /** Replaces "user:<id>" / "pnm:<id>" keys in answers with names. */
  const resolveAnswers = (fields: RushFormField[], answers: RushAnswers): RushAnswers => {
    const result: RushAnswers = { ...answers };
    for (const field of fields) {
      const value = answers[field.id];
      if (field.type !== "people" || !Array.isArray(value)) continue;
      result[field.id] = value.map((key) => {
        const parsed = parsePersonKey(key);
        if (!parsed) return key;
        return parsed.kind === "user" ? nameOf(parsed.id) : pnmNames.get(parsed.id) ?? "Unknown PNM";
      });
    }
    return result;
  };

  const grouped = new Map<string, PnmDossier["responses"][number]>();
  for (const response of responses) {
    const template = templates.get(response.template_id);
    if (!template) continue;
    const key = `${template.id}:${response.event_id ?? ""}`;
    let group = grouped.get(key);
    if (!group) {
      group = {
        templateId: template.id,
        templateName: template.name,
        fields: template.fields,
        eventId: response.event_id,
        eventTitle: response.event_id ? eventTitles.get(response.event_id) ?? null : null,
        averages: [],
        entries: [],
      };
      grouped.set(key, group);
    }
    const hideAuthor = !showAllAuthors && template.hide_author_in_deliberation;
    group.entries.push({
      id: response.id,
      author: hideAuthor ? null : (response.author_user_id && authors.get(response.author_user_id)) || "Former member",
      participants: hideAuthor ? [] : (response.participants ?? []).map((p) => ({ name: nameOf(p.userId), role: template.participant_roles.find((r) => r.id === p.role)?.label ?? "" })),
      createdAt: response.created_at,
      answers: resolveAnswers(template.fields, response.answers ?? {}),
    });
  }
  for (const group of grouped.values()) {
    group.averages = group.fields
      .filter((f) => f.type === "rating")
      .flatMap((f) => {
        const values = group.entries.map((e) => Number(e.answers[f.id])).filter((n) => Number.isFinite(n) && n > 0);
        return values.length
          ? [{ fieldId: f.id, label: f.label, average: values.reduce((a, b) => a + b, 0) / values.length, count: values.length }]
          : [];
      });
  }

  const delibData = includeDelibData
    ? await loadDelibData({
        pnmId,
        cycleId,
        responses,
        applications,
        templates,
        showAllAuthors,
        nameOf,
      })
    : null;

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
      answers: resolveAnswers((a.template_id && templates.get(a.template_id)?.fields) || [], a.answers ?? {}),
    })),
    responses: Array.from(grouped.values()),
    ...(delibData ?? {}),
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

function collectPersonIds(answerSets: RushAnswers[]) {
  const users = new Set<string>();
  const pnms = new Set<string>();
  for (const answers of answerSets) {
    for (const value of Object.values(answers ?? {})) {
      if (!Array.isArray(value)) continue;
      for (const key of value) {
        const parsed = parsePersonKey(key);
        if (parsed?.kind === "user") users.add(parsed.id);
        else if (parsed?.kind === "pnm") pnms.add(parsed.id);
      }
    }
  }
  return { users: Array.from(users), pnms: Array.from(pnms) };
}

type ResponseRow = {
  id: string;
  template_id: string;
  event_id: string | null;
  author_user_id: string | null;
  participants: Array<{ userId: string; role: string }> | null;
  answers: RushAnswers;
};

/**
 * Deliberation extras: for every dinner/interview the PNM was part of, who
 * was signed up (and whether they showed), who else evaluated; plus the
 * conflicts of interest reported by actives and by the PNM's application.
 */
async function loadDelibData({
  pnmId,
  cycleId,
  responses,
  applications,
  templates,
  showAllAuthors,
  nameOf,
}: {
  pnmId: string;
  cycleId: string | null;
  responses: ResponseRow[];
  applications: Array<{ template_id: string | null; answers: RushAnswers }>;
  templates: Map<string, ReturnType<typeof toTemplate>>;
  showAllAuthors: boolean;
  nameOf: (userId: string) => string;
}): Promise<{ events: DelibEvent[]; conflicts: DelibConflict[] }> {
  const visible = (r: ResponseRow) => {
    const t = templates.get(r.template_id);
    return showAllAuthors || !t?.hide_author_in_deliberation;
  };

  // Conflicts: active-reported (author of a conflict form about this PNM)...
  const reported = new Map<string, Set<"A" | "PNM">>();
  const addConflict = (userId: string, by: "A" | "PNM") => {
    if (!reported.has(userId)) reported.set(userId, new Set());
    reported.get(userId)!.add(by);
  };
  for (const r of responses) {
    const t = templates.get(r.template_id);
    const isConflictForm = t?.fields.some((f) => f.type === "people" && f.people?.conflict && f.people.source === "pnms");
    if (isConflictForm && r.author_user_id) addConflict(r.author_user_id, "A");
  }
  // ...and PNM-reported (actives named on the application).
  for (const app of applications) {
    const t = app.template_id ? templates.get(app.template_id) : null;
    for (const field of t?.fields ?? []) {
      if (field.type !== "people" || !field.people?.conflict || field.people.source === "pnms") continue;
      const value = app.answers?.[field.id];
      if (!Array.isArray(value)) continue;
      for (const key of value) {
        const parsed = parsePersonKey(key);
        if (parsed?.kind === "user") addConflict(parsed.id, "PNM");
      }
    }
  }

  // Events: any the PNM signed up for or that have an evaluation about them.
  const signupsRes = await supabaseAdmin
    .from("rush_slot_signups")
    .select("event_id, slot_id")
    .eq("pnm_id", pnmId);
  if (signupsRes.error) throw signupsRes.error;
  const pnmSlots = new Map(
    ((signupsRes.data ?? []) as Array<{ event_id: string; slot_id: string }>).map((s) => [s.event_id, s.slot_id]),
  );
  const eventIds = Array.from(
    new Set([...pnmSlots.keys(), ...responses.flatMap((r) => (r.event_id ? [r.event_id] : []))]),
  );

  let events: DelibEvent[] = [];
  if (eventIds.length > 0) {
    let eventQuery = supabaseAdmin
      .from("rush_events")
      .select("id, title, starts_at, attendance_enabled, cycle_id")
      .in("id", eventIds);
    if (cycleId) eventQuery = eventQuery.eq("cycle_id", cycleId);
    const [eventsRes, activeSignupsRes, attendanceRes, pnmAttendanceRes] = await Promise.all([
      eventQuery.order("starts_at"),
      supabaseAdmin
        .from("rush_slot_signups")
        .select("event_id, slot_id, user_id")
        .in("event_id", eventIds)
        .not("user_id", "is", null),
      supabaseAdmin
        .from("rush_event_attendance")
        .select("event_id, user_id, status")
        .in("event_id", eventIds)
        .not("user_id", "is", null),
      supabaseAdmin.from("rush_event_attendance").select("event_id, status").eq("pnm_id", pnmId).in("event_id", eventIds),
    ]);
    for (const res of [eventsRes, activeSignupsRes, attendanceRes, pnmAttendanceRes]) if (res.error) throw res.error;

    const activeSignups = (activeSignupsRes.data ?? []) as Array<{ event_id: string; slot_id: string; user_id: string }>;
    const attendance = new Map(
      ((attendanceRes.data ?? []) as Array<{ event_id: string; user_id: string; status: AttendanceStatus }>).map((a) => [
        `${a.event_id}:${a.user_id}`,
        a.status,
      ]),
    );
    const pnmStatus = new Map(
      ((pnmAttendanceRes.data ?? []) as Array<{ event_id: string; status: AttendanceStatus }>).map((a) => [a.event_id, a.status]),
    );

    // Signed-up actives need names we may not have loaded yet.
    const userIds = Array.from(new Set(activeSignups.map((s) => s.user_id)));
    const namesRes = userIds.length
      ? await supabaseAdmin.from("users").select("id, name").in("id", userIds)
      : { data: [], error: null };
    if (namesRes.error) throw namesRes.error;
    const names = new Map(((namesRes.data ?? []) as Array<{ id: string; name: string }>).map((u) => [u.id, u.name]));
    const display = (id: string) => names.get(id) || nameOf(id);

    events = ((eventsRes.data ?? []) as Array<{ id: string; title: string; starts_at: string; attendance_enabled: boolean }>).map((event) => {
      const slotId = pnmSlots.get(event.id);
      const signedIds = Array.from(
        new Set(activeSignups.filter((s) => s.event_id === event.id && (!slotId || s.slot_id === slotId)).map((s) => s.user_id)),
      );
      const evaluators = new Map<string, true>();
      for (const r of responses) {
        if (r.event_id !== event.id || !visible(r)) continue;
        if (r.author_user_id) evaluators.set(r.author_user_id, true);
        for (const p of r.participants ?? []) evaluators.set(p.userId, true);
      }
      return {
        eventId: event.id,
        title: event.title,
        startsAt: event.starts_at,
        attendanceEnabled: event.attendance_enabled,
        pnmStatus: pnmStatus.get(event.id) ?? null,
        signedUp: signedIds
          .map((userId) => {
            const status = attendance.get(`${event.id}:${userId}`);
            return {
              userId,
              name: display(userId),
              status: (status === "present"
                ? "attended"
                : status === "late"
                  ? "late"
                  : status === "no_show" || event.attendance_enabled
                    ? "missed"
                    : "unknown") as DelibEventActive["status"],
            };
          })
          .sort((a, b) => a.name.localeCompare(b.name)),
        others: Array.from(evaluators.keys())
          .filter((id) => !signedIds.includes(id))
          .map((userId) => ({ userId, name: display(userId) }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      };
    });
  }

  const conflicts = Array.from(reported.entries())
    .map(([userId, by]) => ({
      userId,
      name: nameOf(userId),
      reportedBy: (["A", "PNM"] as const).filter((x) => by.has(x)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { events, conflicts };
}

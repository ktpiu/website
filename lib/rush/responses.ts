import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { RushError, toTemplate } from "@/lib/rush/server";
import {
  parsePersonKey,
  sanitizeAnswers,
  validateAnswers,
  type ResponseParticipant,
  type RushFormTemplate,
} from "@/lib/rush/types";

/** Loads an active, open evaluation form and validates answers against it. */
export async function validateResponse(templateId: string, rawAnswers: unknown) {
  const { data, error } = await supabaseAdmin
    .from("rush_form_templates")
    .select("*")
    .eq("id", templateId)
    .eq("kind", "evaluation")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new RushError(404, "Form not found.");
  const template = toTemplate(data);
  if (!template.is_active || !template.is_open) {
    throw new RushError(400, "This form is closed and no longer accepting responses.", "FORM_CLOSED");
  }

  const answers = sanitizeAnswers(template.fields, rawAnswers);
  const fieldErrors = validateAnswers(template.fields, answers);
  if (Object.keys(fieldErrors).length > 0) {
    throw new RushError(400, "Please answer the required questions.", "INVALID", fieldErrors);
  }
  return { template, answers };
}

export { conflictField } from "@/lib/rush/conflicts";

/**
 * Validates who was in the room for a multi-person form. The submitter is
 * always included. Returns [] for single-submitter forms.
 */
export async function validateParticipants(
  template: RushFormTemplate,
  raw: unknown,
  authorId: string,
): Promise<ResponseParticipant[]> {
  if (template.submission_mode !== "multiple") return [];
  const input = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;

  const result: ResponseParticipant[] = [];
  const seen = new Set<string>();
  for (const role of template.participant_roles) {
    const ids = Array.isArray(input[role.id]) ? (input[role.id] as unknown[]) : [];
    const valid = ids.flatMap((v) => {
      if (typeof v !== "string") return [];
      const parsed = parsePersonKey(v);
      return parsed?.kind === "user" ? [parsed.id] : [];
    });
    if (role.required && valid.length === 0) {
      throw new RushError(400, `Add at least one person under "${role.label}".`, "INVALID");
    }
    for (const userId of valid) {
      if (seen.has(userId)) continue;
      seen.add(userId);
      result.push({ userId, role: role.id });
    }
  }
  if (!seen.has(authorId) && template.participant_roles[0]) {
    result.push({ userId: authorId, role: template.participant_roles[0].id });
  }

  const ids = result.map((p) => p.userId);
  if (ids.length) {
    const { data, error } = await supabaseAdmin.from("users").select("id").in("id", ids);
    if (error) throw error;
    if ((data ?? []).length !== ids.length) throw new RushError(400, "One of the people you chose isn't a member.");
  }
  return result;
}

/** Checks the event belongs to the cycle and uses this form. */
export async function validateEventLink(template: RushFormTemplate, cycleId: string, eventId: string | null) {
  const { data, error } = await supabaseAdmin
    .from("rush_events")
    .select("id, form_template_id")
    .eq("cycle_id", cycleId)
    .eq("form_template_id", template.id);
  if (error) throw error;
  const events = (data ?? []) as Array<{ id: string }>;
  if (events.length === 0) return null;
  if (!eventId) throw new RushError(400, "Choose the event this is for.", "INVALID");
  if (!events.some((e) => e.id === eventId)) throw new RushError(400, "That event doesn't use this form.");
  return eventId;
}

import "server-only";
import { RushError, str } from "@/lib/rush/server";
import { parseFields, parseParticipantRoles } from "@/lib/rush/types";

/** Validates a form template payload from the form builder. */
export function parseTemplateBody(body: Record<string, unknown>) {
  const fields = parseFields(body.fields);
  const ids = new Set<string>();
  for (const field of fields) {
    if (!field.label.trim()) throw new RushError(400, "Every question needs a label.");
    if (ids.has(field.id)) throw new RushError(400, "Question ids must be unique.");
    ids.add(field.id);
    if (field.type === "select" && (!field.options || field.options.length < 2)) {
      throw new RushError(400, `"${field.label}" needs at least two options.`);
    }
  }
  const kind = body.kind === "application" ? "application" : "evaluation";
  const multiple = kind === "evaluation" && body.submissionMode === "multiple";
  const participantRoles = multiple ? parseParticipantRoles(body.participantRoles) : [];
  if (multiple && participantRoles.length === 0) {
    throw new RushError(400, "Add at least one role (for example, Interviewers) for multi-person forms.");
  }
  return {
    submission_mode: multiple ? "multiple" : "single",
    participant_roles: participantRoles,
    name: str(body.name, 120),
    description: str(body.description, 1000),
    kind,
    fields,
    hide_author_in_deliberation: Boolean(body.hideAuthorInDeliberation),
    is_active: body.isActive !== false,
    sort_order: Number.isInteger(body.sortOrder) ? (body.sortOrder as number) : 0,
    cycle_id: typeof body.cycleId === "string" && body.cycleId ? body.cycleId : null,
  };
}

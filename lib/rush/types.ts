/**
 * Shared rush types and small pure helpers. Safe to import from both client
 * components and API routes.
 */

export type RushTerm = "fall" | "spring";
/** Open or closed rush: a stage within a cycle, tracked per PNM. */
export type RushStage = "open" | "closed";
/** Where the semester is overall; drives the public rush page. */
export type CyclePhase = "open" | "closed" | "concluded";
export type SlotGrid = "time_rows" | "location_rows";
export type PnmStatus = "open" | "closed" | "pledge" | "former";
export type DelibGroup = "undecided" | "yes" | "no" | "come_back";
export type VoteChoice = "yes" | "no" | "abstain";
export type EventVisibility = "public" | "pnm_portal";
export type SelfChangeMode = "cutoff" | "admin_only";

export type RushCycle = {
  id: string;
  term: RushTerm;
  year: number;
  phase: CyclePhase;
  label: string;
  starts_on: string | null;
  ends_on: string | null;
  is_active: boolean;
  applications_open: boolean;
  application_template_id: string | null;
  created_at: string;
};

export type RushFieldType = "text" | "textarea" | "rating" | "select" | "yesno";

export type RushFormField = {
  id: string;
  label: string;
  type: RushFieldType;
  required: boolean;
  options?: string[];
  help?: string;
};

export type RushFormTemplate = {
  id: string;
  name: string;
  description: string;
  kind: "evaluation" | "application";
  fields: RushFormField[];
  hide_author_in_deliberation: boolean;
  is_active: boolean;
  sort_order: number;
  cycle_id: string | null;
};

export type RushAnswerValue = string | number | boolean;
export type RushAnswers = Record<string, RushAnswerValue>;

export type RushEventRecord = {
  id: string;
  cycle_id: string;
  title: string;
  description: string;
  starts_at: string;
  ends_at: string | null;
  location_name: string;
  location_url: string | null;
  dress_code: string | null;
  image_path: string | null;
  visibility: EventVisibility;
  checkin_token: string;
  checkin_open: boolean;
  has_timeslots: boolean;
  actives_multi_slot: boolean;
  self_change_mode: SelfChangeMode;
  change_cutoff_minutes: number;
  slot_grid: SlotGrid;
};

export type RushSlotRecord = {
  id: string;
  event_id: string;
  starts_at: string;
  ends_at: string | null;
  location_name: string;
  location_url: string | null;
  notes: string | null;
  pnm_capacity: number;
  active_capacity: number;
};

export const FIELD_TYPE_LABELS: Record<RushFieldType, string> = {
  text: "Short text",
  textarea: "Long text",
  rating: "Rating (1–5)",
  select: "Multiple choice",
  yesno: "Yes / No",
};

export const GROUP_LABELS: Record<DelibGroup, string> = {
  undecided: "Undecided",
  yes: "Yes",
  no: "No",
  come_back: "Come back",
};

export const STAGE_LABELS: Record<RushStage, string> = {
  open: "Open rush",
  closed: "Closed rush",
};

export const PHASE_LABELS: Record<CyclePhase, string> = {
  open: "Open rush",
  closed: "Closed rush",
  concluded: "Concluded",
};

export const STATUS_LABELS: Record<PnmStatus, string> = {
  open: "Open rush",
  closed: "Closed rush",
  pledge: "Pledge",
  former: "Former PNM",
};

export function isIuEmail(email: string) {
  return email.trim().toLowerCase().endsWith("@iu.edu");
}

export function looksLikeEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/** Returns an error message per field id; an empty object means valid. */
export function validateAnswers(fields: RushFormField[], answers: RushAnswers) {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const value = answers[field.id];
    const empty =
      value === undefined || value === null || (typeof value === "string" && value.trim() === "");
    if (empty) {
      if (field.required) errors[field.id] = "This question is required.";
      continue;
    }
    switch (field.type) {
      case "rating": {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 1 || n > 5) errors[field.id] = "Pick a rating from 1 to 5.";
        break;
      }
      case "select":
        if (!field.options?.includes(String(value))) errors[field.id] = "Pick one of the options.";
        break;
      case "yesno":
        if (typeof value !== "boolean") errors[field.id] = "Answer yes or no.";
        break;
      default:
        if (typeof value !== "string" || value.length > 5000) errors[field.id] = "Answer is too long.";
    }
  }
  return errors;
}

/** Drops answers for unknown field ids and trims strings. */
export function sanitizeAnswers(fields: RushFormField[], answers: unknown): RushAnswers {
  const result: RushAnswers = {};
  if (!answers || typeof answers !== "object") return result;
  const source = answers as Record<string, unknown>;
  for (const field of fields) {
    const value = source[field.id];
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) result[field.id] = field.type === "rating" ? Number(trimmed) : trimmed;
    } else if (typeof value === "number" || typeof value === "boolean") {
      result[field.id] = value;
    }
  }
  return result;
}

export function parseFields(value: unknown): RushFormField[] {
  if (!Array.isArray(value)) return [];
  const types = new Set(Object.keys(FIELD_TYPE_LABELS));
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const f = raw as Record<string, unknown>;
    if (typeof f.id !== "string" || typeof f.label !== "string" || !types.has(String(f.type))) {
      return [];
    }
    const field: RushFormField = {
      id: f.id,
      label: f.label,
      type: f.type as RushFieldType,
      required: Boolean(f.required),
    };
    if (Array.isArray(f.options)) {
      field.options = f.options.filter((o): o is string => typeof o === "string" && o.trim() !== "");
    }
    if (typeof f.help === "string" && f.help.trim()) field.help = f.help;
    return [field];
  });
}

export function formatAnswer(field: RushFormField, value: RushAnswerValue | undefined) {
  if (value === undefined || value === "") return "—";
  if (field.type === "yesno") return value ? "Yes" : "No";
  if (field.type === "rating") return `${value} / 5`;
  return String(value);
}

export function percent(part: number, total: number) {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

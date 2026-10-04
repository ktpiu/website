import type { RushFormTemplate } from "@/lib/rush/types";

/** Client-safe: the question that makes a form a conflict-of-interest form. */
export function conflictField(template: Pick<RushFormTemplate, "fields">) {
  return template.fields.find((f) => f.type === "people" && f.people?.conflict && f.people.source === "pnms") ?? null;
}

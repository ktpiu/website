import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { RushError, toTemplate } from "@/lib/rush/server";
import { sanitizeAnswers, validateAnswers } from "@/lib/rush/types";

/** Loads an active evaluation form and validates answers against it. */
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
  if (!template.is_active) throw new RushError(400, "This form is no longer accepting responses.");

  const answers = sanitizeAnswers(template.fields, rawAnswers);
  const fieldErrors = validateAnswers(template.fields, answers);
  if (Object.keys(fieldErrors).length > 0) {
    throw new RushError(400, "Please answer the required questions.", "INVALID", fieldErrors);
  }
  return { template, answers };
}

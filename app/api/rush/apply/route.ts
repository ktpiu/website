import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { normalizeEmail } from "@/lib/app-user";
import {
  clientIp,
  ensureCycleEntry,
  findOrCreatePnm,
  getActiveCycle,
  getApplicationTemplate,
  rateLimit,
  replacePnmPhoto,
  RushError,
  rushErrorResponse,
  str,
} from "@/lib/rush/server";
import { getOptionalPnm } from "@/lib/rush/pnm-auth";
import { notifyApplicationReceived } from "@/lib/rush/notify";
import { looksLikeEmail, sanitizeAnswers, validateAnswers } from "@/lib/rush/types";

export const dynamic = "force-dynamic";

async function loadOpenApplication() {
  const cycle = await getActiveCycle();
  if (!cycle || cycle.phase !== "open" || !cycle.applications_open) return null;
  const template = await getApplicationTemplate(cycle);
  return template ? { cycle, template } : null;
}

export async function GET() {
  try {
    const open = await loadOpenApplication();
    const pnm = await getOptionalPnm();
    return NextResponse.json({
      open: Boolean(open),
      cycleLabel: open?.cycle.label ?? null,
      template: open ? { name: open.template.name, description: open.template.description, fields: open.template.fields } : null,
      prefill: pnm ? { name: pnm.name, email: pnm.email } : null,
    });
  } catch (error) {
    return rushErrorResponse(error, "Failed to load the application.");
  }
}

/**
 * Public application (multipart). Anyone can apply; non-IU emails are allowed
 * (the form warns). The application is matched to a PNM by email so it lines
 * up with their check-ins. Resubmitting replaces the previous application.
 */
export async function POST(request: Request) {
  try {
    const form = await request.formData().catch(() => null);
    if (!form) throw new RushError(400, "Invalid form submission.");
    if (str(form.get("website"))) return NextResponse.json({ ok: true, hasAccount: false });

    const name = str(form.get("name"), 120);
    const email = normalizeEmail(str(form.get("email"), 254));
    if (!name) throw new RushError(400, "Enter your name.");
    if (!looksLikeEmail(email)) throw new RushError(400, "Enter a valid email address.");

    rateLimit(`apply:${clientIp(request)}`, 10, 60_000);

    const open = await loadOpenApplication();
    if (!open) throw new RushError(403, "Applications are closed right now.");
    const { cycle, template } = open;

    let rawAnswers: unknown = {};
    try {
      rawAnswers = JSON.parse(String(form.get("answers") ?? "{}"));
    } catch {
      throw new RushError(400, "Invalid answers.");
    }
    const answers = sanitizeAnswers(template.fields, rawAnswers);
    const errors = validateAnswers(template.fields, answers);
    if (Object.keys(errors).length > 0) {
      throw new RushError(400, "Please answer the required questions.", "INVALID", errors);
    }

    const photo = form.get("photo");
    const photoFile = photo instanceof File && photo.size > 0 ? photo : null;

    const { pnm } = await findOrCreatePnm({ email, name });
    if (!photoFile && !pnm.photo_path) throw new RushError(400, "Add a headshot photo.");

    await ensureCycleEntry(pnm, cycle.id);
    const photoPath = photoFile ? await replacePnmPhoto(pnm, photoFile) : pnm.photo_path;

    // Copy well-known application answers onto the PNM profile.
    const profile: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof answers.major === "string") profile.major = answers.major;
    if (typeof answers.phone === "string") profile.phone = answers.phone;
    const gradYear = Number(answers.grad_year);
    if (Number.isInteger(gradYear) && gradYear > 2000 && gradYear < 2100) profile.grad_year = gradYear;
    const { error: profileError } = await supabaseAdmin.from("pnms").update(profile).eq("id", pnm.id);
    if (profileError) throw profileError;

    const { error } = await supabaseAdmin.from("rush_applications").upsert(
      {
        cycle_id: cycle.id,
        pnm_id: pnm.id,
        template_id: template.id,
        name,
        email,
        answers,
        photo_path: photoPath,
        submitted_at: new Date().toISOString(),
      },
      { onConflict: "cycle_id,pnm_id" },
    );
    if (error) throw error;

    notifyApplicationReceived(pnm, cycle.label, request);
    return NextResponse.json({ ok: true, hasAccount: Boolean(pnm.clerk_user_id) });
  } catch (error) {
    return rushErrorResponse(error, "Failed to submit your application.");
  }
}

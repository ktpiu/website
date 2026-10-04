import "server-only";
import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { RouteAuthError } from "@/lib/server-auth";
import { normalizeEmail } from "@/lib/app-user";
import { AVATAR_ALLOWED_TYPES, validateAvatarFile } from "@/lib/avatar-upload";
import { parseFields, type RushCycle, type RushFormTemplate } from "@/lib/rush/types";

export const RUSH_BUCKET = process.env.SUPABASE_RUSH_BUCKET ?? "rush";
const SIGNED_URL_SECONDS = 60 * 60;

/** A handled failure with a status code and a message safe to show users. */
export class RushError extends Error {
  status: number;
  code?: string;
  /** Per-question messages for form submissions. */
  fieldErrors?: Record<string, string>;
  constructor(status: number, message: string, code?: string, fieldErrors?: Record<string, string>) {
    super(message);
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

/** Shared catch block for rush API routes. */
export function rushErrorResponse(error: unknown, fallback: string) {
  if (error instanceof RouteAuthError) {
    return NextResponse.json(error.toResponseBody(), { status: error.status });
  }
  if (error instanceof RushError) {
    return NextResponse.json(
      { error: error.message, code: error.code, fieldErrors: error.fieldErrors },
      { status: error.status },
    );
  }
  console.error(fallback, error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new RushError(400, "Invalid request body.");
  }
  return body as Record<string, unknown>;
}

export function str(value: unknown, max = 500): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function optStr(value: unknown, max = 500): string | null {
  const v = str(value, max);
  return v.length > 0 ? v : null;
}

const SLOT_ERRORS: Record<string, [number, string]> = {
  SLOT_FULL: [409, "That timeslot is full."],
  SLOT_STARTED: [409, "That timeslot has already started."],
  CHANGES_LOCKED: [403, "Signups for this event can only be changed by rush directors."],
  PAST_CUTOFF: [403, "It's too late to change this signup. Contact a rush director."],
  SLOT_NOT_FOUND: [404, "Timeslot not found."],
  SIGNUP_NOT_FOUND: [404, "Signup not found."],
  NO_TIMESLOTS: [400, "This event does not use timeslots."],
};

/** Maps errors raised by rush_book_slot / rush_cancel_signup to RushErrors. */
export function toSlotError(error: { message?: string; code?: string } | null) {
  if (!error) return null;
  if (error.code === "23505") return new RushError(409, "You already have a slot for this event.", "DUPLICATE");
  const key = Object.keys(SLOT_ERRORS).find((k) => error.message?.includes(k));
  if (key) return new RushError(SLOT_ERRORS[key][0], SLOT_ERRORS[key][1], key);
  return new Error(error.message ?? "Slot booking failed.");
}

// ---------------------------------------------------------------------------
// Cycles and templates
// ---------------------------------------------------------------------------

export async function getActiveCycle(): Promise<RushCycle | null> {
  const { data, error } = await supabaseAdmin
    .from("rush_cycles")
    .select("*")
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  return (data as RushCycle | null) ?? null;
}

export async function getCycle(cycleId: string): Promise<RushCycle> {
  const { data, error } = await supabaseAdmin
    .from("rush_cycles")
    .select("*")
    .eq("id", cycleId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new RushError(404, "Rush cycle not found.");
  return data as RushCycle;
}

/** The cycle from ?cycleId=, falling back to the active one ("current" or absent). */
export async function resolveCycle(request: Request): Promise<RushCycle | null> {
  const cycleId = new URL(request.url).searchParams.get("cycleId");
  return cycleId && cycleId !== "current" ? getCycle(cycleId) : getActiveCycle();
}

/** The ?cycleId= param as a real id ("current" resolves to the active cycle). */
export async function resolveCycleId(request: Request): Promise<string | null> {
  const cycleId = new URL(request.url).searchParams.get("cycleId");
  if (!cycleId) return null;
  if (cycleId !== "current") return cycleId;
  return (await getActiveCycle())?.id ?? null;
}

export function toTemplate(row: Record<string, unknown>): RushFormTemplate {
  return { ...(row as unknown as RushFormTemplate), fields: parseFields(row.fields) };
}

export async function getApplicationTemplate(cycle: RushCycle) {
  let query = supabaseAdmin.from("rush_form_templates").select("*").eq("kind", "application");
  query = cycle.application_template_id
    ? query.eq("id", cycle.application_template_id)
    : query.is("cycle_id", null).eq("is_active", true).order("sort_order").limit(1);
  const { data, error } = await query;
  if (error) throw error;
  const row = (data ?? [])[0];
  return row ? toTemplate(row) : null;
}

// ---------------------------------------------------------------------------
// PNMs
// ---------------------------------------------------------------------------

export type PnmRow = {
  id: string;
  email: string;
  name: string;
  is_iu_email: boolean;
  phone: string | null;
  major: string | null;
  grad_year: number | null;
  photo_path: string | null;
  status: "open" | "closed" | "pledge" | "former";
  clerk_user_id: string | null;
  linked_user_id: string | null;
  created_at: string;
  updated_at: string;
};

export async function findPnmByEmail(email: string): Promise<PnmRow | null> {
  const { data, error } = await supabaseAdmin
    .from("pnms")
    .select("*")
    .eq("email", normalizeEmail(email))
    .maybeSingle();
  if (error) throw error;
  return (data as PnmRow | null) ?? null;
}

export async function getPnm(pnmId: string): Promise<PnmRow> {
  const { data, error } = await supabaseAdmin.from("pnms").select("*").eq("id", pnmId).maybeSingle();
  if (error) throw error;
  if (!data) throw new RushError(404, "PNM not found.");
  return data as PnmRow;
}

/** Finds a PNM by email or creates one. Never overwrites an existing name. */
export async function findOrCreatePnm({ email, name }: { email: string; name: string }) {
  const normalized = normalizeEmail(email);
  const existing = await findPnmByEmail(normalized);
  if (existing) return { pnm: existing, created: false };

  const { data, error } = await supabaseAdmin
    .from("pnms")
    .insert({ email: normalized, name: name.trim() })
    .select("*")
    .single();
  if (error?.code === "23505") {
    const raced = await findPnmByEmail(normalized);
    if (raced) return { pnm: raced, created: false };
  }
  if (error || !data) throw error ?? new Error("Failed to create PNM.");
  return { pnm: data as PnmRow, created: true };
}

/**
 * Adds a PNM to a cycle (open rush stage). A former PNM rushing again in a
 * new semester becomes an open rush PNM again.
 */
export async function ensureCycleEntry(pnm: Pick<PnmRow, "id" | "status">, cycleId: string) {
  const { data, error } = await supabaseAdmin
    .from("pnm_cycle_entries")
    .upsert({ pnm_id: pnm.id, cycle_id: cycleId }, { onConflict: "pnm_id,cycle_id", ignoreDuplicates: true })
    .select("id");
  if (error) throw error;
  const created = (data ?? []).length > 0;
  if (created && pnm.status === "former") {
    const { error: statusError } = await supabaseAdmin
      .from("pnms")
      .update({ status: "open", updated_at: new Date().toISOString() })
      .eq("id", pnm.id);
    if (statusError) throw statusError;
  }
  return created;
}

export type CycleEntry = { stage: "open" | "closed"; group: string; outcome: string | null };

export async function getCycleEntry(pnmId: string, cycleId: string): Promise<CycleEntry | null> {
  const { data, error } = await supabaseAdmin
    .from("pnm_cycle_entries")
    .select("stage, group, outcome")
    .eq("pnm_id", pnmId)
    .eq("cycle_id", cycleId)
    .maybeSingle();
  if (error) throw error;
  return (data as CycleEntry | null) ?? null;
}

export async function hasCycleEntry(pnmId: string, cycleId: string) {
  return Boolean(await getCycleEntry(pnmId, cycleId));
}

/** Still rushing in closed rush this cycle (invited and not yet decided). */
export function isActiveClosedEntry(entry: CycleEntry | null) {
  return entry?.stage === "closed" && entry.outcome === null;
}

// ---------------------------------------------------------------------------
// Storage (private bucket, signed URLs)
// ---------------------------------------------------------------------------

export async function signRushPaths(paths: Array<string | null | undefined>) {
  const unique = Array.from(new Set(paths.filter((p): p is string => Boolean(p))));
  const urls = new Map<string, string>();
  if (unique.length === 0) return urls;
  const { data, error } = await supabaseAdmin.storage
    .from(RUSH_BUCKET)
    .createSignedUrls(unique, SIGNED_URL_SECONDS);
  if (error) {
    console.error("Failed to sign rush photo URLs:", error);
    return urls;
  }
  for (const item of data ?? []) {
    if (item.path && item.signedUrl) urls.set(item.path, item.signedUrl);
  }
  return urls;
}

export async function signRushPath(path: string | null | undefined) {
  if (!path) return null;
  return (await signRushPaths([path])).get(path) ?? null;
}

/** Validates and stores an image under `<folder>/`, returning its object path. */
export async function uploadRushImage(folder: string, file: File) {
  const problem = validateAvatarFile(file);
  if (problem) throw new RushError(400, problem.replace("Profile pictures", "Photos"));
  const extension = AVATAR_ALLOWED_TYPES[file.type];
  const objectPath = `${folder}/${Date.now()}-${randomUUID()}.${extension}`;
  const { error } = await supabaseAdmin.storage
    .from(RUSH_BUCKET)
    .upload(objectPath, Buffer.from(await file.arrayBuffer()), {
      contentType: file.type,
      cacheControl: "3600",
      upsert: false,
    });
  if (error) throw new Error(error.message || "Failed to upload photo.");
  return objectPath;
}

export async function removeRushObject(path: string | null | undefined) {
  if (!path) return;
  const { error } = await supabaseAdmin.storage.from(RUSH_BUCKET).remove([path]);
  if (error) console.error("Failed to remove rush object:", error);
}

/** Replaces a PNM's headshot, cleaning up the previous file. */
export async function replacePnmPhoto(pnm: PnmRow, file: File) {
  const path = await uploadRushImage(`pnms/${pnm.id}`, file);
  const { error } = await supabaseAdmin
    .from("pnms")
    .update({ photo_path: path, updated_at: new Date().toISOString() })
    .eq("id", pnm.id);
  if (error) {
    await removeRushObject(path);
    throw error;
  }
  if (pnm.photo_path && pnm.photo_path !== path) await removeRushObject(pnm.photo_path);
  return path;
}

// ---------------------------------------------------------------------------
// Lightweight per-instance rate limiting for the public endpoints. Serverless
// instances don't share memory, so this only blunts bursts; the honeypot and
// idempotent writes do the rest.
// ---------------------------------------------------------------------------

const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 5000) {
      for (const [k, v] of buckets) if (v.resetAt < now) buckets.delete(k);
    }
    return;
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    throw new RushError(429, "Too many requests. Please wait a minute and try again.");
  }
}

export function clientIp(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

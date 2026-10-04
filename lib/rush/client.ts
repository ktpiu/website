/**
 * Browser helpers for the rush UI: JSON fetching that surfaces API error
 * messages, and date formatting in the viewer's local time.
 */

export class ApiError extends Error {
  status: number;
  code?: string;
  fieldErrors?: Record<string, string>;
  constructor(status: number, message: string, code?: string, fieldErrors?: Record<string, string>) {
    super(message);
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

export async function rushFetch<T = unknown>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const response = await fetch(url, {
    cache: "no-store",
    ...rest,
    ...(json !== undefined
      ? { body: JSON.stringify(json), headers: { "Content-Type": "application/json", ...rest.headers } }
      : {}),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new ApiError(
      response.status,
      typeof body.error === "string" ? body.error : "Something went wrong.",
      typeof body.code === "string" ? body.code : undefined,
      (body.fieldErrors as Record<string, string> | undefined) ?? undefined,
    );
  }
  return body as T;
}

export function errorMessage(error: unknown, fallback = "Something went wrong.") {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function formatDay(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** "Tue, Oct 6 · 7:00 PM – 9:00 PM" */
export function formatRange(startsAt: string, endsAt?: string | null) {
  return `${formatDay(startsAt)} · ${formatTime(startsAt)}${endsAt ? ` – ${formatTime(endsAt)}` : ""}`;
}

export function formatDateTime(iso: string) {
  return `${formatDay(iso)}, ${formatTime(iso)}`;
}

/** Value for <input type="datetime-local"> in local time. */
export function toLocalInput(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(value: string) {
  return value ? new Date(value).toISOString() : null;
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

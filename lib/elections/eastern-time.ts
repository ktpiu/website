/**
 * Election deadlines are entered and shown in Eastern Time whatever the
 * viewer's own time zone, and stored as UTC instants. Uses Intl only, so it
 * runs in the browser and on the server.
 */

export const ELECTION_TIME_ZONE = "America/New_York";

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: ELECTION_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function easternParts(date: Date) {
  const parts: Record<string, number> = {};
  for (const part of partsFormatter.formatToParts(date)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return parts as Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>;
}

/** Milliseconds Eastern Time is ahead of UTC at that instant (negative). */
function easternOffset(date: Date) {
  const p = easternParts(date);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

const LOCAL_INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/**
 * "2026-11-09T23:59" read as Eastern wall-clock time -> ISO UTC instant.
 * Null when the value isn't a valid datetime-local string.
 */
export function easternInputToIso(value: string): string | null {
  const match = LOCAL_INPUT.exec(value);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number);
  const wallClock = Date.UTC(y, mo - 1, d, h, mi);
  if (Number.isNaN(wallClock)) return null;
  // Correct twice so instants near a daylight-saving switch land right.
  let instant = wallClock - easternOffset(new Date(wallClock));
  instant = wallClock - easternOffset(new Date(instant));
  return new Date(instant).toISOString();
}

/** ISO instant -> value for <input type="datetime-local"> in Eastern Time. */
export function isoToEasternInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const p = easternParts(new Date(iso));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

const displayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: ELECTION_TIME_ZONE,
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

/** "Mon, Nov 9, 2026, 11:59 PM EST" */
export function formatEastern(iso: string) {
  return displayFormatter.format(new Date(iso));
}

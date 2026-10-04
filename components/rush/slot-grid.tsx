import type { ReactNode } from "react";
import { formatDay, formatTime } from "@/lib/rush/client";
import type { SlotGrid as SlotGridLayout } from "@/lib/rush/types";

type GridSlot = { id: string; startsAt: string; endsAt: string | null; locationName: string };

const NO_LOCATION = "No location";

/**
 * Timeslots as a table. "time_rows" puts times down the side and locations
 * across the top (interviews); "location_rows" flips it (dinners). Scrolls
 * sideways inside its own container on narrow screens.
 */
export function SlotGrid<T extends GridSlot>({
  slots,
  layout,
  renderCell,
  renderHeader,
  alwaysShowDate = false,
}: {
  slots: T[];
  layout: SlotGridLayout;
  renderCell: (slot: T) => ReactNode;
  /** Replaces a row/column header, e.g. to add edit controls. `group` is every slot under that header. */
  renderHeader?: (axis: "time" | "location", label: string, group: T[]) => ReactNode;
  /** Show the date on every time label, not only when the slots span several days. */
  alwaysShowDate?: boolean;
}) {
  if (slots.length === 0) return null;

  const sorted = [...slots].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const multiDay = alwaysShowDate || new Set(sorted.map((s) => new Date(s.startsAt).toDateString())).size > 1;

  const timeKey = (s: GridSlot) => `${s.startsAt}|${s.endsAt ?? ""}`;
  const locationKey = (s: GridSlot) => s.locationName.trim() || NO_LOCATION;
  const timeLabel = (s: GridSlot) =>
    `${multiDay ? `${formatDay(s.startsAt)} · ` : ""}${formatTime(s.startsAt)}${s.endsAt ? ` – ${formatTime(s.endsAt)}` : ""}`;

  const unique = <K,>(items: T[], key: (s: T) => K) => {
    const seen = new Map<K, T>();
    for (const item of items) if (!seen.has(key(item))) seen.set(key(item), item);
    return Array.from(seen.entries());
  };
  const times = unique(sorted, timeKey);
  const locations = unique(sorted, locationKey).sort(([a], [b]) => String(a).localeCompare(String(b)));

  const rows = layout === "time_rows" ? times : locations;
  const cols = layout === "time_rows" ? locations : times;
  const rowKey = layout === "time_rows" ? timeKey : locationKey;
  const colKey = layout === "time_rows" ? locationKey : timeKey;
  const label = (key: string, sample: T, isTime: boolean) => (isTime ? timeLabel(sample) : key);
  const header = (key: string, sample: T, isTime: boolean) => {
    const text = label(key, sample, isTime);
    if (!renderHeader) return text;
    const group = sorted.filter((s) => (isTime ? timeKey(s) === key : locationKey(s) === key));
    return renderHeader(isTime ? "time" : "location", text, group);
  };

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-muted/50">
            <th className="sticky left-0 z-10 min-w-28 border-b bg-muted px-3 py-2 text-left text-xs font-medium text-muted-foreground">
              {layout === "time_rows" ? "Time" : "Location"}
            </th>
            {cols.map(([key, sample]) => (
              <th key={String(key)} className="min-w-48 border-b border-l px-3 py-2 text-left text-xs font-semibold">
                {header(String(key), sample, layout !== "time_rows")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([rKey, rSample]) => (
            <tr key={String(rKey)} className="align-top">
              <th className="sticky left-0 z-10 border-b bg-background px-3 py-2 text-left text-xs font-semibold">
                {header(String(rKey), rSample, layout === "time_rows")}
              </th>
              {cols.map(([cKey]) => {
                const here = sorted.filter((s) => rowKey(s) === rKey && colKey(s) === cKey);
                return (
                  <td key={String(cKey)} className="border-b border-l p-2">
                    {here.length === 0 ? (
                      <span className="text-xs text-muted-foreground/60">—</span>
                    ) : (
                      <div className="space-y-2">
                        {here.map((slot) => (
                          <div key={slot.id}>{renderCell(slot)}</div>
                        ))}
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

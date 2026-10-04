"use client";

import { Check, Clock, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ATTENDANCE_LABELS, type AttendanceStatus } from "@/lib/rush/types";

const OPTIONS: Array<{ status: AttendanceStatus; icon: typeof Check; active: string }> = [
  { status: "present", icon: Check, active: "border-emerald-500 bg-emerald-500 text-white" },
  { status: "late", icon: Clock, active: "border-amber-500 bg-amber-500 text-white" },
  { status: "no_show", icon: X, active: "border-destructive bg-destructive text-white" },
];

/** Present / late / no-show buttons. Clicking the active one clears the mark. */
export function AttendanceMark({
  value,
  onChange,
  disabled,
  onlyNoShow,
}: {
  value: AttendanceStatus | null;
  onChange: (status: AttendanceStatus | null) => void;
  disabled?: boolean;
  /** For events that don't take attendance: only no-shows can be flagged. */
  onlyNoShow?: boolean;
}) {
  return (
    <div className="flex gap-1" role="group" aria-label="Attendance">
      {OPTIONS.filter((o) => !onlyNoShow || o.status === "no_show").map(({ status, icon: Icon, active }) => (
        <button
          key={status}
          type="button"
          disabled={disabled}
          title={ATTENDANCE_LABELS[status]}
          aria-label={ATTENDANCE_LABELS[status]}
          aria-pressed={value === status}
          onClick={() => onChange(value === status ? null : status)}
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded border text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50",
            value === status && active,
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </button>
      ))}
    </div>
  );
}

export function AttendanceChip({ status }: { status: AttendanceStatus }) {
  const style =
    status === "present"
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
      : status === "late"
        ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
        : "bg-destructive/15 text-destructive";
  return <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", style)}>{ATTENDANCE_LABELS[status]}</span>;
}

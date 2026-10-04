import { percent } from "@/lib/rush/types";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { key: "yes", label: "Yes", bar: "bg-emerald-500" },
  { key: "no", label: "No", bar: "bg-red-500" },
  { key: "abstain", label: "Abstain", bar: "bg-slate-400" },
] as const;

/** Vote totals with counts, percentages and bars. Never shows who voted. */
export function VoteBreakdown({
  yes,
  no,
  abstain,
  compact = false,
}: {
  yes: number;
  no: number;
  abstain: number;
  compact?: boolean;
}) {
  const counts = { yes, no, abstain };
  const total = yes + no + abstain;
  return (
    <div className={cn("space-y-2", compact && "space-y-1.5")}>
      {OPTIONS.map((option) => {
        const count = counts[option.key];
        const pct = percent(count, total);
        return (
          <div key={option.key} className="space-y-1">
            <div className={cn("flex items-baseline justify-between", compact ? "text-xs" : "text-sm")}>
              <span className="font-medium">{option.label}</span>
              <span className="tabular-nums text-muted-foreground">
                {count} · {pct}%
              </span>
            </div>
            <div className={cn("overflow-hidden rounded-full bg-muted", compact ? "h-1.5" : "h-3")}>
              <div
                className={cn("h-full rounded-full transition-[width] duration-500 ease-out", option.bar)}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
      <p className={cn("text-muted-foreground", compact ? "text-[11px]" : "text-xs")}>
        {total} vote{total === 1 ? "" : "s"} cast
      </p>
    </div>
  );
}

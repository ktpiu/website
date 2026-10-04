import { cn } from "@/lib/utils";

/** Pulsing red dot that marks something as live. */
export function LiveIndicator({ className }: { className?: string }) {
  return (
    <span className={cn("relative flex h-2.5 w-2.5 shrink-0", className)} role="img" aria-label="Live" title="Live">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
    </span>
  );
}

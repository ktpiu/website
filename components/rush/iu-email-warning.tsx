import { AlertTriangle } from "lucide-react";
import { isIuEmail, looksLikeEmail } from "@/lib/rush/types";

/** Non-blocking nudge toward @iu.edu addresses. */
export function IuEmailWarning({ email }: { email: string }) {
  if (!looksLikeEmail(email) || isIuEmail(email)) return null;
  return (
    <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>
        This isn&apos;t an @iu.edu address. Please use your IU email so we can match your check-ins and application.
        You can still continue with this one.
      </span>
    </p>
  );
}

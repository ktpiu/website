"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { errorMessage, rushFetch } from "@/lib/rush/client";
import { STAGE_LABELS, type RushCycle, type RushStage } from "@/lib/rush/types";
import { cn } from "@/lib/utils";

type Action = "advance" | "former";

const ACTION_COPY: Record<Action, { label: string; description: string }> = {
  advance: {
    label: "Invite to closed rush",
    description: "Moves them to closed rush, unlocks closed rush events in their portal and emails an invite.",
  },
  former: {
    label: "End their rush",
    description:
      "Ends their rush this semester. Their accounts go back to public, they lose access to closed rush events, and their portal invites them back next semester.",
  },
};

/**
 * Bulk move PNMs within a cycle: open rush → closed / former, closed rush →
 * former. Accepting a bid happens in User Management, not deliberation.
 */
export function TransitionDialog({
  open,
  onOpenChange,
  cycle,
  stage,
  pnms,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cycle: Pick<RushCycle, "id" | "label">;
  /** The stage of the selected PNMs. */
  stage: RushStage;
  pnms: Array<{ id: string; name: string }>;
  onDone: () => void;
}) {
  const actions: Action[] = stage === "open" ? ["advance", "former"] : ["former"];
  const [action, setAction] = useState<Action>(actions[0]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setAction(stage === "open" ? "advance" : "former");
  }, [open, stage]);

  const submit = async () => {
    setBusy(true);
    try {
      await rushFetch("/api/rush/transition", {
        method: "POST",
        json: { cycleId: cycle.id, pnmIds: pnms.map((p) => p.id), action },
      });
      toast.success(`Moved ${pnms.length} PNM${pnms.length === 1 ? "" : "s"}.`);
      onOpenChange(false);
      onDone();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Move {pnms.length} PNM{pnms.length === 1 ? "" : "s"}</DialogTitle>
          <DialogDescription>
            {cycle.label} · {STAGE_LABELS[stage]}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {actions.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setAction(a)}
              className={cn(
                "w-full rounded-lg border p-3 text-left transition-colors",
                action === a ? "border-primary bg-primary/5" : "hover:bg-muted",
              )}
            >
              <p className="font-medium">{ACTION_COPY[a].label}</p>
              <p className="text-sm text-muted-foreground">{ACTION_COPY[a].description}</p>
            </button>
          ))}
        </div>
        <p className="max-h-24 overflow-y-auto text-xs text-muted-foreground">{pnms.map((p) => p.name).join(", ")}</p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || pnms.length === 0}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {ACTION_COPY[action].label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

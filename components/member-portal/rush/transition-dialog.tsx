"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/rush/native-select";
import { supabase } from "@/lib/supabase";
import { errorMessage, rushFetch } from "@/lib/rush/client";
import { STAGE_LABELS, type RushCycle, type RushStage } from "@/lib/rush/types";
import { cn } from "@/lib/utils";

type Action = "advance" | "pledge" | "former";

const ACTION_COPY: Record<Action, { label: string; description: string }> = {
  advance: {
    label: "Invite to closed rush",
    description: "Moves them to closed rush, unlocks closed rush events in their portal and emails an invite.",
  },
  pledge: {
    label: "Make pledges",
    description: "Creates their member profile (linked to their email) and assigns the pledge class you choose.",
  },
  former: {
    label: "Move to former PNM",
    description:
      "Ends their rush this semester. They lose access to closed rush events and their portal invites them back next semester.",
  },
};

/** Bulk move PNMs within a cycle: open rush → closed / former, closed rush → pledge / former. */
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
  const actions: Action[] = stage === "open" ? ["advance", "former"] : ["pledge", "former"];
  const [action, setAction] = useState<Action>(actions[0]);
  const [pledgeClasses, setPledgeClasses] = useState<Array<{ id: string; name: string }>>([]);
  const [pledgeRoleId, setPledgeRoleId] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setAction(stage === "open" ? "advance" : "pledge");
  }, [open, stage]);

  useEffect(() => {
    if (!open || stage !== "closed") return;
    supabase
      .from("roles")
      .select("id, name, priority")
      .eq("type", "pledge_class")
      .order("priority")
      .then(({ data }) => {
        const roles = (data ?? []) as Array<{ id: string; name: string }>;
        setPledgeClasses(roles);
        setPledgeRoleId((current) => current || roles[0]?.id || "");
      });
  }, [open, stage]);

  const submit = async () => {
    setBusy(true);
    try {
      await rushFetch("/api/rush/transition", {
        method: "POST",
        json: { cycleId: cycle.id, pnmIds: pnms.map((p) => p.id), action, pledgeRoleId: action === "pledge" ? pledgeRoleId : null },
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
        {action === "pledge" ? (
          <div className="space-y-2">
            <Label htmlFor="pledge-class">Pledge class</Label>
            <NativeSelect id="pledge-class" value={pledgeRoleId} onChange={(e) => setPledgeRoleId(e.target.value)}>
              <option value="">No pledge class</option>
              {pledgeClasses.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        ) : null}
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

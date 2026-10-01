"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import { MemberAvatar } from "./MemberAvatar";
import { formatCents, parseDollarsToCents, type FinanceMember } from "./shared";

export function AddMembersDialog({
  open,
  onOpenChange,
  chargeId,
  chargeTitle,
  existingUserIds,
  defaultAmountCents,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chargeId: string;
  chargeTitle: string;
  existingUserIds: string[];
  defaultAmountCents: number | null;
  onAdded: () => void;
}) {
  const membersQuery = useQuery({
    queryKey: ["finance", "members"],
    enabled: open,
    queryFn: async () => {
      const response = await fetch("/api/finance/admin/members");
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Failed to load members.");
      return result as { members: FinanceMember[] };
    },
  });
  const members = membersQuery.data?.members ?? null;
  const [query, setQuery] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [baseInput, setBaseInput] = useState("");
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setOverrides({});
    setQuery("");
    setShowInactive(false);
    setBaseInput(defaultAmountCents ? String(defaultAmountCents / 100) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const candidates = useMemo(() => {
    const taken = new Set(existingUserIds);
    const q = query.trim().toLowerCase();
    return (members ?? [])
      .filter((m) => !taken.has(m.id))
      .filter((m) => showInactive || !(m.isAlumni || m.isDisaffiliated))
      .filter((m) => !q || m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q));
  }, [members, existingUserIds, query, showInactive]);

  const baseCents = parseDollarsToCents(baseInput);
  const amountFor = (id: string) => parseDollarsToCents(overrides[id] ?? "") ?? baseCents;
  const picked = (members ?? []).filter((m) => selected.has(m.id));
  const missing = picked.filter((m) => !amountFor(m.id)).length;
  const total = picked.reduce((sum, m) => sum + (amountFor(m.id) ?? 0), 0);

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleAdd = async () => {
    try {
      setSubmitting(true);
      const response = await fetch(`/api/finance/admin/charges/${chargeId}/recipients`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipients: picked.map((m) => ({ userId: m.id, amountCents: amountFor(m.id) })),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Failed to add members.");
      toast.success(`Added ${result.added} member${result.added === 1 ? "" : "s"}.`);
      onOpenChange(false);
      onAdded();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to add members.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] flex-col gap-4 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add members</DialogTitle>
          <DialogDescription>
            Charge more members on {chargeTitle}. Members already on it aren&apos;t listed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="add-base">Amount for each member</Label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
              $
            </span>
            <Input
              id="add-base"
              inputMode="decimal"
              className="pl-7"
              value={baseInput}
              onChange={(event) => setBaseInput(event.target.value)}
              placeholder="185"
            />
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border">
          <div className="flex items-center gap-2 border-b px-3">
            <Search className="size-4 text-muted-foreground" />
            <input
              aria-label="Search members"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search members"
              className="h-11 flex-1 bg-transparent text-sm outline-none"
            />
          </div>
          <div className="flex justify-end border-b px-3 py-1.5">
            <label htmlFor="add-show-inactive" className="flex cursor-pointer items-center gap-2 text-[13px] text-muted-foreground">
  <Switch id="add-show-inactive" size="sm" checked={showInactive} onCheckedChange={setShowInactive} />
  Show alumni &amp; disaffiliated
</label>
          </div>
          <div className="h-64 overflow-y-auto">
            {members === null ? (
              <div className="flex h-full items-center justify-center">
                <Spinner className="size-6 text-muted-foreground" />
              </div>
            ) : candidates.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">No members to add.</div>
            ) : (
              candidates.map((member) => {
                const on = selected.has(member.id);
                return (
                  <div
                    key={member.id}
                    className="flex items-center gap-3 border-b px-3 py-2 last:border-b-0"
                  >
                    <input
                      type="checkbox"
                      aria-label={`Add ${member.name}`}
                      checked={on}
                      onChange={() => toggle(member.id)}
                      className="size-4"
                    />
                    <MemberAvatar name={member.name} src={member.avatar} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{member.name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {[member.pledgeClass, member.grade].filter(Boolean).join(" · ") ||
                          member.email}
                      </div>
                    </div>
                    {on && (
                      <div className="relative w-24">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[13px] text-muted-foreground">
                          $
                        </span>
                        <Input
                          inputMode="decimal"
                          aria-label={`Custom amount for ${member.name}`}
                          className="h-[34px] pl-5 text-[13.5px]"
                          placeholder={baseCents ? String(baseCents / 100) : "—"}
                          value={overrides[member.id] ?? ""}
                          onChange={(event) =>
                            setOverrides((current) => ({
                              ...current,
                              [member.id]: event.target.value,
                            }))
                          }
                        />
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        <DialogFooter className="items-center sm:justify-between">
          <span className="text-sm text-muted-foreground">
            {picked.length === 0
              ? "No members selected"
              : `${picked.length} selected · ${formatCents(total)}${missing ? ` · ${missing} missing an amount` : ""}`}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void handleAdd()}
              disabled={picked.length === 0 || missing > 0 || submitting}
            >
              {submitting ? "Adding..." : "Add members"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

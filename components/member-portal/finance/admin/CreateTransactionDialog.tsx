"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Search, X } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  formatCents,
  initials,
  parseDollarsToCents,
  type FinanceMember,
  type FinanceRole,
} from "./shared";

type Mode = "inc" | "exc";

type Group = {
  key: string;
  label: string;
  hint: string;
  test: (member: FinanceMember) => boolean;
};

function memberStatus(member: FinanceMember) {
  if (member.isDisaffiliated) return "Disaffiliated";
  if (member.isAlumni) return "Alumni";
  if (member.isInactive) return "Temp. inactive";
  return "Active";
}

export function CreateTransactionDialog({
  open,
  onOpenChange,
  members,
  roles,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  members: FinanceMember[];
  roles: FinanceRole[];
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [baseInput, setBaseInput] = useState("");
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<Record<string, Mode>>({});
  const [groupAmounts, setGroupAmounts] = useState<Record<string, string>>({});
  const [userAmounts, setUserAmounts] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const groups = useMemo<Group[]>(() => {
    const statusGroups: Group[] = [
      {
        key: "g:active",
        label: "Active users",
        hint: "Has a pledge class; not alumni, disaffiliated or temp. inactive",
        test: (m) =>
          m.hasPledgeClass && !m.isAlumni && !m.isDisaffiliated && !m.isInactive,
      },
      { key: "g:alumni", label: "Alumni", hint: "", test: (m) => m.isAlumni },
      {
        key: "g:disaffiliated",
        label: "Disaffiliated",
        hint: "",
        test: (m) => m.isDisaffiliated,
      },
      {
        key: "g:inactive",
        label: "Temporarily inactive",
        hint: "",
        test: (m) => m.isInactive,
      },
    ];

    const roleGroups: Group[] = roles.map((role) => ({
      key: `r:${role.id}`,
      label: role.name,
      hint: role.type === "pledge_class" ? "Pledge class" : "Role",
      test: (m) => m.roleIds.includes(role.id),
    }));

    return [...statusGroups, ...roleGroups].map((group) => {
      const count = members.filter(group.test).length;
      return {
        ...group,
        hint: [group.hint, `${count} member${count === 1 ? "" : "s"}`]
          .filter(Boolean)
          .join(" · "),
      };
    });
  }, [members, roles]);

  const memberOptions = useMemo(
    () =>
      members.map((member) => ({
        key: `u:${member.id}`,
        label: member.name,
        hint: [member.pledgeClass, memberStatus(member)].filter(Boolean).join(" · "),
        test: (m: FinanceMember) => m.id === member.id,
      })),
    [members],
  );

  const byKey = useMemo(() => {
    const map = new Map<string, Group>();
    for (const option of [...groups, ...memberOptions]) map.set(option.key, option);
    return map;
  }, [groups, memberOptions]);

  const normalizedQuery = query.trim().toLowerCase();
  const visibleGroups = groups.filter(
    (group) => !normalizedQuery || group.label.toLowerCase().includes(normalizedQuery),
  );
  const visibleMembers = normalizedQuery
    ? memberOptions.filter((option) => option.label.toLowerCase().includes(normalizedQuery))
    : [];
  const visibleOptions = [...visibleGroups, ...visibleMembers];

  const baseCents = parseDollarsToCents(baseInput);
  const includedKeys = Object.keys(selection).filter(
    (key) => selection[key] === "inc" && byKey.has(key),
  );
  const excludedKeys = Object.keys(selection).filter(
    (key) => selection[key] === "exc" && byKey.has(key),
  );
  const includedGroupKeys = includedKeys.filter((key) => !key.startsWith("u:"));

  const recipients = useMemo(() => {
    const output: Array<{
      member: FinanceMember;
      amountCents: number | null;
      source: "base" | "group" | "custom" | "conflict";
    }> = [];

    for (const member of members) {
      const matchedInc = includedKeys.filter((key) => byKey.get(key)?.test(member));
      const matchedExc = excludedKeys.filter((key) => byKey.get(key)?.test(member));
      if (matchedInc.length === 0 || matchedExc.length > 0) continue;

      const own = parseDollarsToCents(userAmounts[member.id] ?? "");
      const groupCents = matchedInc
        .filter((key) => !key.startsWith("u:"))
        .map((key) => parseDollarsToCents(groupAmounts[key] ?? ""))
        .filter((cents): cents is number => cents !== null);
      const distinct = Array.from(new Set(groupCents));

      if (own) {
        output.push({ member, amountCents: own, source: "custom" });
      } else if (distinct.length > 1) {
        output.push({ member, amountCents: Math.max(...distinct), source: "conflict" });
      } else if (distinct.length === 1) {
        output.push({ member, amountCents: distinct[0], source: "group" });
      } else {
        output.push({ member, amountCents: baseCents, source: "base" });
      }
    }

    return output;
  }, [members, includedKeys, excludedKeys, byKey, userAmounts, groupAmounts, baseCents]);

  const total = recipients.reduce((sum, item) => sum + (item.amountCents ?? 0), 0);
  const missingCount = recipients.filter((item) => !item.amountCents).length;
  const conflictCount = recipients.filter((item) => item.source === "conflict").length;

  const toggle = (key: string, mode: Mode) =>
    setSelection((current) => {
      const next = { ...current };
      if (next[key] === mode) delete next[key];
      else next[key] = mode;
      return next;
    });

  const reset = () => {
    setTitle("");
    setDescription("");
    setDueAt("");
    setBaseInput("");
    setQuery("");
    setSelection({});
    setGroupAmounts({});
    setUserAmounts({});
  };

  const canSubmit =
    title.trim().length > 0 && recipients.length > 0 && missingCount === 0 && !submitting;

  const handleCreate = async () => {
    try {
      setSubmitting(true);
      const response = await fetch("/api/finance/admin/charges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          dueAt: dueAt ? new Date(`${dueAt}T23:59:00`).toISOString() : null,
          defaultAmountCents: baseCents,
          includeRoleIds: [],
          excludeRoleIds: [],
          excludeUserIds: [],
          includeUsers: recipients.map((item) => ({
            userId: item.member.id,
            amountCents: item.amountCents,
          })),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Failed to create transaction.");

      toast.success(`Transaction created for ${result.recipientCount ?? recipients.length} members.`);
      reset();
      onOpenChange(false);
      onCreated();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create transaction.");
    } finally {
      setSubmitting(false);
    }
  };

  const pillClass = (on: boolean, tone: "inc" | "exc") =>
    cn(
      "h-8 rounded-md border px-3 text-[13px] font-semibold transition-colors",
      on
        ? tone === "inc"
          ? "border-blue-700 bg-blue-700 text-white"
          : "border-orange-800 bg-orange-800 text-white"
        : "bg-background hover:bg-muted",
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[min(796px,92vh)] w-[min(1160px,96vw)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
      >
        <DialogHeader className="border-b px-7 py-5 text-left">
          <DialogTitle className="text-xl">New transaction</DialogTitle>
          <DialogDescription>Charge members, then track who has paid.</DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,620px)_minmax(0,1fr)]">
          <div className="min-h-0 space-y-5 overflow-y-auto border-r px-7 py-6">
            <div className="space-y-1.5">
              <Label htmlFor="tx-title">Title</Label>
              <Input
                id="tx-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Fall Chapter Dues"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tx-desc">Description</Label>
              <Textarea
                id="tx-desc"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What is this charge for?"
                className="h-16 resize-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="tx-due">
                  Due date <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="tx-due"
                  type="date"
                  value={dueAt}
                  onChange={(event) => setDueAt(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tx-base">Base amount</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    $
                  </span>
                  <Input
                    id="tx-base"
                    inputMode="decimal"
                    className="pl-7"
                    value={baseInput}
                    onChange={(event) => setBaseInput(event.target.value)}
                    placeholder="185"
                  />
                </div>
              </div>
            </div>

            <div className="h-px bg-border" />

            <div className="space-y-2.5">
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-semibold">Who is charged</span>
                <span className="text-xs text-muted-foreground">
                  Include groups &amp; members, then exclude exceptions
                </span>
              </div>

              <div className="overflow-hidden rounded-xl border">
                <div className="flex min-h-[48px] flex-wrap items-center gap-1.5 border-b bg-muted/40 p-2.5">
                  {Object.keys(selection)
                    .filter((key) => byKey.has(key))
                    .map((key) => {
                      const inc = selection[key] === "inc";
                      return (
                        <button
                          key={key}
                          type="button"
                          aria-label={`Remove ${byKey.get(key)?.label}`}
                          onClick={() => toggle(key, selection[key])}
                          className={cn(
                            "flex h-[30px] items-center gap-1.5 rounded-full border px-2.5 text-[13px] font-medium",
                            inc
                              ? "border-blue-700 bg-blue-50 text-blue-900"
                              : "border-orange-800 bg-orange-50 text-orange-950",
                          )}
                        >
                          <span className="font-bold">{inc ? "+" : "−"}</span>
                          {byKey.get(key)?.label}
                          <X className="size-3 opacity-70" />
                        </button>
                      );
                    })}
                  {Object.keys(selection).length === 0 && (
                    <span className="p-1 text-[13px] text-muted-foreground">
                      Nothing selected yet
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 border-b px-3">
                  <Search className="size-4 text-muted-foreground" />
                  <input
                    aria-label="Search groups and members"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search groups or type a member's name"
                    className="h-11 flex-1 bg-transparent text-sm outline-none"
                  />
                </div>
                <div className="h-52 overflow-y-auto">
                  {visibleOptions.map((option) => (
                    <div
                      key={option.key}
                      className="flex items-center gap-2.5 border-b px-3 py-2 last:border-b-0"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{option.label}</div>
                        {option.hint && (
                          <div className="truncate text-xs text-muted-foreground">
                            {option.hint}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        aria-pressed={selection[option.key] === "inc"}
                        onClick={() => toggle(option.key, "inc")}
                        className={pillClass(selection[option.key] === "inc", "inc")}
                      >
                        Include
                      </button>
                      <button
                        type="button"
                        aria-pressed={selection[option.key] === "exc"}
                        onClick={() => toggle(option.key, "exc")}
                        className={pillClass(selection[option.key] === "exc", "exc")}
                      >
                        Exclude
                      </button>
                    </div>
                  ))}
                  {visibleOptions.length === 0 && (
                    <div className="p-4 text-sm text-muted-foreground">No matches.</div>
                  )}
                </div>
              </div>
            </div>

            {includedGroupKeys.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-semibold">Amount by group</span>
                  <span className="text-xs text-muted-foreground">
                    Leave blank to use the base amount
                  </span>
                </div>
                {includedGroupKeys.map((key) => (
                  <div
                    key={key}
                    className="flex items-center gap-3 rounded-lg border px-3 py-2"
                  >
                    <span className="flex-1 truncate text-sm font-medium">
                      {byKey.get(key)?.label}
                    </span>
                    <div className="relative w-28">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                        $
                      </span>
                      <Input
                        inputMode="decimal"
                        aria-label={`Amount for ${byKey.get(key)?.label}`}
                        className="h-9 pl-6"
                        placeholder={baseInput}
                        value={groupAmounts[key] ?? ""}
                        onChange={(event) =>
                          setGroupAmounts((current) => ({
                            ...current,
                            [key]: event.target.value,
                          }))
                        }
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex min-h-0 flex-col bg-muted/30">
            <div className="flex items-end justify-between border-b px-6 pb-3.5 pt-5">
              <div>
                <div className="text-[13px] text-muted-foreground">Included members</div>
                <div className="text-2xl font-semibold tracking-tight">
                  {recipients.length} {recipients.length === 1 ? "member" : "members"}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[13px] text-muted-foreground">Total to collect</div>
                <div className="text-xl font-semibold">{formatCents(total)}</div>
              </div>
            </div>
            {conflictCount > 0 && (
              <div className="mx-6 mt-3 rounded-lg bg-amber-100 px-3 py-2.5 text-[13px] text-amber-950">
                {conflictCount} member{conflictCount === 1 ? " is" : "s are"} in groups with
                different amounts. The highest is used; type a custom amount to override.
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-2">
              {recipients.map(({ member, amountCents, source }) => (
                <div key={member.id} className="flex items-center gap-3 rounded-lg px-3 py-1.5">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700">
                    {initials(member.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{member.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {[member.pledgeClass, memberStatus(member)].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[11.5px] font-semibold",
                      source === "custom" && "bg-emerald-100 text-emerald-900",
                      source === "group" && "bg-blue-100 text-blue-900",
                      source === "conflict" && "bg-amber-100 text-amber-950",
                      source === "base" && "bg-muted text-foreground/70",
                    )}
                  >
                    {source === "custom"
                      ? "Custom"
                      : source === "group"
                        ? "Group"
                        : source === "conflict"
                          ? "Conflict"
                          : "Base"}
                  </span>
                  <div className="relative w-24">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[13px] text-muted-foreground">
                      $
                    </span>
                    <Input
                      inputMode="decimal"
                      aria-label={`Custom amount for ${member.name}`}
                      className="h-[34px] bg-background pl-5 text-[13.5px]"
                      value={userAmounts[member.id] ?? ""}
                      placeholder={amountCents ? String(amountCents / 100) : "—"}
                      onChange={(event) =>
                        setUserAmounts((current) => ({
                          ...current,
                          [member.id]: event.target.value,
                        }))
                      }
                    />
                  </div>
                </div>
              ))}
              {recipients.length === 0 && (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  Include a group or member to see who will be charged.
                </div>
              )}
            </div>
            <div className="border-t px-6 py-2.5 text-xs text-muted-foreground">
              Type in a member&apos;s box to set a custom amount for just them.
            </div>
          </div>
        </div>

        <DialogFooter className="items-center border-t px-7 py-4 sm:justify-between">
          <span className="text-sm text-muted-foreground">
            {recipients.length === 0
              ? "No recipients yet"
              : `${recipients.length} recipients · ${formatCents(total)} total${
                  missingCount ? ` · ${missingCount} missing an amount` : ""
                }`}
          </span>
          <div className="flex gap-2.5">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleCreate()} disabled={!canSubmit}>
              <Plus className="size-4" />
              {submitting ? "Creating..." : "Create transaction"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

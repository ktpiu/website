"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  Ban,
  CircleSlash,
  DollarSign,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Undo2,
} from "lucide-react";
import { useAuthStore } from "@/lib/auth-store";
import { canEditFinanceAdmin, canViewFinanceAdmin } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  formatCents,
  formatDate,
  parseDollarsToCents,
} from "@/components/member-portal/finance/admin/shared";
import { AddMembersDialog } from "@/components/member-portal/finance/admin/AddMembersDialog";
import { MemberAvatar } from "@/components/member-portal/finance/admin/MemberAvatar";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

type Recipient = {
  obligationId: string;
  userId: string;
  name: string;
  email: string;
  avatar: string | null;
  amountCents: number;
  paidCents: number;
  remainingCents: number;
  pendingCents: number;
  payments: Array<{ paidAt: string | null; amountCents: number; source: "manual" | "stripe" }>;
  paymentState: "paid" | "partial" | "pending" | "unpaid" | "exempt" | "voided";
  isOverdue: boolean;
  isExempt: boolean;
  isVoided: boolean;
};

type ChargeDetail = {
  charge: {
    id: string;
    title: string;
    description: string | null;
    dueAt: string | null;
    defaultAmountCents: number | null;
  };
  targets: {
    includeRoles: Array<{ roleId: string; roleName: string; amountCents: number | null }>;
    excludeRoles: Array<{ roleId: string; roleName: string }>;
    includeUsers: Array<{ userId: string }>;
    excludeUsers: Array<{ userId: string }>;
  };
  recipients: Recipient[];
};

type Filter = "all" | "unpaid" | "pending" | "partial" | "paid" | "exempt" | "voided";

type ConfirmAction = "exempt" | "voidCharge" | "voidPayment" | "delete";

const PAGE_SIZE = 50;

const badgeClass: Record<Recipient["paymentState"], string> = {
  paid: "bg-emerald-100 text-emerald-900",
  partial: "bg-amber-100 text-amber-950",
  pending: "bg-blue-100 text-blue-900",
  unpaid: "bg-muted text-foreground/80",
  exempt: "bg-slate-200 text-slate-800",
  voided: "bg-slate-200 text-slate-500",
};

export default function FinanceChargeDetailPage() {
  const { chargeId } = useParams<{ chargeId: string }>();
  const { permissions } = useAuthStore();
  const canView = canViewFinanceAdmin(permissions);
  const canEdit = canEditFinanceAdmin(permissions);

  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(0);
  const [payFor, setPayFor] = useState<Recipient | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payNotes, setPayNotes] = useState("");
  const [paying, setPaying] = useState(false);
  const [search, setSearch] = useState("");
  const [confirm, setConfirm] = useState<{ action: ConfirmAction; row: Recipient } | null>(
    null,
  );
  const [acting, setActing] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    row: Recipient;
    x: number;
    y: number;
    key: number;
  } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [dueOpen, setDueOpen] = useState(false);
  const [dueInput, setDueInput] = useState("");
  const [titleInput, setTitleInput] = useState("");
  const [descInput, setDescInput] = useState("");
  const [savingDue, setSavingDue] = useState(false);

  const queryClient = useQueryClient();
  const detailQuery = useQuery({
    queryKey: ["finance", "charge", chargeId],
    enabled: canView,
    queryFn: async () => {
      const response = await fetch(`/api/finance/admin/charges/${chargeId}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Failed to load transaction.");
      return result as ChargeDetail;
    },
  });
  const detail = detailQuery.data ?? null;
  const loading = detailQuery.isPending && canView;

  useEffect(() => {
    if (detailQuery.error) {
      toast.error(
        detailQuery.error instanceof Error
          ? detailQuery.error.message
          : "Failed to load transaction.",
      );
    }
  }, [detailQuery.error]);

  // Refreshes this transaction and the list/summary views behind it.
  const load = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ["finance"] }),
    [queryClient],
  );

  const summary = useMemo(() => {
    const recipients = detail?.recipients ?? [];
    // Exempt and voided members only count what they actually paid.
    const total = recipients.reduce(
      (s, r) => s + (r.isExempt || r.isVoided ? r.paidCents : r.amountCents),
      0,
    );
    const paid = recipients.reduce((s, r) => s + r.paidCents, 0);
    const count = (state: Recipient["paymentState"]) =>
      recipients.filter((r) => r.paymentState === state).length;
    return {
      total,
      paid,
      remaining: total - paid,
      pct: total > 0 ? (paid / total) * 100 : 0,
      partialPct:
        total > 0
          ? (recipients
              .filter((r) => r.paymentState === "partial")
              .reduce((s, r) => s + r.paidCents, 0) /
              total) *
            100
          : 0,
      paidCount: count("paid"),
      partialCount: count("partial"),
      unpaidCount: count("unpaid"),
      pendingCount: count("pending"),
      pendingCents: recipients.reduce((s, r) => s + r.pendingCents, 0),
      exemptCount: count("exempt"),
      voidedCount: count("voided"),
      unsettled: recipients.filter((r) => r.remainingCents > 0).length,
    };
  }, [detail]);

  const rows = useMemo(() => {
    const order = { unpaid: 0, pending: 1, partial: 2, paid: 3, exempt: 4, voided: 5 } as const;
    const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return [...(detail?.recipients ?? [])]
      .filter((r) => filter === "all" || r.paymentState === filter)
      .filter((r) => {
        if (terms.length === 0) return true;
        const haystack = `${r.name} ${r.email}`.toLowerCase();
        return terms.every((term) => haystack.includes(term));
      })
      .sort(
        (a, b) =>
          order[a.paymentState] - order[b.paymentState] || a.name.localeCompare(b.name),
      );
  }, [detail, filter, search]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageStart = safePage * PAGE_SIZE;
  const pageRows = rows.slice(pageStart, pageStart + PAGE_SIZE);

  const openPayment = (recipient: Recipient) => {
    setPayFor(recipient);
    setPayAmount((recipient.remainingCents / 100).toString());
    setPayNotes("");
  };

  const handleRecordPayment = async () => {
    if (!payFor) return;
    const amountCents = parseDollarsToCents(payAmount);
    if (!amountCents) {
      toast.error("Enter a valid payment amount.");
      return;
    }
    if (amountCents > payFor.remainingCents) {
      toast.error(`Amount exceeds the remaining ${formatCents(payFor.remainingCents)}.`);
      return;
    }

    try {
      setPaying(true);
      const response = await fetch("/api/finance/admin/payments/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: payFor.userId,
          amountCents,
          notes: payNotes,
          allocationMode: "manual_selection",
          allocations: [{ obligationId: payFor.obligationId, amountCents }],
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Failed to record payment.");
      toast.success("Payment recorded.");
      setPayFor(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to record payment.");
    } finally {
      setPaying(false);
    }
  };

  // Runs one row action against the API, then refreshes.
  const runAction = async (
    row: Recipient,
    request: { path: string; method: "POST" | "DELETE"; body?: unknown },
    success: string,
    failure: string,
  ) => {
    try {
      setActing(true);
      const response = await fetch(
        `/api/finance/admin/obligations/${row.obligationId}${request.path}`,
        {
          method: request.method,
          headers: request.body ? { "Content-Type": "application/json" } : undefined,
          body: request.body ? JSON.stringify(request.body) : undefined,
        },
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || failure);
      toast.success(success);
      setConfirm(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : failure);
    } finally {
      setActing(false);
    }
  };

  const handleExempt = (row: Recipient, exempt: boolean) =>
    runAction(
      row,
      { path: "/exempt", method: "POST", body: { exempt } },
      exempt ? `${row.name} exempted.` : "Exemption removed.",
      "Failed to update exemption.",
    );

  const handleVoidCharge = (row: Recipient, voided: boolean) =>
    runAction(
      row,
      { path: "/void", method: "POST", body: { void: voided } },
      voided ? `Charge voided for ${row.name}.` : "Charge restored.",
      "Failed to void charge.",
    );

  const handleConfirm = () => {
    if (!confirm) return;
    const { action, row } = confirm;
    if (action === "exempt") return handleExempt(row, true);
    if (action === "voidCharge") return handleVoidCharge(row, true);
    if (action === "voidPayment")
      return runAction(
        row,
        { path: "/void-payments", method: "POST" },
        "Payment voided.",
        "Failed to void payment.",
      );
    return runAction(
      row,
      { path: "", method: "DELETE" },
      `${row.name} removed from this transaction.`,
      "Failed to delete charge.",
    );
  };

  const manualPaidCents = (row: Recipient) =>
    row.payments.filter((p) => p.source === "manual").reduce((s, p) => s + p.amountCents, 0);

  const renderMenuItems = (row: Recipient) => {
    const settled = row.isExempt || row.isVoided;
    const hasManual = manualPaidCents(row) > 0;
    const hasPaid = row.paidCents > 0 || row.pendingCents > 0;
    return (
      <>
        <DropdownMenuItem
          disabled={settled || row.remainingCents <= 0}
          onSelect={() => openPayment(row)}
        >
          <DollarSign />
          Record payment
        </DropdownMenuItem>
        {row.isExempt ? (
          <DropdownMenuItem onSelect={() => void handleExempt(row, false)}>
            <RotateCcw />
            Remove exemption
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            disabled={row.isVoided || row.remainingCents <= 0}
            onSelect={() => setConfirm({ action: "exempt", row })}
          >
            <CircleSlash />
            Exempt
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        {row.paidCents > 0 && (
          <DropdownMenuItem
            disabled={!hasManual}
            onSelect={() => setConfirm({ action: "voidPayment", row })}
          >
            <Undo2 />
            Void payment
            {!hasManual && (
              <span className="ml-auto text-xs text-muted-foreground">Stripe</span>
            )}
          </DropdownMenuItem>
        )}
        {row.isVoided ? (
          <DropdownMenuItem onSelect={() => void handleVoidCharge(row, false)}>
            <RotateCcw />
            Restore charge
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={() => setConfirm({ action: "voidCharge", row })}>
            <Ban />
            Void charge
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          disabled={hasPaid}
          onSelect={() => setConfirm({ action: "delete", row })}
        >
          <Trash2 />
          Delete
          {hasPaid && (
            <span className="ml-auto text-xs text-muted-foreground">Has payments</span>
          )}
        </DropdownMenuItem>
      </>
    );
  };

  const openDueDialog = () => {
    const current = detail?.charge.dueAt ? new Date(detail.charge.dueAt) : null;
    setDueInput(
      current && !Number.isNaN(current.getTime())
        ? `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, "0")}-${String(current.getDate()).padStart(2, "0")}`
        : "",
    );
    setTitleInput(detail?.charge.title ?? "");
    setDescInput(detail?.charge.description ?? "");
    setDueOpen(true);
  };

  const handleSaveDue = async () => {
    try {
      setSavingDue(true);
      const response = await fetch(`/api/finance/admin/charges/${chargeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: titleInput,
          description: descInput,
          dueAt: dueInput ? new Date(`${dueInput}T23:59:00`).toISOString() : null,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Failed to update transaction.");
      toast.success("Transaction updated.");
      setDueOpen(false);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update transaction.");
    } finally {
      setSavingDue(false);
    }
  };

  if (!canView) {
    return (
      <div className="p-4 md:p-6">
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>Finance Admin Access Required</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            You do not have permission to view this page.
          </CardContent>
        </Card>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner className="size-8 text-muted-foreground" />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="space-y-3 p-6">
        <Link href="/member-portal/admin/finance" className="text-sm underline">
          Back to transactions
        </Link>
        <p className="text-sm text-muted-foreground">Transaction not found.</p>
      </div>
    );
  }

  const { charge, targets } = detail;
  const filters: Array<[Filter, string, number]> = [
    ["all", "All", detail.recipients.length],
    ["unpaid", "Unpaid", summary.unpaidCount],
    ...(summary.pendingCount > 0
      ? ([["pending", "Pending", summary.pendingCount]] as Array<[Filter, string, number]>)
      : []),
    ["partial", "Partial", summary.partialCount],
    ["paid", "Paid", summary.paidCount],
    ...(summary.exemptCount > 0
      ? ([["exempt", "Exempt", summary.exemptCount]] as Array<[Filter, string, number]>)
      : []),
    ...(summary.voidedCount > 0
      ? ([["voided", "Voided", summary.voidedCount]] as Array<[Filter, string, number]>)
      : []),
  ];

  const confirmCopy = (() => {
    if (!confirm) return null;
    const { action, row } = confirm;
    if (action === "exempt")
      return {
        title: `Exempt ${row.name}?`,
        body: `This removes ${formatCents(row.remainingCents)} from what's owed on ${charge.title} and from the transaction total.${
          row.paidCents > 0
            ? ` The ${formatCents(row.paidCents)} already paid stays recorded.`
            : ""
        } You can remove the exemption later.`,
        cta: "Exempt",
        busy: "Exempting...",
        destructive: false,
      };
    if (action === "voidCharge")
      return {
        title: `Void ${row.name}'s charge?`,
        body: `${row.name} will no longer owe anything on ${charge.title}, and the charge disappears from their account. It stays here as voided for your records.${
          row.paidCents > 0
            ? ` The ${formatCents(row.paidCents)} already paid stays recorded; void the payment separately if it should be reversed.`
            : ""
        } You can restore it later.`,
        cta: "Void charge",
        busy: "Voiding...",
        destructive: true,
      };
    if (action === "voidPayment") {
      const manual = manualPaidCents(row);
      const stripe = row.paidCents - manual;
      return {
        title: `Void ${row.name}'s payment?`,
        body: `This reverses ${formatCents(manual)} in manually recorded payments, so it no longer counts toward ${charge.title}. If a payment was split across other charges, it's voided there too.${
          stripe > 0
            ? ` The ${formatCents(stripe)} paid through Stripe isn't affected and must be refunded in Stripe.`
            : ""
        }`,
        cta: "Void payment",
        busy: "Voiding...",
        destructive: true,
      };
    }
    return {
      title: `Delete ${row.name}'s charge?`,
      body: `This removes ${row.name} from ${charge.title} entirely. This can't be undone, but you can add them back with Add members.`,
      cta: "Delete",
      busy: "Deleting...",
      destructive: true,
    };
  })();

  return (
    <div className="space-y-6 p-4 md:p-8">
      <Link
        href="/member-portal/admin/finance"
        className="inline-flex h-8 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        All transactions
      </Link>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{charge.title}</h1>
          {canEdit && (
            <Button variant="outline" className="h-11" onClick={openDueDialog}>
              <Pencil className="size-4" />
              Edit details
            </Button>
          )}
        </div>
        {charge.description && (
          <p className="text-[14.5px] text-muted-foreground">{charge.description}</p>
        )}
        <div className="flex flex-wrap items-center gap-2 pt-1 text-[13px] text-muted-foreground">
          <span>{charge.dueAt ? `Due ${formatDate(charge.dueAt)}` : "No due date"}</span>
          {canEdit && (
            <button
              type="button"
              onClick={openDueDialog}
              className="rounded-md px-1.5 py-0.5 text-[13px] font-medium text-foreground underline underline-offset-2 hover:bg-muted"
            >
              {charge.dueAt ? "Change" : "Set due date"}
            </button>
          )}
          {targets.includeRoles.map((role) => (
            <span
              key={role.roleId}
              className="rounded-full bg-blue-100 px-2.5 py-0.5 text-[12.5px] font-semibold text-blue-900"
            >
              + {role.roleName}
              {role.amountCents ? ` · ${formatCents(role.amountCents)}` : ""}
            </span>
          ))}
          {targets.excludeRoles.map((role) => (
            <span
              key={role.roleId}
              className="rounded-full bg-orange-100 px-2.5 py-0.5 text-[12.5px] font-semibold text-orange-950"
            >
              − {role.roleName}
            </span>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4 rounded-xl border p-6">
          <div className="flex items-end justify-between">
            <div>
              <div className="text-[13px] text-muted-foreground">Collected</div>
              <div className="text-3xl font-semibold tracking-tight">
                {formatCents(summary.paid)}{" "}
                <span className="text-base font-medium text-muted-foreground">
                  of {formatCents(summary.total)}
                </span>
              </div>
            </div>
            <div className="text-3xl font-semibold text-emerald-800 dark:text-emerald-400">
              {Math.round(summary.pct)}%
            </div>
          </div>
          <div className="flex h-3.5 gap-0.5 overflow-hidden rounded-full bg-muted">
            <div
              className="bg-emerald-700"
              style={{ width: `${Math.max(summary.pct - summary.partialPct, 0)}%` }}
            />
            <div className="bg-amber-600" style={{ width: `${summary.partialPct}%` }} />
          </div>
          <div className="flex flex-wrap gap-5 text-[13px]">
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-[3px] bg-emerald-700" />
              Paid · {summary.paidCount}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-[3px] bg-amber-600" />
              Partial · {summary.partialCount}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-[3px] border bg-muted" />
              Unpaid · {summary.unpaidCount}
            </span>
            {summary.pendingCount > 0 && (
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-[3px] bg-blue-500" />
                Pending · {summary.pendingCount}
              </span>
            )}
          </div>
        </div>
        <div className="space-y-2.5 rounded-xl border p-6">
          <div className="text-[13px] text-muted-foreground">Still to collect</div>
          <div className="text-3xl font-semibold tracking-tight">
            {formatCents(summary.remaining)}
          </div>
          <div className="text-[13px] text-muted-foreground">
            {summary.unsettled} member{summary.unsettled === 1 ? "" : "s"}
            {summary.pendingCents > 0 &&
              ` · ${formatCents(summary.pendingCents)} processing`}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3.5">
          <div className="flex gap-1 rounded-lg bg-muted p-1">
            {filters.map(([value, label, count]) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => {
                  setFilter(value);
                  setPage(0);
                }}
                className={cn(
                  "rounded-md px-3.5 py-1.5 text-[13.5px] font-medium",
                  filter === value ? "bg-background font-semibold shadow-sm" : "text-muted-foreground",
                )}
              >
                {label} · {count}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex h-9 w-full items-center gap-2 rounded-md border px-2.5 sm:w-64">
              <Search className="size-4 shrink-0 text-muted-foreground" />
              <input
                aria-label="Search members"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(0);
                }}
                placeholder="Search members"
                className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none"
              />
            </div>
            {canEdit && (
              <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
                <Plus className="size-4" />
                Add members
              </Button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[860px]">
            <div className="grid grid-cols-[minmax(0,2.2fr)_100px_100px_100px_120px_110px_40px] gap-4 border-b bg-muted/40 px-5 py-3 text-[12.5px] font-medium text-muted-foreground">
              <span>Member</span>
              <span className="text-right">Amount</span>
              <span className="text-right">Paid</span>
              <span className="text-right">Remaining</span>
              <span>Updated at</span>
              <span>Status</span>
              <span />
            </div>
            {pageRows.map((row) => (
              <div
                key={row.obligationId}
                onContextMenu={(event) => {
                  if (!canEdit) return;
                  event.preventDefault();
                  setContextMenu({ row, x: event.clientX, y: event.clientY, key: Date.now() });
                }}
                className="grid min-h-11 grid-cols-[minmax(0,2.2fr)_100px_100px_100px_120px_110px_40px] items-center gap-4 border-b px-5 py-2.5 last:border-b-0"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <MemberAvatar name={row.name} src={row.avatar} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{row.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{row.email}</div>
                  </div>
                </div>
                <span
                  className={cn(
                    "text-right text-sm",
                    (row.isExempt || row.isVoided) && "text-muted-foreground line-through",
                  )}
                >
                  {formatCents(row.amountCents)}
                </span>
                <span className="text-right text-sm">{formatCents(row.paidCents)}</span>
                <span className="text-right text-sm font-semibold">
                  {formatCents(row.remainingCents)}
                </span>
                <div className="text-sm">
                  {row.payments.length === 0 ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    row.payments.map((payment, index) => (
                      <div key={index} title={formatCents(payment.amountCents)}>
                        {formatDate(payment.paidAt, "—")}
                        {row.payments.length > 1 && (
                          <span className="text-xs text-muted-foreground">
                            {" "}
                            · {formatCents(payment.amountCents)}
                          </span>
                        )}
                      </div>
                    ))
                  )}
                </div>
                <span
                  className={cn(
                    "justify-self-start rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize",
                    row.isOverdue && row.paymentState !== "paid"
                      ? "bg-red-100 text-red-900"
                      : badgeClass[row.paymentState],
                  )}
                >
                  {row.isOverdue && row.paymentState !== "paid" ? "Overdue" : row.paymentState}
                </span>
                <div className="flex justify-end">
                  {canEdit && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          disabled={acting}
                          aria-label={`Actions for ${row.name}`}
                        >
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-52">
                        {renderMenuItems(row)}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </div>
            ))}
            {rows.length === 0 && (
              <div className="px-5 py-10 text-center text-sm text-muted-foreground">
                {search.trim() ? "No members match your search." : "No members in this view."}
              </div>
            )}
          </div>
        </div>

        {rows.length > 0 && (
          <div className="flex items-center justify-between border-t px-5 py-3">
            <span className="text-[13px] text-muted-foreground">
              Showing {pageStart + 1}–{pageStart + pageRows.length} of {rows.length} members
            </span>
            {pageCount > 1 && (
              <div className="flex items-center gap-2">
                <span className="text-[13px] text-muted-foreground">
                  Page {safePage + 1} of {pageCount}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={safePage === 0}
                  onClick={() => setPage(safePage - 1)}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={safePage >= pageCount - 1}
                  onClick={() => setPage(safePage + 1)}
                >
                  Next
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      <AddMembersDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        chargeId={charge.id}
        chargeTitle={charge.title}
        existingUserIds={detail.recipients.map((r) => r.userId)}
        defaultAmountCents={charge.defaultAmountCents}
        onAdded={() => void load()}
      />

      <Dialog open={dueOpen} onOpenChange={setDueOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit transaction</DialogTitle>
            <DialogDescription>
              Changes apply to everyone charged. Amounts are edited per member.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="edit-title">Title</Label>
            <Input
              id="edit-title"
              value={titleInput}
              onChange={(event) => setTitleInput(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-desc">Description</Label>
            <Textarea
              id="edit-desc"
              value={descInput}
              onChange={(event) => setDescInput(event.target.value)}
              className="h-20 resize-none"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="due-date">
              Due date <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="due-date"
              type="date"
              value={dueInput}
              onChange={(event) => setDueInput(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDueOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleSaveDue()} disabled={savingDue || !titleInput.trim()}>
              {savingDue ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmCopy?.title}</DialogTitle>
            <DialogDescription>{confirmCopy?.body}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant={confirmCopy?.destructive ? "destructive" : "default"}
              disabled={acting}
              onClick={() => void handleConfirm()}
            >
              {acting ? confirmCopy?.busy : confirmCopy?.cta}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {contextMenu && (
        <DropdownMenu
          key={contextMenu.key}
          open
          modal={false}
          onOpenChange={(open) => !open && setContextMenu(null)}
        >
          <DropdownMenuTrigger asChild>
            <span
              aria-hidden
              className="pointer-events-none fixed size-0"
              style={{ left: contextMenu.x, top: contextMenu.y }}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            {renderMenuItems(contextMenu.row)}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <Dialog open={payFor !== null} onOpenChange={(open) => !open && setPayFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record payment</DialogTitle>
            <DialogDescription>
              {payFor?.name} owes {payFor ? formatCents(payFor.remainingCents) : ""} on{" "}
              {charge.title}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="pay-amount">Amount ($)</Label>
              <Input
                id="pay-amount"
                inputMode="decimal"
                value={payAmount}
                onChange={(event) => setPayAmount(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pay-notes">
                Notes <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="pay-notes"
                value={payNotes}
                onChange={(event) => setPayNotes(event.target.value)}
                placeholder="Cash, check #..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayFor(null)}>
              Cancel
            </Button>
            <Button onClick={() => void handleRecordPayment()} disabled={paying}>
              {paying ? "Recording..." : "Record payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

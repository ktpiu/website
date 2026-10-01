"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { toast } from "sonner";
import { ChevronRight, Plus, Users } from "lucide-react";
import { useAuthStore } from "@/lib/auth-store";
import { canEditFinanceAdmin, canViewFinanceAdmin } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CreateTransactionDialog } from "@/components/member-portal/finance/admin/CreateTransactionDialog";
import {
  daysOverdue,
  formatCents,
  formatDate,
  type ChargeSummary,
  type FinanceMember,
  type FinanceRole,
} from "@/components/member-portal/finance/admin/shared";
import { cn } from "@/lib/utils";

export default function AdminFinancePage() {
  const { permissions } = useAuthStore();
  const canView = canViewFinanceAdmin(permissions);
  const canEdit = canEditFinanceAdmin(permissions);

  const queryClient = useQueryClient();
  const [view, setView] = useState<"transactions" | "members">("transactions");
  const [tab, setTab] = useState<"outstanding" | "settled">("outstanding");
  const [showInactive, setShowInactive] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [enablingMemberId, setEnablingMemberId] = useState<string | null>(null);

  const membersQuery = useQuery({
    queryKey: ["finance", "members"],
    enabled: canView,
    queryFn: async () => {
      const response = await fetch("/api/finance/admin/members");
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Failed to load members.");
      return result as { members: FinanceMember[]; roles: FinanceRole[] };
    },
  });

  const chargesQuery = useQuery({
    queryKey: ["finance", "charges"],
    enabled: canView,
    queryFn: async () => {
      const response = await fetch("/api/finance/admin/charges");
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Failed to load transactions.");
      return result as { charges: ChargeSummary[] };
    },
  });

  const members = useMemo(() => membersQuery.data?.members ?? [], [membersQuery.data]);
  const roles = useMemo(() => membersQuery.data?.roles ?? [], [membersQuery.data]);
  const charges = useMemo(() => chargesQuery.data?.charges ?? [], [chargesQuery.data]);
  // Only show the skeleton on the very first load; cached data renders instantly.
  const loading = membersQuery.isPending || chargesQuery.isPending;

  const loadError = membersQuery.error ?? chargesQuery.error;
  useEffect(() => {
    if (loadError) {
      toast.error(loadError instanceof Error ? loadError.message : "Failed to load finance data.");
    }
  }, [loadError]);

  const loadAll = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ["finance"] }),
    [queryClient],
  );

  const handleEnableMember = async (userId: string) => {
    try {
      setEnablingMemberId(userId);
      const response = await fetch(`/api/finance/admin/members/${userId}/enable`, {
        method: "POST",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Failed to enable finance for user.");
      toast.success("Finance enabled for member.");
      await loadAll();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to enable finance.");
    } finally {
      setEnablingMemberId(null);
    }
  };

  const outstanding = useMemo(() => charges.filter((c) => c.outstandingCents > 0), [charges]);
  const settled = useMemo(() => charges.filter((c) => c.outstandingCents <= 0), [charges]);
  const shown = tab === "outstanding" ? outstanding : settled;

  const stats = useMemo(() => {
    const totalOutstanding = outstanding.reduce((s, c) => s + c.outstandingCents, 0);
    const collected = outstanding.reduce((s, c) => s + c.paidCents, 0);
    const billed = outstanding.reduce((s, c) => s + c.totalCents, 0);
    const overdueTx = outstanding.filter((c) => c.overdueCount > 0);
    return {
      totalOutstanding,
      collected,
      billed,
      withBalance: members.filter((m) => m.outstandingCents > 0).length,
      overdueMembers: members.filter((m) => m.overdueCount > 0).length,
      overdueTx,
    };
  }, [outstanding, members]);

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
      <div
        className="space-y-6 p-4 md:p-8"
        role="status"
        aria-busy="true"
        aria-label="Loading finance data"
      >
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-72" />
          </div>
          <div className="flex gap-2.5">
            <Skeleton className="h-11 w-28 rounded-md" />
            <Skeleton className="h-11 w-40 rounded-md" />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2 rounded-xl border p-5">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-3 w-36" />
            </div>
          ))}
        </div>
        <div className="overflow-hidden rounded-xl border">
          <div className="flex items-center border-b px-5 py-3.5">
            <Skeleton className="h-10 w-64 rounded-lg" />
          </div>
          <div className="hidden border-b bg-muted/40 px-5 py-3 md:block">
            <Skeleton className="h-4 w-full" />
          </div>
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="grid items-center gap-2 border-b px-5 py-4 last:border-b-0 md:grid-cols-[minmax(0,2.6fr)_130px_110px_minmax(0,2fr)_120px_24px] md:gap-5"
            >
              <div className="space-y-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3.5 w-64 max-w-full" />
              </div>
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-20" />
              <div className="space-y-2">
                <Skeleton className="h-2 w-full rounded-full" />
                <Skeleton className="h-3 w-40" />
              </div>
              <Skeleton className="h-5 w-16 md:ml-auto" />
              <span />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const tiles = [
    {
      label: "Total outstanding",
      value: formatCents(stats.totalOutstanding),
      sub: `across ${outstanding.length} open transaction${outstanding.length === 1 ? "" : "s"}`,
    },
    {
      label: "Collected so far",
      value: formatCents(stats.collected),
      sub: `of ${formatCents(stats.billed)} billed`,
      className: "text-emerald-800 dark:text-emerald-400",
    },
    {
      label: "Members with a balance",
      value: String(stats.withBalance),
      sub: `${stats.overdueMembers} overdue`,
    },
    {
      label: "Overdue transactions",
      value: String(stats.overdueTx.length),
      sub: stats.overdueTx[0]?.title ?? "Nothing overdue",
      className: stats.overdueTx.length ? "text-red-700 dark:text-red-400" : undefined,
    },
  ];

  return (
    <div className="space-y-6 p-4 md:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
            {view === "transactions" ? "Finance Admin" : "Finance Members"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {view === "transactions"
              ? "Transactions that still have balances to be paid."
              : "Enable finance access and see each member's balance."}
          </p>
        </div>
        <div className="flex gap-2.5">
          <Button
            variant="outline"
            className="h-11"
            onClick={() => setView(view === "members" ? "transactions" : "members")}
          >
            <Users className="size-4" />
            {view === "members" ? "Transactions" : "Members"}
          </Button>
          <Button className="h-11" disabled={!canEdit} onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            New transaction
          </Button>
        </div>
      </div>

      {view === "transactions" ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {tiles.map((tile) => (
              <div key={tile.label} className="space-y-1.5 rounded-xl border p-5">
                <div className="text-[13px] text-muted-foreground">{tile.label}</div>
                <div className={cn("text-2xl font-semibold tracking-tight", tile.className)}>
                  {tile.value}
                </div>
                <div className="truncate text-[12.5px] text-muted-foreground">{tile.sub}</div>
              </div>
            ))}
          </div>

          <div className="overflow-hidden rounded-xl border">
            <div className="flex items-center justify-between border-b px-5 py-3.5">
              <div className="flex gap-1 rounded-lg bg-muted p-1">
                {(
                  [
                    ["outstanding", `Outstanding · ${outstanding.length}`],
                    ["settled", `Settled · ${settled.length}`],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setTab(value)}
                    className={cn(
                      "rounded-md px-3.5 py-1.5 text-[13.5px] font-medium",
                      tab === value
                        ? "bg-background font-semibold shadow-sm"
                        : "text-muted-foreground",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <span className="hidden text-[13px] text-muted-foreground md:block">
                Click a transaction to see who has paid
              </span>
            </div>

            <div className="hidden grid-cols-[minmax(0,2.6fr)_130px_110px_minmax(0,2fr)_120px_24px] gap-5 border-b bg-muted/40 px-5 py-3 text-[12.5px] font-medium text-muted-foreground md:grid">
              <span>Transaction</span>
              <span>Due</span>
              <span>Recipients</span>
              <span>Progress</span>
              <span className="text-right">Outstanding</span>
              <span />
            </div>

            {shown.map((charge) => {
              const pct =
                charge.totalCents > 0
                  ? Math.round((charge.paidCents / charge.totalCents) * 100)
                  : 0;
              const late = charge.overdueCount > 0 ? daysOverdue(charge.dueAt) : 0;
              const paidCount = charge.totalAssigned - charge.unpaidCount;
              return (
                <Link
                  key={charge.id}
                  href={`/member-portal/admin/finance/${charge.id}`}
                  className="grid items-center gap-2 border-b px-5 py-4 last:border-b-0 hover:bg-muted/40 md:grid-cols-[minmax(0,2.6fr)_130px_110px_minmax(0,2fr)_120px_24px] md:gap-5"
                >
                  <div className="min-w-0">
                    <div className="font-semibold">{charge.title}</div>
                    {charge.description && (
                      <div className="truncate text-[13px] text-muted-foreground">
                        {charge.description}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-start gap-1">
                    <span className="text-sm">{formatDate(charge.dueAt)}</span>
                    {charge.overdueCount > 0 && (
                      <Badge variant="destructive" className="text-[11.5px]">
                        {late > 0 ? `${late} days overdue` : "Overdue"}
                      </Badge>
                    )}
                  </div>
                  <span className="text-sm">{charge.totalAssigned} members</span>
                  <div className="space-y-1.5">
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-2 rounded-full bg-emerald-700"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="text-[12.5px] text-muted-foreground">
                      {paidCount} of {charge.totalAssigned} paid · {formatCents(charge.paidCents)}{" "}
                      of {formatCents(charge.totalCents)}
                    </div>
                  </div>
                  <span className="font-semibold md:text-right">
                    {formatCents(charge.outstandingCents)}
                  </span>
                  <ChevronRight className="hidden size-[18px] text-muted-foreground md:block" />
                </Link>
              );
            })}
            {shown.length === 0 && (
              <div className="px-5 py-10 text-center text-sm text-muted-foreground">
                {tab === "outstanding"
                  ? "No transactions have an outstanding balance."
                  : "No settled transactions yet."}
              </div>
            )}
          </div>
        </>
      ) : (
        <Card>
          <CardContent className="space-y-4 pt-6">
            <div className="flex justify-end">
              <label htmlFor="members-show-inactive" className="flex cursor-pointer items-center gap-2 text-[13px] text-muted-foreground">
  <Switch id="members-show-inactive" size="sm" checked={showInactive} onCheckedChange={setShowInactive} />
  Show alumni &amp; disaffiliated
</label>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Roles</TableHead>
                  <TableHead>Finance</TableHead>
                  <TableHead>Outstanding</TableHead>
                  <TableHead>Overdue</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members
                  .filter((m) => showInactive || !(m.isAlumni || m.isDisaffiliated))
                  .map((member) => (
                  <TableRow key={member.id}>
                    <TableCell>
                      <div className="font-medium">{member.name}</div>
                      <div className="text-xs text-muted-foreground">{member.email}</div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {member.roleNames.length > 0 ? (
                          member.roleNames.map((roleName) => (
                            <Badge key={roleName} variant="secondary">
                              {roleName}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground">No roles</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={member.financeEnabled ? "default" : "outline"}>
                        {member.financeEnabled ? "Enabled" : "Disabled"}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatCents(member.outstandingCents)}</TableCell>
                    <TableCell>
                      {member.overdueCount > 0 ? (
                        <Badge variant="destructive">{member.overdueCount}</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">0</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!canEdit || member.financeEnabled || enablingMemberId === member.id}
                        onClick={() => void handleEnableMember(member.id)}
                      >
                        {enablingMemberId === member.id ? "Enabling..." : "Enable"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <CreateTransactionDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        members={members}
        roles={roles}
        onCreated={() => void loadAll()}
      />
    </div>
  );
}

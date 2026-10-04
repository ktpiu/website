"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ChevronRight, FileCheck2, Plus, Search, UserCheck } from "lucide-react";
import { useAuthStore } from "@/lib/auth-store";
import { canManageDeliberation, canManageRush, canViewRush } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NativeSelect } from "@/components/rush/native-select";
import { PnmAvatar } from "@/components/rush/pnm-avatar";
import { IuEmailWarning } from "@/components/rush/iu-email-warning";
import { AccessRequired, CycleSelect, NoCycle, RushPageHeader, useSelectedCycle } from "@/components/member-portal/rush/shared";
import { TransitionDialog } from "@/components/member-portal/rush/transition-dialog";
import { GroupBadge, type PnmListItem } from "@/components/member-portal/rush/pnm-badges";
import { errorMessage, rushFetch } from "@/lib/rush/client";
import { GROUP_LABELS, STAGE_LABELS, STATUS_LABELS } from "@/lib/rush/types";
import { cn } from "@/lib/utils";

export default function RushPnmsPage() {
  const { permissions } = useAuthStore();
  const canView = canViewRush(permissions);
  const canManage = canManageRush(permissions);
  const canDeliberate = canManageDeliberation(permissions);
  const { cycle, cycleParam, isPending: cyclesPending } = useSelectedCycle();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [stageFilter, setStageFilter] = useState<"open" | "closed" | "all" | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [transitionOpen, setTransitionOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");

  const query = useQuery({
    queryKey: ["rush", "pnms", cycleParam],
    enabled: canView,
    placeholderData: keepPreviousData,
    queryFn: () => rushFetch<{ pnms: PnmListItem[]; eventCount: number }>(`/api/rush/pnms?cycleId=${cycleParam}`),
  });

  const pnms = useMemo(() => query.data?.pnms ?? [], [query.data]);
  // Default to the stage the semester is in.
  const stage = stageFilter ?? (cycle?.phase === "closed" ? "closed" : "open");
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return pnms.filter(
      (p) =>
        (stage === "all" || (p.stage === stage && !p.outcome)) &&
        (!q || p.name.toLowerCase().includes(q) || p.email.includes(q)) &&
        (groupFilter === "all" || p.group === groupFilter) &&
        (statusFilter === "all" || p.status === statusFilter),
    );
  }, [pnms, search, groupFilter, statusFilter, stage]);
  const stageCounts = {
    open: pnms.filter((p) => p.stage === "open" && !p.outcome).length,
    closed: pnms.filter((p) => p.stage === "closed" && !p.outcome).length,
    all: pnms.length,
  };

  if (!canView) return <AccessRequired what="view PNMs" />;

  const allSelected = filtered.length > 0 && filtered.every((p) => selected.has(p.id));
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(filtered.map((p) => p.id)));
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const addPnm = async () => {
    if (!cycle) return;
    try {
      await rushFetch("/api/rush/pnms", { method: "POST", json: { cycleId: cycle.id, name: newName, email: newEmail } });
      toast.success(`${newName} added to ${cycle.label}.`);
      setAddOpen(false);
      setNewName("");
      setNewEmail("");
      await queryClient.invalidateQueries({ queryKey: ["rush"] });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const counts = {
    total: pnms.length,
    yes: pnms.filter((p) => p.group === "yes").length,
    applied: pnms.filter((p) => p.hasApplication).length,
  };

  return (
    <div className="mx-auto max-w-6xl">
      <RushPageHeader
        title="PNMs"
        description={
          cycle && query.data
            ? `${counts.total} PNMs · ${counts.applied} applications · ${counts.yes} in Yes · ${query.data.eventCount} events`
            : undefined
        }
        actions={
          <>
            <CycleSelect />
            {canManage && cycle ? (
              <Button variant="outline" onClick={() => setAddOpen(true)}>
                <Plus className="mr-1.5 h-4 w-4" /> Add PNM
              </Button>
            ) : null}
          </>
        }
      />

      {cyclesPending ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : !cycle ? (
        <NoCycle canCreate={canManage} />
      ) : (
        <div className="space-y-4">
          <div className="inline-flex rounded-lg border bg-muted/40 p-1">
            {(["open", "closed", "all"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setStageFilter(s);
                  setSelected(new Set());
                }}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  stage === s ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {s === "all" ? "Everyone" : STAGE_LABELS[s]} <span className="text-muted-foreground">({stageCounts[s]})</span>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Search name or email" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <NativeSelect className="w-40" value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} aria-label="Group">
              <option value="all">All groups</option>
              {Object.entries(GROUP_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect className="w-40" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
              <option value="all">All statuses</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </NativeSelect>
            {canDeliberate && selected.size > 0 && stage !== "all" ? (
              <Button className="ml-auto" onClick={() => setTransitionOpen(true)}>
                Move {selected.size} selected…
              </Button>
            ) : null}
          </div>

          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  {canDeliberate && stage !== "all" ? (
                    <TableHead className="w-10">
                      <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" />
                    </TableHead>
                  ) : null}
                  <TableHead>PNM</TableHead>
                  <TableHead className="hidden md:table-cell">Status</TableHead>
                  <TableHead>Group</TableHead>
                  <TableHead className="text-center">Events</TableHead>
                  <TableHead className="hidden text-center sm:table-cell">App</TableHead>
                  <TableHead className="hidden text-center sm:table-cell">Forms</TableHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.isPending ? (
                  <TableRow>
                    <TableCell colSpan={8}>
                      <Skeleton className="h-24" />
                    </TableCell>
                  </TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                      No PNMs match.
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((p) => (
                    <TableRow key={p.id}>
                      {canDeliberate && stage !== "all" ? (
                        <TableCell>
                          <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} aria-label={`Select ${p.name}`} />
                        </TableCell>
                      ) : null}
                      <TableCell>
                        <Link href={`/member-portal/rush/pnms/${p.id}`} className="flex items-center gap-3">
                          <PnmAvatar name={p.name} src={p.photoUrl} />
                          <div className="min-w-0">
                            <p className="flex items-center gap-1.5 font-medium">
                              {p.name}
                              {!p.isIuEmail ? (
                                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" aria-label="Non-IU email" />
                              ) : null}
                              {p.hasAccount ? <UserCheck className="h-3.5 w-3.5 text-muted-foreground" aria-label="Has account" /> : null}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">{p.email}</p>
                          </div>
                        </Link>
                      </TableCell>
                      <TableCell className="hidden text-sm md:table-cell">{STATUS_LABELS[p.status]}</TableCell>
                      <TableCell>
                        <GroupBadge group={p.group} />
                      </TableCell>
                      <TableCell className="text-center tabular-nums">{p.eventsAttended}</TableCell>
                      <TableCell className="hidden text-center sm:table-cell">
                        {p.hasApplication ? <FileCheck2 className="mx-auto h-4 w-4 text-emerald-500" /> : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="hidden text-center tabular-nums sm:table-cell">{p.responseCount}</TableCell>
                      <TableCell>
                        <Link href={`/member-portal/rush/pnms/${p.id}`} aria-label={`Open ${p.name}`}>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {cycle && stage !== "all" ? (
        <TransitionDialog
          open={transitionOpen}
          onOpenChange={setTransitionOpen}
          cycle={cycle}
          stage={stage}
          pnms={pnms.filter((p) => selected.has(p.id))}
          onDone={() => {
            setSelected(new Set());
            queryClient.invalidateQueries({ queryKey: ["rush"] });
          }}
        />
      ) : null}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a PNM</DialogTitle>
            <DialogDescription>Adds them to {cycle?.label}. Existing PNMs are matched by email.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="pnm-name">Name</Label>
              <Input id="pnm-name" value={newName} onChange={(e) => setNewName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pnm-email">Email</Label>
              <Input id="pnm-email" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
              <IuEmailWarning email={newEmail} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button onClick={addPnm} disabled={!newName.trim() || !newEmail.trim()}>
              Add PNM
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

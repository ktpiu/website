"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Plus } from "lucide-react";
import { useAuthStore } from "@/lib/auth-store";
import { canManageElections, canViewTranscripts } from "@/lib/permissions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { NativeSelect } from "@/components/rush/native-select";
import { RushPageHeader } from "@/components/member-portal/rush/shared";
import { CandidatesPanel } from "@/components/member-portal/elections/candidates-panel";
import { EndorsementsPanel } from "@/components/member-portal/elections/endorsements-panel";
import { VotingPanel } from "@/components/member-portal/elections/voting-panel";
import { errorMessage, rushFetch } from "@/lib/rush/client";
import { formatEastern, isoToEasternInput } from "@/lib/elections/eastern-time";
import {
  electionStage,
  MAX_POSITIONS_LIMIT,
  positionsLocked,
  STAGE_LABELS,
  type BallotRole,
  type Election,
  type ElectionPosition,
} from "@/lib/elections/types";

type SettingsDraft = { name: string; submissionDeadline: string; maxPositionsPerCandidate: string };

export default function ElectionManagePage() {
  const { permissions } = useAuthStore();
  const canManage = canManageElections(permissions);
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["elections"] });

  const list = useQuery({
    queryKey: ["elections", "manage"],
    enabled: canManage,
    queryFn: () => rushFetch<{ elections: Election[]; roles: BallotRole[] }>("/api/elections"),
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const elections = list.data?.elections ?? [];
  const roles = list.data?.roles ?? [];
  const activeId = selectedId ?? elections[0]?.id ?? null;

  const detail = useQuery({
    queryKey: ["elections", "manage", activeId],
    enabled: canManage && Boolean(activeId),
    queryFn: () =>
      rushFetch<{ election: Election; positions: ElectionPosition[] }>(`/api/elections/${activeId}`),
  });

  const [creating, setCreating] = useState<(SettingsDraft & { roleIds: Set<string> }) | null>(null);
  const [editing, setEditing] = useState<SettingsDraft | null>(null);
  const [editingSeats, setEditingSeats] = useState<Set<string> | null>(null);
  const [saving, setSaving] = useState(false);

  if (!canManage) {
    return (
      <div className="p-4 md:p-6">
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>Access required</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Only the Standards Board can manage elections.
          </CardContent>
        </Card>
      </div>
    );
  }

  const run = async (fn: () => Promise<unknown>, success?: string) => {
    setSaving(true);
    try {
      await fn();
      if (success) toast.success(success);
      return true;
    } catch (error) {
      toast.error(errorMessage(error));
      return false;
    } finally {
      setSaving(false);
      refresh();
    }
  };

  const election = detail.data?.election ?? null;
  const positions = detail.data?.positions ?? [];
  const stage = election ? electionStage(election) : null;
  const locked = election ? positionsLocked(election) || election.phase === "closed" : true;
  const seatsLocked = !election || election.phase === "closed";

  const startCreate = () =>
    setCreating({
      name: "",
      submissionDeadline: "",
      maxPositionsPerCandidate: "2",
      roleIds: new Set(roles.map((r) => r.id)),
    });

  const saveCreate = async () => {
    if (!creating) return;
    let createdId: string | null = null;
    const ok = await run(async () => {
      const result = await rushFetch<{ election: Election }>("/api/elections", {
        method: "POST",
        json: {
          name: creating.name,
          submissionDeadline: creating.submissionDeadline,
          maxPositionsPerCandidate: Number(creating.maxPositionsPerCandidate),
          roleIds: Array.from(creating.roleIds),
        },
      });
      createdId = result.election.id;
    }, "Election created.");
    if (ok) {
      setCreating(null);
      setSelectedId(createdId);
    }
  };

  const saveSettings = async () => {
    if (!editing || !election) return;
    const reopening =
      election.phase === "campaign" &&
      new Date(election.submission_deadline) <= new Date() &&
      editing.submissionDeadline > isoToEasternInput(new Date().toISOString());
    if (reopening && !window.confirm("The new deadline is in the future, so candidates can edit their submissions again. Continue?")) {
      return;
    }
    const ok = await run(
      () =>
        rushFetch(`/api/elections/${election.id}`, {
          method: "PATCH",
          json: {
            name: editing.name,
            submissionDeadline: editing.submissionDeadline,
            ...(locked ? {} : { maxPositionsPerCandidate: Number(editing.maxPositionsPerCandidate) }),
          },
        }),
      "Settings saved.",
    );
    if (ok) setEditing(null);
  };

  const saveSeats = async () => {
    if (!editingSeats || !election) return;
    const ok = await run(
      () => rushFetch(`/api/elections/${election.id}/positions`, { method: "PUT", json: { roleIds: Array.from(editingSeats) } }),
      "Positions saved.",
    );
    if (ok) setEditingSeats(null);
  };

  const openApplications = () => {
    if (!election) return;
    if (!window.confirm(`Open applications for ${election.name}? Active members will be able to apply.`)) return;
    void run(
      () => rushFetch(`/api/elections/${election.id}`, { method: "PATCH", json: { phase: "applications" } }),
      "Applications are open.",
    );
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-10">
      <RushPageHeader
        title="Election Management"
        description="Set up executive board and director elections, review candidates and run voting."
        actions={
          <>
            {elections.length > 1 ? (
              <NativeSelect
                className="w-56"
                value={activeId ?? ""}
                onChange={(e) => setSelectedId(e.target.value)}
                aria-label="Election"
              >
                {elections.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </NativeSelect>
            ) : null}
            <Button onClick={startCreate} disabled={list.isPending}>
              <Plus className="mr-1.5 h-4 w-4" /> New election
            </Button>
          </>
        }
      />

      {list.isPending || (activeId && detail.isPending) ? (
        <Skeleton className="h-48" />
      ) : !election ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">No elections yet</CardTitle>
            <CardDescription>
              Create an election to choose its positions and set the submission deadline.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
              <div className="space-y-1.5">
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  {election.name}
                  {stage ? <Badge variant="secondary">{STAGE_LABELS[stage]}</Badge> : null}
                </CardTitle>
                <CardDescription>Settings apply to this election only.</CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                {election.phase === "setup" ? (
                  <Button size="sm" onClick={openApplications} disabled={saving || positions.length === 0}>
                    Open applications
                  </Button>
                ) : null}
                {election.phase !== "closed" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setEditing({
                        name: election.name,
                        submissionDeadline: isoToEasternInput(election.submission_deadline),
                        maxPositionsPerCandidate: String(election.max_positions_per_candidate),
                      })
                    }
                  >
                    <Pencil className="mr-1.5 h-4 w-4" /> Edit
                  </Button>
                ) : null}
              </div>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">Submission deadline</dt>
                  <dd className="font-medium">{formatEastern(election.submission_deadline)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Positions per candidate</dt>
                  <dd className="font-medium">Up to {election.max_positions_per_candidate}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
              <div className="space-y-1.5">
                <CardTitle className="text-base">Positions</CardTitle>
                <CardDescription>
                  {seatsLocked
                    ? "This election is closed."
                    : "The roles up for election, voted on in Roles page order. You can add more at any time before the election closes."}
                </CardDescription>
              </div>
              {!seatsLocked ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEditingSeats(new Set(positions.map((p) => p.role_id).filter((id): id is string => Boolean(id))))}
                >
                  <Pencil className="mr-1.5 h-4 w-4" /> Edit positions
                </Button>
              ) : null}
            </CardHeader>
            <CardContent>
              {positions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No positions on the ballot.</p>
              ) : (
                <ol className="divide-y rounded-lg border">
                  {positions.map((p, index) => (
                    <li key={p.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                      <span className="w-6 text-right tabular-nums text-muted-foreground">{index + 1}</span>
                      <span className="font-medium">{p.title}</span>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>

          {election.phase !== "setup" || positions.length > 0 ? (
            <CandidatesPanel
              election={election}
              positions={positions}
              canViewTranscripts={canViewTranscripts(permissions)}
            />
          ) : null}

          <VotingPanel key={election.id} election={election} />

          {election.candidates_finalized_at ? <EndorsementsPanel election={election} /> : null}
        </>
      )}

      <Dialog open={creating !== null} onOpenChange={(open) => !open && setCreating(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New election</DialogTitle>
            <DialogDescription>You can change any of this later with Edit.</DialogDescription>
          </DialogHeader>
          {creating ? (
            <div className="space-y-4">
              <SettingsFields
                draft={creating}
                onChange={(patch) => setCreating((d) => (d ? { ...d, ...patch } : d))}
                maxLocked={false}
              />
              <RoleChecklist
                roles={roles}
                selected={creating.roleIds}
                onChange={(roleIds) => setCreating((d) => (d ? { ...d, roleIds } : d))}
              />
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(null)}>
              Cancel
            </Button>
            <Button onClick={saveCreate} disabled={saving}>
              Create election
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit election</DialogTitle>
          </DialogHeader>
          {editing ? (
            <SettingsFields
              draft={editing}
              onChange={(patch) => setEditing((d) => (d ? { ...d, ...patch } : d))}
              maxLocked={locked}
            />
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={saveSettings} disabled={saving}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editingSeats !== null} onOpenChange={(open) => !open && setEditingSeats(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Positions on the ballot</DialogTitle>
            <DialogDescription>
              A position with candidates can&apos;t be removed. After candidates are finalized, add campaigners to new
              positions from the Candidates card.
            </DialogDescription>
          </DialogHeader>
          {editingSeats ? <RoleChecklist roles={roles} selected={editingSeats} onChange={setEditingSeats} /> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingSeats(null)}>
              Cancel
            </Button>
            <Button onClick={saveSeats} disabled={saving}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SettingsFields({
  draft,
  onChange,
  maxLocked,
}: {
  draft: SettingsDraft;
  onChange: (patch: Partial<SettingsDraft>) => void;
  maxLocked: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="election-name">Name</Label>
        <Input
          id="election-name"
          value={draft.name}
          maxLength={120}
          placeholder="Fall 2026 Executive Board"
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="election-deadline">Submission deadline (Eastern Time)</Label>
        <Input
          id="election-deadline"
          type="datetime-local"
          value={draft.submissionDeadline}
          onChange={(e) => onChange({ submissionDeadline: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">
          Candidates can edit their materials until then. Member review opens at the deadline.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="election-max">Positions per candidate</Label>
        <NativeSelect
          id="election-max"
          className="w-28"
          value={draft.maxPositionsPerCandidate}
          disabled={maxLocked}
          onChange={(e) => onChange({ maxPositionsPerCandidate: e.target.value })}
        >
          {Array.from({ length: MAX_POSITIONS_LIMIT }, (_, i) => String(i + 1)).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </NativeSelect>
        {maxLocked ? <p className="text-xs text-muted-foreground">Locked because candidates are finalized.</p> : null}
      </div>
    </div>
  );
}

function RoleChecklist({
  roles,
  selected,
  onChange,
}: {
  roles: BallotRole[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    onChange(next);
  };
  const groups: Array<{ label: string; type: BallotRole["type"] }> = [
    { label: "Executive board", type: "exec" },
    { label: "Directors", type: "director" },
  ];

  return (
    <div className="space-y-3">
      <Label>Positions on the ballot</Label>
      {groups.map((group) => {
        const inGroup = roles.filter((r) => r.type === group.type);
        if (inGroup.length === 0) return null;
        return (
          <fieldset key={group.type} className="space-y-1.5">
            <legend className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{group.label}</legend>
            {inGroup.map((role) => (
              <label key={role.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selected.has(role.id)}
                  onChange={(e) => toggle(role.id, e.target.checked)}
                />
                {role.name}
              </label>
            ))}
          </fieldset>
        );
      })}
      {roles.length === 0 ? (
        <p className="text-sm text-muted-foreground">No executive board or director roles exist yet. Add them on the Roles page.</p>
      ) : null}
    </div>
  );
}

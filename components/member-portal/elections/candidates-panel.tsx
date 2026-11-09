"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ban, CalendarClock, Check, FileText, FolderOpen, Lock, MoreVertical, Pencil, Plus, Undo2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { PeopleSelector } from "@/components/ui/people-selector";
import { MaterialsEditor } from "@/components/member-portal/elections/materials-editor";
import { errorMessage, rushFetch } from "@/lib/rush/client";
import { formatEastern, isoToEasternInput } from "@/lib/elections/eastern-time";
import {
  CANDIDACY_STATUS_LABELS,
  isLatePosition,
  type Candidacy,
  type Election,
  type ElectionMember,
  type ElectionPosition,
  type ManagedCandidate,
} from "@/lib/elections/types";

type Decision = { candidacyId: string; status: "approved" | "denied" | "voided"; reason?: string };

const STATUS_VARIANT: Partial<Record<Candidacy["status"], "default" | "secondary" | "destructive" | "outline">> = {
  pending: "secondary",
  approved: "default",
  denied: "destructive",
  voided: "destructive",
};

/**
 * Applications and campaigners for one election: approve or deny each seat
 * (denials need a reason the applicant sees), open transcripts, change a
 * candidate's positions, and add campaigners by hand, with each candidate's
 * actions in one menu. Decisions lock when candidates are finalized; after
 * that, approved seats can be voided (and voids undone) until voting starts,
 * and a candidate can be given an extension on the materials deadline.
 */
export function CandidatesPanel({
  election,
  positions,
  canViewTranscripts,
}: {
  election: Election;
  positions: ElectionPosition[];
  canViewTranscripts: boolean;
}) {
  const queryClient = useQueryClient();
  const key = ["elections", "manage", election.id, "candidates"];
  const candidates = useQuery({
    queryKey: key,
    queryFn: () =>
      rushFetch<{ candidates: ManagedCandidate[]; members: ElectionMember[] }>(`/api/elections/${election.id}/candidates`),
  });

  // Denying (before finalize) and voiding (after) both need a reason the candidate sees.
  const [denying, setDenying] = useState<{
    candidacyIds: string[];
    label: string;
    reason: string;
    status: "denied" | "voided";
  } | null>(null);
  const [materialsFor, setMaterialsFor] = useState<{ id: string; name: string } | null>(null);
  const [adding, setAdding] = useState<{ userId: string; positionIds: Set<string> } | null>(null);
  const [editing, setEditing] = useState<{ candidate: ManagedCandidate; positionIds: Set<string> } | null>(null);
  const [extending, setExtending] = useState<{ candidate: ManagedCandidate; value: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const editable = !election.candidates_finalized_at && (election.phase === "setup" || election.phase === "applications");
  // After finalize, approved candidacies can be voided until voting starts.
  const canVoid = Boolean(election.candidates_finalized_at) && election.phase === "campaign";
  // Standards can move a candidate between positions until voting starts.
  // Extensions only matter while candidates can still be editing materials.
  const canExtend = election.phase === "applications" || election.phase === "campaign";
  const canEditPositions = ["setup", "applications", "campaign"].includes(election.phase);
  // Finalized elections only take new campaigners for seats added since then.
  const lateSeats = positions.filter((p) => isLatePosition(election, p));
  const addableSeats = editable ? positions : election.phase === "closed" ? [] : lateSeats;
  const positionTitle = new Map(positions.map((p) => [p.id, p.title]));
  const positionOrder = new Map(positions.map((p) => [p.id, p.sort_order]));
  const list = candidates.data?.candidates ?? [];
  const pending = list.flatMap((c) => c.candidacies.filter((s) => s.status === "pending"));

  const decide = async (decisions: Decision[], success: string) => {
    setSaving(true);
    try {
      await rushFetch(`/api/elections/${election.id}/candidacies`, { method: "PATCH", json: { decisions } });
      toast.success(success);
      return true;
    } catch (error) {
      toast.error(errorMessage(error));
      return false;
    } finally {
      setSaving(false);
      void queryClient.invalidateQueries({ queryKey: key });
    }
  };

  const confirmDeny = async () => {
    if (!denying) return;
    if (!denying.reason.trim()) return toast.error("Give a reason. The applicant sees it.");
    const ok = await decide(
      denying.candidacyIds.map((candidacyId) => ({ candidacyId, status: denying.status, reason: denying.reason.trim() })),
      denying.status === "voided" ? "Candidacy voided." : "Denied.",
    );
    if (ok) setDenying(null);
  };

  const finalize = async () => {
    if (!window.confirm("Finalize candidates? Registration closes, the list locks, and members can see the final list and endorsements. Approved candidates can still submit materials until the deadline.")) return;
    setSaving(true);
    try {
      await rushFetch(`/api/elections/${election.id}/finalize`, { method: "POST" });
      toast.success("Candidates finalized.");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
      void queryClient.invalidateQueries({ queryKey: ["elections"] });
    }
  };

  const saveCampaigner = async () => {
    if (!adding) return;
    if (!adding.userId) return toast.error("Choose a member.");
    if (adding.positionIds.size === 0) return toast.error("Choose at least one position.");
    setSaving(true);
    try {
      await rushFetch(`/api/elections/${election.id}/candidates`, {
        method: "POST",
        json: { userId: adding.userId, positionIds: Array.from(adding.positionIds) },
      });
      toast.success("Campaigner added.");
      setAdding(null);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
      void queryClient.invalidateQueries({ queryKey: key });
    }
  };

  const startEditPositions = (candidate: ManagedCandidate) =>
    setEditing({
      candidate,
      positionIds: new Set(
        candidate.candidacies.filter((s) => s.status === "pending" || s.status === "approved").map((s) => s.position_id),
      ),
    });

  const savePositions = async () => {
    if (!editing) return;
    if (editing.positionIds.size === 0) return toast.error("Choose at least one position.");
    setSaving(true);
    try {
      await rushFetch(`/api/elections/${election.id}/candidates/${editing.candidate.id}`, {
        method: "PUT",
        json: { positionIds: Array.from(editing.positionIds) },
      });
      toast.success("Positions updated.");
      setEditing(null);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
      void queryClient.invalidateQueries({ queryKey: key });
    }
  };

  const saveExtension = async (value: string | null) => {
    if (!extending) return;
    if (value !== null && !value) return toast.error("Choose the new deadline.");
    setSaving(true);
    try {
      await rushFetch(`/api/elections/${election.id}/candidates/${extending.candidate.id}`, {
        method: "PATCH",
        json: { extendedUntil: value },
      });
      toast.success(value ? "Extension saved." : "Extension removed.");
      setExtending(null);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
      void queryClient.invalidateQueries({ queryKey: key });
    }
  };

  const candidateIds = new Set(list.map((c) => c.user.id));
  // Existing candidates can also run for a seat added later.
  const members = (candidates.data?.members ?? []).filter(
    (m) => !editable || !candidateIds.has(m.id) || adding?.userId === m.id,
  );

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div className="space-y-1.5">
          <CardTitle className="text-base">Candidates</CardTitle>
          <CardDescription>
            {editable
              ? pending.length > 0
                ? `${pending.length} application${pending.length === 1 ? "" : "s"} waiting for a decision. Every one must be approved or denied before candidates are finalized.`
                : "Approve or deny each position someone applies for. Campaigners you add are approved immediately."
              : "Candidates are finalized. Approved candidates can still submit materials until the deadline."}
          </CardDescription>
        </div>
        {addableSeats.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setAdding({ userId: "", positionIds: new Set() })}>
              <Plus className="mr-1.5 h-4 w-4" /> Add campaigner
            </Button>
            {editable && election.phase === "applications" ? (
              <Button size="sm" onClick={finalize} disabled={saving || pending.length > 0 || list.length === 0}>
                <Lock className="mr-1.5 h-4 w-4" /> Finalize candidates
              </Button>
            ) : null}
          </div>
        ) : null}
      </CardHeader>
      <CardContent>
        {candidates.isPending ? (
          <Skeleton className="h-24" />
        ) : list.length === 0 ? (
          <p className="text-sm text-muted-foreground">No one has applied yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {list.map((candidate) => {
              const seats = candidate.candidacies
                .slice()
                .sort((a, b) => (positionOrder.get(a.position_id) ?? 0) - (positionOrder.get(b.position_id) ?? 0));
              const undecided = seats.filter((s) => s.status === "pending");
              const approvedSeats = seats.filter((s) => s.status === "approved");
              const required = [
                candidate.has_intro,
                approvedSeats.length > 0 && approvedSeats.every((s) => Boolean(s.video_url)),
                candidate.has_transcript,
                candidate.photo_count > 0,
              ];
              const requiredDone = required.filter(Boolean).length;
              const extendedUntil =
                candidate.materials_extended_until &&
                new Date(candidate.materials_extended_until) > new Date(election.submission_deadline)
                  ? candidate.materials_extended_until
                  : null;
              const decisions = seats.flatMap((seat) => {
                const actions: Array<"approve" | "deny" | "void" | "restore"> = [];
                if (editable && ["pending", "denied"].includes(seat.status)) actions.push("approve");
                if (editable && ["pending", "approved"].includes(seat.status)) actions.push("deny");
                if (canVoid && seat.status === "approved") actions.push("void");
                if (canVoid && seat.status === "voided") actions.push("restore");
                return actions.map((action) => ({ seat, action }));
              });
              return (
                <li key={candidate.id} className="space-y-2 px-3 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">{candidate.user.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {candidate.user.email} · {candidate.source === "manual" ? "Added by Standards" : "Applied"}
                      </p>
                      {extendedUntil ? (
                        <p className="text-xs text-muted-foreground">Materials extended to {formatEastern(extendedUntil)}</p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      {approvedSeats.length > 0 ? (
                        <Badge variant={requiredDone === required.length ? "default" : "outline"}>
                          {requiredDone}/{required.length} tasks
                        </Badge>
                      ) : null}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-8"
                            disabled={saving}
                            aria-label={`Actions for ${candidate.user.name}`}
                          >
                            <MoreVertical className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {approvedSeats.length > 0 && election.phase !== "closed" ? (
                            <DropdownMenuItem onSelect={() => setMaterialsFor({ id: candidate.id, name: candidate.user.name })}>
                              <FolderOpen /> Materials
                            </DropdownMenuItem>
                          ) : null}
                          {candidate.has_transcript && canViewTranscripts ? (
                            <DropdownMenuItem asChild>
                              <a href={`/api/elections/candidates/${candidate.id}/transcript`} target="_blank" rel="noreferrer">
                                <FileText /> Transcript
                              </a>
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem disabled>
                              <FileText /> {candidate.has_transcript ? "Transcript on file" : "No transcript yet"}
                            </DropdownMenuItem>
                          )}
                          {canExtend && approvedSeats.length > 0 ? (
                            <DropdownMenuItem
                              onSelect={() =>
                                setExtending({
                                  candidate,
                                  value: isoToEasternInput(extendedUntil ?? election.submission_deadline),
                                })
                              }
                            >
                              <CalendarClock /> {extendedUntil ? "Change extension" : "Extend materials deadline"}
                            </DropdownMenuItem>
                          ) : null}
                          {canEditPositions ? (
                            <DropdownMenuItem onSelect={() => startEditPositions(candidate)}>
                              <Pencil /> Edit positions
                            </DropdownMenuItem>
                          ) : null}
                          {decisions.length > 0 ? <DropdownMenuSeparator /> : null}
                          {editable && undecided.length > 1 ? (
                            <>
                              <DropdownMenuItem
                                onSelect={() =>
                                  decide(
                                    undecided.map((s) => ({ candidacyId: s.id, status: "approved" })),
                                    `${candidate.user.name} approved.`,
                                  )
                                }
                              >
                                <Check /> Approve all
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                variant="destructive"
                                onSelect={() =>
                                  setDenying({
                                    candidacyIds: undecided.map((s) => s.id),
                                    label: candidate.user.name,
                                    reason: "",
                                    status: "denied",
                                  })
                                }
                              >
                                <X /> Deny all
                              </DropdownMenuItem>
                            </>
                          ) : null}
                          {decisions.map(({ seat, action }) => {
                            const title = positionTitle.get(seat.position_id) ?? "this position";
                            if (action === "approve") {
                              return (
                                <DropdownMenuItem
                                  key={`${seat.id}-approve`}
                                  onSelect={() => decide([{ candidacyId: seat.id, status: "approved" }], "Approved.")}
                                >
                                  <Check /> Approve for {title}
                                </DropdownMenuItem>
                              );
                            }
                            if (action === "restore") {
                              return (
                                <DropdownMenuItem
                                  key={`${seat.id}-restore`}
                                  onSelect={() => decide([{ candidacyId: seat.id, status: "approved" }], "Void undone.")}
                                >
                                  <Undo2 /> Undo void for {title}
                                </DropdownMenuItem>
                              );
                            }
                            const status = action === "deny" ? "denied" : "voided";
                            return (
                              <DropdownMenuItem
                                key={`${seat.id}-${action}`}
                                variant="destructive"
                                onSelect={() =>
                                  setDenying({
                                    candidacyIds: [seat.id],
                                    label: `${candidate.user.name} for ${title}`,
                                    reason: "",
                                    status,
                                  })
                                }
                              >
                                {action === "deny" ? <X /> : <Ban />} {action === "deny" ? "Deny" : "Void"} for {title}
                              </DropdownMenuItem>
                            );
                          })}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                  <ul className="space-y-1.5">
                    {seats.map((seat) => (
                      <li key={seat.id} className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="min-w-0 flex-1">{positionTitle.get(seat.position_id) ?? "Position"}</span>
                        <Badge variant={STATUS_VARIANT[seat.status] ?? "outline"}>{CANDIDACY_STATUS_LABELS[seat.status]}</Badge>
                        {(seat.status === "denied" || seat.status === "voided") && seat.decision_reason ? (
                          <p className="w-full text-xs text-muted-foreground">Reason: {seat.decision_reason}</p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      <Dialog open={denying !== null} onOpenChange={(open) => !open && setDenying(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {denying?.status === "voided" ? "Void" : "Deny"} {denying?.label}
            </DialogTitle>
            <DialogDescription>
              {denying?.status === "voided"
                ? "Voiding removes them from this race for not meeting the requirements. They see this reason in their portal."
                : "The applicant sees this reason in their portal."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="deny-reason">Reason</Label>
            <Textarea
              id="deny-reason"
              rows={4}
              maxLength={1000}
              value={denying?.reason ?? ""}
              onChange={(e) => setDenying((d) => (d ? { ...d, reason: e.target.value } : d))}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDenying(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDeny} disabled={saving}>
              {denying?.status === "voided" ? "Void candidacy" : "Deny"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={extending !== null} onOpenChange={(open) => !open && setExtending(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Extend {extending?.candidate.user.name}&apos;s materials deadline</DialogTitle>
            <DialogDescription>
              Everyone else&apos;s materials are due {formatEastern(election.submission_deadline)}. Only this candidate
              can keep editing until the new deadline.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="extended-until">New deadline (Eastern Time)</Label>
            <Input
              id="extended-until"
              type="datetime-local"
              value={extending?.value ?? ""}
              onChange={(e) => setExtending((d) => (d ? { ...d, value: e.target.value } : d))}
            />
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            {extending?.candidate.materials_extended_until ? (
              <Button variant="outline" onClick={() => saveExtension(null)} disabled={saving}>
                Remove extension
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setExtending(null)}>
                Cancel
              </Button>
              <Button onClick={() => saveExtension(extending?.value ?? "")} disabled={saving}>
                Save
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={materialsFor !== null} onOpenChange={(open) => !open && setMaterialsFor(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{materialsFor?.name}&apos;s materials</DialogTitle>
            <DialogDescription>
              Changes you make here show the candidate &quot;Last edited by the Standards Board&quot;. You can edit after
              the deadline; candidates can&apos;t.
            </DialogDescription>
          </DialogHeader>
          {materialsFor ? <MaterialsEditor candidateId={materialsFor.id} forManager /> : null}
        </DialogContent>
      </Dialog>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit {editing?.candidate.user.name}&apos;s positions</DialogTitle>
            <DialogDescription>
              Positions you add are approved right away. Removing a position permanently deletes its initiative video
              and endorsements.
            </DialogDescription>
          </DialogHeader>
          {editing ? (
            <fieldset className="space-y-1.5">
              <legend className="mb-1 text-sm font-medium">Positions</legend>
              {positions.map((p) => {
                const closed = editing.candidate.candidacies.find(
                  (s) => s.position_id === p.id && s.status !== "pending" && s.status !== "approved",
                );
                return (
                  <label key={p.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={editing.positionIds.has(p.id)}
                      disabled={Boolean(closed)}
                      onChange={(e) =>
                        setEditing((d) => {
                          if (!d) return d;
                          const next = new Set(d.positionIds);
                          if (e.target.checked) next.add(p.id);
                          else next.delete(p.id);
                          return { ...d, positionIds: next };
                        })
                      }
                    />
                    {p.title}
                    {closed ? (
                      <span className="text-xs text-muted-foreground">({CANDIDACY_STATUS_LABELS[closed.status]})</span>
                    ) : null}
                  </label>
                );
              })}
            </fieldset>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={savePositions} disabled={saving}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={adding !== null} onOpenChange={(open) => !open && setAdding(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add campaigner</DialogTitle>
            <DialogDescription>
              Approved right away. They or the Standards Board can upload their transcript and materials later.
            </DialogDescription>
          </DialogHeader>
          {adding ? (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="campaigner">Member</Label>
                <PeopleSelector
                  id="campaigner"
                  options={members.map((m) => ({ key: m.id, name: m.name, avatar: m.avatar }))}
                  value={adding.userId ? [adding.userId] : []}
                  onChange={(value) => setAdding((a) => (a ? { ...a, userId: value[0] ?? "" } : a))}
                  loading={candidates.isPending}
                  placeholder="Choose an active member"
                />
              </div>
              <fieldset className="space-y-1.5">
                <legend className="mb-1 text-sm font-medium">Positions</legend>
                {addableSeats.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={adding.positionIds.has(p.id)}
                      onChange={(e) =>
                        setAdding((a) => {
                          if (!a) return a;
                          const next = new Set(a.positionIds);
                          if (e.target.checked) next.add(p.id);
                          else next.delete(p.id);
                          return { ...a, positionIds: next };
                        })
                      }
                    />
                    {p.title}
                  </label>
                ))}
              </fieldset>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdding(null)}>
              Cancel
            </Button>
            <Button onClick={saveCampaigner} disabled={saving}>
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

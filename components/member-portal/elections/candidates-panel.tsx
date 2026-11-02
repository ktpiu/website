"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ban, Check, FileText, FolderOpen, Lock, Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/rush/native-select";
import { MaterialsEditor } from "@/components/member-portal/elections/materials-editor";
import { errorMessage, rushFetch } from "@/lib/rush/client";
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
 * (denials need a reason the applicant sees), open transcripts, and add
 * campaigners by hand. Decisions lock when candidates are finalized.
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
  const [saving, setSaving] = useState(false);

  const editable = !election.candidates_finalized_at && (election.phase === "setup" || election.phase === "applications");
  // After finalize, approved candidacies can be voided until voting starts.
  const canVoid = Boolean(election.candidates_finalized_at) && election.phase === "campaign";
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
    if (!window.confirm("Finalize candidates? The list locks, approved candidates can submit materials, and members can start endorsing.")) return;
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
              : "Candidates are finalized."}
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
              return (
                <li key={candidate.id} className="space-y-2 px-3 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">{candidate.user.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {candidate.user.email} · {candidate.source === "manual" ? "Added by Standards" : "Applied"}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {approvedSeats.length > 0 ? (
                        <>
                          <Badge variant={requiredDone === required.length ? "default" : "outline"}>
                            {requiredDone}/{required.length} tasks
                          </Badge>
                          {election.phase !== "closed" ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setMaterialsFor({ id: candidate.id, name: candidate.user.name })}
                            >
                              <FolderOpen className="mr-1.5 h-4 w-4" /> Materials
                            </Button>
                          ) : null}
                        </>
                      ) : null}
                      {candidate.has_transcript ? (
                        canViewTranscripts ? (
                          <Button asChild size="sm" variant="ghost">
                            <a href={`/api/elections/candidates/${candidate.id}/transcript`} target="_blank" rel="noreferrer">
                              <FileText className="mr-1.5 h-4 w-4" /> Transcript
                            </a>
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">Transcript on file</span>
                        )
                      ) : (
                        <span className="text-xs text-muted-foreground">No transcript yet</span>
                      )}
                      {editable && undecided.length > 1 ? (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={saving}
                            onClick={() =>
                              decide(
                                undecided.map((s) => ({ candidacyId: s.id, status: "approved" })),
                                `${candidate.user.name} approved.`,
                              )
                            }
                          >
                            Approve all
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={saving}
                            onClick={() =>
                              setDenying({
                                candidacyIds: undecided.map((s) => s.id),
                                label: candidate.user.name,
                                reason: "",
                                status: "denied",
                              })
                            }
                          >
                            Deny all
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <ul className="space-y-1.5">
                    {seats.map((seat) => (
                      <li key={seat.id} className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="min-w-0 flex-1">{positionTitle.get(seat.position_id) ?? "Position"}</span>
                        <Badge variant={STATUS_VARIANT[seat.status] ?? "outline"}>{CANDIDACY_STATUS_LABELS[seat.status]}</Badge>
                        {editable && ["pending", "denied"].includes(seat.status) ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={saving}
                            aria-label={`Approve ${candidate.user.name} for ${positionTitle.get(seat.position_id)}`}
                            onClick={() => decide([{ candidacyId: seat.id, status: "approved" }], "Approved.")}
                          >
                            <Check className="mr-1 h-4 w-4" /> Approve
                          </Button>
                        ) : null}
                        {editable && ["pending", "approved"].includes(seat.status) ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={saving}
                            aria-label={`Deny ${candidate.user.name} for ${positionTitle.get(seat.position_id)}`}
                            onClick={() =>
                              setDenying({
                                candidacyIds: [seat.id],
                                label: `${candidate.user.name} for ${positionTitle.get(seat.position_id) ?? "this position"}`,
                                reason: "",
                                status: "denied",
                              })
                            }
                          >
                            <X className="mr-1 h-4 w-4" /> Deny
                          </Button>
                        ) : null}
                        {canVoid && seat.status === "approved" ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={saving}
                            aria-label={`Void ${candidate.user.name} for ${positionTitle.get(seat.position_id)}`}
                            onClick={() =>
                              setDenying({
                                candidacyIds: [seat.id],
                                label: `${candidate.user.name} for ${positionTitle.get(seat.position_id) ?? "this position"}`,
                                reason: "",
                                status: "voided",
                              })
                            }
                          >
                            <Ban className="mr-1 h-4 w-4" /> Void
                          </Button>
                        ) : null}
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
                <NativeSelect
                  id="campaigner"
                  value={adding.userId}
                  onChange={(e) => setAdding((a) => (a ? { ...a, userId: e.target.value } : a))}
                >
                  <option value="">Choose an active member</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <fieldset className="space-y-1.5">
                <legend className="mb-1 text-sm font-medium">
                  Positions (up to {election.max_positions_per_candidate})
                </legend>
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

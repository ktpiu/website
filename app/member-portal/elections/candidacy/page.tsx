"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { RushPageHeader } from "@/components/member-portal/rush/shared";
import { MaterialsEditor } from "@/components/member-portal/elections/materials-editor";
import { ApiError, errorMessage, rushFetch } from "@/lib/rush/client";
import { formatEastern } from "@/lib/elections/eastern-time";
import { TRANSCRIPT_ACCEPT, validateTranscriptFile } from "@/lib/elections/uploads";
import {
  CANDIDACY_STATUS_LABELS,
  type Candidacy,
  type Election,
  type ElectionPosition,
  type MyCandidacy,
} from "@/lib/elections/types";

type Current = { election: Election | null; positions: ElectionPosition[]; mine: MyCandidacy | null };

const STATUS_VARIANT: Partial<Record<Candidacy["status"], "default" | "secondary" | "destructive" | "outline">> = {
  pending: "secondary",
  approved: "default",
  denied: "destructive",
  voided: "destructive",
};

export default function CandidacyPage() {
  const queryClient = useQueryClient();
  const current = useQuery({
    queryKey: ["elections", "current"],
    queryFn: () => rushFetch<Current>("/api/elections/current"),
    retry: (count, error) => !(error instanceof ApiError && error.status === 403) && count < 2,
  });

  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [transcript, setTranscript] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (current.isPending) {
    return (
      <div className="mx-auto max-w-3xl space-y-6 pb-10">
        <RushPageHeader title="Run for Office" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  if (current.error) {
    return (
      <div className="mx-auto max-w-3xl space-y-6 pb-10">
        <RushPageHeader title="Run for Office" />
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">{errorMessage(current.error)}</CardContent>
        </Card>
      </div>
    );
  }

  const { election, positions, mine } = current.data;
  const positionTitle = new Map(positions.map((p) => [p.id, p.title]));
  const applicationsOpen = election?.phase === "applications" && !election.candidates_finalized_at;
  const showForm = applicationsOpen && (!mine || editing);

  const startEdit = () => {
    setSelected(new Set((mine?.candidacies ?? []).filter((c) => c.status === "pending" || c.status === "approved").map((c) => c.position_id)));
    setTranscript(null);
    setEditing(true);
  };

  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    setSelected(next);
  };

  const submit = async () => {
    if (!election) return;
    if (selected.size === 0) return toast.error("Choose at least one position.");
    if (selected.size > election.max_positions_per_candidate) {
      return toast.error(`You can run for up to ${election.max_positions_per_candidate} positions.`);
    }
    if (!mine && !transcript) return toast.error("Attach your unofficial IU transcript.");
    if (transcript) {
      const problem = validateTranscriptFile(transcript);
      if (problem) return toast.error(problem);
    }
    const form = new FormData();
    form.set("positionIds", JSON.stringify(Array.from(selected)));
    if (transcript) form.set("transcript", transcript);
    setSubmitting(true);
    try {
      await rushFetch("/api/elections/current/application", { method: "POST", body: form });
      toast.success(mine ? "Application updated." : "Application submitted. The Standards Board will review it.");
      setEditing(false);
      setTranscript(null);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSubmitting(false);
      void queryClient.invalidateQueries({ queryKey: ["elections"] });
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-10">
      <RushPageHeader
        title="Run for Office"
        description={election ? election.name : "Executive board and director elections"}
      />

      {!election || (!applicationsOpen && !mine) ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">No applications open</CardTitle>
            <CardDescription>
              {election
                ? "Applications for this election are closed."
                : "There isn't an election accepting applications right now."}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {mine && !editing ? (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
            <div className="space-y-1.5">
              <CardTitle className="text-base">Your candidacy</CardTitle>
              <CardDescription>
                {mine.source === "manual" ? "Added by the Standards Board." : "Your application."} Each position is reviewed separately.
              </CardDescription>
            </div>
            {applicationsOpen ? (
              <Button size="sm" variant="outline" onClick={startEdit}>
                Update application
              </Button>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="divide-y rounded-lg border">
              {mine.candidacies.map((c) => (
                <li key={c.id} className="space-y-1 px-3 py-2.5 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{positionTitle.get(c.position_id) ?? "Position"}</span>
                    <Badge variant={STATUS_VARIANT[c.status] ?? "outline"}>{CANDIDACY_STATUS_LABELS[c.status]}</Badge>
                  </div>
                  {(c.status === "denied" || c.status === "voided") && c.decision_reason ? (
                    <p className="text-muted-foreground">
                      <span className="font-medium text-foreground">Reason from the Standards Board:</span> {c.decision_reason}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
            <div className="flex items-center gap-2 text-sm">
              <FileText className="h-4 w-4 text-muted-foreground" />
              {mine.has_transcript ? (
                <a className="underline underline-offset-4" href={`/api/elections/candidates/${mine.id}/transcript`} target="_blank" rel="noreferrer">
                  View your transcript
                </a>
              ) : (
                <span className="text-muted-foreground">No transcript on file yet.</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Only you and the Standards Board can see your transcript.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {mine && !editing && mine.candidacies.some((c) => c.status === "approved") && election ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Campaign materials</CardTitle>
            <CardDescription>
              Due {formatEastern(election.submission_deadline)}. Members can review them after the deadline. Failure to
              comply with these requirements will result in a voided candidacy.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MaterialsEditor candidateId={mine.id} />
          </CardContent>
        </Card>
      ) : null}

      {showForm && election ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{mine ? "Update your application" : "Apply to run"}</CardTitle>
            <CardDescription>
              Choose up to {election.max_positions_per_candidate} position
              {election.max_positions_per_candidate === 1 ? "" : "s"}. The Standards Board approves or denies each one.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-medium">Positions</legend>
              {positions.map((p) => {
                const decided = mine?.candidacies.find((c) => c.position_id === p.id && c.status !== "pending");
                return (
                  <label key={p.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selected.has(p.id) || decided?.status === "approved"}
                      disabled={Boolean(decided)}
                      onChange={(e) => toggle(p.id, e.target.checked)}
                    />
                    {p.title}
                    {decided ? (
                      <span className="text-xs text-muted-foreground">({CANDIDACY_STATUS_LABELS[decided.status]})</span>
                    ) : null}
                  </label>
                );
              })}
            </fieldset>

            <div className="space-y-1.5">
              <Label htmlFor="transcript">
                Unofficial IU transcript (PDF){mine?.has_transcript ? " — optional, replaces the one on file" : ""}
              </Label>
              <Input
                id="transcript"
                type="file"
                accept={TRANSCRIPT_ACCEPT}
                onChange={(e) => setTranscript(e.target.files?.[0] ?? null)}
              />
              <p className="text-xs text-muted-foreground">
                Used by the Standards Board to verify eligibility. Only you and the Standards Board can see it.
              </p>
            </div>

            <div className="rounded-lg border bg-muted/40 p-3 text-sm">
              <p className="font-medium">If you&apos;re approved, you&apos;ll submit by {formatEastern(election.submission_deadline)}:</p>
              <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-muted-foreground">
                <li>A written introduction (up to 300 words)</li>
                <li>An initiative video for each position (up to 15 minutes, YouTube or Google Drive link)</li>
                <li>1 to 5 photos of yourself</li>
                <li>Optional: academic awards, projects or employment history</li>
              </ul>
              <p className="mt-2 font-medium">Failure to comply with these requirements will result in a voided candidacy.</p>
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              {mine ? (
                <Button variant="outline" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              ) : null}
              <Button onClick={submit} disabled={submitting}>
                {mine ? "Save changes" : "Submit application"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

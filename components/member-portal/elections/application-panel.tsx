"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, FileText, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dropzone } from "@/components/ui/dropzone";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { MaterialsEditor } from "@/components/member-portal/elections/materials-editor";
import { errorMessage, rushFetch } from "@/lib/rush/client";
import { cn } from "@/lib/utils";
import { formatEastern } from "@/lib/elections/eastern-time";
import { validateTranscriptFile } from "@/lib/elections/uploads";
import {
  CANDIDACY_STATUS_LABELS,
  materialsDeadline,
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

/**
 * A card that can fold away. The content stays mounted while closed so
 * collapsing doesn't lose unsaved materials.
 */
function SectionCard({
  title,
  description,
  action,
  collapsible,
  defaultOpen,
  children,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
  collapsible: boolean;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const expanded = !collapsible || open;
  return (
    <Collapsible open={expanded} onOpenChange={setOpen}>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1 space-y-1.5">
            <CardTitle className="text-base">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          {action}
          {collapsible ? (
            <CollapsibleTrigger asChild>
              <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`${expanded ? "Collapse" : "Expand"} ${title}`}>
                <ChevronDown className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} />
              </Button>
            </CollapsibleTrigger>
          ) : null}
        </CardHeader>
        <CollapsibleContent forceMount className="data-[state=closed]:hidden">
          {children}
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

/**
 * The member's own run: apply or update an application while registration is
 * open, see each position's status, and submit campaign materials. Both cards
 * fold away once registration closes, starting folded when voting opens.
 * Renders nothing for members who aren't running once registration closes.
 */
export function ApplicationPanel() {
  const queryClient = useQueryClient();
  const current = useQuery({
    queryKey: ["elections", "current"],
    queryFn: () => rushFetch<Current>("/api/elections/current"),
  });

  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [transcript, setTranscript] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (current.isPending) return <Skeleton className="h-32" />;
  if (current.error) return null;

  const { election, positions, mine } = current.data;
  if (!election) return null;
  const positionTitle = new Map(positions.map((p) => [p.id, p.title]));
  const applicationsOpen = election.phase === "applications" && !election.candidates_finalized_at;
  if (!applicationsOpen && !mine) return null;

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

  const pickTranscript = (file: File) => {
    const problem = validateTranscriptFile(file);
    if (problem) return toast.error(problem);
    setTranscript(file);
  };

  const submit = async () => {
    if (selected.size === 0) return toast.error("Choose at least one position.");
    if (!mine && !transcript) return toast.error("Attach your unofficial IU transcript.");
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

  if (editing && applicationsOpen) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{mine ? "Update your application" : "Run for office"}</CardTitle>
          <CardDescription>
            Choose the positions you want to run for. The Standards Board approves or denies each one, and your name
            appears here once it&apos;s approved.
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
              Unofficial IU transcript{mine?.has_transcript ? " (optional, replaces the one on file)" : ""}
            </Label>
            {transcript ? (
              <div className="flex items-center gap-2 rounded-lg border p-3 text-sm">
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{transcript.name}</span>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  aria-label="Remove transcript"
                  onClick={() => setTranscript(null)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <Dropzone
                id="transcript"
                accept={{ "application/pdf": [".pdf"] }}
                hint="PDF, up to 4MB"
                rejectMessage="Transcripts must be a PDF."
                onFiles={([file]) => pickTranscript(file)}
              />
            )}
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
            <Button variant="outline" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={submitting}>
              {mine ? "Save changes" : "Submit application"}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!mine) {
    return (
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <p className="font-medium">Want to run for office?</p>
            <p className="text-sm text-muted-foreground">Apply to have the Standards Board add your name to the ballot.</p>
          </div>
          <Button onClick={startEdit}>Apply to run</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <SectionCard
        title="Your candidacy"
        description={`${mine.source === "manual" ? "Added by the Standards Board." : "Your application."} Each position is reviewed separately.`}
        collapsible={!applicationsOpen}
        defaultOpen={election.phase !== "voting"}
        action={
          applicationsOpen ? (
            <Button size="sm" variant="outline" onClick={startEdit}>
              Update application
            </Button>
          ) : null
        }
      >
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
          <p className="text-xs text-muted-foreground">Only you and the Standards Board can see your transcript.</p>
        </CardContent>
      </SectionCard>

      {mine.candidacies.some((c) => c.status === "approved") ? (
        <SectionCard
          title="Campaign materials"
          description={`Due ${formatEastern(materialsDeadline(election, mine.materials_extended_until))}${
            materialsDeadline(election, mine.materials_extended_until) !== election.submission_deadline
              ? " (extended by the Standards Board)"
              : ""
          }. Members can review them after the deadline. Failure to comply with these requirements will result in a voided candidacy.`}
          collapsible={!applicationsOpen}
          defaultOpen={election.phase !== "voting"}
        >
          <CardContent>
            <MaterialsEditor candidateId={mine.id} />
          </CardContent>
        </SectionCard>
      ) : null}
    </>
  );
}

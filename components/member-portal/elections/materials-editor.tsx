"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Circle, FileText, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage, formatDateTime, rushFetch } from "@/lib/rush/client";
import {
  MAX_PHOTOS,
  PHOTO_ACCEPT,
  TRANSCRIPT_ACCEPT,
  validatePhotoFile,
  validateTranscriptFile,
} from "@/lib/elections/uploads";
import {
  INTRO_MAX_WORDS,
  isVideoLink,
  materialsChecklist,
  wordCount,
  type CandidateMaterials,
} from "@/lib/elections/types";

type Draft = { intro: string; awards: string; videos: Record<string, string> };

function toDraft(m: CandidateMaterials): Draft {
  return {
    intro: m.intro,
    awards: m.awards,
    videos: Object.fromEntries(m.seats.map((s) => [s.candidacy_id, s.video_url ?? ""])),
  };
}

/**
 * Campaign materials (Tasks 1-4 and the optional one) for one candidate. The
 * candidate uses it on Run for Office; election managers open it from the
 * Candidates card to fill in or fix materials for them.
 */
export function MaterialsEditor({ candidateId, forManager = false }: { candidateId: string; forManager?: boolean }) {
  const queryClient = useQueryClient();
  const key = ["elections", "materials", candidateId];
  const query = useQuery({
    queryKey: key,
    queryFn: () =>
      rushFetch<{ materials: CandidateMaterials }>(`/api/elections/candidates/${candidateId}/materials`).then((r) => r.materials),
  });
  const materials = query.data;

  const [draft, setDraft] = useState<Draft | null>(null);
  const [synced, setSynced] = useState<CandidateMaterials | null>(null);
  const [busy, setBusy] = useState(false);
  if (materials && materials !== synced) {
    // Take the server's copy unless there are unsaved edits, so a photo or
    // transcript upload (which refetches) doesn't wipe typed text.
    if (!draft || !synced || JSON.stringify(draft) === JSON.stringify(toDraft(synced))) setDraft(toDraft(materials));
    setSynced(materials);
  }

  if (query.isPending || !draft) return <Skeleton className="h-64" />;
  if (query.error || !materials) {
    return <p className="text-sm text-muted-foreground">{errorMessage(query.error, "Couldn't load materials.")}</p>;
  }

  const editable = materials.can_edit;
  const checklist = materialsChecklist({ ...materials, intro: draft.intro, awards: draft.awards });
  const introWords = wordCount(draft.intro);
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(materials));

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: ["elections", "manage"] });
  };

  const withBusy = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(success);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const save = () => {
    if (introWords > INTRO_MAX_WORDS) return toast.error(`Keep the introduction to ${INTRO_MAX_WORDS} words.`);
    const badVideo = Object.values(draft.videos).find((url) => url.trim() && !isVideoLink(url));
    if (badVideo) return toast.error("Initiative videos must be a YouTube or Google Drive link (starting with https://).");
    void withBusy(async () => {
      const result = await rushFetch<{ materials: CandidateMaterials }>(
        `/api/elections/candidates/${candidateId}/materials`,
        { method: "PATCH", json: { intro: draft.intro, awards: draft.awards, videos: draft.videos } },
      );
      // Adopt the saved (trimmed) copy right away.
      queryClient.setQueryData(key, result.materials);
      setDraft(toDraft(result.materials));
      setSynced(result.materials);
    }, "Materials saved.");
  };

  const uploadPhoto = (file: File | undefined) => {
    if (!file) return;
    const problem = validatePhotoFile(file);
    if (problem) return toast.error(problem);
    const form = new FormData();
    form.set("photo", file);
    void withBusy(
      () => rushFetch(`/api/elections/candidates/${candidateId}/photos`, { method: "POST", body: form }),
      "Photo added.",
    );
  };

  const removePhoto = (photoId: string) =>
    withBusy(
      () => rushFetch(`/api/elections/candidates/${candidateId}/photos/${photoId}`, { method: "DELETE" }),
      "Photo removed.",
    );

  const uploadTranscript = (file: File | undefined) => {
    if (!file) return;
    const problem = validateTranscriptFile(file);
    if (problem) return toast.error(problem);
    const form = new FormData();
    form.set("transcript", file);
    void withBusy(
      () => rushFetch(`/api/elections/candidates/${candidateId}/transcript`, { method: "PUT", body: form }),
      "Transcript uploaded.",
    );
  };

  return (
    <div className="space-y-6">
      <div className="space-y-3 rounded-lg border p-3">
        <ul className="space-y-1.5 text-sm">
          {checklist.map((item) => (
            <li key={item.label} className="flex items-center gap-2">
              {item.done ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-label="Done" />
              ) : (
                <Circle className="h-4 w-4 text-muted-foreground" aria-label="Not done" />
              )}
              <span className={item.done ? "" : "text-muted-foreground"}>
                {item.label}
                {item.optional ? " (optional)" : ""}
              </span>
            </li>
          ))}
        </ul>
        {materials.materials_updated_at && materials.edited_by_standards ? (
          <p className="text-xs text-muted-foreground">
            Last edited by the Standards Board on {formatDateTime(materials.materials_updated_at)}.
          </p>
        ) : null}
        {!editable && materials.locked_reason ? (
          <p className="text-sm font-medium">{materials.locked_reason}</p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`intro-${candidateId}`}>1. Written introduction</Label>
        <p className="text-xs text-muted-foreground">
          {forManager ? "Their" : "Your"} background and potential role in KTP.
        </p>
        <Textarea
          id={`intro-${candidateId}`}
          rows={8}
          value={draft.intro}
          disabled={!editable}
          onChange={(e) => setDraft({ ...draft, intro: e.target.value })}
        />
        <p className={`text-xs ${introWords > INTRO_MAX_WORDS ? "text-destructive" : "text-muted-foreground"}`}>
          {introWords} / {INTRO_MAX_WORDS} words
        </p>
      </div>

      <div className="space-y-2">
        <Label>2. Initiative video</Label>
        <p className="text-xs text-muted-foreground">
          Future initiatives for the role and why {forManager ? "they're" : "you're"} the best candidate. Up to 15
          minutes. Paste a YouTube (unlisted is fine) or Google Drive link that anyone in KTP can open.
        </p>
        {materials.seats.length === 0 ? (
          <p className="text-sm text-muted-foreground">No approved positions yet.</p>
        ) : (
          materials.seats.map((seat) => (
            <div key={seat.candidacy_id} className="space-y-1">
              <Label htmlFor={`video-${seat.candidacy_id}`} className="text-xs">
                {seat.title}
              </Label>
              <Input
                id={`video-${seat.candidacy_id}`}
                type="url"
                inputMode="url"
                placeholder="https://youtu.be/…"
                value={draft.videos[seat.candidacy_id] ?? ""}
                disabled={!editable}
                onChange={(e) => setDraft({ ...draft, videos: { ...draft.videos, [seat.candidacy_id]: e.target.value } })}
              />
            </div>
          ))
        )}
      </div>

      <div className="space-y-2">
        <Label>3. Unofficial IU transcript</Label>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <FileText className="h-4 w-4 text-muted-foreground" />
          {materials.has_transcript ? (
            <a
              className="underline underline-offset-4"
              href={`/api/elections/candidates/${candidateId}/transcript`}
              target="_blank"
              rel="noreferrer"
            >
              View transcript
            </a>
          ) : (
            <span className="text-muted-foreground">Not uploaded yet</span>
          )}
        </div>
        {editable ? (
          <Input
            type="file"
            accept={TRANSCRIPT_ACCEPT}
            aria-label={materials.has_transcript ? "Replace transcript" : "Upload transcript"}
            disabled={busy}
            onChange={(e) => {
              uploadTranscript(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        ) : null}
        <p className="text-xs text-muted-foreground">Only the candidate and the Standards Board can see it.</p>
      </div>

      <div className="space-y-2">
        <Label>4. Photos</Label>
        <p className="text-xs text-muted-foreground">At least 1, up to {MAX_PHOTOS}.</p>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {materials.photos.map((photo) => (
            <div key={photo.id} className="relative aspect-square overflow-hidden rounded-md border bg-muted">
              {photo.url ? (
                // Signed URLs from private storage; next/image would need the host configured.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photo.url} alt="" className="h-full w-full object-cover" />
              ) : null}
              {editable ? (
                <Button
                  type="button"
                  size="icon"
                  variant="secondary"
                  className="absolute right-1 top-1 h-7 w-7"
                  aria-label="Remove photo"
                  disabled={busy}
                  onClick={() => removePhoto(photo.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              ) : null}
            </div>
          ))}
        </div>
        {editable && materials.photos.length < MAX_PHOTOS ? (
          <Input
            type="file"
            accept={PHOTO_ACCEPT}
            aria-label="Add a photo"
            disabled={busy}
            onChange={(e) => {
              uploadPhoto(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`awards-${candidateId}`}>Optional: academic awards, projects or employment history</Label>
        <Textarea
          id={`awards-${candidateId}`}
          rows={5}
          value={draft.awards}
          disabled={!editable}
          onChange={(e) => setDraft({ ...draft, awards: e.target.value })}
        />
      </div>

      {editable ? (
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={!dirty || busy} onClick={() => setDraft(toDraft(materials))}>
            Discard changes
          </Button>
          <Button disabled={!dirty || busy} onClick={save}>
            Save
          </Button>
        </div>
      ) : null}
    </div>
  );
}

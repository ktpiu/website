"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage, rushFetch } from "@/lib/rush/client";
import {
  ENDORSEMENT_MAX_WORDS,
  isVideoLink,
  wordCount,
  type EndorsementKind,
  type MyEndorsement,
} from "@/lib/elections/types";

export type EndorseTarget = {
  candidate_id: string;
  candidacy_id: string;
  name: string;
  title: string;
  my_endorsement: MyEndorsement | null;
};

/**
 * Write, edit or withdraw the viewer's one endorsement of a candidate for one
 * role: text (100 words) or a video link (1.5 minutes). Every save goes to the
 * Standards Board for approval. Mount with a `key` per role so the draft resets.
 */
export function EndorseDialog({
  target,
  onClose,
  onChanged,
}: {
  target: EndorseTarget;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [kind, setKind] = useState<EndorsementKind>(target.my_endorsement?.kind ?? "text");
  const [body, setBody] = useState(target.my_endorsement?.body ?? "");
  const [videoUrl, setVideoUrl] = useState(target.my_endorsement?.video_url ?? "");
  const [saving, setSaving] = useState(false);
  const url = `/api/elections/current/candidates/${target.candidate_id}/endorsement?candidacyId=${target.candidacy_id}`;
  const words = wordCount(body);

  const run = async (fn: () => Promise<unknown>, success: string) => {
    setSaving(true);
    try {
      await fn();
      toast.success(success);
      onClose();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
      onChanged();
    }
  };

  const save = () => {
    if (kind === "text") {
      if (!body.trim()) return toast.error("Write your endorsement.");
      if (words > ENDORSEMENT_MAX_WORDS) return toast.error(`Keep it to ${ENDORSEMENT_MAX_WORDS} words.`);
    } else if (!isVideoLink(videoUrl)) {
      return toast.error("Use a YouTube or Google Drive link (starting with https://).");
    }
    void run(
      () => rushFetch(url, { method: "PUT", json: kind === "text" ? { kind, body } : { kind, videoUrl } }),
      "Endorsement sent to the Standards Board for approval.",
    );
  };

  const withdraw = () => {
    if (!window.confirm(`Withdraw your endorsement of ${target.name} for ${target.title}?`)) return;
    void run(() => rushFetch(url, { method: "DELETE" }), "Endorsement withdrawn.");
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Endorse {target.name} for {target.title}</DialogTitle>
          <DialogDescription>
            One endorsement per role. It appears on their profile for this role once the Standards Board approves it and
            registration has closed. Any edit goes back for approval.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex gap-4 text-sm" role="radiogroup" aria-label="Endorsement type">
            {(["text", "video"] as const).map((option) => (
              <label key={option} className="flex items-center gap-2">
                <input type="radio" name="endorsement-kind" checked={kind === option} onChange={() => setKind(option)} />
                {option === "text" ? "Written" : "Video"}
              </label>
            ))}
          </div>
          {kind === "text" ? (
            <div className="space-y-1.5">
              <Label htmlFor="endorsement-body">Endorsement</Label>
              <Textarea id="endorsement-body" rows={6} value={body} onChange={(e) => setBody(e.target.value)} />
              <p className={`text-xs ${words > ENDORSEMENT_MAX_WORDS ? "text-destructive" : "text-muted-foreground"}`}>
                {words} / {ENDORSEMENT_MAX_WORDS} words
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="endorsement-video">Video link</Label>
              <Input
                id="endorsement-video"
                type="url"
                inputMode="url"
                placeholder="https://youtu.be/…"
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Up to 1.5 minutes. YouTube (unlisted is fine) or a Google Drive link anyone in KTP can open.
              </p>
            </div>
          )}
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          {target.my_endorsement ? (
            <Button variant="ghost" onClick={withdraw} disabled={saving}>
              Withdraw
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              Submit for approval
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { NativeSelect } from "@/components/rush/native-select";
import { errorMessage, formatDateTime, rushFetch } from "@/lib/rush/client";
import {
  ENDORSEMENT_STATUS_LABELS,
  type Election,
  type EndorsementStatus,
  type QueuedEndorsement,
} from "@/lib/elections/types";

/** The Standards Board's approval queue. Members only ever see approved endorsements. */
export function EndorsementsPanel({ election }: { election: Election }) {
  const queryClient = useQueryClient();
  const key = ["elections", "manage", election.id, "endorsements"];
  const query = useQuery({
    queryKey: key,
    queryFn: () =>
      rushFetch<{ endorsements: QueuedEndorsement[] }>(`/api/elections/${election.id}/endorsements`).then((r) => r.endorsements),
  });
  const [filter, setFilter] = useState<EndorsementStatus>("pending");
  const [saving, setSaving] = useState<string | null>(null);

  const all = query.data ?? [];
  const shown = all.filter((e) => e.status === filter);
  const pendingCount = all.filter((e) => e.status === "pending").length;

  const review = async (endorsementId: string, status: "approved" | "rejected") => {
    setSaving(endorsementId);
    try {
      await rushFetch(`/api/elections/${election.id}/endorsements`, { method: "PATCH", json: { endorsementId, status } });
      toast.success(status === "approved" ? "Endorsement approved." : "Endorsement rejected.");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(null);
      void queryClient.invalidateQueries({ queryKey: key });
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div className="space-y-1.5">
          <CardTitle className="text-base">Endorsements</CardTitle>
          <CardDescription>
            {pendingCount > 0
              ? `${pendingCount} waiting for approval. Approved endorsements appear on candidate profiles.`
              : "Approved endorsements appear on candidate profiles. Edited ones come back here."}
          </CardDescription>
        </div>
        <NativeSelect
          className="w-44"
          value={filter}
          onChange={(e) => setFilter(e.target.value as EndorsementStatus)}
          aria-label="Show endorsements"
        >
          {(Object.keys(ENDORSEMENT_STATUS_LABELS) as EndorsementStatus[]).map((s) => (
            <option key={s} value={s}>
              {ENDORSEMENT_STATUS_LABELS[s]} ({all.filter((e) => e.status === s).length})
            </option>
          ))}
        </NativeSelect>
      </CardHeader>
      <CardContent>
        {query.isPending ? (
          <Skeleton className="h-24" />
        ) : shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing here.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {shown.map((e) => (
              <li key={e.id} className="space-y-2 px-3 py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p>
                    <span className="font-medium">{e.author.name}</span> endorsing{" "}
                    <span className="font-medium">{e.candidate.name}</span>
                  </p>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{e.kind === "text" ? "Written" : "Video"}</Badge>
                    <span className="text-xs text-muted-foreground">{formatDateTime(e.updated_at)}</span>
                  </div>
                </div>
                {e.kind === "text" ? (
                  <p className="whitespace-pre-wrap text-muted-foreground">{e.body}</p>
                ) : (
                  <a className="break-all underline underline-offset-4" href={e.video_url ?? "#"} target="_blank" rel="noreferrer">
                    {e.video_url}
                  </a>
                )}
                {election.phase !== "closed" ? (
                  <div className="flex justify-end gap-2">
                    {e.status !== "rejected" ? (
                      <Button size="sm" variant="ghost" disabled={saving === e.id} onClick={() => review(e.id, "rejected")}>
                        <X className="mr-1 h-4 w-4" /> Reject
                      </Button>
                    ) : null}
                    {e.status !== "approved" ? (
                      <Button size="sm" variant="outline" disabled={saving === e.id} onClick={() => review(e.id, "approved")}>
                        <Check className="mr-1 h-4 w-4" /> Approve
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

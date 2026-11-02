"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { useElectionBroadcast } from "@/hooks/use-rush-realtime";
import { useAuthStore } from "@/lib/auth-store";
import { canManageElections } from "@/lib/permissions";
import { errorMessage, rushFetch } from "@/lib/rush/client";
import type { ManagerVotingState } from "@/lib/elections/types";

/** Full-screen view for the room: the join code, kept current as it rotates. */
function Projector() {
  const electionId = useSearchParams().get("election");
  const { permissions } = useAuthStore();
  const queryClient = useQueryClient();
  const key = ["elections", "manage", electionId, "voting"];
  const query = useQuery({
    queryKey: key,
    enabled: Boolean(electionId) && canManageElections(permissions),
    queryFn: () => rushFetch<{ voting: ManagerVotingState }>(`/api/elections/${electionId}/voting`).then((r) => r.voting),
  });
  useElectionBroadcast(electionId, () => void queryClient.invalidateQueries({ queryKey: key }));

  if (!canManageElections(permissions)) {
    return <p className="p-8 text-muted-foreground">Only the Standards Board can open the projector view.</p>;
  }
  if (!electionId) return <p className="p-8 text-muted-foreground">Open the projector from Election Management.</p>;
  if (query.isPending) return <Skeleton className="m-8 h-96" />;
  if (query.error || !query.data) return <p className="p-8 text-muted-foreground">{errorMessage(query.error)}</p>;

  const v = query.data;
  const code = v.election.phase === "voting" && v.election.require_join_code ? v.join_code : null;

  return (
    <div className="flex min-h-[80vh] items-center justify-center">
      {code ? (
        <p className="font-mono text-[clamp(4rem,14vw,12rem)] font-bold tracking-[0.2em]">{code}</p>
      ) : (
        <p className="text-3xl text-muted-foreground">No join code right now.</p>
      )}
    </div>
  );
}

export default function ProjectorPage() {
  return (
    <Suspense fallback={<Skeleton className="m-8 h-96" />}>
      <Projector />
    </Suspense>
  );
}

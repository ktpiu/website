"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { ResultsList } from "@/components/member-portal/elections/results-list";
import { useElectionBroadcast } from "@/hooks/use-rush-realtime";
import { useAuthStore } from "@/lib/auth-store";
import { canManageElections } from "@/lib/permissions";
import { errorMessage, rushFetch } from "@/lib/rush/client";
import { ROUND_KIND_LABELS, type ManagerVotingState } from "@/lib/elections/types";

/**
 * Full-screen view for the room: the join code, what's on the ballot and how
 * many ballots are in, then the counts and winners once voting closes.
 */
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
  useElectionBroadcast(electionId, () => void queryClient.invalidateQueries({ queryKey: key }), 10_000);

  if (!canManageElections(permissions)) {
    return <p className="p-8 text-muted-foreground">Only the Standards Board can open the projector view.</p>;
  }
  if (!electionId) return <p className="p-8 text-muted-foreground">Open the projector from Election Management.</p>;
  if (query.isPending) return <Skeleton className="m-8 h-96" />;
  if (query.error || !query.data) return <p className="p-8 text-muted-foreground">{errorMessage(query.error)}</p>;

  const v = query.data;
  const open = v.open_rounds;
  const closed = v.rounds.some((r) => r.status !== "open");

  return (
    <div className="mx-auto flex min-h-[80vh] max-w-6xl flex-col gap-10 py-6">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="text-lg text-muted-foreground">{v.election.name}</p>
          <h1 className="text-4xl font-bold tracking-tight">Chapter voting</h1>
        </div>
        {v.election.phase === "voting" && v.election.require_join_code ? (
          <div className="text-right">
            <p className="text-lg text-muted-foreground">Elections → Vote, then enter</p>
            <p className="font-mono text-7xl font-bold tracking-[0.2em]">{v.join_code}</p>
            <p className="text-lg text-muted-foreground">{v.admitted_count} admitted</p>
          </div>
        ) : null}
      </header>

      {open.length > 0 ? (
        <section className="space-y-6 rounded-2xl border-2 border-primary p-8">
          <p className="text-xl uppercase tracking-wide text-muted-foreground">Voting now</p>
          <ul className="grid gap-x-10 gap-y-4 md:grid-cols-2">
            {open.map((round) => (
              <li key={round.id} className="flex items-baseline justify-between gap-4">
                <span className="text-2xl font-semibold">
                  {round.kind === "initial" ? round.title : `${ROUND_KIND_LABELS[round.kind]}: ${round.title}`}
                </span>
                <span className="text-2xl tabular-nums text-muted-foreground">{round.ballots_cast}</span>
              </li>
            ))}
          </ul>
          {v.election.require_join_code ? (
            <p className="text-2xl text-muted-foreground">{v.admitted_count} admitted</p>
          ) : null}
        </section>
      ) : closed ? (
        <ResultsList results={v.results} rounds={v.rounds} />
      ) : (
        <p className="text-3xl text-muted-foreground">Waiting for voting to open.</p>
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

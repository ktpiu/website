"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { RoundTallies } from "@/components/member-portal/elections/results-list";
import { useElectionBroadcast } from "@/hooks/use-rush-realtime";
import { useAuthStore } from "@/lib/auth-store";
import { canManageElections } from "@/lib/permissions";
import { errorMessage, rushFetch } from "@/lib/rush/client";
import { RESULT_STATUS_LABELS, ROUND_KIND_LABELS, type ManagerVotingState } from "@/lib/elections/types";

/**
 * Full-screen view for the room: the join code, what's being voted on and how
 * many ballots are in, then the counts and winner once the vote closes.
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
  const open = v.open_round;
  const lastClosed = [...v.rounds].reverse().find((r) => r.status !== "open") ?? null;
  const lastResult = lastClosed ? v.results.find((r) => r.position_id === lastClosed.position_id) : null;

  return (
    <div className="mx-auto flex min-h-[80vh] max-w-6xl flex-col gap-10 py-6">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="text-lg text-muted-foreground">{v.election.name}</p>
          <h1 className="text-4xl font-bold tracking-tight">Chapter voting</h1>
        </div>
        {v.election.phase === "voting" ? (
          <div className="text-right">
            <p className="text-lg text-muted-foreground">Elections → Vote, then enter</p>
            <p className="font-mono text-7xl font-bold tracking-[0.2em]">{v.join_code}</p>
            <p className="text-lg text-muted-foreground">{v.admitted_count} admitted</p>
          </div>
        ) : null}
      </header>

      {open ? (
        <section className="space-y-4 rounded-2xl border-2 border-primary p-8">
          <p className="text-xl uppercase tracking-wide text-muted-foreground">{ROUND_KIND_LABELS[open.kind]} now</p>
          <h2 className="text-5xl font-bold">{open.title}</h2>
          <p className="text-2xl">{open.choices.map((c) => c.name).join(" · ")}</p>
          <p className="text-6xl font-bold tabular-nums">
            {open.ballots_cast} <span className="text-3xl font-normal text-muted-foreground">of {v.admitted_count} ballots in</span>
          </p>
        </section>
      ) : lastClosed && lastResult ? (
        <section className="space-y-6 rounded-2xl border p-8">
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <h2 className="text-5xl font-bold">{lastResult.title}</h2>
            {lastResult.status ? <p className="text-2xl text-muted-foreground">{RESULT_STATUS_LABELS[lastResult.status]}</p> : null}
          </div>
          {lastResult.winner ? (
            <p className="text-4xl">
              Winner: <span className="font-bold">{lastResult.winner.name}</span>
            </p>
          ) : lastResult.status === "tied" ? (
            <p className="text-4xl">Tie: {lastResult.tied.map((t) => t.name).join(" and ")}. A runoff is next.</p>
          ) : null}
          <RoundTallies round={lastClosed} large />
        </section>
      ) : (
        <p className="text-3xl text-muted-foreground">Waiting for the first vote.</p>
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

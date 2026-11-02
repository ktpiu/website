"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  RESULT_STATUS_LABELS,
  ROUND_KIND_LABELS,
  type RoundSummary,
  type SeatResult,
} from "@/lib/elections/types";

const RESOLUTION_NOTES: Partial<Record<NonNullable<SeatResult["resolution"]>, string>> = {
  runner_up: "Seat declined by the winner; awarded to the runner-up.",
  runoff: "Decided by a runoff.",
  revote: "Decided by a re-vote.",
};

/** Vote counts for one closed round, most votes first, abstentions last. */
export function RoundTallies({ round, large = false }: { round: RoundSummary; large?: boolean }) {
  if (!round.tallies) return null;
  const top = Math.max(0, ...round.tallies.filter((t) => t.choice !== "abstain").map((t) => t.votes));
  return (
    <ul className={cn("space-y-1", large ? "text-2xl" : "text-sm")}>
      {round.tallies.map((t) => (
        <li key={t.choice} className="flex items-center justify-between gap-3">
          <span className={cn(t.choice === "abstain" && "text-muted-foreground", t.choice !== "abstain" && t.votes === top && top > 0 && "font-semibold")}>
            {t.label}
          </span>
          <span className="tabular-nums">
            {t.votes}
            {t.paper > 0 ? <span className="ml-1 text-xs text-muted-foreground">({t.paper} paper)</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Every seat's standing with the counts of each closed round, in ballot order. */
export function ResultsList({ results, rounds }: { results: SeatResult[]; rounds: RoundSummary[] }) {
  const decided = results.filter((r) => r.status !== null || rounds.some((x) => x.position_id === r.position_id && x.status !== "open"));
  if (decided.length === 0) return <p className="text-sm text-muted-foreground">No votes have closed yet.</p>;
  return (
    <ul className="divide-y rounded-lg border">
      {decided.map((result) => {
        const closed = rounds.filter((r) => r.position_id === result.position_id && r.status !== "open");
        return (
          <li key={result.position_id} className="space-y-2 px-3 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">{result.title}</p>
              {result.status ? (
                <Badge variant={result.status === "final" ? "default" : result.status === "tied" ? "destructive" : "secondary"}>
                  {RESULT_STATUS_LABELS[result.status]}
                </Badge>
              ) : null}
            </div>
            {result.winner ? (
              <p className="text-sm">
                Winner: <span className="font-semibold">{result.winner.name}</span>
              </p>
            ) : result.status === "tied" ? (
              <p className="text-sm">Tied: {result.tied.map((t) => t.name).join(", ")}</p>
            ) : null}
            {result.resolution && RESOLUTION_NOTES[result.resolution] ? (
              <p className="text-xs text-muted-foreground">{RESOLUTION_NOTES[result.resolution]}</p>
            ) : null}
            {closed.map((round) => (
              <div key={round.id} className="space-y-1 rounded-md bg-muted/40 p-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {ROUND_KIND_LABELS[round.kind]} · {round.ballots_cast} online ballot{round.ballots_cast === 1 ? "" : "s"}
                </p>
                <RoundTallies round={round} />
              </div>
            ))}
          </li>
        );
      })}
    </ul>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MonitorPlay, RefreshCw, UserMinus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { PeopleSelector, PersonAvatar } from "@/components/ui/people-selector";
import { ResultsList } from "@/components/member-portal/elections/results-list";
import { useElectionBroadcast } from "@/hooks/use-rush-realtime";
import { errorMessage, rushFetch } from "@/lib/rush/client";
import {
  RESULT_STATUS_LABELS,
  type Election,
  type ElectionMember,
  type ManagerVotingState,
} from "@/lib/elections/types";

/**
 * Voting controls: start voting (every race opens together), the join code,
 * who's admitted, paper ballots, closing voting, ties and runoffs, seat choices
 * for double winners, re-votes, and closing the election.
 */
export function VotingPanel({ election }: { election: Election }) {
  const queryClient = useQueryClient();
  const key = ["elections", "manage", election.id, "voting"];
  const query = useQuery({
    queryKey: key,
    enabled: election.phase === "voting" || election.phase === "closed",
    queryFn: () => rushFetch<{ voting: ManagerVotingState }>(`/api/elections/${election.id}/voting`).then((r) => r.voting),
  });
  const members = useQuery({
    queryKey: ["elections", "manage", election.id, "candidates"],
    enabled: election.phase === "voting",
    queryFn: () =>
      rushFetch<{ members: ElectionMember[] }>(`/api/elections/${election.id}/candidates`),
  });
  useElectionBroadcast(election.phase === "voting" ? election.id : null, () => {
    void queryClient.invalidateQueries({ queryKey: key });
  });

  const [busy, setBusy] = useState(false);
  // Keyed by round, then choice.
  const [paper, setPaper] = useState<Record<string, Record<string, string>>>({});
  const [admitId, setAdmitId] = useState<string[]>([]);

  const act = async (json: Record<string, unknown>, success?: string) => {
    setBusy(true);
    try {
      const result = await rushFetch<{ voting: ManagerVotingState }>(`/api/elections/${election.id}/voting`, {
        method: "POST",
        json,
      });
      queryClient.setQueryData(key, result.voting);
      if (success) toast.success(success);
      return true;
    } catch (error) {
      toast.error(errorMessage(error));
      return false;
    } finally {
      setBusy(false);
      void queryClient.invalidateQueries({ queryKey: ["elections", "manage"] });
    }
  };

  if (election.phase === "setup" || election.phase === "applications") return null;

  if (election.phase === "campaign") {
    const early = new Date(election.submission_deadline) > new Date();
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Voting</CardTitle>
          <CardDescription>
            Starting voting opens every position at once and locks materials and endorsements.
            {election.require_join_code ? " Voters join with a code shown on the projector." : " Any active member can vote from anywhere."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            disabled={busy}
            onClick={() => {
              const warning = early
                ? "The materials deadline hasn't passed yet, so members haven't had their review period. Start voting anyway?"
                : "Start voting for every position? Materials and endorsements lock.";
              if (window.confirm(warning)) void act({ action: "start" }, "Voting started.");
            }}
          >
            Start voting
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (query.isPending || !query.data) return <Skeleton className="h-48" />;
  const v = query.data;
  const live = election.phase === "voting";
  const open = v.open_rounds;
  const usesCode = v.election.require_join_code;
  const openPositions = new Set(open.map((r) => r.position_id));
  const contested = new Set(v.candidacies.map((c) => c.position_id));
  const admitted = v.participants.filter((p) => p.status === "admitted");
  const participantIds = new Set(admitted.map((p) => p.user_id));
  const addable = (members.data?.members ?? []).filter((m) => !participantIds.has(m.id));

  const declinedPositions = new Set(v.candidacies.filter((c) => c.status === "declined").map((c) => c.position_id));

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div className="space-y-1.5">
          <CardTitle className="text-base">Voting</CardTitle>
          <CardDescription>
            {live
              ? "Votes are final and secret: nobody can see who voted for whom. Counts appear when voting closes."
              : "This election is closed."}
          </CardDescription>
        </div>
        {live && usesCode ? (
          <Button asChild size="sm" variant="outline">
            <Link href={`/member-portal/elections/projector?election=${election.id}`} target="_blank">
              <MonitorPlay className="mr-1.5 h-4 w-4" /> Projector view
            </Link>
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-6">
        {live && usesCode ? (
          <div className="flex flex-wrap items-center gap-4 rounded-lg border p-3">
            <div>
              <p className="text-xs text-muted-foreground">Join code</p>
              <p className="font-mono text-3xl font-bold tracking-widest">{v.join_code ?? "—"}</p>
            </div>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => act({ action: "rotate_code" }, "New code.")}>
              <RefreshCw className="mr-1.5 h-4 w-4" /> New code
            </Button>
            <p className="text-sm text-muted-foreground">
              Members open <span className="font-medium text-foreground">Elections → Vote</span> and enter it. {v.admitted_count}{" "}
              admitted.
            </p>
          </div>
        ) : null}

        {live && open.length > 0 ? (
          <div className="space-y-4 rounded-lg border border-primary/40 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">Voting now</p>
              <Button
                disabled={busy}
                onClick={async () => {
                  if (!window.confirm("Close voting for every open position? Results show right away.")) return;
                  if (await act({ action: "close_voting" }, "Voting closed.")) setPaper({});
                }}
              >
                Close voting
              </Button>
            </div>
            {open.map((round) => (
              <div key={round.id} className="space-y-2 border-t pt-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">
                    {round.title}
                    {round.seats > 1 ? ` (${round.seats} seats)` : ""}
                  </p>
                  <Badge variant="secondary">
                    {round.ballots_cast}
                    {usesCode ? ` of ${v.admitted_count}` : ""} ballots in
                  </Badge>
                </div>
                <Label className="text-xs">Paper ballots (hand-counted)</Label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {[...round.choices.map((c) => ({ choice: c.candidacy_id, label: c.name })), { choice: "abstain", label: "Abstain" }].map(
                    (c) => (
                      <label key={c.choice} className="flex items-center gap-2 text-sm">
                        <Input
                          className="w-20"
                          type="number"
                          min={0}
                          inputMode="numeric"
                          value={paper[round.id]?.[c.choice] ?? ""}
                          placeholder="0"
                          onChange={(e) =>
                            setPaper((p) => ({ ...p, [round.id]: { ...p[round.id], [c.choice]: e.target.value } }))
                          }
                        />
                        {c.label}
                      </label>
                    ),
                  )}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    act(
                      {
                        action: "record_paper",
                        roundId: round.id,
                        counts: Object.fromEntries(Object.entries(paper[round.id] ?? {}).map(([k, n]) => [k, Number(n || 0)])),
                      },
                      "Paper ballots saved.",
                    )
                  }
                >
                  Save paper ballots
                </Button>
              </div>
            ))}
          </div>
        ) : null}

        {live && v.pending_selections.length > 0 ? (
          <div className="space-y-2 rounded-lg border p-3">
            <p className="font-medium">Seat choices needed</p>
            {v.pending_selections.map((s) => (
              <div key={s.candidate_id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="min-w-0 flex-1">
                  {s.name} won {s.seats.map((x) => x.title).join(" and ")}. They can choose on their phone, or choose for
                  them:
                </span>
                {s.seats.map((seat) => (
                  <Button
                    key={seat.candidacy_id}
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`${s.name} keeps ${seat.title}? Their other seat goes to the runner-up.`)) {
                        void act(
                          { action: "select_seat", candidateId: s.candidate_id, keepCandidacyId: seat.candidacy_id },
                          "Seat chosen.",
                        );
                      }
                    }}
                  >
                    Keep {seat.title}
                  </Button>
                ))}
              </div>
            ))}
          </div>
        ) : null}

        {live ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">Seats</p>
            <ul className="divide-y rounded-lg border">
              {v.results.map((r) => {
                const hasRound = v.rounds.some((x) => x.position_id === r.position_id);
                return (
                  <li key={r.position_id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 font-medium">{r.title}</span>
                    {r.status ? <Badge variant="outline">{RESULT_STATUS_LABELS[r.status]}</Badge> : null}
                    {!r.status && !hasRound && contested.has(r.position_id) ? (
                      <Button size="sm" disabled={busy} onClick={() => act({ action: "open_round", positionId: r.position_id }, `Voting open: ${r.title}.`)}>
                        Open vote
                      </Button>
                    ) : null}
                    {!openPositions.has(r.position_id) && r.status === "tied" ? (
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => act({ action: "open_round", positionId: r.position_id, kind: "runoff" }, "Runoff open.")}
                      >
                        Start runoff
                      </Button>
                    ) : null}
                    {!openPositions.has(r.position_id) && r.seats === 1 && declinedPositions.has(r.position_id) && r.status !== "tied" && r.resolution !== "revote" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => {
                          const remaining = v.candidacies.filter(
                            (c) => c.position_id === r.position_id && c.status !== "declined",
                          );
                          if (remaining.length === 0) return toast.error("No one is left to vote on.");
                          if (
                            window.confirm(
                              `Re-vote ${r.title} with ${remaining.map((c) => c.name).join(", ")}? This replaces the runner-up result.`,
                            )
                          ) {
                            void act(
                              {
                                action: "open_round",
                                positionId: r.position_id,
                                kind: "revote",
                                candidacyIds: remaining.map((c) => c.candidacy_id),
                              },
                              "Re-vote open.",
                            );
                          }
                        }}
                      >
                        Re-vote
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {live && usesCode ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">Admitted voters ({admitted.length})</p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-64">
                <PeopleSelector
                  options={addable.map((m) => ({ key: m.id, name: m.name, avatar: m.avatar }))}
                  value={admitId}
                  onChange={setAdmitId}
                  loading={members.isPending}
                  placeholder="Admit someone by hand"
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || admitId.length === 0}
                onClick={async () => {
                  if (await act({ action: "admit", userId: admitId[0] }, "Admitted.")) setAdmitId([]);
                }}
              >
                Admit
              </Button>
            </div>
            {admitted.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5">
                {admitted.map((p) => (
                  <li key={p.user_id}>
                    <Badge variant="secondary" className="gap-1 pr-1 pl-1">
                      <PersonAvatar name={p.name} avatar={p.avatar} className="h-5 w-5" />
                      {p.name}
                      <button
                        type="button"
                        className="rounded p-0.5 hover:bg-background"
                        aria-label={`Remove ${p.name} from voting`}
                        disabled={busy}
                        onClick={() => {
                          if (window.confirm(`Remove ${p.name}? They can't vote or rejoin unless you admit them again.`)) {
                            void act({ action: "remove", userId: p.user_id }, "Removed.");
                          }
                        }}
                      >
                        <UserMinus className="h-3 w-3" />
                      </button>
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        <div className="space-y-2">
          <p className="text-sm font-medium">Results</p>
          <ResultsList results={v.results} rounds={v.rounds} />
        </div>

        {live ? (
          <div className="flex justify-end">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                if (window.confirm("Close the election? Results become final and voting ends.")) {
                  void act({ action: "close" }, "Election closed.");
                }
              }}
            >
              Close election
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

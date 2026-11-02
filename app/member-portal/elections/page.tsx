"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { RushPageHeader } from "@/components/member-portal/rush/shared";
import { ApplicationPanel } from "@/components/member-portal/elections/application-panel";
import { EndorseDialog, type EndorseTarget } from "@/components/member-portal/elections/endorse-dialog";
import { errorMessage, initials, rushFetch } from "@/lib/rush/client";
import { formatEastern } from "@/lib/elections/eastern-time";
import {
  electionStage,
  ENDORSEMENT_STATUS_LABELS,
  endorsementsOpen,
  type BallotCandidate,
  type Election,
  type ElectionPosition,
  type MemberVotingState,
} from "@/lib/elections/types";

type Ballot = { election: Election | null; positions: ElectionPosition[]; candidates: BallotCandidate[] };

/**
 * The one Elections tab. During registration: the positions, who's running so
 * far, and the application. After it: the final list and endorsements. Once
 * voting opens: a button to the ballot.
 */
export default function ElectionsPage() {
  const queryClient = useQueryClient();
  const ballot = useQuery({
    queryKey: ["elections", "ballot"],
    queryFn: () => rushFetch<Ballot>("/api/elections/current/candidates"),
  });
  const election = ballot.data?.election ?? null;
  const stage = election ? electionStage(election) : null;
  const voting = useQuery({
    queryKey: ["elections", "vote"],
    enabled: stage === "voting",
    queryFn: () => rushFetch<{ voting: MemberVotingState | null }>("/api/elections/current/voting"),
  });
  const [endorsing, setEndorsing] = useState<EndorseTarget | null>(null);

  if (ballot.isPending || ballot.error) {
    return (
      <div className="mx-auto max-w-5xl space-y-6 pb-10">
        <RushPageHeader title="Elections" />
        {ballot.error ? (
          <Card>
            <CardContent className="text-sm text-muted-foreground">{errorMessage(ballot.error)}</CardContent>
          </Card>
        ) : (
          <Skeleton className="h-48" />
        )}
      </div>
    );
  }

  const { positions, candidates } = ballot.data;
  const canEndorse = election ? endorsementsOpen(election) : false;
  const finalized = Boolean(election?.candidates_finalized_at);
  const ballotDue = (voting.data?.voting?.me.pending_round_ids.length ?? 0) > 0;

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-10">
      <RushPageHeader
        title="Elections"
        description={
          election
            ? election.election_date && stage !== "voting"
              ? `${election.name} · Planned for ${formatEastern(election.election_date)}`
              : election.name
            : "Executive board, director and Standards Board elections"
        }
      />

      {!election ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">No election right now</CardTitle>
            <CardDescription>There isn&apos;t an election underway.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          {stage === "voting" ? (
            <Card className="border-primary">
              <CardContent className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <p className="font-medium">{ballotDue ? "Voting is open" : "Voting"}</p>
                  <p className="text-sm text-muted-foreground">
                    {ballotDue
                      ? "Choose your candidates for every position, then submit your ballot."
                      : "Your ballot is in, or nothing is open right now. Results appear when voting closes."}
                  </p>
                </div>
                <Button asChild size="lg">
                  <Link href="/member-portal/elections/vote">{ballotDue ? "Vote" : "View results"}</Link>
                </Button>
              </CardContent>
            </Card>
          ) : null}

          <ApplicationPanel />

          {stage === "applications" ? (
            <p className="text-sm text-muted-foreground">
              Registration is open. Candidates appear below once the Standards Board approves them, and you can endorse
              them now. Approved endorsements appear after registration closes.
            </p>
          ) : null}

          {positions.map((position) => {
            const running = candidates.filter((c) => c.seats.some((s) => s.position_id === position.id));
            if (finalized && running.length === 0) return null;
            return (
              <section key={position.id} className="space-y-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <h2 className="text-lg font-semibold">{position.title}</h2>
                  {position.seats > 1 ? (
                    <span className="text-sm text-muted-foreground">{position.seats} seats</span>
                  ) : null}
                </div>
                {running.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No candidates yet.</p>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {running.map((candidate) => {
                      const seat = candidate.seats.find((s) => s.position_id === position.id)!;
                      const href = finalized
                        ? `/member-portal/elections/candidates/${candidate.candidate_id}?role=${seat.candidacy_id}`
                        : null;
                      return (
                        <Card key={candidate.candidate_id} className="py-4">
                          <CardContent className="flex items-center gap-3 px-4">
                            <Avatar className="h-12 w-12">
                              {candidate.avatar ? <AvatarImage src={candidate.avatar} alt="" /> : null}
                              <AvatarFallback>{initials(candidate.name)}</AvatarFallback>
                            </Avatar>
                            <div className="min-w-0 flex-1 space-y-1">
                              {href ? (
                                <Link href={href} className="block truncate font-medium hover:underline">
                                  {candidate.name}
                                </Link>
                              ) : (
                                <p className="truncate font-medium">{candidate.name}</p>
                              )}
                              {finalized && seat.endorsement_count > 0 ? (
                                <p className="text-xs text-muted-foreground">
                                  {seat.endorsement_count} endorsement{seat.endorsement_count === 1 ? "" : "s"}
                                </p>
                              ) : null}
                              {seat.my_endorsement ? (
                                <Badge variant="outline" className="max-w-full truncate">
                                  Yours: {ENDORSEMENT_STATUS_LABELS[seat.my_endorsement.status]}
                                </Badge>
                              ) : null}
                            </div>
                            {canEndorse && !candidate.is_me ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  setEndorsing({
                                    candidate_id: candidate.candidate_id,
                                    candidacy_id: seat.candidacy_id,
                                    name: candidate.name,
                                    title: seat.title,
                                    my_endorsement: seat.my_endorsement,
                                  })
                                }
                              >
                                {seat.my_endorsement ? "Edit" : "Endorse"}
                              </Button>
                            ) : null}
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </>
      )}

      {endorsing ? (
        <EndorseDialog
          key={endorsing.candidacy_id}
          target={endorsing}
          onClose={() => setEndorsing(null)}
          onChanged={() => void queryClient.invalidateQueries({ queryKey: ["elections", "ballot"] })}
        />
      ) : null}
    </div>
  );
}

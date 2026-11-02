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
import { EndorseDialog, type EndorseTarget } from "@/components/member-portal/elections/endorse-dialog";
import { errorMessage, initials, rushFetch } from "@/lib/rush/client";
import { formatEastern } from "@/lib/elections/eastern-time";
import {
  electionStage,
  ENDORSEMENT_STATUS_LABELS,
  endorsementsOpen,
  profilesOpen,
  type BallotCandidate,
  type Election,
  type ElectionPosition,
} from "@/lib/elections/types";

type Ballot = { election: Election | null; positions: ElectionPosition[]; candidates: BallotCandidate[] };

export default function ElectionsPage() {
  const queryClient = useQueryClient();
  const ballot = useQuery({
    queryKey: ["elections", "ballot"],
    queryFn: () => rushFetch<Ballot>("/api/elections/current/candidates"),
  });
  const [endorsing, setEndorsing] = useState<EndorseTarget | null>(null);

  if (ballot.isPending) {
    return (
      <div className="mx-auto max-w-5xl space-y-6 pb-10">
        <RushPageHeader title="Elections" />
        <Skeleton className="h-48" />
      </div>
    );
  }
  if (ballot.error) {
    return (
      <div className="mx-auto max-w-5xl space-y-6 pb-10">
        <RushPageHeader title="Elections" />
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">{errorMessage(ballot.error)}</CardContent>
        </Card>
      </div>
    );
  }

  const { election, positions, candidates } = ballot.data;
  const canEndorse = election ? endorsementsOpen(election) : false;
  const canReview = election ? profilesOpen(election) : false;
  const stage = election ? electionStage(election) : null;

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-10">
      <RushPageHeader
        title="Elections"
        description={election ? election.name : "Executive board and director elections"}
      />

      {!election || candidates.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">No candidates yet</CardTitle>
            <CardDescription>
              {election
                ? "Candidates appear here once the Standards Board finalizes the list."
                : "There isn't an election underway right now."}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          {stage === "voting" ? (
            <Card className="border-primary">
              <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6 text-sm">
                <span>Voting is open at chapter.</span>
                <Button asChild size="sm">
                  <Link href="/member-portal/elections/vote">Go to the ballot</Link>
                </Button>
              </CardContent>
            </Card>
          ) : null}

          {stage === "submissions" ? (
            <Card>
              <CardContent className="pt-6 text-sm text-muted-foreground">
                Candidates are preparing their materials, which open for review after{" "}
                {formatEastern(election.submission_deadline)}. You can endorse candidates now; the Standards Board
                approves endorsements before they appear on profiles.
              </CardContent>
            </Card>
          ) : null}

          {positions.map((position) => {
            const running = candidates.filter((c) => c.seats.some((s) => s.position_id === position.id));
            if (running.length === 0) return null;
            return (
              <section key={position.id} className="space-y-3">
                <h2 className="text-lg font-semibold">{position.title}</h2>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {running.map((candidate) => {
                    const href =
                      canReview || candidate.is_me ? `/member-portal/elections/candidates/${candidate.candidate_id}` : null;
                    return (
                      <Card key={candidate.candidate_id}>
                        <CardContent className="flex items-center gap-3 pt-6">
                          <Avatar className="h-12 w-12">
                            {candidate.avatar ? <AvatarImage src={candidate.avatar} alt="" /> : null}
                            <AvatarFallback>{initials(candidate.name)}</AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            {href ? (
                              <Link href={href} className="block truncate font-medium hover:underline">
                                {candidate.name}
                              </Link>
                            ) : (
                              <p className="truncate font-medium">{candidate.name}</p>
                            )}
                            {candidate.seats.length > 1 ? (
                              <p className="truncate text-xs text-muted-foreground">
                                Also running for{" "}
                                {candidate.seats
                                  .filter((s) => s.position_id !== position.id)
                                  .map((s) => s.title)
                                  .join(", ")}
                              </p>
                            ) : null}
                            {candidate.my_endorsement ? (
                              <Badge variant="outline" className="mt-1">
                                Your endorsement: {ENDORSEMENT_STATUS_LABELS[candidate.my_endorsement.status]}
                              </Badge>
                            ) : null}
                          </div>
                          {canEndorse && !candidate.is_me ? (
                            <Button size="sm" variant="outline" onClick={() => setEndorsing(candidate)}>
                              {candidate.my_endorsement ? "Edit" : "Endorse"}
                            </Button>
                          ) : null}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </>
      )}

      {endorsing ? (
        <EndorseDialog
          key={endorsing.candidate_id}
          target={endorsing}
          onClose={() => setEndorsing(null)}
          onChanged={() => void queryClient.invalidateQueries({ queryKey: ["elections", "ballot"] })}
        />
      ) : null}
    </div>
  );
}

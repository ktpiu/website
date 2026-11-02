"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { RushPageHeader } from "@/components/member-portal/rush/shared";
import { ResultsList } from "@/components/member-portal/elections/results-list";
import { useElectionBroadcast } from "@/hooks/use-rush-realtime";
import { errorMessage, rushFetch } from "@/lib/rush/client";
import { ROUND_KIND_LABELS, type Election, type MemberVotingState, type OpenRound } from "@/lib/elections/types";

type Response = { voting: MemberVotingState | null; election: Election | null };

const ABSTAIN = "abstain";

function choiceLabel(round: OpenRound, choice: string) {
  return choice === ABSTAIN ? "Abstain" : (round.choices.find((c) => c.candidacy_id === choice)?.name ?? "");
}

/** The ballot: every open race on one page, submitted together. Votes are final and secret. */
export default function VotePage() {
  const queryClient = useQueryClient();
  const key = ["elections", "vote"];
  const query = useQuery({ queryKey: key, queryFn: () => rushFetch<Response>("/api/elections/current/voting") });
  useElectionBroadcast(query.data?.election?.id, () => void queryClient.invalidateQueries({ queryKey: key }), 10_000);

  const [code, setCode] = useState("");
  // Keyed by round so picks never carry into a runoff.
  const [picks, setPicks] = useState<Record<string, string[]>>({});
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const act = async (json: Record<string, unknown>, success: string) => {
    setBusy(true);
    try {
      const result = await rushFetch<Response>("/api/elections/current/voting", { method: "POST", json });
      queryClient.setQueryData(key, result);
      toast.success(success);
      return true;
    } catch (error) {
      toast.error(errorMessage(error));
      void queryClient.invalidateQueries({ queryKey: key });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const shell = (content: React.ReactNode) => (
    <div className="mx-auto max-w-xl space-y-6 pb-10">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/member-portal/elections">
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Elections
        </Link>
      </Button>
      <RushPageHeader title="Ballot" description={query.data?.election?.name} />
      {content}
    </div>
  );

  if (query.isPending) return shell(<Skeleton className="h-48" />);
  if (query.error) {
    return shell(
      <Card>
        <CardContent className="text-sm text-muted-foreground">{errorMessage(query.error)}</CardContent>
      </Card>,
    );
  }

  const v = query.data.voting;
  if (!v) {
    return shell(
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Voting isn&apos;t open</CardTitle>
          <CardDescription>The Standards Board opens voting at the election.</CardDescription>
        </CardHeader>
      </Card>,
    );
  }

  const pending = v.open_rounds.filter((r) => v.me.pending_round_ids.includes(r.id));
  const picksFor = (round: OpenRound) => picks[round.id] ?? [];
  const complete = pending.length > 0 && pending.every((r) => picksFor(r).length > 0);

  const toggle = (round: OpenRound, choice: string) => {
    const current = picksFor(round);
    let next: string[];
    if (round.seats === 1 || choice === ABSTAIN) next = [choice];
    else if (current.includes(choice)) next = current.filter((c) => c !== choice);
    else next = [...current.filter((c) => c !== ABSTAIN), choice];
    if (next.length > round.seats) return toast.error(`You can choose up to ${round.seats} for ${round.title}.`);
    setPicks((p) => ({ ...p, [round.id]: next }));
  };

  return shell(
    <>
      {!v.me.admitted ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Join voting</CardTitle>
            <CardDescription>Enter the code shown on the screen in the room.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void act({ action: "join", code }, "You're in.").then((ok) => ok && setCode(""));
              }}
            >
              <Label htmlFor="join-code" className="sr-only">
                Join code
              </Label>
              <Input
                id="join-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                autoCapitalize="characters"
                autoComplete="off"
                maxLength={12}
                placeholder="ABC234"
                className="font-mono text-lg tracking-widest"
              />
              <Button type="submit" disabled={busy || code.trim().length === 0}>
                Join
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {v.me.selection ? (
        <Card className="border-primary">
          <CardHeader>
            <CardTitle className="text-base">You won more than one seat</CardTitle>
            <CardDescription>Choose the position you&apos;ll serve in. Your other seats go to the runners-up.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {v.me.selection.seats.map((seat) => (
              <Button
                key={seat.candidacy_id}
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Serve as ${seat.title}? This can't be undone.`)) {
                    void act({ action: "select_seat", keepCandidacyId: seat.candidacy_id }, `You'll serve as ${seat.title}.`);
                  }
                }}
              >
                Serve as {seat.title}
              </Button>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {v.me.admitted ? (
        pending.length > 0 ? (
          <>
            <p className="text-sm text-muted-foreground">
              Your ballot is final once you submit it, and no one can see who you voted for.
            </p>
            {pending.map((round) => {
              const options = [
                ...round.choices.map((c) => ({ id: c.candidacy_id, label: c.name })),
                { id: ABSTAIN, label: "Abstain" },
              ];
              const multi = round.seats > 1;
              return (
                <Card key={round.id}>
                  <CardHeader>
                    <CardTitle className="text-lg">
                      {round.kind === "initial" ? round.title : `${ROUND_KIND_LABELS[round.kind]}: ${round.title}`}
                    </CardTitle>
                    {multi ? <CardDescription>Choose up to {round.seats}.</CardDescription> : null}
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2" role={multi ? "group" : "radiogroup"} aria-label={`Vote for ${round.title}`}>
                      {options.map((c) => {
                        const checked = picksFor(round).includes(c.id);
                        return (
                          <label
                            key={c.id}
                            className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-base ${checked ? "border-primary bg-primary/5" : ""}`}
                          >
                            <input
                              type={multi ? "checkbox" : "radio"}
                              name={`ballot-${round.id}`}
                              checked={checked}
                              onChange={() => toggle(round, c.id)}
                              className="h-4 w-4"
                            />
                            <span className={c.id === ABSTAIN ? "text-muted-foreground" : "font-medium"}>{c.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            <Button className="w-full" size="lg" disabled={!complete || busy} onClick={() => setConfirming(true)}>
              Review ballot
            </Button>
            {!complete ? (
              <p className="text-center text-xs text-muted-foreground">Choose a candidate or Abstain for every position.</p>
            ) : null}
          </>
        ) : (
          <Card>
            <CardContent className="text-sm">
              {v.open_rounds.length > 0 ? (
                <p className="flex items-center gap-2 font-medium">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" /> Your ballot is in.
                </p>
              ) : (
                <p className="text-muted-foreground">Nothing is open to vote on right now. This page updates on its own.</p>
              )}
            </CardContent>
          </Card>
        )
      ) : null}

      <div className="space-y-2">
        <h2 className="text-base font-semibold">Results</h2>
        <ResultsList results={v.results} rounds={v.rounds} />
      </div>

      <Dialog open={confirming && complete} onOpenChange={setConfirming}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Submit your ballot?</DialogTitle>
            <DialogDescription>Votes are final. You can&apos;t change this after you submit.</DialogDescription>
          </DialogHeader>
          <dl className="divide-y rounded-lg border text-sm">
            {pending.map((round) => (
              <div key={round.id} className="px-3 py-2">
                <dt className="text-muted-foreground">{round.title}</dt>
                <dd className="font-medium">{picksFor(round).map((c) => choiceLabel(round, c)).join(", ")}</dd>
              </div>
            ))}
          </dl>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Go back
            </Button>
            <Button
              disabled={busy}
              onClick={async () => {
                const votes = Object.fromEntries(pending.map((r) => [r.id, picksFor(r)]));
                const ok = await act({ action: "vote", votes }, "Ballot submitted.");
                setConfirming(false);
                if (ok) setPicks({});
              }}
            >
              Submit ballot
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>,
  );
}

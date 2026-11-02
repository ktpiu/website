"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";
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
import { ROUND_KIND_LABELS, type Election, type MemberVotingState } from "@/lib/elections/types";

type Response = { voting: MemberVotingState | null; election: Election | null };

/** The phone ballot. Votes are final and secret, like a paper ballot. */
export default function VotePage() {
  const queryClient = useQueryClient();
  const key = ["elections", "vote"];
  const query = useQuery({ queryKey: key, queryFn: () => rushFetch<Response>("/api/elections/current/voting") });
  useElectionBroadcast(query.data?.election?.id, () => void queryClient.invalidateQueries({ queryKey: key }), 10_000);

  const [code, setCode] = useState("");
  // Keyed by round so a pick (even "Abstain") never carries into the next vote.
  const [picked, setPicked] = useState<{ roundId: string; choice: string } | null>(null);
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
      <RushPageHeader title="Vote" description={query.data?.election?.name} />
      {content}
    </div>
  );

  if (query.isPending) return shell(<Skeleton className="h-48" />);
  if (query.error) {
    return shell(
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">{errorMessage(query.error)}</CardContent>
      </Card>,
    );
  }

  const v = query.data.voting;
  if (!v) {
    return shell(
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Voting isn&apos;t open</CardTitle>
          <CardDescription>The Standards Board opens voting at chapter.</CardDescription>
        </CardHeader>
      </Card>,
    );
  }

  const open = v.open_round;
  const choice = open && picked?.roundId === open.id ? picked.choice : null;
  const setChoice = (id: string) => open && setPicked({ roundId: open.id, choice: id });
  const choiceLabel =
    choice === "abstain" ? "Abstain" : (open?.choices.find((c) => c.candidacy_id === choice)?.name ?? "");

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
            <CardDescription>Choose the position you&apos;ll serve in. Your other seat goes to the runner-up.</CardDescription>
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
        open ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                {ROUND_KIND_LABELS[open.kind]}: {open.title}
              </CardTitle>
              <CardDescription>
                {v.me.has_voted ? "Waiting for the vote to close." : "Your vote is final once you submit it, and no one can see who you voted for."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {v.me.has_voted ? (
                <p className="flex items-center gap-2 text-sm font-medium">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" /> Your vote is in.
                </p>
              ) : (
                <div className="space-y-3">
                  <div className="space-y-2" role="radiogroup" aria-label={`Vote for ${open.title}`}>
                    {[...open.choices.map((c) => ({ id: c.candidacy_id, label: c.name })), { id: "abstain", label: "Abstain" }].map(
                      (c) => (
                        <label
                          key={c.id}
                          className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-base ${choice === c.id ? "border-primary bg-primary/5" : ""}`}
                        >
                          <input
                            type="radio"
                            name="ballot"
                            checked={choice === c.id}
                            onChange={() => setChoice(c.id)}
                            className="h-4 w-4"
                          />
                          <span className={c.id === "abstain" ? "text-muted-foreground" : "font-medium"}>{c.label}</span>
                        </label>
                      ),
                    )}
                  </div>
                  <Button className="w-full" size="lg" disabled={!choice || busy} onClick={() => setConfirming(true)}>
                    Review vote
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              You&apos;re in. Waiting for the next vote to open; this page updates on its own.
            </CardContent>
          </Card>
        )
      ) : null}

      <div className="space-y-2">
        <h2 className="text-base font-semibold">Results</h2>
        <ResultsList results={v.results} rounds={v.rounds} />
      </div>

      <Dialog open={confirming && Boolean(open && choice)} onOpenChange={setConfirming}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Submit your vote?</DialogTitle>
            <DialogDescription>
              {open?.title}: <span className="font-semibold text-foreground">{choiceLabel}</span>. Votes are final.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Go back
            </Button>
            <Button
              disabled={busy}
              onClick={async () => {
                if (!open || !choice) return;
                const ok = await act({ action: "vote", roundId: open.id, choice }, "Vote submitted.");
                setConfirming(false);
                if (ok) setPicked(null);
              }}
            >
              Submit vote
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>,
  );
}

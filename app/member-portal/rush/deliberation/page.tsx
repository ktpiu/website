"use client";

import { useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  Hourglass,
  Loader2,
  MonitorPlay,
  Play,
  Search,
  Square,
  UserMinus,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { useAuthStore } from "@/lib/auth-store";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { PnmAvatar } from "@/components/rush/pnm-avatar";
import { CycleSelect, RushPageHeader, useSelectedCycle } from "@/components/member-portal/rush/shared";
import { GroupBadge } from "@/components/member-portal/rush/pnm-badges";
import { VoteBreakdown } from "@/components/member-portal/rush/vote-breakdown";
import { TransitionDialog } from "@/components/member-portal/rush/transition-dialog";
import {
  ApplicationsCard,
  AttendanceCard,
  ResponsesCard,
  type DossierApplication,
  type DossierAttendance,
  type DossierResponses,
} from "@/components/member-portal/rush/dossier-view";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useRushRealtime } from "@/hooks/use-rush-realtime";
import { errorMessage, formatTime, rushFetch } from "@/lib/rush/client";
import { GROUP_LABELS, percent, STAGE_LABELS, type DelibGroup, type RushStage, type VoteChoice } from "@/lib/rush/types";
import { NativeSelect } from "@/components/rush/native-select";
import { LiveIndicator } from "@/components/rush/live-indicator";
import { cn } from "@/lib/utils";

type Round = { id: string; status: "open" | "closed"; yes: number; no: number; abstain: number; openedAt: string; closedAt: string | null };

type Current = {
  session: {
    id: string;
    cycleId: string;
    cycleLabel: string;
    stage: RushStage;
    startedAt: string;
    currentPnmId: string | null;
  } | null;
  isAdmin: boolean;
  myStatus: "requested" | "admitted" | "denied" | "removed" | null;
  admittedCount?: number;
  presenting?: {
    pnm: { id: string; name: string; isIuEmail: boolean; major: string | null; gradYear: number | null; photoUrl: string | null };
    group: DelibGroup | null;
    attendance: DossierAttendance;
    applications: DossierApplication[];
    responses: DossierResponses;
  } | null;
  round?: Round | null;
  myChoice?: VoteChoice | null;
  participants?: Array<{ id: string; userId: string; name: string; avatar: string | null; status: string; requestedAt: string }>;
  pnms?: Array<{
    id: string;
    name: string;
    photoUrl: string | null;
    status: string;
    group: DelibGroup;
    outcome: string | null;
    lastVote: { yes: number; no: number; abstain: number } | null;
  }>;
};

const KEY = ["rush", "deliberation"];

const CHOICES: Array<{ value: VoteChoice; label: string; active: string }> = [
  { value: "yes", label: "Yes", active: "bg-emerald-600 text-white border-emerald-600" },
  { value: "no", label: "No", active: "bg-red-600 text-white border-red-600" },
  { value: "abstain", label: "Abstain", active: "bg-slate-600 text-white border-slate-600" },
];

function useDeliberation() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: KEY,
    queryFn: () => rushFetch<Current>("/api/rush/deliberation/current"),
    placeholderData: keepPreviousData,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: KEY });
  const sessionId = query.data?.session?.id ?? null;

  useRushRealtime({
    key: `delib:${sessionId ?? "none"}`,
    onRefresh: refresh,
    pollMs: 20_000,
    topics: [
      {
        name: `delib-sessions:${sessionId ?? "none"}`,
        setup: (channel, refresh) =>
          channel.on("postgres_changes", { event: "*", schema: "public", table: "delib_sessions" }, refresh),
      },
      ...(sessionId
        ? [
            {
              name: `delib-participants:${sessionId}`,
              setup: (channel: RealtimeChannel, refresh: () => void) =>
                channel.on(
                  "postgres_changes",
                  { event: "*", schema: "public", table: "delib_participants", filter: `session_id=eq.${sessionId}` },
                  refresh,
                ),
            },
            {
              name: `delib-rounds:${sessionId}`,
              setup: (channel: RealtimeChannel, refresh: () => void) =>
                channel.on(
                  "postgres_changes",
                  { event: "*", schema: "public", table: "delib_vote_rounds", filter: `session_id=eq.${sessionId}` },
                  (payload) => {
                    // Tallies arrive in the payload: patch them in place, no refetch.
                    const row = payload.new as {
                      id?: string;
                      status?: "open" | "closed";
                      yes_count?: number;
                      no_count?: number;
                      abstain_count?: number;
                      closed_at?: string | null;
                    };
                    const current = queryClient.getQueryData<Current>(KEY);
                    if (payload.eventType === "UPDATE" && row.id && current?.round?.id === row.id && row.status === current.round.status) {
                      queryClient.setQueryData<Current>(KEY, {
                        ...current,
                        round: {
                          ...current.round,
                          yes: row.yes_count ?? current.round.yes,
                          no: row.no_count ?? current.round.no,
                          abstain: row.abstain_count ?? current.round.abstain,
                        },
                      });
                    } else {
                      refresh();
                    }
                  },
                ),
            },
          ]
        : []),
    ],
  });

  return { query, refresh };
}

async function act(url: string, init: RequestInit & { json?: unknown }, success?: string) {
  try {
    await rushFetch(url, init);
    if (success) toast.success(success);
  } catch (error) {
    toast.error(errorMessage(error));
    throw error;
  }
}

function VotePanel({ data }: { data: Current }) {
  const queryClient = useQueryClient();
  const round = data.round;

  const vote = useMutation({
    mutationFn: (choice: VoteChoice) =>
      rushFetch("/api/rush/deliberation/ballot", { method: "POST", json: { roundId: round!.id, choice } }),
    onMutate: async (choice) => {
      await queryClient.cancelQueries({ queryKey: KEY });
      const previous = queryClient.getQueryData<Current>(KEY);
      if (previous?.round) {
        const tallies = { yes: previous.round.yes, no: previous.round.no, abstain: previous.round.abstain };
        if (previous.myChoice) tallies[previous.myChoice] = Math.max(0, tallies[previous.myChoice] - 1);
        tallies[choice] += 1;
        queryClient.setQueryData<Current>(KEY, { ...previous, myChoice: choice, round: { ...previous.round, ...tallies } });
      }
      return { previous };
    },
    onError: (error, _choice, context) => {
      if (context?.previous) queryClient.setQueryData(KEY, context.previous);
      toast.error(errorMessage(error));
    },
  });

  if (!round) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Discussion in progress. Voting hasn&apos;t started for this PNM.
        </CardContent>
      </Card>
    );
  }

  const total = round.yes + round.no + round.abstain;
  return (
    <Card className={cn(round.status === "open" && "border-primary shadow-sm")}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <span>{round.status === "open" ? "Voting is open" : "Voting closed"}</span>
          {round.status === "open" && data.admittedCount ? (
            <span className="text-xs font-normal text-muted-foreground">
              {total} of {data.admittedCount} voted ({percent(total, data.admittedCount)}%)
            </span>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {round.status === "open" ? (
          <div className="grid grid-cols-3 gap-2">
            {CHOICES.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => vote.mutate(c.value)}
                aria-pressed={data.myChoice === c.value}
                className={cn(
                  "flex h-14 items-center justify-center gap-1.5 rounded-lg border-2 text-base font-semibold transition-colors",
                  data.myChoice === c.value ? c.active : "hover:bg-muted",
                )}
              >
                {data.myChoice === c.value ? <Check className="h-4 w-4" /> : null}
                {c.label}
              </button>
            ))}
          </div>
        ) : null}
        {round.status === "open" ? (
          <p className="text-xs text-muted-foreground">
            {data.myChoice
              ? `Your vote: ${data.myChoice}. You can change it until voting closes.`
              : "You haven't voted yet."}{" "}
            Votes are anonymous. Nobody can see how you voted.
          </p>
        ) : null}
        <VoteBreakdown yes={round.yes} no={round.no} abstain={round.abstain} />
      </CardContent>
    </Card>
  );
}

function Presenting({ data }: { data: Current }) {
  const p = data.presenting;
  if (!p) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
          <MonitorPlay className="h-8 w-8" />
          <p>Waiting for an admin to bring up a PNM…</p>
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-5 pt-6">
          <PnmAvatar name={p.pnm.name} src={p.pnm.photoUrl} className="h-28 w-28 text-2xl" />
          <div className="space-y-2">
            <h2 className="text-3xl font-bold">{p.pnm.name}</h2>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              {p.pnm.major ? <span>{p.pnm.major}</span> : null}
              {p.pnm.gradYear ? <span>· Class of {p.pnm.gradYear}</span> : null}
              {p.group ? <GroupBadge group={p.group} /> : null}
              {!p.pnm.isIuEmail ? (
                <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5" /> non-IU email
                </span>
              ) : null}
            </div>
            <p className="text-sm">
              Attended <span className="font-semibold">{p.attendance.length}</span> event{p.attendance.length === 1 ? "" : "s"}
            </p>
          </div>
        </CardContent>
      </Card>
      <VotePanel data={data} />
      <div className="grid gap-4 lg:grid-cols-2">
        <AttendanceCard attendance={p.attendance} />
        <ApplicationsCard applications={p.applications} />
      </div>
      <ResponsesCard responses={p.responses} />
    </div>
  );
}

function AdminConsole({ data, refresh }: { data: Current; refresh: () => void }) {
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [transitionGroup, setTransitionGroup] = useState<DelibGroup | null>(null);
  const [busy, setBusy] = useState(false);
  const session = data.session!;
  const round = data.round;
  const presentingId = data.presenting?.pnm.id ?? null;
  const voteOpen = round?.status === "open";

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch {
      /* toast already shown */
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const requested = (data.participants ?? []).filter((p) => p.status === "requested");
  const admitted = (data.participants ?? []).filter((p) => p.status === "admitted");
  const pnms = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data.pnms ?? []).filter(
      (p) => (groupFilter === "all" || p.group === groupFilter) && (!q || p.name.toLowerCase().includes(q)),
    );
  }, [data.pnms, search, groupFilter]);
  const groupCounts = (data.pnms ?? []).reduce<Record<string, number>>((acc, p) => {
    acc[p.group] = (acc[p.group] ?? 0) + 1;
    return acc;
  }, {});
  const transitionPnms = transitionGroup ? (data.pnms ?? []).filter((p) => p.group === transitionGroup && !p.outcome) : [];

  return (
    <div className="space-y-4">
      <Card className="border-primary/40">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Controls</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {presentingId ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                {voteOpen ? (
                  <Button
                    disabled={busy}
                    variant="destructive"
                    className="col-span-2"
                    onClick={() => run(() => act("/api/rush/deliberation/rounds/close", { method: "POST" }, "Voting closed."))}
                  >
                    <Square className="mr-1.5 h-4 w-4" /> Close voting
                  </Button>
                ) : (
                  <Button
                    disabled={busy}
                    className="col-span-2"
                    onClick={() => run(() => act("/api/rush/deliberation/rounds", { method: "POST" }, "Voting started."))}
                  >
                    <Play className="mr-1.5 h-4 w-4" /> {round ? "Start a new vote" : "Start vote"}
                  </Button>
                )}
              </div>
              <p className="text-xs font-medium text-muted-foreground">Move {data.presenting!.pnm.name} to</p>
              <div className="grid grid-cols-3 gap-2">
                {(["yes", "no", "come_back"] as DelibGroup[]).map((g) => (
                  <Button
                    key={g}
                    size="sm"
                    variant={data.presenting!.group === g ? "default" : "outline"}
                    disabled={busy}
                    onClick={() =>
                      run(() =>
                        act(
                          `/api/rush/pnms/${presentingId}/group`,
                          { method: "PATCH", json: { cycleId: session.cycleId, group: g } },
                          `Moved to ${GROUP_LABELS[g]}.`,
                        ),
                      )
                    }
                  >
                    {GROUP_LABELS[g]}
                  </Button>
                ))}
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="w-full"
                disabled={busy || voteOpen}
                onClick={() => run(() => act("/api/rush/deliberation/present", { method: "POST", json: { pnmId: null } }))}
              >
                Clear screen
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Pick a PNM below to bring them up on everyone&apos;s screen.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between text-base">
            <span className="flex items-center gap-2">
              <Hourglass className="h-4 w-4" /> Waiting room ({requested.length})
            </span>
            {requested.length > 1 ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  run(() =>
                    act("/api/rush/deliberation/participants", { method: "PATCH", json: { allRequested: true, status: "admitted" } }),
                  )
                }
              >
                Admit all
              </Button>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {requested.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nobody is waiting.</p>
          ) : (
            requested.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm">
                  <PnmAvatar name={p.name} src={p.avatar} className="h-7 w-7" />
                  {p.name}
                  <span className="text-xs text-muted-foreground">{formatTime(p.requestedAt)}</span>
                </span>
                <span className="flex gap-1">
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-8 w-8"
                    aria-label={`Admit ${p.name}`}
                    disabled={busy}
                    onClick={() =>
                      run(() => act("/api/rush/deliberation/participants", { method: "PATCH", json: { ids: [p.id], status: "admitted" } }))
                    }
                  >
                    <UserPlus className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    aria-label={`Deny ${p.name}`}
                    disabled={busy}
                    onClick={() =>
                      run(() => act("/api/rush/deliberation/participants", { method: "PATCH", json: { ids: [p.id], status: "denied" } }))
                    }
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </span>
              </div>
            ))
          )}
          <details className="pt-2">
            <summary className="cursor-pointer text-xs text-muted-foreground">
              <Users className="mr-1 inline h-3.5 w-3.5" /> {admitted.length} admitted
            </summary>
            <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
              {admitted.map((p) => (
                <li key={p.id} className="flex items-center justify-between text-sm">
                  {p.name}
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    aria-label={`Remove ${p.name}`}
                    disabled={busy}
                    onClick={() =>
                      run(() => act("/api/rush/deliberation/participants", { method: "PATCH", json: { ids: [p.id], status: "removed" } }))
                    }
                  >
                    <UserMinus className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          </details>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            PNMs · {STAGE_LABELS[session.stage]}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {(["all", "undecided", "yes", "no", "come_back"] as const).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGroupFilter(g)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs",
                  groupFilter === g ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
                )}
              >
                {g === "all" ? `All (${data.pnms?.length ?? 0})` : `${GROUP_LABELS[g]} (${groupCounts[g] ?? 0})`}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search" className="h-8 pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <ul className="max-h-[420px] space-y-1 overflow-y-auto pr-1">
            {pnms.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  disabled={busy || (voteOpen && p.id !== presentingId)}
                  onClick={() =>
                    run(() => act("/api/rush/deliberation/present", { method: "POST", json: { pnmId: p.id } }))
                  }
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md p-1.5 text-left text-sm transition-colors hover:bg-muted disabled:opacity-50",
                    p.id === presentingId && "bg-primary/10 ring-1 ring-primary",
                  )}
                >
                  <PnmAvatar name={p.name} src={p.photoUrl} className="h-7 w-7" />
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  {p.lastVote ? (
                    <span className="text-[11px] tabular-nums text-muted-foreground">
                      {percent(p.lastVote.yes, p.lastVote.yes + p.lastVote.no + p.lastVote.abstain)}% yes
                    </span>
                  ) : null}
                  <GroupBadge group={p.group} />
                </button>
              </li>
            ))}
          </ul>
          <div className="space-y-2 border-t pt-3">
            <p className="text-xs font-medium text-muted-foreground">Finish this cycle</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setTransitionGroup("yes")} disabled={!groupCounts.yes}>
                Move Yes group…
              </Button>
              <Button size="sm" variant="outline" onClick={() => setTransitionGroup("no")} disabled={!groupCounts.no}>
                Move No group…
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <TransitionDialog
        open={Boolean(transitionGroup)}
        onOpenChange={(open) => !open && setTransitionGroup(null)}
        cycle={{ id: session.cycleId, label: session.cycleLabel }}
        stage={session.stage}
        pnms={transitionPnms}
        onDone={refresh}
      />
    </div>
  );
}

export default function DeliberationPage() {
  const { user } = useAuthStore();
  const { query, refresh } = useDeliberation();
  const { cycle } = useSelectedCycle();
  const [startStage, setStartStage] = useState<RushStage | null>(null);
  const newStage = startStage ?? (cycle?.phase === "closed" ? "closed" : "open");
  const [busy, setBusy] = useState(false);
  const data = query.data;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch {
      /* toast already shown */
    } finally {
      setBusy(false);
      refresh();
    }
  };

  if (query.isPending) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 pt-2">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }
  if (query.error || !data) return <p className="p-6 text-sm text-destructive">{errorMessage(query.error)}</p>;

  const admitted = data.myStatus === "admitted" || data.isAdmin;

  return (
    <div className="mx-auto max-w-7xl pb-10">
      <RushPageHeader
        title="Deliberation"
        description={
          data.session
            ? `${data.session.cycleLabel} ${STAGE_LABELS[data.session.stage].toLowerCase()} · started ${formatTime(data.session.startedAt)}`
            : undefined
        }
        actions={
          data.session ? (
            <>
              <LiveIndicator className="h-3 w-3" />
              {data.isAdmin ? (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm("End this deliberation session for everyone?")) {
                      run(() => act("/api/rush/deliberation/session", { method: "DELETE" }, "Session ended."));
                    }
                  }}
                >
                  End session
                </Button>
              ) : null}
            </>
          ) : null
        }
      />

      {!data.session ? (
        <Card className="mx-auto max-w-lg">
          <CardContent className="space-y-4 py-10 text-center">
            <p className="text-muted-foreground">No deliberation session is running.</p>
            {data.isAdmin ? (
              <div className="flex flex-wrap items-center justify-center gap-2">
                <CycleSelect />
                <NativeSelect
                  className="w-36"
                  value={newStage}
                  onChange={(e) => setStartStage(e.target.value as RushStage)}
                  aria-label="Which rush"
                >
                  <option value="open">Open rush</option>
                  <option value="closed">Closed rush</option>
                </NativeSelect>
                <Button
                  disabled={busy || !cycle}
                  onClick={() =>
                    run(() =>
                      act(
                        "/api/rush/deliberation/session",
                        { method: "POST", json: { cycleId: cycle!.id, stage: newStage } },
                        "Session started.",
                      ),
                    )
                  }
                >
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-1.5 h-4 w-4" />}
                  Start session
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : !admitted ? (
        <Card className="mx-auto max-w-lg">
          <CardContent className="space-y-4 py-10 text-center">
            {data.myStatus === "requested" ? (
              <>
                <Hourglass className="mx-auto h-8 w-8 animate-pulse text-muted-foreground" />
                <p className="font-medium">Waiting to be let in…</p>
                <p className="text-sm text-muted-foreground">
                  A deliberation admin will admit you shortly. This page updates automatically.
                </p>
              </>
            ) : data.myStatus === "removed" ? (
              <p className="text-muted-foreground">You were removed from this session.</p>
            ) : (
              <>
                {data.myStatus === "denied" ? (
                  <p className="text-sm text-muted-foreground">Your last request was declined.</p>
                ) : null}
                <p className="text-muted-foreground">
                  A deliberation for <span className="font-medium text-foreground">{data.session.cycleLabel}</span> is in
                  progress.
                </p>
                <Button
                  disabled={busy}
                  onClick={() => run(() => act("/api/rush/deliberation/join", { method: "POST" }))}
                >
                  Request to join{user?.name ? ` as ${user.name.split(" ")[0]}` : ""}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      ) : data.isAdmin ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Presenting data={data} />
          <div className="lg:sticky lg:top-0 lg:self-start">
            <AdminConsole data={data} refresh={refresh} />
          </div>
        </div>
      ) : (
        <div className="mx-auto max-w-4xl">
          <Presenting data={data} />
        </div>
      )}
    </div>
  );
}

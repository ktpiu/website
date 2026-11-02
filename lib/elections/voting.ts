import "server-only";
import { randomInt } from "crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getPositions, toElectionError } from "@/lib/elections/server";
import {
  ON_BALLOT_STATUSES,
  type CandidacyStatus,
  type Election,
  type ManagerVotingState,
  type PendingSelection,
  type ResultStatus,
  type RoundSummary,
  type SeatResult,
  type VotingChoice,
  type VotingState,
} from "@/lib/elections/types";

// No 0/O, 1/I/L: the code is read off a projector.
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function newJoinCode() {
  return Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
}

export function normalizeJoinCode(value: unknown) {
  return typeof value === "string" ? value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12) : "";
}

/** Calls an elections RPC, mapping its raised codes to readable errors. */
export async function electionRpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabaseAdmin.rpc(fn, args);
  if (error) throw toElectionError(error);
  return data as T;
}

type CandidacyRow = {
  id: string;
  position_id: string;
  status: CandidacyStatus;
  election_candidates: { id: string; user_id: string; users: { name: string } | null } | null;
};

type RoundRow = {
  id: string;
  position_id: string;
  kind: RoundSummary["kind"];
  status: RoundSummary["status"];
  opened_at: string;
  closed_at: string | null;
};

type ResultRow = {
  position_id: string;
  winner_candidacy_id: string | null;
  status: ResultStatus;
  resolution: SeatResult["resolution"];
  tied_candidacy_ids: string[];
};

/**
 * The shared voting picture: seat results, every round (counts only once a
 * round has closed), the open round's choices and how many ballots are in,
 * and candidates who must pick between two seats. Built only from receipts
 * (who voted) and tallies (how many), which are never joined.
 */
export async function buildVotingState(election: Election): Promise<{
  state: VotingState;
  candidacies: ManagerVotingState["candidacies"];
}> {
  const electionId = election.id;
  const [positions, candidacyRes, roundRes, resultRes, participantRes] = await Promise.all([
    getPositions(electionId),
    supabaseAdmin
      .from("election_candidacies")
      .select("id, position_id, status, election_candidates!inner(id, user_id, election_id, users!election_candidates_user_id_fkey(name))")
      .eq("election_candidates.election_id", electionId),
    supabaseAdmin
      .from("election_rounds")
      .select("id, position_id, kind, status, opened_at, closed_at")
      .eq("election_id", electionId)
      .order("opened_at"),
    supabaseAdmin
      .from("election_results")
      .select("position_id, winner_candidacy_id, status, resolution, tied_candidacy_ids")
      .eq("election_id", electionId),
    supabaseAdmin
      .from("election_participants")
      .select("user_id", { count: "exact", head: true })
      .eq("election_id", electionId)
      .eq("status", "admitted"),
  ]);
  for (const res of [candidacyRes, roundRes, resultRes, participantRes]) if (res.error) throw res.error;

  const candidacyRows = (candidacyRes.data ?? []) as unknown as CandidacyRow[];
  const choiceById = new Map<string, VotingChoice>(
    candidacyRows.map((c) => [
      c.id,
      { candidacy_id: c.id, candidate_id: c.election_candidates?.id ?? "", name: c.election_candidates?.users?.name ?? "" },
    ]),
  );
  const rounds = (roundRes.data ?? []) as RoundRow[];

  const closedIds = rounds.filter((r) => r.status !== "open").map((r) => r.id);
  const [tallyRes, receiptCounts] = await Promise.all([
    closedIds.length
      ? supabaseAdmin
          .from("election_tallies")
          .select("round_id, choice, online_count, paper_count")
          .in("round_id", closedIds)
      : Promise.resolve({ data: [], error: null }),
    Promise.all(
      rounds.map(async (r) => {
        const { count, error } = await supabaseAdmin
          .from("election_vote_receipts")
          .select("user_id", { count: "exact", head: true })
          .eq("round_id", r.id);
        if (error) throw error;
        return [r.id, count ?? 0] as const;
      }),
    ),
  ]);
  if (tallyRes.error) throw tallyRes.error;
  const ballots = new Map(receiptCounts);

  const talliesByRound = new Map<string, RoundSummary["tallies"]>();
  for (const t of (tallyRes.data ?? []) as Array<{ round_id: string; choice: string; online_count: number; paper_count: number }>) {
    const list = talliesByRound.get(t.round_id) ?? [];
    list.push({
      choice: t.choice,
      label: t.choice === "abstain" ? "Abstain" : (choiceById.get(t.choice)?.name ?? "Candidate"),
      online: t.online_count,
      paper: t.paper_count,
      votes: t.online_count + t.paper_count,
    });
    talliesByRound.set(t.round_id, list);
  }
  for (const list of talliesByRound.values()) {
    list!.sort((a, b) => (a.choice === "abstain" ? 1 : b.choice === "abstain" ? -1 : b.votes - a.votes || a.label.localeCompare(b.label)));
  }

  const summaries: RoundSummary[] = rounds.map((r) => ({
    id: r.id,
    position_id: r.position_id,
    kind: r.kind,
    status: r.status,
    opened_at: r.opened_at,
    closed_at: r.closed_at,
    ballots_cast: ballots.get(r.id) ?? 0,
    tallies: r.status === "open" ? null : (talliesByRound.get(r.id) ?? []),
  }));

  const positionTitle = new Map(positions.map((p) => [p.id, p.title]));
  const resultByPosition = new Map(((resultRes.data ?? []) as ResultRow[]).map((r) => [r.position_id, r]));
  const results: SeatResult[] = positions.map((p) => {
    const r = resultByPosition.get(p.id);
    return {
      position_id: p.id,
      title: p.title,
      status: r?.status ?? null,
      resolution: r?.resolution ?? null,
      winner: r?.winner_candidacy_id ? (choiceById.get(r.winner_candidacy_id) ?? null) : null,
      tied: (r?.tied_candidacy_ids ?? []).map((id) => choiceById.get(id)).filter((c): c is VotingChoice => Boolean(c)),
    };
  });

  let openRound: VotingState["open_round"] = null;
  const open = summaries.find((r) => r.status === "open");
  if (open) {
    const { data, error } = await supabaseAdmin
      .from("election_tallies")
      .select("choice")
      .eq("round_id", open.id)
      .neq("choice", "abstain");
    if (error) throw error;
    openRound = {
      ...open,
      title: positionTitle.get(open.position_id) ?? "Position",
      choices: ((data ?? []) as Array<{ choice: string }>)
        .map((t) => choiceById.get(t.choice))
        .filter((c): c is VotingChoice => Boolean(c))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  // Candidates holding two won seats.
  const wonByCandidate = new Map<string, PendingSelection>();
  for (const c of candidacyRows) {
    if (c.status !== "won" || !c.election_candidates) continue;
    const entry = wonByCandidate.get(c.election_candidates.id) ?? {
      candidate_id: c.election_candidates.id,
      user_id: c.election_candidates.user_id,
      name: c.election_candidates.users?.name ?? "",
      seats: [],
    };
    entry.seats.push({ candidacy_id: c.id, position_id: c.position_id, title: positionTitle.get(c.position_id) ?? "Position" });
    wonByCandidate.set(c.election_candidates.id, entry);
  }

  return {
    state: {
      election,
      positions,
      results,
      rounds: summaries,
      open_round: openRound,
      admitted_count: participantRes.count ?? 0,
      pending_selections: Array.from(wonByCandidate.values()).filter((s) => s.seats.length > 1),
    },
    candidacies: candidacyRows
      .filter((c) => (ON_BALLOT_STATUSES as string[]).includes(c.status))
      .map((c) => ({ ...choiceById.get(c.id)!, position_id: c.position_id, status: c.status })),
  };
}

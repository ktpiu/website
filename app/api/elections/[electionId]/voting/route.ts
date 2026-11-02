import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { assertElectionsManagePermission, requireAppAuthContext, type AppAuthContext } from "@/lib/server-auth";
import { readJson, RushError, rushErrorResponse, str } from "@/lib/rush/server";
import { getElection, isActiveMember } from "@/lib/elections/server";
import { buildVotingState, electionRpc, newJoinCode } from "@/lib/elections/voting";
import type { Election, ManagerVotingState } from "@/lib/elections/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ electionId: string }> };

async function managerState(election: Election): Promise<ManagerVotingState> {
  const [{ state, candidacies }, participants, codeRow] = await Promise.all([
    buildVotingState(election),
    supabaseAdmin
      .from("election_participants")
      .select("user_id, status, users!election_participants_user_id_fkey(name)")
      .eq("election_id", election.id),
    supabaseAdmin.from("elections").select("voting_join_code").eq("id", election.id).single(),
  ]);
  if (participants.error) throw participants.error;
  if (codeRow.error) throw codeRow.error;
  return {
    ...state,
    join_code: (codeRow.data as { voting_join_code: string | null }).voting_join_code,
    participants: ((participants.data ?? []) as unknown as Array<{
      user_id: string;
      status: "admitted" | "removed";
      users: { name: string } | null;
    }>)
      .map((p) => ({ user_id: p.user_id, name: p.users?.name ?? "", status: p.status }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    candidacies,
  };
}

/** Voting control state for election managers and the projector. */
export async function GET(_request: Request, { params }: Params) {
  try {
    const context = await requireAppAuthContext();
    assertElectionsManagePermission(context);
    const { electionId } = await params;
    return NextResponse.json({ voting: await managerState(await getElection(electionId)) });
  } catch (error) {
    return rushErrorResponse(error, "Failed to load voting.");
  }
}

async function setPhase(context: AppAuthContext, electionId: string, patch: Record<string, unknown>) {
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("elections")
    .update({ ...patch, updated_by: context.appUser.id, updated_at: now })
    .eq("id", electionId);
  if (error) throw error;
}

/**
 * Runs chapter voting. `action` is one of: start, rotate_code, admit,
 * remove, open_round, record_paper, close_voting, select_seat, close.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const context = await requireAppAuthContext();
    assertElectionsManagePermission(context);
    const { electionId } = await params;
    const election = await getElection(electionId);
    const body = await readJson(request);
    const actor = context.appUser.id;

    switch (body.action) {
      case "start": {
        await electionRpc("election_start_voting", {
          p_election_id: electionId,
          p_join_code: election.require_join_code ? newJoinCode() : null,
          p_user_id: actor,
        });
        break;
      }
      case "rotate_code": {
        if (election.phase !== "voting") throw new RushError(409, "Voting hasn't started.");
        if (!election.require_join_code) throw new RushError(409, "This election doesn't use a join code.");
        await setPhase(context, electionId, {
          voting_join_code: newJoinCode(),
          voting_join_code_set_at: new Date().toISOString(),
        });
        break;
      }
      case "admit":
      case "remove": {
        if (election.phase !== "voting") throw new RushError(409, "Voting hasn't started.");
        const userId = str(body.userId, 64);
        if (!userId) throw new RushError(400, "Choose a member.");
        if (body.action === "admit" && !(await isActiveMember(userId))) {
          throw new RushError(400, "Only active members can vote.");
        }
        const { error } = await supabaseAdmin.from("election_participants").upsert(
          {
            election_id: electionId,
            user_id: userId,
            status: body.action === "admit" ? "admitted" : "removed",
            decided_by: actor,
          },
          { onConflict: "election_id,user_id" },
        );
        if (error) throw error;
        break;
      }
      case "open_round": {
        const kind = body.kind === "runoff" || body.kind === "revote" ? body.kind : "initial";
        const candidacyIds = Array.isArray(body.candidacyIds)
          ? body.candidacyIds.filter((v): v is string => typeof v === "string")
          : null;
        await electionRpc("election_open_round", {
          p_position_id: str(body.positionId, 64),
          p_kind: kind,
          p_candidacy_ids: candidacyIds,
          p_user_id: actor,
        });
        break;
      }
      case "record_paper": {
        const counts: Record<string, number> = {};
        for (const [choice, value] of Object.entries((body.counts ?? {}) as Record<string, unknown>)) {
          const n = Number(value);
          if (!Number.isInteger(n) || n < 0 || n > 1000) throw new RushError(400, "Paper counts must be whole numbers.");
          counts[choice] = n;
        }
        await electionRpc("election_record_paper_counts", { p_round_id: str(body.roundId, 64), p_counts: counts });
        break;
      }
      case "close_voting": {
        await electionRpc("election_close_voting", { p_election_id: electionId, p_user_id: actor });
        break;
      }
      case "select_seat": {
        await electionRpc("election_select_seat", {
          p_candidate_id: str(body.candidateId, 64),
          p_keep_candidacy_id: str(body.keepCandidacyId, 64),
          p_user_id: actor,
        });
        break;
      }
      case "close": {
        if (election.phase !== "voting") throw new RushError(409, "Voting hasn't started.");
        const { state, candidacies } = await buildVotingState(election);
        if (state.open_rounds.length > 0) throw new RushError(409, "Close voting first.");
        // A seat nobody ran for stays vacant rather than blocking the close.
        const contested = new Set(candidacies.map((c) => c.position_id));
        const unsettled = state.results.filter(
          (r) => r.status !== "final" && r.status !== "vacant" && contested.has(r.position_id),
        );
        if (unsettled.length > 0) {
          throw new RushError(409, `Settle every seat first: ${unsettled.map((r) => r.title).join(", ")}.`);
        }
        await setPhase(context, electionId, {
          phase: "closed",
          closed_at: new Date().toISOString(),
          voting_join_code: null,
        });
        break;
      }
      default:
        throw new RushError(400, "Unknown action.");
    }

    return NextResponse.json({ voting: await managerState(await getElection(electionId)) });
  } catch (error) {
    return rushErrorResponse(error, "Failed to update voting.");
  }
}

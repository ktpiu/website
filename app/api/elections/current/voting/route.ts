import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { assertActiveMember, requireAppAuthContext, type AppAuthContext } from "@/lib/server-auth";
import { rateLimit, readJson, RushError, rushErrorResponse, str } from "@/lib/rush/server";
import { getRunningElection } from "@/lib/elections/server";
import { buildVotingState, electionRpc, normalizeJoinCode } from "@/lib/elections/voting";
import type { Election, MemberVotingState } from "@/lib/elections/types";

export const dynamic = "force-dynamic";

async function requireVoting() {
  const election = await getRunningElection();
  if (!election || election.phase !== "voting") throw new RushError(409, "Voting isn't open right now.");
  return election;
}

async function memberState(election: Election, context: AppAuthContext): Promise<MemberVotingState> {
  const userId = context.appUser.id;
  const { state } = await buildVotingState(election);
  const [participant, receipt] = await Promise.all([
    supabaseAdmin
      .from("election_participants")
      .select("status")
      .eq("election_id", election.id)
      .eq("user_id", userId)
      .maybeSingle(),
    state.open_round
      ? supabaseAdmin
          .from("election_vote_receipts")
          .select("user_id")
          .eq("round_id", state.open_round.id)
          .eq("user_id", userId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (participant.error) throw participant.error;
  if (receipt.error) throw receipt.error;
  return {
    ...state,
    me: {
      admitted: participant.data?.status === "admitted",
      has_voted: Boolean(receipt.data),
      selection: state.pending_selections.find((s) => s.user_id === userId) ?? null,
    },
  };
}

/** The phone ballot: the open vote, whether you've voted, and results so far. */
export async function GET() {
  try {
    const context = await requireAppAuthContext();
    assertActiveMember(context);
    const election = await getRunningElection();
    if (!election || election.phase !== "voting") return NextResponse.json({ voting: null, election });
    return NextResponse.json({ voting: await memberState(election, context), election });
  } catch (error) {
    return rushErrorResponse(error, "Failed to load voting.");
  }
}

/**
 * `join` with the code on the projector, `vote` in the open round (final
 * once cast), or `select_seat` when you've won two seats.
 */
export async function POST(request: Request) {
  try {
    const context = await requireAppAuthContext();
    assertActiveMember(context);
    const election = await requireVoting();
    const body = await readJson(request);
    const userId = context.appUser.id;

    switch (body.action) {
      case "join": {
        rateLimit(`election-join:${userId}`, 10, 60_000);
        const { data, error } = await supabaseAdmin
          .from("elections")
          .select("voting_join_code")
          .eq("id", election.id)
          .single();
        if (error) throw error;
        const code = (data as { voting_join_code: string | null }).voting_join_code;
        if (!code || normalizeJoinCode(body.code) !== code) {
          throw new RushError(400, "That code doesn't match the one on the screen.");
        }
        const { data: existing, error: existingError } = await supabaseAdmin
          .from("election_participants")
          .select("status")
          .eq("election_id", election.id)
          .eq("user_id", userId)
          .maybeSingle();
        if (existingError) throw existingError;
        if (existing?.status === "removed") {
          throw new RushError(403, "An election manager removed you from voting. Ask the Standards Board.");
        }
        if (!existing) {
          const { error: insertError } = await supabaseAdmin
            .from("election_participants")
            .insert({ election_id: election.id, user_id: userId, status: "admitted" });
          if (insertError && insertError.code !== "23505") throw insertError;
        }
        break;
      }
      case "vote": {
        const choice = str(body.choice, 64);
        if (!choice) throw new RushError(400, "Choose a candidate or abstain.");
        await electionRpc("election_cast_vote", {
          p_round_id: str(body.roundId, 64),
          p_user_id: userId,
          p_choice: choice,
        });
        break;
      }
      case "select_seat": {
        const { data, error } = await supabaseAdmin
          .from("election_candidates")
          .select("id")
          .eq("election_id", election.id)
          .eq("user_id", userId)
          .maybeSingle();
        if (error) throw error;
        if (!data) throw new RushError(404, "You aren't a candidate in this election.");
        await electionRpc("election_select_seat", {
          p_candidate_id: data.id,
          p_keep_candidacy_id: str(body.keepCandidacyId, 64),
          p_user_id: userId,
        });
        break;
      }
      default:
        throw new RushError(400, "Unknown action.");
    }
    return NextResponse.json({ voting: await memberState(election, context), election });
  } catch (error) {
    return rushErrorResponse(error, "Failed to submit.");
  }
}

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
  const openIds = state.open_rounds.map((r) => r.id);
  const [participant, receipts] = await Promise.all([
    supabaseAdmin
      .from("election_participants")
      .select("status")
      .eq("election_id", election.id)
      .eq("user_id", userId)
      .maybeSingle(),
    openIds.length
      ? supabaseAdmin.from("election_vote_receipts").select("round_id").in("round_id", openIds).eq("user_id", userId)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (participant.error) throw participant.error;
  if (receipts.error) throw receipts.error;
  const voted = new Set(((receipts.data ?? []) as Array<{ round_id: string }>).map((r) => r.round_id));
  return {
    ...state,
    me: {
      admitted: !election.require_join_code || participant.data?.status === "admitted",
      pending_round_ids: openIds.filter((id) => !voted.has(id)),
      selection: state.pending_selections.find((s) => s.user_id === userId) ?? null,
    },
  };
}

/** The ballot: the open races, which you still have to vote in, and results so far. */
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
 * `join` with the code on the projector, `vote` with one ballot covering every
 * open race (final once cast), or `select_seat` when you've won two seats.
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
        if (!election.require_join_code) break;
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
        if (!body.votes || typeof body.votes !== "object" || Array.isArray(body.votes)) {
          throw new RushError(400, "Choose a candidate or abstain for each position.");
        }
        await electionRpc("election_cast_ballot", {
          p_election_id: election.id,
          p_user_id: userId,
          p_votes: body.votes,
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

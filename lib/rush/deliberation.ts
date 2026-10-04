import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { RushError } from "@/lib/rush/server";

export type DelibSession = {
  id: string;
  cycle_id: string;
  stage: "open" | "closed";
  status: "active" | "ended";
  started_by: string | null;
  started_at: string;
  current_pnm_id: string | null;
  current_round_id: string | null;
};

export type ParticipantStatus = "requested" | "admitted" | "denied" | "removed";

export async function getActiveSession(): Promise<DelibSession | null> {
  const { data, error } = await supabaseAdmin
    .from("delib_sessions")
    .select("*")
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  return (data as DelibSession | null) ?? null;
}

export async function requireActiveSession() {
  const session = await getActiveSession();
  if (!session) throw new RushError(409, "There is no deliberation session running.");
  return session;
}

export async function getParticipantStatus(sessionId: string, userId: string) {
  const { data, error } = await supabaseAdmin
    .from("delib_participants")
    .select("status")
    .eq("session_id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return ((data as { status: ParticipantStatus } | null)?.status ?? null) as ParticipantStatus | null;
}

/** Admins are admitted automatically, so they can vote and see tallies too. */
export async function admitAdmin(sessionId: string, userId: string) {
  const { error } = await supabaseAdmin.from("delib_participants").upsert(
    {
      session_id: sessionId,
      user_id: userId,
      status: "admitted",
      decided_by: userId,
      decided_at: new Date().toISOString(),
    },
    { onConflict: "session_id,user_id" },
  );
  if (error) throw error;
}

export async function getOpenRound(sessionId: string) {
  const { data, error } = await supabaseAdmin
    .from("delib_vote_rounds")
    .select("*")
    .eq("session_id", sessionId)
    .eq("status", "open")
    .maybeSingle();
  if (error) throw error;
  return data as { id: string; pnm_id: string } | null;
}

export async function closeRound(roundId: string) {
  const { error } = await supabaseAdmin.rpc("delib_close_round", { p_round_id: roundId });
  if (error && !error.message?.includes("ROUND_CLOSED")) throw error;
}

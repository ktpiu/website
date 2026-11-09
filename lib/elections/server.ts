import "server-only";
import { randomUUID } from "crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { RushError } from "@/lib/rush/server";
import { easternInputToIso, formatEastern } from "@/lib/elections/eastern-time";
import { validateTranscriptFile } from "@/lib/elections/uploads";
import {
  MAX_SEATS,
  STANDARDS_ROLE_NAME,
  type BallotRole,
  type Candidacy,
  type Election,
  type ElectionPosition,
  type ManagedCandidate,
  type MyCandidacy,
} from "@/lib/elections/types";

export const ELECTIONS_BUCKET = process.env.SUPABASE_ELECTIONS_BUCKET ?? "elections";
const TRANSCRIPT_URL_SECONDS = 60;

// Elections reuse the rush API plumbing: RushError, readJson, str and
// rushErrorResponse are generic.

export async function getElection(electionId: string): Promise<Election> {
  const { data, error } = await supabaseAdmin
    .from("elections")
    .select("*")
    .eq("id", electionId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new RushError(404, "Election not found.");
  return data as Election;
}

export async function getPositions(electionId: string): Promise<ElectionPosition[]> {
  const { data, error } = await supabaseAdmin
    .from("election_positions")
    .select("id, election_id, role_id, title, seats, sort_order, created_at")
    .eq("election_id", electionId)
    .order("sort_order");
  if (error) throw error;
  return (data ?? []) as ElectionPosition[];
}

/** Exec, director and Standards Board roles, in Roles page order (the ballot order). */
export async function getBallotRoles(): Promise<BallotRole[]> {
  const { data, error } = await supabaseAdmin
    .from("roles")
    .select("id, name, type, priority")
    .or(`type.in.(exec,director),name.eq."${STANDARDS_ROLE_NAME}"`)
    .order("priority", { ascending: false })
    .order("name");
  if (error) throw error;
  return ((data ?? []) as Array<{ id: string; name: string; type: string; priority: number }>).map((r) => ({
    id: r.id,
    name: r.name,
    priority: r.priority,
    group: r.name === STANDARDS_ROLE_NAME ? "standards" : r.type === "exec" ? "exec" : "director",
  }));
}

export function parseDeadline(value: unknown): string {
  const iso = typeof value === "string" ? easternInputToIso(value) : null;
  if (!iso) throw new RushError(400, "Enter the submission deadline (Eastern Time).");
  return iso;
}

export function parseElectionDate(value: unknown): string {
  const iso = typeof value === "string" ? easternInputToIso(value) : null;
  if (!iso) throw new RushError(400, "Enter the planned election date (Eastern Time).");
  return iso;
}

/** Materials are reviewed before the election, so they can't be due after it. */
export function assertDatesInOrder(submissionDeadline: string, electionDate: string | null) {
  if (electionDate && new Date(submissionDeadline) > new Date(electionDate)) {
    throw new RushError(400, `Materials must be due before the election (${formatEastern(electionDate)}).`);
  }
}

/** Winners per role, as { roleId: count }; roles left out have one. */
export function parseSeats(value: unknown): Record<string, number> {
  const seats: Record<string, number> = {};
  for (const [roleId, raw] of Object.entries((value ?? {}) as Record<string, unknown>)) {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > MAX_SEATS) {
      throw new RushError(400, `A position can have 1 to ${MAX_SEATS} winners.`);
    }
    seats[roleId] = n;
  }
  return seats;
}

export function parseRoleIds(value: unknown): string[] {
  if (!Array.isArray(value)) throw new RushError(400, "Choose the positions on the ballot.");
  const ids = Array.from(new Set(value.filter((v): v is string => typeof v === "string" && v.length > 0)));
  if (ids.length === 0) throw new RushError(400, "Choose at least one position.");
  return ids;
}

/**
 * Makes the election's seats exactly `roleIds`, ordered like the Roles page.
 * Refuses to drop a seat someone has already applied for.
 */
export async function syncPositions(electionId: string, roleIds: string[], seats: Record<string, number> = {}) {
  const roles = await getBallotRoles();
  const byId = new Map(roles.map((r) => [r.id, r]));
  const unknown = roleIds.filter((id) => !byId.has(id));
  if (unknown.length > 0) throw new RushError(400, "Only executive board, director and Standards Board roles can be on the ballot.");

  const existing = await getPositions(electionId);
  const wanted = new Set(roleIds);
  const removed = existing.filter((p) => !p.role_id || !wanted.has(p.role_id));

  if (removed.length > 0) {
    const { data: taken, error } = await supabaseAdmin
      .from("election_candidacies")
      .select("position_id")
      .in("position_id", removed.map((p) => p.id))
      .limit(1);
    if (error) throw error;
    if (taken && taken.length > 0) {
      const title = removed.find((p) => p.id === taken[0].position_id)?.title ?? "A position";
      throw new RushError(409, `${title} already has applicants, so it can't be removed.`);
    }
    const { error: deleteError } = await supabaseAdmin
      .from("election_positions")
      .delete()
      .in("id", removed.map((p) => p.id));
    if (deleteError) throw deleteError;
  }

  // Existing seats keep their ids: the upsert matches on (election_id, role_id).
  const rows = roles.filter((r) => wanted.has(r.id)).map((role, index) => ({
    election_id: electionId,
    role_id: role.id,
    title: role.name,
    seats: seats[role.id] ?? 1,
    sort_order: index + 1,
  }));
  const { error: upsertError } = await supabaseAdmin
    .from("election_positions")
    .upsert(rows, { onConflict: "election_id,role_id" });
  if (upsertError) throw upsertError;
}

/** Columns members may see. Leaves out the voting join code, which proves a voter is in the room. */
const MEMBER_ELECTION_COLUMNS =
  "id, name, phase, submission_deadline, election_date, require_join_code, candidates_finalized_at, created_at, updated_at, closed_at";

/** The election in applications, campaign or voting, if any (at most one). */
export async function getRunningElection(): Promise<Election | null> {
  const { data, error } = await supabaseAdmin
    .from("elections")
    .select(MEMBER_ELECTION_COLUMNS)
    .in("phase", ["applications", "campaign", "voting"])
    .maybeSingle();
  if (error) throw error;
  return (data as Election | null) ?? null;
}

const DB_ERRORS: Record<string, [number, string]> = {
  POSITION_NOT_IN_ELECTION: [400, "That position isn't part of this election."],
  ROUND_CLOSED: [409, "Voting for this position has closed."],
  NOT_ADMITTED: [403, "You haven't been admitted to vote. Enter the code on the screen."],
  ALREADY_VOTED: [409, "You've already voted for one of these positions. Refresh to see what's left."],
  INCOMPLETE_BALLOT: [409, "The ballot changed. Review it and submit again."],
  TOO_MANY_CHOICES: [400, "You chose more candidates than a position has seats."],
  NOT_CAMPAIGN: [409, "Finalize candidates before starting voting."],
  REVOTE_SINGLE_SEAT: [409, "Re-votes are only for positions with one winner."],
  INVALID_CHOICE: [400, "That isn't one of the choices in this round."],
  NOT_VOTING: [409, "Voting hasn't started."],
  ROUND_ALREADY_OPEN: [409, "This position is already open for voting."],
  ALREADY_DECIDED: [409, "This position has already been voted on."],
  NOT_TIED: [409, "This position isn't tied."],
  NOTHING_TO_REVOTE: [409, "Nobody has declined this seat, so there's nothing to re-vote."],
  NO_CANDIDATES: [409, "There are no candidates left for this position."],
  INVALID_SELECTION: [400, "Choose one of the seats this candidate won."],
  NO_SELECTION_NEEDED: [409, "This candidate holds only one seat."],
  CANDIDATE_NOT_FOUND: [404, "Candidate not found."],
  POSITION_NOT_FOUND: [404, "Position not found."],
  RESULT_NOT_FOUND: [404, "That seat hasn't been decided."],
};

/** Maps errors raised by the elections triggers and functions to RushErrors. */
export function toElectionError(error: { message?: string; code?: string }) {
  const key = Object.keys(DB_ERRORS).find((k) => error.message?.includes(k));
  if (key) return new RushError(DB_ERRORS[key][0], DB_ERRORS[key][1], key);
  return error;
}

export function parsePositionIds(value: unknown, positions: ElectionPosition[]): string[] {
  const list = Array.isArray(value) ? value : [];
  const known = new Set(positions.map((p) => p.id));
  const ids = Array.from(new Set(list.filter((v): v is string => typeof v === "string" && known.has(v))));
  if (ids.length === 0) throw new RushError(400, "Choose at least one position.");
  return ids;
}

type CandidateRow = {
  id: string;
  user_id: string;
  source: "application" | "manual";
  transcript_path: string | null;
  applied_at: string;
  materials_extended_until: string | null;
  election_candidacies: Array<Candidacy & { created_at: string }>;
  users?: { id: string; name: string; email: string; avatar: string | null } | null;
  intro?: string | null;
  election_candidate_photos?: Array<{ count: number }>;
};

const CANDIDACY_COLUMNS = "id, position_id, status, video_url, decision_reason, decided_at, created_at";

function toMyCandidacy(row: CandidateRow): MyCandidacy {
  return {
    id: row.id,
    source: row.source,
    has_transcript: Boolean(row.transcript_path),
    applied_at: row.applied_at,
    materials_extended_until: row.materials_extended_until,
    candidacies: row.election_candidacies
      .slice()
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((c) => ({
        id: c.id,
        position_id: c.position_id,
        status: c.status,
        video_url: c.video_url,
        decision_reason: c.decision_reason,
        decided_at: c.decided_at,
      })),
  };
}

export async function getCandidateRow(electionId: string, userId: string) {
  const { data, error } = await supabaseAdmin
    .from("election_candidates")
    .select(`id, user_id, source, transcript_path, applied_at, materials_extended_until, election_candidacies(${CANDIDACY_COLUMNS})`)
    .eq("election_id", electionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data as CandidateRow | null) ?? null;
}

export async function getMyCandidacy(electionId: string, userId: string): Promise<MyCandidacy | null> {
  const row = await getCandidateRow(electionId, userId);
  return row ? toMyCandidacy(row) : null;
}

export async function listCandidates(electionId: string): Promise<ManagedCandidate[]> {
  const { data, error } = await supabaseAdmin
    .from("election_candidates")
    .select(
      `id, user_id, source, transcript_path, applied_at, materials_extended_until, intro, users!election_candidates_user_id_fkey(id, name, email, avatar), election_candidacies(${CANDIDACY_COLUMNS}), election_candidate_photos(count)`,
    )
    .eq("election_id", electionId)
    .order("applied_at");
  if (error) throw error;
  return ((data ?? []) as unknown as CandidateRow[])
    .filter((row) => row.users)
    .map((row) => ({
      ...toMyCandidacy(row),
      user: row.users!,
      has_intro: Boolean(row.intro?.trim()),
      photo_count: row.election_candidate_photos?.[0]?.count ?? 0,
    }));
}

export async function listActiveMembers() {
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("id, name, email, avatar")
    .eq("account_status", "active")
    .order("name");
  if (error) throw error;
  return data ?? [];
}

export async function isActiveMember(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("id", userId)
    .eq("account_status", "active")
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export async function removeElectionObject(path: string | null | undefined) {
  if (!path) return;
  const { error } = await supabaseAdmin.storage.from(ELECTIONS_BUCKET).remove([path]);
  if (error) console.error("Failed to remove election file:", error);
}

/** Validates and stores a transcript PDF, returning its object path. */
export async function uploadTranscript(electionId: string, userId: string, file: File) {
  const problem = validateTranscriptFile(file);
  if (problem) throw new RushError(400, problem);
  // Sniff the PDF header; the browser-reported type is client-controlled.
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") throw new RushError(400, "Transcripts must be a PDF.");

  const path = `transcripts/${electionId}/${userId}-${Date.now()}-${randomUUID()}.pdf`;
  const { error } = await supabaseAdmin.storage.from(ELECTIONS_BUCKET).upload(path, bytes, {
    contentType: "application/pdf",
    cacheControl: "60",
    upsert: false,
  });
  if (error) throw new Error(error.message || "Failed to upload transcript.");
  return path;
}

/** A short-lived link to a transcript. Callers check who may see it. */
export async function signTranscript(path: string) {
  const { data, error } = await supabaseAdmin.storage
    .from(ELECTIONS_BUCKET)
    .createSignedUrl(path, TRANSCRIPT_URL_SECONDS);
  if (error || !data?.signedUrl) throw new Error(error?.message || "Failed to open the transcript.");
  return data.signedUrl;
}

/**
 * Adds seats to a candidate's run. Each new candidacy starts as `status`
 * (pending for applications, approved when an election manager adds it).
 * Seats they already hold are left alone.
 */
export async function addCandidacies(
  candidateId: string,
  positionIds: string[],
  status: "pending" | "approved",
  decidedBy: string | null,
) {
  const { data: existing, error } = await supabaseAdmin
    .from("election_candidacies")
    .select("position_id")
    .eq("candidate_id", candidateId);
  if (error) throw error;
  const held = new Set((existing ?? []).map((c) => c.position_id as string));
  const fresh = positionIds.filter((id) => !held.has(id));
  for (const positionId of fresh) {
    const { error: insertError } = await supabaseAdmin.from("election_candidacies").insert({
      candidate_id: candidateId,
      position_id: positionId,
      status,
      ...(status === "approved" ? { decided_by: decidedBy, decided_at: new Date().toISOString() } : {}),
    });
    if (insertError) throw toElectionError(insertError);
  }
}

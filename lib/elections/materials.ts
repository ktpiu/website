import "server-only";
import { randomUUID } from "crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { ELECTIONS_MANAGE } from "@/lib/permissions";
import { RushError } from "@/lib/rush/server";
import type { AppAuthContext } from "@/lib/server-auth";
import { ELECTIONS_BUCKET, getElection, getPositions } from "@/lib/elections/server";
import { MAX_PHOTOS, PHOTO_TYPES, sniffPhotoType, validatePhotoFile } from "@/lib/elections/uploads";
import type { CandidateMaterials, CandidatePhoto, Election } from "@/lib/elections/types";

const PHOTO_URL_SECONDS = 60 * 60;

type MaterialsRow = {
  id: string;
  election_id: string;
  user_id: string;
  intro: string | null;
  awards: string | null;
  transcript_path: string | null;
  materials_updated_at: string | null;
  materials_updated_by: string | null;
  users: { name: string } | null;
};

export type MaterialsAccess = {
  row: MaterialsRow;
  election: Election;
  isSelf: boolean;
  canEdit: boolean;
  lockedReason: string | null;
};

/**
 * Who may see and change a candidate's materials. The candidate edits while
 * applications or the campaign are open, before the deadline, once at least
 * one seat is approved. Election managers edit until voting starts, deadline
 * or not. Anyone else gets a 404.
 */
export async function getMaterialsAccess(candidateId: string, context: AppAuthContext): Promise<MaterialsAccess> {
  const { data, error } = await supabaseAdmin
    .from("election_candidates")
    .select(
      "id, election_id, user_id, intro, awards, transcript_path, materials_updated_at, materials_updated_by, users!election_candidates_user_id_fkey(name)",
    )
    .eq("id", candidateId)
    .maybeSingle();
  if (error) throw error;
  const row = data as unknown as MaterialsRow | null;
  const isSelf = row?.user_id === context.appUser.id && context.profile.account_status === "active";
  const isManager = context.permissions.has(ELECTIONS_MANAGE);
  if (!row || (!isSelf && !isManager)) throw new RushError(404, "Candidate not found.");

  const election = await getElection(row.election_id);
  const open = election.phase === "applications" || election.phase === "campaign";
  let lockedReason: string | null = null;
  if (!open) {
    lockedReason = election.phase === "setup" ? "Applications haven't opened yet." : "Materials are locked for voting.";
  } else if (!isManager) {
    const { count, error: countError } = await supabaseAdmin
      .from("election_candidacies")
      .select("id", { count: "exact", head: true })
      .eq("candidate_id", candidateId)
      .eq("status", "approved");
    if (countError) throw countError;
    if (!count) lockedReason = "You can add materials once the Standards Board approves your application.";
    else if (new Date(election.submission_deadline) <= new Date()) lockedReason = "The submission deadline has passed.";
  }
  return { row, election, isSelf, canEdit: lockedReason === null, lockedReason };
}

export function assertCanEdit(access: MaterialsAccess) {
  if (!access.canEdit) throw new RushError(409, access.lockedReason ?? "Materials are locked.");
}

/** Records who made the latest change, shown as "Last edited by Standards Board". */
export async function markMaterialsEdited(candidateId: string, userId: string) {
  const { error } = await supabaseAdmin
    .from("election_candidates")
    .update({ materials_updated_at: new Date().toISOString(), materials_updated_by: userId })
    .eq("id", candidateId);
  if (error) throw error;
}

export async function buildMaterials(access: MaterialsAccess): Promise<CandidateMaterials> {
  const { row } = access;
  const [positions, seats, photos] = await Promise.all([
    getPositions(row.election_id),
    supabaseAdmin
      .from("election_candidacies")
      .select("id, position_id, video_url")
      .eq("candidate_id", row.id)
      .eq("status", "approved"),
    getCandidatePhotos(row.id),
  ]);
  if (seats.error) throw seats.error;
  const order = new Map(positions.map((p) => [p.id, p]));

  return {
    candidate_id: row.id,
    name: row.users?.name ?? "",
    intro: row.intro ?? "",
    awards: row.awards ?? "",
    has_transcript: Boolean(row.transcript_path),
    photos,
    seats: ((seats.data ?? []) as Array<{ id: string; position_id: string; video_url: string | null }>)
      .sort((a, b) => (order.get(a.position_id)?.sort_order ?? 0) - (order.get(b.position_id)?.sort_order ?? 0))
      .map((s) => ({
        candidacy_id: s.id,
        position_id: s.position_id,
        title: order.get(s.position_id)?.title ?? "Position",
        video_url: s.video_url,
      })),
    materials_updated_at: row.materials_updated_at,
    edited_by_standards: Boolean(row.materials_updated_by && row.materials_updated_by !== row.user_id),
    can_edit: access.canEdit,
    locked_reason: access.lockedReason,
  };
}

/** A candidate's photos in order, as short-lived signed URLs. */
export async function getCandidatePhotos(candidateId: string): Promise<CandidatePhoto[]> {
  const { data: rows, error } = await supabaseAdmin
    .from("election_candidate_photos")
    .select("id, path")
    .eq("candidate_id", candidateId)
    .order("sort_order")
    .order("created_at");
  if (error) throw error;
  const photoRows = (rows ?? []) as Array<{ id: string; path: string }>;
  const urls = new Map<string, string>();
  if (photoRows.length > 0) {
    const { data, error: signError } = await supabaseAdmin.storage
      .from(ELECTIONS_BUCKET)
      .createSignedUrls(photoRows.map((p) => p.path), PHOTO_URL_SECONDS);
    if (signError) console.error("Failed to sign candidate photos:", signError);
    for (const item of data ?? []) if (item.path && item.signedUrl) urls.set(item.path, item.signedUrl);
  }
  return photoRows.map((p) => ({ id: p.id, url: urls.get(p.path) ?? null }));
}

/** Stores one candidate photo (at most five; the database enforces it too). */
export async function addCandidatePhoto(candidateId: string, electionId: string, file: File) {
  const problem = validatePhotoFile(file);
  if (problem) throw new RushError(400, problem);
  const { count, error: countError } = await supabaseAdmin
    .from("election_candidate_photos")
    .select("id", { count: "exact", head: true })
    .eq("candidate_id", candidateId);
  if (countError) throw countError;
  if ((count ?? 0) >= MAX_PHOTOS) throw new RushError(409, `You can upload up to ${MAX_PHOTOS} photos.`);

  const bytes = Buffer.from(await file.arrayBuffer());
  const type = sniffPhotoType(bytes);
  if (!type) throw new RushError(400, "Photos must be a JPEG, PNG or WebP image.");

  const path = `photos/${electionId}/${candidateId}/${Date.now()}-${randomUUID()}.${PHOTO_TYPES[type]}`;
  const { error: uploadError } = await supabaseAdmin.storage
    .from(ELECTIONS_BUCKET)
    .upload(path, bytes, { contentType: type, cacheControl: "3600", upsert: false });
  if (uploadError) throw new Error(uploadError.message || "Failed to upload photo.");

  const { error } = await supabaseAdmin
    .from("election_candidate_photos")
    .insert({ candidate_id: candidateId, path, sort_order: count ?? 0 });
  if (error) {
    await supabaseAdmin.storage.from(ELECTIONS_BUCKET).remove([path]);
    if (error.message?.includes("TOO_MANY_PHOTOS")) throw new RushError(409, `You can upload up to ${MAX_PHOTOS} photos.`);
    throw error;
  }
}

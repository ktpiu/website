import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAppAuthContext } from "@/lib/server-auth";
import { readJson, RushError, rushErrorResponse } from "@/lib/rush/server";
import { assertCanEdit, buildMaterials, getMaterialsAccess, markMaterialsEdited } from "@/lib/elections/materials";
import { INTRO_MAX_WORDS, isVideoLink, wordCount } from "@/lib/elections/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ candidateId: string }> };

/** The candidate's materials, for the candidate or an election manager. */
export async function GET(_request: Request, { params }: Params) {
  try {
    const context = await requireAppAuthContext();
    const { candidateId } = await params;
    return NextResponse.json({ materials: await buildMaterials(await getMaterialsAccess(candidateId, context)) });
  } catch (error) {
    return rushErrorResponse(error, "Failed to load materials.");
  }
}

/**
 * Saves any of: `intro` (Task 1, up to 300 words), `awards` (optional Task),
 * and `videos` ({ candidacyId: link }, Task 2, YouTube or Google Drive; an
 * empty string clears one).
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const context = await requireAppAuthContext();
    const { candidateId } = await params;
    const access = await getMaterialsAccess(candidateId, context);
    assertCanEdit(access);
    const body = await readJson(request);

    const patch: Record<string, unknown> = {};
    if ("intro" in body) {
      const intro = typeof body.intro === "string" ? body.intro.trim() : "";
      if (wordCount(intro) > INTRO_MAX_WORDS) throw new RushError(400, `Keep the introduction to ${INTRO_MAX_WORDS} words.`);
      patch.intro = intro || null;
    }
    if ("awards" in body) {
      const awards = typeof body.awards === "string" ? body.awards.trim().slice(0, 5000) : "";
      patch.awards = awards || null;
    }

    const videos: Array<[string, string | null]> = [];
    if ("videos" in body) {
      if (!body.videos || typeof body.videos !== "object" || Array.isArray(body.videos)) {
        throw new RushError(400, "Invalid videos.");
      }
      for (const [candidacyId, value] of Object.entries(body.videos as Record<string, unknown>)) {
        const url = typeof value === "string" ? value.trim().slice(0, 500) : "";
        if (url && !isVideoLink(url)) {
          throw new RushError(400, "Initiative videos must be a YouTube or Google Drive link (starting with https://).");
        }
        videos.push([candidacyId, url || null]);
      }
      if (videos.length > 0) {
        const { data, error } = await supabaseAdmin
          .from("election_candidacies")
          .select("id")
          .eq("candidate_id", candidateId)
          .eq("status", "approved")
          .in("id", videos.map(([id]) => id));
        if (error) throw error;
        if ((data ?? []).length !== videos.length) throw new RushError(400, "Videos can only be added for approved positions.");
      }
    }
    if (Object.keys(patch).length === 0 && videos.length === 0) throw new RushError(400, "Nothing to save.");

    if (Object.keys(patch).length > 0) {
      const { error } = await supabaseAdmin.from("election_candidates").update(patch).eq("id", candidateId);
      if (error) throw error;
    }
    for (const [candidacyId, url] of videos) {
      const { error } = await supabaseAdmin.from("election_candidacies").update({ video_url: url }).eq("id", candidacyId);
      if (error) throw error;
    }
    await markMaterialsEdited(candidateId, context.appUser.id);
    return NextResponse.json({ materials: await buildMaterials(await getMaterialsAccess(candidateId, context)) });
  } catch (error) {
    return rushErrorResponse(error, "Failed to save materials.");
  }
}

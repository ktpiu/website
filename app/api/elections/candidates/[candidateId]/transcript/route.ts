import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAppAuthContext } from "@/lib/server-auth";
import { RushError, rushErrorResponse } from "@/lib/rush/server";
import { ELECTIONS_TRANSCRIPTS_VIEW } from "@/lib/permissions";
import { removeElectionObject, signTranscript, uploadTranscript } from "@/lib/elections/server";
import { assertCanEdit, getMaterialsAccess, markMaterialsEdited } from "@/lib/elections/materials";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ candidateId: string }> };

/**
 * The only way to open a transcript: a 60-second link, for the candidate
 * themself or someone with elections.transcripts.view. Everyone else gets a
 * 404, so the route doesn't reveal who has applied.
 */
export async function GET(_request: Request, { params }: Params) {
  try {
    const context = await requireAppAuthContext();
    const { candidateId } = await params;
    const { data, error } = await supabaseAdmin
      .from("election_candidates")
      .select("user_id, transcript_path")
      .eq("id", candidateId)
      .maybeSingle();
    if (error) throw error;

    const allowed =
      data && (data.user_id === context.appUser.id || context.permissions.has(ELECTIONS_TRANSCRIPTS_VIEW));
    if (!allowed || !data.transcript_path) throw new RushError(404, "Transcript not found.");

    const url = await signTranscript(data.transcript_path as string);
    return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return rushErrorResponse(error, "Failed to open the transcript.");
  }
}

/**
 * Uploads or replaces the transcript (multipart `transcript`), for campaigners
 * added by hand or a corrected file. Same edit window as other materials.
 */
export async function PUT(request: Request, { params }: Params) {
  try {
    const context = await requireAppAuthContext();
    const { candidateId } = await params;
    const access = await getMaterialsAccess(candidateId, context);
    assertCanEdit(access);
    const form = await request.formData().catch(() => null);
    const file = form?.get("transcript");
    if (!(file instanceof File) || file.size === 0) throw new RushError(400, "Choose your transcript PDF.");

    const path = await uploadTranscript(access.row.election_id, access.row.user_id, file);
    const { error } = await supabaseAdmin
      .from("election_candidates")
      .update({ transcript_path: path })
      .eq("id", candidateId);
    if (error) {
      await removeElectionObject(path);
      throw error;
    }
    if (access.row.transcript_path) await removeElectionObject(access.row.transcript_path);
    await markMaterialsEdited(candidateId, context.appUser.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return rushErrorResponse(error, "Failed to upload the transcript.");
  }
}

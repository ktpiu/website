import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAppAuthContext } from "@/lib/server-auth";
import { RushError, rushErrorResponse } from "@/lib/rush/server";
import { assertCanEdit, buildMaterials, getMaterialsAccess, markMaterialsEdited } from "@/lib/elections/materials";
import { removeElectionObject } from "@/lib/elections/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ candidateId: string; photoId: string }> };

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const context = await requireAppAuthContext();
    const { candidateId, photoId } = await params;
    const access = await getMaterialsAccess(candidateId, context);
    assertCanEdit(access);

    const { data, error } = await supabaseAdmin
      .from("election_candidate_photos")
      .delete()
      .eq("id", photoId)
      .eq("candidate_id", candidateId)
      .select("path")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new RushError(404, "Photo not found.");
    await removeElectionObject(data.path as string);
    await markMaterialsEdited(candidateId, context.appUser.id);
    return NextResponse.json({ materials: await buildMaterials(await getMaterialsAccess(candidateId, context)) });
  } catch (error) {
    return rushErrorResponse(error, "Failed to remove the photo.");
  }
}

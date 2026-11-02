import { NextResponse } from "next/server";
import { requireAppAuthContext } from "@/lib/server-auth";
import { RushError, rushErrorResponse } from "@/lib/rush/server";
import {
  addCandidatePhoto,
  assertCanEdit,
  buildMaterials,
  getMaterialsAccess,
  markMaterialsEdited,
} from "@/lib/elections/materials";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ candidateId: string }> };

/** Adds one photo (multipart `photo`). Task 4: 1 to 5 photos. */
export async function POST(request: Request, { params }: Params) {
  try {
    const context = await requireAppAuthContext();
    const { candidateId } = await params;
    const access = await getMaterialsAccess(candidateId, context);
    assertCanEdit(access);
    const form = await request.formData().catch(() => null);
    const photo = form?.get("photo");
    if (!(photo instanceof File) || photo.size === 0) throw new RushError(400, "Choose a photo.");

    await addCandidatePhoto(candidateId, access.row.election_id, photo);
    await markMaterialsEdited(candidateId, context.appUser.id);
    return NextResponse.json({ materials: await buildMaterials(await getMaterialsAccess(candidateId, context)) }, { status: 201 });
  } catch (error) {
    return rushErrorResponse(error, "Failed to upload the photo.");
  }
}

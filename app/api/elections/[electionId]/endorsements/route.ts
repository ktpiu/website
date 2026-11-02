import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { assertElectionsManagePermission, requireAppAuthContext } from "@/lib/server-auth";
import { readJson, RushError, rushErrorResponse, str } from "@/lib/rush/server";
import { getElection } from "@/lib/elections/server";
import type { QueuedEndorsement } from "@/lib/elections/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ electionId: string }> };

type Row = Omit<QueuedEndorsement, "author" | "candidate"> & {
  author: { id: string; name: string } | null;
  election_candidates: { id: string; users: { name: string } | null } | null;
};

async function listEndorsements(electionId: string): Promise<QueuedEndorsement[]> {
  const { data, error } = await supabaseAdmin
    .from("election_endorsements")
    .select(
      "id, kind, body, video_url, status, updated_at, author:users!election_endorsements_author_user_id_fkey(id, name), election_candidates!inner(id, election_id, users!election_candidates_user_id_fkey(name))",
    )
    .eq("election_candidates.election_id", electionId)
    .order("updated_at");
  if (error) throw error;
  return ((data ?? []) as unknown as Row[]).map(({ election_candidates: candidate, author, ...rest }) => ({
    ...rest,
    author: author ?? { id: "", name: "Former member" },
    candidate: { id: candidate?.id ?? "", name: candidate?.users?.name ?? "" },
  }));
}

/** Every endorsement in the election, oldest first, for the approval queue. */
export async function GET(_request: Request, { params }: Params) {
  try {
    const context = await requireAppAuthContext();
    assertElectionsManagePermission(context);
    const { electionId } = await params;
    await getElection(electionId);
    return NextResponse.json({ endorsements: await listEndorsements(electionId) });
  } catch (error) {
    return rushErrorResponse(error, "Failed to load endorsements.");
  }
}

/** Approves or rejects one endorsement. Only approved ones are shown to members. */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const context = await requireAppAuthContext();
    assertElectionsManagePermission(context);
    const { electionId } = await params;
    const election = await getElection(electionId);
    if (election.phase === "closed") throw new RushError(409, "This election is closed.");
    const body = await readJson(request);
    const endorsementId = str(body.endorsementId, 64);
    const status = body.status === "approved" || body.status === "rejected" ? body.status : null;
    if (!endorsementId || !status) throw new RushError(400, "Choose approve or reject.");

    const { data: found, error: findError } = await supabaseAdmin
      .from("election_endorsements")
      .select("id, election_candidates!inner(election_id)")
      .eq("id", endorsementId)
      .eq("election_candidates.election_id", electionId)
      .maybeSingle();
    if (findError) throw findError;
    if (!found) throw new RushError(404, "Endorsement not found.");

    const { error } = await supabaseAdmin
      .from("election_endorsements")
      .update({ status, reviewed_by: context.appUser.id, reviewed_at: new Date().toISOString() })
      .eq("id", endorsementId);
    if (error) throw error;
    return NextResponse.json({ endorsements: await listEndorsements(electionId) });
  } catch (error) {
    return rushErrorResponse(error, "Failed to review the endorsement.");
  }
}

import { NextResponse } from "next/server";
import { assertRushManagePermission, requireAppAuthContext } from "@/lib/server-auth";
import { notifyAccountSetup } from "@/lib/rush/notify";
import { getPnm, RushError, rushErrorResponse } from "@/lib/rush/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ pnmId: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const context = await requireAppAuthContext();
    assertRushManagePermission(context);
    const { pnmId } = await params;
    const pnm = await getPnm(pnmId);
    if (pnm.clerk_user_id) throw new RushError(409, "This PNM already has an account.");
    notifyAccountSetup(pnm, request);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return rushErrorResponse(error, "Failed to send the setup email.");
  }
}

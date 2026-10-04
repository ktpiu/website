import { NextResponse } from "next/server";
import { normalizeEmail } from "@/lib/app-user";
import { clientIp, findPnmByEmail, rateLimit, readJson, rushErrorResponse, str } from "@/lib/rush/server";
import { notifyAccountSetup } from "@/lib/rush/notify";

export const dynamic = "force-dynamic";

/**
 * Emails an account setup link to a PNM who has no password yet. Always
 * answers the same way so it can't be used to discover who is rushing.
 */
export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const email = normalizeEmail(str(body.email, 254));
    rateLimit(`setup:${clientIp(request)}`, 5, 60_000);
    rateLimit(`setup:${email}`, 2, 10 * 60_000);

    const pnm = email ? await findPnmByEmail(email) : null;
    if (pnm && !pnm.clerk_user_id && pnm.status !== "former") notifyAccountSetup(pnm, request);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return rushErrorResponse(error, "Failed to send the setup email.");
  }
}

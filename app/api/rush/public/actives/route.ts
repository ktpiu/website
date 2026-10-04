import { NextResponse } from "next/server";
import { clientIp, getActiveCycle, rateLimit, rushErrorResponse } from "@/lib/rush/server";
import { listActives } from "@/lib/rush/people";

export const dynamic = "force-dynamic";

/**
 * Active member names only (no avatars or contact info), for the people
 * selector on the public application. Only served while applications are open.
 */
export async function GET(request: Request) {
  try {
    rateLimit(`actives:${clientIp(request)}`, 30, 60_000);
    const cycle = await getActiveCycle();
    if (!cycle || cycle.phase !== "open" || !cycle.applications_open) {
      return NextResponse.json({ people: [] });
    }
    const people = (await listActives()).map((p) => ({ ...p, avatar: null }));
    return NextResponse.json({ people });
  } catch (error) {
    return rushErrorResponse(error, "Failed to load members.");
  }
}

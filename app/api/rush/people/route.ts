import { NextResponse } from "next/server";
import { requireAppAuthContext } from "@/lib/server-auth";
import { listPeople } from "@/lib/rush/people";
import { resolveCycleId, rushErrorResponse } from "@/lib/rush/server";
import type { PeopleSource } from "@/lib/rush/types";

export const dynamic = "force-dynamic";

/** Names (and avatars) for the people selector: actives, cycle PNMs, or both. */
export async function GET(request: Request) {
  try {
    await requireAppAuthContext();
    const raw = new URL(request.url).searchParams.get("source");
    const source: PeopleSource = raw === "actives" || raw === "both" ? raw : "pnms";
    const cycleId = await resolveCycleId(request);
    return NextResponse.json({ people: await listPeople(source, cycleId) });
  } catch (error) {
    return rushErrorResponse(error, "Failed to load people.");
  }
}

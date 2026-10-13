import { NextResponse } from "next/server";
import { requireAppAuthContext, RouteAuthError } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

/**
 * Returns the signed-in member's profile and permission keys. Calling this
 * also links (or creates) the Clerk account's public.users row on first
 * sign-in, which is what makes the Clerk session token usable against Supabase
 * RLS. Accounts without member portal access get a 403 whose body carries
 * `status: "rush" | "disaffiliated"` so the client can route them.
 */
export async function GET() {
  try {
    const context = await requireAppAuthContext({ fresh: true });

    return NextResponse.json(
      {
        user: context.profile,
        permissions: Array.from(context.permissions),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof RouteAuthError) {
      return NextResponse.json(error.toResponseBody(), {
        status: error.status,
        headers: { "Cache-Control": "no-store" },
      });
    }

    console.error("Failed to resolve app user:", error);
    return NextResponse.json(
      { error: "Failed to load your portal account." },
      { status: 500 },
    );
  }
}

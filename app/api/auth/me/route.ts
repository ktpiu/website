import { NextResponse } from "next/server";
import { requireAppAuthContext, RouteAuthError } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

/**
 * Returns the signed-in member's profile and permission keys. Calling this
 * also links the Clerk account to its email-matched public.users row on first
 * sign-in, which is what makes the Clerk session token usable against Supabase
 * RLS. Accounts without a profile get a 403 whose body carries
 * `status: "pending" | "denied"` so the client can show the right screen.
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

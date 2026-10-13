import "server-only";
import { NextResponse } from "next/server";
import { RouteAuthError } from "@/lib/server-auth";
import { RushError } from "@/lib/rush/server";

/** Shared catch block for /api/admin/users routes. */
export function adminUsersErrorResponse(error: unknown, fallback: string) {
  if (error instanceof RouteAuthError) {
    return NextResponse.json(error.toResponseBody(), { status: error.status });
  }
  if (error instanceof RushError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error(fallback, error);
  return NextResponse.json(
    { error: error instanceof Error && error.message ? error.message : fallback },
    { status: 500 },
  );
}

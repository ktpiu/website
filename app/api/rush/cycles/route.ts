import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { assertRushManagePermission, requireAppAuthContext } from "@/lib/server-auth";
import { readJson, RushError, rushErrorResponse, optStr } from "@/lib/rush/server";

export const dynamic = "force-dynamic";

/** All cycles, newest first. Any member can list them (for selectors). */
export async function GET() {
  try {
    await requireAppAuthContext();
    const { data, error } = await supabaseAdmin
      .from("rush_cycles")
      .select("*")
      .order("year", { ascending: false })
      .order("term", { ascending: true });
    if (error) throw error;
    return NextResponse.json({ cycles: data ?? [] });
  } catch (error) {
    return rushErrorResponse(error, "Failed to load rush cycles.");
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireAppAuthContext();
    assertRushManagePermission(context);
    const body = await readJson(request);

    const term = body.term === "fall" || body.term === "spring" ? body.term : null;
    const year = Number(body.year);
    if (!term || !Number.isInteger(year) || year < 2000 || year > 2100) {
      throw new RushError(400, "Choose a term and year.");
    }

    const { data, error } = await supabaseAdmin
      .from("rush_cycles")
      .insert({ term, year, starts_on: optStr(body.startsOn, 10), ends_on: optStr(body.endsOn, 10) })
      .select("*")
      .single();
    if (error?.code === "23505") throw new RushError(409, "That rush cycle already exists.");
    if (error) throw error;
    return NextResponse.json({ cycle: data }, { status: 201 });
  } catch (error) {
    return rushErrorResponse(error, "Failed to create the rush cycle.");
  }
}

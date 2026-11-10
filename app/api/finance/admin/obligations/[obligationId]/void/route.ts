import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import {
  assertFinanceEditPermission,
  requireAppAuthContext,
  RouteAuthError,
} from "@/lib/server-auth";

// Voids (or restores) one member's charge. The row stays on record but nothing is owed.
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ obligationId: string }> },
) {
  try {
    const authContext = await requireAppAuthContext();
    assertFinanceEditPermission(authContext);

    const { obligationId } = await context.params;
    const body = (await req.json().catch(() => ({}))) as { void?: unknown };
    const voided = body.void !== false;

    const { data, error } = await supabase
      .from("finance_obligations")
      .update({
        voided_at: voided ? new Date().toISOString() : null,
        voided_by_user_id: voided ? authContext.appUser.id : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", obligationId)
      .select("id")
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: "Obligation not found." }, { status: 404 });
    }

    return NextResponse.json({ ok: true, voided }, { status: 200 });
  } catch (error) {
    if (error instanceof RouteAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to void charge." },
      { status: 500 },
    );
  }
}

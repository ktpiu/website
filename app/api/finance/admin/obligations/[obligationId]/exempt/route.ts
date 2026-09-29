import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import {
  assertFinanceEditPermission,
  requireAppAuthContext,
  RouteAuthError,
} from "@/lib/server-auth";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ obligationId: string }> },
) {
  try {
    const authContext = await requireAppAuthContext();
    assertFinanceEditPermission(authContext);

    const { obligationId } = await context.params;
    const body = (await req.json().catch(() => ({}))) as { exempt?: unknown };
    const exempt = body.exempt !== false;

    const { data, error } = await supabase
      .from("finance_obligations")
      .update({
        exempted_at: exempt ? new Date().toISOString() : null,
        exempted_by_user_id: exempt ? authContext.appUser.id : null,
      })
      .eq("id", obligationId)
      .select("id")
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: "Obligation not found." }, { status: 404 });
    }

    return NextResponse.json({ ok: true, exempt }, { status: 200 });
  } catch (error) {
    if (error instanceof RouteAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update exemption." },
      { status: 500 },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import {
  assertFinanceEditPermission,
  requireAppAuthContext,
  RouteAuthError,
} from "@/lib/server-auth";

// Voids the completed manual payments allocated to this obligation. A manual payment
// split across several charges is voided as a whole. Stripe payments are never touched
// here; they have to be refunded in Stripe.
export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ obligationId: string }> },
) {
  try {
    const authContext = await requireAppAuthContext();
    assertFinanceEditPermission(authContext);

    const { obligationId } = await context.params;

    const allocationsRes = await supabase
      .from("finance_payment_allocations")
      .select("payment_id")
      .eq("obligation_id", obligationId);
    if (allocationsRes.error) throw allocationsRes.error;

    const paymentIds = Array.from(
      new Set((allocationsRes.data ?? []).map((row) => row.payment_id as string)),
    );
    if (paymentIds.length === 0) {
      return NextResponse.json({ error: "No payments to void." }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("finance_payments")
      .update({ status: "voided", updated_at: new Date().toISOString() })
      .in("id", paymentIds)
      .eq("source", "manual")
      .eq("status", "completed")
      .select("id");
    if (error) throw error;

    if (!data || data.length === 0) {
      return NextResponse.json(
        { error: "No manual payments to void. Stripe payments must be refunded in Stripe." },
        { status: 400 },
      );
    }

    return NextResponse.json({ ok: true, voidedCount: data.length }, { status: 200 });
  } catch (error) {
    if (error instanceof RouteAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to void payment." },
      { status: 500 },
    );
  }
}

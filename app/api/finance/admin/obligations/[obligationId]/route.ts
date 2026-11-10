import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import {
  assertFinanceEditPermission,
  requireAppAuthContext,
  RouteAuthError,
} from "@/lib/server-auth";
import { loadPendingCentsByObligation } from "@/lib/finance-server";

// Removes a member from a transaction. Blocked once anything has been paid or is
// processing; void the payment (or the charge) instead.
export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ obligationId: string }> },
) {
  try {
    const authContext = await requireAppAuthContext();
    assertFinanceEditPermission(authContext);

    const { obligationId } = await context.params;

    const [allocationsRes, pendingByObligationId] = await Promise.all([
      supabase
        .from("finance_payment_allocations")
        .select("payment_id, finance_payments!inner(status)")
        .eq("obligation_id", obligationId)
        .eq("finance_payments.status", "completed")
        .limit(1),
      loadPendingCentsByObligation(),
    ]);
    if (allocationsRes.error) throw allocationsRes.error;

    if ((allocationsRes.data ?? []).length > 0 || pendingByObligationId.has(obligationId)) {
      return NextResponse.json(
        { error: "This member has paid toward this charge. Void the payment first." },
        { status: 409 },
      );
    }

    const { data, error } = await supabase
      .from("finance_obligations")
      .delete()
      .eq("id", obligationId)
      .select("id")
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: "Obligation not found." }, { status: 404 });
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    if (error instanceof RouteAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete charge." },
      { status: 500 },
    );
  }
}

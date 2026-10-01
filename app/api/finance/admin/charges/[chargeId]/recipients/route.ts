import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import {
  assertFinanceEditPermission,
  requireAppAuthContext,
  RouteAuthError,
} from "@/lib/server-auth";
import {
  ensureFinanceCustomerForUser,
  loadBasicUsersByIds,
} from "@/lib/finance-server";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ chargeId: string }> },
) {
  try {
    const authContext = await requireAppAuthContext();
    assertFinanceEditPermission(authContext);

    const { chargeId } = await context.params;
    const body = (await req.json().catch(() => ({}))) as { recipients?: unknown };

    const requested = new Map<string, number>();
    if (Array.isArray(body.recipients)) {
      for (const item of body.recipients) {
        if (!item || typeof item !== "object") continue;
        const { userId, amountCents } = item as { userId?: unknown; amountCents?: unknown };
        const cents = Number(amountCents);
        if (typeof userId !== "string" || !Number.isInteger(cents) || cents <= 0) continue;
        requested.set(userId, cents);
      }
    }

    if (requested.size === 0) {
      return NextResponse.json(
        { error: "Choose at least one member with a positive amount." },
        { status: 400 },
      );
    }

    const { data: charge, error: chargeError } = await supabase
      .from("finance_charges")
      .select("id, due_at")
      .eq("id", chargeId)
      .maybeSingle();
    if (chargeError) throw chargeError;
    if (!charge) {
      return NextResponse.json({ error: "Charge not found." }, { status: 404 });
    }

    const { data: existing, error: existingError } = await supabase
      .from("finance_obligations")
      .select("user_id")
      .eq("charge_id", chargeId);
    if (existingError) throw existingError;

    const alreadyCharged = new Set((existing ?? []).map((row) => row.user_id as string));
    const userIds = Array.from(requested.keys()).filter((id) => !alreadyCharged.has(id));
    if (userIds.length === 0) {
      return NextResponse.json(
        { error: "Those members are already on this transaction." },
        { status: 400 },
      );
    }

    const usersById = await loadBasicUsersByIds(userIds);
    const unknown = userIds.find((id) => !usersById.has(id));
    if (unknown) {
      return NextResponse.json({ error: `Unknown user selected: ${unknown}` }, { status: 400 });
    }

    const obligations: Array<{
      charge_id: string;
      user_id: string;
      customer_id: string;
      amount_cents: number;
      due_at: string | null;
    }> = [];

    for (const userId of userIds) {
      const user = usersById.get(userId);
      if (!user) continue;
      const ensured = await ensureFinanceCustomerForUser(user);
      obligations.push({
        charge_id: chargeId,
        user_id: userId,
        customer_id: ensured.customerId,
        amount_cents: requested.get(userId) as number,
        due_at: typeof charge.due_at === "string" ? charge.due_at : null,
      });
    }

    const { error: insertError } = await supabase
      .from("finance_obligations")
      .insert(obligations);
    if (insertError) throw insertError;

    const { error: targetError } = await supabase.from("finance_charge_targets").insert(
      obligations.map((item) => ({
        charge_id: chargeId,
        target_type: "user",
        target_id: item.user_id,
        mode: "include",
        amount_cents: item.amount_cents,
      })),
    );
    if (targetError) throw targetError;

    return NextResponse.json({ added: obligations.length }, { status: 201 });
  } catch (error) {
    if (error instanceof RouteAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to add members." },
      { status: 500 },
    );
  }
}

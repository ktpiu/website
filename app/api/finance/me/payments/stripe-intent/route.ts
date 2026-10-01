import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import {
  requireAppAuthContext,
  RouteAuthError,
} from "@/lib/server-auth";
import {
  ensureFinanceCustomerForUser,
  loadObligationBalancesForUser,
} from "@/lib/finance-server";
import { ALLOW_PARTIAL_PAYMENTS } from "@/lib/finance-config";
import {
  allocateByFifo,
  getAllocationsTotal,
  normalizeManualAllocations,
} from "@/lib/finance-utils";
import type {
  FinanceAllocationInput,
  FinanceAllocationMode,
} from "@/lib/finance-types";

function parsePositiveInteger(value: unknown) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

export async function POST(req: NextRequest) {
  try {
    const context = await requireAppAuthContext();

    const body = (await req.json()) as {
      paymentMethodId?: unknown;
      paymentMethodLabel?: unknown;
      amountCents?: unknown;
      allocationMode?: unknown;
      allocations?: unknown;
    };

    if (typeof body.paymentMethodId !== "string" || body.paymentMethodId.length === 0) {
      return NextResponse.json(
        { error: "paymentMethodId is required." },
        { status: 400 },
      );
    }

    const allocationMode: FinanceAllocationMode =
      body.allocationMode === "manual_selection" ? "manual_selection" : "auto_fifo";

    const ensured = await ensureFinanceCustomerForUser({
      id: context.appUser.id,
      name: context.appUser.name,
      email: context.appUser.email,
    });

    const obligations = (await loadObligationBalancesForUser(context.appUser.id)).filter(
      (obligation) => obligation.remaining_cents > 0,
    );

    if (obligations.length === 0) {
      return NextResponse.json(
        { error: "No unpaid obligations available to pay." },
        { status: 400 },
      );
    }

    const requestedAmount = parsePositiveInteger(body.amountCents);

    const allocations =
      allocationMode === "manual_selection"
        ? normalizeManualAllocations({
            allocations: Array.isArray(body.allocations)
              ? (body.allocations as FinanceAllocationInput[])
              : [],
            obligationById: new Map(
              obligations.map((obligation) => [obligation.id, obligation]),
            ),
            amountCents: requestedAmount ?? Number.MAX_SAFE_INTEGER,
          })
        : allocateByFifo({
            obligations,
            amountCents:
              requestedAmount ??
              obligations.reduce((sum, obligation) => sum + obligation.remaining_cents, 0),
          });

    const amountCents = getAllocationsTotal(allocations);

    if (!ALLOW_PARTIAL_PAYMENTS) {
      const remainingById = new Map(
        obligations.map((obligation) => [obligation.id, obligation.remaining_cents]),
      );
      const isPartial =
        allocations.some(
          (allocation) => allocation.amountCents !== remainingById.get(allocation.obligationId),
        ) ||
        (allocationMode === "auto_fifo" &&
          amountCents !==
            obligations.reduce((sum, obligation) => sum + obligation.remaining_cents, 0));

      if (isPartial) {
        return NextResponse.json(
          { error: "Partial payments are temporarily disabled. Pay each charge in full." },
          { status: 400 },
        );
      }
    }

    if (amountCents <= 0) {
      return NextResponse.json(
        { error: "No valid payment allocations were generated." },
        { status: 400 },
      );
    }

    const paymentIntent = await stripe.paymentIntents.create({
      customer: ensured.stripeCustomerId,
      payment_method: body.paymentMethodId,
      amount: amountCents,
      currency: "usd",
      payment_method_types: ["card", "us_bank_account"],
      confirm: true,
      off_session: false,
    });

    const paymentStatus = paymentIntent.status;

    if (
      ![
        "processing",
        "succeeded",
        "requires_capture",
        "requires_action",
      ].includes(paymentStatus)
    ) {
      return NextResponse.json(
        {
          error: `Unexpected payment status from Stripe: ${paymentStatus}`,
        },
        { status: 400 },
      );
    }

    const { data: paymentRecord, error: paymentError } = await supabase
      .from("finance_payments")
      .insert({
        user_id: context.appUser.id,
        customer_id: ensured.customerId,
        source: "stripe",
        status: "pending",
        amount_cents: amountCents,
        currency: "usd",
        stripe_payment_intent_id: paymentIntent.id,
        payment_method_label:
          typeof body.paymentMethodLabel === "string"
            ? body.paymentMethodLabel
            : null,
        allocation_mode: allocationMode,
        pending_allocations_json: allocations,
        notes: null,
        created_by_user_id: null,
      })
      .select("id")
      .single();

    if (paymentError) {
      return NextResponse.json(
        {
          error: `Payment intent created but failed to record payment: ${paymentError.message}`,
          paymentIntentId: paymentIntent.id,
        },
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        paymentId: paymentRecord?.id ?? null,
        paymentIntentId: paymentIntent.id,
        status: paymentIntent.status,
        amountCents: paymentIntent.amount,
      },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof RouteAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to create Stripe payment intent.",
      },
      { status: 500 },
    );
  }
}

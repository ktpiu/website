import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAppAuthContext, RouteAuthError } from "@/lib/server-auth";

/**
 * Creates the signed-in member's Stripe customer and records it in
 * public.customers (server-only table). Name and email come from the
 * member's profile, never from the request.
 */
export async function POST() {
  try {
    const { appUser } = await requireAppAuthContext();

    const { data: existing, error: existingError } = await supabaseAdmin
      .from("customers")
      .select("stripe_id")
      .eq("user_id", appUser.id)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing?.stripe_id) {
      return NextResponse.json({ id: existing.stripe_id }, { status: 200 });
    }

    const customer = await stripe.customers.create({ name: appUser.name, email: appUser.email });
    const { error } = await supabaseAdmin
      .from("customers")
      .upsert({ user_id: appUser.id, stripe_id: customer.id });
    if (error) throw error;

    return NextResponse.json({ id: customer.id }, { status: 200 });
  } catch (error) {
    if (error instanceof RouteAuthError) {
      return NextResponse.json(error.toResponseBody(), { status: error.status });
    }
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}

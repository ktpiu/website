import "server-only";

import { stripe } from "@/lib/stripe";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import type {
  FinanceAllocationResult,
  FinanceObligationBalance,
  FinancePaymentStatus,
} from "@/lib/finance-types";

type BasicUser = {
  id: string;
  name: string;
  email: string;
  role?: string | null;
};

type BasicRole = {
  id: string;
  name: string;
  type: string | null;
};

type UserRoleRow = {
  user_id: string | null;
  role_id: string | null;
};

type CustomerRow = {
  id: string;
  user_id: string;
  stripe_id: string | null;
};

function parseBasicUser(row: unknown): BasicUser | null {
  if (!row || typeof row !== "object") return null;

  const value = row as {
    id?: unknown;
    name?: unknown;
    email?: unknown;
    role?: unknown;
  };

  if (typeof value.id !== "string") return null;
  if (typeof value.email !== "string") return null;

  return {
    id: value.id,
    name: typeof value.name === "string" ? value.name : "",
    email: value.email,
    role: typeof value.role === "string" ? value.role : null,
  };
}

function parseBasicRole(row: unknown): BasicRole | null {
  if (!row || typeof row !== "object") return null;

  const value = row as {
    id?: unknown;
    name?: unknown;
    type?: unknown;
  };

  if (typeof value.id !== "string") return null;
  if (typeof value.name !== "string") return null;

  return {
    id: value.id,
    name: value.name,
    type: typeof value.type === "string" ? value.type : null,
  };
}

function parseCustomerRow(row: unknown): CustomerRow | null {
  if (!row || typeof row !== "object") return null;

  const value = row as {
    id?: unknown;
    user_id?: unknown;
    stripe_id?: unknown;
  };

  if (typeof value.id !== "string") return null;
  if (typeof value.user_id !== "string") return null;

  return {
    id: value.id,
    user_id: value.user_id,
    stripe_id: typeof value.stripe_id === "string" ? value.stripe_id : null,
  };
}

function parseObligationBalance(row: unknown): FinanceObligationBalance | null {
  if (!row || typeof row !== "object") return null;

  const value = row as Record<string, unknown>;

  if (
    typeof value.id !== "string" ||
    typeof value.charge_id !== "string" ||
    typeof value.user_id !== "string" ||
    typeof value.amount_cents !== "number" ||
    typeof value.paid_cents !== "number" ||
    typeof value.remaining_cents !== "number" ||
    typeof value.payment_state !== "string" ||
    typeof value.is_overdue !== "boolean" ||
    typeof value.created_at !== "string" ||
    typeof value.updated_at !== "string"
  ) {
    return null;
  }

  return {
    id: value.id,
    charge_id: value.charge_id,
    user_id: value.user_id,
    customer_id: typeof value.customer_id === "string" ? value.customer_id : null,
    amount_cents: value.amount_cents,
    due_at: typeof value.due_at === "string" ? value.due_at : null,
    created_at: value.created_at,
    updated_at: value.updated_at,
    paid_cents: value.paid_cents,
    remaining_cents: value.remaining_cents,
    payment_state:
      value.payment_state === "paid" ||
      value.payment_state === "partial" ||
      value.payment_state === "unpaid"
        ? value.payment_state
        : "unpaid",
    is_overdue: value.is_overdue,
  };
}

export async function loadAllBasicUsers() {
  const { data, error } = await supabase
    .from("users")
    .select("id, name, email, role")
    .order("name", { ascending: true });

  if (error) throw error;

  const users: BasicUser[] = [];
  for (const row of data ?? []) {
    const user = parseBasicUser(row);
    if (user) users.push(user);
  }

  return users;
}

export async function loadBasicUsersByIds(userIds: string[]) {
  if (userIds.length === 0) {
    return new Map<string, BasicUser>();
  }

  const { data, error } = await supabase
    .from("users")
    .select("id, name, email, role")
    .in("id", userIds);

  if (error) throw error;

  const map = new Map<string, BasicUser>();
  for (const row of data ?? []) {
    const user = parseBasicUser(row);
    if (user) {
      map.set(user.id, user);
    }
  }

  return map;
}

export async function loadAllBasicRoles() {
  const { data, error } = await supabase
    .from("roles")
    .select("id, name, type")
    .order("priority", { ascending: false })
    .order("name", { ascending: true });

  if (error) throw error;

  const roles: BasicRole[] = [];
  for (const row of data ?? []) {
    const role = parseBasicRole(row);
    if (role) roles.push(role);
  }

  return roles;
}

export async function loadUserRoleRows() {
  const { data, error } = await supabase
    .from("user_roles")
    .select("user_id, role_id");

  if (error) throw error;

  return (data ?? []) as UserRoleRow[];
}

export async function loadCustomersByUserIds(userIds: string[]) {
  if (userIds.length === 0) {
    return new Map<string, CustomerRow>();
  }

  const { data, error } = await supabase
    .from("customers")
    .select("id, user_id, stripe_id")
    .in("user_id", userIds);

  if (error) throw error;

  const map = new Map<string, CustomerRow>();

  for (const row of data ?? []) {
    const customer = parseCustomerRow(row);
    if (customer) {
      map.set(customer.user_id, customer);
    }
  }

  return map;
}

export async function ensureFinanceCustomerForUser(user: BasicUser) {
  const { data: existingData, error: existingError } = await supabase
    .from("customers")
    .select("id, user_id, stripe_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (existingError) throw existingError;

  const existing = parseCustomerRow(existingData);
  if (existing?.stripe_id) {
    return {
      customerId: existing.id,
      stripeCustomerId: existing.stripe_id,
    };
  }

  const stripeCustomer = await stripe.customers.create({
    name: user.name || undefined,
    email: user.email,
  });

  if (existing) {
    const { data: updatedData, error: updateError } = await supabase
      .from("customers")
      .update({ stripe_id: stripeCustomer.id })
      .eq("id", existing.id)
      .select("id, user_id, stripe_id")
      .single();

    if (updateError) throw updateError;

    const updated = parseCustomerRow(updatedData);
    if (!updated || !updated.stripe_id) {
      throw new Error("Failed to update customer finance record.");
    }

    return {
      customerId: updated.id,
      stripeCustomerId: updated.stripe_id,
    };
  }

  const { data: insertedData, error: insertError } = await supabase
    .from("customers")
    .insert({ user_id: user.id, stripe_id: stripeCustomer.id })
    .select("id, user_id, stripe_id")
    .single();

  if (insertError) throw insertError;

  const inserted = parseCustomerRow(insertedData);
  if (!inserted || !inserted.stripe_id) {
    throw new Error("Failed to create customer finance record.");
  }

  return {
    customerId: inserted.id,
    stripeCustomerId: inserted.stripe_id,
  };
}

export async function loadObligationBalancesForUser(userId: string) {
  const { data, error } = await supabase
    .from("finance_obligation_balances")
    .select("*")
    .eq("user_id", userId)
    .order("due_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  if (error) throw error;

  const obligations: FinanceObligationBalance[] = [];
  for (const row of data ?? []) {
    const parsed = parseObligationBalance(row);
    if (parsed) obligations.push(parsed);
  }

  return obligations;
}

export async function loadObligationBalancesForCharge(chargeId: string) {
  const { data, error } = await supabase
    .from("finance_obligation_balances")
    .select("*")
    .eq("charge_id", chargeId)
    .order("created_at", { ascending: true });

  if (error) throw error;

  const obligations: FinanceObligationBalance[] = [];
  for (const row of data ?? []) {
    const parsed = parseObligationBalance(row);
    if (parsed) obligations.push(parsed);
  }

  return obligations;
}

export async function persistPaymentAllocations(params: {
  paymentId: string;
  allocations: FinanceAllocationResult[];
}) {
  if (params.allocations.length === 0) {
    return;
  }

  const payload = params.allocations.map((allocation) => ({
    payment_id: params.paymentId,
    obligation_id: allocation.obligationId,
    amount_cents: allocation.amountCents,
  }));

  const { error } = await supabase
    .from("finance_payment_allocations")
    .insert(payload);

  if (error) throw error;
}

export async function updateFinancePaymentStatus(params: {
  paymentId: string;
  status: FinancePaymentStatus;
}) {
  const { error } = await supabase
    .from("finance_payments")
    .update({ status: params.status, updated_at: new Date().toISOString() })
    .eq("id", params.paymentId);

  if (error) throw error;
}

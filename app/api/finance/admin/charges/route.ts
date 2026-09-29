import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import {
  assertFinanceEditPermission,
  assertFinanceViewPermission,
  requireAppAuthContext,
  RouteAuthError,
} from "@/lib/server-auth";
import { parseFinanceChargeInput } from "@/lib/finance-charge-input";
import {
  ensureFinanceCustomerForUser,
  loadAllBasicRoles,
  loadAllBasicUsers,
  loadUserRoleRows,
} from "@/lib/finance-server";
import { resolveChargeRecipients } from "@/lib/finance-utils";

type ChargeSummaryRow = {
  charge_id: string | null;
  amount_cents: number | null;
  paid_cents: number | null;
  payment_state: string | null;
  remaining_cents: number | null;
  is_overdue: boolean | null;
  user_id: string | null;
};

function normalizeIsoDate(input: string | null | undefined) {
  if (!input) return null;
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export async function GET() {
  try {
    const context = await requireAppAuthContext();
    assertFinanceViewPermission(context);

    const [chargesRes, obligationRes] = await Promise.all([
      supabase
        .from("finance_charges")
        .select("id, title, description, due_at, default_amount_cents, currency, created_at")
        .order("created_at", { ascending: false }),
      supabase
        .from("finance_obligation_balances")
        .select("charge_id, amount_cents, paid_cents, payment_state, remaining_cents, is_overdue, user_id"),
    ]);

    if (chargesRes.error) throw chargesRes.error;
    if (obligationRes.error) throw obligationRes.error;

    const summaryByChargeId = new Map<
      string,
      {
        totalAssigned: number;
        totalCents: number;
        paidCents: number;
        unpaidCount: number;
        overdueCount: number;
        outstandingCents: number;
      }
    >();

    for (const row of (obligationRes.data ?? []) as ChargeSummaryRow[]) {
      if (!row.charge_id || !row.user_id) continue;

      const current =
        summaryByChargeId.get(row.charge_id) ??
        {
          totalAssigned: 0,
          totalCents: 0,
          paidCents: 0,
          unpaidCount: 0,
          overdueCount: 0,
          outstandingCents: 0,
        };

      const rowPaid = typeof row.paid_cents === "number" ? row.paid_cents : 0;
      const isExempt = row.payment_state === "exempt";

      // Exempt obligations only count what was actually collected.
      current.totalAssigned += 1;
      current.totalCents += isExempt
        ? rowPaid
        : typeof row.amount_cents === "number"
          ? row.amount_cents
          : 0;
      current.paidCents += rowPaid;

      const remaining = typeof row.remaining_cents === "number" ? row.remaining_cents : 0;
      if (remaining > 0) {
        current.unpaidCount += 1;
        current.outstandingCents += remaining;
        if (row.is_overdue) {
          current.overdueCount += 1;
        }
      }

      summaryByChargeId.set(row.charge_id, current);
    }

    const charges = (chargesRes.data ?? []).flatMap((row) => {
      if (!row || typeof row.id !== "string" || typeof row.title !== "string") {
        return [];
      }

      const summary = summaryByChargeId.get(row.id) ?? {
        totalAssigned: 0,
        totalCents: 0,
        paidCents: 0,
        unpaidCount: 0,
        overdueCount: 0,
        outstandingCents: 0,
      };

      return [
        {
          id: row.id,
          title: row.title,
          description: typeof row.description === "string" ? row.description : null,
          dueAt: typeof row.due_at === "string" ? row.due_at : null,
          defaultAmountCents:
            typeof row.default_amount_cents === "number" ? row.default_amount_cents : null,
          currency: typeof row.currency === "string" ? row.currency : "usd",
          createdAt: typeof row.created_at === "string" ? row.created_at : null,
          ...summary,
        },
      ];
    });

    return NextResponse.json({ charges }, { status: 200 });
  } catch (error) {
    if (error instanceof RouteAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to load finance charges.",
      },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const context = await requireAppAuthContext();
    assertFinanceEditPermission(context);

    const rawBody = await req.json();
    const parsed = parseFinanceChargeInput(rawBody);

    if (!parsed.value) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const input = parsed.value;

    if (!input.title || input.title.length === 0) {
      return NextResponse.json({ error: "Charge title is required." }, { status: 400 });
    }

    const dueAt = normalizeIsoDate(input.dueAt);
    if (input.dueAt && !dueAt) {
      return NextResponse.json({ error: "Invalid due date." }, { status: 400 });
    }

    const [users, roles, userRoles] = await Promise.all([
      loadAllBasicUsers(),
      loadAllBasicRoles(),
      loadUserRoleRows(),
    ]);

    const usersById = new Map(users.map((user) => [user.id, user]));
    const roleIds = new Set(roles.map((role) => role.id));

    const unknownRoleId = [...input.includeRoleIds, ...input.excludeRoleIds].find(
      (roleId) => !roleIds.has(roleId),
    );
    if (unknownRoleId) {
      return NextResponse.json(
        { error: `Unknown role selected: ${unknownRoleId}` },
        { status: 400 },
      );
    }

    const unknownUserId = [
      ...input.includeUsers.map((entry) => entry.userId),
      ...input.excludeUserIds,
    ].find((userId) => !usersById.has(userId));

    if (unknownUserId) {
      return NextResponse.json(
        { error: `Unknown user selected: ${unknownUserId}` },
        { status: 400 },
      );
    }

    const preview = resolveChargeRecipients({
      input,
      usersById,
      userRoles,
    });

    if (preview.conflicts.length > 0 || preview.missingAmountUserIds.length > 0) {
      return NextResponse.json(
        {
          error: "Charge recipients need manual amount resolution.",
          conflicts: preview.conflicts,
          missingAmountUserIds: preview.missingAmountUserIds,
        },
        { status: 400 },
      );
    }

    if (preview.recipients.length === 0) {
      return NextResponse.json(
        { error: "No recipients resolved for this charge." },
        { status: 400 },
      );
    }

    const uniqueRecipientUserIds = Array.from(
      new Set(preview.recipients.map((recipient) => recipient.userId)),
    );

    const ensuredByUserId = new Map<
      string,
      { customerId: string; stripeCustomerId: string }
    >();

    for (const userId of uniqueRecipientUserIds) {
      const user = usersById.get(userId);
      if (!user) {
        continue;
      }

      const ensured = await ensureFinanceCustomerForUser(user);
      ensuredByUserId.set(userId, ensured);
    }

    const { data: chargeData, error: chargeError } = await supabase
      .from("finance_charges")
      .insert({
        title: input.title,
        description: input.description,
        due_at: dueAt,
        default_amount_cents: input.defaultAmountCents,
        currency: "usd",
        created_by_user_id: context.appUser.id,
      })
      .select("id")
      .single();

    if (chargeError) throw chargeError;

    if (!chargeData || typeof chargeData.id !== "string") {
      throw new Error("Failed to create charge record.");
    }

    const chargeId = chargeData.id;

    const targets: Array<{
      charge_id: string;
      target_type: "role" | "user";
      target_id: string;
      mode: "include" | "exclude";
      amount_cents: number | null;
    }> = [];

    for (const roleId of input.includeRoleIds) {
      targets.push({
        charge_id: chargeId,
        target_type: "role",
        target_id: roleId,
        mode: "include",
        amount_cents: input.roleAmounts?.[roleId] ?? null,
      });
    }

    for (const roleId of input.excludeRoleIds) {
      targets.push({
        charge_id: chargeId,
        target_type: "role",
        target_id: roleId,
        mode: "exclude",
        amount_cents: null,
      });
    }

    for (const entry of input.includeUsers) {
      targets.push({
        charge_id: chargeId,
        target_type: "user",
        target_id: entry.userId,
        mode: "include",
        amount_cents: entry.amountCents ?? null,
      });
    }

    for (const userId of input.excludeUserIds) {
      targets.push({
        charge_id: chargeId,
        target_type: "user",
        target_id: userId,
        mode: "exclude",
        amount_cents: null,
      });
    }

    if (targets.length > 0) {
      const { error } = await supabase
        .from("finance_charge_targets")
        .insert(targets);

      if (error) throw error;
    }

    const obligationsPayload = preview.recipients
      .map((recipient) => {
        const ensured = ensuredByUserId.get(recipient.userId);
        return {
          charge_id: chargeId,
          user_id: recipient.userId,
          customer_id: ensured?.customerId ?? null,
          amount_cents: recipient.amountCents,
          due_at: dueAt,
        };
      })
      .filter((entry) => entry.amount_cents > 0);

    if (obligationsPayload.length === 0) {
      throw new Error("No obligations were generated for this charge.");
    }

    const { error: obligationsError } = await supabase
      .from("finance_obligations")
      .insert(obligationsPayload);

    if (obligationsError) throw obligationsError;

    return NextResponse.json(
      {
        chargeId,
        recipientCount: obligationsPayload.length,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof RouteAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to create finance charge.",
      },
      { status: 500 },
    );
  }
}

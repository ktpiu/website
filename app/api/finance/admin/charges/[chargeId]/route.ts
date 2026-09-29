import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import {
  assertFinanceViewPermission,
  requireAppAuthContext,
  RouteAuthError,
} from "@/lib/server-auth";
import {
  loadAllBasicRoles,
  loadBasicUsersByIds,
  loadObligationBalancesForCharge,
} from "@/lib/finance-server";

type ChargeTargetRow = {
  target_type: string | null;
  target_id: string | null;
  mode: string | null;
  amount_cents: number | null;
};

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ chargeId: string }> },
) {
  try {
    const authContext = await requireAppAuthContext();
    assertFinanceViewPermission(authContext);

    const { chargeId } = await context.params;

    const [chargeRes, obligations, roles, targetsRes] =
      await Promise.all([
        supabase
          .from("finance_charges")
          .select("id, title, description, due_at, default_amount_cents, currency, created_at")
          .eq("id", chargeId)
          .maybeSingle(),
        loadObligationBalancesForCharge(chargeId),
        loadAllBasicRoles(),
        supabase
          .from("finance_charge_targets")
          .select("target_type, target_id, mode, amount_cents")
          .eq("charge_id", chargeId),
      ]);

    if (chargeRes.error) throw chargeRes.error;
    if (targetsRes.error) throw targetsRes.error;

    if (!chargeRes.data || typeof chargeRes.data.id !== "string") {
      return NextResponse.json({ error: "Charge not found." }, { status: 404 });
    }

    const roleNameById = new Map(roles.map((role) => [role.id, role.name]));

    const targetRows = (targetsRes.data ?? []) as ChargeTargetRow[];

    const targetUserIds = targetRows
      .filter((row) => row.target_type === "user" && typeof row.target_id === "string")
      .map((row) => row.target_id as string);

    const allUserIds = new Set<string>([
      ...obligations.map((item) => item.user_id),
      ...targetUserIds,
    ]);

    const usersById = await loadBasicUsersByIds(Array.from(allUserIds));

    const avatarRes = await supabase
      .from("users")
      .select("id, avatar")
      .in("id", Array.from(allUserIds));
    if (avatarRes.error) throw avatarRes.error;
    const avatarByUserId = new Map(
      (avatarRes.data ?? []).map((row) => [
        row.id as string,
        typeof row.avatar === "string" && row.avatar ? row.avatar : null,
      ]),
    );

    const recipients = obligations.map((obligation) => {
      const user = usersById.get(obligation.user_id);
      return {
        obligationId: obligation.id,
        userId: obligation.user_id,
        name: user?.name ?? "Unknown User",
        email: user?.email ?? "",
        avatar: avatarByUserId.get(obligation.user_id) ?? null,
        amountCents: obligation.amount_cents,
        paidCents: obligation.paid_cents,
        remainingCents: obligation.remaining_cents,
        paymentState: obligation.payment_state,
        isOverdue: obligation.is_overdue,
        dueAt: obligation.due_at,
      };
    });

    const includeRoles = targetRows
      .filter((row) => row.target_type === "role" && row.mode === "include" && typeof row.target_id === "string")
      .map((row) => ({
        roleId: row.target_id as string,
        roleName: roleNameById.get(row.target_id as string) ?? "Unknown Role",
        amountCents: typeof row.amount_cents === "number" ? row.amount_cents : null,
      }));

    const excludeRoles = targetRows
      .filter((row) => row.target_type === "role" && row.mode === "exclude" && typeof row.target_id === "string")
      .map((row) => ({
        roleId: row.target_id as string,
        roleName: roleNameById.get(row.target_id as string) ?? "Unknown Role",
      }));

    const includeUsers = targetRows
      .filter((row) => row.target_type === "user" && row.mode === "include" && typeof row.target_id === "string")
      .map((row) => {
        const user = usersById.get(row.target_id as string);
        return {
          userId: row.target_id as string,
          name: user?.name ?? "Unknown User",
          email: user?.email ?? "",
          amountCents: typeof row.amount_cents === "number" ? row.amount_cents : null,
        };
      });

    const excludeUsers = targetRows
      .filter((row) => row.target_type === "user" && row.mode === "exclude" && typeof row.target_id === "string")
      .map((row) => {
        const user = usersById.get(row.target_id as string);
        return {
          userId: row.target_id as string,
          name: user?.name ?? "Unknown User",
          email: user?.email ?? "",
        };
      });

    const charge = {
      id: chargeRes.data.id,
      title: chargeRes.data.title,
      description:
        typeof chargeRes.data.description === "string"
          ? chargeRes.data.description
          : null,
      dueAt: typeof chargeRes.data.due_at === "string" ? chargeRes.data.due_at : null,
      defaultAmountCents:
        typeof chargeRes.data.default_amount_cents === "number"
          ? chargeRes.data.default_amount_cents
          : null,
      currency:
        typeof chargeRes.data.currency === "string" ? chargeRes.data.currency : "usd",
      createdAt:
        typeof chargeRes.data.created_at === "string" ? chargeRes.data.created_at : null,
    };

    return NextResponse.json(
      {
        charge,
        targets: {
          includeRoles,
          excludeRoles,
          includeUsers,
          excludeUsers,
        },
        recipients,
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
          error instanceof Error
            ? error.message
            : "Failed to load finance charge details.",
      },
      { status: 500 },
    );
  }
}

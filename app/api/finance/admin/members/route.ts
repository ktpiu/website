import { NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import {
  assertFinanceViewPermission,
  requireAppAuthContext,
  RouteAuthError,
} from "@/lib/server-auth";
import { getGradeLabel } from "@/lib/members";
import { ADMIN_FINANCE_EDIT } from "@/lib/permissions";
import {
  loadAllBasicRoles,
  loadAllBasicUsers,
  loadCustomersByUserIds,
  loadUserRoleRows,
} from "@/lib/finance-server";

type ObligationSummaryRow = {
  user_id: string | null;
  remaining_cents: number | null;
  is_overdue: boolean | null;
};

export async function GET() {
  try {
    const context = await requireAppAuthContext();
    assertFinanceViewPermission(context);

    const [users, roles, userRoleRows] = await Promise.all([
      loadAllBasicUsers(),
      loadAllBasicRoles(),
      loadUserRoleRows(),
    ]);

    const userIds = users.map((user) => user.id);
    const [customerMap, statusRes, obligationSummaryRes] = await Promise.all([
      loadCustomersByUserIds(userIds),
      supabase
        .from("users")
        .select("id, avatar, graduation_year, is_alumni, is_inactive, is_disaffiliated"),
      supabase
        .from("finance_obligation_balances")
        .select("user_id, remaining_cents, is_overdue"),
    ]);

    if (statusRes.error) {
      throw statusRes.error;
    }

    const statusByUserId = new Map(
      (statusRes.data ?? []).map((row) => [row.id as string, row]),
    );
    const pledgeClassRoleIds = new Set(
      roles.filter((role) => role.type === "pledge_class").map((role) => role.id),
    );

    if (obligationSummaryRes.error) {
      throw obligationSummaryRes.error;
    }

    const roleIdsByUserId = new Map<string, Set<string>>();

    for (const row of userRoleRows) {
      if (!row.user_id || !row.role_id) continue;
      const roleSet = roleIdsByUserId.get(row.user_id) ?? new Set<string>();
      roleSet.add(row.role_id);
      roleIdsByUserId.set(row.user_id, roleSet);
    }

    const roleNameById = new Map(roles.map((role) => [role.id, role.name]));

    const outstandingByUserId = new Map<string, number>();
    const overdueCountByUserId = new Map<string, number>();

    for (const row of (obligationSummaryRes.data ?? []) as ObligationSummaryRow[]) {
      if (!row.user_id) continue;
      const remaining = typeof row.remaining_cents === "number" ? row.remaining_cents : 0;
      if (remaining > 0) {
        outstandingByUserId.set(
          row.user_id,
          (outstandingByUserId.get(row.user_id) ?? 0) + remaining,
        );
      }

      if (row.is_overdue && remaining > 0) {
        overdueCountByUserId.set(
          row.user_id,
          (overdueCountByUserId.get(row.user_id) ?? 0) + 1,
        );
      }
    }

    const members = users.map((user) => {
      const roleIds = Array.from(roleIdsByUserId.get(user.id) ?? []);
      const roleNames = roleIds
        .map((roleId) => roleNameById.get(roleId))
        .filter((name): name is string => Boolean(name));

      const customer = customerMap.get(user.id);
      const enabled = Boolean(customer && customer.stripe_id);

      const status = statusByUserId.get(user.id);
      const isAlumni = Boolean(status?.is_alumni);
      const isInactive = Boolean(status?.is_inactive);
      const isDisaffiliated = Boolean(status?.is_disaffiliated);
      const pledgeClassRole = roleIds.find((id) => pledgeClassRoleIds.has(id));

      return {
        id: user.id,
        avatar: typeof status?.avatar === "string" && status.avatar ? status.avatar : null,
        grade: getGradeLabel(
          typeof status?.graduation_year === "number" ? status.graduation_year : null,
          isAlumni,
        ),
        isAlumni,
        isInactive,
        isDisaffiliated,
        hasPledgeClass: Boolean(pledgeClassRole),
        pledgeClass: pledgeClassRole ? roleNameById.get(pledgeClassRole) ?? null : null,
        name: user.name,
        email: user.email,
        role: user.role ?? null,
        roleIds,
        roleNames,
        financeEnabled: enabled,
        outstandingCents: outstandingByUserId.get(user.id) ?? 0,
        overdueCount: overdueCountByUserId.get(user.id) ?? 0,
      };
    });

    return NextResponse.json(
      {
        members,
        roles,
        canEdit: context.permissions.has(ADMIN_FINANCE_EDIT),
      },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof RouteAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to load finance members.",
      },
      { status: 500 },
    );
  }
}

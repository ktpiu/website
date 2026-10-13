import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  assertUserDirectoryPermission,
  requireAppAuthContext,
} from "@/lib/server-auth";
import { canViewRush, hasAnyPermission, USERS_RUSH_MANAGE } from "@/lib/permissions";
import {
  creatableStatuses,
  isAccountStatus,
  statusesInScope,
} from "@/lib/account-status";
import { findAppUserByEmail, normalizeEmail, preprovisionAppUserByEmail } from "@/lib/app-user";
import { adminUsersErrorResponse } from "@/lib/admin-users-server";
import {
  ensureCycleEntry,
  findOrCreatePnm,
  getActiveCycle,
  readJson,
  RushError,
  str,
} from "@/lib/rush/server";
import { looksLikeEmail } from "@/lib/rush/types";
import type { User as SupabaseUser } from "@/lib/supabase";
import type { RushSummary } from "@/components/member-portal/admin/users/users-utils";

export const dynamic = "force-dynamic";

/**
 * User Management data, scoped server-side: admins (admin.view) get every
 * account; rush directors and committee get public, rushee and pledge accounts
 * only. Includes each account's rush record for the active cycle when the
 * viewer can see rush data.
 */
export async function GET() {
  try {
    const context = await requireAppAuthContext();
    const scope = assertUserDirectoryPermission(context);
    const statuses = statusesInScope(scope);

    const [usersRes, rolesRes] = await Promise.all([
      supabaseAdmin
        .from("users")
        .select("*")
        .in("account_status", statuses as string[])
        .order("name", { ascending: true }),
      supabaseAdmin
        .from("roles")
        .select("id, name, priority, type")
        .order("priority", { ascending: false })
        .order("name", { ascending: true }),
    ]);
    if (usersRes.error) throw usersRes.error;
    if (rolesRes.error) throw rolesRes.error;

    const users = (usersRes.data ?? []) as SupabaseUser[];
    const userIds = users.map((u) => u.id);

    const userRoleIds: Record<string, string[]> = {};
    // Chunk to keep the `in` filter's URL short.
    for (let i = 0; i < userIds.length; i += 200) {
      const { data, error } = await supabaseAdmin
        .from("user_roles")
        .select("user_id, role_id")
        .in("user_id", userIds.slice(i, i + 200));
      if (error) throw error;
      for (const row of (data ?? []) as Array<{ user_id: string; role_id: string }>) {
        (userRoleIds[row.user_id] ??= []).push(row.role_id);
      }
    }

    const rushVisible =
      canViewRush(context.permissions) || hasAnyPermission(context.permissions, [USERS_RUSH_MANAGE]);
    const cycle = rushVisible ? await getActiveCycle() : null;
    const rush: Record<string, RushSummary> = {};
    if (rushVisible) {
      const { data: pnms, error: pnmsError } = await supabaseAdmin
        .from("pnms")
        .select("id, status, linked_user_id")
        .not("linked_user_id", "is", null);
      if (pnmsError) throw pnmsError;
      const pnmRows = (pnms ?? []) as Array<{ id: string; status: RushSummary["pnmStatus"]; linked_user_id: string }>;

      const entries = new Map<string, { stage: "open" | "closed"; group: string; outcome: string | null }>();
      if (cycle && pnmRows.length) {
        const { data, error } = await supabaseAdmin
          .from("pnm_cycle_entries")
          .select("pnm_id, stage, group, outcome")
          .eq("cycle_id", cycle.id);
        if (error) throw error;
        for (const row of (data ?? []) as Array<{ pnm_id: string; stage: "open" | "closed"; group: string; outcome: string | null }>) {
          entries.set(row.pnm_id, row);
        }
      }

      const visible = new Set(userIds);
      for (const pnm of pnmRows) {
        if (!visible.has(pnm.linked_user_id)) continue;
        const entry = entries.get(pnm.id);
        rush[pnm.linked_user_id] = {
          pnmId: pnm.id,
          pnmStatus: pnm.status,
          stage: entry?.stage ?? null,
          group: entry?.group ?? null,
          outcome: entry?.outcome ?? null,
        };
      }
    }

    return NextResponse.json(
      {
        scope,
        users,
        roles: rolesRes.data ?? [],
        userRoleIds,
        rush,
        cycle: cycle ? { id: cycle.id, label: cycle.label, phase: cycle.phase } : null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return adminUsersErrorResponse(error, "Failed to load users.");
  }
}

/**
 * Creates a profile by hand (no sign-in yet; the person's first sign-in with
 * this email links it). Rushees are registered in the active cycle.
 */
export async function POST(request: Request) {
  try {
    const context = await requireAppAuthContext();
    assertUserDirectoryPermission(context);
    const body = await readJson(request);

    const name = str(body.name, 120);
    const email = normalizeEmail(str(body.email, 254));
    const status = body.status;
    if (!name || !looksLikeEmail(email)) throw new RushError(400, "Enter a name and a valid email.");
    if (!isAccountStatus(status) || !creatableStatuses(context.permissions).includes(status)) {
      throw new RushError(403, "You can't create accounts with that status.");
    }
    if (await findAppUserByEmail(email)) {
      throw new RushError(409, "An account with this email already exists.");
    }

    const graduationYear =
      body.graduationYear === null || body.graduationYear === undefined || body.graduationYear === ""
        ? null
        : Number(body.graduationYear);
    if (graduationYear !== null && (!Number.isInteger(graduationYear) || graduationYear < 2000 || graduationYear > 2100)) {
      throw new RushError(400, "Graduation year must be a four-digit year.");
    }

    let userId: string;
    if (status === "rushee") {
      const cycle = await getActiveCycle();
      if (!cycle) throw new RushError(400, "There's no active rush cycle to register them for.");
      const { pnm } = await findOrCreatePnm({ email, name });
      await ensureCycleEntry(pnm, cycle.id);
      userId = pnm.linked_user_id!;
    } else {
      userId = (await preprovisionAppUserByEmail({ email, name, status })).user.id;
    }

    if (graduationYear !== null) {
      const { error } = await supabaseAdmin.from("users").update({ graduation_year: graduationYear }).eq("id", userId);
      if (error) throw error;
    }

    const { data, error } = await supabaseAdmin.from("users").select("*").eq("id", userId).single();
    if (error) throw error;
    return NextResponse.json({ user: data }, { status: 201 });
  } catch (error) {
    return adminUsersErrorResponse(error, "Failed to create the profile.");
  }
}

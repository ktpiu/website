import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { assertUserDirectoryPermission, requireAppAuthContext } from "@/lib/server-auth";
import { isAccountStatus } from "@/lib/account-status";
import { changeAccountStatus } from "@/lib/account-status-server";
import { adminUsersErrorResponse } from "@/lib/admin-users-server";
import { readJson, RushError } from "@/lib/rush/server";

export const dynamic = "force-dynamic";

/**
 * Moves accounts to a new status. Each account is checked against the
 * permission its specific move needs (lib/account-status.ts); ones the viewer
 * can't move come back in `skipped`.
 */
export async function POST(request: Request) {
  try {
    const context = await requireAppAuthContext();
    assertUserDirectoryPermission(context);
    const body = await readJson(request);

    const status = body.status;
    if (!isAccountStatus(status)) throw new RushError(400, "Unknown status.");
    const userIds = Array.isArray(body.userIds)
      ? Array.from(new Set(body.userIds.filter((id): id is string => typeof id === "string"))).slice(0, 500)
      : [];
    if (userIds.length === 0) throw new RushError(400, "Select at least one account.");

    let pledgeRoleId: string | null = null;
    if (status === "pledge" && typeof body.pledgeRoleId === "string" && body.pledgeRoleId) {
      const { data } = await supabaseAdmin
        .from("roles")
        .select("id")
        .eq("id", body.pledgeRoleId)
        .eq("type", "pledge_class")
        .maybeSingle();
      if (!data) throw new RushError(400, "Pick a pledge class.");
      pledgeRoleId = body.pledgeRoleId;
    }

    const result = await changeAccountStatus({
      userIds,
      to: status,
      actor: { userId: context.appUser.id, permissions: context.permissions },
      pledgeRoleId,
    });
    return NextResponse.json(result);
  } catch (error) {
    return adminUsersErrorResponse(error, "Failed to change the status.");
  }
}

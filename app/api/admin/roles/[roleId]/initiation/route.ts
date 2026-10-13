import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAppAuthContext, RouteAuthError } from "@/lib/server-auth";
import { canEditRoles } from "@/lib/permissions";
import { adminUsersErrorResponse } from "@/lib/admin-users-server";
import { readJson, RushError, writeAccountStatus } from "@/lib/rush/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ roleId: string }> };

/**
 * Marks a pledge class initiated (or not). Initiating moves every member of
 * the class who is still a pledge to active. Turning it off changes no one's
 * status: individuals are moved by hand in User Management.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const context = await requireAppAuthContext();
    if (!canEditRoles(context.permissions)) {
      throw new RouteAuthError(403, "Missing role edit permission.");
    }
    const { roleId } = await params;
    const body = await readJson(request);
    if (typeof body.initiated !== "boolean") throw new RushError(400, "Say whether the class is initiated.");

    const { data: role, error: roleError } = await supabaseAdmin
      .from("roles")
      .select("id, type, is_initiated")
      .eq("id", roleId)
      .maybeSingle();
    if (roleError) throw roleError;
    if (!role) throw new RushError(404, "Role not found.");
    if (role.type !== "pledge_class") throw new RushError(400, "Only pledge classes can be initiated.");

    const { error: updateError } = await supabaseAdmin
      .from("roles")
      .update({ is_initiated: body.initiated })
      .eq("id", roleId);
    if (updateError) throw updateError;

    let activated = 0;
    if (body.initiated && !role.is_initiated) {
      const { data: members, error } = await supabaseAdmin
        .from("user_roles")
        .select("user_id, users!inner(account_status)")
        .eq("role_id", roleId)
        .eq("users.account_status", "pledge");
      if (error) throw error;
      const ids = ((members ?? []) as Array<{ user_id: string }>).map((m) => m.user_id);
      await writeAccountStatus(ids, "active");
      activated = ids.length;
    }

    return NextResponse.json({ ok: true, activated });
  } catch (error) {
    return adminUsersErrorResponse(error, "Failed to update the pledge class.");
  }
}

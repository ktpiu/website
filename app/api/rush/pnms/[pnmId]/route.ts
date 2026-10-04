import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  assertRushManagePermission,
  assertRushViewPermission,
  requireAppAuthContext,
} from "@/lib/server-auth";
import { canManageDeliberation } from "@/lib/permissions";
import { normalizeEmail } from "@/lib/app-user";
import { loadPnmDossier } from "@/lib/rush/dossier";
import { getPnm, optStr, readJson, RushError, rushErrorResponse, str } from "@/lib/rush/server";
import { looksLikeEmail } from "@/lib/rush/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ pnmId: string }> };

/** Full PNM profile. Voting history only for deliberation admins. */
export async function GET(_request: Request, { params }: Params) {
  try {
    const context = await requireAppAuthContext();
    assertRushViewPermission(context);
    const { pnmId } = await params;
    const dossier = await loadPnmDossier(pnmId, {
      includeVotes: canManageDeliberation(context.permissions),
    });
    return NextResponse.json(dossier);
  } catch (error) {
    return rushErrorResponse(error, "Failed to load the PNM.");
  }
}

const STATUSES = new Set(["open", "closed", "pledge", "former"]);

export async function PATCH(request: Request, { params }: Params) {
  try {
    const context = await requireAppAuthContext();
    assertRushManagePermission(context);
    const { pnmId } = await params;
    const pnm = await getPnm(pnmId);
    const body = await readJson(request);

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if ("name" in body) {
      patch.name = str(body.name, 120);
      if (!patch.name) throw new RushError(400, "Name can't be empty.");
    }
    if ("email" in body) {
      const email = normalizeEmail(str(body.email, 254));
      if (!looksLikeEmail(email)) throw new RushError(400, "Enter a valid email.");
      if (pnm.clerk_user_id && email !== pnm.email) {
        throw new RushError(400, "This PNM already has an account; they must change their email from their account.");
      }
      patch.email = email;
    }
    if ("phone" in body) patch.phone = optStr(body.phone, 40);
    if ("major" in body) patch.major = optStr(body.major, 120);
    if ("gradYear" in body) {
      const year = body.gradYear === null || body.gradYear === "" ? null : Number(body.gradYear);
      if (year !== null && (!Number.isInteger(year) || year < 2000 || year > 2100)) {
        throw new RushError(400, "Enter a valid graduation year.");
      }
      patch.grad_year = year;
    }
    if ("status" in body) {
      if (!STATUSES.has(String(body.status))) throw new RushError(400, "Unknown status.");
      patch.status = body.status;
    }

    const { error } = await supabaseAdmin.from("pnms").update(patch).eq("id", pnm.id);
    if (error?.code === "23505") throw new RushError(409, "Another PNM already uses that email.");
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return rushErrorResponse(error, "Failed to update the PNM.");
  }
}

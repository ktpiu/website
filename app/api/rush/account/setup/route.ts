import { NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { findAppUserByEmail } from "@/lib/app-user";
import { verifySetupToken } from "@/lib/rush/links";
import { getPnm, readJson, RushError, rushErrorResponse, str } from "@/lib/rush/server";

export const dynamic = "force-dynamic";

function pnmIdFromToken(token: string) {
  const pnmId = token ? verifySetupToken(token) : null;
  if (!pnmId) throw new RushError(400, "This setup link is invalid or has expired.");
  return pnmId;
}

export async function GET(request: Request) {
  try {
    const pnm = await getPnm(pnmIdFromToken(new URL(request.url).searchParams.get("token") ?? ""));
    return NextResponse.json({ name: pnm.name, email: pnm.email, hasAccount: Boolean(pnm.clerk_user_id) });
  } catch (error) {
    return rushErrorResponse(error, "Failed to load the setup link.");
  }
}

function clerkErrorMessage(error: unknown) {
  const errors = (error as { errors?: Array<{ code?: string; longMessage?: string; message?: string }> })?.errors;
  const first = errors?.[0];
  return { code: first?.code, message: first?.longMessage ?? first?.message };
}

/**
 * Creates the PNM's Clerk account with the chosen password (tagged
 * accountType "pnm" so it never shows up as a pending member) and returns a
 * one-time sign-in ticket. The emailed link proves ownership of the address.
 */
export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const pnm = await getPnm(pnmIdFromToken(str(body.token, 2000)));
    const password = typeof body.password === "string" ? body.password : "";
    if (password.length < 8) throw new RushError(400, "Use at least 8 characters for your password.");

    const client = await clerkClient();
    let clerkUserId = pnm.clerk_user_id;

    if (!clerkUserId) {
      const [firstName, ...rest] = pnm.name.split(/\s+/);
      const metadata = { accountType: "pnm", pnmId: pnm.id };
      try {
        const created = await client.users.createUser({
          emailAddress: [pnm.email],
          password,
          firstName,
          lastName: rest.join(" ") || undefined,
          publicMetadata: metadata,
        });
        clerkUserId = created.id;
      } catch (error) {
        const { code, message } = clerkErrorMessage(error);
        if (code !== "form_identifier_exists") {
          throw new RushError(400, message ?? "Could not create your account.");
        }
        // They already signed up through the normal sign-up page. Adopt that
        // account unless it belongs to a member profile.
        if (await findAppUserByEmail(pnm.email)) {
          throw new RushError(409, "This email already belongs to a member account. Sign in instead.");
        }
        const { data: existing } = await client.users.getUserList({ emailAddress: [pnm.email], limit: 1 });
        const account = existing[0];
        if (!account) throw new RushError(400, message ?? "Could not create your account.");
        try {
          await client.users.updateUser(account.id, { password });
        } catch (updateError) {
          throw new RushError(400, clerkErrorMessage(updateError).message ?? "Could not set your password.");
        }
        await client.users.updateUserMetadata(account.id, { publicMetadata: metadata });
        clerkUserId = account.id;
      }

      const { error } = await supabaseAdmin
        .from("pnms")
        .update({ clerk_user_id: clerkUserId, updated_at: new Date().toISOString() })
        .eq("id", pnm.id)
        .is("clerk_user_id", null);
      if (error) throw error;
    } else {
      throw new RushError(409, "Your account is already set up. Sign in instead.", "ALREADY_SETUP");
    }

    const signInToken = await client.signInTokens.createSignInToken({
      userId: clerkUserId,
      expiresInSeconds: 300,
    });
    return NextResponse.json({ ok: true, ticket: signInToken.token });
  } catch (error) {
    return rushErrorResponse(error, "Failed to set up your account.");
  }
}

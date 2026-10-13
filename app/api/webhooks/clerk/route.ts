import { NextResponse, type NextRequest } from "next/server";
import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { resolveAppUser, findAppUserByClerkId } from "@/lib/app-user";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

/**
 * Clerk webhook. Gives a new Clerk account its public.users row as soon as it
 * is created: an email-matched profile is linked, otherwise a "public"
 * account is created (see resolveAppUser).
 *
 * Configure in the Clerk dashboard (Webhooks -> Add endpoint) with the URL
 * https://<site>/api/webhooks/clerk and subscribe to user.created, user.updated
 * and user.deleted. Put the endpoint's signing secret in CLERK_WEBHOOK_SIGNING_SECRET.
 */

const UNIQUE_VIOLATION = "23505";

type ClerkEmailAddress = { id: string; email_address: string };

type ClerkUserData = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
  primary_email_address_id?: string | null;
  email_addresses?: ClerkEmailAddress[];
  public_metadata?: Record<string, unknown> | null;
};

function getPrimaryEmail(user: ClerkUserData) {
  const addresses = user.email_addresses ?? [];
  const primary = addresses.find((a) => a.id === user.primary_email_address_id);
  return primary?.email_address ?? addresses[0]?.email_address ?? null;
}

function getName(user: ClerkUserData) {
  const full = [user.first_name, user.last_name].filter(Boolean).join(" ");
  return full || user.username || null;
}

export async function POST(request: NextRequest) {
  let event;
  try {
    event = await verifyWebhook(request);
  } catch (error) {
    console.error("Clerk webhook verification failed:", error);
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "user.created": {
        const user = event.data as ClerkUserData;
        const email = getPrimaryEmail(user);
        if (!email) {
          console.warn("Clerk user.created without an email address:", user.id);
          return NextResponse.json({ ok: true, skipped: "no email" });
        }

        const resolved = await resolveAppUser({
          clerkUserId: user.id,
          email,
          name: getName(user),
        });

        return NextResponse.json({ ok: true, linked: resolved.linked, created: resolved.created });
      }

      case "user.updated": {
        // Keep the profile's email in sync with the Clerk primary email so
        // sign-in, email matching and admin lookups keep working after a change.
        const user = event.data as ClerkUserData;
        const email = getPrimaryEmail(user);
        if (!email) {
          return NextResponse.json({ ok: true, skipped: "no email" });
        }

        const profile = await findAppUserByClerkId(user.id);
        if (!profile) {
          // Not linked yet: link by email, or create the public account.
          const resolved = await resolveAppUser({
            clerkUserId: user.id,
            email,
            name: getName(user),
          });
          return NextResponse.json({ ok: true, linked: resolved.linked, created: resolved.created });
        }

        const normalizedEmail = email.trim().toLowerCase();
        if (profile.email.toLowerCase() === normalizedEmail) {
          return NextResponse.json({ ok: true, unchanged: true });
        }

        const { error } = await supabaseAdmin
          .from("users")
          .update({ email: normalizedEmail })
          .eq("id", profile.id);

        if (error?.code === UNIQUE_VIOLATION) {
          // Another profile already owns this email. Retrying will not help,
          // so acknowledge the event and leave it for an admin to merge.
          console.error(
            `Clerk user ${user.id} changed email to ${normalizedEmail}, but another profile already uses it.`,
          );
          return NextResponse.json({ ok: true, conflict: "email already in use" });
        }
        if (error) throw error;

        return NextResponse.json({ ok: true, emailUpdated: true });
      }

      case "user.deleted": {
        // Keep the profile (it is referenced by finance rows); just drop the link.
        const clerkUserId = event.data.id;
        if (clerkUserId) {
          const [usersRes, pnmsRes] = await Promise.all([
            supabaseAdmin.from("users").update({ clerk_user_id: null }).eq("clerk_user_id", clerkUserId),
            supabaseAdmin.from("pnms").update({ clerk_user_id: null }).eq("clerk_user_id", clerkUserId),
          ]);
          if (usersRes.error) throw usersRes.error;
          if (pnmsRes.error) throw pnmsRes.error;
        }
        return NextResponse.json({ ok: true });
      }

      default:
        return NextResponse.json({ ok: true, ignored: event.type });
    }
  } catch (error) {
    console.error(`Clerk webhook ${event.type} failed:`, error);
    // Non-2xx makes Clerk retry the delivery.
    return NextResponse.json({ error: "Failed to process event." }, { status: 500 });
  }
}

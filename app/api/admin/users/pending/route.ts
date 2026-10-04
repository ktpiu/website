import { clerkClient } from "@clerk/nextjs/server";
import type { User as ClerkUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import {
  assertAdminViewPermission,
  requireAppAuthContext,
  RouteAuthError,
} from "@/lib/server-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { AccessReview } from "@/lib/app-user";

type PendingClerkUser = {
  clerkUserId: string;
  email: string | null;
  name: string | null;
  imageUrl: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  /** An unlinked profile with the same email exists: approving links instead of creating. */
  matchingProfile: { id: string; name: string } | null;
};

type DeniedClerkUser = PendingClerkUser & {
  note: string | null;
  reviewedAt: string;
  reviewedBy: { id: string; name: string } | null;
};

type ProfileRow = {
  id: string;
  name: string | null;
  email: string | null;
  clerk_user_id: string | null;
};

const PAGE_SIZE = 100;
/** Hard stop so a runaway Clerk instance cannot keep the request open forever. */
const MAX_PAGES = 50;

function getClerkEmail(user: ClerkUser) {
  const primary = user.emailAddresses.find(
    (address) => address.id === user.primaryEmailAddressId,
  );
  const email = primary?.emailAddress ?? user.emailAddresses[0]?.emailAddress;
  return typeof email === "string" && email.length > 0 ? email : null;
}

function getClerkName(user: ClerkUser) {
  const full =
    user.fullName || [user.firstName, user.lastName].filter(Boolean).join(" ");
  return full && full.trim().length > 0 ? full.trim() : null;
}

async function listAllClerkUsers() {
  const client = await clerkClient();
  const users: ClerkUser[] = [];
  let offset = 0;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data, totalCount } = await client.users.getUserList({
      limit: PAGE_SIZE,
      offset,
      orderBy: "-created_at",
    });

    users.push(...data);
    offset += data.length;

    if (data.length < PAGE_SIZE || users.length >= totalCount) break;
  }

  return users;
}

/**
 * Lists Clerk accounts that have no linked public.users profile, split into
 * pending (awaiting a decision) and denied (recorded in user_access_reviews).
 */
export async function GET() {
  try {
    const authContext = await requireAppAuthContext();
    assertAdminViewPermission(authContext);

    if (!process.env.CLERK_SECRET_KEY) {
      return NextResponse.json(
        {
          error:
            "CLERK_SECRET_KEY is not configured, so pending sign-ups cannot be listed.",
        },
        { status: 503 },
      );
    }

    const [clerkUsers, profilesRes, reviewsRes] = await Promise.all([
      listAllClerkUsers(),
      supabaseAdmin.from("users").select("id, name, email, clerk_user_id"),
      supabaseAdmin.from("user_access_reviews").select("*"),
    ]);

    if (profilesRes.error) throw profilesRes.error;
    if (reviewsRes.error) throw reviewsRes.error;

    const profiles = (profilesRes.data ?? []) as ProfileRow[];
    const reviews = (reviewsRes.data ?? []) as AccessReview[];

    const linkedClerkIds = new Set(
      profiles.flatMap((row) => (row.clerk_user_id ? [row.clerk_user_id] : [])),
    );
    const unlinkedProfilesByEmail = new Map<string, ProfileRow>();
    for (const row of profiles) {
      if (!row.clerk_user_id && row.email) {
        unlinkedProfilesByEmail.set(row.email.trim().toLowerCase(), row);
      }
    }
    const reviewsByClerkId = new Map(
      reviews.map((review) => [review.clerk_user_id, review]),
    );

    const reviewerIds = Array.from(
      new Set(
        reviews.flatMap((review) =>
          review.reviewed_by ? [review.reviewed_by] : [],
        ),
      ),
    );
    const reviewerNames = new Map<string, string>();
    if (reviewerIds.length > 0) {
      const { data, error } = await supabaseAdmin
        .from("users")
        .select("id, name")
        .in("id", reviewerIds);
      if (error) throw error;
      for (const row of (data ?? []) as Array<{ id: string; name: string | null }>) {
        reviewerNames.set(row.id, row.name ?? "");
      }
    }

    const pending: PendingClerkUser[] = [];
    const denied: DeniedClerkUser[] = [];

    for (const clerkUser of clerkUsers) {
      if (linkedClerkIds.has(clerkUser.id)) continue;
      // Rush candidates' accounts are managed from the rush section.
      if (clerkUser.publicMetadata?.accountType === "pnm") continue;

      const email = getClerkEmail(clerkUser);
      if (!email) continue;

      const match = unlinkedProfilesByEmail.get(email.trim().toLowerCase());
      const base: PendingClerkUser = {
        clerkUserId: clerkUser.id,
        email,
        name: getClerkName(clerkUser),
        imageUrl: clerkUser.imageUrl || null,
        createdAt: new Date(clerkUser.createdAt).toISOString(),
        lastSignInAt: clerkUser.lastSignInAt
          ? new Date(clerkUser.lastSignInAt).toISOString()
          : null,
        matchingProfile: match ? { id: match.id, name: match.name ?? "" } : null,
      };

      const review = reviewsByClerkId.get(clerkUser.id);
      if (review) {
        denied.push({
          ...base,
          note: review.note,
          reviewedAt: review.reviewed_at,
          reviewedBy: review.reviewed_by
            ? {
                id: review.reviewed_by,
                name: reviewerNames.get(review.reviewed_by) ?? "",
              }
            : null,
        });
      } else {
        pending.push(base);
      }
    }

    return NextResponse.json({ pending, denied }, { status: 200 });
  } catch (error) {
    if (error instanceof RouteAuthError) {
      return NextResponse.json(error.toResponseBody(), { status: error.status });
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to load pending sign-ups.",
      },
      { status: 500 },
    );
  }
}

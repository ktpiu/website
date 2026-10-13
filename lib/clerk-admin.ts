import "server-only";
import { clerkClient } from "@clerk/nextjs/server";
import type { User as ClerkUser } from "@clerk/nextjs/server";

const PAGE_SIZE = 100;
/** Hard stop so a runaway Clerk instance cannot keep the request open forever. */
const MAX_PAGES = 50;

export function getClerkEmail(user: ClerkUser) {
  const primary = user.emailAddresses.find((address) => address.id === user.primaryEmailAddressId);
  const email = primary?.emailAddress ?? user.emailAddresses[0]?.emailAddress;
  return typeof email === "string" && email.length > 0 ? email : null;
}

export function getClerkName(user: ClerkUser) {
  const full = user.fullName || [user.firstName, user.lastName].filter(Boolean).join(" ");
  return full && full.trim().length > 0 ? full.trim() : null;
}

export async function listAllClerkUsers() {
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

function isClerkNotFound(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status?: unknown }).status === 404
  );
}

/** The Clerk account, or null when it no longer exists. */
export async function getClerkUser(clerkUserId: string) {
  const client = await clerkClient();
  try {
    return await client.users.getUser(clerkUserId);
  } catch (error) {
    if (isClerkNotFound(error)) return null;
    throw error;
  }
}

#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const args = new Set(process.argv.slice(2));
const isDryRun = args.has("--dry-run");
const shouldCreate = args.has("--create");
const showHelp = args.has("--help") || args.has("-h");
const pageSize = 100;

function stripWrappingQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function loadLocalEnvFile(fileName) {
  const filePath = path.join(process.cwd(), fileName);
  if (!fs.existsSync(filePath)) return;

  const contents = fs.readFileSync(filePath, "utf8");
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = line.slice(0, separatorIndex).trim();
    const value = stripWrappingQuotes(line.slice(separatorIndex + 1).trim());

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadLocalEnvFile(".env");
loadLocalEnvFile(".env.local");

function printHelp() {
  console.log(`Link Clerk users to their Supabase profiles by Clerk user id

For every Clerk user this script finds the matching public.users row
(by clerk_user_id, then by email) and sets users.clerk_user_id when it is
missing. Clerk users with no matching profile are reported as "pending":
they are approved (or denied) by an admin from User Management, so this
script does not create profiles unless --create is passed.

Usage:
  npm run backfill:clerk-users
  npm run backfill:clerk-users -- --dry-run
  npm run backfill:clerk-users -- --create

Options:
  --dry-run   Report what would change without writing
  --create    Also create a profile for Clerk users that have none
  --help      Show this message

Requires CLERK_SECRET_KEY, NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY.
`);
}

function getRequiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function buildFallbackName(email) {
  const localPart = email.split("@")[0] ?? "Member";
  const tokens = localPart
    .split(/[._-]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length === 0) return "Member";

  return tokens
    .map((token) => token[0].toUpperCase() + token.slice(1))
    .join(" ");
}

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

function normalizeName(name, email) {
  const value = name?.trim();
  return value && value.length > 0 ? value : buildFallbackName(email);
}

function buildNewUserPayload({ clerkUserId, email, name }) {
  return {
    clerk_user_id: clerkUserId,
    email,
    name,
    role: "newmember",
    avatar: "",
    graduation_year: null,
    account_status: "public",
    major: "",
    title: "",
    socials: [],
  };
}

function getUserEmail(user) {
  const sdkPrimaryEmail = user.primaryEmailAddress?.emailAddress;
  if (sdkPrimaryEmail) return sdkPrimaryEmail;

  const sdkFirstEmail = user.emailAddresses?.[0]?.emailAddress;
  if (sdkFirstEmail) return sdkFirstEmail;

  const primaryEmailId = user.primary_email_address_id ?? null;
  const rawEmailAddresses = Array.isArray(user.email_addresses)
    ? user.email_addresses
    : [];

  if (primaryEmailId) {
    const primaryEmail = rawEmailAddresses.find(
      (emailAddress) => emailAddress?.id === primaryEmailId
    )?.email_address;

    if (primaryEmail) return primaryEmail;
  }

  const rawFirstEmail = rawEmailAddresses[0]?.email_address;
  return rawFirstEmail ?? null;
}

function getUserName(user) {
  const sdkName =
    user.fullName ??
    [user.firstName, user.lastName].filter(Boolean).join(" ");

  if (sdkName) return sdkName;

  const rawName = [user.first_name, user.last_name].filter(Boolean).join(" ");
  return rawName || user.username || null;
}

function normalizeUserPage(page) {
  if (Array.isArray(page)) {
    return {
      users: page,
      totalCount: null,
    };
  }

  return {
    users: Array.isArray(page?.data) ? page.data : [],
    totalCount:
      typeof page?.totalCount === "number"
        ? page.totalCount
        : typeof page?.total_count === "number"
          ? page.total_count
          : null,
  };
}
const clerkSecretKey = getRequiredEnv("CLERK_SECRET_KEY");

// The secret key is required: public.users is protected by RLS and only the
// server may create profiles or set clerk_user_id.
const supabase = createClient(
  getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
  process.env.SUPABASE_SECRET_KEY?.trim() ||
    getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false } },
);

async function getClerkUserPage(limit, offset) {
  const response = await fetch(
    `https://api.clerk.com/v1/users?limit=${limit}&offset=${offset}`,
    {
      headers: {
        Authorization: `Bearer ${clerkSecretKey}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Clerk API request failed (${response.status}): ${body}`);
  }

  return response.json();
}

async function findAppUserByClerkId(clerkUserId) {
  const { data, error } = await supabase
    .from("users")
    .select("id, email, clerk_user_id")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();

  if (error) throw error;

  return data ?? null;
}

async function findAppUserByEmail(email) {
  const normalizedEmail = normalizeEmail(email);

  const { data, error } = await supabase
    .from("users")
    .select("id, email, clerk_user_id")
    .ilike("email", normalizedEmail)
    .maybeSingle();

  if (error) throw error;

  return data ?? null;
}

// Returns { status: "existing" | "linked" | "created" | "pending" | "conflict", user }
async function ensureAppUser({ clerkUserId, email, name }) {
  const normalizedEmail = normalizeEmail(email);

  const linkedUser = await findAppUserByClerkId(clerkUserId);
  if (linkedUser) {
    return { status: "existing", user: linkedUser };
  }

  const existingByEmail = await findAppUserByEmail(normalizedEmail);
  if (existingByEmail) {
    if (
      existingByEmail.clerk_user_id &&
      existingByEmail.clerk_user_id !== clerkUserId
    ) {
      return { status: "conflict", user: existingByEmail };
    }

    if (isDryRun) {
      return { status: "linked", user: existingByEmail };
    }

    const { data, error } = await supabase
      .from("users")
      .update({ clerk_user_id: clerkUserId })
      .eq("id", existingByEmail.id)
      .is("clerk_user_id", null)
      .select("id, email, clerk_user_id")
      .maybeSingle();

    if (error) throw error;

    return { status: "linked", user: data ?? existingByEmail };
  }

  const payload = buildNewUserPayload({
    clerkUserId,
    email: normalizedEmail,
    name: normalizeName(name, normalizedEmail),
  });

  if (!shouldCreate) {
    return { status: "pending", user: payload };
  }

  if (isDryRun) {
    return { status: "created", user: payload };
  }

  const { data, error } = await supabase
    .from("users")
    .insert(payload)
    .select("id, email, clerk_user_id")
    .single();

  if (!error && data) {
    return { status: "created", user: data };
  }

  const racedUser =
    (await findAppUserByClerkId(clerkUserId)) ??
    (await findAppUserByEmail(normalizedEmail));
  if (racedUser) {
    return { status: "existing", user: racedUser };
  }

  throw error ?? new Error(`Failed to provision app user for ${normalizedEmail}`);
}

async function main() {
  if (showHelp) {
    printHelp();
    return;
  }

  let offset = 0;
  let fetched = 0;
  let processed = 0;
  let created = 0;
  let linked = 0;
  let conflicts = 0;
  let pending = 0;
  let skippedNoEmail = 0;

  console.log(
    isDryRun
      ? "Running Clerk user backfill in dry-run mode..."
      : "Running Clerk user backfill..."
  );

  while (true) {
    const page = await getClerkUserPage(pageSize, offset);
    const { users, totalCount } = normalizeUserPage(page);

    if (users.length === 0) break;
    fetched += users.length;

    for (const user of users) {
      const email = getUserEmail(user);
      if (!email) {
        skippedNoEmail += 1;
        continue;
      }

      const clerkUserId = user.id;
      if (!clerkUserId) {
        skippedNoEmail += 1;
        continue;
      }

      const { status } = await ensureAppUser({
        clerkUserId,
        email,
        name: getUserName(user),
      });

      processed += 1;
      const prefix = isDryRun ? "[dry-run] would " : "";

      if (status === "created") {
        created += 1;
        console.log(`${prefix}create ${email} (${clerkUserId})`);
      } else if (status === "linked") {
        linked += 1;
        console.log(`${prefix}link ${email} -> ${clerkUserId}`);
      } else if (status === "pending") {
        pending += 1;
        console.log(`pending: ${email} (${clerkUserId}) has no profile; approve it from User Management`);
      } else if (status === "conflict") {
        conflicts += 1;
        console.warn(
          `conflict: ${email} is already linked to a different Clerk user; skipped ${clerkUserId}`
        );
      }
    }

    offset += users.length;

    if (totalCount !== null && offset >= totalCount) {
      break;
    }

    if (users.length < pageSize) {
      break;
    }
  }

  console.log("");
  console.log(`Fetched ${fetched} Clerk user(s).`);
  console.log(`Processed ${processed} Clerk users with email addresses.`);
  console.log(`${isDryRun ? "Would create" : "Created"} ${created} Supabase profile(s).`);
  console.log(`${isDryRun ? "Would link" : "Linked"} ${linked} existing profile(s).`);

  if (pending > 0) {
    console.log(`${pending} Clerk user(s) have no profile and are waiting for admin approval.`);
  }

  if (conflicts > 0) {
    console.log(`${conflicts} profile(s) were already linked to a different Clerk user.`);
  }

  if (skippedNoEmail > 0) {
    console.log(`Skipped ${skippedNoEmail} Clerk user(s) without an email address or id.`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

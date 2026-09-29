import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

type ClerkSessionLike = {
  getToken: () => Promise<string | null>;
};

type ClerkGlobal = {
  session?: ClerkSessionLike | null;
};

/**
 * Supabase is configured with Clerk as a third-party auth provider, so the
 * Clerk session token is sent as the Supabase access token. Postgres then sees
 * the request as `authenticated` with the Clerk user id in the JWT `sub` claim,
 * which `public.current_app_user_id()` resolves to a `users` row for RLS.
 *
 * Returns null when there is no Clerk session (public pages, server rendering),
 * in which case requests fall back to the anon role.
 */
async function getClerkSessionToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;

  const clerk = (window as Window & { Clerk?: ClerkGlobal }).Clerk;
  const session = clerk?.session;
  if (!session) return null;

  try {
    return (await session.getToken()) ?? null;
  } catch (error) {
    console.error("Failed to read Clerk session token for Supabase:", error);
    return null;
  }
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  accessToken: getClerkSessionToken,
});

export type UserRole = "admin" | "exec" | "director" | "member" | "newmember";

export type RoleType = "general" | "pledge_class" | "exec" | "director";

export interface Role {
  id: string;
  name: string;
  description: string;
  hidden: boolean;
  priority: number;
  type: RoleType;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  created_at: string;
  avatar: string;
  socials: JSON;
  major: string;
  title: string;
  /** Expected graduation year; grade is derived from it (see lib/members.ts). */
  graduation_year: number | null;
  /** Set manually once a member graduates. */
  is_alumni: boolean;
  /** Hidden from all public pages (members, board). */
  is_hidden: boolean;
  /** Temporarily inactive (e.g. studying abroad). Admin-facing only. */
  is_inactive: boolean;
  /** Dropped/disaffiliated: hidden publicly and blocked from the member portal. */
  is_disaffiliated: boolean;
  clerk_user_id?: string | null;
}

export interface Announcement {
  id: string;
  title: string;
  content: string;
  author_id: string;
  author_name: string;
  created_at: string;
  updated_at: string;
  hidden: boolean;
}

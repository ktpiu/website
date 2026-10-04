import "server-only";
import { createHmac, timingSafeEqual } from "crypto";

/**
 * Signed, expiring links emailed to PNMs. The account setup link proves the
 * PNM owns the address, so the Clerk account it creates starts verified.
 */

const SETUP_LINK_TTL_SECONDS = 7 * 24 * 60 * 60;

type SetupPayload = { pnmId: string; purpose: "setup"; exp: number };

function getSecret() {
  const secret = process.env.RUSH_LINK_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("RUSH_LINK_SECRET is not set (use at least 16 random characters).");
  }
  return secret;
}

function sign(data: string) {
  return createHmac("sha256", getSecret()).update(data).digest("base64url");
}

export function createSetupToken(pnmId: string) {
  const payload: SetupPayload = {
    pnmId,
    purpose: "setup",
    exp: Math.floor(Date.now() / 1000) + SETUP_LINK_TTL_SECONDS,
  };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${data}.${sign(data)}`;
}

/** Returns the PNM id for a valid, unexpired setup token, otherwise null. */
export function verifySetupToken(token: string): string | null {
  const [data, signature] = token.split(".");
  if (!data || !signature) return null;

  const expected = Buffer.from(sign(data));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString()) as SetupPayload;
    if (payload.purpose !== "setup" || typeof payload.pnmId !== "string") return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload.pnmId;
  } catch {
    return null;
  }
}

export function getSiteUrl(request?: Request) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/$/, "");
  if (request) return new URL(request.url).origin;
  return "http://localhost:3000";
}

export function buildSetupUrl(pnmId: string, request?: Request) {
  return `${getSiteUrl(request)}/rush/account/setup?token=${encodeURIComponent(createSetupToken(pnmId))}`;
}

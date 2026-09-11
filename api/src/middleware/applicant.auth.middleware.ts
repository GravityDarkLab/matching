import { Context, Next } from "hono";
import { env } from "../config/env.js";
import { APPLICANT_COOKIE_NAME } from "../config/constants.js";
import { signJwt, verifyJwt, expiryToSeconds, extractToken } from "./jwt.util.js";

const EXPIRY = env.applicantJwtExpiry;

export const APPLICANT_COOKIE_MAX_AGE = expiryToSeconds(EXPIRY);

export async function signApplicantToken(applicantId: string, alias: string): Promise<string> {
  return signJwt({ sub: applicantId, alias, type: "applicant" }, EXPIRY);
}

async function verifyApplicantToken(token: string): Promise<{ sub: string; alias: string } | null> {
  try {
    const payload = await verifyJwt(token);
    if (!payload.sub || payload.type !== "applicant") return null;
    return { sub: payload.sub as string, alias: payload.alias as string };
  } catch {
    return null;
  }
}

export async function requireApplicant(c: Context, next: Next): Promise<Response | void> {
  // Prefer Bearer header for API clients; fall back to HttpOnly session cookie
  const token = extractToken(c, APPLICANT_COOKIE_NAME, false);
  if (!token) {
    return c.json({ success: false, error: "Unauthorized" }, 401);
  }

  const claims = await verifyApplicantToken(token);
  if (!claims) {
    return c.json({ success: false, error: "Invalid or expired token" }, 401);
  }

  c.set("applicantId",    claims.sub);
  c.set("applicantAlias", claims.alias);
  await next();
}

/**
 * Non-throwing session check — returns the authenticated applicant's ID if
 * the request carries a valid session, or null otherwise. Used by endpoints
 * that behave differently for an already-authenticated caller without
 * requiring authentication.
 */
export async function tryGetApplicantSession(c: Context): Promise<string | null> {
  const token = extractToken(c, APPLICANT_COOKIE_NAME, false);
  if (!token) return null;
  const claims = await verifyApplicantToken(token);
  return claims?.sub ?? null;
}

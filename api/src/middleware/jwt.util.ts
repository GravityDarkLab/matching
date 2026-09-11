import { Context } from "hono";
import { getCookie } from "hono/cookie";
import { jwtVerify, SignJWT, type JWTPayload } from "jose";
import { env } from "../config/env.js";
import { JWT_ALGORITHM } from "../config/constants.js";

const JWT_SECRET = new TextEncoder().encode(env.jwtSecret);

/** Signs `claims` into a JWT, expiring after `expiry` (e.g. "8h", "30d"). */
export async function signJwt(claims: Record<string, unknown>, expiry: string): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: JWT_ALGORITHM })
    .setIssuedAt()
    .setExpirationTime(expiry)
    .sign(JWT_SECRET);
}

/** Verifies a JWT and returns its payload. Throws if invalid, expired, or wrong algorithm. */
export async function verifyJwt(token: string): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, JWT_SECRET, { algorithms: [JWT_ALGORITHM] });
  return payload;
}

/**
 * Converts a JWT expiry string (e.g. "8h", "30d") to seconds for cookie maxAge.
 */
export function expiryToSeconds(expiry: string): number {
  const match = expiry.match(/^(\d+)(s|m|h|d|w)$/);
  if (!match) return 8 * 3600;
  const n = parseInt(match[1], 10);
  const units: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };
  return n * (units[match[2]] ?? 3600);
}

/**
 * Extracts a JWT from the request's session cookie or `Authorization: Bearer`
 * header. `preferCookie` controls which source wins when both are present.
 */
export function extractToken(c: Context, cookieName: string, preferCookie: boolean): string | null {
  const cookieToken = getCookie(c, cookieName) ?? null;

  const header = c.req.header("Authorization");
  const bearerToken = header?.startsWith("Bearer ") ? header.slice(7) : null;

  return preferCookie ? (cookieToken ?? bearerToken) : (bearerToken ?? cookieToken);
}

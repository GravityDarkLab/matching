import type { Context } from "hono";
import { getConnInfo } from "hono/bun";
import { env } from "../config/env.js";

/**
 * Number of trusted reverse-proxy hops in front of this server. This app
 * ships exactly one: internet → nginx → api (see docker-compose.yml,
 * frontend/nginx.conf). nginx sets X-Forwarded-For via
 * `$proxy_add_x_forwarded_for`, which APPENDS to any value the client
 * already sent rather than overwriting it — so only the entry added by our
 * own proxy (one hop from the right) is trustworthy; every entry to its
 * left, including a naive "first" one, is client-supplied and spoofable.
 * ponytail: hardcoded to the one topology this app ships; promote to a
 * TRUST_PROXY_HOPS env var if a second hop (e.g. a CDN in front of nginx)
 * is ever added.
 */
const TRUSTED_PROXY_HOPS = 1;

/**
 * Client IP for rate limiting and audit logs.
 *
 * Proxy headers (X-Forwarded-For, then X-Real-IP as a fallback) are believed
 * ONLY when `trustProxy` is set (TRUST_PROXY=true, i.e. a trusted reverse
 * proxy sits in front of the server). Without that gate a direct client can
 * spoof a fresh IP per request — bypassing every per-IP rate limit (form
 * submits, login brute-force) and planting arbitrary addresses in the audit
 * log. When trusted, the client IP is taken TRUSTED_PROXY_HOPS entries from
 * the *right* of X-Forwarded-For (see above) — never the leftmost entry.
 *
 * Otherwise falls back to the raw socket address, which keeps
 * rate-limiting/audit keyed per-client in direct-to-Bun setups (e.g. local
 * dev). getConnInfo throws outside a real Bun server (e.g. Hono's in-memory
 * test client), so that branch degrades to "unknown" rather than crashing
 * the request.
 *
 * `trustProxy` is a parameter (defaulting to the env singleton) so both
 * branches are unit-testable without mocking config/env.js.
 */
export function getClientIp(c: Context, trustProxy: boolean = env.trustProxy): string {
  if (trustProxy) {
    const forwardedFor = c.req.header("x-forwarded-for");
    if (forwardedFor) {
      const hops = forwardedFor.split(",").map((ip) => ip.trim()).filter(Boolean);
      const trustedIndex = hops.length - TRUSTED_PROXY_HOPS;
      if (trustedIndex >= 0) return hops[trustedIndex];
    }
    const realIp = c.req.header("x-real-ip");
    if (realIp) return realIp;
  }
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}

/** { ipAddress, userAgent } — the pair nearly every audited or rate-limited request needs. */
export function getRequestMeta(
  c: Context,
  trustProxy: boolean = env.trustProxy
): { ipAddress: string; userAgent: string } {
  return {
    ipAddress: getClientIp(c, trustProxy),
    userAgent: c.req.header("user-agent") ?? "unknown",
  };
}

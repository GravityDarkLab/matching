import type { Context } from "hono";
import { getConnInfo } from "hono/bun";
import { env } from "../config/env.js";

/**
 * Client IP for rate limiting and audit logs.
 *
 * Proxy headers (X-Forwarded-For → X-Real-IP) are believed ONLY when
 * `trustProxy` is set (TRUST_PROXY=true, i.e. a trusted reverse proxy that
 * overwrites those headers sits in front of the server). Without that gate a
 * direct client can spoof a fresh IP per request — bypassing every per-IP
 * rate limit (form submits, login brute-force) and planting arbitrary
 * addresses in the audit log.
 *
 * Otherwise falls back to the raw socket address, which keeps
 * rate-limiting/audit keyed per-client in direct-to-Bun setups (e.g. local
 * dev). getConnInfo throws outside a real Bun server (e.g. Hono's in-memory
 * test client), so that branch degrades to "unknown" rather than crashing
 * the request.
 *
 * `trustProxy` is a parameter (defaulting to the env singleton) so both
 * branches are unit-testable without mocking config/env.js — same pattern
 * as ai.service.ts's buildChatEndpoint.
 */
export function getClientIp(c: Context, trustProxy: boolean = env.trustProxy): string {
  if (trustProxy) {
    const forwarded =
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip");
    if (forwarded) return forwarded;
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

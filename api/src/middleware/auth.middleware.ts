import { Context, Next } from "hono";
import { env } from "../config/env.js";
import { ADMIN_COOKIE_NAME } from "../config/constants.js";
import { type AdminRole, ADMIN_ROLES } from "../models/admin.model.js";
import { signJwt, verifyJwt, expiryToSeconds, extractToken } from "./jwt.util.js";

const EXPIRY = env.adminJwtExpiry;

export async function signAdminToken(adminId: string, username: string, role: AdminRole): Promise<string> {
  return signJwt({ sub: adminId, username, role }, EXPIRY);
}

export const COOKIE_MAX_AGE = expiryToSeconds(EXPIRY);

export async function requireAdmin(c: Context, next: Next): Promise<Response | void> {
  // Cookie is preferred for browser clients (HttpOnly, no JS access).
  // Authorization header is kept for API clients and tests.
  const token = extractToken(c, ADMIN_COOKIE_NAME, true);

  if (!token) {
    return c.json({ success: false, error: "Unauthorized" }, 401);
  }

  try {
    const payload = await verifyJwt(token);

    if (!payload.sub || !ADMIN_ROLES.includes(payload.role as AdminRole)) {
      return c.json({ success: false, error: "Insufficient permissions" }, 403);
    }

    c.set("adminId",       payload.sub      as string);
    c.set("adminUsername", payload.username as string);
    c.set("adminRole",     payload.role     as AdminRole);
    await next();
  } catch {
    return c.json({ success: false, error: "Invalid or expired token" }, 401);
  }
}

export function requireRole(...roles: AdminRole[]) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const role = c.get("adminRole") as AdminRole | undefined;
    if (!role || !roles.includes(role)) {
      return c.json({ success: false, error: "Insufficient permissions" }, 403);
    }
    await next();
  };
}

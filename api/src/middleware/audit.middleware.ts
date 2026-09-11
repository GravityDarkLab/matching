import { Context } from "hono";
import { ObjectId } from "mongodb";
import { getDb } from "../db/connection.js";
import { getAuditLogsCollection } from "../db/collections.js";
import type { AuditAction } from "../models/auditLog.model.js";
import { getRequestMeta } from "../utils/request-meta.js";

export interface AuditContext {
  // The actor performing the action — an admin's id for admin-initiated
  // actions, or the applicant's own id for self-service actions. Stored as
  // `adminId` in `AuditLogDoc` regardless of which.
  actorId: string;
  ipAddress: string;
  userAgent: string;
}

/**
 * Writes an audit log entry. Fire-and-forget — does not throw on failure
 * (we log the error instead so the main response is not affected).
 */
export async function writeAuditLog(
  ctx: AuditContext,
  action: AuditAction,
  opts?: {
    targetAlias?: string;
    targetApplicantId?: ObjectId;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    const db = await getDb();
    const auditLogs = getAuditLogsCollection(db);

    await auditLogs.insertOne({
      _id: new ObjectId(),
      adminId: ctx.actorId,
      action,
      targetAlias: opts?.targetAlias,
      targetApplicantId: opts?.targetApplicantId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      timestamp: new Date(),
      metadata: opts?.metadata,
    });
  } catch (err) {
    // Audit log failure should never block the response
    console.error("[AUDIT] Failed to write audit log:", err);
  }
}

/**
 * Extracts audit context from a Hono context.
 * Prefers proxy headers (x-forwarded-for, x-real-ip) set by a reverse proxy,
 * then falls back to the raw socket address exposed by Bun via getConnInfo.
 */
export function extractAuditContext(
  actorId: string,
  c: Context
): AuditContext {
  const { ipAddress, userAgent } = getRequestMeta(c);
  return { actorId, ipAddress, userAgent };
}

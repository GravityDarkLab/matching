import { ObjectId } from "mongodb";
import { AppError } from "../errors.js";
import { getDb } from "../db/connection.js";
import {
  getApplicantsCollection,
  getAuditLogsCollection,
  getQuestionnairesCollection,
  getAdminsCollection,
} from "../db/collections.js";
import type { ApplicantDoc, ApplicantStatus } from "../models/applicant.model.js";
import type { AuditLogDoc } from "../models/auditLog.model.js";
import type { CreateQuestionnaireInput } from "../validators/admin.validator.js";
import { revealIdentityById } from "../privacy/identity.service.js";
import type { AuditContext } from "../middleware/audit.middleware.js";
import { signAdminToken } from "../middleware/auth.middleware.js";
import { DELETION_GRACE_MS } from "./match-state.service.js";
import { generateMagicToken, hashMagicToken } from "../privacy/magic-token.js";
import { escapeRegex } from "../utils/regex.js";

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Validates admin credentials against the admins collection.
 * Returns a signed JWT on success, null on invalid credentials.
 */
export async function adminLogin(
  username: string,
  password: string
): Promise<string | null> {
  const db  = await getDb();
  const col = getAdminsCollection(db);

  const admin = await col.findOne({ username });
  if (!admin) return null;

  const valid = await Bun.password.verify(password, admin.passwordHash);
  if (!valid) return null;

  return signAdminToken(admin._id.toHexString(), admin.username, admin.role);
}

/**
 * Returns a paginated list of applicants, optionally filtered by status
 * and/or a case-insensitive alias search string.
 */
export type ApplicantView = Omit<ApplicantDoc, "_id" | "magicToken" | "passwordHash"> & { id: string };

/**
 * Builds the applicants-collection filter for `listApplicants`.
 *
 * - `scheduledDeletion: true` → only applicants pending deletion (status ignored).
 * - explicit `status` → applicants with that status, scheduled or not.
 * - neither → the "All" tab, which excludes applicants pending deletion.
 */
export function buildApplicantFilter(
  status?: ApplicantStatus,
  search?: string,
  scheduledDeletion?: boolean,
): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  if (scheduledDeletion) {
    filter.deletionScheduledAt = { $exists: true };
  } else if (status) {
    filter.status = status;
  } else {
    filter.deletionScheduledAt = { $exists: false };
  }
  if (search) filter.alias = { $regex: escapeRegex(search), $options: "i" };
  return filter;
}

export async function listApplicants(
  page: number,
  limit: number,
  status?: ApplicantStatus,
  search?: string,
  scheduledDeletion?: boolean,
): Promise<PaginatedResult<ApplicantView>> {
  const db = await getDb();
  const col = getApplicantsCollection(db);

  const filter = buildApplicantFilter(status, search, scheduledDeletion);
  const skip = (page - 1) * limit;

  const [docs, total] = await Promise.all([
    col.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
    col.countDocuments(filter),
  ]);

  const data = docs.map(({ _id, magicToken: _mt, passwordHash: _ph, ...rest }) => ({
    id: _id.toHexString(),
    ...rest,
  }));

  return {
    data,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

/**
 * Returns a single applicant by ID (no sensitive data).
 */
export async function getApplicantById(
  id: string
): Promise<ApplicantView | null> {
  const db = await getDb();
  const col = getApplicantsCollection(db);

  let objectId: ObjectId;
  try {
    objectId = new ObjectId(id);
  } catch {
    return null;
  }

  const doc = await col.findOne({ _id: objectId });
  if (!doc) return null;

  const { _id, magicToken: _mt, passwordHash: _ph, ...rest } = doc;
  return { id: _id.toHexString(), ...rest };
}

/**
 * Resolves and returns the decrypted Instagram handle for an applicant.
 * Admin-only action. revealIdentityById writes the audit log internally —
 * callers must not write a duplicate one.
 */
export async function getApplicantIdentity(
  id: string,
  auditCtx: AuditContext
): Promise<{ alias: string; instagramHandle: string; fullName: string | null } | null> {
  const db = await getDb();
  const col = getApplicantsCollection(db);

  let objectId: ObjectId;
  try {
    objectId = new ObjectId(id);
  } catch {
    return null;
  }

  const applicant = await col.findOne({ _id: objectId });
  if (!applicant) return null;

  const identity = await revealIdentityById(objectId, {
    actor: auditCtx,
    action: "RESOLVE_IDENTITY",
    targetAlias: applicant.alias,
  });
  if (!identity) return null;

  return { alias: applicant.alias, instagramHandle: identity.instagram, fullName: identity.fullName };
}

/**
 * Soft-deletes an applicant: sets status to "inactive" and schedules
 * permanent deletion after DELETION_GRACE_MS, same as self-deactivation.
 */
export async function deactivateApplicant(id: string): Promise<boolean> {
  const db = await getDb();
  const col = getApplicantsCollection(db);

  let objectId: ObjectId;
  try {
    objectId = new ObjectId(id);
  } catch {
    return false;
  }

  const now = new Date();
  const result = await col.updateOne(
    { _id: objectId },
    {
      $set: {
        status: "inactive",
        updatedAt: now,
        deletionScheduledAt: new Date(now.getTime() + DELETION_GRACE_MS),
      },
    }
  );

  return result.matchedCount > 0;
}

/**
 * Issues a fresh magic link for an applicant who lost theirs, invalidating the
 * old one. Only the SHA-256 hash is persisted — the raw token is returned once
 * for the admin to relay. The applicant's password is also cleared, so the new
 * link takes them through first-login set-password again.
 */
export async function regenerateMagicLink(
  id: string
): Promise<{ alias: string; magicToken: string } | null> {
  const db = await getDb();
  const col = getApplicantsCollection(db);

  let objectId: ObjectId;
  try {
    objectId = new ObjectId(id);
  } catch {
    return null;
  }

  const magicToken = generateMagicToken();
  const result = await col.findOneAndUpdate(
    { _id: objectId },
    {
      $set: {
        magicToken: hashMagicToken(magicToken),
        passwordHash: null,
        updatedAt: new Date(),
      },
    },
    { returnDocument: "after" }
  );

  if (!result) return null;
  return { alias: result.alias, magicToken };
}

/**
 * Creates a new questionnaire and deactivates all existing ones atomically.
 * Returns the new questionnaire's version and id.
 */
export async function createQuestionnaire(
  input: CreateQuestionnaireInput
): Promise<{ id: string; version: string; deactivatedCount: number }> {
  const db = await getDb();
  const col = getQuestionnairesCollection(db);

  const existing = await col.findOne({ version: input.version });
  if (existing) {
    throw new AppError(`Questionnaire version ${input.version} already exists.`, 409);
  }

  const now = new Date();
  const newId = new ObjectId();

  // Deactivate all current questionnaires, then insert the new active one
  const { modifiedCount } = await col.updateMany(
    { isActive: true },
    { $set: { isActive: false, updatedAt: now } }
  );

  await col.insertOne({
    _id: newId,
    version: input.version,
    name: input.name,
    isActive: true,
    sections: input.sections,
    createdAt: now,
    updatedAt: now,
  });

  return { id: newId.toHexString(), version: input.version, deactivatedCount: modifiedCount };
}

export interface AuditLogView {
  id: string;
  adminId: string;
  action: AuditLogDoc["action"];
  targetAlias?: string;
  targetApplicantId?: string;
  ipAddress: string;
  userAgent: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Returns a paginated list of audit logs, newest first.
 */
export async function listAuditLogs(
  page: number,
  limit: number
): Promise<PaginatedResult<AuditLogView>> {
  const db = await getDb();
  const col = getAuditLogsCollection(db);

  const skip = (page - 1) * limit;

  const [docs, total] = await Promise.all([
    col.find({}).sort({ timestamp: -1 }).skip(skip).limit(limit).toArray(),
    col.countDocuments({}),
  ]);

  const data: AuditLogView[] = docs.map((doc) => ({
    id: doc._id.toHexString(),
    adminId: doc.adminId,
    action: doc.action,
    targetAlias: doc.targetAlias,
    targetApplicantId: doc.targetApplicantId?.toHexString(),
    ipAddress: doc.ipAddress,
    userAgent: doc.userAgent,
    timestamp: doc.timestamp,
    metadata: doc.metadata,
  }));

  return {
    data,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

import { ObjectId } from "mongodb";
import { getDb } from "../db/connection.js";
import { getIdentitiesCollection } from "../db/collections.js";
import { encrypt, decrypt } from "./encryption.js";
import { hashInstagram } from "./hash.js";
import { writeAuditLog, type AuditContext } from "../middleware/audit.middleware.js";
import type { AuditAction } from "../models/auditLog.model.js";

export async function storeIdentity(
  applicantId: ObjectId,
  alias: string,
  instagramHandle: string,
  fullName?: string,
): Promise<void> {
  const db = await getDb();
  const identities = getIdentitiesCollection(db);

  const { encrypted, iv, tag } = encrypt(instagramHandle);

  const doc: Parameters<typeof identities.insertOne>[0] = {
    _id: new ObjectId(),
    applicantId,
    alias,
    encryptedInstagram: encrypted,
    encryptionIv: iv,
    encryptionTag: tag,
    instagramHash: hashInstagram(instagramHandle),
    createdAt: new Date(),
  };

  if (fullName) {
    // A fresh IV per encrypted field, never reusing the handle's — AES-GCM
    // nonce reuse breaks confidentiality even within the same document.
    const { encrypted: encName, iv: ivName, tag: tagName } = encrypt(fullName);
    doc.encryptedFullName = encName;
    doc.fullNameIv = ivName;
    doc.fullNameTag = tagName;
  }

  await identities.insertOne(doc);
}

export async function checkInstagramExists(handle: string): Promise<boolean> {
  const db = await getDb();
  const identities = getIdentitiesCollection(db);
  const hash = hashInstagram(handle);
  const doc = await identities.findOne({ instagramHash: hash }, { projection: { _id: 1 } });
  return doc !== null;
}

export async function resolveIdentity(alias: string): Promise<string | null> {
  const db = await getDb();
  const identities = getIdentitiesCollection(db);

  const doc = await identities.findOne({ alias });
  if (!doc) return null;

  return decrypt(doc.encryptedInstagram, doc.encryptionIv, doc.encryptionTag);
}

export interface ResolvedIdentity {
  instagram: string;
  fullName: string | null;
}

/**
 * Raw decrypt without an audit log. Only for paths where the reveal has
 * already been logged for this actor (e.g. repeat views of an identity
 * whose first reveal went through revealIdentityById) — every first-time
 * reveal must go through revealIdentityById instead.
 */
export async function resolveIdentityById(
  applicantId: ObjectId
): Promise<ResolvedIdentity | null> {
  const db = await getDb();
  const identities = getIdentitiesCollection(db);

  const doc = await identities.findOne({ applicantId });
  if (!doc) return null;

  const instagram = decrypt(doc.encryptedInstagram, doc.encryptionIv, doc.encryptionTag);
  const fullName =
    doc.encryptedFullName && doc.fullNameIv && doc.fullNameTag
      ? decrypt(doc.encryptedFullName, doc.fullNameIv, doc.fullNameTag)
      : null;

  return { instagram, fullName };
}

export interface IdentityRevealAudit {
  /** Who triggered the decryption — an admin id or an applicant id. */
  actor: AuditContext;
  /** RESOLVE_IDENTITY for admins, APPLICANT_REVEAL_IDENTITY for applicants. */
  action: AuditAction;
  targetAlias?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Decrypts an applicant's identity (Instagram handle + full name, if on
 * record) and writes the mandatory audit log entry before the plaintext is
 * returned. This is the canonical way to reveal an identity — call sites
 * must not decrypt and log separately.
 */
export async function revealIdentityById(
  applicantId: ObjectId,
  audit: IdentityRevealAudit
): Promise<ResolvedIdentity | null> {
  const resolved = await resolveIdentityById(applicantId);
  if (!resolved) return null;

  await writeAuditLog(audit.actor, audit.action, {
    targetAlias: audit.targetAlias,
    targetApplicantId: applicantId,
    metadata: audit.metadata,
  });

  return resolved;
}

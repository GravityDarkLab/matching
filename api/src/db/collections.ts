import { Collection, Db, IndexSpecification } from "mongodb";
import type { QuestionnaireDoc } from "../models/questionnaire.model.js";
import type { ApplicantDoc } from "../models/applicant.model.js";
import type { IdentityDoc } from "../models/identity.model.js";
import type { AuditLogDoc } from "../models/auditLog.model.js";
import type { EmbeddingDoc } from "../models/embedding.model.js";
import type { AdminDoc } from "../models/admin.model.js";
import type { MatchDoc } from "../models/match.model.js";
import type { AppConfigDoc } from "../models/appConfig.model.js";
import type { MatchRerankDoc } from "../models/match-rerank.model.js";

export const COLLECTION_NAMES = {
  questionnaires: "questionnaires",
  applicants:     "applicants",
  identities:     "identities",
  auditLogs:      "audit_logs",
  embeddings:     "embeddings",
  admins:         "admins",
  matches:        "matches",
  appConfig:      "app_config",
  matchReranks:   "match_reranks",
} as const;

export function getQuestionnairesCollection(
  db: Db
): Collection<QuestionnaireDoc> {
  return db.collection<QuestionnaireDoc>(COLLECTION_NAMES.questionnaires);
}

export function getApplicantsCollection(db: Db): Collection<ApplicantDoc> {
  return db.collection<ApplicantDoc>(COLLECTION_NAMES.applicants);
}

export function getIdentitiesCollection(db: Db): Collection<IdentityDoc> {
  return db.collection<IdentityDoc>(COLLECTION_NAMES.identities);
}

export function getAuditLogsCollection(db: Db): Collection<AuditLogDoc> {
  return db.collection<AuditLogDoc>(COLLECTION_NAMES.auditLogs);
}

export function getEmbeddingsCollection(db: Db): Collection<EmbeddingDoc> {
  return db.collection<EmbeddingDoc>(COLLECTION_NAMES.embeddings);
}

export function getAdminsCollection(db: Db): Collection<AdminDoc> {
  return db.collection<AdminDoc>(COLLECTION_NAMES.admins);
}

export function getMatchesCollection(db: Db): Collection<MatchDoc> {
  return db.collection<MatchDoc>(COLLECTION_NAMES.matches);
}

export function getAppConfigCollection(db: Db): Collection<AppConfigDoc> {
  return db.collection<AppConfigDoc>(COLLECTION_NAMES.appConfig);
}

export function getMatchReranksCollection(db: Db): Collection<MatchRerankDoc> {
  return db.collection<MatchRerankDoc>(COLLECTION_NAMES.matchReranks);
}

/**
 * Creates all required indexes. Call once on startup.
 */
export async function ensureIndexes(db: Db): Promise<void> {
  const questionnaires = getQuestionnairesCollection(db);
  await _createIndexIfNotExists(questionnaires, { version: 1 }, { unique: true });
  await _createIndexIfNotExists(questionnaires, { isActive: 1 });

  const applicants = getApplicantsCollection(db);
  await _createIndexIfNotExists(applicants, { alias: 1 }, { unique: true });
  await _createIndexIfNotExists(applicants, { magicToken: 1 }, { unique: true, sparse: true });
  await _createIndexIfNotExists(applicants, { status: 1 });
  await _createIndexIfNotExists(applicants, { createdAt: -1 });

  const identities = getIdentitiesCollection(db);
  await _createIndexIfNotExists(identities, { applicantId: 1 }, { unique: true });
  await _createIndexIfNotExists(identities, { alias: 1 });
  await _createIndexIfNotExists(identities, { instagramHash: 1 }, { unique: true });

  const auditLogs = getAuditLogsCollection(db);
  await _createIndexIfNotExists(auditLogs, { timestamp: -1 });
  await _createIndexIfNotExists(auditLogs, { adminId: 1 });
  await _createIndexIfNotExists(auditLogs, { targetApplicantId: 1 });

  const embeddings = getEmbeddingsCollection(db);
  await _createIndexIfNotExists(embeddings, { applicantId: 1 }, { unique: true });
  await _createIndexIfNotExists(embeddings, { model: 1 });

  const admins = getAdminsCollection(db);
  await _createIndexIfNotExists(admins, { username: 1 }, { unique: true });

  const matches = getMatchesCollection(db);
  // Unique compound index prevents duplicate pairs (canonical order enforced in service)
  await _createIndexIfNotExists(matches, { applicantAId: 1, applicantBId: 1 }, { unique: true });
  await _createIndexIfNotExists(matches, { status: 1 });
  await _createIndexIfNotExists(matches, { score: -1 });
  await _createIndexIfNotExists(matches, { applicantAId: 1 });
  await _createIndexIfNotExists(matches, { applicantBId: 1 });
  await _createIndexIfNotExists(matches, { initiatorId: 1 }, { sparse: true });

  const matchReranks = getMatchReranksCollection(db);
  await _createIndexIfNotExists(matchReranks, { applicantId: 1 }, { unique: true });

  console.info("[DB] Indexes verification done");

  async function _createIndexIfNotExists(collection: Collection<any>, indexSpec: IndexSpecification, options?: Record<string, unknown>) {
    const indexName = Object.entries(indexSpec).map(([field, order]) => `${field}_${order}`).join("_");
    let exists = false;
    try {
      exists = await collection.indexExists(indexName);
    } catch (err: any) {
      // Collection doesn't exist yet — createIndex will create it
      if (err?.code !== 26) throw err;
    }
    if (!exists) {
      console.log(`[DB] Creating index ${indexName} for collection ${collection.collectionName}...`);
      await collection.createIndex(indexSpec, options);
    }
  }
}

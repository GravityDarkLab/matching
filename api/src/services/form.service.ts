import { ObjectId } from "mongodb";
import { AppError } from "../errors.js";
import { getDb } from "../db/connection.js";
import { getApplicantsCollection } from "../db/collections.js";
import type { FormSubmissionInput } from "../validators/form.validator.js";
import {
  getQuestionnaireByVersion,
  buildQuestionMap,
  getSensitiveQuestionIds,
} from "./questionnaire.service.js";
import { generateUniqueAlias } from "../privacy/alias.generator.js";
import { storeIdentity, checkInstagramExists } from "../privacy/identity.service.js";
import { verifySubmissionKey } from "../privacy/submission-key.js";
import { generateMagicToken, hashMagicToken } from "../privacy/magic-token.js";
import { embedApplicant } from "./embedding.service.js";

export interface FormSubmissionResult {
  alias: string;
  applicantId: string;
  magicToken: string;
}

export class DuplicateInstagramError extends AppError {
  constructor() {
    super(
      "An account already exists for this handle. " +
      "Check your saved access link and password. If you need help, contact support.",
      409,
    );
  }
}

export async function processFormSubmission(
  input: FormSubmissionInput,
  submissionKey: string,
  ipAddress = "unknown",
): Promise<FormSubmissionResult> {
  // Honeypot — filled only by bots that scrape and submit all form fields
  if (input._verify) throw new AppError("Invalid submission", 400);

  // 1. Load questionnaire
  const questionnaire = await getQuestionnaireByVersion(input.questionnaireVersion);

  if (!questionnaire) {
    throw new AppError("Questionnaire not found", 404);
  }

  if (!questionnaire.isActive) {
    throw new AppError(
      `Questionnaire version ${input.questionnaireVersion} is no longer active. Please use the latest version.`,
      409,
    );
  }

  // Verify the submission key
  if (!verifySubmissionKey(input.questionnaireVersion, submissionKey)) {
    throw new AppError("Invalid or missing submission key.", 401);
  }

  // 2. Cross-check answer keys
  const questionMap  = buildQuestionMap(questionnaire);
  const sensitiveIds = getSensitiveQuestionIds(questionnaire);

  const unknownKeys = Object.keys(input.answers).filter((key) => !questionMap.has(key));
  if (unknownKeys.length > 0) {
    throw new AppError(`Unknown answer keys: ${unknownKeys.join(", ")}`, 400);
  }

  for (const [id, question] of questionMap) {
    if (question.required && !(id in input.answers)) {
      throw new AppError(`Required field missing: ${id}`, 400);
    }
  }

  // 3. Separate sensitive and public answers
  const publicAnswers:    Record<string, unknown> = {};
  const sensitiveAnswers: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input.answers)) {
    if (sensitiveIds.has(key)) {
      sensitiveAnswers[key] = value;
    } else {
      publicAnswers[key] = value;
    }
  }

  const instagramHandle = sensitiveAnswers["instagram_handle"] as string;
  const firstName = sensitiveAnswers["first_name"] as string | undefined;
  const lastName  = sensitiveAnswers["last_name"] as string | undefined;
  const fullName  = firstName && lastName ? `${firstName} ${lastName}` : undefined;

  // 4. Duplicate detection — O(1) hash lookup, no decryption
  if (await checkInstagramExists(instagramHandle)) {
    throw new DuplicateInstagramError();
  }

  // 5. Generate unique alias
  const db         = await getDb();
  const applicants = getApplicantsCollection(db);
  const existingAliases = await applicants
    .find({}, { projection: { alias: 1 } })
    .map((doc) => doc.alias)
    .toArray();

  const alias = generateUniqueAlias(existingAliases);

  // 6. Generate magic token (password set by applicant on first login)
  const magicToken = generateMagicToken();

  // 7. Persist applicant
  const now         = new Date();
  const applicantId = new ObjectId();

  await applicants.insertOne({
    _id: applicantId,
    alias,
    questionnaireVersion: input.questionnaireVersion,
    answers: publicAnswers,
    status: "applied",
    magicToken: hashMagicToken(magicToken), // store hash; raw token returned to user only
    passwordHash: null,
    scoreThreshold: 0.8,
    submissionIp: ipAddress,
    createdAt: now,
    updatedAt: now,
  });

  // 8. Store encrypted identity with hash
  await storeIdentity(applicantId, alias, instagramHandle, fullName);

  // 9. Pre-compute embeddings (fire-and-forget)
  embedApplicant(applicantId, publicAnswers).catch((err) =>
    console.error(`[form] Background embedding failed for ${alias}:`, err)
  );

  return { alias, applicantId: applicantId.toHexString(), magicToken };
}

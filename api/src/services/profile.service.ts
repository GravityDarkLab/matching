import { ObjectId } from "mongodb";
import { AppError } from "../errors.js";
import { getDb } from "../db/connection.js";
import {
  getApplicantsCollection,
  getMatchesCollection,
  getIdentitiesCollection,
  getEmbeddingsCollection,
} from "../db/collections.js";
import type { ApplicantDoc, ApplicantStatus } from "../models/applicant.model.js";
import type { MatchDoc } from "../models/match.model.js";
import {
  toMatchView,
  assertMatchTransition,
  assertOutcomeEligible,
  expireConflictingMatches,
  transitionApplicantStatus,
  applyMatchStatusSideEffects,
  recalcOrphanedStatuses,
  DELETION_GRACE_MS,
  type ApplicantMatchView,
} from "./match-state.service.js";
import {
  resolveIdentityById,
  revealIdentityById,
} from "../privacy/identity.service.js";
import { hashMagicToken } from "../privacy/magic-token.js";
import { writeAuditLog } from "../middleware/audit.middleware.js";
import { generateIceBreakers } from "./icebreaker.service.js";
import { embedApplicant, buildTexts } from "./embedding.service.js";

// ── Auth ──────────────────────────────────────────────────────────────────────

export type LoginAttemptResult =
  | { status: "ok"; applicant: ApplicantDoc }
  | { status: "first_login" }
  | { status: "password_required" }
  | null; // unknown magic token, or wrong password

export async function loginWithMagicToken(
  magicToken: string,
  password?: string,
  currentApplicantId?: string | null
): Promise<LoginAttemptResult> {
  const db  = await getDb();
  const col = getApplicantsCollection(db);

  const doc = await col.findOne({ magicToken: hashMagicToken(magicToken) });
  if (!doc) return null;

  // Already signed in as this applicant — refresh the session instead of
  // re-prompting for a password (e.g. revisiting the magic link).
  if (currentApplicantId && doc._id.equals(currentApplicantId)) {
    return { status: "ok", applicant: doc };
  }

  if (doc.passwordHash === null) return { status: "first_login" };

  if (!password) return { status: "password_required" };
  const ok = await Bun.password.verify(password, doc.passwordHash);
  return ok ? { status: "ok", applicant: doc } : null;
}

export async function setPassword(
  magicToken: string,
  newPassword: string
): Promise<ApplicantDoc | null> {
  const db  = await getDb();
  const col = getApplicantsCollection(db);

  const doc = await col.findOne({ magicToken: hashMagicToken(magicToken) });
  if (!doc) return null;

  if (doc.passwordHash !== null) {
    throw new AppError("Password already set. Use change-password to update it.", 409);
  }

  const passwordHash = await Bun.password.hash(newPassword);
  const now = new Date();
  await col.updateOne({ _id: doc._id }, { $set: { passwordHash, updatedAt: now } });
  return { ...doc, passwordHash };
}

export async function changePassword(
  applicantId: string,
  currentPassword: string,
  newPassword: string
): Promise<void> {
  const db  = await getDb();
  const col = getApplicantsCollection(db);

  const doc = await col.findOne({ _id: new ObjectId(applicantId) });
  if (!doc) throw new AppError("Not found", 404);

  if (!doc.passwordHash) {
    throw new AppError("No password set. Use set-password for first-time setup.", 400);
  }

  const ok = await Bun.password.verify(currentPassword, doc.passwordHash);
  if (!ok) throw new AppError("Current password is incorrect", 401);

  const passwordHash = await Bun.password.hash(newPassword);
  const now = new Date();
  await col.updateOne({ _id: doc._id }, { $set: { passwordHash, updatedAt: now } });
}

// ── Profile ───────────────────────────────────────────────────────────────────

export interface ApplicantProfileView {
  applicantId: string;
  alias: string;
  fullName: string | null;
  status: ApplicantDoc["status"];
  scoreThreshold: number;
  createdAt: Date;
  deletionScheduledAt: Date | null;
  distanceNudge: { matchId: string } | null;
}

export async function getMyProfile(applicantId: string): Promise<ApplicantProfileView | null> {
  const db  = await getDb();
  const col = getApplicantsCollection(db);
  const oid = new ObjectId(applicantId);

  const doc = await col.findOne({ _id: oid });
  if (!doc) return null;

  // Own identity, not a partner reveal — no audit log (mirrors getMyAnswers
  // returning the applicant's own data without logging).
  const identity = await resolveIdentityById(oid);

  return {
    applicantId: doc._id.toHexString(),
    alias:          doc.alias,
    fullName:       identity?.fullName ?? null,
    status:         doc.status,
    scoreThreshold: doc.scoreThreshold ?? 0.8,
    createdAt:      doc.createdAt,
    deletionScheduledAt: doc.deletionScheduledAt ?? null,
    distanceNudge: await getDistanceNudge(applicantId),
  };
}

/**
 * Surfaces a one-time, dismissible suggestion when the applicant's most
 * recent failed match was tagged "too_far" and they're not already open to
 * long-distance matches. Returns null once acknowledged (see
 * acknowledgeDistanceNudge) or when no qualifying match exists.
 */
export async function getDistanceNudge(applicantId: string): Promise<{ matchId: string } | null> {
  const db       = await getDb();
  const appCol   = getApplicantsCollection(db);
  const matchCol = getMatchesCollection(db);
  const oid      = new ObjectId(applicantId);

  const applicant = await appCol.findOne({ _id: oid }, { projection: { answers: 1 } });
  if (!applicant || applicant.answers?.["open_to_long_distance"] !== false) return null;

  const match = await matchCol.findOne(
    {
      $or: [{ applicantAId: oid }, { applicantBId: oid }],
      status: "failed",
      "outcomeFeedback.tags": "too_far",
      "outcomeFeedback.nudgeAcknowledged": { $ne: true },
    },
    { sort: { updatedAt: -1 }, projection: { _id: 1 } },
  );

  return match ? { matchId: match._id.toHexString() } : null;
}

/**
 * Marks the distance nudge as acknowledged for a match (shown at most once),
 * and — only if the applicant opted in — opens them up to long-distance
 * matches. Declining still acknowledges the nudge so it doesn't reappear.
 */
export async function acknowledgeDistanceNudge(
  applicantId: string,
  matchId: string,
  openUp: boolean,
): Promise<void> {
  const db       = await getDb();
  const matchCol = getMatchesCollection(db);
  const appCol   = getApplicantsCollection(db);
  const oid      = new ObjectId(applicantId);

  let matchOid: ObjectId;
  try { matchOid = new ObjectId(matchId); } catch {
    throw new AppError("Match not found", 404);
  }

  const result = await matchCol.updateOne(
    {
      _id: matchOid,
      $or: [{ applicantAId: oid }, { applicantBId: oid }],
      "outcomeFeedback.tags": "too_far",
    },
    { $set: { "outcomeFeedback.nudgeAcknowledged": true } },
  );
  if (result.matchedCount === 0) throw new AppError("Match not found", 404);

  if (openUp) {
    await appCol.updateOne(
      { _id: oid },
      { $set: { "answers.open_to_long_distance": true, updatedAt: new Date() } },
    );
  }
}

// ── Answers (self-service questionnaire edits) ───────────────────────────────

// Never sent to the applicant editor: instagram_handle is defense in depth
// (identities live in a separate, encrypted collection), disclaimer_agreed
// is a one-time consent with no display value.
const HIDDEN_ANSWER_KEYS = new Set([
  "instagram_handle",
  "first_name",
  "last_name",
  "disclaimer_agreed",
]);

// Shown to the applicant (read-only) but never overwritten by them:
// birth_date and gender_identity are identity facts only admins may change.
const LOCKED_ANSWER_KEYS = new Set([
  ...HIDDEN_ANSWER_KEYS,
  "birth_date",
  "gender_identity",
]);

export async function getMyAnswers(
  applicantId: string
): Promise<Record<string, unknown> | null> {
  const db  = await getDb();
  const col = getApplicantsCollection(db);

  const doc = await col.findOne(
    { _id: new ObjectId(applicantId) },
    { projection: { answers: 1 } }
  );
  if (!doc) return null;

  return Object.fromEntries(
    Object.entries(doc.answers ?? {}).filter(([key]) => !HIDDEN_ANSWER_KEYS.has(key))
  );
}

export async function updateMyAnswers(
  applicantId: string,
  updates: Record<string, unknown>
): Promise<void> {
  const db  = await getDb();
  const col = getApplicantsCollection(db);
  const oid = new ObjectId(applicantId);

  const doc = await col.findOne({ _id: oid }, { projection: { answers: 1, alias: 1 } });
  if (!doc) throw new AppError("Not found", 404);

  // Merge over the stored answers so locked keys survive untouched.
  // The validator already rejects them in `updates`; filtering again here
  // keeps the invariant even if a future caller skips validation.
  const merged: Record<string, unknown> = { ...(doc.answers ?? {}) };
  for (const [key, value] of Object.entries(updates)) {
    if (LOCKED_ANSWER_KEYS.has(key)) continue;
    merged[key] = value;
  }
  // height_cm is the only optional field — absence in a full-form update means cleared
  if (!("height_cm" in updates)) delete merged["height_cm"];

  await col.updateOne({ _id: oid }, { $set: { answers: merged, updatedAt: new Date() } });

  // Refresh embeddings in the background (same as submission) so the next
  // matching run scores against the updated text — but only if the edit
  // actually touched an embedding-relevant field. Most edits (location, age
  // preferences, etc.) don't, and re-embedding unchanged text wastes API calls.
  const oldTexts = buildTexts(doc.answers ?? {});
  const newTexts = buildTexts(merged);
  const textChanged =
    oldTexts.profile !== newTexts.profile ||
    oldTexts.preference !== newTexts.preference ||
    oldTexts.dealBreakers !== newTexts.dealBreakers;

  if (textChanged) {
    embedApplicant(oid, merged).catch((err) =>
      console.error(`[profile] Background embedding refresh failed for ${doc.alias}:`, err)
    );
  }
}

// ── Matches ───────────────────────────────────────────────────────────────────

export async function getMyMatches(
  applicantId: string,
  threshold: number,
  limit: number,
  audit: { ipAddress: string; userAgent: string } = { ipAddress: "unknown", userAgent: "unknown" },
): Promise<ApplicantMatchView[]> {
  const db       = await getDb();
  const appCol   = getApplicantsCollection(db);
  const matchCol = getMatchesCollection(db);

  const oid = new ObjectId(applicantId);

  const applicant = await appCol.findOne({ _id: oid });
  if (!applicant) return [];

  const visibleStatuses =
    applicant.status === "dating"
      ? (["dating"] as const)
      : (["proposed", "in_progress", "dating"] as const);

  const docs: MatchDoc[] = await matchCol
    .find({
      $or: [{ applicantAId: oid }, { applicantBId: oid }],
      status: { $in: [...visibleStatuses] },
      score:  { $gte: threshold },
    })
    .sort({ score: -1 })
    .limit(limit)
    .toArray();

  // Batch-load partner answers so each card can show who the match is —
  // answers hold only public questionnaire fields, never the Instagram handle
  const partnerIds = docs.map((d) =>
    d.applicantAId.equals(oid) ? d.applicantBId : d.applicantAId
  );
  const partners = partnerIds.length
    ? await appCol
        .find({ _id: { $in: partnerIds } }, { projection: { answers: 1 } })
        .toArray()
    : [];
  const answersById = new Map(partners.map((p) => [p._id.toHexString(), p.answers]));

  // Reveal partner identities for mutually-accepted matches (dating only) —
  // both parties consented when the target accepted the contact request.
  // The decryption is audit-logged once per applicant per match, not on every page load.
  const identityByMatchId = new Map<string, { instagram: string; fullName: string | null }>();
  for (const d of docs) {
    if (d.status !== "dating") continue;
    const partnerId = d.applicantAId.equals(oid) ? d.applicantBId : d.applicantAId;
    const alreadyLogged = d.identityViewLoggedFor?.includes(applicantId) ?? false;

    const identity = alreadyLogged
      ? await resolveIdentityById(partnerId)
      : await revealIdentityById(partnerId, {
          actor: { actorId: applicantId, ipAddress: audit.ipAddress, userAgent: audit.userAgent },
          action: "APPLICANT_REVEAL_IDENTITY",
          targetAlias: d.applicantAId.equals(oid) ? d.applicantBAlias : d.applicantAAlias,
          metadata: {
            actorType: "applicant",
            matchId: d._id.toHexString(),
            reason: "match_view",
          },
        });
    if (!identity) continue;
    identityByMatchId.set(d._id.toHexString(), identity);

    if (!alreadyLogged) {
      await matchCol.updateOne(
        { _id: d._id },
        { $addToSet: { identityViewLoggedFor: applicantId } }
      );
    }
  }

  return docs.map((d) => {
    const partnerId = d.applicantAId.equals(oid) ? d.applicantBId : d.applicantAId;
    const identity = identityByMatchId.get(d._id.toHexString());
    return toMatchView(
      d,
      oid,
      answersById.get(partnerId.toHexString()),
      identity?.instagram,
      identity?.fullName
    );
  });
}

// ── Contact flow ──────────────────────────────────────────────────────────────

export interface ContactResult {
  iceBreakers: string[];
  dateIdeas: string[];
}

export async function requestContact(
  applicantId: string,
  matchId: string,
): Promise<ContactResult> {
  const db       = await getDb();
  const matchCol = getMatchesCollection(db);
  const appCol   = getApplicantsCollection(db);

  const actorId = new ObjectId(applicantId);

  let matchOid: ObjectId;
  try { matchOid = new ObjectId(matchId); } catch {
    throw new AppError("Match not found", 404);
  }

  const match = await matchCol.findOne({ _id: matchOid });
  if (!match) throw new AppError("Match not found", 404);

  assertMatchTransition(match, "contact", actorId);

  const targetId = match.applicantAId.equals(actorId)
    ? match.applicantBId
    : match.applicantAId;

  const [actorDoc, targetDoc] = await Promise.all([
    appCol.findOne({ _id: actorId }),
    appCol.findOne({ _id: targetId }),
  ]);

  const { questions, dateIdeas } = actorDoc && targetDoc
    ? await generateIceBreakers(actorDoc, targetDoc)
    : { questions: [], dateIdeas: [] };

  const now = new Date();

  // Atomically claim the transition — filter on status:"proposed" prevents
  // double-contact from concurrent requests both passing assertMatchTransition
  const claimed = await matchCol.findOneAndUpdate(
    { _id: matchOid, status: "proposed" },
    {
      $set: {
        status:             "in_progress",
        initiatorId:        actorId,
        iceBreakers:        questions,
        dateIdeas,
        contactRequestedAt: now,
        updatedAt:          now,
      },
    },
    { returnDocument: "after" },
  );

  if (!claimed) {
    throw new AppError("Match is no longer available for contact — it may have been claimed concurrently", 409);
  }

  // Exclusive contact: committing to one match expires the initiator's other
  // proposed/in_progress matches. Identity is NOT revealed here — mutual
  // consent happens only when the target accepts (respondToContact).
  await expireConflictingMatches([actorId], matchOid);

  return { iceBreakers: questions, dateIdeas };
}

export async function respondToContact(
  applicantId: string,
  matchId: string,
  accept: boolean,
  audit: { ipAddress: string; userAgent: string } = { ipAddress: "unknown", userAgent: "unknown" },
): Promise<{ partnerInstagram: string | null; partnerFullName: string | null }> {
  const db       = await getDb();
  const matchCol = getMatchesCollection(db);

  const actorId = new ObjectId(applicantId);

  let matchOid: ObjectId;
  try { matchOid = new ObjectId(matchId); } catch {
    throw new AppError("Match not found", 404);
  }

  const match = await matchCol.findOne({ _id: matchOid });
  if (!match) throw new AppError("Match not found", 404);

  assertMatchTransition(match, "respond", actorId);

  const initiatorId = match.initiatorId!;
  const targetId    = actorId; // actor IS the target (the one responding)

  const now = new Date();

  // Atomic claim — the status filter prevents concurrent accept/decline from
  // both applying after passing assertMatchTransition on the same snapshot
  const claimed = await matchCol.findOneAndUpdate(
    { _id: matchOid, status: "in_progress" },
    {
      $set: {
        status:             accept ? "dating" : "declined",
        contactRespondedAt: now,
        updatedAt:          now,
        ...(accept ? { datingStartedAt: now } : {}),
      },
    },
    { returnDocument: "after" },
  );

  if (!claimed) {
    throw new AppError("Match was already responded to", 409);
  }

  if (!accept) return { partnerInstagram: null, partnerFullName: null };

  const ids = [match.applicantAId, match.applicantBId];
  await applyMatchStatusSideEffects("dating", ids);

  // Mutual identity reveal — both parties consented.
  // Reveal initiator's Instagram to the target, and target's Instagram to initiator.
  // Audit-log both. Subsequent page loads use resolveIdentityById (no double-log).
  const initiatorAlias = match.applicantAId.equals(initiatorId)
    ? match.applicantAAlias
    : match.applicantBAlias;
  const targetAlias = match.applicantAId.equals(targetId)
    ? match.applicantAAlias
    : match.applicantBAlias;

  // initiatorIdentity is what the responding applicant (target) now sees —
  // it's the response payload that lets the UI reveal it without a reload.
  const [initiatorIdentity] = await Promise.all([
    revealIdentityById(initiatorId, {
      actor: { actorId: applicantId, ipAddress: audit.ipAddress, userAgent: audit.userAgent },
      action: "APPLICANT_REVEAL_IDENTITY",
      targetAlias: initiatorAlias,
      metadata: { actorType: "applicant", matchId, reason: "mutual_accept" },
    }),
    revealIdentityById(targetId, {
      // initiatorId is the one gaining access to this identity, but the
      // actual request — and its real IP/UA — came from the target
      // accepting just now, so log that, not a synthetic "system" actor.
      actor: { actorId: initiatorId.toHexString(), ipAddress: audit.ipAddress, userAgent: audit.userAgent },
      action: "APPLICANT_REVEAL_IDENTITY",
      targetAlias: targetAlias,
      metadata: { actorType: "applicant", matchId, reason: "mutual_accept" },
    }),
  ]);

  // Mark both as having had their identity view logged for this match
  await matchCol.updateOne(
    { _id: matchOid },
    {
      $addToSet: {
        identityViewLoggedFor: {
          $each: [initiatorId.toHexString(), applicantId],
        },
      },
    }
  );

  return {
    partnerInstagram: initiatorIdentity?.instagram ?? null,
    partnerFullName: initiatorIdentity?.fullName ?? null,
  };
}

/**
 * Initiator backs out after the identity reveal. The match becomes "declined"
 * (terminal) so the pair is permanently excluded from future matching runs —
 * the applicant waits for the next matching phase for fresh matches.
 */
export async function withdrawContact(
  applicantId: string,
  matchId: string
): Promise<void> {
  const db       = await getDb();
  const matchCol = getMatchesCollection(db);

  const actorId = new ObjectId(applicantId);

  let matchOid: ObjectId;
  try { matchOid = new ObjectId(matchId); } catch {
    throw new AppError("Match not found", 404);
  }

  const match = await matchCol.findOne({ _id: matchOid });
  if (!match) throw new AppError("Match not found", 404);

  assertMatchTransition(match, "withdraw", actorId);

  const now = new Date();

  // Atomic claim — a concurrent accept/decline from the target wins or loses
  // the race cleanly instead of both transitions applying
  const claimed = await matchCol.findOneAndUpdate(
    { _id: matchOid, status: "in_progress" },
    {
      $set: {
        status:             "declined",
        contactRespondedAt: now,
        updatedAt:          now,
      },
    },
    { returnDocument: "after" },
  );

  if (!claimed) {
    throw new AppError("Match was already responded to", 409);
  }
}

export interface ReportOutcomeOptions {
  feedback?: { tags: string[]; note?: string };
  continuation?: "continue" | "break";
}

export async function reportOutcome(
  applicantId: string,
  matchId: string,
  outcome: "success" | "failed",
  options?: ReportOutcomeOptions,
  audit: { ipAddress: string; userAgent: string } = { ipAddress: "unknown", userAgent: "unknown" },
): Promise<void> {
  const db       = await getDb();
  const matchCol = getMatchesCollection(db);

  const actorId = new ObjectId(applicantId);

  let matchOid: ObjectId;
  try { matchOid = new ObjectId(matchId); } catch {
    throw new AppError("Match not found", 404);
  }

  const match = await matchCol.findOne({ _id: matchOid });
  if (!match) throw new AppError("Match not found", 404);

  assertMatchTransition(match, "outcome", actorId);
  assertOutcomeEligible(match, outcome, actorId);

  const now = new Date();
  const ids = [match.applicantAId, match.applicantBId];

  const setFields: Record<string, unknown> = {
    status: outcome === "success" ? "success" : "failed",
    updatedAt: now,
  };
  if (outcome === "failed" && options?.feedback) {
    setFields.outcomeFeedback = {
      tags: options.feedback.tags,
      ...(options.feedback.note ? { note: options.feedback.note } : {}),
    };
  }

  // Atomic claim — only one partner's outcome report wins; a concurrent
  // conflicting report gets 409 instead of silently overwriting state
  const claimed = await matchCol.findOneAndUpdate(
    { _id: matchOid, status: { $in: ["dating", "in_progress"] } },
    { $set: setFields },
    { returnDocument: "after" },
  );

  if (!claimed) {
    throw new AppError("Outcome was already reported for this match", 409);
  }

  if (outcome === "failed" && options?.feedback) {
    await writeAuditLog(
      { actorId: applicantId, ipAddress: audit.ipAddress, userAgent: audit.userAgent },
      "APPLICANT_REPORT_OUTCOME",
      { targetApplicantId: actorId, metadata: { matchId, tags: options.feedback.tags } },
    );
  }

  if (outcome === "success") {
    // Mirror deactivateMyAccount: a partner heading toward deletion shouldn't
    // leave other proposed/in_progress matches around for someone else to contact.
    await applyMatchStatusSideEffects("success", ids);
    return;
  }

  // "failed": default to "continue" unless the reporter explicitly chose to
  // take a break. The break is the REPORTER's choice about the REPORTER's
  // account only — it must never deactivate the partner (or start their
  // deletion countdown) on someone else's say-so. The partner re-enters the
  // pool exactly as in the "continue" case.
  if (options?.continuation === "break") {
    const partnerId = match.applicantAId.equals(actorId)
      ? match.applicantBId
      : match.applicantAId;
    // Reporter: same deactivation as deactivateMyAccount (inactive + grace-
    // period deletion countdown, cancellable from the dashboard).
    const deletionScheduledAt = new Date(Date.now() + DELETION_GRACE_MS);
    await transitionApplicantStatus([actorId], "inactive", { deletionScheduledAt });
    await expireConflictingMatches([actorId], matchOid);
    // Partner: back into the matching pool.
    await applyMatchStatusSideEffects("failed", [partnerId]);
  } else {
    await applyMatchStatusSideEffects("failed", ids);
  }
}

export async function deactivateMyAccount(applicantId: string): Promise<void> {
  const oid                = new ObjectId(applicantId);
  const deletionScheduledAt = new Date(Date.now() + DELETION_GRACE_MS);
  await transitionApplicantStatus([oid], "inactive", { deletionScheduledAt });
  await expireConflictingMatches([oid]);
}

/**
 * Cancels a pending account deletion and restores the applicant to the
 * matching pool. Only valid while a deletion is actually scheduled.
 *
 * Restores to "dating" rather than "applied" if the applicant still has a
 * match in "dating" status — otherwise they'd re-enter the matching pool
 * while still tied to an active match.
 */
export async function cancelAccountDeletion(applicantId: string): Promise<void> {
  const db       = await getDb();
  const appCol   = getApplicantsCollection(db);
  const matchCol = getMatchesCollection(db);
  const oid      = new ObjectId(applicantId);

  const datingMatch = await matchCol.findOne({
    status: "dating",
    $or: [{ applicantAId: oid }, { applicantBId: oid }],
  });
  const restoredStatus: ApplicantStatus = datingMatch ? "dating" : "applied";

  const result = await appCol.findOneAndUpdate(
    { _id: oid, status: "inactive", deletionScheduledAt: { $exists: true } },
    { $set: { status: restoredStatus, updatedAt: new Date() }, $unset: { deletionScheduledAt: "" } },
  );

  if (!result) throw new AppError("No deletion is scheduled for this account", 409);
}

/**
 * Immediate, irreversible self-deletion — bypasses the configurable
 * deletion grace period (DELETION_GRACE_DAYS / DELETION_GRACE_MS).
 * Removes the applicant document, their identity record, embeddings, and
 * any matches involving them.
 */
export async function deleteMyAccountNow(
  applicantId: string,
  audit: { ipAddress: string; userAgent: string } = { ipAddress: "unknown", userAgent: "unknown" },
): Promise<void> {
  const db  = await getDb();
  const oid = new ObjectId(applicantId);

  const appCol        = getApplicantsCollection(db);
  const matchCol      = getMatchesCollection(db);
  const identitiesCol = getIdentitiesCollection(db);
  const embeddingsCol = getEmbeddingsCollection(db);

  const doc = await appCol.findOne({ _id: oid });
  if (!doc) throw new AppError("Not found", 404);

  // Audit before the data it references is removed
  await writeAuditLog(
    { actorId: applicantId, ipAddress: audit.ipAddress, userAgent: audit.userAgent },
    "APPLICANT_SELF_DELETE",
    { targetApplicantId: oid, targetAlias: doc.alias, metadata: { actorType: "applicant" } },
  );

  // Collect partner IDs from all active matches before deleting them —
  // we need these to recalculate partner statuses after the data is gone.
  const activeMatches = await matchCol
    .find(
      {
        $or: [{ applicantAId: oid }, { applicantBId: oid }],
        status: { $in: ["proposed", "in_progress", "dating"] },
      },
      { projection: { applicantAId: 1, applicantBId: 1 } },
    )
    .toArray();

  // Dedupe — the same partner can appear across multiple active matches.
  const partnerIdMap = new Map(
    activeMatches.map((m) => {
      const partnerId = m.applicantAId.equals(oid) ? m.applicantBId : m.applicantAId;
      return [partnerId.toHexString(), partnerId] as const;
    }),
  );
  const partnerIds = [...partnerIdMap.values()];

  await Promise.all([
    appCol.deleteOne({ _id: oid }),
    identitiesCol.deleteOne({ applicantId: oid }),
    embeddingsCol.deleteOne({ applicantId: oid }),
    matchCol.deleteMany({ $or: [{ applicantAId: oid }, { applicantBId: oid }] }),
  ]);

  // Recalculate partner statuses now that their shared matches are gone.
  await recalcOrphanedStatuses(partnerIds);
}

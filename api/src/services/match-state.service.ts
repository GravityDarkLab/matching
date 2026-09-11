import { ObjectId } from "mongodb";
import { env } from "../config/env.js";
import { AppError } from "../errors.js";
import { getDb } from "../db/connection.js";
import { getMatchesCollection, getApplicantsCollection } from "../db/collections.js";
import type { MatchDoc, MatchStatus } from "../models/match.model.js";
import type { ApplicantDoc, ApplicantStatus } from "../models/applicant.model.js";
import { ageFromBirthDate } from "../utils/age.js";

/**
 * Shared match-state "kernel" used by both the admin match CRUD
 * (`match.service.ts`) and the applicant-facing contact/outcome flows
 * (`profile.service.ts`): the applicant-facing view projection, the
 * state-machine guard, and the status-transition side effects that keep
 * applicant status and conflicting matches in sync with a match's status.
 */

// ── Applicant-facing view (privacy-preserving, perspective-aware) ─────────────

export type MatchPerspective = "initiator" | "target" | "none";

export interface ApplicantMatchView {
  matchId: string;
  partnerAlias: string;
  score: number;
  breakdown?: Record<string, number>;
  llmReasoning?: string;
  status: MatchStatus;
  perspective: MatchPerspective;
  contactRequestedAt?: Date; // when the initiator clicked "contact" — shown to target
  iceBreakers?: string[];
  dateIdeas?: string[];
  partnerProfile?: Record<string, unknown>; // partner's public questionnaire answers
  partnerInstagram?: string; // only for in_progress/dating — see toMatchView
  partnerFullName?: string;
  datingStartedAt?: Date;
}

// Keys never shown to a partner: consent checkboxes carry no information,
// instagram_handle is defense in depth — identity answers are stored encrypted
// in a separate collection and should never appear in `answers` at all — and
// birth_date is a precise identity fact, so partners only see the derived age
const PARTNER_PROFILE_EXCLUDED_KEYS = new Set([
  "disclaimer_agreed",
  "instagram_handle",
  "birth_date",
]);

/**
 * Pure function — no DB calls. Projects a MatchDoc into the applicant-facing view
 * from the perspective of `actorId`. `partnerAnswers` holds only the public
 * answers (identity fields are stored encrypted in a separate collection and
 * never reach the applicants collection). `partnerInstagram` is included in
 * the view only once contact has been requested (status in_progress/dating —
 * see below).
 */
export function toMatchView(
  doc: MatchDoc,
  actorId: ObjectId,
  partnerAnswers?: Record<string, unknown>,
  partnerInstagram?: string,
  partnerFullName?: string | null
): ApplicantMatchView {
  const isA       = doc.applicantAId.equals(actorId);
  const partnerAlias = isA ? doc.applicantBAlias : doc.applicantAAlias;

  let perspective: MatchPerspective = "none";
  if (doc.status === "in_progress" && doc.initiatorId) {
    perspective = doc.initiatorId.equals(actorId) ? "initiator" : "target";
  }

  const view: ApplicantMatchView = {
    matchId: doc._id.toHexString(),
    partnerAlias,
    score: doc.score,
    status: doc.status,
    perspective,
  };

  if (doc.breakdown) view.breakdown = doc.breakdown;
  if (doc.llmReasoning) view.llmReasoning = doc.llmReasoning;

  if (partnerAnswers) {
    const profile = Object.fromEntries(
      Object.entries(partnerAnswers).filter(([key]) => !PARTNER_PROFILE_EXCLUDED_KEYS.has(key))
    );
    // Partners see an age, not the exact birth date (legacy records carry a
    // stored `age` answer instead, which passes through unchanged)
    const age = ageFromBirthDate(partnerAnswers["birth_date"]);
    if (age !== null && !("age" in profile)) profile["age"] = age;
    if (Object.keys(profile).length > 0) view.partnerProfile = profile;
  }

  // Identity is only revealed after mutual acceptance (dating status).
  // Never attached while the match is proposed or in_progress.
  if (partnerInstagram && doc.status === "dating") {
    view.partnerInstagram = partnerInstagram;
    if (partnerFullName) view.partnerFullName = partnerFullName;
  }

  if (doc.status === "dating") {
    const anchor = getDatingAnchor(doc);
    if (anchor) view.datingStartedAt = anchor;
  }

  if (doc.status === "in_progress") {
    if (doc.contactRequestedAt) view.contactRequestedAt = doc.contactRequestedAt;
    if (perspective === "initiator") {
      if (doc.iceBreakers) view.iceBreakers = doc.iceBreakers;
      if (doc.dateIdeas)   view.dateIdeas   = doc.dateIdeas;
    }
  }

  return view;
}

// ── State-machine guard ────────────────────────────────────────────────────────

type MatchAction = "contact" | "respond" | "withdraw" | "outcome";

/**
 * Asserts that `actorId` may perform `action` on `match`.
 * Throws a descriptive Error on any violation — callers map to 403/409.
 */
export function assertMatchTransition(
  match: MatchDoc,
  action: MatchAction,
  actorId: ObjectId
): void {
  const isParticipant =
    match.applicantAId.equals(actorId) || match.applicantBId.equals(actorId);

  if (action === "contact") {
    if (!isParticipant) {
      throw new AppError("Not a participant in this match", 403);
    }
    if (match.status !== "proposed") {
      // Target should use the respond endpoint, not contact
      if (match.status === "in_progress" && !match.initiatorId?.equals(actorId)) {
        throw new AppError("Use the respond endpoint to accept or decline", 403);
      }
      // Any other state (duplicate, terminal): conflict
      throw new AppError(`Match status is "${match.status}" — contact not allowed`, 409);
    }
    return;
  }

  if (action === "respond") {
    if (!isParticipant) {
      throw new AppError("Not a participant in this match", 403);
    }
    if (match.status !== "in_progress") {
      throw new AppError(`Match status is "${match.status}" — nothing to respond to`, 409);
    }
    if (match.initiatorId?.equals(actorId)) {
      throw new AppError("Initiator cannot respond to their own contact request", 403);
    }
    return;
  }

  if (action === "withdraw") {
    if (!isParticipant) {
      throw new AppError("Not a participant in this match", 403);
    }
    if (match.status !== "in_progress") {
      throw new AppError(`Match status is "${match.status}" — nothing to withdraw`, 409);
    }
    if (!match.initiatorId?.equals(actorId)) {
      throw new AppError("Only the initiator can withdraw their contact request", 403);
    }
    return;
  }

  if (action === "outcome") {
    if (!isParticipant) {
      throw new AppError("Not a participant in this match", 403);
    }
    if (match.status !== "dating" && match.status !== "in_progress") {
      throw new AppError(`Match status is "${match.status}" — outcome cannot be reported`, 409);
    }
    return;
  }
}

// ── Shared helpers ─────────────────────────────────────────────────────────────

/**
 * Expires all proposed/in_progress matches for the given applicant IDs.
 * Called when someone contacts a match (their other matches expire), accepts
 * contact, or deactivates. `excludeMatchId` keeps the match being acted on
 * out of its own sweep.
 */
export async function expireConflictingMatches(
  applicantIds: ObjectId[],
  excludeMatchId?: ObjectId
): Promise<void> {
  const db  = await getDb();
  const col = getMatchesCollection(db);
  const now = new Date();

  const filter: Record<string, unknown> = {
    $or: [
      { applicantAId: { $in: applicantIds } },
      { applicantBId: { $in: applicantIds } },
    ],
    status: { $in: ["proposed", "in_progress"] },
  };
  if (excludeMatchId) filter._id = { $ne: excludeMatchId };

  await col.updateMany(filter, { $set: { status: "expired", updatedAt: now } });
}

/** Portal slider floor — matches below this score are never shown to applicants. */
export const PORTAL_MIN_SCORE = 0.6;

/** Day count after which a "didn't work" outcome can be reported. */
export const CANCEL_ELIGIBLE_DAYS: number = 3;
/** Day count after which an "it worked" outcome can be reported. */
export const OUTCOME_ELIGIBLE_DAYS: number = 7;

/** Whole days elapsed since `date`, floored. */
export function daysSince(date: Date): number {
  return Math.floor((Date.now() - date.getTime()) / (24 * 60 * 60 * 1000));
}

/** The stable anchor for dating-outcome gating — see MatchDoc.datingStartedAt. */
export function getDatingAnchor(match: MatchDoc): Date | undefined {
  return match.datingStartedAt ?? match.contactRespondedAt;
}

/**
 * Throws if `outcome` can't be reported for `match` by `actorId`.
 *
 * From "in_progress" the only legal outcome is the initiator bailing out
 * ("failed") before the partner responds — "success" requires an actual
 * dating phase (identities are only revealed at "dating", so a "success"
 * here would let either side deactivate both accounts on a match that
 * never happened), and the target's way out is the respond endpoint.
 *
 * From "dating", outcomes are day-gated against the dating anchor.
 */
export function assertOutcomeEligible(
  match: MatchDoc,
  outcome: "success" | "failed",
  actorId: ObjectId
): void {
  if (match.status === "in_progress") {
    if (outcome === "success") {
      throw new AppError(
        "A match can only be reported successful once you are dating — respond to the contact request first",
        409
      );
    }
    if (!match.initiatorId?.equals(actorId)) {
      throw new AppError(
        "Only the initiator can end a pending contact request — use the respond endpoint to decline",
        403
      );
    }
    return;
  }

  if (match.status !== "dating") return;
  const anchor = getDatingAnchor(match);
  if (!anchor) return;

  const requiredDays = outcome === "success" ? OUTCOME_ELIGIBLE_DAYS : CANCEL_ELIGIBLE_DAYS;
  if (daysSince(anchor) < requiredDays) {
    throw new AppError(
      `Too early to report this outcome — available ${requiredDays} day${requiredDays === 1 ? "" : "s"} after you started dating`,
      403
    );
  }
}

/** Grace period before personal data of inactive accounts is purged. Configurable via DELETION_GRACE_DAYS. */
export const DELETION_GRACE_MS = env.deletionGraceDays * 24 * 60 * 60 * 1000;

/**
 * Promotes "applied" applicants to "matched" when they have at least one
 * proposed match visible in the portal (score ≥ PORTAL_MIN_SCORE).
 * Called after every matching pass (admin-triggered and scheduled).
 */
export async function promoteAppliedToMatched(): Promise<number> {
  const db       = await getDb();
  const matchCol = getMatchesCollection(db);
  const appCol   = getApplicantsCollection(db);

  const proposed = await matchCol
    .find(
      { status: "proposed", score: { $gte: PORTAL_MIN_SCORE } },
      { projection: { applicantAId: 1, applicantBId: 1 } },
    )
    .toArray();
  if (proposed.length === 0) return 0;

  const ids = new Map<string, ObjectId>();
  for (const m of proposed) {
    ids.set(m.applicantAId.toHexString(), m.applicantAId);
    ids.set(m.applicantBId.toHexString(), m.applicantBId);
  }

  const res = await appCol.updateMany(
    { _id: { $in: [...ids.values()] }, status: "applied" },
    { $set: { status: "matched", updatedAt: new Date() } },
  );
  return res.modifiedCount;
}

/**
 * Transitions multiple applicants to a new status in a single updateMany.
 */
export async function transitionApplicantStatus(
  ids: ObjectId[],
  newStatus: ApplicantStatus,
  extra?: Partial<Pick<ApplicantDoc, "deletionScheduledAt">>
): Promise<void> {
  const db  = await getDb();
  const col = getApplicantsCollection(db);
  const now = new Date();

  await col.updateMany(
    { _id: { $in: ids } },
    { $set: { status: newStatus, updatedAt: now, ...extra } }
  );
}

/**
 * Recalculates the status of applicants whose active match was deleted
 * (e.g. because their partner deleted their account). For each affected
 * applicant, determines the correct status from their remaining matches:
 *   - active dating match present → stay "dating"
 *   - proposed/in_progress matches only → revert to "matched"
 *   - no remaining matches → revert to "applied" (re-enters pool)
 */
export async function recalcOrphanedStatuses(
  affectedIds: ObjectId[]
): Promise<void> {
  if (affectedIds.length === 0) return;

  const db       = await getDb();
  const matchCol = getMatchesCollection(db);
  const appCol   = getApplicantsCollection(db);

  await Promise.all(affectedIds.map(async (id) => {
    const matches = await matchCol
      .find({
        $or: [{ applicantAId: id }, { applicantBId: id }],
        status: { $in: ["dating", "proposed", "in_progress"] },
      })
      .toArray();

    const hasDating   = matches.some((m) => m.status === "dating");
    const hasProposed = matches.some((m) => m.status === "proposed" || m.status === "in_progress");

    const newStatus: ApplicantStatus = hasDating
      ? "dating"
      : hasProposed
        ? "matched"
        : "applied";

    await appCol.updateOne(
      { _id: id },
      { $set: { status: newStatus, updatedAt: new Date() } }
    );
  }));
}

/**
 * Applies the applicant-status side effects of a match transitioning to
 * "dating", "success", "failed", "declined", or "expired" — shared by the
 * admin override (`updateMatch`) and the applicant-facing flows
 * (`respondToContact`, `reportOutcome`) so the two can't drift apart.
 *
 * The admin override has no from-state check (an admin can move a match
 * straight from "dating" to "declined"/"expired"), so "declined"/"expired"
 * recalculate both applicants' status from whatever matches they actually
 * still have — the same recovery `recalcOrphanedStatuses` already does for
 * account-deletion cleanup — instead of leaving them stuck at "dating" with
 * no active match to show for it.
 */
export async function applyMatchStatusSideEffects(
  status: MatchStatus,
  applicantIds: ObjectId[],
  excludeMatchId?: ObjectId,
): Promise<void> {
  if (status === "dating") {
    await transitionApplicantStatus(applicantIds, "dating");
    await expireConflictingMatches(applicantIds, excludeMatchId);
  } else if (status === "success") {
    const deletionScheduledAt = new Date(Date.now() + DELETION_GRACE_MS);
    await transitionApplicantStatus(applicantIds, "inactive", { deletionScheduledAt });
    await expireConflictingMatches(applicantIds, excludeMatchId);
  } else if (status === "failed") {
    await transitionApplicantStatus(applicantIds, "applied");
  } else if (status === "declined" || status === "expired") {
    await recalcOrphanedStatuses(applicantIds);
  }
}

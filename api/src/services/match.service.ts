import { ObjectId } from "mongodb";
import { getDb } from "../db/connection.js";
import { getMatchesCollection, getApplicantsCollection } from "../db/collections.js";
import type { MatchDoc, MatchStatus } from "../models/match.model.js";
import type { ApplicantDoc } from "../models/applicant.model.js";
import { proposalPairAction, type CoupleProposal } from "../matching/proposals.js";
import type { PaginatedResult } from "./admin.service.js";
import { applyMatchStatusSideEffects } from "./match-state.service.js";
import { escapeRegex } from "../utils/regex.js";

// ── Admin view (ObjectIds serialised to strings) ──────────────────────────────

export type MatchView = Omit<MatchDoc, "_id" | "applicantAId" | "applicantBId"> & {
  id: string;
  applicantAId: string;
  applicantBId: string;
};

function toView(doc: MatchDoc): MatchView {
  const { _id, applicantAId, applicantBId, ...rest } = doc;
  return {
    id: _id.toHexString(),
    applicantAId: applicantAId.toHexString(),
    applicantBId: applicantBId.toHexString(),
    ...rest,
  };
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export async function listMatches(
  page: number,
  limit: number,
  status?: MatchStatus,
  participantId?: string,
  search?: string,
): Promise<PaginatedResult<MatchView>> {
  const db  = await getDb();
  const col = getMatchesCollection(db);

  const filter: Record<string, unknown> = {};
  if (status) filter.status = status;

  const andClauses: Record<string, unknown>[] = [];

  if (participantId) {
    let oid: ObjectId;
    try { oid = new ObjectId(participantId); } catch {
      return { data: [], total: 0, page, limit, totalPages: 0 };
    }
    andClauses.push({ $or: [{ applicantAId: oid }, { applicantBId: oid }] });
  }

  if (search) {
    const safeSearch = escapeRegex(search);
    andClauses.push({
      $or: [
        { applicantAAlias: { $regex: safeSearch, $options: "i" } },
        { applicantBAlias: { $regex: safeSearch, $options: "i" } },
      ],
    });
  }

  if (andClauses.length > 0) filter.$and = andClauses;

  const skip = (page - 1) * limit;

  const [docs, total] = await Promise.all([
    col.find(filter).sort({ score: -1 }).skip(skip).limit(limit).toArray(),
    col.countDocuments(filter),
  ]);

  return {
    data: docs.map(toView),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

/**
 * Updates a match's status/notes. When `status` is changed to "dating",
 * "success", or "failed", mirrors the applicant-status side effects that
 * the applicant-facing transitions (respondToContact/reportOutcome) apply —
 * so an admin overriding a match's status doesn't leave applicants stuck in
 * a stale status or with conflicting matches still open.
 */
export async function updateMatch(
  id: string,
  updates: { status?: MatchStatus; notes?: string },
): Promise<MatchView | null> {
  const db  = await getDb();
  const col = getMatchesCollection(db);

  let oid: ObjectId;
  try { oid = new ObjectId(id); } catch { return null; }

  const before = await col.findOne({ _id: oid });
  if (!before) return null;

  const result = await col.findOneAndUpdate(
    { _id: oid },
    { $set: { ...updates, updatedAt: new Date() } },
    { returnDocument: "after" },
  );
  if (!result) return null;

  if (updates.status && updates.status !== before.status) {
    await applyMatchStatusSideEffects(updates.status, [result.applicantAId, result.applicantBId], oid);
  }

  return toView(result);
}

export async function deleteMatch(id: string): Promise<boolean> {
  const db  = await getDb();
  const col = getMatchesCollection(db);

  let oid: ObjectId;
  try { oid = new ObjectId(id); } catch { return false; }

  const result = await col.deleteOne({ _id: oid });
  return result.deletedCount > 0;
}

// ── Proposal persistence ──────────────────────────────────────────────────────

export async function saveMatchProposals(
  proposals: CoupleProposal[],
  algorithm: string,
): Promise<number> {
  if (proposals.length === 0) return 0;

  const db  = await getDb();
  const col = getMatchesCollection(db);

  const now = new Date();
  let saved = 0;

  for (const p of proposals) {
    const existing = await col.findOne({
      applicantAId: p.applicantAId,
      applicantBId: p.applicantBId,
    });

    const action = proposalPairAction(existing?.status);
    if (action === "skip") continue;

    if (action === "revive" && existing) {
      const revived = await col.updateOne(
        { _id: existing._id, status: "expired" },
        {
          $set: {
            score:        p.score,
            breakdown:    p.breakdown,
            llmReasoning: p.llmReasoning,
            algorithm,
            status:       "proposed",
            updatedAt:    now,
          },
          $unset: {
            initiatorId:        "",
            iceBreakers:        "",
            dateIdeas:          "",
            contactRequestedAt: "",
            contactRespondedAt: "",
          },
        }
      );
      if (revived.modifiedCount > 0) saved++;
      continue;
    }

    try {
      await col.insertOne({
        _id:             new ObjectId(),
        applicantAId:    p.applicantAId,
        applicantAAlias: p.applicantAAlias,
        applicantBId:    p.applicantBId,
        applicantBAlias: p.applicantBAlias,
        score:           p.score,
        breakdown:       p.breakdown,
        llmReasoning:    p.llmReasoning,
        algorithm,
        status:          "proposed",
        createdAt:       now,
        updatedAt:       now,
      });
      saved++;
    } catch (err: unknown) {
      if ((err as { code?: number })?.code !== 11000) throw err;
    }
  }

  return saved;
}

export async function loadActiveApplicants(): Promise<ApplicantDoc[]> {
  const db  = await getDb();
  const col = getApplicantsCollection(db);
  return col.find({ status: { $in: ["applied", "matched"] } }).toArray();
}

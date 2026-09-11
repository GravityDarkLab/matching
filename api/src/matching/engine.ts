import { ObjectId } from "mongodb";
import { AppError } from "../errors.js";
import type { ApplicantDoc } from "../models/applicant.model.js";
import type { QuestionnaireDoc } from "../models/questionnaire.model.js";
import { getDb } from "../db/connection.js";
import { getApplicantsCollection, getMatchesCollection } from "../db/collections.js";
import { getActiveQuestionnaire } from "../services/questionnaire.service.js";
import { isOrientationCompatible } from "./filters/orientation.filter.js";
import { isAgeCompatible } from "./filters/age.filter.js";
import { isReligionCompatible } from "./filters/religion.filter.js";
import { isLongDistanceCompatible } from "./filters/location.filter.js";
import { prepare, score, hasEmbedding } from "./scorer.js";
import { rerankCandidates } from "../services/match-rerank.service.js";

export interface MatchScore {
  score: number;
  breakdown: Record<string, number>;
}

export interface RankedCandidate {
  alias: string;
  applicantId: string;
  /** The displayed score (0-1) — from the LLM rerank stage, or the embedding
   *  score unchanged if reranking failed/was skipped. */
  score: number;
  breakdown: Record<string, number>;
  /** The pre-rerank embedding-cosine score (0-1) — kept for debugging/transparency. */
  embeddingScore: number;
  /** Short grounded explanation from the LLM rerank stage; "" if unavailable. */
  llmReasoning: string;
}

/**
 * Returns the hex IDs of every applicant currently in an `in_progress` match
 * (an exclusive contact awaiting a response). They're mid-conversation and
 * must not receive new proposals until that contact resolves.
 */
export async function getActiveContactApplicantIds(): Promise<Set<string>> {
  const db  = await getDb();
  const col = getMatchesCollection(db);

  const inProgress = await col
    .find({ status: "in_progress" }, { projection: { applicantAId: 1, applicantBId: 1 } })
    .toArray();

  const ids = new Set<string>();
  for (const m of inProgress) {
    ids.add(m.applicantAId.toHexString());
    ids.add(m.applicantBId.toHexString());
  }
  return ids;
}

function applyFilters(target: ApplicantDoc, candidates: ApplicantDoc[]): ApplicantDoc[] {
  return candidates.filter(
    (c) =>
      isOrientationCompatible(target, c) &&
      isAgeCompatible(target, c) &&
      isReligionCompatible(target, c) &&
      isLongDistanceCompatible(target, c),
  );
}

const SHORTLIST_SIZE = 15;

interface EmbeddingRanked {
  alias: string;
  applicantId: string;
  score: number;
  breakdown: Record<string, number>;
}

/**
 * Takes the embedding-ranked list (already sorted desc), shortlists it,
 * reranks the shortlist with the LLM, and returns the final topN sorted by
 * the (now LLM-derived) displayed score. Never throws — falls back to the
 * embedding order/score if the rerank call itself errors.
 */
async function applyRerank(
  target: ApplicantDoc,
  embeddingRanked: EmbeddingRanked[],
  docsById: Map<string, ApplicantDoc>,
  topN: number,
): Promise<RankedCandidate[]> {
  const shortlist = embeddingRanked.slice(0, Math.max(topN, SHORTLIST_SIZE));
  if (shortlist.length === 0) return [];

  let results: { applicantId: string; score: number; reasoning: string }[];
  try {
    results = await rerankCandidates(
      target,
      shortlist.map((c) => ({ doc: docsById.get(c.applicantId)!, embeddingScore: c.score })),
    );
  } catch (err) {
    console.error("[engine] Rerank failed, falling back to embedding order:", err);
    results = [];
  }
  const byId = new Map(results.map((r) => [r.applicantId, r]));

  const reranked: RankedCandidate[] = shortlist.map((c) => {
    const r = byId.get(c.applicantId);
    return {
      alias:          c.alias,
      applicantId:    c.applicantId,
      breakdown:      c.breakdown,
      embeddingScore: c.score,
      score:          r ? r.score : c.score,
      llmReasoning:   r ? r.reasoning : "",
    };
  });

  return reranked.sort((a, b) => b.score - a.score).slice(0, topN);
}

/**
 * Returns the top N candidates scored against the given applicant.
 */
export async function getCandidates(
  applicantId: string,
  topN = 10,
): Promise<RankedCandidate[]> {
  const questionnaire = await getActiveQuestionnaire();
  if (!questionnaire) {
    throw new AppError("No active questionnaire found", 404);
  }

  const db = await getDb();
  const col = getApplicantsCollection(db);

  let targetId: ObjectId;
  try {
    targetId = new ObjectId(applicantId);
  } catch {
    throw new AppError(`Invalid applicant ID: ${applicantId}`, 400);
  }

  const target = await col.findOne({ _id: targetId, status: { $in: ["applied", "matched"] } });
  if (!target) {
    throw new AppError(`Active applicant not found: ${applicantId}`, 404);
  }

  const activeContactIds = await getActiveContactApplicantIds();
  if (activeContactIds.has(targetId.toHexString())) {
    return [];
  }

  const others = await col
    .find({ _id: { $ne: targetId }, status: { $in: ["applied", "matched"] } })
    .toArray();

  const eligible = others.filter((o) => !activeContactIds.has(o._id.toHexString()));
  const compatible = applyFilters(target, eligible);

  const context = await prepare([target, ...compatible], questionnaire);
  if (!hasEmbedding(context, target)) {
    // Target's own embedding failed to compute this round — nothing to score against.
    return [];
  }
  const scorable = compatible.filter((other) => hasEmbedding(context, other));

  const embeddingRanked: EmbeddingRanked[] = scorable
    .map((other) => {
      const result = score(target, other, questionnaire, context);
      return {
        alias:       other.alias,
        applicantId: other._id.toHexString(),
        score:       result.score,
        breakdown:   result.breakdown,
      };
    })
    .sort((a, b) => b.score - a.score);

  const docsById = new Map(scorable.map((d) => [d._id.toHexString(), d]));
  return applyRerank(target, embeddingRanked, docsById, topN);
}

// Caps concurrent in-flight rerank calls during a full pass. Without this,
// N applicants means N simultaneous LLM requests; with it, worst case
// (45s timeout each, from match-rerank.service.ts) is ceil(N / 5) × 45s
// instead of N × 45s — and the cache means most passes see nowhere near
// the worst case.
const RERANK_CONCURRENCY = 5;

/**
 * Runs a full pairwise matching pass over all active applicants.
 * Returns a map of applicantId → ranked candidates.
 */
export async function runFullMatchingPass(): Promise<Record<string, RankedCandidate[]>> {
  const questionnaire = await getActiveQuestionnaire();
  if (!questionnaire) {
    throw new AppError("No active questionnaire found", 404);
  }

  const db = await getDb();
  const col = getApplicantsCollection(db);
  const applicants = await col.find({ status: { $in: ["applied", "matched"] } }).toArray();

  if (applicants.length < 2) {
    return {};
  }

  const activeContactIds = await getActiveContactApplicantIds();
  const eligible = applicants.filter((a) => !activeContactIds.has(a._id.toHexString()));

  if (eligible.length < 2) {
    return {};
  }

  const context = await prepare(eligible, questionnaire);

  const results: Record<string, RankedCandidate[]> = {};

  for (let i = 0; i < eligible.length; i += RERANK_CONCURRENCY) {
    const batch = eligible.slice(i, i + RERANK_CONCURRENCY);
    await Promise.all(
      batch.map(async (applicant) => {
        // Never let one applicant's failure (missing embedding, an
        // unexpected rerank error, anything else) abort its whole
        // concurrency batch — degrade that applicant to no candidates
        // this round instead.
        try {
          if (!hasEmbedding(context, applicant)) {
            results[applicant._id.toHexString()] = [];
            return;
          }

          const others = eligible.filter((o) => !o._id.equals(applicant._id));
          const compatible = applyFilters(applicant, others)
            .filter((other) => hasEmbedding(context, other));

          const embeddingRanked: EmbeddingRanked[] = compatible
            .map((other) => {
              const result = score(applicant, other, questionnaire, context);
              return {
                alias:       other.alias,
                applicantId: other._id.toHexString(),
                score:       result.score,
                breakdown:   result.breakdown,
              };
            })
            .sort((a, b) => b.score - a.score);

          const docsById = new Map(compatible.map((d) => [d._id.toHexString(), d]));
          results[applicant._id.toHexString()] = await applyRerank(applicant, embeddingRanked, docsById, 10);
        } catch (err) {
          console.error(
            `[engine] Scoring failed for applicant ${applicant._id.toHexString()}, ` +
            `degrading to no candidates this round:`,
            err
          );
          results[applicant._id.toHexString()] = [];
        }
      }),
    );
  }

  return results;
}

// Re-export types needed by other modules
export type { ApplicantDoc, QuestionnaireDoc };

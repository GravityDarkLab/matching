import type { ObjectId } from "mongodb";
import type { ApplicantDoc } from "../models/applicant.model.js";
import type { MatchStatus } from "../models/match.model.js";
import type { RankedCandidate } from "./engine.js";

export interface CoupleProposal {
  applicantAId: ObjectId;
  applicantAAlias: string;
  applicantBId: ObjectId;
  applicantBAlias: string;
  /** Symmetric score: average of A→B and B→A when both exist */
  score: number;
  /** Per-dimension breakdown from whichever direction was scored */
  breakdown: Record<string, number>;
  /** LLM rerank reasoning from whichever direction was scored; "" if unavailable */
  llmReasoning: string;
}

export type ProposalPairAction = "insert" | "revive" | "skip";

/**
 * Policy for persisting a proposal given the pair's prior match (if any).
 *
 * - no prior match            → insert a fresh proposal
 * - `expired` (collateral of someone's exclusive contact or a deactivation)
 *                             → revive: the pair gets another chance next phase
 * - `declined`                → skip forever: someone said no to this pairing
 * - `failed` / `success`      → skip forever: they already dated
 * - active (proposed/in_progress/dating) → skip: leave the live match alone
 */
export function proposalPairAction(existingStatus: MatchStatus | undefined): ProposalPairAction {
  if (!existingStatus) return "insert";
  if (existingStatus === "expired") return "revive";
  return "skip";
}

/**
 * Derives unique couple proposals from a full matching pass result.
 *
 * Each pair (A, B) is canonicalised so the smaller hex string is always "A".
 * The symmetric score is the average of A→B and B→A scores (however many
 * exist). Pairs that appear only once still get a valid score.
 *
 * Returns proposals sorted by score descending.
 */
export function generateCoupleProposals(
  applicants: ApplicantDoc[],
  results: Record<string, RankedCandidate[]>,
): CoupleProposal[] {
  // Quick lookup by hex ID
  const applicantMap = new Map<string, ApplicantDoc>();
  for (const a of applicants) {
    applicantMap.set(a._id.toHexString(), a);
  }

  // Build directed score/breakdown/reasoning maps: "aId→bId" → value
  const scoreMap = new Map<string, number>();
  const breakdownMap = new Map<string, Record<string, number>>();
  const reasoningMap = new Map<string, string>();
  for (const [aId, candidates] of Object.entries(results)) {
    for (const cand of candidates) {
      scoreMap.set(`${aId}→${cand.applicantId}`, cand.score);
      breakdownMap.set(`${aId}→${cand.applicantId}`, cand.breakdown);
      reasoningMap.set(`${aId}→${cand.applicantId}`, cand.llmReasoning);
    }
  }

  const seen = new Set<string>();
  const proposals: CoupleProposal[] = [];

  for (const [aId, candidates] of Object.entries(results)) {
    for (const cand of candidates) {
      const bId = cand.applicantId;
      // Canonical order: lexicographically smaller hex ID first
      const [firstId, secondId] = aId < bId ? [aId, bId] : [bId, aId];
      const key = `${firstId}:${secondId}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const scoreAB = scoreMap.get(`${firstId}→${secondId}`) ?? 0;
      const scoreBA = scoreMap.get(`${secondId}→${firstId}`) ?? 0;
      const count   = (scoreAB > 0 ? 1 : 0) + (scoreBA > 0 ? 1 : 0);
      const symScore = count > 0 ? (scoreAB + scoreBA) / count : 0;

      const applicantA = applicantMap.get(firstId);
      const applicantB = applicantMap.get(secondId);
      if (!applicantA || !applicantB) continue;

      const breakdown =
        breakdownMap.get(`${firstId}→${secondId}`) ??
        breakdownMap.get(`${secondId}→${firstId}`) ??
        {};

      const llmReasoning =
        reasoningMap.get(`${firstId}→${secondId}`) ||
        reasoningMap.get(`${secondId}→${firstId}`) ||
        "";

      proposals.push({
        applicantAId:    applicantA._id,
        applicantAAlias: applicantA.alias,
        applicantBId:    applicantB._id,
        applicantBAlias: applicantB.alias,
        score:           symScore,
        breakdown,
        llmReasoning,
      });
    }
  }

  return proposals.sort((a, b) => b.score - a.score);
}

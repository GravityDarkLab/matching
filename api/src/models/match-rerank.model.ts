import { ObjectId } from "mongodb";

/**
 * Caches the LLM listwise-rerank result for one applicant's shortlist, so
 * repeated admin views of GET /matching/candidates/:id don't re-call the LLM
 * every page load. Keyed by applicantId (one row per applicant, upserted);
 * shortlistHash + model detect staleness — see match-rerank.service.ts.
 */
export interface MatchRerankDoc {
  _id: ObjectId;
  applicantId: ObjectId;
  shortlistHash: string;
  model: string;
  rankings: { applicantId: string; score: number; reasoning: string }[];
  createdAt: Date;
}

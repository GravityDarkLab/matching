import { ObjectId } from "mongodb";

/**
 * Stores pre-computed embedding vectors for one applicant.
 *
 * Three vectors are stored per applicant:
 *   profile      — lifestyle + vibe_words + work  (who they are)
 *   preference   — preferred_character + preferred_physical + dream_first_date  (who they want)
 *   dealBreakers — deal_breakers  (what they can't tolerate)
 *
 * provider + model are stored so the matching engine can detect and
 * discard stale embeddings when the configured model changes.
 *
 * textVersion tracks which text composition was used to build the vectors.
 * Bumped whenever the set of fields fed into any embedding changes.
 * Current: 2 (added work to profile, dream_first_date to preference).
 */
export interface EmbeddingDoc {
  _id: ObjectId;
  applicantId: ObjectId;
  provider: string;     // "openai" | "local"
  model: string;        // e.g. "text-embedding-3-small"
  textVersion: number;  // bumped when embedded text composition changes
  profile: number[];
  preference: number[];
  dealBreakers: number[];
  createdAt: Date;
}

/**
 * Numeric-vector helpers for the matching scorer (scorer.ts).
 *
 * Encodes an applicant's structural preferences (relationship type,
 * long-distance, affection, religion openness) as a fixed-length numeric
 * vector compared with cosine similarity — the NUMERIC component of the
 * embedding-stage score. Kept as its own module so the encoding and the
 * cosine/rounding helpers stay independently unit-testable.
 */

// ─── Relationship type encoding ───────────────────────────────────────────────
//
// Each type is encoded as a 2D sub-vector [long_term_affinity, short_term_affinity].
// "Open to Both" gets partial credit on both axes (0.7) to allow it to match
// with either extreme without fully saturating either dimension.

const REL_TYPE_ENCODING: Record<string, [number, number]> = {
  //                              [long_term, short_term]
  "Long Term":    [1.0, 0.0],
  "Short Term":   [0.0, 1.0],
  "Open to Both": [0.7, 0.7],
  "Casual":       [0.1, 0.9],
  "Not Sure":     [0.4, 0.4],
};

// ─── Answer accessors ─────────────────────────────────────────────────────────

export function str(answers: Record<string, unknown>, key: string): string {
  const v = answers[key];
  return typeof v === "string" ? v.trim() : "";
}

function bool(answers: Record<string, unknown>, key: string): boolean | null {
  const v = answers[key];
  return typeof v === "boolean" ? v : null;
}

function num(answers: Record<string, unknown>, key: string): number | null {
  const v = answers[key];
  return typeof v === "number" ? v : null;
}

// ─── Numeric vector ───────────────────────────────────────────────────────────
//
// Dimensions:
//   [0] rel_long_term      — how strongly the person wants a long-term relationship
//   [1] rel_short_term     — how strongly the person wants a short-term relationship
//   [2] open_to_long_dist  — 1 = yes, 0 = no
//   [3] affection_level    — physical_affection_importance normalised to [0, 1]
//   [4] religion_openness  — 1 = flexible, 0 = religion is a deal breaker

export function buildNumericVector(answers: Record<string, unknown>): number[] {
  const relType = str(answers, "relationship_type");
  const [relLong, relShort] = REL_TYPE_ENCODING[relType] ?? [0.4, 0.4];

  const longDist = bool(answers, "open_to_long_distance") === true ? 1.0 : 0.0;
  const affection = (num(answers, "physical_affection_importance") ?? 5) / 10;

  // religion_deal_breaker: false = open = 1.0, true = inflexible = 0.0
  const religionOpen = bool(answers, "religion_deal_breaker") === false ? 1.0 : 0.0;

  return [relLong, relShort, longDist, affection, religionOpen];
}

// ─── Cosine similarity ────────────────────────────────────────────────────────

export function cosine(a: number[], b: number[]): number {
  // Different lengths means vectors from different embedding models — the
  // loop below would silently produce NaN or a meaningless partial dot product.
  if (a.length !== b.length) {
    throw new Error(`[cosine] Vector length mismatch (${a.length} vs ${b.length}) — mixed embedding models?`);
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ─── Rounding ─────────────────────────────────────────────────────────────────

export function round(n: number): number {
  return Math.round(n * 100) / 100;
}

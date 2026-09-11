import type { MatchSummary } from "../models/match.model.js";

export const FALLBACK_PROS = [
  "You share similar values and lifestyle expectations.",
  "Your communication styles appear compatible.",
];

export const FALLBACK_CONS = [
  "Like any new connection, this one will need open conversation to thrive.",
];

// Tags a summary built from the fallback text rather than a real LLM
// response — never equal to a real model string, so the caller's cache-hit
// check always treats a fallback as a miss and retries the LLM on the next
// request instead of serving the generic fallback forever.
export const FALLBACK_MODEL = "fallback";

/**
 * Parses a raw chat-completion response into a MatchSummary, falling back to
 * generic text when the response is empty (the call itself failed) or
 * unparsable. Pure — no DB or network access — so the fallback-tagging
 * decision is unit-testable directly.
 */
export function buildSummaryResult(raw: string, realModel: string): MatchSummary {
  if (!raw) {
    // generateChatCompletion never throws — "" means the call itself failed
    // (timeout, non-2xx, provider outage).
    return { pros: FALLBACK_PROS, cons: FALLBACK_CONS, generatedAt: new Date(), model: FALLBACK_MODEL };
  }

  try {
    const parsed = JSON.parse(raw) as { pros?: unknown; cons?: unknown };
    const cleanStrings = (arr: unknown): string[] =>
      Array.isArray(arr) ? arr.filter((v): v is string => typeof v === "string" && v.trim().length > 0) : [];
    const cleanPros = cleanStrings(parsed.pros);
    const cleanCons = cleanStrings(parsed.cons);
    const pros = cleanPros.length ? cleanPros.slice(0, 3) : FALLBACK_PROS;
    const cons = cleanCons.length ? cleanCons.slice(0, 2) : FALLBACK_CONS;
    return { pros, cons, generatedAt: new Date(), model: realModel };
  } catch {
    // Unparsable response — a real failure, not a real result.
    return { pros: FALLBACK_PROS, cons: FALLBACK_CONS, generatedAt: new Date(), model: FALLBACK_MODEL };
  }
}

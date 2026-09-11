import { describe, it, expect } from "bun:test";
import {
  buildSummaryResult,
  FALLBACK_MODEL,
  FALLBACK_PROS,
  FALLBACK_CONS,
} from "../../../services/match-summary-result.util.js";

const REAL_MODEL = "gpt-5.4-mini";

describe("buildSummaryResult", () => {
  it("tags a real, successfully-parsed result with the real model", () => {
    const raw = JSON.stringify({ pros: ["Strength 1", "Strength 2"], cons: ["Note 1"] });
    const result = buildSummaryResult(raw, REAL_MODEL);
    expect(result).toEqual({
      pros: ["Strength 1", "Strength 2"],
      cons: ["Note 1"],
      generatedAt: result.generatedAt,
      model: REAL_MODEL,
    });
  });

  it("caps pros at 3 and cons at 2", () => {
    const raw = JSON.stringify({
      pros: ["p1", "p2", "p3", "p4"],
      cons: ["c1", "c2", "c3"],
    });
    const result = buildSummaryResult(raw, REAL_MODEL);
    expect(result.pros).toHaveLength(3);
    expect(result.cons).toHaveLength(2);
  });

  it("filters out empty/non-string entries before checking length", () => {
    const raw = JSON.stringify({ pros: ["", "  ", "Real one", 42], cons: [""] });
    const result = buildSummaryResult(raw, REAL_MODEL);
    expect(result.pros).toEqual(["Real one"]);
    expect(result.cons).toEqual(FALLBACK_CONS); // no valid cons -> falls back for that field
    expect(result.model).toBe(REAL_MODEL); // still a real result, just a sparse one
  });

  // The bug this guards against: a fallback summary tagged as if it were a
  // real result gets served back forever (match.summary.model === SUMMARY_MODEL
  // short-circuits the cache-hit check on every future request).
  it("tags a fallback from an empty response with FALLBACK_MODEL, not the real model", () => {
    const result = buildSummaryResult("", REAL_MODEL);
    expect(result.model).toBe(FALLBACK_MODEL);
    expect(result.model).not.toBe(REAL_MODEL);
    expect(result.pros).toEqual(FALLBACK_PROS);
    expect(result.cons).toEqual(FALLBACK_CONS);
  });

  it("tags a fallback from unparsable JSON with FALLBACK_MODEL, not the real model", () => {
    const result = buildSummaryResult("not json", REAL_MODEL);
    expect(result.model).toBe(FALLBACK_MODEL);
    expect(result.model).not.toBe(REAL_MODEL);
  });

  it("FALLBACK_MODEL never collides with a real model name", () => {
    // Guards the invariant the cache-hit check depends on: a fallback must
    // never be indistinguishable from a genuine result for any real model.
    expect(FALLBACK_MODEL).not.toBe(REAL_MODEL);
    expect(FALLBACK_MODEL).not.toBe("gpt-4o-mini");
  });
});

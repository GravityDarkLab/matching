import { describe, it, expect } from "bun:test";
import { buildNumericVector, cosine, round, str } from "../../../matching/scorers/numeric.scorer.js";

describe("buildNumericVector", () => {
  it("encodes 'Long Term' as [1.0, 0.0]", () => {
    const [relLong, relShort] = buildNumericVector({ relationship_type: "Long Term" });
    expect(relLong).toBe(1.0);
    expect(relShort).toBe(0.0);
  });

  it("encodes 'Short Term' as [0.0, 1.0]", () => {
    const [relLong, relShort] = buildNumericVector({ relationship_type: "Short Term" });
    expect(relLong).toBe(0.0);
    expect(relShort).toBe(1.0);
  });

  it("gives 'Open to Both' partial credit on both axes", () => {
    const [relLong, relShort] = buildNumericVector({ relationship_type: "Open to Both" });
    expect(relLong).toBe(0.7);
    expect(relShort).toBe(0.7);
  });

  it("falls back to a neutral encoding for an unknown relationship_type", () => {
    const [relLong, relShort] = buildNumericVector({ relationship_type: "Whatever" });
    expect(relLong).toBe(0.4);
    expect(relShort).toBe(0.4);
  });

  it("encodes open_to_long_distance true/false as 1.0/0.0", () => {
    expect(buildNumericVector({ open_to_long_distance: true })[2]).toBe(1.0);
    expect(buildNumericVector({ open_to_long_distance: false })[2]).toBe(0.0);
  });

  it("normalises physical_affection_importance to [0, 1] and defaults to 0.5 when missing", () => {
    expect(buildNumericVector({ physical_affection_importance: 10 })[3]).toBe(1.0);
    expect(buildNumericVector({ physical_affection_importance: 1 })[3]).toBe(0.1);
    expect(buildNumericVector({})[3]).toBe(0.5);
  });

  it("encodes religion_deal_breaker false as open (1.0) and true/missing as closed (0.0)", () => {
    expect(buildNumericVector({ religion_deal_breaker: false })[4]).toBe(1.0);
    expect(buildNumericVector({ religion_deal_breaker: true })[4]).toBe(0.0);
    expect(buildNumericVector({})[4]).toBe(0.0);
  });

  it("returns a 5-dimensional vector", () => {
    expect(buildNumericVector({})).toHaveLength(5);
  });
});

describe("cosine", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosine([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosine([1, 0], [0, 1])).toBe(0);
  });

  it("returns -1 for opposite vectors", () => {
    expect(cosine([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it("returns 0 when either vector is all zeros (avoids division by zero)", () => {
    expect(cosine([0, 0], [1, 1])).toBe(0);
    expect(cosine([1, 1], [0, 0])).toBe(0);
    expect(cosine([0, 0], [0, 0])).toBe(0);
  });
});

describe("round", () => {
  it("rounds to two decimal places", () => {
    expect(round(0.123456)).toBe(0.12);
    expect(round(0.125)).toBe(0.13);
    expect(round(1)).toBe(1);
  });
});

describe("str", () => {
  it("returns the trimmed string value for a given key", () => {
    expect(str({ work: "  Engineer  " }, "work")).toBe("Engineer");
  });

  it("returns an empty string for a missing or non-string value", () => {
    expect(str({}, "work")).toBe("");
    expect(str({ work: 42 }, "work")).toBe("");
  });
});

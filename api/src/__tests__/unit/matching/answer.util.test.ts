import { describe, it, expect } from "bun:test";
import { normalizeAnswer } from "../../../matching/filters/answer.util.js";

describe("normalizeAnswer", () => {
  it("trims and lowercases a string answer", () => {
    expect(normalizeAnswer({ location: "  Paris, France  " }, "location")).toBe(
      "paris, france"
    );
  });

  it("returns an empty string for a missing key", () => {
    expect(normalizeAnswer({}, "location")).toBe("");
  });

  it("returns an empty string for a non-string value", () => {
    expect(normalizeAnswer({ location: 42 }, "location")).toBe("");
    expect(normalizeAnswer({ location: null }, "location")).toBe("");
    expect(normalizeAnswer({ location: undefined }, "location")).toBe("");
  });

  it("returns an empty string for an all-whitespace value", () => {
    expect(normalizeAnswer({ location: "   " }, "location")).toBe("");
  });
});

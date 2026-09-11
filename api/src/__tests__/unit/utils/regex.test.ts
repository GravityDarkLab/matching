import { describe, it, expect } from "bun:test";
import { escapeRegex } from "../../../utils/regex.js";

describe("escapeRegex", () => {
  it("escapes every regex metacharacter", () => {
    expect(escapeRegex(".*+?^${}()|[]\\")).toBe(
      "\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\"
    );
  });

  it("leaves plain alphanumeric text unchanged", () => {
    expect(escapeRegex("Crescent River 123")).toBe("Crescent River 123");
  });

  it("produces a string that matches the original literally when used as a $regex", () => {
    const input = "user+test@example.com (admin)";
    const escaped = escapeRegex(input);
    expect(new RegExp(escaped).test(input)).toBe(true);
    expect(new RegExp(escaped).test("user_test@example_com (admin)")).toBe(false);
  });

  it("returns an empty string for empty input", () => {
    expect(escapeRegex("")).toBe("");
  });
});

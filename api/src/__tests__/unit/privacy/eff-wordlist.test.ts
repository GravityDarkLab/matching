import { describe, it, expect } from "bun:test";
import { EFF_WORDLIST } from "../../../privacy/eff-wordlist.js";

describe("EFF_WORDLIST", () => {
  it("has 1295 entries (the official 1296-word EFF short wordlist, minus 'yo-yo')", () => {
    expect(EFF_WORDLIST).toHaveLength(1295);
  });

  it("contains only unique entries", () => {
    expect(new Set(EFF_WORDLIST).size).toBe(EFF_WORDLIST.length);
  });

  it("contains only lowercase alphabetic words — no separators, digits, or spaces", () => {
    // Guards the invariant password-generator.ts relies on: every entry must
    // be safe to join with "-" without an embedded character creating an
    // extra, unintended split point.
    for (const word of EFF_WORDLIST) {
      expect(word).toMatch(/^[a-z]+$/);
    }
  });

  it("does not contain 'yo-yo' (excluded — collides with the '-' join separator)", () => {
    expect(EFF_WORDLIST).not.toContain("yo-yo");
  });

  it("does contain 'yoyo' (the hyphen-free twin entry, not excluded)", () => {
    expect(EFF_WORDLIST).toContain("yoyo");
  });
});

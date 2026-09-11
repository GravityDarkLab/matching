import { describe, it, expect } from "bun:test";
import { EFF_WORDLIST } from "../../../privacy/eff-wordlist.js";
import {
  DEFAULT_WORD_COUNT,
  generateReadablePassword,
  passphraseEntropyBits,
} from "../../../privacy/password-generator.js";

describe("generateReadablePassword", () => {
  it("returns DEFAULT_WORD_COUNT words joined by single hyphens by default", () => {
    const pwd = generateReadablePassword();
    expect(pwd.split("-")).toHaveLength(DEFAULT_WORD_COUNT);
  });

  it("respects a custom word count", () => {
    for (const wordCount of [1, 3, 4, 8]) {
      const pwd = generateReadablePassword(wordCount);
      expect(pwd.split("-")).toHaveLength(wordCount);
    }
  });

  it("every word comes from EFF_WORDLIST", () => {
    const pwd = generateReadablePassword(10);
    for (const word of pwd.split("-")) {
      expect(EFF_WORDLIST).toContain(word);
    }
  });

  it("returns lowercase alphabetic words only (no stray separators leak through)", () => {
    const pwd = generateReadablePassword(10);
    for (const word of pwd.split("-")) {
      expect(word).toMatch(/^[a-z]+$/);
    }
  });

  it("returns different values on consecutive calls", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10; i++) seen.add(generateReadablePassword());
    expect(seen.size).toBeGreaterThan(1);
  });

  it("draws roughly uniformly across the wordlist (loose statistical sanity check)", () => {
    // Not a rigorous chi-square test — just a guard against a gross bias bug
    // (e.g. accidentally reintroducing modulo bias, or always picking index 0).
    // With 1295 words and 400 independent draws, the birthday bound predicts
    // most draws should be distinct; far fewer than ~150 distinct values would
    // indicate something is badly non-uniform.
    const draws = new Set<string>();
    for (let i = 0; i < 400; i++) draws.add(generateReadablePassword(1));
    expect(draws.size).toBeGreaterThan(150);
  });
});

describe("passphraseEntropyBits", () => {
  it("equals wordCount * log2(EFF_WORDLIST.length)", () => {
    const expected = 5 * Math.log2(EFF_WORDLIST.length);
    expect(passphraseEntropyBits(5)).toBeCloseTo(expected, 10);
  });

  it("defaults to DEFAULT_WORD_COUNT words", () => {
    expect(passphraseEntropyBits()).toBeCloseTo(
      DEFAULT_WORD_COUNT * Math.log2(EFF_WORDLIST.length),
      10
    );
  });

  it("the default word count clears the ~60-bit diceware floor", () => {
    expect(passphraseEntropyBits(DEFAULT_WORD_COUNT)).toBeGreaterThanOrEqual(60);
  });

  it("the previous scheme (4 words from a 182-word list) would not have cleared it", () => {
    // Historical regression guard: documents *why* the old implementation
    // (4 words, 182-word list, ~30 bits) was replaced.
    const oldEntropy = 4 * Math.log2(182);
    expect(oldEntropy).toBeLessThan(35);
  });

  it("entropy scales linearly with word count (exponentially with possibilities)", () => {
    const e4 = passphraseEntropyBits(4);
    const e8 = passphraseEntropyBits(8);
    expect(e8).toBeCloseTo(e4 * 2, 10);
  });
});

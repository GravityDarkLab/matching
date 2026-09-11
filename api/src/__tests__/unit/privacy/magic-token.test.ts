import { describe, expect, it } from "bun:test";
import {
  generateMagicToken,
  hashMagicToken,
} from "../../../privacy/magic-token";

describe("generateMagicToken", () => {
  it("returns a 64-character hex string", () => {
    const token = generateMagicToken();
    expect(token).toHaveLength(64);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns different values on consecutive calls", () => {
    const a = generateMagicToken();
    const b = generateMagicToken();
    expect(a).not.toBe(b);
  });
});

describe("hashMagicToken", () => {
  it("returns a 64-character hex string (SHA-256)", () => {
    const hash = hashMagicToken("a".repeat(64));
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same input", () => {
    const token = generateMagicToken();
    expect(hashMagicToken(token)).toBe(hashMagicToken(token));
  });

  it("produces different hashes for different tokens", () => {
    expect(hashMagicToken("a".repeat(64))).not.toBe(hashMagicToken("b".repeat(64)));
  });

  it("hash differs from the raw token", () => {
    const token = generateMagicToken();
    expect(hashMagicToken(token)).not.toBe(token);
  });
});

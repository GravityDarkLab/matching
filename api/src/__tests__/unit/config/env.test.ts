import { describe, expect, it } from "bun:test";
import {
  parseAllowedOrigins,
  validateEncryptionKey,
  validatePositiveInt,
} from "../../../config/env.js";

describe("parseAllowedOrigins", () => {
  it("accepts comma and semicolon separated origins", () => {
    expect(
      parseAllowedOrigins(
        "http://localhost:3000,http://localhost:5173,http://localhost:5174;http://localhost:3001"
      )
    ).toEqual([
      "http://localhost:3000",
      "http://localhost:5173",
      "http://localhost:5174",
      "http://localhost:3001",
    ]);
  });

  it("trims whitespace and trailing slashes", () => {
    expect(
      parseAllowedOrigins(" http://localhost:5174/ ; http://localhost:3001// ")
    ).toEqual(["http://localhost:5174", "http://localhost:3001"]);
  });

  it("returns an empty array for an empty string", () => {
    expect(parseAllowedOrigins("")).toEqual([]);
  });

  it("returns an empty array when only separators are present", () => {
    expect(parseAllowedOrigins(" ,;,; ")).toEqual([]);
  });

  it("filters out empty segments from leading/trailing/double separators", () => {
    expect(parseAllowedOrigins(",http://a.com,,http://b.com,")).toEqual([
      "http://a.com",
      "http://b.com",
    ]);
  });

  it("returns a single-element array when no separator is present", () => {
    expect(parseAllowedOrigins("http://localhost:3000")).toEqual([
      "http://localhost:3000",
    ]);
  });

  it("strips many trailing slashes but preserves internal path segments", () => {
    expect(parseAllowedOrigins("http://localhost:5174/api///")).toEqual([
      "http://localhost:5174/api",
    ]);
  });
});

describe("validateEncryptionKey", () => {
  it("accepts exactly 64 hex characters", () => {
    const key = "a".repeat(64);
    expect(validateEncryptionKey(key)).toBe(key);
  });

  it("accepts uppercase hex characters", () => {
    const key = "A".repeat(64);
    expect(validateEncryptionKey(key)).toBe(key);
  });

  it("rejects a key shorter than 64 characters", () => {
    expect(() => validateEncryptionKey("a".repeat(63))).toThrow(
      /must be exactly 64 hex characters/
    );
  });

  it("rejects a key longer than 64 characters", () => {
    expect(() => validateEncryptionKey("a".repeat(65))).toThrow(
      /must be exactly 64 hex characters/
    );
  });

  it("rejects non-hex characters", () => {
    expect(() => validateEncryptionKey("g".repeat(64))).toThrow(
      /must be exactly 64 hex characters/
    );
  });

  it("rejects an empty string", () => {
    expect(() => validateEncryptionKey("")).toThrow();
  });
});

describe("validatePositiveInt", () => {
  it("accepts a positive integer string", () => {
    expect(validatePositiveInt("DELETION_GRACE_DAYS", "180")).toBe(180);
  });

  it("rejects zero", () => {
    expect(() => validatePositiveInt("DELETION_GRACE_DAYS", "0")).toThrow(
      /must be a positive integer/
    );
  });

  it("rejects negative numbers", () => {
    expect(() => validatePositiveInt("DELETION_GRACE_DAYS", "-3")).toThrow(
      /must be a positive integer/
    );
  });

  it("rejects non-numeric strings", () => {
    expect(() => validatePositiveInt("DELETION_GRACE_DAYS", "abc")).toThrow(
      /must be a positive integer/
    );
  });

  it("truncates a decimal string to its integer part (parseInt semantics)", () => {
    // Documents current behavior: parseInt("3.7", 10) === 3, which passes the
    // positive-integer check. Not validated as a "clean" integer string.
    expect(validatePositiveInt("DELETION_GRACE_DAYS", "3.7")).toBe(3);
  });

  it("includes the var name and offending value in the error message", () => {
    expect(() => validatePositiveInt("PORT", "nope")).toThrow(
      'PORT must be a positive integer, got "nope"'
    );
  });
});

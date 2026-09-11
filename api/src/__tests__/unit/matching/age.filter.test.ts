import { describe, it, expect } from "bun:test";
import { isAgeCompatible, ageModifier } from "../../../matching/filters/age.filter.js";
import type { ApplicantDoc } from "../../../models/applicant.model.js";
import { ObjectId } from "mongodb";

function makeApplicant(
  birthDate: string | undefined,
  maxAgeGap: number | null | undefined,
  openToOlder: boolean | null | undefined,
  openToYounger: boolean | null | undefined
): ApplicantDoc {
  return {
    _id: new ObjectId(),
    alias: "Test",
    questionnaireVersion: "1.1.0",
    answers: {
      birth_date: birthDate,
      max_age_gap: maxAgeGap,
      open_to_older: openToOlder,
      open_to_younger: openToYounger,
    },
    status: "applied",
    magicToken: "a".repeat(64),
    passwordHash: "hash",
    scoreThreshold: 0.8,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// 30-year-old and 25-year-old: gap = 5
const older = makeApplicant("1994-01-01", 5, true, true);
const younger = makeApplicant("1999-01-01", 5, true, true);

describe("isAgeCompatible", () => {
  it("passes when gap is within both parties' max_age_gap", () => {
    expect(isAgeCompatible(older, younger)).toBe(true);
  });

  it("passes when both parties have max_age_gap = null (no preference)", () => {
    const noPreferenceA = makeApplicant("1980-01-01", null, null, null);
    const noPreferenceB = makeApplicant("1999-01-01", null, null, null);
    expect(isAgeCompatible(noPreferenceA, noPreferenceB)).toBe(true);
  });

  it("passes when one party has max_age_gap = null (gap checked against the other's preference only)", () => {
    const noPreference = makeApplicant("1994-01-01", null, null, null);
    // younger has max_age_gap 5; gap = 0 (same year) → passes
    const sameYear = makeApplicant("1994-06-01", 5, true, true);
    expect(isAgeCompatible(noPreference, sameYear)).toBe(true);
  });

  it("fails when gap exceeds 2× max_age_gap (hard limit)", () => {
    const strictOlder = makeApplicant("1994-01-01", 2, true, true); // gap 5 > 2×2=4
    expect(isAgeCompatible(strictOlder, younger)).toBe(false);
  });

  it("fails when open_to_older is false and partner is older", () => {
    const noOlderPlease = makeApplicant("1999-01-01", 10, false, true);
    expect(isAgeCompatible(noOlderPlease, older)).toBe(false);
  });

  it("fails when open_to_younger is false and partner is younger", () => {
    const noYoungerPlease = makeApplicant("1994-01-01", 10, true, false);
    expect(isAgeCompatible(noYoungerPlease, younger)).toBe(false);
  });

  // The three age questions are independent and optional in the questionnaire —
  // a blank max_age_gap ("no preference on the gap") must not silently void an
  // explicit directional veto.
  it("fails when open_to_older is false and partner is older, even with max_age_gap = null", () => {
    const noOlderNoGap = makeApplicant("1999-01-01", null, false, true);
    expect(isAgeCompatible(noOlderNoGap, older)).toBe(false);
  });

  it("fails when open_to_younger is false and partner is younger, even with max_age_gap = null", () => {
    const noYoungerNoGap = makeApplicant("1994-01-01", null, true, false);
    expect(isAgeCompatible(noYoungerNoGap, younger)).toBe(false);
  });

  it("passes when birth_date is missing on either side (skip filter)", () => {
    const noBirthDate = makeApplicant(undefined, 5, true, true);
    expect(isAgeCompatible(noBirthDate, younger)).toBe(true);
    expect(isAgeCompatible(older, noBirthDate)).toBe(true);
  });

  it("passes exact boundary: gap equals max_age_gap", () => {
    const exactFit = makeApplicant("1994-01-01", 5, true, true); // gap = 5 = max_gap
    expect(isAgeCompatible(exactFit, younger)).toBe(true);
  });

  it("fails when gap > max_age_gap but <= 2× (in decay zone, but hard filter still passes)", () => {
    const moderateGap = makeApplicant("1994-01-01", 3, true, true); // gap 5, max 3 → 5 <= 6 → should pass hard filter
    expect(isAgeCompatible(moderateGap, younger)).toBe(true); // still within 2× limit
  });

  it("bidirectional: fails if EITHER party's constraints reject the pair", () => {
    const strictYounger = makeApplicant("1999-01-01", 5, false, true); // open_to_older=false, partner IS older → fail
    expect(isAgeCompatible(older, strictYounger)).toBe(false);
    expect(isAgeCompatible(strictYounger, older)).toBe(false);
  });
});

describe("ageModifier", () => {
  it("returns 1.0 when gap is within max_age_gap", () => {
    expect(ageModifier(older, younger)).toBe(1.0); // gap 5, max 5
  });

  it("returns 1.0 when max_age_gap is null (no preference)", () => {
    const noPreference = makeApplicant("1994-01-01", null, null, null);
    expect(ageModifier(noPreference, younger)).toBe(1.0);
  });

  it("returns 1.0 when birth_date is missing", () => {
    const noBirthDate = makeApplicant(undefined, 5, true, true);
    expect(ageModifier(noBirthDate, younger)).toBe(1.0);
  });

  it("returns value in (0, 1) for gap in soft-decay zone", () => {
    // gap = 5, max = 3 → t = (5-3)/3 = 0.667 → cos(0.667 × π/2) ≈ 0.5
    const shortMax = makeApplicant("1994-01-01", 3, true, true);
    const mod = ageModifier(shortMax, younger);
    expect(mod).toBeGreaterThan(0);
    expect(mod).toBeLessThan(1);
  });

  it("returns 0.0 when gap > 2× max_age_gap (hard outer limit)", () => {
    const tooStrict = makeApplicant("1994-01-01", 2, true, true); // gap 5 > 2×2=4
    expect(ageModifier(tooStrict, younger)).toBe(0.0);
  });

  it("takes the minimum (stricter) of both parties' modifiers", () => {
    const strictA = makeApplicant("1994-01-01", 3, true, true); // decay zone
    const lenientB = makeApplicant("1999-01-01", null, true, true); // no preference = 1.0
    const mod = ageModifier(strictA, lenientB);
    // strictA's modifier should be < 1; lenientB's is 1.0; result = min
    expect(mod).toBeLessThan(1.0);
  });
});

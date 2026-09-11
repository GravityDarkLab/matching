import { describe, it, expect } from "bun:test";
import { isOrientationCompatible } from "../../../matching/filters/orientation.filter.js";
import type { ApplicantDoc } from "../../../models/applicant.model.js";
import { ObjectId } from "mongodb";

function makeApplicant(
  orientation: string,
  gender: string,
  overrides: Partial<ApplicantDoc> = {}
): ApplicantDoc {
  return {
    _id: new ObjectId(),
    alias: "Test Alias",
    questionnaireVersion: "1.0.0",
    answers: { sexual_orientation: orientation, gender_identity: gender },
    status: "applied",
    magicToken: "a".repeat(64),
    passwordHash: "hash",
    scoreThreshold: 0.8,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("isOrientationCompatible — Straight", () => {
  it("Straight Male + Straight Female → compatible", () => {
    expect(
      isOrientationCompatible(
        makeApplicant("Straight", "Male"),
        makeApplicant("Straight", "Female")
      )
    ).toBe(true);
  });

  it("Straight Female + Straight Male → compatible (reversed)", () => {
    expect(
      isOrientationCompatible(
        makeApplicant("Straight", "Female"),
        makeApplicant("Straight", "Male")
      )
    ).toBe(true);
  });

  it("Straight Male + Straight Male → incompatible", () => {
    expect(
      isOrientationCompatible(
        makeApplicant("Straight", "Male"),
        makeApplicant("Straight", "Male")
      )
    ).toBe(false);
  });

  it("Straight Female + Straight Female → incompatible", () => {
    expect(
      isOrientationCompatible(
        makeApplicant("Straight", "Female"),
        makeApplicant("Straight", "Female")
      )
    ).toBe(false);
  });

  it("Straight Male + Gay Male → incompatible (Gay Male wants Male, Straight Male wants Female)", () => {
    expect(
      isOrientationCompatible(
        makeApplicant("Straight", "Male"),
        makeApplicant("Gay", "Male")
      )
    ).toBe(false);
  });
});

describe("isOrientationCompatible — Gay", () => {
  it("Gay Male + Gay Male → compatible", () => {
    expect(
      isOrientationCompatible(
        makeApplicant("Gay", "Male"),
        makeApplicant("Gay", "Male")
      )
    ).toBe(true);
  });

  it("Gay Male + Lesbian Female → incompatible (Gay wants Male, Lesbian wants Female)", () => {
    expect(
      isOrientationCompatible(
        makeApplicant("Gay", "Male"),
        makeApplicant("Lesbian", "Female")
      )
    ).toBe(false);
  });

  it("Gay Male + Straight Female → incompatible (Gay Male wants Male, Straight Female wants Male → both want Male partner)", () => {
    // Gay Male wants Male partner ✓ for Female? No — Gay Male wants Male, partner is Female → ✗
    expect(
      isOrientationCompatible(
        makeApplicant("Gay", "Male"),
        makeApplicant("Straight", "Female")
      )
    ).toBe(false);
  });

  // Regression: "Gay" is not exclusively a men's-only label — some women and
  // non-binary people describe their own orientation as "gay" rather than
  // "lesbian". The filter must not permanently exclude them from everyone.
  it("Gay Female + Gay Female → compatible (Gay means same-gender attraction, not 'must be Male')", () => {
    expect(
      isOrientationCompatible(
        makeApplicant("Gay", "Female"),
        makeApplicant("Gay", "Female")
      )
    ).toBe(true);
  });

  it("Gay Female + Straight Male → incompatible (Gay Female wants Female)", () => {
    expect(
      isOrientationCompatible(
        makeApplicant("Gay", "Female"),
        makeApplicant("Straight", "Male")
      )
    ).toBe(false);
  });

  it("Gay Non-binary + Gay Non-binary → compatible (same-gender attraction applies to every gender, not just Male)", () => {
    expect(
      isOrientationCompatible(
        makeApplicant("Gay", "Non-binary"),
        makeApplicant("Gay", "Non-binary")
      )
    ).toBe(true);
  });

  it("Gay Non-binary + Straight Male → incompatible (previously fell through with no filter at all)", () => {
    expect(
      isOrientationCompatible(
        makeApplicant("Gay", "Non-binary"),
        makeApplicant("Straight", "Male")
      )
    ).toBe(false);
  });
});

describe("isOrientationCompatible — Lesbian", () => {
  it("Lesbian Female + Lesbian Female → compatible", () => {
    expect(
      isOrientationCompatible(
        makeApplicant("Lesbian", "Female"),
        makeApplicant("Lesbian", "Female")
      )
    ).toBe(true);
  });

  it("Lesbian Female + Straight Female → incompatible (Straight Female wants Male)", () => {
    expect(
      isOrientationCompatible(
        makeApplicant("Lesbian", "Female"),
        makeApplicant("Straight", "Female")
      )
    ).toBe(false);
  });

  // Regression: "Lesbian" is not exclusively a women's-only label — a man
  // (or non-binary person) can describe their own orientation as "lesbian".
  // The filter must not permanently exclude them from everyone.
  it("Lesbian Male + Lesbian Male → compatible (Lesbian means same-gender attraction, not 'must be Female')", () => {
    expect(
      isOrientationCompatible(
        makeApplicant("Lesbian", "Male"),
        makeApplicant("Lesbian", "Male")
      )
    ).toBe(true);
  });

  it("Lesbian Male + Lesbian Female → incompatible (different genders, not because Male+Lesbian is categorically excluded)", () => {
    expect(
      isOrientationCompatible(
        makeApplicant("Lesbian", "Male"),
        makeApplicant("Lesbian", "Female")
      )
    ).toBe(false);
  });

  it("Lesbian Non-binary + Lesbian Non-binary → compatible (previously fell through with no filter at all)", () => {
    expect(
      isOrientationCompatible(
        makeApplicant("Lesbian", "Non-binary"),
        makeApplicant("Lesbian", "Non-binary")
      )
    ).toBe(true);
  });
});

describe("isOrientationCompatible — Bisexual / Pansexual", () => {
  it("Bisexual + Straight Male → compatible", () => {
    expect(
      isOrientationCompatible(
        makeApplicant("Bisexual", "Female"),
        makeApplicant("Straight", "Male")
      )
    ).toBe(true);
  });

  it("Bisexual + Lesbian Female → compatible (Bisexual has no gender filter)", () => {
    expect(
      isOrientationCompatible(
        makeApplicant("Bisexual", "Female"),
        makeApplicant("Lesbian", "Female")
      )
    ).toBe(true);
  });

  it("Pansexual + any gender/orientation → compatible", () => {
    const pan = makeApplicant("Pansexual", "Male");
    expect(isOrientationCompatible(pan, makeApplicant("Straight", "Female"))).toBe(true);
    expect(isOrientationCompatible(pan, makeApplicant("Gay", "Male"))).toBe(true);
    expect(isOrientationCompatible(pan, makeApplicant("Lesbian", "Female"))).toBe(false); // Lesbian Female doesn't want Male
  });

  it("Bisexual + Bisexual → compatible", () => {
    expect(
      isOrientationCompatible(
        makeApplicant("Bisexual", "Male"),
        makeApplicant("Bisexual", "Female")
      )
    ).toBe(true);
  });
});

describe("isOrientationCompatible — Asexual / missing", () => {
  it("Asexual has no gender filter — but other side's filter still applies", () => {
    const ace = makeApplicant("Asexual", "Female");
    // Straight Male wants Female → compatible with Asexual Female ✓
    expect(isOrientationCompatible(ace, makeApplicant("Straight", "Male"))).toBe(true);
    // Gay Male wants Male → Asexual Female is Female, so Gay Male's side fails ✗
    expect(isOrientationCompatible(ace, makeApplicant("Gay", "Male"))).toBe(false);
    // Lesbian Female wants Female → compatible with Asexual Female ✓
    expect(isOrientationCompatible(ace, makeApplicant("Lesbian", "Female"))).toBe(true);
    // Another Asexual → both pass through ✓
    expect(isOrientationCompatible(ace, makeApplicant("Asexual", "Male"))).toBe(true);
  });

  it("empty orientation → no gender filter, but other side's filter still applies", () => {
    // Unknown person has no gender — Straight Male wants Female; "" !== "Female" → fails
    const unknown = makeApplicant("", "");
    expect(isOrientationCompatible(unknown, makeApplicant("Straight", "Male"))).toBe(false);
    // Bisexual has no gender filter → both sides pass ✓
    expect(isOrientationCompatible(unknown, makeApplicant("Bisexual", "Female"))).toBe(true);
    // Two unknowns → both pass through ✓
    expect(isOrientationCompatible(unknown, makeApplicant("", ""))).toBe(true);
  });

  it("'Prefer not to say' orientation → compatible with any", () => {
    const pnts = makeApplicant("Prefer not to say", "Male");
    expect(isOrientationCompatible(pnts, makeApplicant("Straight", "Female"))).toBe(true);
    expect(isOrientationCompatible(pnts, makeApplicant("Bisexual", "Female"))).toBe(true);
  });
});

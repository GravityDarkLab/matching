import { describe, it, expect } from "bun:test";
import { ObjectId } from "mongodb";
import { isLongDistanceCompatible } from "../../../matching/filters/location.filter.js";
import type { ApplicantDoc } from "../../../models/applicant.model.js";

function makeApplicant(location: string | undefined, openToLD: boolean | null): ApplicantDoc {
  return {
    _id: new ObjectId(),
    alias: "Test",
    questionnaireVersion: "1.1.0",
    answers: {
      ...(location !== undefined ? { location } : {}),
      ...(openToLD !== null ? { open_to_long_distance: openToLD } : {}),
    },
    status: "applied",
    magicToken: "tok",
    scoreThreshold: 0.7,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as ApplicantDoc;
}

describe("isLongDistanceCompatible", () => {
  it("passes when both are in the same city", () => {
    const a = makeApplicant("Paris, France", false);
    const b = makeApplicant("Paris, France", false);
    expect(isLongDistanceCompatible(a, b)).toBe(true);
  });

  it("passes when both are open to long distance and in different cities", () => {
    const a = makeApplicant("Paris, France", true);
    const b = makeApplicant("Tunis, Tunisia", true);
    expect(isLongDistanceCompatible(a, b)).toBe(true);
  });

  it("fails when A is not open to LD and they are in different cities", () => {
    const a = makeApplicant("Paris, France", false);
    const b = makeApplicant("Berlin, Germany", true);
    expect(isLongDistanceCompatible(a, b)).toBe(false);
  });

  it("fails when B is not open to LD and they are in different cities", () => {
    const a = makeApplicant("London, UK", true);
    const b = makeApplicant("Dubai, UAE", false);
    expect(isLongDistanceCompatible(a, b)).toBe(false);
  });

  it("fails when both are not open to LD and in different cities", () => {
    const a = makeApplicant("Montreal, Canada", false);
    const b = makeApplicant("Lyon, France", false);
    expect(isLongDistanceCompatible(a, b)).toBe(false);
  });

  it("passes when location is missing (skip filter)", () => {
    const a = makeApplicant(undefined, false);
    const b = makeApplicant("Tunis, Tunisia", true);
    expect(isLongDistanceCompatible(a, b)).toBe(true);
  });

  it("is case-insensitive for location comparison", () => {
    const a = makeApplicant("paris, france", false);
    const b = makeApplicant("Paris, France", false);
    expect(isLongDistanceCompatible(a, b)).toBe(true);
  });

  // Regression: the location field is a free-text Autocomplete (suggestions,
  // not enforced choices — see frontend/src/steps/Step1Identity.tsx), so two
  // people in the same city can easily type it differently.
  it("treats 'Tunis' and 'Tunis, Tunisia' as the same city (city-name-only match)", () => {
    const a = makeApplicant("Tunis", false);
    const b = makeApplicant("Tunis, Tunisia", false);
    expect(isLongDistanceCompatible(a, b)).toBe(true);
  });

  it("still fails for genuinely different cities even when one omits the country", () => {
    const a = makeApplicant("Tunis", false);
    const b = makeApplicant("Sfax, Tunisia", false);
    expect(isLongDistanceCompatible(a, b)).toBe(false);
  });

  it("matches the city part case-insensitively regardless of country formatting", () => {
    const a = makeApplicant("TUNIS", false);
    const b = makeApplicant("tunis, tunisia", false);
    expect(isLongDistanceCompatible(a, b)).toBe(true);
  });
});

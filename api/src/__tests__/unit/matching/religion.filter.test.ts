import { describe, it, expect } from "bun:test";
import { ObjectId } from "mongodb";
import { isReligionCompatible } from "../../../matching/filters/religion.filter.js";
import type { ApplicantDoc } from "../../../models/applicant.model.js";

function makeApplicant(religion: string | undefined, dealBreaker: boolean | null): ApplicantDoc {
  return {
    _id: new ObjectId(),
    alias: "Test",
    questionnaireVersion: "1.1.0",
    answers: {
      ...(religion !== undefined ? { religion } : {}),
      ...(dealBreaker !== null ? { religion_deal_breaker: dealBreaker } : {}),
    },
    status: "applied",
    magicToken: "tok",
    scoreThreshold: 0.7,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as ApplicantDoc;
}

describe("isReligionCompatible", () => {
  it("passes when religions match regardless of deal breaker", () => {
    const a = makeApplicant("Muslim", true);
    const b = makeApplicant("Muslim", true);
    expect(isReligionCompatible(a, b)).toBe(true);
  });

  it("passes when religions differ and neither has a deal breaker", () => {
    const a = makeApplicant("Muslim", false);
    const b = makeApplicant("Christian", false);
    expect(isReligionCompatible(a, b)).toBe(true);
  });

  it("fails when A has deal breaker and religions differ", () => {
    const a = makeApplicant("Muslim", true);
    const b = makeApplicant("Christian", false);
    expect(isReligionCompatible(a, b)).toBe(false);
  });

  it("fails when B has deal breaker and religions differ", () => {
    const a = makeApplicant("Agnostic", false);
    const b = makeApplicant("Muslim", true);
    expect(isReligionCompatible(a, b)).toBe(false);
  });

  it("fails when both have deal breaker and religions differ", () => {
    const a = makeApplicant("Jewish", true);
    const b = makeApplicant("Muslim", true);
    expect(isReligionCompatible(a, b)).toBe(false);
  });

  it("passes when either religion is missing (skip filter)", () => {
    const a = makeApplicant(undefined, true);
    const b = makeApplicant("Muslim", true);
    expect(isReligionCompatible(a, b)).toBe(true);
  });

  it("is case-insensitive for religion comparison", () => {
    const a = makeApplicant("muslim", true);
    const b = makeApplicant("Muslim", false);
    expect(isReligionCompatible(a, b)).toBe(true);
  });
});

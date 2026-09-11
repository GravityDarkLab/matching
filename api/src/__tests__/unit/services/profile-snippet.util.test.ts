// api/src/__tests__/unit/services/profile-snippet.util.test.ts
//
// tested: profile-snippet.util buildProfileSnippet — the shared free-text
// profile summary used by match-summary.service.ts and (after Task 3)
// match-rerank.service.ts when building LLM prompts.
import { describe, it, expect } from "bun:test";
import { ObjectId } from "mongodb";
import { buildProfileSnippet } from "../../../services/profile-snippet.util.js";
import type { ApplicantDoc } from "../../../models/applicant.model.js";

function makeApplicant(answers: Record<string, unknown>): ApplicantDoc {
  return {
    _id: new ObjectId(),
    alias: "Test",
    questionnaireVersion: "1.2.0",
    answers,
    status: "applied",
    magicToken: "a".repeat(64),
    passwordHash: null,
    scoreThreshold: 0.8,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("buildProfileSnippet", () => {
  it("joins present fields with '. '", () => {
    const doc = makeApplicant({ location: "Paris, France", work: "Engineer" });
    expect(buildProfileSnippet(doc)).toBe("Location: Paris, France. Work: Engineer");
  });

  it("skips fields that are absent", () => {
    const doc = makeApplicant({ lifestyle: "Active and outdoorsy" });
    expect(buildProfileSnippet(doc)).toBe("Lifestyle: Active and outdoorsy");
  });

  it("returns a fallback string when no relevant fields are present", () => {
    const doc = makeApplicant({});
    expect(buildProfileSnippet(doc)).toBe("No profile details available.");
  });

  it("truncates a long field via truncateForPrompt", () => {
    const longText = "word ".repeat(100).trim();
    const doc = makeApplicant({ deal_breakers: longText });
    const result = buildProfileSnippet(doc);
    expect(result.startsWith("Deal breakers: ")).toBe(true);
    expect(result.length).toBeLessThan(longText.length);
  });
});

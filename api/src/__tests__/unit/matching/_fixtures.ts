/**
 * Shared test fixtures for matching algorithm tests.
 */
import type { ApplicantDoc } from "../../../models/applicant.model.js";
import type { QuestionnaireDoc } from "../../../models/questionnaire.model.js";
import { ObjectId } from "mongodb";

export function makeApplicant(
  answers: Record<string, unknown>,
  overrides: Partial<ApplicantDoc> = {}
): ApplicantDoc {
  return {
    _id: new ObjectId(),
    alias: "Test Alias",
    questionnaireVersion: "1.1.0",
    answers,
    status: "applied",
    magicToken: "a".repeat(64),
    passwordHash: "hash",
    scoreThreshold: 0.8,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function makeQuestionnaire(): QuestionnaireDoc {
  return {
    _id: new ObjectId(),
    version: "1.1.0",
    isActive: true,
    questions: [],
    createdAt: new Date(),
  } as unknown as QuestionnaireDoc;
}

/** A fully-populated answer set — two applicants with identical answers → perfect match. */
export const FULL_ANSWERS: Record<string, unknown> = {
  relationship_type: "Long Term",
  open_to_long_distance: true,
  physical_affection_importance: 8,
  religion: "Islam",
  religion_deal_breaker: false,
  lifestyle: "gym fitness hiking coffee",
  deal_breakers: "smoking drugs",
  vibe_words: "funny kind ambitious",
  preferred_character_traits: "funny kind ambitious",
};

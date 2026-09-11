import { truncateForPrompt } from "./ai.service.js";
import type { ApplicantDoc } from "../models/applicant.model.js";

/**
 * Builds a free-text summary of an applicant's answers for use in an LLM
 * prompt (match-summary, match-rerank). Shared so the field selection and
 * truncation behavior can't drift between callers.
 */
export function buildProfileSnippet(doc: ApplicantDoc): string {
  const a = doc.answers as Record<string, unknown>;
  const t = (v: unknown) => truncateForPrompt(String(v));
  const parts: string[] = [];
  if (a.location)                   parts.push(`Location: ${t(a.location)}`);
  if (a.work)                       parts.push(`Work: ${t(a.work)}`);
  if (a.religion)                   parts.push(`Religion: ${t(a.religion)}`);
  if (a.relationship_type)          parts.push(`Looking for: ${t(a.relationship_type)}`);
  if (a.vibe_words)                 parts.push(`Describes themselves as: ${t(a.vibe_words)}`);
  if (a.lifestyle)                  parts.push(`Lifestyle: ${t(a.lifestyle)}`);
  if (a.preferred_character_traits) parts.push(`Seeks in partner: ${t(a.preferred_character_traits)}`);
  if (a.deal_breakers)              parts.push(`Deal breakers: ${t(a.deal_breakers)}`);
  if (a.dream_first_date)           parts.push(`Dream first date: ${t(a.dream_first_date)}`);
  return parts.join(". ") || "No profile details available.";
}

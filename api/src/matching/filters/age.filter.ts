/**
 * Age preference filter and scoring modifier.
 *
 * Filter: isAgeCompatible() — hard binary check, called before scoring.
 *   - Directional checks: open_to_older / open_to_younger flags
 *     (independent of max_age_gap — enforced even when the gap is blank)
 *   - Hard outer limit: gap > 2 × max_age_gap → reject
 *   - max_age_gap = null → no gap preference, only directional checks apply
 *   - Missing birth_date → skip filter for that pair
 *
 * Modifier: ageModifier() — multiplied onto the final compatibility score.
 *   - Within max_age_gap: modifier = 1.0 (no penalty)
 *   - Between max_gap and 2× max_gap: cosine decay toward 0
 *   - Beyond 2× max_gap: should be filtered out before reaching here
 *   - Bidirectional: min(A's modifier, B's modifier)
 */

import type { ApplicantDoc } from "../../models/applicant.model.js";
import { ageFromBirthDate } from "../../utils/age.js";

function num(answers: Record<string, unknown>, key: string): number | null {
  const v = answers[key];
  return typeof v === "number" ? v : null;
}

function bool(answers: Record<string, unknown>, key: string): boolean | null {
  const v = answers[key];
  return typeof v === "boolean" ? v : null;
}

/**
 * Returns true if the pair satisfies both applicants' age preferences.
 * A return of false means the pair should be discarded before scoring.
 */
export function isAgeCompatible(a: ApplicantDoc, b: ApplicantDoc): boolean {
  const ageA = ageFromBirthDate(a.answers["birth_date"]);
  const ageB = ageFromBirthDate(b.answers["birth_date"]);

  // Missing birth_date on either side → skip filter
  if (ageA === null || ageB === null) return true;

  const gap = Math.abs(ageA - ageB);

  return (
    _passesConstraints(a.answers, ageA, ageB, gap) &&
    _passesConstraints(b.answers, ageB, ageA, gap)
  );
}

function _passesConstraints(
  answers: Record<string, unknown>,
  ownAge: number,
  partnerAge: number,
  gap: number
): boolean {
  // Directional hard blocks apply regardless of max_age_gap — the three age
  // questions are independent in the questionnaire, so a blank gap preference
  // must not void an explicit "not open to older/younger" veto.
  if (partnerAge > ownAge && bool(answers, "open_to_older") === false) return false;
  if (partnerAge < ownAge && bool(answers, "open_to_younger") === false) return false;

  const maxGap = num(answers, "max_age_gap");

  // null = no gap preference → no outer limit to enforce
  if (maxGap === null) return true;

  // Hard outer limit: gap > 2× max_gap → reject
  if (gap > 2 * maxGap) return false;

  return true;
}

/**
 * Returns a multiplier in [0, 1] representing how well the age gap fits
 * both applicants' preferences. Applied after the weighted compatibility score:
 *   final_score = compatibility_score × ageModifier(a, b)
 *
 * Takes the stricter (min) of both directions.
 */
export function ageModifier(a: ApplicantDoc, b: ApplicantDoc): number {
  const ageA = ageFromBirthDate(a.answers["birth_date"]);
  const ageB = ageFromBirthDate(b.answers["birth_date"]);

  // Missing birth_date → no modification
  if (ageA === null || ageB === null) return 1.0;

  const gap = Math.abs(ageA - ageB);

  return Math.min(
    _computeModifier(num(a.answers, "max_age_gap"), gap),
    _computeModifier(num(b.answers, "max_age_gap"), gap)
  );
}

function _computeModifier(maxGap: number | null, gap: number): number {
  if (maxGap === null) return 1.0;
  if (gap <= maxGap) return 1.0;
  if (gap <= 2 * maxGap) {
    const t = (gap - maxGap) / maxGap;
    return Math.cos((t * Math.PI) / 2);
  }
  // Beyond hard outer limit — should have been filtered; return 0 defensively
  return 0.0;
}

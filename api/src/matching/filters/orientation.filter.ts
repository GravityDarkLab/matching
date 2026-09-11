/**
 * Hard compatibility filters applied before any scoring.
 *
 * These are binary pass/fail — not scored — because a score of 0.0 would
 * still rank an incompatible pair above "no result", which is wrong.
 * Filtering them out entirely is the correct behaviour.
 */

import type { ApplicantDoc } from "../../models/applicant.model.js";

function str(answers: Record<string, unknown>, key: string): string {
  const v = answers[key];
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Returns true if `a` and `b` are orientation-compatible.
 *
 * Rules:
 *   Straight            → only opposite binary gender (Male ↔ Female)
 *   Gay / Lesbian       → only the same gender as oneself — the two labels
 *                         are alternate vocabulary for the same same-gender
 *                         attraction, not "Gay = Male" / "Lesbian = Female".
 *                         A woman can describe her own orientation as "Gay",
 *                         a man as "Lesbian"; the check does not require a
 *                         specific gender_identity value on either side.
 *   Bisexual / Pansexual / Other / Prefer not to say → no gender filter
 *   Asexual   → no gender filter (romantic compatibility still possible)
 *
 * Both directions must pass — if either person would not want the other,
 * they are not compatible.
 */
export function isOrientationCompatible(
  a: ApplicantDoc,
  b: ApplicantDoc
): boolean {
  const orientationA = str(a.answers, "sexual_orientation");
  const orientationB = str(b.answers, "sexual_orientation");
  const genderA = str(a.answers, "gender_identity");
  const genderB = str(b.answers, "gender_identity");

  return (
    _wantsGender(orientationA, genderA, genderB) &&
    _wantsGender(orientationB, genderB, genderA)
  );
}

function _wantsGender(
  orientation: string,
  ownGender: string,
  partnerGender: string
): boolean {
  switch (orientation) {
    case "Straight":
      if (ownGender === "Male")   return partnerGender === "Female";
      if (ownGender === "Female") return partnerGender === "Male";
      return true;

    case "Gay":
    case "Lesbian":
      // Same-gender attraction — requires both a known own gender and a
      // matching partner gender. An unset/unrecognized own gender has no
      // basis to filter on, so it passes through rather than excluding.
      if (ownGender === "") return true;
      return partnerGender === ownGender;

    case "Bisexual":
    case "Pansexual":
    case "Asexual":
    case "Prefer not to say":
    case "Other":
    case "":
      return true;

    default:
      return true;
  }
}

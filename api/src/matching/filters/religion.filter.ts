import type { ApplicantDoc } from "../../models/applicant.model.js";
import { normalizeAnswer } from "./answer.util.js";

/**
 * Returns false if either applicant has marked religion as a deal breaker
 * and the two applicants have different religions. Both directions are checked.
 *
 * Missing or blank religion strings skip the check (pass through).
 *
 * Unlike location.filter.ts, this deliberately does NOT fuzzy-match beyond
 * trim/lowercase (e.g. collapsing "Christian" with "Christian (Catholic)", or
 * "Muslim" with "Islam"). This is a hard deal-breaker: the risk of two
 * strings meaning the same religion but comparing unequal (a missed match)
 * is far safer than the risk of collapsing two answers a user considered
 * meaningfully different (e.g. denomination) and matching them anyway. The
 * curated suggestion list (frontend/src/data/religions.ts) already offers
 * denomination-level entries as distinct choices on purpose.
 */
export function isReligionCompatible(a: ApplicantDoc, b: ApplicantDoc): boolean {
  const aAnswers = a.answers as Record<string, unknown>;
  const bAnswers = b.answers as Record<string, unknown>;

  const aReligion = normalizeAnswer(aAnswers, "religion");
  const bReligion = normalizeAnswer(bAnswers, "religion");

  if (!aReligion || !bReligion) return true;

  const religionsMatch = aReligion === bReligion;
  if (religionsMatch) return true;

  if (aAnswers["religion_deal_breaker"] === true) return false;
  if (bAnswers["religion_deal_breaker"] === true) return false;

  return true;
}

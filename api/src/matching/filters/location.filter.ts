import type { ApplicantDoc } from "../../models/applicant.model.js";
import { normalizeAnswer } from "./answer.util.js";

/**
 * The city segment of a "City, Country" location string (the format the
 * Autocomplete suggests — see frontend/src/data/cities.ts), or the whole
 * string if there's no comma. The field stays free text even when a
 * suggestion is picked, so "Tunis" and "Tunis, Tunisia" must be treated as
 * the same city rather than compared as two unrelated strings.
 *
 * This does not resolve genuinely different-but-nearby places (e.g. a Tunis
 * suburb typed as its own name) — that needs real geocoding, which is out of
 * scope here; it only fixes the formatting mismatch between the same city
 * typed with or without its country.
 */
function cityPart(normalizedLocation: string): string {
  return normalizedLocation.split(",")[0]!.trim();
}

/**
 * Returns false if either applicant is not open to long distance
 * and the two applicants are in different locations.
 *
 * Location comparison is case-insensitive, matching either the full string
 * or just the city segment. Missing or blank location skips the check
 * (pass through).
 */
export function isLongDistanceCompatible(a: ApplicantDoc, b: ApplicantDoc): boolean {
  const aAnswers = a.answers as Record<string, unknown>;
  const bAnswers = b.answers as Record<string, unknown>;

  const aLoc = normalizeAnswer(aAnswers, "location");
  const bLoc = normalizeAnswer(bAnswers, "location");

  if (!aLoc || !bLoc) return true;

  const sameCity = aLoc === bLoc || cityPart(aLoc) === cityPart(bLoc);
  if (sameCity) return true;

  // Different cities: veto if either person cannot do long distance
  if (aAnswers["open_to_long_distance"] === false) return false;
  if (bAnswers["open_to_long_distance"] === false) return false;

  return true;
}

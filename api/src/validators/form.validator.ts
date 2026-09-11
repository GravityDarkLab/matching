import { z } from "zod";
import { ageFromBirthDate, BIRTH_DATE_PATTERN } from "../utils/age.js";

/**
 * Base Zod schema for form submission.
 * Dynamic cross-validation against questionnaire question IDs is handled
 * in form.service.ts after fetching the active questionnaire.
 */
export const formSubmissionSchema = z.object({
  questionnaireVersion: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/, "questionnaireVersion must be semver (e.g. 1.0.0)"),

  // Honeypot: legitimate clients always send this field empty; bots that
  // scrape and fill all fields will populate it, triggering a silent reject.
  _verify: z.string().optional(),

  answers: z
    .object({
      // Identity (sensitive)
      first_name: z
        .string()
        .trim()
        .min(1, "first_name is required")
        .max(50)
        .regex(/^[\p{L}\p{M}'\- ]+$/u, "first_name contains invalid characters"),
      last_name: z
        .string()
        .trim()
        .min(1, "last_name is required")
        .max(50)
        .regex(/^[\p{L}\p{M}'\- ]+$/u, "last_name contains invalid characters"),
      instagram_handle: z
        .string()
        .min(1, "instagram_handle is required")
        .max(31) // Instagram usernames are ≤30 chars, plus optional leading @
        .regex(/^@?[\w.]+$/, "Invalid Instagram handle format"),

      // Personal info
      location: z.string().min(1).max(200),
      birth_date: z
        .string()
        .regex(BIRTH_DATE_PATTERN, "birth_date must be YYYY-MM-DD")
        .refine((d) => {
          const age = ageFromBirthDate(d);
          return age !== null && age >= 18 && age <= 120;
        }, "Must be a valid date of someone at least 18 years old"),
      height_cm: z.number().int().min(100).max(250).optional(),
      work: z.string().min(1).max(200),
      gender_identity: z.string().min(1).max(100),
      sexual_orientation: z.string().min(1).max(100),
      religion: z.string().min(1).max(100),

      // Personality / vibe
      vibe_words: z.string().min(1).max(500),
      lifestyle: z.string().min(1).max(1000),

      // Relationship preferences
      relationship_type: z.enum([
        "Long Term",
        "Short Term",
        "Open to Both",
        "Casual",
        "Not Sure",
      ]),
      open_to_long_distance: z.boolean(),

      // Age preferences (optional — null means no preference)
      max_age_gap: z.number().int().min(0).max(40).nullable().optional(),
      open_to_older: z.boolean().nullable().optional(),
      open_to_younger: z.boolean().nullable().optional(),

      preferred_physical_traits: z.string().min(1).max(1000),
      preferred_character_traits: z.string().min(1).max(1000),
      deal_breakers: z.string().min(1).max(1000),
      okay_with_opposite_gender_friends: z.boolean(),
      religion_deal_breaker: z.boolean(),

      // Scores
      physical_affection_importance: z
        .number()
        .int()
        .min(1, "Must be at least 1")
        .max(10, "Must be at most 10"),

      // Open-ended
      dream_first_date: z.string().min(1).max(2000),

      // Legal
      disclaimer_agreed: z.literal(true, {
        error: "You must agree to the disclaimer",
      }),
    })
    .loose(), // allow extra fields — they'll be filtered against questionnaire
});

export type FormSubmissionInput = z.infer<typeof formSubmissionSchema>;

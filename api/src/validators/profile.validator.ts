import { z } from "zod";
import { formSubmissionSchema } from "./form.validator.js";

export const profileLoginSchema = z.object({
  magicToken: z.string().length(64, "magicToken must be exactly 64 characters"),
  password:   z.string().optional(),
});

export type ProfileLoginInput = z.infer<typeof profileLoginSchema>;

export const setPasswordSchema = z.object({
  magicToken:  z.string().length(64, "magicToken must be exactly 64 characters"),
  newPassword: z.string().min(8, "password must be at least 8 characters"),
});

export type SetPasswordInput = z.infer<typeof setPasswordSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "currentPassword is required"),
  newPassword:     z.string().min(8, "newPassword must be at least 8 characters"),
});

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const matchQuerySchema = z.object({
  threshold: z
    .string()
    .optional()
    .transform((v) => {
      const n = parseFloat(v ?? "0.8");
      return Math.min(1.0, Math.max(0.6, isNaN(n) ? 0.8 : n));
    }),
  limit: z
    .string()
    .optional()
    .transform((v) => {
      const n = parseInt(v ?? "10", 10);
      return Math.min(50, Math.max(1, isNaN(n) ? 10 : n));
    }),
});

export type MatchQueryInput = z.infer<typeof matchQuerySchema>;

export const respondSchema = z.object({
  accept: z.boolean(),
});

export type RespondInput = z.infer<typeof respondSchema>;

export const outcomeFeedbackTags = ["too_far", "different_values", "no_spark", "something_else"] as const;

export const outcomeSchema = z.object({
  outcome: z.enum(["success", "failed"]),
  outcomeFeedback: z
    .object({
      tags: z.array(z.enum(outcomeFeedbackTags)).max(outcomeFeedbackTags.length),
      note: z.string().max(500).optional(),
    })
    .optional(),
  continuation: z.enum(["continue", "break"]).optional(),
});

export type OutcomeInput = z.infer<typeof outcomeSchema>;

export const nudgeAckSchema = z.object({
  openUp: z.boolean(),
});

export type NudgeAckInput = z.infer<typeof nudgeAckSchema>;

/**
 * Self-service answer updates — same field rules as the original submission,
 * minus the fields an applicant must not change themselves:
 * - instagram_handle lives encrypted in the identities collection and can
 *   only be changed by an admin
 * - disclaimer_agreed is a one-time consent given at submission
 * - birth_date and gender_identity are identity facts that drive matching —
 *   changing them requires contacting an admin
 * `.strict()` rejects all of them (and any unknown key) instead of silently
 * dropping.
 */
export const updateAnswersSchema = z.object({
  answers: formSubmissionSchema.shape.answers
    .omit({
      instagram_handle: true,
      first_name: true,
      last_name: true,
      disclaimer_agreed: true,
      birth_date: true,
      gender_identity: true,
    })
    .strict(),
});

export type UpdateAnswersInput = z.infer<typeof updateAnswersSchema>;

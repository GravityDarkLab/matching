import { z } from "zod";

export const adminLoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export type AdminLoginInput = z.infer<typeof adminLoginSchema>;

export const paginationSchema = z.object({
  page: z
    .string()
    .optional()
    .transform((v) => Math.max(1, parseInt(v ?? "1", 10))),
  limit: z
    .string()
    .optional()
    .transform((v) => Math.min(100, Math.max(1, parseInt(v ?? "20", 10)))),
});

export const applicantFilterSchema = paginationSchema.extend({
  status: z
    .enum(["applied", "matched", "dating", "inactive"])
    .optional(),
  scheduledDeletion: z.enum(["true", "false"]).optional(),
});

export const matchingRunSchema = z.object({
  algorithm: z.literal("embedding-cosine").default("embedding-cosine"),
});

export type MatchingRunInput = z.infer<typeof matchingRunSchema>;

export const createQuestionnaireSchema = z.object({
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/, "version must be semver (e.g. 2.0.0)"),
  name: z.string().min(1),
  sections: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1),
        order: z.number().int().min(1),
        questions: z
          .array(
            z.object({
              id: z.string().min(1),
              label: z.string().min(1),
              type: z.enum(["text", "number", "select", "multiselect", "range", "boolean", "textarea"]),
              sensitive: z.boolean(),
              required: z.boolean(),
              order: z.number().int().min(1),
              options: z.array(z.string()).optional(),
              min: z.number().optional(),
              max: z.number().optional(),
              placeholder: z.string().optional(),
            })
          )
          .min(1),
      })
    )
    .min(1),
});

export type CreateQuestionnaireInput = z.infer<typeof createQuestionnaireSchema>;

import { z } from 'zod'
import { ageFromBirthDate, BIRTH_DATE_PATTERN } from '../lib/age'

// ── Step schemas ──────────────────────────────────────────────────────────────

export const step1Schema = z.object({
  first_name: z
    .string()
    .trim()
    .min(1, 'First name is required')
    .regex(/^[\p{L}\p{M}'\- ]+$/u, 'Only letters, spaces, hyphens and apostrophes'),
  last_name: z
    .string()
    .trim()
    .min(1, 'Last name is required')
    .regex(/^[\p{L}\p{M}'\- ]+$/u, 'Only letters, spaces, hyphens and apostrophes'),
  instagram_handle: z
    .string()
    .min(1, 'Instagram handle is required')
    .regex(/^[a-zA-Z0-9._]+$/, 'Only letters, numbers, dots and underscores'),
  location: z.string().min(1, 'Location is required'),
})

export const step2Schema = z.object({
  birth_date: z
    .string({ error: 'Birth date is required' })
    .regex(BIRTH_DATE_PATTERN, 'Birth date is required')
    .refine(d => {
      const age = ageFromBirthDate(d)
      return age !== null && age >= 18
    }, 'You must be at least 18')
    .refine(d => {
      const age = ageFromBirthDate(d)
      return age === null || age <= 99
    }, 'Please enter a valid birth date'),
  height_cm: z
    .number({ error: 'Must be a number' })
    .min(100, 'Enter a valid height')
    .max(250, 'Enter a valid height')
    .optional()
    .or(z.literal(undefined)),
  work: z.string().min(1, 'Work / occupation is required'),
  gender_identity: z.string().min(1, 'Please select your gender identity'),
  sexual_orientation: z.string().min(1, 'Please select your sexual orientation'),
  religion: z.string().min(1, 'Religion is required'),
})

export const step3Schema = z.object({
  vibe_words: z.string().min(1, 'Describe your vibe in a few words'),
  lifestyle: z.string().min(1, 'Tell us a bit about your lifestyle'),
})

export const step4Schema = z.object({
  relationship_type: z.enum(['Long Term', 'Short Term', 'Open to Both', 'Casual', 'Not Sure'], {
    error: 'Please select a relationship type',
  }),
  open_to_long_distance: z.boolean(),
  max_age_gap: z.number().int().min(0).max(40).nullable().optional(),
  open_to_older: z.boolean().nullable().optional(),
  open_to_younger: z.boolean().nullable().optional(),
  preferred_physical_traits: z.string().min(1, 'Please describe preferred physical traits'),
  preferred_character_traits: z.string().min(1, 'Please describe preferred character traits'),
  deal_breakers: z.string().min(1, 'Please list your deal breakers'),
  okay_with_opposite_gender_friends: z.boolean(),
  religion_deal_breaker: z.boolean(),
})

export const step5Schema = z.object({
  physical_affection_importance: z
    .number()
    .min(1)
    .max(10),
  dream_first_date: z.string().min(1, 'Tell us about your dream first date'),
  disclaimer_agreed: z.literal(true, {
    error: 'You must agree to the disclaimer to continue',
  }),
})

// ── Full form schema ──────────────────────────────────────────────────────────

export const formSchema = step1Schema
  .merge(step2Schema)
  .merge(step3Schema)
  .merge(step4Schema)
  .merge(step5Schema)

export type FormValues = z.infer<typeof formSchema>

// ── Payload sent to backend ───────────────────────────────────────────────────

export interface FormPayload {
  questionnaireVersion: '1.2.0'
  answers: {
    first_name: string
    last_name: string
    instagram_handle: string
    location: string
    birth_date: string
    height_cm?: number
    work: string
    gender_identity: string
    sexual_orientation: string
    religion: string
    vibe_words: string
    lifestyle: string
    relationship_type: 'Long Term' | 'Short Term' | 'Open to Both' | 'Casual' | 'Not Sure'
    open_to_long_distance: boolean
    max_age_gap?: number | null
    open_to_older?: boolean | null
    open_to_younger?: boolean | null
    preferred_physical_traits: string
    preferred_character_traits: string
    deal_breakers: string
    okay_with_opposite_gender_friends: boolean
    religion_deal_breaker: boolean
    physical_affection_importance: number
    dream_first_date: string
    disclaimer_agreed: true
  }
}

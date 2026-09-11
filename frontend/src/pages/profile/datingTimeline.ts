// Mirrors api/src/services/match-state.service.ts's daysSince/eligibility
// constants — duplicated client-side on purpose since it's display-only
// gating; the server is the actual authority (see profile.service.ts
// reportOutcome's assertOutcomeEligible call).

/** Day count after which a "didn't work" outcome can be reported. */
export const CANCEL_ELIGIBLE_DAYS = 3
/** Day count after which an "it worked" outcome can be reported. */
export const OUTCOME_ELIGIBLE_DAYS = 7

/** Whole days elapsed since an ISO timestamp, floored. */
export function daysSince(isoDate: string): number {
  return Math.floor((Date.now() - new Date(isoDate).getTime()) / (24 * 60 * 60 * 1000))
}

export const CHECK_IN_MESSAGE_KEYS = [
  'portal.matches.checkIn.message1',
  'portal.matches.checkIn.message2',
  'portal.matches.checkIn.message3',
  'portal.matches.checkIn.message4',
  'portal.matches.checkIn.message5',
  'portal.matches.checkIn.message6',
] as const

export const OUTCOME_FEEDBACK_TAGS = ['too_far', 'different_values', 'no_spark', 'something_else'] as const
export type OutcomeFeedbackTag = (typeof OUTCOME_FEEDBACK_TAGS)[number]

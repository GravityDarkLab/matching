/**
 * Single source of truth for all scoring weights.
 * Weights sum to 1.0; age is applied as a multiplier after the weighted sum.
 */
export const WEIGHTS = {
  numeric:               0.22,
  lifestyle:             0.22,
  character_cross_match: 0.35, // 0.175 per direction
  deal_breakers:         0.21,
} as const;

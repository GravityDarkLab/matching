import { daysSince, CANCEL_ELIGIBLE_DAYS, OUTCOME_ELIGIBLE_DAYS } from '../../pages/profile/datingTimeline'

describe('daysSince', () => {
  it('returns 0 for a timestamp less than a day ago', () => {
    const justNow = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    expect(daysSince(justNow)).toBe(0)
  })

  it('returns 3 for a timestamp exactly 3 days ago', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
    expect(daysSince(threeDaysAgo)).toBe(3)
  })
})

describe('eligibility constants', () => {
  it('cancel unlocks before outcome', () => {
    expect(CANCEL_ELIGIBLE_DAYS).toBeLessThan(OUTCOME_ELIGIBLE_DAYS)
  })
})

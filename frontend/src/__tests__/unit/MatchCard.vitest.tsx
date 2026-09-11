import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { MatchCard } from '../../pages/profile/MatchCard'
import type { MatchView } from '../../api/profile.client'

vi.mock('../../api/profile.client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/profile.client')>()
  return { ...actual, getMatchSummary: vi.fn() }
})

import * as profileClient from '../../api/profile.client'
const mockGetMatchSummary = vi.mocked(profileClient.getMatchSummary)

const base: MatchView = {
  matchId: 'm1',
  partnerAlias: 'Crescent River',
  score: 0.87,
  status: 'proposed',
  perspective: 'none',
}

describe('MatchCard', () => {
  it('renders "I want to reach out" button for proposed/none', () => {
    render(<MatchCard match={base} />)
    expect(screen.getByRole('button', { name: /portal\.matches\.reachOut/i })).toBeInTheDocument()
    expect(screen.getByText('Crescent River')).toBeInTheDocument()
  })

  it('renders icebreakers but withholds Instagram for in_progress/initiator (mutual reveal pending)', () => {
    const match: MatchView = {
      ...base,
      status: 'in_progress',
      perspective: 'initiator',
      iceBreakers: ['Question 1'],
      dateIdeas: ['Coffee walk'],
    }
    render(<MatchCard match={match} />)
    expect(screen.getByText('Question 1')).toBeInTheDocument()
    expect(screen.getByText('Coffee walk')).toBeInTheDocument()
    expect(screen.queryByText(/cresriver/i)).not.toBeInTheDocument()
  })

  it('renders accept and decline buttons for in_progress/target', () => {
    const match: MatchView = {
      ...base,
      status: 'in_progress',
      perspective: 'target',
      contactRequestedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    }
    render(<MatchCard match={match} />)
    expect(screen.getByRole('button', { name: /portal\.matches\.accept/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /portal\.matches\.decline/i })).toBeInTheDocument()
  })

  it('shows relative time in target view (contactRequestedAt)', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    const match: MatchView = {
      ...base,
      status: 'in_progress',
      perspective: 'target',
      contactRequestedAt: twoHoursAgo,
    }
    render(<MatchCard match={match} />)
    // t mock renders the key with opts: portal.matches.requested:{"time":"common.timeAgo.hoursAgo:{\"count\":2}"}
    expect(screen.getByText(/portal\.matches\.requested/)).toBeInTheDocument()
    expect(screen.getByText(/hoursAgo/)).toBeInTheDocument()
  })

  it('renders outcome buttons for dating status', () => {
    const match: MatchView = {
      ...base,
      status: 'dating',
      perspective: 'none',
      datingStartedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
    }
    render(<MatchCard match={match} />)
    expect(screen.getByRole('button', { name: /portal\.matches\.workedOut/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /portal\.matches\.didntWork/i })).toBeInTheDocument()
  })

  it('renders read-only status badge for terminal statuses (declined)', () => {
    const match: MatchView = {
      ...base,
      status: 'declined',
    }
    render(<MatchCard match={match} />)
    expect(screen.getByText('portal.matches.status.declined')).toBeInTheDocument()
    // No action buttons for terminal status
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  // tested: contact opens a confirmation dialog showing the partner's alias
  it('opens a confirm dialog with the alias after contact succeeds', async () => {
    const onContactRequest = vi.fn().mockResolvedValue({
      iceBreakers: ['Q1'],
      dateIdeas: ['Coffee walk'],
    })
    render(<MatchCard match={base} onContactRequest={onContactRequest} />)

    await userEvent.click(screen.getByRole('button', { name: /portal\.matches\.reachOut/i }))

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent(/portal\.matches\.confirmContactTitle/)
    expect(dialog).toHaveTextContent(/Crescent River/)
  })

  it('confirming the dialog shows the waiting contact-status view, with no Instagram yet', async () => {
    const onContactRequest = vi.fn().mockResolvedValue({
      iceBreakers: ['Q1'],
      dateIdeas: ['Coffee walk'],
    })
    render(<MatchCard match={base} onContactRequest={onContactRequest} />)

    await userEvent.click(screen.getByRole('button', { name: /portal\.matches\.reachOut/i }))
    await userEvent.click(await screen.findByRole('button', { name: /confirmContactYes/i }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByText('Q1')).toBeInTheDocument()
    expect(screen.getByText(/portal\.matches\.waiting/)).toBeInTheDocument()
    // Mutual reveal hasn't happened yet — only the target accepting reveals it
    expect(screen.queryByText(/cresriver/i)).not.toBeInTheDocument()
  })

  it('passing in the dialog withdraws the contact', async () => {
    const onContactRequest = vi.fn().mockResolvedValue({
      iceBreakers: [],
      dateIdeas: [],
    })
    const onWithdraw = vi.fn().mockResolvedValue(undefined)
    render(<MatchCard match={base} onContactRequest={onContactRequest} onWithdraw={onWithdraw} />)

    await userEvent.click(screen.getByRole('button', { name: /portal\.matches\.reachOut/i }))
    await userEvent.click(await screen.findByRole('button', { name: /confirmContactNo/i }))

    expect(onWithdraw).toHaveBeenCalledWith('m1')
  })

  it('dismissing the dialog with Escape keeps the contact (no accidental withdraw)', async () => {
    const onContactRequest = vi.fn().mockResolvedValue({
      iceBreakers: [],
      dateIdeas: [],
    })
    const onWithdraw = vi.fn().mockResolvedValue(undefined)
    render(<MatchCard match={base} onContactRequest={onContactRequest} onWithdraw={onWithdraw} />)

    await userEvent.click(screen.getByRole('button', { name: /portal\.matches\.reachOut/i }))
    await screen.findByRole('alertdialog')
    await userEvent.keyboard('{Escape}')

    expect(onWithdraw).not.toHaveBeenCalled()
    // Dismiss falls through to the waiting view — never a silent permanent decline
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByText(/portal\.matches\.waiting/)).toBeInTheDocument()
  })

  // tested: failed actions surface an inline error instead of being swallowed
  it('shows an error and keeps the card actionable when contact fails', async () => {
    const onContactRequest = vi.fn().mockRejectedValue(new Error('Match is no longer available'))
    render(<MatchCard match={base} onContactRequest={onContactRequest} />)

    await userEvent.click(screen.getByRole('button', { name: /portal\.matches\.reachOut/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Match is no longer available')
    // The optimistic transition must not have happened
    expect(screen.getByRole('button', { name: /portal\.matches\.reachOut/i })).toBeEnabled()
  })

  it('shows an error when responding fails and does not flip the status', async () => {
    const onRespond = vi.fn().mockRejectedValue(new Error('Match was already responded to'))
    const match: MatchView = {
      ...base,
      status: 'in_progress',
      perspective: 'target',
    }
    render(<MatchCard match={match} onRespond={onRespond} />)

    await userEvent.click(screen.getByRole('button', { name: /portal\.matches\.accept/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Match was already responded to')
    expect(screen.getByRole('button', { name: /portal\.matches\.accept/i })).toBeEnabled()
    expect(screen.getByRole('button', { name: /portal\.matches\.decline/i })).toBeEnabled()
  })

  it('shows an error when outcome reporting fails', async () => {
    const onOutcome = vi.fn().mockRejectedValue(new Error('Outcome was already reported for this match'))
    const match: MatchView = {
      ...base,
      status: 'dating',
      perspective: 'none',
      datingStartedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
    }
    render(<MatchCard match={match} onOutcome={onOutcome} />)

    await userEvent.click(screen.getByRole('button', { name: /portal\.matches\.workedOut/i }))
    await userEvent.click(screen.getByRole('button', { name: /portal\.matches\.outcome\.confirmSuccessYes/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Outcome was already reported')
    expect(screen.getByRole('button', { name: /portal\.matches\.workedOut/i })).toBeEnabled()
  })
})

// tested: the "why this match" LLM reasoning quote, always visible (not behind
// the expand toggle) and shown unconditionally — distinct from the score
// breakdown's gated-by-status behavior tested below.
describe('MatchCard match reason quote', () => {
  it('does not render the quote when llmReasoning is absent', () => {
    render(<MatchCard match={base} />)
    expect(screen.queryByText('portal.matches.whyThisMatch')).not.toBeInTheDocument()
  })

  it('does not render the quote when llmReasoning is an empty string (embedding fallback)', () => {
    render(<MatchCard match={{ ...base, llmReasoning: '' }} />)
    expect(screen.queryByText('portal.matches.whyThisMatch')).not.toBeInTheDocument()
  })

  it('renders the quote immediately (not behind the expand toggle) when llmReasoning is present', () => {
    const reasoning = 'Shared values around honesty and a love of the outdoors.'
    render(<MatchCard match={{ ...base, llmReasoning: reasoning }} />)
    expect(screen.getByText('portal.matches.whyThisMatch')).toBeInTheDocument()
    expect(screen.getByText(`“${reasoning}”`)).toBeInTheDocument()
  })

  it('renders the quote for an in_progress/target card', () => {
    const reasoning = 'Compatible lifestyles and complementary personalities.'
    render(
      <MatchCard
        match={{ ...base, status: 'in_progress', perspective: 'target', llmReasoning: reasoning }}
      />
    )
    expect(screen.getByText(`“${reasoning}”`)).toBeInTheDocument()
  })

  it('renders the quote for a dating-status card', () => {
    const reasoning = 'Strong alignment on relationship goals.'
    render(<MatchCard match={{ ...base, status: 'dating', llmReasoning: reasoning }} />)
    expect(screen.getByText(`“${reasoning}”`)).toBeInTheDocument()
  })
})

// tested: score breakdown expand/collapse (item 2/3 — "why this score")
describe('MatchCard score breakdown', () => {
  it('does not show an expand toggle when breakdown is missing', () => {
    render(<MatchCard match={base} />)
    expect(screen.queryByRole('button', { name: /Crescent River/i })).not.toBeInTheDocument()
    // The header is still rendered as a static, non-interactive row
    expect(screen.getByText('Crescent River')).toBeInTheDocument()
  })

  it('does not show an expand toggle when breakdown is empty', () => {
    render(<MatchCard match={{ ...base, breakdown: {} }} />)
    expect(screen.queryByRole('button', { name: /Crescent River/i })).not.toBeInTheDocument()
  })

  it('expands to reveal labeled bars for each dimension when the header is clicked', async () => {
    const match: MatchView = {
      ...base,
      breakdown: { numeric_compatibility: 0.9, lifestyle_similarity: 0.5 },
    }
    render(<MatchCard match={match} />)

    const toggle = screen.getByRole('button', { name: /Crescent River/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('portal.matches.breakdown.numeric_compatibility.label')).not.toBeInTheDocument()

    await userEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('portal.matches.breakdown.numeric_compatibility.label')).toBeInTheDocument()
    expect(screen.getByText('portal.matches.breakdown.lifestyle_similarity.label')).toBeInTheDocument()
  })

  it('sorts breakdown entries by value descending', async () => {
    const match: MatchView = {
      ...base,
      breakdown: { lifestyle_similarity: 0.3, numeric_compatibility: 0.9 },
    }
    render(<MatchCard match={match} />)
    await userEvent.click(screen.getByRole('button', { name: /Crescent River/i }))

    const labels = screen.getAllByText(/portal\.matches\.breakdown\..*\.label/)
    expect(labels[0]).toHaveTextContent('numeric_compatibility')
    expect(labels[1]).toHaveTextContent('lifestyle_similarity')
  })

  it('clicking again collapses the breakdown', async () => {
    const match: MatchView = { ...base, breakdown: { numeric_compatibility: 0.9 } }
    render(<MatchCard match={match} />)

    const toggle = screen.getByRole('button', { name: /Crescent River/i })
    await userEvent.click(toggle)
    expect(screen.getByText('portal.matches.breakdown.numeric_compatibility.label')).toBeInTheDocument()

    await userEvent.click(toggle)
    expect(screen.queryByText('portal.matches.breakdown.numeric_compatibility.label')).not.toBeInTheDocument()
  })

  it('shows the breakdown toggle for in_progress/initiator cards too', async () => {
    const match: MatchView = {
      ...base,
      status: 'in_progress',
      perspective: 'initiator',
      breakdown: { numeric_compatibility: 0.7 },
    }
    render(<MatchCard match={match} />)

    await userEvent.click(screen.getByRole('button', { name: /Crescent River/i }))
    expect(screen.getByText('portal.matches.breakdown.numeric_compatibility.label')).toBeInTheDocument()
  })

  it('shows the breakdown toggle for dating cards too', async () => {
    const match: MatchView = {
      ...base,
      status: 'dating',
      perspective: 'none',
      breakdown: { numeric_compatibility: 0.7 },
      datingStartedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
    }
    render(<MatchCard match={match} />)

    await userEvent.click(screen.getByRole('button', { name: /portal\.matches\.dating/i }))
    expect(screen.getByText('portal.matches.breakdown.numeric_compatibility.label')).toBeInTheDocument()
  })
})

// tested: partner profile (raw questionnaire answers shown alongside the breakdown)
describe('MatchCard partner profile', () => {
  const profile = {
    location: 'Paris, France',
    age: 27,
    vibe_words: ['calm', 'curious'],
    open_to_long_distance: true,
  }

  it('shows an expand toggle when only partnerProfile is present (no breakdown)', () => {
    render(<MatchCard match={{ ...base, partnerProfile: profile }} />)
    expect(screen.getByRole('button', { name: /Crescent River/i })).toBeInTheDocument()
  })

  it('does not show a toggle when partnerProfile is empty and breakdown missing', () => {
    render(<MatchCard match={{ ...base, partnerProfile: {} }} />)
    expect(screen.queryByRole('button', { name: /Crescent River/i })).not.toBeInTheDocument()
  })

  it('expands to reveal the partner profile section with formatted values', async () => {
    render(<MatchCard match={{ ...base, partnerProfile: profile }} />)
    expect(screen.queryByText('Paris, France')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Crescent River/i }))

    expect(screen.getByText(/portal\.matches\.aboutPartner/)).toBeInTheDocument()
    expect(screen.getByText('Paris, France')).toBeInTheDocument()
    // vibe_words array rendered as individual chips
    expect(screen.getByText('calm')).toBeInTheDocument()
    expect(screen.getByText('curious')).toBeInTheDocument()
    // booleans rendered as yes/no labels
    expect(screen.getByText('common.yes')).toBeInTheDocument()
    // section labels use i18n keys
    expect(screen.getByText('portal.matches.longDistance')).toBeInTheDocument()
  })

  it('renders profile and score breakdown together when both are present', async () => {
    const match: MatchView = {
      ...base,
      breakdown: { numeric_compatibility: 0.9 },
      partnerProfile: profile,
    }
    render(<MatchCard match={match} />)
    await userEvent.click(screen.getByRole('button', { name: /Crescent River/i }))

    expect(screen.getByText(/portal\.matches\.aboutPartner/)).toBeInTheDocument()
    expect(screen.getByText('portal.matches.scoreBreakdown')).toBeInTheDocument()
    expect(screen.getByText('portal.matches.breakdown.numeric_compatibility.label')).toBeInTheDocument()
  })

  it('shows the partner profile on dating cards too', async () => {
    const match: MatchView = {
      ...base,
      status: 'dating',
      perspective: 'none',
      partnerProfile: profile,
      datingStartedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
    }
    render(<MatchCard match={match} />)
    await userEvent.click(screen.getByRole('button', { name: /portal\.matches\.dating/i }))
    expect(screen.getByText('Paris, France')).toBeInTheDocument()
  })
})

// tested: target sees who wants to meet them (handle, profile, breakdown) before accepting
describe('MatchCard mutual identity reveal', () => {
  const targetMatch: MatchView = {
    ...base,
    status: 'in_progress',
    perspective: 'target',
    // Even if a stale/unexpected partnerInstagram value were present while
    // in_progress, the card must withhold it — reveal only happens at "dating".
    partnerInstagram: 'horizon.swift',
    breakdown: { numeric_compatibility: 0.9 },
    partnerProfile: { location: 'Paris, France', age: 27 },
  }

  it('withholds the partner Instagram on the target card before accepting', () => {
    render(<MatchCard match={targetMatch} />)
    expect(screen.queryByText(/horizon\.swift/i)).not.toBeInTheDocument()
    // accept/decline still available
    expect(screen.getByRole('button', { name: /portal\.matches\.accept/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /portal\.matches\.decline/i })).toBeInTheDocument()
  })

  it('expands to reveal profile and score breakdown on the target card', async () => {
    render(<MatchCard match={targetMatch} />)
    expect(screen.queryByText('Paris, France')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /portal\.matches\.wantsToMeet/i }))

    expect(screen.getByText('Paris, France')).toBeInTheDocument()
    expect(screen.getByText('portal.matches.breakdown.numeric_compatibility.label')).toBeInTheDocument()
  })

  it('shows no expand toggle on the target card without details', () => {
    const match: MatchView = { ...base, status: 'in_progress', perspective: 'target' }
    render(<MatchCard match={match} />)
    expect(screen.queryByRole('button', { name: /portal\.matches\.wantsToMeet/i })).not.toBeInTheDocument()
    expect(screen.getByText(/portal\.matches\.wantsToMeet/)).toBeInTheDocument()
  })

  it('withholds partnerInstagram on initiator cards while still in_progress', () => {
    const match: MatchView = {
      ...base,
      status: 'in_progress',
      perspective: 'initiator',
      partnerInstagram: 'cres.river',
    }
    render(<MatchCard match={match} />)
    expect(screen.queryByText(/cres\.river/i)).not.toBeInTheDocument()
  })

  it('shows partnerInstagram on dating cards', () => {
    const match: MatchView = {
      ...base,
      status: 'dating',
      perspective: 'none',
      partnerInstagram: 'cres.river',
      datingStartedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
    }
    render(<MatchCard match={match} />)
    expect(screen.getByText('@cres.river')).toBeInTheDocument()
  })
})

describe('MatchCard dating-phase gating', () => {
  function datingMatch(daysAgo: number): MatchView {
    return {
      ...base,
      status: 'dating',
      perspective: 'none',
      datingStartedAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
    }
  }

  it('shows a check-in message and no action buttons before day 3', () => {
    render(<MatchCard match={datingMatch(1)} />)
    expect(screen.queryByRole('button', { name: /portal\.matches\.workedOut/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/portal\.matches\.outcome\.notWorkingOutLink/)).not.toBeInTheDocument()
    expect(screen.getByText(/portal\.matches\.checkIn\.message/)).toBeInTheDocument()
  })

  it('shows the quiet cancel link (but not full outcome buttons) between day 3 and day 7', () => {
    render(<MatchCard match={datingMatch(4)} />)
    expect(screen.queryByRole('button', { name: /portal\.matches\.workedOut/i })).not.toBeInTheDocument()
    expect(screen.getByText(/portal\.matches\.outcome\.notWorkingOutLink/)).toBeInTheDocument()
  })

  it('shows full outcome buttons at day 7+', () => {
    render(<MatchCard match={datingMatch(7)} />)
    expect(screen.getByRole('button', { name: /portal\.matches\.workedOut/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /portal\.matches\.didntWork/i })).toBeInTheDocument()
  })

  it('clicking "didn\'t work" shows the optional feedback tags before submitting', async () => {
    render(<MatchCard match={datingMatch(7)} />)
    await userEvent.click(screen.getByRole('button', { name: /portal\.matches\.didntWork/i }))
    expect(screen.getByText(/portal\.matches\.outcome\.feedbackPrompt/)).toBeInTheDocument()
    expect(screen.getByText(/portal\.matches\.outcome\.feedbackTags\.too_far/)).toBeInTheDocument()
  })

  it('continuing past feedback shows the keep-looking/take-a-break choice, and submits on click', async () => {
    const onOutcome = vi.fn().mockResolvedValue(undefined)
    render(<MatchCard match={datingMatch(7)} onOutcome={onOutcome} />)

    await userEvent.click(screen.getByRole('button', { name: /portal\.matches\.didntWork/i }))
    await userEvent.click(screen.getByRole('button', { name: /portal\.matches\.outcome\.feedbackContinue/i }))

    expect(screen.getByRole('button', { name: /portal\.matches\.outcome\.keepLooking/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /portal\.matches\.outcome\.takeABreak/i })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /portal\.matches\.outcome\.takeABreak/i }))

    expect(onOutcome).toHaveBeenCalledWith('m1', 'failed', {
      feedback: undefined,
      continuation: 'break',
    })
  })

  // "It worked" retires both profiles permanently — it must never fire on a
  // single click, and dismissing the dialog must never submit.
  it('clicking "it worked" asks for confirmation, then submits with no feedback step', async () => {
    const onOutcome = vi.fn().mockResolvedValue(undefined)
    render(<MatchCard match={datingMatch(7)} onOutcome={onOutcome} />)

    await userEvent.click(screen.getByRole('button', { name: /portal\.matches\.workedOut/i }))

    expect(onOutcome).not.toHaveBeenCalled()
    expect(screen.getByText(/portal\.matches\.outcome\.confirmSuccessTitle/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /portal\.matches\.outcome\.confirmSuccessYes/i }))

    expect(onOutcome).toHaveBeenCalledWith('m1', 'success', undefined)
    expect(screen.getByText(/portal\.matches\.outcome\.successTitle/)).toBeInTheDocument()
  })

  it('dismissing the "it worked" confirmation submits nothing and restores the card', async () => {
    const onOutcome = vi.fn().mockResolvedValue(undefined)
    render(<MatchCard match={datingMatch(7)} onOutcome={onOutcome} />)

    await userEvent.click(screen.getByRole('button', { name: /portal\.matches\.workedOut/i }))
    await userEvent.click(screen.getByRole('button', { name: /portal\.matches\.outcome\.confirmSuccessNo/i }))

    expect(onOutcome).not.toHaveBeenCalled()
    expect(screen.queryByText(/portal\.matches\.outcome\.confirmSuccessTitle/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /portal\.matches\.workedOut/i })).toBeEnabled()
  })

  it('shows the full name above the Instagram handle when revealed', () => {
    const match: MatchView = {
      ...datingMatch(7),
      partnerInstagram: 'cres.river',
      partnerFullName: 'Crescent River',
    }
    render(<MatchCard match={match} />)
    expect(screen.getByText('Crescent River')).toBeInTheDocument()
    expect(screen.getByText('@cres.river')).toBeInTheDocument()
  })
})

// tested: AI match summary (Section E of PartnerProfileView) — lazy load, cache, error retry
describe('MatchCard AI match summary (Section E)', () => {
  const profileWithData = { location: 'Tunis, Tunisia', age: 27 }
  const SUMMARY = {
    pros: ['Aligned on long-term commitment.', 'Compatible lifestyles.'],
    cons: ['Different religious backgrounds.'],
    generatedAt: '2026-06-18T10:00:00Z',
    model: 'gpt-4o-mini',
  }

  beforeEach(() => {
    mockGetMatchSummary.mockReset()
  })

  async function expandCard() {
    const match: MatchView = { ...base, partnerProfile: profileWithData }
    render(<MatchCard match={match} />)
    await userEvent.click(screen.getByRole('button', { name: /Crescent River/i }))
  }

  it('shows the "Why this match?" button after expanding the card', async () => {
    await expandCard()
    expect(screen.getByRole('button', { name: /portal\.matches\.whyThisMatch/i })).toBeInTheDocument()
  })

  it('clicking the button shows a spinner while the summary loads', async () => {
    mockGetMatchSummary.mockImplementation(() => new Promise(() => {})) // never resolves
    await expandCard()
    await userEvent.click(screen.getByRole('button', { name: /portal\.matches\.whyThisMatch/i }))
    expect(screen.getByText(/portal\.matches\.generatingSummary/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /portal\.matches\.whyThisMatch/i })).not.toBeInTheDocument()
  })

  it('displays pros and cons after a successful summary load', async () => {
    mockGetMatchSummary.mockResolvedValue(SUMMARY)
    await expandCard()
    await userEvent.click(screen.getByRole('button', { name: /portal\.matches\.whyThisMatch/i }))
    expect(await screen.findByText('Aligned on long-term commitment.')).toBeInTheDocument()
    expect(screen.getByText('Different religious backgrounds.')).toBeInTheDocument()
    expect(screen.getByText(/portal\.matches\.strengths/)).toBeInTheDocument()
    expect(screen.getByText(/portal\.matches\.keepInMind/)).toBeInTheDocument()
  })

  it('shows an error message and retry button on failure', async () => {
    mockGetMatchSummary.mockRejectedValue(new Error('LLM timeout'))
    await expandCard()
    await userEvent.click(screen.getByRole('button', { name: /portal\.matches\.whyThisMatch/i }))
    expect(await screen.findByText(/portal\.matches\.summaryError/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /portal\.matches\.summaryRetry/i })).toBeInTheDocument()
  })

  it('retry button clears the error and attempts another load', async () => {
    mockGetMatchSummary
      .mockRejectedValueOnce(new Error('LLM timeout'))
      .mockResolvedValueOnce(SUMMARY)
    await expandCard()
    await userEvent.click(screen.getByRole('button', { name: /portal\.matches\.whyThisMatch/i }))
    const retryBtn = await screen.findByRole('button', { name: /portal\.matches\.summaryRetry/i })
    await userEvent.click(retryBtn)
    expect(await screen.findByText('Aligned on long-term commitment.')).toBeInTheDocument()
    expect(screen.queryByText(/portal\.matches\.summaryError/)).not.toBeInTheDocument()
  })

  it('does not call the API a second time if summary is already loaded', async () => {
    mockGetMatchSummary.mockResolvedValue(SUMMARY)
    await expandCard()
    await userEvent.click(screen.getByRole('button', { name: /portal\.matches\.whyThisMatch/i }))
    await screen.findByText('Aligned on long-term commitment.')
    // Button should be gone once summary is loaded
    expect(screen.queryByRole('button', { name: /portal\.matches\.whyThisMatch/i })).not.toBeInTheDocument()
    expect(mockGetMatchSummary).toHaveBeenCalledTimes(1)
  })
})

// tested: PartnerProfileView adversarial input — non-standard field types
describe('PartnerProfileView adversarial field types', () => {
  async function expandWith(partnerProfile: Record<string, unknown>) {
    render(<MatchCard match={{ ...base, partnerProfile }} />)
    await userEvent.click(screen.getByRole('button', { name: /Crescent River/i }))
  }

  it('handles vibe_words as an empty array without crashing', async () => {
    await expandWith({ location: 'Paris', vibe_words: [] })
    expect(screen.getByText('Paris')).toBeInTheDocument()
  })

  it('handles vibe_words as a number without crashing', async () => {
    await expandWith({ location: 'Paris', vibe_words: 42 })
    expect(screen.getByText('Paris')).toBeInTheDocument()
  })

  it('handles vibe_words as null without crashing', async () => {
    await expandWith({ location: 'Paris', vibe_words: null })
    expect(screen.getByText('Paris')).toBeInTheDocument()
  })

  it('handles all fields undefined/null without crashing', async () => {
    await expandWith({ location: 'Only Location' })
    expect(screen.getByText('Only Location')).toBeInTheDocument()
  })

  it('renders nothing for a completely empty partnerProfile (no toggle shown)', () => {
    render(<MatchCard match={{ ...base, partnerProfile: {} }} />)
    expect(screen.queryByRole('button', { name: /Crescent River/i })).not.toBeInTheDocument()
  })

  it('handles physical_affection_importance as a string without crashing', async () => {
    await expandWith({ location: 'Berlin', physical_affection_importance: 'high' })
    expect(screen.getByText('Berlin')).toBeInTheDocument()
  })

  it('handles open_to_long_distance as a string "yes" without crashing', async () => {
    await expandWith({ location: 'Lyon', open_to_long_distance: 'yes' })
    expect(screen.getByText('Lyon')).toBeInTheDocument()
  })
})

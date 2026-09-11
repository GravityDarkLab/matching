import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { vi } from 'vitest'

vi.mock('../../admin/api/client', () => ({
  fetchApplicant:      vi.fn(),
  fetchIdentity:       vi.fn(),
  deactivateApplicant: vi.fn(),
  regenerateMagicLink: vi.fn(),
  fetchMatches:        vi.fn(),
}))

import * as client from '../../admin/api/client'
import { ApplicantDetail } from '../../admin/pages/ApplicantDetail'
import { ToastProvider } from '../../components/ui/Toast'

const mockFetchApplicant      = vi.mocked(client.fetchApplicant)
const mockFetchIdentity       = vi.mocked(client.fetchIdentity)
const mockDeactivateApplicant = vi.mocked(client.deactivateApplicant)
const mockRegenerateMagicLink = vi.mocked(client.regenerateMagicLink)
const mockFetchMatches        = vi.mocked(client.fetchMatches)

const APPLICANT_A = {
  id: 'id-a',
  alias: 'Lunar Ocean',
  status: 'applied' as const,
  questionnaireVersion: '1.0.0',
  answers: { location: 'Berlin, Germany', age: 25 },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

const APPLICANT_B = {
  id: 'id-b',
  alias: 'Pearl Lantern',
  status: 'applied' as const,
  questionnaireVersion: '1.0.0',
  answers: { location: 'Paris, France', age: 28 },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

const MATCH_WITH_B = {
  id: 'match-1',
  applicantAId: 'id-a',
  applicantAAlias: 'Lunar Ocean',
  applicantBId: 'id-b',
  applicantBAlias: 'Pearl Lantern',
  score: 0.87,
  algorithm: 'baseline',
  status: 'proposed' as const,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

function renderDetail(initialId = 'id-a') {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[`/admin/applicants/${initialId}`]}>
        <Routes>
          <Route path="/admin/applicants/:id" element={<ApplicantDetail />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  )
}

beforeEach(() => {
  mockFetchApplicant.mockReset()
  mockFetchIdentity.mockReset()
  mockDeactivateApplicant.mockReset()
  mockRegenerateMagicLink.mockReset()
  mockFetchMatches.mockReset()

  mockFetchApplicant.mockImplementation(async (id) =>
    id === 'id-a' ? APPLICANT_A : APPLICANT_B,
  )
  mockFetchIdentity.mockResolvedValue({
    alias: 'Lunar Ocean',
    instagramHandle: '@lunar_real',
    fullName: 'Jane Doe',
  })
  mockFetchMatches.mockResolvedValue({ data: [], total: 0, page: 1, limit: 10, totalPages: 0 })
})

describe('ApplicantDetail — identity reveal', () => {
  it('shows the Reveal button and hides identity by default', async () => {
    renderDetail()
    await waitFor(() => expect(screen.getByText('Lunar Ocean')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /admin\.detail\.reveal/i })).toBeInTheDocument()
    expect(screen.queryByText('@lunar_real')).not.toBeInTheDocument()
  })

  it('shows the Instagram handle after clicking Reveal', async () => {
    renderDetail()
    await waitFor(() => screen.getByRole('button', { name: /admin\.detail\.reveal/i }))
    await userEvent.click(screen.getByRole('button', { name: /admin\.detail\.reveal/i }))
    await waitFor(() => expect(screen.getByText('@lunar_real')).toBeInTheDocument())
    expect(mockFetchIdentity).toHaveBeenCalledWith('id-a')
    expect(await screen.findByText('Jane Doe')).toBeInTheDocument()
  })

  it('hides the Reveal button once identity is shown', async () => {
    renderDetail()
    await waitFor(() => screen.getByRole('button', { name: /admin\.detail\.reveal/i }))
    await userEvent.click(screen.getByRole('button', { name: /admin\.detail\.reveal/i }))
    await waitFor(() => screen.getByText('@lunar_real'))
    expect(screen.queryByRole('button', { name: /admin\.detail\.reveal/i })).not.toBeInTheDocument()
  })

  it('shows an error message when identity fetch fails', async () => {
    mockFetchIdentity.mockRejectedValue(new Error('Unauthorized'))
    renderDetail()
    await waitFor(() => screen.getByRole('button', { name: /admin\.detail\.reveal/i }))
    await userEvent.click(screen.getByRole('button', { name: /admin\.detail\.reveal/i }))
    await waitFor(() => expect(screen.getByText('Unauthorized')).toBeInTheDocument())
    expect(screen.queryByText('@lunar_real')).not.toBeInTheDocument()
  })
})

describe('ApplicantDetail — identity clears on navigation (bug fix)', () => {
  it('clears revealed identity when navigating to a different applicant via match link', async () => {
    mockFetchMatches.mockResolvedValue({
      data: [MATCH_WITH_B],
      total: 1,
      page: 1,
      limit: 10,
      totalPages: 1,
    })

    renderDetail('id-a')

    // Wait for applicant A to load and reveal identity
    await waitFor(() => screen.getByRole('button', { name: /admin\.detail\.reveal/i }))
    await userEvent.click(screen.getByRole('button', { name: /admin\.detail\.reveal/i }))
    await waitFor(() => screen.getByText('@lunar_real'))

    // Navigate to applicant B via the match partner link
    const partnerLink = await screen.findByRole('link', { name: /Pearl Lantern/i })
    await userEvent.click(partnerLink)

    // Identity must not be shown on the new applicant page
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Pearl Lantern' })).toBeInTheDocument())
    expect(screen.queryByText('@lunar_real')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /admin\.detail\.reveal/i })).toBeInTheDocument()
  })
})

describe('ApplicantDetail — matches section', () => {
  it('does not render matches section when no matches exist', async () => {
    renderDetail()
    await waitFor(() => screen.getByText('Lunar Ocean'))
    expect(screen.queryByText(/admin\.detail\.matches/i)).not.toBeInTheDocument()
  })

  it('renders matches with partner alias, score and status', async () => {
    mockFetchMatches.mockResolvedValue({
      data: [MATCH_WITH_B],
      total: 1,
      page: 1,
      limit: 10,
      totalPages: 1,
    })
    renderDetail()
    await waitFor(() => screen.getByText('Pearl Lantern'))
    expect(screen.getByText('87%')).toBeInTheDocument()
    expect(screen.getByText('admin.matches.proposed')).toBeInTheDocument()
  })

  it('fetches matches with the current applicant id as participantId', async () => {
    renderDetail('id-a')
    await waitFor(() => mockFetchMatches.mock.calls.length > 0)
    const [, , , participantId] = mockFetchMatches.mock.calls[0] as any[]
    expect(participantId).toBe('id-a')
  })
})

describe('ApplicantDetail — answers section', () => {
  it('renders answer key-value pairs', async () => {
    renderDetail()
    await waitFor(() => screen.getByText('Berlin, Germany'))
    expect(screen.getByText('25')).toBeInTheDocument()
  })
})

// tested: admin "regenerate magic link" recovery action
describe('ApplicantDetail — magic link regeneration', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    })
  })

  it('shows the regenerate button and no link by default', async () => {
    renderDetail()
    await waitFor(() => screen.getByText('Lunar Ocean'))
    expect(screen.getByRole('button', { name: /admin\.detail\.regenerateMagicLink/i })).toBeInTheDocument()
  })

  it('opens a confirm dialog before regenerating', async () => {
    renderDetail()
    await waitFor(() => screen.getByText('Lunar Ocean'))

    await userEvent.click(screen.getByRole('button', { name: /admin\.detail\.regenerateMagicLink/i }))

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('admin.detail.regenerateMagicLinkConfirm')
    expect(mockRegenerateMagicLink).not.toHaveBeenCalled()
  })

  it('reveals the new magic link with a copy button after confirming', async () => {
    mockRegenerateMagicLink.mockResolvedValue({ alias: 'Lunar Ocean', magicToken: 'abc123' })
    renderDetail()
    await waitFor(() => screen.getByText('Lunar Ocean'))

    await userEvent.click(screen.getByRole('button', { name: /admin\.detail\.regenerateMagicLink/i }))
    const dialog = await screen.findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: /admin\.detail\.regenerateMagicLink/i }))

    expect(mockRegenerateMagicLink).toHaveBeenCalledWith('id-a')
    expect(await screen.findByText(/token=abc123/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /admin\.detail\.copy/i })).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('copies the new magic link and shows "copied" feedback', async () => {
    mockRegenerateMagicLink.mockResolvedValue({ alias: 'Lunar Ocean', magicToken: 'abc123' })
    renderDetail()
    await waitFor(() => screen.getByText('Lunar Ocean'))

    await userEvent.click(screen.getByRole('button', { name: /admin\.detail\.regenerateMagicLink/i }))
    const dialog = await screen.findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: /admin\.detail\.regenerateMagicLink/i }))

    const link = await screen.findByText(/token=abc123/)
    await userEvent.click(screen.getByRole('button', { name: /admin\.detail\.copy/i }))

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(link.textContent)
    expect(screen.getByRole('button', { name: /admin\.detail\.copied/i })).toBeInTheDocument()
  })

  it('shows an error when regeneration fails', async () => {
    mockRegenerateMagicLink.mockRejectedValue(new Error('Applicant not found'))
    renderDetail()
    await waitFor(() => screen.getByText('Lunar Ocean'))

    await userEvent.click(screen.getByRole('button', { name: /admin\.detail\.regenerateMagicLink/i }))
    const dialog = await screen.findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: /admin\.detail\.regenerateMagicLink/i }))

    expect(await screen.findByText('Applicant not found')).toBeInTheDocument()
    expect(screen.queryByText(/token=/)).not.toBeInTheDocument()
  })
})

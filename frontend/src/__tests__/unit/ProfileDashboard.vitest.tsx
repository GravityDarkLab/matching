import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'

vi.mock('../../api/profile.client', () => ({
  getMyProfile: vi.fn(),
  getMyMatches: vi.fn(),
  requestContact: vi.fn(),
  respondToContact: vi.fn(),
  withdrawContact: vi.fn(),
  reportOutcome: vi.fn(),
  cancelAccountDeletion: vi.fn(),
  deleteAccountNow: vi.fn(),
}))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => mockNavigate }
})

import * as profileClient from '../../api/profile.client'
import ProfileDashboard from '../../pages/profile/ProfileDashboard'
import { ThemeProvider } from '../../theme/ThemeProvider'
import { ToastProvider } from '../../components/ui/Toast'

const mockGetMyProfile = vi.mocked(profileClient.getMyProfile)
const mockGetMyMatches = vi.mocked(profileClient.getMyMatches)

function renderDashboard() {
  return render(
    <ThemeProvider>
      <ToastProvider>
        <MemoryRouter>
          <ProfileDashboard />
        </MemoryRouter>
      </ToastProvider>
    </ThemeProvider>,
  )
}

describe('ProfileDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockNavigate.mockReset()
    mockGetMyMatches.mockResolvedValue([])
  })

  it('shows applied waiting state when status is "applied"', async () => {
    mockGetMyProfile.mockResolvedValue({
      applicantId: '1',
      alias: 'Test User',
      fullName: null,
      status: 'applied',
      scoreThreshold: 0.8,
      createdAt: '2026-01-01',
      deletionScheduledAt: null,
      distanceNudge: null,
    })

    renderDashboard()

    await waitFor(() => {
      expect(screen.getByText(/portal\.dashboard\.findingMatches/i)).toBeInTheDocument()
    })
    expect(screen.getByText('Test User')).toBeInTheDocument()
  })

  it('shows a threshold slider and reveals more matches when lowered', async () => {
    mockGetMyProfile.mockResolvedValue({
      applicantId: '2',
      alias: 'River Moon',
      fullName: null,
      status: 'matched',
      scoreThreshold: 0.8,
      createdAt: '2026-01-01',
      deletionScheduledAt: null,
      distanceNudge: null,
    })
    mockGetMyMatches.mockResolvedValue([
      { matchId: 'm1', partnerAlias: 'High Score', score: 0.86, status: 'proposed', perspective: 'none' },
      { matchId: 'm2', partnerAlias: 'Low Score', score: 0.65, status: 'proposed', perspective: 'none' },
    ])

    renderDashboard()

    // Matches are fetched at the server minimum so the slider works client-side
    await waitFor(() => {
      expect(mockGetMyMatches).toHaveBeenCalledWith(0.6, 50)
    })

    // Default threshold 80% — only the high-score match is visible
    expect(await screen.findByText('High Score')).toBeInTheDocument()
    expect(screen.queryByText('Low Score')).not.toBeInTheDocument()

    // Lower the slider to 60% — the second match appears
    fireEvent.change(screen.getByRole('slider'), { target: { value: '60' } })
    expect(screen.getByText('Low Score')).toBeInTheDocument()

    // Raise back to 80% — it disappears again
    fireEvent.change(screen.getByRole('slider'), { target: { value: '80' } })
    expect(screen.queryByText('Low Score')).not.toBeInTheDocument()
  })

  it('shows the next-phase message when matched with no visible matches', async () => {
    mockGetMyProfile.mockResolvedValue({
      applicantId: '2',
      alias: 'River Moon',
      fullName: null,
      status: 'matched',
      scoreThreshold: 0.8,
      createdAt: '2026-01-01',
      deletionScheduledAt: null,
      distanceNudge: null,
    })
    mockGetMyMatches.mockResolvedValue([])

    renderDashboard()

    await waitFor(() => {
      expect(screen.getByText(/portal\.dashboard\.nextPhaseTitle/i)).toBeInTheDocument()
    })
    expect(screen.getByText(/portal\.dashboard\.nextPhaseBody/i)).toBeInTheDocument()
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
  })

  it('shows dormant message when status is "inactive"', async () => {
    mockGetMyProfile.mockResolvedValue({
      applicantId: '3',
      alias: 'Still Waters',
      fullName: null,
      status: 'inactive',
      scoreThreshold: 0.8,
      createdAt: '2026-01-01',
      deletionScheduledAt: null,
      distanceNudge: null,
    })

    renderDashboard()

    await waitFor(() => {
      expect(screen.getByText(/portal\.dashboard\.dormantTitle/i)).toBeInTheDocument()
    })
  })

  it('shows a deletion countdown when a deletion is scheduled', async () => {
    mockGetMyProfile.mockResolvedValue({
      applicantId: '4',
      alias: 'Quiet Harbor',
      fullName: null,
      status: 'inactive',
      scoreThreshold: 0.8,
      createdAt: '2026-01-01',
      deletionScheduledAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
      distanceNudge: null,
    })

    renderDashboard()

    await waitFor(() => {
      expect(screen.getByText(/portal\.dashboard\.deletion\.title/i)).toBeInTheDocument()
    })
    expect(screen.getByText(/portal\.dashboard\.deletion\.cancelButton/i)).toBeInTheDocument()
    expect(screen.getByText(/portal\.dashboard\.deletion\.deleteNowButton/i)).toBeInTheDocument()
  })

  it('cancels a scheduled deletion and reloads the profile', async () => {
    mockGetMyProfile
      .mockResolvedValueOnce({
        applicantId: '5',
        alias: 'Quiet Harbor',
        fullName: null,
        status: 'inactive',
        scoreThreshold: 0.8,
        createdAt: '2026-01-01',
        deletionScheduledAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
        distanceNudge: null,
      })
      .mockResolvedValueOnce({
        applicantId: '5',
        alias: 'Quiet Harbor',
        fullName: null,
        status: 'applied',
        scoreThreshold: 0.8,
        createdAt: '2026-01-01',
        deletionScheduledAt: null,
        distanceNudge: null,
      })
    vi.mocked(profileClient.cancelAccountDeletion).mockResolvedValue(undefined)

    renderDashboard()

    await waitFor(() => {
      expect(screen.getByText(/portal\.dashboard\.deletion\.cancelButton/i)).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText(/portal\.dashboard\.deletion\.cancelButton/i))
    fireEvent.click(screen.getByText(/portal\.dashboard\.deletion\.cancelYes/i))

    await waitFor(() => {
      expect(profileClient.cancelAccountDeletion).toHaveBeenCalled()
    })
    await waitFor(() => {
      expect(screen.getByText(/portal\.dashboard\.findingMatches/i)).toBeInTheDocument()
    })
  })

  it('deletes the account immediately and navigates home', async () => {
    mockGetMyProfile.mockResolvedValue({
      applicantId: '6',
      alias: 'Quiet Harbor',
      fullName: null,
      status: 'inactive',
      scoreThreshold: 0.8,
      createdAt: '2026-01-01',
      deletionScheduledAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
      distanceNudge: null,
    })
    vi.mocked(profileClient.deleteAccountNow).mockResolvedValue(undefined)

    renderDashboard()

    await waitFor(() => {
      expect(screen.getByText(/portal\.dashboard\.deletion\.deleteNowButton/i)).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText(/portal\.dashboard\.deletion\.deleteNowButton/i))
    fireEvent.click(screen.getByText(/portal\.dashboard\.deletion\.deleteNowYes/i))

    await waitFor(() => {
      expect(profileClient.deleteAccountNow).toHaveBeenCalled()
    })
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/')
    })
  })
})

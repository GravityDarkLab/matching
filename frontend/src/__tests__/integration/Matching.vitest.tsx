import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'

vi.mock('../../admin/api/client', () => ({
  runMatching: vi.fn(),
  fetchMatchingLastRun: vi.fn(),
}))

import * as client from '../../admin/api/client'
import { Matching } from '../../admin/pages/Matching'

const mockRunMatching = vi.mocked(client.runMatching)
const mockFetchLastRun = vi.mocked(client.fetchMatchingLastRun)

const RUN_RESULT = {
  algorithm: 'embedding-cosine',
  totalApplicants: 130,
  durationMs: 93,
  couplesProposed: 480,
  results: {},
}

function renderMatching() {
  return render(
    <MemoryRouter>
      <Matching />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockRunMatching.mockReset()
  mockFetchLastRun.mockReset()
  mockFetchLastRun.mockResolvedValue(null)
})

/** Click "Run Matching" then confirm via the inline confirm dialog */
async function clickRunAndConfirm() {
  await userEvent.click(screen.getByRole('button', { name: /admin\.matching\.run/i }))
  await userEvent.click(screen.getByRole('button', { name: /admin\.matching\.confirmRun|yes, run matching/i }))
}

describe('Matching page — algorithm selector', () => {
  it('renders only the embedding algorithm option', () => {
    renderMatching()
    expect(screen.getAllByRole('radio')).toHaveLength(1)
  })

  it('selects Embedding by default', () => {
    renderMatching()
    const radio = screen.getByRole('radio', { name: /admin\.matching\.embedding/i }) as HTMLInputElement
    expect(radio).toBeChecked()
  })

  it('never shows the multilingual warning (only embedding is available)', () => {
    renderMatching()
    expect(screen.queryByText(/admin\.matching\.multilingualWarning/i)).not.toBeInTheDocument()
  })
})

describe('Matching page — run button', () => {
  it('calls runMatching with embedding-cosine', async () => {
    mockRunMatching.mockResolvedValue(RUN_RESULT)
    renderMatching()
    await clickRunAndConfirm()
    expect(mockRunMatching).toHaveBeenCalledWith('embedding-cosine')
  })

  it('shows error message when run fails', async () => {
    mockRunMatching.mockRejectedValue(new Error('Embedding server unreachable'))
    renderMatching()
    await clickRunAndConfirm()
    await waitFor(() =>
      expect(screen.getByText('Embedding server unreachable')).toBeInTheDocument(),
    )
  })

  it('shows confirm dialog when Run Matching is clicked', async () => {
    renderMatching()
    await userEvent.click(screen.getByRole('button', { name: /admin\.matching\.run/i }))
    expect(screen.getByRole('button', { name: /admin\.matching\.confirmRun|yes, run matching/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /admin\.matching\.cancel|cancel/i })).toBeInTheDocument()
  })

  it('dismisses confirm dialog on cancel', async () => {
    renderMatching()
    await userEvent.click(screen.getByRole('button', { name: /admin\.matching\.run/i }))
    await userEvent.click(screen.getByRole('button', { name: /admin\.matching\.cancel|cancel/i }))
    expect(screen.queryByRole('button', { name: /admin\.matching\.confirmRun|yes, run matching/i })).not.toBeInTheDocument()
    expect(mockRunMatching).not.toHaveBeenCalled()
  })
})

describe('Matching page — result summary card', () => {
  it('is not shown before any run', () => {
    renderMatching()
    expect(screen.queryByText(/admin\.matching\.runComplete/i)).not.toBeInTheDocument()
  })

  it('shows the success card after a successful run', async () => {
    mockRunMatching.mockResolvedValue(RUN_RESULT)
    renderMatching()
    await clickRunAndConfirm()
    await waitFor(() =>
      expect(screen.getByText(/admin\.matching\.runComplete/i)).toBeInTheDocument(),
    )
  })

  it('shows applicants scored stat', async () => {
    mockRunMatching.mockResolvedValue(RUN_RESULT)
    renderMatching()
    await clickRunAndConfirm()
    await waitFor(() => screen.getByText(/admin\.matching\.runComplete/i))
    expect(screen.getByText('130')).toBeInTheDocument()
  })

  it('shows couple proposals saved stat', async () => {
    mockRunMatching.mockResolvedValue(RUN_RESULT)
    renderMatching()
    await clickRunAndConfirm()
    await waitFor(() => screen.getByText(/admin\.matching\.runComplete/i))
    expect(screen.getByText('480')).toBeInTheDocument()
  })

  it('shows duration stat', async () => {
    mockRunMatching.mockResolvedValue(RUN_RESULT)
    renderMatching()
    await clickRunAndConfirm()
    await waitFor(() => screen.getByText(/admin\.matching\.runComplete/i))
    expect(screen.getByText('93ms')).toBeInTheDocument()
  })

  it('shows the View Matches link', async () => {
    mockRunMatching.mockResolvedValue(RUN_RESULT)
    renderMatching()
    await clickRunAndConfirm()
    await waitFor(() => screen.getByText(/admin\.matching\.runComplete/i))
    const link = screen.getByRole('link', { name: /admin\.matching\.viewMatches/i })
    expect(link).toHaveAttribute('href', '/admin/matches')
  })
})

describe('Matching page — last run info', () => {
  it('shows neverRun when the server has no recorded run', async () => {
    renderMatching()
    await waitFor(() => expect(mockFetchLastRun).toHaveBeenCalled())
    expect(screen.getByText(/admin\.matching\.neverRun/i)).toBeInTheDocument()
  })

  it('shows the stored last-run summary on mount', async () => {
    mockFetchLastRun.mockResolvedValue({
      at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      algorithm: 'embedding-cosine',
      totalApplicants: 12,
      couplesProposed: 4,
      durationMs: 850,
      triggeredBy: 'scheduler',
    })
    renderMatching()
    expect(await screen.findByText(/admin\.matching\.lastRunSummary/i)).toBeInTheDocument()
    expect(screen.queryByText(/admin\.matching\.neverRun/i)).not.toBeInTheDocument()
  })

  it('updates the last-run summary after a manual run', async () => {
    mockRunMatching.mockResolvedValue(RUN_RESULT)
    renderMatching()
    await waitFor(() => expect(mockFetchLastRun).toHaveBeenCalled())
    expect(screen.getByText(/admin\.matching\.neverRun/i)).toBeInTheDocument()

    await clickRunAndConfirm()
    expect(await screen.findByText(/admin\.matching\.lastRunSummary/i)).toBeInTheDocument()
  })
})

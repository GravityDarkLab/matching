import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import DistanceNudgeCard from '../../pages/profile/DistanceNudgeCard'

vi.mock('../../api/profile.client', () => ({
  acknowledgeDistanceNudge: vi.fn(),
}))
import * as profileClient from '../../api/profile.client'
const mockAck = vi.mocked(profileClient.acknowledgeDistanceNudge)

const mockToastError = vi.fn()
vi.mock('../../components/ui/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: mockToastError, toast: vi.fn() }),
}))

describe('DistanceNudgeCard', () => {
  beforeEach(() => {
    mockAck.mockReset()
    mockToastError.mockReset()
  })

  it('renders the prompt and both choices', () => {
    render(<DistanceNudgeCard matchId="m1" onDismissed={vi.fn()} />)
    expect(screen.getByText(/portal\.dashboard\.distanceNudge\.title/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /portal\.dashboard\.distanceNudge\.yes/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /portal\.dashboard\.distanceNudge\.no/i })).toBeInTheDocument()
  })

  it('clicking Yes acknowledges with openUp true and calls onDismissed', async () => {
    mockAck.mockResolvedValue(undefined)
    const onDismissed = vi.fn()
    render(<DistanceNudgeCard matchId="m1" onDismissed={onDismissed} />)

    await userEvent.click(screen.getByRole('button', { name: /portal\.dashboard\.distanceNudge\.yes/i }))

    expect(mockAck).toHaveBeenCalledWith('m1', true)
    expect(onDismissed).toHaveBeenCalled()
  })

  it('clicking No acknowledges with openUp false and calls onDismissed', async () => {
    mockAck.mockResolvedValue(undefined)
    const onDismissed = vi.fn()
    render(<DistanceNudgeCard matchId="m1" onDismissed={onDismissed} />)

    await userEvent.click(screen.getByRole('button', { name: /portal\.dashboard\.distanceNudge\.no/i }))

    expect(mockAck).toHaveBeenCalledWith('m1', false)
    expect(onDismissed).toHaveBeenCalled()
  })

  it('shows an error toast and does not dismiss when acknowledging fails', async () => {
    mockAck.mockRejectedValue(new Error('network error'))
    const onDismissed = vi.fn()
    render(<DistanceNudgeCard matchId="m1" onDismissed={onDismissed} />)

    await userEvent.click(screen.getByRole('button', { name: /portal\.dashboard\.distanceNudge\.yes/i }))

    expect(mockAck).toHaveBeenCalledWith('m1', true)
    expect(onDismissed).not.toHaveBeenCalled()
    expect(mockToastError).toHaveBeenCalledWith('network error')
  })
})

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'

vi.mock('../../api/profile.client', () => ({
  getMyAnswers: vi.fn(),
  updateMyAnswers: vi.fn(),
}))

import * as profileClient from '../../api/profile.client'
import EditProfileForm, { toAnswersPayload } from '../../pages/profile/EditProfileForm'
import type { FormValues } from '../../types/form'
import { ToastProvider } from '../../components/ui/Toast'

const mockGetMyAnswers = vi.mocked(profileClient.getMyAnswers)
const mockUpdateMyAnswers = vi.mocked(profileClient.updateMyAnswers)

const ANSWERS: Record<string, unknown> = {
  location: 'Paris, France',
  birth_date: `${new Date().getFullYear() - 28}-05-15`,
  work: 'Student',
  gender_identity: 'Female',
  sexual_orientation: 'Straight',
  religion: 'Islam',
  vibe_words: 'calm, curious',
  lifestyle: 'Early riser, gym, reading',
  relationship_type: 'Long Term',
  open_to_long_distance: true,
  preferred_physical_traits: 'Tall',
  preferred_character_traits: 'Kind',
  deal_breakers: 'Smoking',
  okay_with_opposite_gender_friends: true,
  religion_deal_breaker: false,
  physical_affection_importance: 7,
  dream_first_date: 'A walk by the sea',
}

function renderForm() {
  return render(
    <ToastProvider>
      <EditProfileForm />
    </ToastProvider>,
  )
}

beforeEach(() => {
  mockGetMyAnswers.mockReset()
  mockUpdateMyAnswers.mockReset()
  mockGetMyAnswers.mockResolvedValue(ANSWERS)
})

describe('EditProfileForm', () => {
  it('loads the saved answers into the form', async () => {
    renderForm()
    await waitFor(() =>
      expect(screen.getByDisplayValue('Paris, France')).toBeInTheDocument(),
    )
    expect(screen.getByDisplayValue('Student')).toBeInTheDocument()
    expect(screen.getByDisplayValue('A walk by the sea')).toBeInTheDocument()
  })

  it('shows the locked Instagram note instead of an editable field', async () => {
    renderForm()
    await waitFor(() =>
      expect(screen.getByText(/portal\.profile\.instagramLocked/)).toBeInTheDocument(),
    )
    // No input is rendered for the handle — only the note
    expect(screen.queryByDisplayValue(/@/)).not.toBeInTheDocument()
  })

  it('disables Save until something changes', async () => {
    renderForm()
    await waitFor(() =>
      expect(screen.getByDisplayValue('Paris, France')).toBeInTheDocument(),
    )
    const save = screen.getByRole('button', { name: 'portal.profile.save' })
    expect(save).toBeDisabled()

    await userEvent.type(screen.getByDisplayValue('Student'), ' of life')
    expect(save).toBeEnabled()
  })

  it('saves the edited answers without instagram_handle or disclaimer_agreed', async () => {
    mockUpdateMyAnswers.mockResolvedValue(undefined)
    renderForm()
    await waitFor(() =>
      expect(screen.getByDisplayValue('Paris, France')).toBeInTheDocument(),
    )

    await userEvent.type(screen.getByDisplayValue('Student'), 's')
    await userEvent.click(screen.getByRole('button', { name: 'portal.profile.save' }))

    await waitFor(() => expect(mockUpdateMyAnswers).toHaveBeenCalledTimes(1))
    const payload = mockUpdateMyAnswers.mock.calls[0][0]
    expect(payload.work).toBe('Students')
    expect(payload).not.toHaveProperty('first_name')
    expect(payload).not.toHaveProperty('last_name')
    expect(payload).not.toHaveProperty('instagram_handle')
    expect(payload).not.toHaveProperty('disclaimer_agreed')
    expect(payload).not.toHaveProperty('birth_date')
    expect(payload).not.toHaveProperty('gender_identity')
  })

  it('shows an error message when loading fails', async () => {
    mockGetMyAnswers.mockRejectedValue(new Error('boom'))
    renderForm()
    await waitFor(() =>
      expect(screen.getByText('portal.profile.loadError')).toBeInTheDocument(),
    )
  })

  it('shows an error and keeps the form dirty when saving fails', async () => {
    mockUpdateMyAnswers.mockRejectedValue(new Error('boom'))
    renderForm()
    await waitFor(() =>
      expect(screen.getByDisplayValue('Paris, France')).toBeInTheDocument(),
    )

    await userEvent.type(screen.getByDisplayValue('Student'), 's')
    await userEvent.click(screen.getByRole('button', { name: 'portal.profile.save' }))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('portal.profile.saveError'),
    )
    expect(screen.getByRole('button', { name: 'portal.profile.save' })).toBeEnabled()
  })
})

describe('toAnswersPayload', () => {
  const baseValues = {
    ...ANSWERS,
    first_name: 'locked',
    last_name: 'locked',
    instagram_handle: 'locked',
    disclaimer_agreed: true,
  } as FormValues

  it('strips the locked fields', () => {
    const payload = toAnswersPayload(baseValues)
    expect(payload).not.toHaveProperty('first_name')
    expect(payload).not.toHaveProperty('last_name')
    expect(payload).not.toHaveProperty('instagram_handle')
    expect(payload).not.toHaveProperty('disclaimer_agreed')
    expect(payload).not.toHaveProperty('birth_date')
    expect(payload).not.toHaveProperty('gender_identity')
    expect(payload.location).toBe('Paris, France')
  })

  it('drops height_cm when empty so the API clears it', () => {
    expect(toAnswersPayload({ ...baseValues, height_cm: undefined })).not.toHaveProperty('height_cm')
    expect(toAnswersPayload({ ...baseValues, height_cm: NaN })).not.toHaveProperty('height_cm')
    expect(toAnswersPayload({ ...baseValues, height_cm: 170 })).toHaveProperty('height_cm', 170)
  })
})

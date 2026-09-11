import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useForm } from 'react-hook-form'
import Step4Preferences from '../../steps/Step4Preferences'
import type { FormValues } from '../../types/form'

function Harness({ defaultValues }: { defaultValues?: Partial<FormValues> }) {
  const { control, formState: { errors }, getValues } = useForm<FormValues>({
    defaultValues: defaultValues as FormValues,
  })
  return (
    <div>
      <Step4Preferences control={control} errors={errors} />
      <button type="button" onClick={() => {
        // Surface the live form state as text so tests can assert on it.
        const v = getValues()
        document.getElementById('debug')!.textContent = JSON.stringify({
          max_age_gap: v.max_age_gap, open_to_older: v.open_to_older, open_to_younger: v.open_to_younger,
        })
      }}>dump</button>
      <pre id="debug" />
    </div>
  )
}

async function dump() {
  await userEvent.click(screen.getByRole('button', { name: 'dump' }))
  return JSON.parse(screen.getByText(/./, { selector: '#debug' }).textContent || '{}')
}

describe('Step4Preferences — age preference toggles', () => {
  it('hides the directional toggles until a max_age_gap is entered', () => {
    render(<Harness />)
    expect(screen.queryByText('steps.s4.openToOlder')).not.toBeInTheDocument()
  })

  it('resets open_to_older/open_to_younger when max_age_gap is cleared after being set', async () => {
    render(<Harness />)

    await userEvent.type(screen.getByLabelText('steps.s4.maxAgeGap'), '10')
    // Toggle is a <button> whose accessible name is its label text — the
    // nested role="switch" div has no text of its own to compute a name from.
    const olderToggle = screen.getByRole('button', { name: 'steps.s4.openToOlder' })
    await userEvent.click(olderToggle) // undefined -> true (an explicit user choice)

    expect((await dump()).open_to_older).toBe(true)

    // Clear the gap — intending "no age preference at all"
    await userEvent.clear(screen.getByLabelText('steps.s4.maxAgeGap'))

    const state = await dump()
    expect(state.max_age_gap).toBeNull()
    // The stale `false` must not linger and silently keep vetoing older
    // partners — age.filter.ts enforces open_to_older independently of
    // max_age_gap, even when the gap is blank.
    expect(state.open_to_older).toBeNull()
    expect(state.open_to_younger).toBeNull()
  })

  it("does not clobber a pre-existing preference on initial mount (edit mode, gap already blank)", async () => {
    render(<Harness defaultValues={{ max_age_gap: null, open_to_older: false } as Partial<FormValues>} />)

    // Directional toggles are hidden (no gap set) — but the stored value
    // must survive being mounted this way, not get silently reset to null.
    expect((await dump()).open_to_older).toBe(false)
  })
})

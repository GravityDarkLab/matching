import { useEffect, useRef } from 'react'
import { Controller, useController, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import type { Control, FieldErrors } from 'react-hook-form'
import type { FormValues } from '../types/form'
import Textarea from '../components/ui/Textarea'
import RadioCardGroup from '../components/ui/RadioCard'
import Toggle from '../components/ui/Toggle'
import Input from '../components/ui/Input'
import WordCountHint from '../components/ui/WordCountHint'

interface Props { control: Control<FormValues>; errors: FieldErrors<FormValues> }
export const FIELDS: (keyof FormValues)[] = [
  'relationship_type', 'open_to_long_distance',
  'max_age_gap', 'open_to_older', 'open_to_younger',
  'preferred_physical_traits', 'preferred_character_traits',
  'deal_breakers', 'okay_with_opposite_gender_friends', 'religion_deal_breaker',
]

// Values stay in English — stored in DB and used by matching engine
const relationshipOptions = [
  { value: 'Long Term', label: 'Long Term' },
  { value: 'Short Term', label: 'Short Term' },
  { value: 'Open to Both', label: 'Open to Both' },
  { value: 'Casual', label: 'Casual' },
  { value: 'Not Sure', label: 'Not Sure' },
]

export default function Step4Preferences({ control, errors }: Props) {
  const { t } = useTranslation()
  const maxAgeGap = useWatch({ control, name: 'max_age_gap' })
  const showDirectional = typeof maxAgeGap === 'number' && maxAgeGap > 0

  const { field: openToOlderField } = useController({ name: 'open_to_older', control })
  const { field: openToYoungerField } = useController({ name: 'open_to_younger', control })

  // react-hook-form keeps a field's last value after it unmounts (shouldUnregister
  // defaults to false), and age.filter.ts enforces open_to_older/open_to_younger as
  // independent hard vetoes regardless of max_age_gap — so clearing the gap after
  // setting one of these must reset it too, or a stale `false` silently keeps
  // vetoing older/younger partners with no way for the user to see or undo it.
  // Only reset on an actual true -> false transition, not on mount, so loading an
  // existing profile that already has max_age_gap blank + a real stored
  // preference (a valid state) doesn't get its data clobbered.
  const wasDirectionalRef = useRef(showDirectional)
  useEffect(() => {
    if (wasDirectionalRef.current && !showDirectional) {
      openToOlderField.onChange(null)
      openToYoungerField.onChange(null)
    }
    wasDirectionalRef.current = showDirectional
  }, [showDirectional, openToOlderField, openToYoungerField])

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold text-primary tracking-tight">{t('steps.s4.title')}</h2>
        <p className="text-sm text-muted leading-relaxed">{t('steps.s4.subtitle')}</p>
      </div>
      <div className="flex flex-col gap-5">
        <Controller name="relationship_type" control={control} render={({ field }) => (
          <RadioCardGroup label={t('steps.s4.relationshipType')} options={relationshipOptions}
            value={field.value ?? ''} onChange={field.onChange}
            error={errors.relationship_type?.message} columns={2} />
        )} />
        <Controller name="open_to_long_distance" control={control} render={({ field }) => (
          <Toggle label={t('steps.s4.longDistance')} hint={t('steps.s4.longDistanceHint')}
            value={field.value ?? false} onChange={field.onChange} />
        )} />

        {/* Age preferences */}
        <div className="flex flex-col gap-3">
          <Controller
            name="max_age_gap"
            control={control}
            render={({ field }) => (
              <Input
                label={t('steps.s4.maxAgeGap')}
                type="number"
                min={0}
                max={40}
                placeholder={t('steps.s4.maxAgeGapPlaceholder')}
                error={errors.max_age_gap?.message}
                value={field.value ?? ''}
                onChange={e => {
                  const raw = e.target.value
                  const parsed = parseInt(raw, 10)
                  field.onChange(raw === '' || Number.isNaN(parsed) ? null : parsed)
                }}
                onBlur={field.onBlur}
              />
            )}
          />
          {showDirectional && (
            <div className="flex flex-col gap-2 ps-1">
              <Toggle
                label={t('steps.s4.openToOlder')}
                value={openToOlderField.value ?? false}
                onChange={openToOlderField.onChange}
              />
              <Toggle
                label={t('steps.s4.openToYounger')}
                value={openToYoungerField.value ?? false}
                onChange={openToYoungerField.onChange}
              />
            </div>
          )}
        </div>

        <Controller name="preferred_physical_traits" control={control} render={({ field }) => (
          <div className="flex flex-col gap-1">
            <Textarea label={t('steps.s4.physicalTraits')} placeholder={t('steps.s4.physicalTraitsPlaceholder')}
              rows={3} error={errors.preferred_physical_traits?.message} required {...field} />
            <WordCountHint value={field.value as string} />
          </div>
        )} />
        <Controller name="preferred_character_traits" control={control} render={({ field }) => (
          <div className="flex flex-col gap-1">
            <Textarea label={t('steps.s4.characterTraits')} placeholder={t('steps.s4.characterTraitsPlaceholder')}
              rows={3} error={errors.preferred_character_traits?.message} required {...field} />
            <WordCountHint value={field.value as string} />
          </div>
        )} />
        <Controller name="deal_breakers" control={control} render={({ field }) => (
          <div className="flex flex-col gap-1">
            <Textarea label={t('steps.s4.dealBreakers')} placeholder={t('steps.s4.dealBreakersPlaceholder')}
              rows={3} error={errors.deal_breakers?.message} required {...field} />
            <WordCountHint value={field.value as string} />
          </div>
        )} />
        <div className="flex flex-col gap-2">
          <Controller name="okay_with_opposite_gender_friends" control={control} render={({ field }) => (
            <Toggle label={t('steps.s4.oppGenderFriends')} value={field.value ?? false} onChange={field.onChange} />
          )} />
          <Controller name="religion_deal_breaker" control={control} render={({ field }) => (
            <Toggle label={t('steps.s4.religionDealBreaker')} hint={t('steps.s4.religionDealBreakerHint')}
              value={field.value ?? false} onChange={field.onChange} />
          )} />
        </div>
      </div>
    </div>
  )
}

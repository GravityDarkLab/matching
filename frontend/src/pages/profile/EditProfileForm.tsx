import { useEffect, useRef, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import type { FormValues } from '../../types/form'
import { formSchema } from '../../types/form'
import { ageFromBirthDate } from '../../lib/age'
import { getMyAnswers, updateMyAnswers } from '../../api/profile.client'
import Autocomplete from '../../components/ui/Autocomplete'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import RadioCardGroup from '../../components/ui/RadioCard'
import Skeleton from '../../components/ui/Skeleton'
import Slider from '../../components/ui/Slider'
import Textarea from '../../components/ui/Textarea'
import { useToast } from '../../components/ui/Toast'
import { CITIES } from '../../data/cities'
import { OCCUPATIONS } from '../../data/occupations'
import { RELIGIONS } from '../../data/religions'

import Step3Vibe from '../../steps/Step3Vibe'
import Step4Preferences from '../../steps/Step4Preferences'

// Locked answers never sent back to the API: first_name, last_name,
// instagram_handle and disclaimer_agreed exist only to satisfy the shared
// formSchema, while birth_date and gender_identity are loaded for display
// but only an admin may change them
const LOCKED_DEFAULTS = {
  first_name: 'locked',
  last_name: 'locked',
  instagram_handle: 'locked',
  disclaimer_agreed: true as const,
}

const LOCKED_ANSWER_KEYS = ['first_name', 'last_name', 'instagram_handle', 'disclaimer_agreed', 'birth_date', 'gender_identity'] as const

// Mirrors Step2's radio options — values stay in English for the matching engine
const orientationOptions = [
  { value: 'Straight', label: 'Straight' },
  { value: 'Gay', label: 'Gay' },
  { value: 'Bisexual', label: 'Bisexual' },
  { value: 'Other', label: 'Other' },
]

function LockIcon() {
  return (
    <svg className="h-4 w-4 flex-shrink-0" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg className="h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function toFormValues(answers: Record<string, unknown>): FormValues {
  return { ...LOCKED_DEFAULTS, ...answers } as FormValues
}

/** Strips the locked fields and serializes form values into an answers payload. */
export function toAnswersPayload(values: FormValues): Record<string, unknown> {
  const answers: Record<string, unknown> = { ...values }
  for (const key of LOCKED_ANSWER_KEYS) delete answers[key]
  // height_cm is optional — drop it entirely when empty so the API clears it
  const height = answers['height_cm']
  if (height === undefined || (typeof height === 'number' && Number.isNaN(height))) {
    delete answers['height_cm']
  }
  return answers
}

function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <section className="bg-surface border border-border rounded-2xl p-6 shadow-card">
      {children}
    </section>
  )
}

function LockedRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-bg border border-border px-4 py-3">
      <div className="flex items-center gap-3 text-muted min-w-0">
        <LockIcon />
        <span className="text-sm font-medium text-primary">{label}</span>
      </div>
      {value && <span className="text-sm text-muted truncate">{value}</span>}
    </div>
  )
}

export default function EditProfileForm() {
  const { t, i18n } = useTranslation()
  const { success } = useToast()

  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const {
    control,
    formState: { errors, isDirty, isSubmitting },
    handleSubmit,
    reset,
    watch,
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    mode: 'onBlur',
    defaultValues: LOCKED_DEFAULTS as Partial<FormValues>,
  })

  useEffect(() => {
    getMyAnswers()
      .then(answers => reset(toFormValues(answers)))
      .catch(() => setLoadFailed(true))
      .finally(() => setLoading(false))
  }, [reset])

  useEffect(() => () => {
    if (savedTimer.current) clearTimeout(savedTimer.current)
  }, [])

  const onSubmit = handleSubmit(async values => {
    setSaveFailed(false)
    try {
      await updateMyAnswers(toAnswersPayload(values))
      reset(values) // clears dirty state, keeps what was saved
      success(t('portal.profile.saved'))
      setJustSaved(true)
      if (savedTimer.current) clearTimeout(savedTimer.current)
      savedTimer.current = setTimeout(() => setJustSaved(false), 2500)
    } catch {
      setSaveFailed(true)
    }
  })

  const birthDate = watch('birth_date')
  const gender = watch('gender_identity')
  const age = ageFromBirthDate(birthDate)
  const birthDateDisplay = birthDate
    ? `${new Date(`${birthDate}T00:00:00`).toLocaleDateString(i18n.language)}${age !== null ? ` · ${t('portal.profile.yearsOld', { age })}` : ''}`
    : undefined

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
        <Skeleton className="h-40 w-full rounded-2xl" />
      </div>
    )
  }

  if (loadFailed) {
    return (
      <div className="bg-surface border border-border rounded-2xl p-8 text-center">
        <p className="text-sm text-muted">{t('portal.profile.loadError')}</p>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 pb-24" noValidate>
      <p className="text-sm text-muted">{t('portal.profile.intro')}</p>

      {/* Identity: admin-locked facts + editable location */}
      <SectionCard>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <LockedRow label={t('steps.s1.instagram')} />
            <LockedRow label={t('steps.s2.birthDate')} value={birthDateDisplay} />
            <LockedRow label={t('steps.s2.gender')} value={gender} />
            <p className="text-xs text-muted leading-relaxed px-1">
              {t('portal.profile.instagramLocked')} {t('portal.profile.adminLockedNote')}
            </p>
          </div>
          <Controller
            name="location"
            control={control}
            render={({ field }) => (
              <Autocomplete label={t('steps.s1.location')} placeholder={t('steps.s1.locationPlaceholder')}
                error={errors.location?.message} required suggestions={CITIES} {...field} />
            )}
          />
        </div>
      </SectionCard>

      {/* About you — the editable subset of the wizard's step 2 */}
      <SectionCard>
        <div className="flex flex-col gap-6">
          <h2 className="text-2xl font-semibold text-primary tracking-tight">{t('steps.s2.title')}</h2>
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <Controller name="height_cm" control={control} render={({ field }) => (
                <Input label={t('steps.s2.height')} type="number" placeholder={t('steps.s2.heightPlaceholder')}
                  hint={t('steps.s2.heightHint')} error={errors.height_cm?.message} {...field}
                  onChange={e => field.onChange(e.target.value === '' ? undefined : Number(e.target.value))}
                  value={field.value ?? ''} />
              )} />
              <Controller name="work" control={control} render={({ field }) => (
                <Autocomplete label={t('steps.s2.work')} placeholder={t('steps.s2.workPlaceholder')}
                  error={errors.work?.message} required suggestions={OCCUPATIONS} {...field} />
              )} />
            </div>
            <Controller name="sexual_orientation" control={control} render={({ field }) => (
              <RadioCardGroup label={t('steps.s2.orientation')} options={orientationOptions}
                value={field.value ?? ''} onChange={field.onChange}
                error={errors.sexual_orientation?.message} columns={2} />
            )} />
            <Controller name="religion" control={control} render={({ field }) => (
              <Autocomplete label={t('steps.s2.religion')} placeholder={t('steps.s2.religionPlaceholder')}
                error={errors.religion?.message} required suggestions={RELIGIONS} {...field} />
            )} />
          </div>
        </div>
      </SectionCard>

      <SectionCard>
        <Step3Vibe control={control} errors={errors} />
      </SectionCard>

      <SectionCard>
        <Step4Preferences control={control} errors={errors} />
      </SectionCard>

      {/* Final touches — same fields as the wizard's last step, minus the one-time consent */}
      <SectionCard>
        <div className="flex flex-col gap-6">
          <h2 className="text-2xl font-semibold text-primary tracking-tight">{t('steps.s5.title')}</h2>
          <Controller name="physical_affection_importance" control={control} render={({ field }) => (
            <div className="rounded-xl border border-border bg-surface p-4">
              <Slider label={t('steps.s5.affection')} value={field.value ?? 5} onChange={field.onChange}
                min={1} max={10} lowLabel={t('steps.s5.affectionLow')} highLabel={t('steps.s5.affectionHigh')}
                error={errors.physical_affection_importance?.message} />
            </div>
          )} />
          <Controller name="dream_first_date" control={control} render={({ field }) => (
            <Textarea label={t('steps.s5.firstDate')} placeholder={t('steps.s5.firstDatePlaceholder')}
              rows={4} error={errors.dream_first_date?.message} required {...field} />
          )} />
        </div>
      </SectionCard>

      {/* Floating save bar — slides up when there's something to save */}
      <div
        className={`fixed bottom-4 inset-x-4 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:w-full sm:max-w-2xl z-40 px-2 transition-all duration-300 ease-out ${
          isDirty || justSaved || saveFailed
            ? 'translate-y-0 opacity-100'
            : 'translate-y-24 opacity-0 pointer-events-none'
        }`}
      >
        <div className="bg-surface/95 backdrop-blur border border-border rounded-2xl px-5 py-3.5 shadow-raised flex items-center justify-between gap-4">
          <span className="flex items-center gap-2 text-sm text-muted min-w-0" aria-live="polite">
            {isDirty ? (
              <>
                <span className="h-2 w-2 rounded-full bg-accent animate-pulse flex-shrink-0" aria-hidden="true" />
                <span className="truncate">{t('portal.profile.unsaved')}</span>
              </>
            ) : justSaved ? (
              <span className="flex items-center gap-2 text-success">
                <CheckIcon />
                {t('portal.profile.saved')}
              </span>
            ) : null}
          </span>
          <div className="flex items-center gap-3 flex-shrink-0">
            {saveFailed && <p role="alert" className="text-sm text-error">{t('portal.profile.saveError')}</p>}
            <Button
              type="submit"
              variant="primary"
              loading={isSubmitting}
              disabled={!isDirty}
              className={`transition-all duration-200 active:scale-[0.97] ${justSaved && !isDirty ? '!bg-success !text-bg !opacity-100' : ''}`}
            >
              {justSaved && !isDirty ? (
                <span className="flex items-center gap-2"><CheckIcon />{t('portal.profile.savedButton')}</span>
              ) : (
                t('portal.profile.save')
              )}
            </Button>
          </div>
        </div>
      </div>
    </form>
  )
}

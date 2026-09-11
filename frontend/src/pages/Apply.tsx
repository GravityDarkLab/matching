import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { FormValues } from '../types/form'
import { formSchema } from '../types/form'
import { fetchQuestionnaire, submitForm } from '../api/client'
import ProgressBar from '../components/ui/ProgressBar'
import Button from '../components/ui/Button'
import LifeBackground from '../components/LifeBackground'

import Step1Identity, { FIELDS as STEP1_FIELDS } from '../steps/Step1Identity'
import Step2AboutYou, { FIELDS as STEP2_FIELDS } from '../steps/Step2AboutYou'
import Step3Vibe, { FIELDS as STEP3_FIELDS } from '../steps/Step3Vibe'
import Step4Preferences, { FIELDS as STEP4_FIELDS } from '../steps/Step4Preferences'
import Step5Final, { FIELDS as STEP5_FIELDS } from '../steps/Step5Final'

const TOTAL_STEPS = 5
const STEP_FIELDS = [STEP1_FIELDS, STEP2_FIELDS, STEP3_FIELDS, STEP4_FIELDS, STEP5_FIELDS]

export default function Apply() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.dir() === 'rtl'
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submissionKey, setSubmissionKey] = useState<string | null>(null)
  const [questionnaireVersion, setQuestionnaireVersion] = useState('1.2.0')

  // Fetch the active questionnaire on mount to obtain the HMAC submission key.
  // Without it the API will reject the submission.
  useEffect(() => {
    fetchQuestionnaire()
      .then(q => {
        setSubmissionKey(q.submissionKey)
        setQuestionnaireVersion(q.version)
      })
      .catch(() => setSubmitError(t('apply.error')))
  }, [t])

  const { control, formState: { errors }, trigger, getValues } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    mode: 'onBlur',
    defaultValues: {
      first_name: '',
      last_name: '',
      instagram_handle: '',
      location: '',
      birth_date: '',
      work: '',
      gender_identity: '',
      sexual_orientation: '',
      religion: '',
      vibe_words: '',
      lifestyle: '',
      preferred_physical_traits: '',
      preferred_character_traits: '',
      deal_breakers: '',
      dream_first_date: '',
      open_to_long_distance: false,
      okay_with_opposite_gender_friends: false,
      religion_deal_breaker: false,
      physical_affection_importance: 5,
    },
  })

  async function handleNext() {
    const valid = await trigger(STEP_FIELDS[step - 1])
    if (valid) { setStep(s => Math.min(s + 1, TOTAL_STEPS)); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  }

  function handlePrev() {
    setStep(s => Math.max(s - 1, 1))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function handleSubmit() {
    const valid = await trigger(STEP_FIELDS[step - 1])
    if (!valid) return
    setIsSubmitting(true)
    setSubmitError(null)
    try {
      const values = getValues()
      const result = await submitForm({
        questionnaireVersion: questionnaireVersion as '1.2.0',
        answers: {
          first_name: values.first_name,
          last_name: values.last_name,
          instagram_handle: values.instagram_handle,
          location: values.location,
          birth_date: values.birth_date,
          height_cm: values.height_cm,
          work: values.work,
          gender_identity: values.gender_identity,
          sexual_orientation: values.sexual_orientation,
          religion: values.religion,
          vibe_words: values.vibe_words,
          lifestyle: values.lifestyle,
          relationship_type: values.relationship_type,
          open_to_long_distance: values.open_to_long_distance,
          max_age_gap: values.max_age_gap ?? null,
          open_to_older: values.open_to_older ?? null,
          open_to_younger: values.open_to_younger ?? null,
          preferred_physical_traits: values.preferred_physical_traits,
          preferred_character_traits: values.preferred_character_traits,
          deal_breakers: values.deal_breakers,
          okay_with_opposite_gender_friends: values.okay_with_opposite_gender_friends,
          religion_deal_breaker: values.religion_deal_breaker,
          physical_affection_importance: values.physical_affection_importance,
          dream_first_date: values.dream_first_date,
          disclaimer_agreed: true as const,
        },
      }, submissionKey ?? '')
      navigate(`/success?alias=${encodeURIComponent(result.alias)}&id=${result.applicantId}`, {
        state: { magicToken: result.magicToken ?? null },
      })
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : t('apply.error'))
      setIsSubmitting(false)
    }
  }

  // Arrow SVG — flipped in RTL so it always points "forward"
  const forwardArrow = (
    <svg className="h-4 w-4" style={isRTL ? { transform: 'scaleX(-1)' } : undefined}
      xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M12 5l7 7-7 7" />
    </svg>
  )
  const backArrow = (
    <svg className="h-4 w-4" style={isRTL ? { transform: 'scaleX(-1)' } : undefined}
      xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19 12H5M12 5l-7 7 7 7" />
    </svg>
  )

  return (
    <div className="relative min-h-screen bg-bg">
      <LifeBackground fixed />
      <div className="relative z-10 mx-auto w-full max-w-form px-4 pt-8 pb-24">
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-6">
            <a href="/" className="flex items-center gap-1.5 text-sm text-muted hover:text-primary transition-colors duration-200" aria-label={t('apply.back')}>
              {backArrow}
              {t('apply.back')}
            </a>
          </div>
          <ProgressBar current={step} total={TOTAL_STEPS} />
        </div>

        <div className="bg-surface rounded-2xl border border-border shadow-sm p-6 mb-4">
          {step === 1 && <Step1Identity control={control} errors={errors} />}
          {step === 2 && <Step2AboutYou control={control} errors={errors} />}
          {step === 3 && <Step3Vibe control={control} errors={errors} />}
          {step === 4 && <Step4Preferences control={control} errors={errors} />}
          {step === 5 && <Step5Final control={control} errors={errors} />}
        </div>

        {submitError && (
          <div className="mb-4 rounded-xl bg-error-light border border-error/20 px-4 py-3">
            <p className="text-sm text-error font-medium">{submitError}</p>
          </div>
        )}

        <div className={`flex gap-3 ${step === 1 ? 'justify-end' : 'justify-between'}`}>
          {step > 1 && (
            <Button variant="secondary" onClick={handlePrev} disabled={isSubmitting} className="flex-1">
              {backArrow}
              {t('apply.back')}
            </Button>
          )}
          {step < TOTAL_STEPS ? (
            <Button variant="primary" onClick={handleNext} disabled={isSubmitting} className="flex-1">
              {t('apply.next')}
              {forwardArrow}
            </Button>
          ) : (
            <Button variant="accent" onClick={handleSubmit} loading={isSubmitting} disabled={isSubmitting} className="flex-1">
              {!isSubmitting && t('apply.submit')}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

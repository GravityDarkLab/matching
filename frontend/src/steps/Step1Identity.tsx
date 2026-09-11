import { Controller } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import type { Control, FieldErrors } from 'react-hook-form'
import type { FormValues } from '../types/form'
import Input from '../components/ui/Input'
import Autocomplete from '../components/ui/Autocomplete'
import { CITIES } from '../data/cities'

interface Props { control: Control<FormValues>; errors: FieldErrors<FormValues> }
export const FIELDS: (keyof FormValues)[] = ['first_name', 'last_name', 'instagram_handle', 'location']

export default function Step1Identity({ control, errors }: Props) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold text-primary tracking-tight">{t('steps.s1.title')}</h2>
        <p className="text-sm text-muted leading-relaxed">{t('steps.s1.subtitle')}</p>
      </div>
      <div className="flex flex-col gap-4">
        <div className="flex gap-3">
          <div className="flex-1 min-w-0">
            <Controller
              name="first_name"
              control={control}
              render={({ field }) => (
                <Input label={t('steps.s1.firstName')} placeholder={t('steps.s1.firstNamePlaceholder')}
                  error={errors.first_name?.message} required {...field} />
              )}
            />
          </div>
          <div className="flex-1 min-w-0">
            <Controller
              name="last_name"
              control={control}
              render={({ field }) => (
                <Input label={t('steps.s1.lastName')} placeholder={t('steps.s1.lastNamePlaceholder')}
                  error={errors.last_name?.message} required {...field} />
              )}
            />
          </div>
        </div>
        <Controller
          name="instagram_handle"
          control={control}
          render={({ field }) => (
            <Input label={t('steps.s1.instagram')} prefix="@" placeholder="yourhandle"
              error={errors.instagram_handle?.message} required {...field} />
          )}
        />
        <Controller
          name="location"
          control={control}
          render={({ field }) => (
            <Autocomplete label={t('steps.s1.location')} placeholder={t('steps.s1.locationPlaceholder')}
              error={errors.location?.message} required suggestions={CITIES} {...field} />
          )}
        />
      </div>
      <div className="flex items-start gap-3 rounded-xl bg-accent-light border border-accent/20 px-4 py-3.5">
        <svg className="h-4 w-4 text-accent flex-shrink-0 mt-0.5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        <p className="text-xs text-accent leading-relaxed">{t('steps.s1.privacy')}</p>
      </div>
    </div>
  )
}

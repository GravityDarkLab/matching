import { useTranslation } from 'react-i18next'

export function countWords(value: string | undefined): number {
  return (value ?? '').trim().split(/\s+/).filter(Boolean).length
}

export default function WordCountHint({ value }: { value: string | undefined }) {
  const { t } = useTranslation()
  const words = countWords(value)
  return (
    <div className="flex justify-between items-center pe-0.5">
      {words > 0 && words < 5 ? (
        <p className="text-xs text-muted">{t('steps.writeMoreHint')}</p>
      ) : (
        <span />
      )}
      <span className="text-xs text-muted ms-auto">
        {t('steps.wordCount', { count: words })}
      </span>
    </div>
  )
}

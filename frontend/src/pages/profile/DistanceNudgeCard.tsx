import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { acknowledgeDistanceNudge } from '../../api/profile.client'
import { useToast } from '../../components/ui/Toast'

interface Props {
  matchId: string
  onDismissed: () => void
}

export default function DistanceNudgeCard({ matchId, onDismissed }: Props) {
  const { t } = useTranslation()
  const { error: toastError } = useToast()
  const [loading, setLoading] = useState(false)

  async function respond(openUp: boolean) {
    setLoading(true)
    try {
      await acknowledgeDistanceNudge(matchId, openUp)
      onDismissed()
    } catch (err) {
      toastError(err instanceof Error ? err.message : t('portal.dashboard.distanceNudge.ackFailed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-accent-light border border-accent/20 rounded-2xl p-5">
      <p className="text-base font-medium text-primary">{t('portal.dashboard.distanceNudge.title')}</p>
      <p className="text-sm text-muted mt-1">{t('portal.dashboard.distanceNudge.body')}</p>
      <div className="flex gap-3 mt-3">
        <button
          onClick={() => void respond(true)}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 bg-accent text-bg rounded-full px-4 py-2 text-sm font-medium transition-all duration-200 hover:opacity-90 disabled:opacity-50"
        >
          {t('portal.dashboard.distanceNudge.yes')}
        </button>
        <button
          onClick={() => void respond(false)}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 bg-surface border border-border text-muted rounded-xl px-4 py-2 text-sm font-medium transition-all duration-200 hover:bg-bg disabled:opacity-50"
        >
          {t('portal.dashboard.distanceNudge.no')}
        </button>
      </div>
    </div>
  )
}

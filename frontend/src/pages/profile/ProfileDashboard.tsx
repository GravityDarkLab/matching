import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ProfileView, MatchView, ApplicantStatus } from '../../api/profile.client'
import { getMyProfile, getMyMatches } from '../../api/profile.client'
import MatchList from './MatchList'
import { useTranslation } from 'react-i18next'
import EditProfileForm from './EditProfileForm'
import DistanceNudgeCard from './DistanceNudgeCard'
import ProfileSettingsDrawer from './ProfileSettingsDrawer'
import DeletionCountdown from './DeletionCountdown'
import Badge from '../../components/ui/Badge'
import EmptyState from '../../components/ui/EmptyState'
import Skeleton from '../../components/ui/Skeleton'
import Slider from '../../components/ui/Slider'
import ThemeToggle from '../../theme/ThemeToggle'
import LanguageSwitcher from '../../components/LanguageSwitcher'
import { applicantStatusTone } from '../../components/ui/statusTones'

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: ApplicantStatus | undefined }) {
  if (!status) return null
  return (
    <Badge tone={applicantStatusTone(status)} size="sm">
      {status}
    </Badge>
  )
}

type PortalTab = 'matches' | 'profile'

function TabBar({ tab, onChange }: { tab: PortalTab; onChange: (t: PortalTab) => void }) {
  const { t } = useTranslation()
  const tabs: { value: PortalTab; label: string }[] = [
    { value: 'matches', label: t('portal.profile.tabMatches') },
    { value: 'profile', label: t('portal.profile.tabProfile') },
  ]
  return (
    <div role="tablist" className="flex gap-2">
      {tabs.map(item => (
        <button
          key={item.value}
          role="tab"
          aria-selected={tab === item.value}
          onClick={() => onChange(item.value)}
          className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
            tab === item.value
              ? 'bg-accent text-bg'
              : 'bg-surface border border-border text-muted hover:text-primary hover:border-accent/40'
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ProfileDashboard() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const [profile, setProfile] = useState<ProfileView | null>(null)
  const [matches, setMatches] = useState<MatchView[]>([])
  const [threshold, setThreshold] = useState<number>(0.8)
  const [tab, setTab] = useState<PortalTab>('matches')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      // Fetch at the server's minimum threshold so the slider can reveal
      // lower-scored matches client-side without refetching
      const [prof, matchList] = await Promise.all([
        getMyProfile(),
        getMyMatches(0.6, 50),
      ])
      setProfile(prof)
      setThreshold(prof.scoreThreshold ?? 0.8)
      setMatches(matchList)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('portal.dashboard.loadError')
      if (message === 'Session expired') {
        navigate('/profile/login', { replace: true })
        return
      }
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [navigate])

  useEffect(() => {
    void load()
  }, [load])

  // Only undecided proposals are score-filtered — an active contact or dating
  // match stays visible regardless of where the slider sits
  const visibleMatches = matches.filter(m => (m.status === 'proposed' ? m.score >= threshold : true))
  const hasProposed = matches.some(m => m.status === 'proposed')

  // ── Loading / error states ────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-bg px-6 pt-20">
        <div className="max-w-2xl mx-auto space-y-4">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-28 w-full rounded-2xl" />
          <Skeleton className="h-28 w-full rounded-2xl" />
          <span className="sr-only">{t('portal.dashboard.loading')}</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <p className="text-sm text-muted">{error}</p>
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-bg">
      {/* Status bar */}
      <header className="h-14 flex items-center justify-between px-6 bg-surface border-b border-border">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-primary">Ons</span>
          <div className="flex flex-col leading-tight">
            <span className="text-sm text-primary">{profile?.fullName ?? profile?.alias}</span>
            {profile?.fullName && <span className="text-xs text-muted">{profile.alias}</span>}
          </div>
          <StatusBadge status={profile?.status} />
        </div>
        <div className="flex items-center gap-1.5">
        <LanguageSwitcher />
        <ThemeToggle />
        <button
          onClick={() => setDrawerOpen(true)}
          className="p-2 rounded-xl text-muted hover:text-primary hover:bg-bg transition-colors"
          aria-label={t('portal.dashboard.openSettings')}
        >
          {/* Settings gear icon */}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-5 w-5"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
        </div>
      </header>

      {/* Status-aware content */}
      <main>
        {profile?.distanceNudge && profile.status !== 'inactive' && (
          <div className="max-w-2xl mx-auto px-6 pt-6">
            <DistanceNudgeCard
              matchId={profile.distanceNudge.matchId}
              onDismissed={() => void load()}
            />
          </div>
        )}

        {/* Matches | My profile tabs — inactive accounts keep the dormant screen */}
        {profile && profile.status !== 'inactive' && (
          <div className="max-w-2xl mx-auto px-6 pt-6">
            <TabBar tab={tab} onChange={setTab} />
          </div>
        )}

        {tab === 'profile' && profile && profile.status !== 'inactive' && (
          <div className="max-w-2xl mx-auto px-6 py-6">
            <EditProfileForm />
          </div>
        )}

        {tab === 'matches' && profile?.status === 'applied' && (
          <div className="max-w-lg mx-auto px-6 py-12 text-center space-y-6">
            <div className="bg-surface border border-border rounded-2xl p-8 shadow-sm">
              <h2 className="text-xl font-semibold text-primary mb-2">
                {t('portal.dashboard.hello', { alias: profile.fullName ?? profile.alias })}
              </h2>
              <p className="text-muted text-sm mb-6">
                {t('portal.dashboard.findingMatches')}
              </p>
              <div className="flex items-center justify-center gap-3 text-xs text-muted">
                <span className="bg-accent-light text-accent-ink rounded-full px-2.5 py-1">
                  {t('portal.dashboard.threshold', { percent: Math.round((profile.scoreThreshold ?? 0.8) * 100) })}
                </span>
                <span>·</span>
                <span>{t('portal.dashboard.submitted', { date: new Date(profile.createdAt).toLocaleDateString() })}</span>
              </div>
            </div>
          </div>
        )}

        {tab === 'matches' && profile?.status === 'matched' && (
          <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
            {matches.length === 0 ? (
              // Nothing live for this applicant (e.g. after passing on a
              // contact) — fresh matches arrive with the next matching phase
              <div className="bg-surface border border-border rounded-2xl shadow-card">
                <EmptyState
                  title={t('portal.dashboard.nextPhaseTitle')}
                  description={t('portal.dashboard.nextPhaseBody')}
                />
              </div>
            ) : (
              <>
                {hasProposed && (
                  <div className="bg-surface border border-border rounded-2xl p-5 shadow-card">
                    <Slider
                      label={t('portal.dashboard.minScore')}
                      value={Math.round(threshold * 100)}
                      onChange={pct => setThreshold(pct / 100)}
                      min={60}
                      max={100}
                      step={5}
                      lowLabel="60%"
                      highLabel="100%"
                      formatValue={v => `${v}%`}
                    />
                  </div>
                )}
                {visibleMatches.length === 0 ? (
                  <div className="bg-surface border border-border rounded-2xl shadow-card">
                    <EmptyState
                      title={t('portal.dashboard.noneAtThresholdTitle')}
                      description={t('portal.dashboard.noneAtThresholdBody')}
                    />
                  </div>
                ) : (
                  <MatchList matches={visibleMatches} onMatchesChange={setMatches} />
                )}
              </>
            )}
          </div>
        )}

        {tab === 'matches' && profile?.status === 'dating' && (
          <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
            <MatchList
              matches={matches.filter(
                m => m.status === 'dating' || m.status === 'in_progress',
              )}
              onMatchesChange={setMatches}
            />
          </div>
        )}

        {profile?.status === 'inactive' && (
          <div className="max-w-lg mx-auto px-6 py-12 space-y-6">
            <div className="bg-surface border border-border rounded-2xl p-8 shadow-sm space-y-4 text-center">
              <h2 className="text-xl font-semibold text-primary">{t('portal.dashboard.dormantTitle')}</h2>
              <p className="text-sm text-muted">{t('portal.dashboard.dormantBody')}</p>
            </div>

            {profile.deletionScheduledAt && (
              <DeletionCountdown
                deletionScheduledAt={profile.deletionScheduledAt}
                onCancelled={() => void load()}
              />
            )}
          </div>
        )}
      </main>

      {/* Settings drawer */}
      {drawerOpen && (
        <ProfileSettingsDrawer onClose={() => setDrawerOpen(false)} applicantStatus={profile?.status} />
      )}
    </div>
  )
}

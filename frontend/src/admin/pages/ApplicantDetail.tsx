import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { fetchApplicant, fetchIdentity, deactivateApplicant, regenerateMagicLink, fetchMatches } from '../api/client'
import Button from '../../components/ui/Button'
import Badge from '../../components/ui/Badge'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import Skeleton from '../../components/ui/Skeleton'
import { useToast } from '../../components/ui/Toast'
import { applicantStatusTone, matchStatusTone } from '../../components/ui/statusTones'
import { useOptionalAuth } from '../context/AuthContext'
import type { Applicant, ApplicantStatus, Match } from '../types'

// ── Icons ──────────────────────────────────────────────────────────────────────

function LockIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor"
      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="9" width="12" height="10" rx="2" />
      <path d="M7 9V6a3 3 0 0 1 6 0v3" />
    </svg>
  )
}

function ChevronLeftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 3L5 8l5 5" />
    </svg>
  )
}

// ── Status stepper ─────────────────────────────────────────────────────────────

const STEPS: ApplicantStatus[] = ['applied', 'matched', 'dating', 'inactive']

function StatusStepper({ status }: { status: ApplicantStatus }) {
  const { t } = useTranslation()
  // Map status to step index
  const currentIdx = STEPS.indexOf(status)

  return (
    <div className="flex items-center gap-0">
      {STEPS.map((step, idx) => {
        const isCompleted = idx < currentIdx
        const isCurrent   = idx === currentIdx

        let circleClass: string
        let labelClass: string
        if (isCompleted) {
          circleClass = 'bg-success text-bg'
          labelClass  = 'text-success'
        } else if (isCurrent) {
          circleClass = 'bg-accent text-bg'
          labelClass  = 'text-accent font-medium'
        } else {
          circleClass = 'border-2 border-border text-muted bg-surface'
          labelClass  = 'text-muted'
        }

        return (
          <div key={step} className="flex items-center">
            <div className="flex flex-col items-center gap-1.5">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold ${circleClass}`}>
                {isCompleted ? (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M2 6l3 3 5-5" />
                  </svg>
                ) : (
                  <span>{idx + 1}</span>
                )}
              </div>
              <span className={`text-xs whitespace-nowrap ${labelClass}`}>
                {t(`admin.applicants.${step}`)}
              </span>
            </div>
            {idx < STEPS.length - 1 && (
              <div className={`h-0.5 w-8 mx-1 mb-5 rounded-full ${idx < currentIdx ? 'bg-success' : 'bg-border'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Identity card ──────────────────────────────────────────────────────────────

interface RevealedIdentity {
  instagramHandle: string
  fullName: string | null
}

interface IdentityCardProps {
  id: string
  identity: RevealedIdentity | null
  setIdentity: (v: RevealedIdentity) => void
}

function IdentityCard({ id, identity, setIdentity }: IdentityCardProps) {
  const { t } = useTranslation()
  const auth = useOptionalAuth()
  const role = auth?.role ?? null

  const [revealLoading, setRevealLoading] = useState(false)
  const [error, setError]                 = useState('')

  async function handleReveal() {
    setRevealLoading(true); setError('')
    try {
      const res = await fetchIdentity(id)
      setIdentity(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.detail.auditNote'))
    } finally {
      setRevealLoading(false)
    }
  }

  // super_admin or no auth context (fallback for tests / unauthenticated views)
  if (role !== 'admin') {
    return (
      <div>
        <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">
          {t('admin.detail.identity')}
        </p>
        {identity ? (
          <div className="bg-warning-light border border-warning/30 rounded-xl p-4">
            {identity.fullName && <p className="text-sm font-medium text-primary">{identity.fullName}</p>}
            <p className="font-mono text-sm text-warning">{identity.instagramHandle}</p>
            <p className="text-xs text-muted mt-1.5">{t('admin.detail.auditNote')}</p>
          </div>
        ) : (
          <div className="bg-accent-light border border-accent/20 rounded-xl p-4 space-y-3">
            {error && <p className="text-sm text-error">{error}</p>}
            <Button variant="secondary" onClick={handleReveal} loading={revealLoading}>
              {t('admin.detail.reveal')}
            </Button>
            <p className="text-xs text-muted">{t('admin.detail.auditNote')}</p>
          </div>
        )}
      </div>
    )
  }

  // role === 'admin' — show locked card
  return (
    <div>
      <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">
        {t('admin.detail.identity')}
      </p>
      <div
        style={{ backgroundColor: 'var(--t-surface-subtle)' }}
        className="border border-border rounded-xl p-4 flex items-center gap-3 text-muted"
      >
        <LockIcon />
        <span className="text-sm">{t('admin.detail.superAdminRequired')}</span>
      </div>
    </div>
  )
}

// ── Magic link regeneration ──────────────────────────────────────────────────

function MagicLinkCard({ id }: { id: string }) {
  const { t } = useTranslation()
  const auth = useOptionalAuth()
  const role = auth?.role ?? null

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState('')
  const [link, setLink]               = useState<string | null>(null)
  const [copied, setCopied]           = useState(false)

  async function handleRegenerate() {
    setLoading(true); setError('')
    try {
      const { magicToken } = await regenerateMagicLink(id)
      const origin = typeof window !== 'undefined' ? window.location.origin : ''
      setLink(`${origin}/profile/login?token=${magicToken}`)
      setConfirmOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : '')
    } finally {
      setLoading(false)
    }
  }

  async function handleCopy() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard access denied — non-critical
    }
  }

  // super_admin or no auth context (fallback for tests / unauthenticated views)
  if (role === 'admin') {
    return (
      <div>
        <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">
          {t('admin.detail.magicLink')}
        </p>
        <div
          style={{ backgroundColor: 'var(--t-surface-subtle)' }}
          className="border border-border rounded-xl p-4 flex items-center gap-3 text-muted"
        >
          <LockIcon />
          <span className="text-sm">{t('admin.detail.superAdminRequired')}</span>
        </div>
      </div>
    )
  }

  return (
    <div>
      <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">
        {t('admin.detail.magicLink')}
      </p>

      {error && <p className="text-sm text-error mb-2">{error}</p>}

      {link ? (
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface-subtle p-3">
          <p className="text-xs text-muted">{t('admin.detail.newMagicLinkHint')}</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 select-all break-all rounded-lg bg-surface px-3 py-2 font-mono text-xs text-primary">
              {link}
            </code>
            <button
              type="button"
              onClick={handleCopy}
              className="shrink-0 rounded-lg border border-border px-3 py-2 text-xs font-medium text-primary hover:bg-surface transition-colors"
            >
              {copied ? t('admin.detail.copied') : t('admin.detail.copy')}
            </button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" onClick={() => setConfirmOpen(true)} loading={loading}>
          {t('admin.detail.regenerateMagicLink')}
        </Button>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title={t('admin.detail.regenerateMagicLink')}
        description={t('admin.detail.regenerateMagicLinkConfirm')}
        confirmLabel={t('admin.detail.regenerateMagicLink')}
        cancelLabel={t('admin.matching.cancel')}
        tone="danger"
        loading={loading}
        onConfirm={handleRegenerate}
        onClose={() => setConfirmOpen(false)}
      />
    </div>
  )
}

// ── Match history ──────────────────────────────────────────────────────────────

interface MatchHistoryProps {
  matches: Match[]
  applicantId: string
}

function MatchHistory({ matches, applicantId }: MatchHistoryProps) {
  const { t } = useTranslation()

  if (matches.length === 0) {
    return (
      <p className="text-sm text-muted">{t('admin.dashboard.noMatchesYet')}</p>
    )
  }

  return (
    <div className="space-y-3">
      {matches.map(m => {
        const isA          = m.applicantAId === applicantId
        const ownAlias     = isA ? m.applicantAAlias : m.applicantBAlias
        const partnerId    = isA ? m.applicantBId    : m.applicantAId
        const partnerAlias = isA ? m.applicantBAlias : m.applicantAAlias
        const scorePercent = Math.round(m.score * 100)

        return (
          <div key={m.id} className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-sm font-mono text-primary">
                <span className="text-muted shrink-0">{ownAlias}</span>
                <span className="text-muted shrink-0">↔</span>
                <Link
                  to={`/admin/applicants/${partnerId}`}
                  className="text-accent hover:underline truncate"
                >
                  {partnerAlias}
                </Link>
              </div>
              <div className="flex items-center gap-2 mt-1.5">
                <div className="bg-border rounded-full h-1.5 w-24">
                  <div
                    style={{ width: `${scorePercent}%` }}
                    className="h-1.5 bg-accent rounded-full"
                  />
                </div>
                <span className="text-xs text-muted shrink-0">{scorePercent}%</span>
              </div>
            </div>
            <div className="shrink-0">
              <Badge tone={matchStatusTone(m.status)} size="sm">
                {t(`admin.matches.${m.status}`)}
              </Badge>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function ApplicantDetail() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.dir() === 'rtl'
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { success } = useToast()

  const [applicant, setApplicant]             = useState<Applicant | null>(null)
  const [identity, setIdentity]               = useState<RevealedIdentity | null>(null)
  const [withdrawLoading, setWithdrawLoading] = useState(false)
  const [confirmWithdraw, setConfirmWithdraw] = useState(false)
  const [error, setError]                     = useState('')
  const [matches, setMatches]                 = useState<Match[]>([])

  useEffect(() => {
    if (!id) return
    setIdentity(null)
    setApplicant(null)
    setMatches([])
    fetchApplicant(id).then(setApplicant)
    fetchMatches(1, 10, undefined, id).then(res => setMatches(res.data))
  }, [id])

  async function handleWithdraw() {
    if (!id) return
    setWithdrawLoading(true); setError('')
    try {
      await deactivateApplicant(id)
      success(t('admin.detail.withdrawn'))
      navigate('/admin/applicants')
    } catch (err) {
      setError(err instanceof Error ? err.message : '')
      setWithdrawLoading(false)
      setConfirmWithdraw(false)
    }
  }

  if (!applicant) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 rounded-2xl w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        to="/admin/applicants"
        className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-primary transition-colors"
      >
        <span style={isRTL ? { transform: 'scaleX(-1)', display: 'inline-block' } : undefined}>
          <ChevronLeftIcon />
        </span>
        {t('admin.detail.back')}
      </Link>

      {error && <p className="text-sm text-error">{error}</p>}

      {/* Two-column layout */}
      <div className="flex flex-col lg:flex-row gap-6">

        {/* LEFT: Profile info card */}
        <div className="lg:w-80 shrink-0">
          <div className="bg-surface border border-border rounded-2xl p-6 shadow-card space-y-5">
            {/* Alias + status */}
            <div>
              <h1 className="text-2xl font-semibold text-primary tracking-tight font-mono">
                {applicant.alias}
              </h1>
              <div className="mt-2 flex items-center gap-2">
                <Badge tone={applicantStatusTone(applicant.status)}>
                  {t(`admin.applicants.${applicant.status}`)}
                </Badge>
              </div>
            </div>

            {/* Metadata */}
            <dl className="space-y-2.5 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted">{t('admin.detail.submitted', { date: '' }).replace(':', '').trim()}</dt>
                <dd className="text-primary text-right">
                  {new Date(applicant.createdAt).toLocaleDateString()}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">{t('admin.detail.version')}</dt>
                <dd className="text-primary font-mono text-right">{applicant.questionnaireVersion}</dd>
              </div>
              {applicant.submissionIp && (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">{t('admin.detail.submissionIp')}</dt>
                  <dd className="text-primary font-mono text-right text-xs">{applicant.submissionIp}</dd>
                </div>
              )}
            </dl>

            {/* Divider */}
            <div className="border-t border-border" />

            {/* Identity reveal section */}
            <IdentityCard
              id={id!}
              identity={identity}
              setIdentity={setIdentity}
            />

            {/* Divider */}
            <div className="border-t border-border" />

            {/* Magic link regeneration */}
            <MagicLinkCard id={id!} />

            {/* Divider */}
            <div className="border-t border-border" />

            {/* Answers */}
            <div>
              <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">
                {t('admin.detail.answers')}
              </p>
              <div className="space-y-2.5">
                {Object.entries(applicant.answers).map(([key, value]) => (
                  <div key={key} className="flex justify-between gap-3 text-sm">
                    <span className="text-muted capitalize">{key.replace(/_/g, ' ')}</span>
                    <span className="text-primary text-right break-words max-w-[60%]">
                      {typeof value === 'boolean' ? (value ? t('common.yes') : t('common.no')) : String(value ?? '—')}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Withdraw action */}
            {applicant.status !== 'inactive' && (
              <>
                <div className="border-t border-border" />
                <Button variant="secondary" onClick={() => setConfirmWithdraw(true)} loading={withdrawLoading} className="w-full">
                  {t('admin.detail.withdraw')}
                </Button>
                <ConfirmDialog
                  open={confirmWithdraw}
                  title={t('admin.detail.withdraw')}
                  description={t('admin.detail.withdrawConfirm')}
                  confirmLabel={t('admin.detail.withdraw')}
                  cancelLabel={t('admin.matching.cancel')}
                  tone="danger"
                  loading={withdrawLoading}
                  onConfirm={handleWithdraw}
                  onClose={() => setConfirmWithdraw(false)}
                />
              </>
            )}
          </div>
        </div>

        {/* RIGHT: Match history + status stepper */}
        <div className="flex-1 space-y-5">
          {/* Status stepper card */}
          <div className="bg-surface border border-border rounded-2xl p-6 shadow-card">
            <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-4">
              {t('admin.detail.status')}
            </p>
            <StatusStepper status={applicant.status} />
          </div>

          {/* Match history card — only rendered when there are matches */}
          {matches.length > 0 && (
            <div className="bg-surface border border-border rounded-2xl p-6 shadow-card">
              <div className="flex items-center justify-between mb-4">
                <p className="text-xs font-semibold text-muted uppercase tracking-wider">
                  {t('admin.detail.matches')}
                </p>
                <Link
                  to={`/admin/matches?participantId=${id}`}
                  className="text-xs text-accent hover:underline"
                >
                  {t('admin.detail.viewAllMatches')}
                </Link>
              </div>
              <MatchHistory matches={matches} applicantId={id!} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

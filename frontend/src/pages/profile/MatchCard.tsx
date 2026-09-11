import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Badge from '../../components/ui/Badge'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import Spinner from '../../components/ui/Spinner'
import { matchStatusTone } from '../../components/ui/statusTones'
import { useTimeAgo } from '../../lib/timeAgo'
import { getBreakdownEntry } from './matchBreakdownLabels'
import { PartnerProfileView } from './PartnerProfileView'
import type { MatchView, ContactResult } from '../../api/profile.client'
import {
  daysSince,
  CANCEL_ELIGIBLE_DAYS,
  OUTCOME_ELIGIBLE_DAYS,
  CHECK_IN_MESSAGE_KEYS,
  OUTCOME_FEEDBACK_TAGS,
  type OutcomeFeedbackTag,
} from './datingTimeline'

// ── Props ─────────────────────────────────────────────────────────────────────

interface MatchCardProps {
  match: MatchView
  onContactRequest?: (matchId: string) => Promise<ContactResult>
  onRespond?: (matchId: string, accept: boolean) => Promise<void>
  onWithdraw?: (matchId: string) => Promise<void>
  onOutcome?: (
    matchId: string,
    outcome: 'success' | 'failed',
    options?: { feedback?: { tags: string[]; note?: string }; continuation?: 'continue' | 'break' },
  ) => Promise<void>
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ScoreBar({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="bg-border rounded-full h-1.5 w-32">
        <div
          className="bg-accent rounded-full h-1.5"
          style={{ width: `${score * 100}%` }}
        />
      </div>
      <span className="text-sm text-muted">{Math.round(score * 100)}%</span>
    </div>
  )
}

/** A short, italicized pull-quote of the LLM rerank stage's reasoning for this match. */
function MatchReasonQuote({ reasoning }: { reasoning: string }) {
  const { t } = useTranslation()
  return (
    <div className="mt-3 bg-accent-light rounded-xl px-4 py-3">
      <p className="text-[11px] font-medium text-accent-ink uppercase tracking-wider mb-1">
        {t('portal.matches.whyThisMatch')}
      </p>
      <p className="font-display italic text-sm text-primary leading-relaxed">
        “{reasoning}”
      </p>
    </div>
  )
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`h-4 w-4 text-muted shrink-0 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

/**
 * Card header row. When `hasDetails` is true the whole row becomes a toggle
 * button (with a chevron) for the partner profile + score breakdown;
 * otherwise it's a static row.
 */
function ExpandableHeader({
  expanded,
  onToggle,
  hasDetails,
  left,
  right,
}: {
  expanded: boolean
  onToggle: () => void
  hasDetails: boolean
  left: React.ReactNode
  right: React.ReactNode
}) {
  const content = (
    <>
      {left}
      <div className="flex items-center gap-2">
        {right}
        {hasDetails && <ChevronIcon expanded={expanded} />}
      </div>
    </>
  )

  if (!hasDetails) {
    return <div className="flex items-center justify-between gap-3">{content}</div>
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className="flex items-center justify-between gap-3 w-full text-left"
    >
      {content}
    </button>
  )
}

function MatchBreakdown({ breakdown }: { breakdown: Record<string, number> }) {
  const { t } = useTranslation()
  const entries = Object.entries(breakdown)
    .map(([key, value]) => ({ key, value, ...getBreakdownEntry(t, key) }))
    .sort((a, b) => b.value - a.value)

  return (
    <div className="mt-4 pt-4 border-t border-border">
      <p className="text-xs font-medium text-muted uppercase tracking-wider mb-3">
        {t('portal.matches.scoreBreakdown')}
      </p>
      <div className="space-y-3">
        {entries.map(({ key, value, label, description }) => (
          <div key={key}>
            <p className="text-sm font-medium text-primary mb-1">{label}</p>
            <ScoreBar score={value} />
            {description && <p className="text-xs text-muted mt-1">{description}</p>}
          </div>
        ))}
      </div>
    </div>
  )
}

function InstagramLink({ handle }: { handle: string }) {
  const { t } = useTranslation()
  return (
    <a
      href={`https://www.instagram.com/${handle}/`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t('portal.matches.viewOnInstagram', { handle })}
      className="text-accent font-medium text-sm mt-1 hover:underline inline-flex items-center gap-1"
    >
      @{handle}
    </a>
  )
}

function IceBreakersSection({ iceBreakers, dateIdeas }: { iceBreakers?: string[]; dateIdeas?: string[] }) {
  const { t } = useTranslation()
  if (!iceBreakers?.length && !dateIdeas?.length) return null
  return (
    <>
      {iceBreakers && iceBreakers.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-medium text-muted uppercase tracking-wider mb-2">
            {t('portal.matches.iceBreakers')}
          </p>
          <ul className="space-y-1">
            {iceBreakers.map((item, i) => (
              <li key={i} className="text-sm text-primary flex gap-2">
                <span className="text-muted shrink-0">•</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {dateIdeas && dateIdeas.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-medium text-muted uppercase tracking-wider mb-2">
            {t('portal.matches.dateIdeas')}
          </p>
          <ul className="space-y-1">
            {dateIdeas.map((item, i) => (
              <li key={i} className="text-sm text-primary flex gap-2">
                <span className="text-muted shrink-0">•</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function MatchCard({ match, onContactRequest, onRespond, onWithdraw, onOutcome }: MatchCardProps) {
  const { t } = useTranslation()
  const timeAgo = useTimeAgo()
  const [displayMatch, setDisplayMatch] = useState<MatchView>(match)
  const [loadingContact, setLoadingContact] = useState(false)
  // Contact has succeeded server-side (identity revealed, other matches
  // released) but the user hasn't confirmed/passed in the dialog yet
  const [pendingContact, setPendingContact] = useState<ContactResult | null>(null)
  const [withdrawing, setWithdrawing] = useState(false)
  const [loadingAccept, setLoadingAccept] = useState(false)
  const [loadingDecline, setLoadingDecline] = useState(false)
  const [actionError, setActionError] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [outcomePhase, setOutcomePhase] = useState<'idle' | 'feedback' | 'choice' | 'done'>('idle')
  const [pendingOutcome, setPendingOutcome] = useState<'success' | 'failed' | null>(null)
  // "It worked" is irreversible (retires both profiles) — never submit it on a single click
  const [confirmingSuccess, setConfirmingSuccess] = useState(false)
  const [selectedTags, setSelectedTags] = useState<OutcomeFeedbackTag[]>([])
  const [feedbackNote, setFeedbackNote] = useState('')
  const [submittingOutcome, setSubmittingOutcome] = useState(false)
  // Re-rolled once per mount (i.e. per page load), stable for the rest of the session
  const [checkInMessageKey] = useState(
    () => CHECK_IN_MESSAGE_KEYS[Math.floor(Math.random() * CHECK_IN_MESSAGE_KEYS.length)],
  )

  function failAction(err: unknown) {
    setActionError(err instanceof Error ? err.message : t('portal.matches.genericError'))
  }

  const { matchId, partnerAlias, score, status, perspective, contactRequestedAt, breakdown, llmReasoning, partnerProfile, partnerInstagram } = displayMatch
  const reasonQuote = llmReasoning ? <MatchReasonQuote reasoning={llmReasoning} /> : null
  const hasBreakdown = !!breakdown && Object.keys(breakdown).length > 0
  const hasProfile = !!partnerProfile && Object.keys(partnerProfile).length > 0
  const hasDetails = hasBreakdown || hasProfile
  const toggleExpanded = () => setExpanded(prev => !prev)
  // Mutual reveal: partnerInstagram is only ever populated once status is
  // "dating" — never shown at in_progress, even defensively.
  const partnerHandle = status === 'dating' ? partnerInstagram : undefined

  // Partner profile first (who they are), then the score breakdown (why this score)
  const detailsSection = expanded ? (
    <>
      {hasProfile && (
        <PartnerProfileView
          profile={partnerProfile!}
          alias={partnerAlias}
          matchId={matchId}
        />
      )}
      {hasBreakdown && <MatchBreakdown breakdown={breakdown!} />}
    </>
  ) : null

  // ── Case 5: Terminal statuses ──────────────────────────────────────────────
  if (status === 'declined' || status === 'failed' || status === 'success' || status === 'expired') {
    // Terminal cards are visually quieter than active ones: subtle bg, no lift
    return (
      <div className="bg-surface-subtle border border-border rounded-2xl p-5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-base font-medium text-muted">{partnerAlias}</span>
          <Badge tone={matchStatusTone(status)} size="sm">
            {t(`portal.matches.status.${status}`)}
          </Badge>
        </div>
      </div>
    )
  }

  // ── Case 3: in_progress + target ──────────────────────────────────────────
  if (status === 'in_progress' && perspective === 'target') {
    const handleRespond = async (accept: boolean) => {
      if (!onRespond) return
      if (accept) setLoadingAccept(true)
      else setLoadingDecline(true)
      setActionError('')
      try {
        await onRespond(matchId, accept)
        setDisplayMatch(prev => ({
          ...prev,
          status: accept ? 'dating' : 'declined',
        }))
      } catch (err) {
        failAction(err)
      } finally {
        if (accept) setLoadingAccept(false)
        else setLoadingDecline(false)
      }
    }

    return (
      <div className="bg-surface border border-border rounded-2xl p-5 shadow-card hover-card transition-card">
        <ExpandableHeader
          expanded={expanded}
          onToggle={toggleExpanded}
          hasDetails={hasDetails}
          left={
            <span className="text-base font-medium text-primary">
              {t('portal.matches.wantsToMeet', { alias: partnerAlias })}
            </span>
          }
          right={<ScoreBar score={score} />}
        />
        {reasonQuote}
        {contactRequestedAt && (
          <p className="text-sm text-muted mt-0.5">
            {t('portal.matches.requested', { time: timeAgo(new Date(contactRequestedAt).getTime()) })}
          </p>
        )}
        {detailsSection}
        <div className="flex gap-3 mt-4">
          <button
            onClick={() => handleRespond(true)}
            disabled={loadingAccept || loadingDecline}
            className="flex-1 inline-flex items-center justify-center gap-2 bg-accent text-bg rounded-full px-4 py-2.5 text-sm font-medium transition-all duration-200 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loadingAccept ? (
              <Spinner />
            ) : null}
            {t('portal.matches.accept')}
          </button>
          <button
            onClick={() => handleRespond(false)}
            disabled={loadingAccept || loadingDecline}
            className="flex-1 inline-flex items-center justify-center gap-2 bg-surface border border-border text-muted rounded-xl px-4 py-2.5 text-sm font-medium transition-all duration-200 hover:bg-bg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loadingDecline ? (
              <Spinner />
            ) : null}
            {t('portal.matches.decline')}
          </button>
        </div>
        {actionError && <p role="alert" className="text-sm text-error mt-3">{actionError}</p>}
      </div>
    )
  }

  // ── Case 2: in_progress + initiator ──────────────────────────────────────
  if (status === 'in_progress' && perspective === 'initiator') {
    return (
      <div className="bg-surface border border-border rounded-2xl p-5 shadow-card hover-card transition-card">
        <ExpandableHeader
          expanded={expanded}
          onToggle={toggleExpanded}
          hasDetails={hasDetails}
          left={<span className="text-base font-medium text-primary">{partnerAlias}</span>}
          right={<Badge tone="warning" size="sm">{t('portal.matches.waiting')}</Badge>}
        />
        {reasonQuote}
        <IceBreakersSection
          iceBreakers={displayMatch.iceBreakers}
          dateIdeas={displayMatch.dateIdeas}
        />
        {detailsSection}
      </div>
    )
  }

  // ── Case 4: dating ────────────────────────────────────────────────────────
  if (status === 'dating') {
    const elapsedDays = displayMatch.datingStartedAt ? daysSince(displayMatch.datingStartedAt) : 0
    const cancelUnlocked = elapsedDays >= CANCEL_ELIGIBLE_DAYS
    const outcomeUnlocked = elapsedDays >= OUTCOME_ELIGIBLE_DAYS

    function toggleTag(tag: OutcomeFeedbackTag) {
      setSelectedTags(prev => (prev.includes(tag) ? prev.filter(t2 => t2 !== tag) : [...prev, tag]))
    }

    function buildFeedback(): { tags: string[]; note?: string } | undefined {
      if (selectedTags.length === 0 && !feedbackNote.trim()) return undefined
      return { tags: selectedTags, note: feedbackNote.trim() || undefined }
    }

    async function submitOutcome(outcome: 'success' | 'failed', continuation?: 'continue' | 'break') {
      if (!onOutcome) return
      setActionError('')
      setSubmittingOutcome(true)
      try {
        await onOutcome(
          matchId,
          outcome,
          outcome === 'failed' ? { feedback: buildFeedback(), continuation } : undefined,
        )
        setOutcomePhase('done')
      } catch (err) {
        failAction(err)
      } finally {
        setSubmittingOutcome(false)
      }
    }

    const header = (
      <ExpandableHeader
        expanded={expanded}
        onToggle={toggleExpanded}
        hasDetails={hasDetails}
        left={
          <span className="text-base font-medium text-primary">
            {t('portal.matches.dating', { alias: partnerAlias })}
          </span>
        }
        right={<span className="text-sm text-muted">{t('portal.matches.matchScore', { percent: Math.round(score * 100) })}</span>}
      />
    )

    const sharedSections = (
      <>
        {reasonQuote}
        {displayMatch.partnerFullName && (
          <p className="text-base font-medium text-primary mt-1">{displayMatch.partnerFullName}</p>
        )}
        {partnerHandle && <InstagramLink handle={partnerHandle} />}
        {detailsSection}
        {perspective === 'initiator' && (
          <IceBreakersSection iceBreakers={displayMatch.iceBreakers} dateIdeas={displayMatch.dateIdeas} />
        )}
      </>
    )

    if (outcomePhase === 'done' && pendingOutcome === 'success') {
      return (
        <div className="bg-surface border border-border rounded-2xl p-5 shadow-card hover-card transition-card">
          {header}
          {sharedSections}
          <div className="mt-5 text-center animate-confetti-drift">
            <p className="text-2xl">🎉💛</p>
            <p className="text-base font-medium text-primary mt-2">{t('portal.matches.outcome.successTitle')}</p>
            <p className="text-sm text-muted mt-1">{t('portal.matches.outcome.successBody', { alias: partnerAlias })}</p>
          </div>
        </div>
      )
    }

    if (outcomePhase === 'choice' || (outcomePhase === 'done' && pendingOutcome === 'failed')) {
      return (
        <div className="bg-surface border border-border rounded-2xl p-5 shadow-card hover-card transition-card">
          {header}
          {sharedSections}
          <div className="mt-5 text-center animate-heart-pulse">
            <p className="text-2xl">🤍</p>
            <p className="text-base font-medium text-primary mt-2">{t('portal.matches.outcome.failedTitle')}</p>
            <p className="text-sm text-muted mt-1">{t('portal.matches.outcome.failedBody')}</p>
          </div>
          {outcomePhase === 'choice' && (
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => void submitOutcome('failed', 'continue')}
                disabled={submittingOutcome}
                className="flex-1 inline-flex items-center justify-center gap-2 bg-accent text-bg rounded-full px-4 py-2.5 text-sm font-medium transition-all duration-200 hover:opacity-90 disabled:opacity-50"
              >
                {submittingOutcome ? <Spinner /> : null}
                {t('portal.matches.outcome.keepLooking')}
              </button>
              <button
                onClick={() => void submitOutcome('failed', 'break')}
                disabled={submittingOutcome}
                className="flex-1 inline-flex items-center justify-center gap-2 bg-surface border border-border text-muted rounded-xl px-4 py-2.5 text-sm font-medium transition-all duration-200 hover:bg-bg disabled:opacity-50"
              >
                {submittingOutcome ? <Spinner /> : null}
                {t('portal.matches.outcome.takeABreak')}
              </button>
            </div>
          )}
          {actionError && <p role="alert" className="text-sm text-error mt-3">{actionError}</p>}
        </div>
      )
    }

    if (outcomePhase === 'feedback') {
      return (
        <div className="bg-surface border border-border rounded-2xl p-5 shadow-card hover-card transition-card">
          {header}
          {sharedSections}
          <div className="mt-4 space-y-3">
            <p className="text-sm text-muted">{t('portal.matches.outcome.feedbackPrompt')}</p>
            <div className="space-y-2">
              {OUTCOME_FEEDBACK_TAGS.map(tag => (
                <label key={tag} className="flex items-center gap-2 text-sm text-primary">
                  <input
                    type="checkbox"
                    checked={selectedTags.includes(tag)}
                    onChange={() => toggleTag(tag)}
                    className="rounded border-border"
                  />
                  {t(`portal.matches.outcome.feedbackTags.${tag}`)}
                </label>
              ))}
            </div>
            <textarea
              value={feedbackNote}
              onChange={e => setFeedbackNote(e.target.value)}
              placeholder={t('portal.matches.outcome.feedbackNotePlaceholder')}
              maxLength={500}
              rows={2}
              className="w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm text-primary placeholder:text-muted"
            />
            <button
              onClick={() => setOutcomePhase('choice')}
              className="inline-flex items-center justify-center gap-2 bg-accent text-bg rounded-full px-5 py-2.5 text-sm font-medium transition-all duration-200 hover:opacity-90"
            >
              {t('portal.matches.outcome.feedbackContinue')}
            </button>
          </div>
        </div>
      )
    }

    return (
      <div className="bg-surface border border-border rounded-2xl p-5 shadow-card hover-card transition-card">
        {header}
        {sharedSections}
        {outcomeUnlocked ? (
          <div className="mt-4">
            <p className="text-sm text-muted mb-3">{t('portal.matches.howDidItGo')}</p>
            <div className="flex gap-3">
              <button
                onClick={() => { setPendingOutcome('success'); setConfirmingSuccess(true) }}
                disabled={submittingOutcome}
                className="flex-1 inline-flex items-center justify-center gap-2 bg-success text-bg rounded-full px-4 py-2.5 text-sm font-medium transition-all duration-200 hover:opacity-90 disabled:opacity-50"
              >
                {submittingOutcome ? <Spinner /> : null}
                {t('portal.matches.workedOut')}
              </button>
              <button
                onClick={() => { setPendingOutcome('failed'); setOutcomePhase('feedback') }}
                disabled={submittingOutcome}
                className="flex-1 inline-flex items-center justify-center gap-2 bg-surface border border-border text-muted rounded-xl px-4 py-2.5 text-sm font-medium transition-all duration-200 hover:bg-bg disabled:opacity-50"
              >
                {t('portal.matches.didntWork')}
              </button>
            </div>
            {actionError && <p role="alert" className="text-sm text-error mt-3">{actionError}</p>}
          </div>
        ) : (
          <div className="mt-4 bg-accent-light border border-accent/20 rounded-xl p-4">
            <p className="text-sm text-primary">{t(checkInMessageKey, { alias: partnerAlias })}</p>
            {cancelUnlocked && (
              <button
                onClick={() => { setPendingOutcome('failed'); setOutcomePhase('feedback') }}
                className="text-xs text-muted underline mt-2 hover:text-primary"
              >
                {t('portal.matches.outcome.notWorkingOutLink')}
              </button>
            )}
          </div>
        )}
        <ConfirmDialog
          open={confirmingSuccess}
          title={t('portal.matches.outcome.confirmSuccessTitle')}
          description={t('portal.matches.outcome.confirmSuccessBody')}
          confirmLabel={t('portal.matches.outcome.confirmSuccessYes')}
          cancelLabel={t('portal.matches.outcome.confirmSuccessNo')}
          loading={submittingOutcome}
          onConfirm={() => { setConfirmingSuccess(false); void submitOutcome('success') }}
          // Dismiss (button, Escape, backdrop) must never submit an
          // irreversible outcome — it just puts the card back as it was.
          onClose={() => { setConfirmingSuccess(false); setPendingOutcome(null) }}
        />
      </div>
    )
  }

  // ── Case 1: proposed + none ───────────────────────────────────────────────
  const handleContactRequest = async () => {
    if (!onContactRequest) return
    setLoadingContact(true)
    setActionError('')
    try {
      const result = await onContactRequest(matchId)
      // Reveal happened server-side — let the user confirm or pass in a dialog
      setPendingContact(result)
    } catch (err) {
      failAction(err)
    } finally {
      setLoadingContact(false)
    }
  }

  // Confirm (and any plain dismiss — Escape/backdrop must never decline
  // permanently by accident): proceed to the waiting "contact status" view
  const confirmContact = () => {
    if (!pendingContact) return
    setDisplayMatch(prev => ({
      ...prev,
      status: 'in_progress',
      perspective: 'initiator',
      iceBreakers: pendingContact.iceBreakers,
      dateIdeas: pendingContact.dateIdeas,
    }))
    setPendingContact(null)
  }

  // Explicit "No": withdraw — the match is declined for good and the user
  // waits for the next matching phase
  const cancelContact = async () => {
    if (!onWithdraw) {
      confirmContact()
      return
    }
    setWithdrawing(true)
    try {
      await onWithdraw(matchId)
      // Parent clears the list — this card unmounts
    } catch (err) {
      // Withdraw failed: fall back to the waiting view, the contact is still live
      failAction(err)
      confirmContact()
    } finally {
      setWithdrawing(false)
    }
  }

  return (
    <div className="bg-surface border border-border rounded-2xl p-5 shadow-card hover-card transition-card">
      <ExpandableHeader
        expanded={expanded}
        onToggle={toggleExpanded}
        hasDetails={hasDetails}
        left={<span className="text-base font-medium text-primary">{partnerAlias}</span>}
        right={<ScoreBar score={score} />}
      />
      {reasonQuote}
      {detailsSection}
      <div className="mt-4">
        <button
          onClick={handleContactRequest}
          disabled={loadingContact || !onContactRequest}
          className="inline-flex items-center justify-center gap-2 bg-accent text-bg rounded-full px-5 py-2.5 text-sm font-medium transition-all duration-200 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loadingContact ? <Spinner /> : null}
          {t('portal.matches.reachOut')}
        </button>
        {actionError && <p role="alert" className="text-sm text-error mt-3">{actionError}</p>}
      </div>
      <ConfirmDialog
        open={pendingContact !== null}
        title={t('portal.matches.confirmContactTitle')}
        description={t('portal.matches.confirmContactBody', { alias: partnerAlias })}
        confirmLabel={t('portal.matches.confirmContactYes')}
        cancelLabel={t('portal.matches.confirmContactNo')}
        loading={withdrawing}
        onConfirm={confirmContact}
        onCancel={() => { void cancelContact() }}
        onClose={confirmContact}
      />
    </div>
  )
}

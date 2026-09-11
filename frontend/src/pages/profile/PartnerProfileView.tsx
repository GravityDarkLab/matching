import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getMatchSummary } from '../../api/profile.client'
import type { MatchSummary } from '../../api/profile.client'
import Spinner from '../../components/ui/Spinner'
import Badge from '../../components/ui/Badge'

interface Props {
  profile: Record<string, unknown>
  alias: string
  matchId: string
}

function WordCard({ label, text }: { label: string; text: string }) {
  return (
    <div className="rounded-xl border border-border bg-bg p-3">
      <p className="text-xs font-medium text-muted mb-1.5">{label}</p>
      <p className="text-sm text-primary leading-relaxed">{text}</p>
    </div>
  )
}

export function PartnerProfileView({ profile, alias, matchId }: Props) {
  const { t } = useTranslation()
  const [summary, setSummary] = useState<MatchSummary | null>(null)
  const [loadingSummary, setLoadingSummary] = useState(false)
  const [summaryError, setSummaryError] = useState(false)

  const age                  = profile.age as number | undefined
  const location             = profile.location as string | undefined
  const work                 = profile.work as string | undefined
  const religion             = profile.religion as string | undefined
  const heightCm             = profile.height_cm as number | undefined
  const rawVibeWords         = profile.vibe_words
  const vibeWordList: string[] = Array.isArray(rawVibeWords)
    ? (rawVibeWords as unknown[]).map(String).filter(Boolean)
    : typeof rawVibeWords === 'string'
    ? rawVibeWords.split(',').map(w => w.trim()).filter(Boolean)
    : []
  const lifestyle            = profile.lifestyle as string | undefined
  const relationshipType     = profile.relationship_type as string | undefined
  const maxAgeGap            = profile.max_age_gap as number | null | undefined
  const openToOlder          = profile.open_to_older as boolean | null | undefined
  const openToYounger        = profile.open_to_younger as boolean | null | undefined
  const openToLD             = profile.open_to_long_distance as boolean | undefined
  const affection            = profile.physical_affection_importance as number | undefined
  const okayOppGender        = profile.okay_with_opposite_gender_friends as boolean | undefined
  const religionDB           = profile.religion_deal_breaker as boolean | undefined
  const physicalTraits       = profile.preferred_physical_traits as string | undefined
  const characterTraits      = profile.preferred_character_traits as string | undefined
  const dealBreakers         = profile.deal_breakers as string | undefined
  const dreamFirstDate       = profile.dream_first_date as string | undefined

  const loadSummary = async () => {
    if (summary || loadingSummary) return
    setLoadingSummary(true)
    setSummaryError(false)
    try {
      const result = await getMatchSummary(matchId)
      setSummary(result)
    } catch {
      setSummaryError(true)
    } finally {
      setLoadingSummary(false)
    }
  }

  const ageGapLabel = (() => {
    if (maxAgeGap == null) return null
    const parts = [t('portal.matches.ageGapValue', { n: maxAgeGap })]
    if (openToOlder)   parts.push(t('portal.matches.openOlder'))
    if (openToYounger) parts.push(t('portal.matches.openYounger'))
    return parts.join(' · ')
  })()

  const snapshotChips = [
    age      && t('portal.profile.yearsOld', { age }),
    location,
    work,
    religion,
    heightCm && `${heightCm} cm`,
  ].filter(Boolean) as string[]

  const hasPrefs = relationshipType || maxAgeGap != null || openToLD !== undefined || affection || okayOppGender !== undefined || (religionDB === true)
  const hasWords = physicalTraits || characterTraits || dealBreakers || dreamFirstDate

  return (
    <div className="mt-4 pt-4 border-t border-border space-y-5">

      {/* Section A — Snapshot */}
      {snapshotChips.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted uppercase tracking-wider mb-2">
            {t('portal.matches.aboutPartner', { alias })}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {snapshotChips.map((chip, i) => <Badge key={i}>{chip}</Badge>)}
          </div>
        </div>
      )}

      {/* Section B — Vibe */}
      {(vibeWordList.length > 0 || lifestyle) && (
        <div>
          <p className="text-xs font-medium text-muted uppercase tracking-wider mb-2">
            {t('portal.matches.vibe')}
          </p>
          {vibeWordList.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {vibeWordList.map((word, i) => (
                <span key={i} className="text-xs bg-accent/10 text-accent rounded-full px-2.5 py-0.5 font-medium">
                  {word}
                </span>
              ))}
            </div>
          )}
          {lifestyle && <p className="text-sm text-primary leading-relaxed">{lifestyle}</p>}
        </div>
      )}

      {/* Section C — What they're looking for */}
      {hasPrefs && (
        <div>
          <p className="text-xs font-medium text-muted uppercase tracking-wider mb-2">
            {t('portal.matches.lookingFor')}
          </p>
          <div className="space-y-1.5 text-sm">
            {relationshipType && (
              <div className="flex justify-between gap-3">
                <span className="text-muted">{t('portal.matches.relationship')}</span>
                <span className="text-primary font-medium">{relationshipType}</span>
              </div>
            )}
            {ageGapLabel && (
              <div className="flex justify-between gap-3">
                <span className="text-muted">{t('portal.matches.ageGap')}</span>
                <span className="text-primary font-medium text-end">{ageGapLabel}</span>
              </div>
            )}
            {openToLD !== undefined && (
              <div className="flex justify-between gap-3">
                <span className="text-muted">{t('portal.matches.longDistance')}</span>
                <span className="text-primary font-medium">{openToLD ? t('common.yes') : t('common.no')}</span>
              </div>
            )}
            {affection !== undefined && (
              <div className="flex justify-between items-center gap-3">
                <span className="text-muted">{t('portal.matches.affection')}</span>
                <span className="text-primary font-medium">{affection}/10</span>
              </div>
            )}
            {okayOppGender !== undefined && (
              <div className="flex justify-between gap-3">
                <span className="text-muted">{t('portal.matches.oppGenderFriends')}</span>
                <span className="text-primary font-medium">{okayOppGender ? t('common.yes') : t('common.no')}</span>
              </div>
            )}
            {religionDB === true && (
              <div className="flex justify-between gap-3">
                <span className="text-muted">{t('portal.matches.religionDB')}</span>
                <span className="text-primary font-medium">{t('common.yes')}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Section D — In their own words */}
      {hasWords && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted uppercase tracking-wider">
            {t('portal.matches.inTheirWords')}
          </p>
          {physicalTraits  && <WordCard label={t('portal.matches.physicalTraits')}  text={physicalTraits} />}
          {characterTraits && <WordCard label={t('portal.matches.characterTraits')} text={characterTraits} />}
          {dealBreakers    && <WordCard label={t('portal.matches.dealBreakers')}    text={dealBreakers} />}
          {dreamFirstDate  && <WordCard label={t('portal.matches.dreamDate')}       text={dreamFirstDate} />}
        </div>
      )}

      {/* Section E — Why this match (AI, lazy, cached) */}
      <div className="pt-2 border-t border-border">
        {!summary && !loadingSummary && !summaryError && (
          <button
            type="button"
            onClick={() => void loadSummary()}
            className="text-sm text-accent hover:underline font-medium"
          >
            {t('portal.matches.whyThisMatch')}
          </button>
        )}
        {loadingSummary && (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Spinner />
            {t('portal.matches.generatingSummary')}
          </div>
        )}
        {summaryError && (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-error">{t('portal.matches.summaryError')}</p>
            <button
              type="button"
              onClick={() => { setSummaryError(false); void loadSummary() }}
              className="text-xs text-accent hover:underline"
            >
              {t('portal.matches.summaryRetry')}
            </button>
          </div>
        )}
        {summary && (
          <div className="space-y-3">
            <p className="text-xs font-medium text-muted uppercase tracking-wider">
              {t('portal.matches.whyThisMatch')}
            </p>
            <div>
              <p className="text-xs font-semibold text-success mb-1.5">{t('portal.matches.strengths')}</p>
              <ul className="space-y-1">
                {summary.pros.map((pro, i) => (
                  <li key={i} className="text-sm text-primary flex gap-2">
                    <span className="text-success shrink-0 font-bold">+</span>
                    <span>{pro}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold text-muted mb-1.5">{t('portal.matches.keepInMind')}</p>
              <ul className="space-y-1">
                {summary.cons.map((con, i) => (
                  <li key={i} className="text-sm text-primary flex gap-2">
                    <span className="text-muted shrink-0">·</span>
                    <span>{con}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

import { useTranslation } from 'react-i18next'
import { MatchCard } from './MatchCard'
import EmptyState from '../../components/ui/EmptyState'
import { useToast } from '../../components/ui/Toast'
import type { MatchView, ContactResult } from '../../api/profile.client'
import { requestContact, respondToContact, withdrawContact, reportOutcome } from '../../api/profile.client'

interface Props {
  matches: MatchView[]
  onMatchesChange: (updatedMatches: MatchView[]) => void
}

export default function MatchList({ matches, onMatchesChange }: Props) {
  const { t } = useTranslation()
  const { toast } = useToast()

  async function handleContact(matchId: string): Promise<ContactResult> {
    const result = await requestContact(matchId)
    // Contact is exclusive: the server expired every other match, keep only this one
    onMatchesChange(
      matches
        .filter(m => m.matchId === matchId)
        .map(m => ({
          ...m,
          status: 'in_progress' as const,
          perspective: 'initiator' as const,
          iceBreakers: result.iceBreakers,
          dateIdeas: result.dateIdeas,
        })),
    )
    return result
  }

  async function handleRespond(matchId: string, accept: boolean): Promise<void> {
    const { partnerInstagram, partnerFullName } = await respondToContact(matchId, accept)
    onMatchesChange(
      matches.map(m =>
        m.matchId === matchId
          ? {
              ...m,
              status: accept ? ('dating' as const) : ('declined' as const),
              partnerInstagram: partnerInstagram ?? m.partnerInstagram,
              partnerFullName: partnerFullName ?? m.partnerFullName,
            }
          : m,
      ),
    )
  }

  async function handleWithdraw(matchId: string): Promise<void> {
    await withdrawContact(matchId)
    toast(t('portal.matches.withdrawNotice'))
    // The declined match and all expired ones are gone — next phase brings new ones
    onMatchesChange([])
  }

  async function handleOutcome(
    matchId: string,
    outcome: 'success' | 'failed',
    options?: { feedback?: { tags: string[]; note?: string }; continuation?: 'continue' | 'break' },
  ): Promise<void> {
    await reportOutcome(matchId, outcome, options)
    // MatchCard renders its own post-outcome celebratory/encouraging view
    // locally (outcomePhase state) — the match stays in this list until the
    // next full reload picks up the real terminal status from the server.
  }

  if (matches.length === 0) {
    return <EmptyState title={t('portal.matches.empty')} />
  }

  return (
    <div className="space-y-4">
      {matches.map(m => (
        <MatchCard
          key={m.matchId}
          match={m}
          onContactRequest={handleContact}
          onRespond={handleRespond}
          onWithdraw={handleWithdraw}
          onOutcome={handleOutcome}
        />
      ))}
    </div>
  )
}

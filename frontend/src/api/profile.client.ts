import type { ApplicantStatus, MatchStatus } from '../types/status'
import { API_BASE } from '../config/api'

const BASE = API_BASE + '/api/v1'

// ── Types ────────────────────────────────────────────────────────────────────

export type { ApplicantStatus, MatchStatus }
export type MatchPerspective = 'none' | 'initiator' | 'target'

export interface MatchView {
  matchId: string
  partnerAlias: string
  score: number // 0–1
  breakdown?: Record<string, number> // per-dimension scores from the matching algorithm
  llmReasoning?: string // grounded explanation from the LLM rerank stage that produced `score`
  status: MatchStatus
  perspective: MatchPerspective
  contactRequestedAt?: string // ISO date string
  iceBreakers?: string[] // only for initiator in in_progress/dating
  dateIdeas?: string[] // only for initiator in in_progress/dating
  partnerProfile?: Record<string, unknown> // partner's public questionnaire answers
  partnerInstagram?: string // partner's handle — only ever set once status is "dating" (mutual reveal)
  partnerFullName?: string
  datingStartedAt?: string
}

export interface ProfileView {
  applicantId: string
  alias: string
  fullName: string | null
  status: ApplicantStatus
  scoreThreshold: number
  createdAt: string
  deletionScheduledAt: string | null
  distanceNudge: { matchId: string } | null
}

export type LoginResult = { type: 'first_login' } | { type: 'password_required' } | { type: 'ok' }

export interface ContactResult {
  iceBreakers: string[]
  dateIdeas: string[]
}

export interface MatchSummary {
  pros: string[]
  cons: string[]
  generatedAt: string
  model: string
}

// ── Core request helper ──────────────────────────────────────────────────────

async function profileRequest<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.headers as Record<string, string> | undefined),
  }

  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers,
    credentials: 'include', // Send HttpOnly session cookie automatically
  })

  const body = await res.json().catch(() => ({ success: false, error: res.statusText }))

  if (!body.success) {
    const error = (body as { error?: string }).error
    // Only the auth middleware's own 401s mean the session itself is invalid.
    // Other 401s (e.g. "Current password is incorrect") are business-logic errors.
    if (res.status === 401 && (error === 'Unauthorized' || error === 'Invalid or expired token')) {
      throw new Error('Session expired')
    }
    throw new Error(error ?? 'Request failed')
  }

  return body as T
}

// ── Public endpoints ──────────────────────────────────────────────────────────

export async function profileLogin(magicToken: string, password?: string): Promise<LoginResult> {
  const payload: { magicToken: string; password?: string } = { magicToken }
  if (password !== undefined) payload.password = password

  const body = await profileRequest<{ firstLogin?: boolean; passwordRequired?: boolean }>(
    '/profile/login',
    { method: 'POST', body: JSON.stringify(payload) },
  )

  if (body.firstLogin) return { type: 'first_login' }
  if (body.passwordRequired) return { type: 'password_required' }
  return { type: 'ok' }
}

export async function setPassword(magicToken: string, newPassword: string): Promise<void> {
  await profileRequest<unknown>(
    '/profile/set-password',
    { method: 'POST', body: JSON.stringify({ magicToken, newPassword }) },
  )
}

export async function suggestPassword(): Promise<{ suggestion: string }> {
  return profileRequest<{ suggestion: string }>('/profile/suggest-password', { method: 'GET' })
}

/** Clears the portal session cookie. */
export async function logout(): Promise<void> {
  await profileRequest<unknown>('/profile/logout', { method: 'POST' })
}

// ── Authenticated endpoints (cookie sent automatically) ───────────────────────

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await profileRequest<unknown>(
    '/profile/change-password',
    { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) },
  )
}

export async function getMyProfile(): Promise<ProfileView> {
  const body = await profileRequest<{ data: ProfileView }>('/profile/me', { method: 'GET' })
  return body.data
}

/** The applicant's own questionnaire answers (never includes instagram_handle). */
export async function getMyAnswers(): Promise<Record<string, unknown>> {
  const body = await profileRequest<{ data: { answers: Record<string, unknown> } }>(
    '/profile/answers',
    { method: 'GET' },
  )
  return body.data.answers
}

/** Updates the applicant's questionnaire answers (instagram_handle is not accepted). */
export async function updateMyAnswers(answers: Record<string, unknown>): Promise<void> {
  await profileRequest<unknown>(
    '/profile/answers',
    { method: 'PUT', body: JSON.stringify({ answers }) },
  )
}

export async function getMyMatches(threshold?: number, limit?: number): Promise<MatchView[]> {
  const params = new URLSearchParams()
  if (threshold !== undefined) params.set('threshold', String(threshold))
  if (limit !== undefined) params.set('limit', String(limit))
  const qs = params.toString() ? `?${params.toString()}` : ''
  const body = await profileRequest<{ data: MatchView[] }>(`/profile/matches${qs}`, { method: 'GET' })
  return body.data
}

export async function requestContact(matchId: string): Promise<ContactResult> {
  const body = await profileRequest<{ data: ContactResult }>(
    `/profile/matches/${matchId}/contact`,
    { method: 'POST' },
  )
  return body.data
}

export async function respondToContact(
  matchId: string,
  accept: boolean,
): Promise<{ partnerInstagram: string | null; partnerFullName: string | null }> {
  const body = await profileRequest<{ data: { partnerInstagram: string | null; partnerFullName: string | null } }>(
    `/profile/matches/${matchId}/respond`,
    { method: 'POST', body: JSON.stringify({ accept }) },
  )
  return body.data
}

/** Initiator backs out after the reveal — match is declined permanently. */
export async function withdrawContact(matchId: string): Promise<void> {
  await profileRequest<unknown>(
    `/profile/matches/${matchId}/withdraw`,
    { method: 'POST' },
  )
}

export interface OutcomeFeedback {
  tags: string[]
  note?: string
}

export async function reportOutcome(
  matchId: string,
  outcome: 'success' | 'failed',
  options?: { feedback?: OutcomeFeedback; continuation?: 'continue' | 'break' },
): Promise<void> {
  await profileRequest<unknown>(
    `/profile/matches/${matchId}/outcome`,
    {
      method: 'POST',
      body: JSON.stringify({
        outcome,
        outcomeFeedback: options?.feedback,
        continuation: options?.continuation,
      }),
    },
  )
}

export async function getMatchSummary(matchId: string): Promise<MatchSummary> {
  const body = await profileRequest<{ data: MatchSummary }>(
    `/profile/matches/${matchId}/summary`,
    { method: 'GET' },
  )
  return body.data
}

export async function deactivateAccount(): Promise<void> {
  await profileRequest<unknown>('/profile/deactivate', { method: 'POST' })
}

/** Cancels a pending deletion and restores the account to the matching pool. */
export async function cancelAccountDeletion(): Promise<void> {
  await profileRequest<unknown>('/profile/cancel-deletion', { method: 'POST' })
}

export async function acknowledgeDistanceNudge(matchId: string, openUp: boolean): Promise<void> {
  await profileRequest<unknown>(
    `/profile/matches/${matchId}/nudge-ack`,
    { method: 'POST', body: JSON.stringify({ openUp }) },
  )
}

/** Immediately and irreversibly deletes the account, bypassing the grace period. */
export async function deleteAccountNow(): Promise<void> {
  await profileRequest<unknown>('/profile/delete-now', { method: 'POST' })
}

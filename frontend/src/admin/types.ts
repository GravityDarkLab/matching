export type { ApplicantStatus, MatchStatus } from '../types/status'

import type { ApplicantStatus, MatchStatus } from '../types/status'

export interface Applicant {
  id: string
  alias: string
  questionnaireVersion: string
  answers: Record<string, unknown>
  status: ApplicantStatus
  submissionIp?: string
  deletionScheduledAt?: string
  createdAt: string
  updatedAt: string
}

export interface Paginated<T> {
  data: T[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export interface AuditLog {
  id: string
  adminId: string
  action: string
  targetAlias?: string
  targetApplicantId?: string
  ipAddress: string
  userAgent: string
  timestamp: string
  metadata?: Record<string, unknown>
}

export interface MatchCandidate {
  applicantId: string
  alias: string
  score: number
  breakdown: Record<string, number>
}

export interface MatchingRun {
  algorithm: string
  totalApplicants: number
  durationMs: number
  couplesProposed: number
  results: Record<string, MatchCandidate[]>
}

export interface MatchingLastRun {
  at: string
  algorithm: string
  totalApplicants: number
  couplesProposed: number
  durationMs: number
  triggeredBy: 'admin' | 'scheduler'
}

export interface Match {
  id: string
  applicantAId: string
  applicantAAlias: string
  applicantBId: string
  applicantBAlias: string
  score: number
  algorithm: string
  status: MatchStatus
  notes?: string
  createdAt: string
  updatedAt: string
}

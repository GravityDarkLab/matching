import { ObjectId } from "mongodb";

export interface MatchSummary {
  pros: string[];
  cons: string[];
  generatedAt: Date;
  model: string;
}

export type MatchStatus =
  | "proposed"     // algorithm suggested; both see each other anonymously
  | "in_progress"  // initiator revealed partner's Instagram; partner notified
  | "dating"       // partner accepted in-app; other matches hidden
  | "success"      // self-reported: worked out → both applicants → inactive
  | "failed"       // self-reported: didn't work out → both applicants → applied
  | "declined"     // partner explicitly declined the contact request
  | "expired";     // a participant went inactive before the match concluded

export interface MatchDoc {
  _id: ObjectId;
  /** Always the canonically "smaller" ObjectId hex string — enforced in match.service */
  applicantAId: ObjectId;
  applicantAAlias: string;
  applicantBId: ObjectId;
  applicantBAlias: string;
  /** Symmetric score: average of A→B and B→A scores */
  score: number;
  /** Per-dimension scores from the algorithm that produced this match */
  breakdown?: Record<string, number>;
  /** Grounded explanation from the LLM rerank stage that produced `score` */
  llmReasoning?: string;
  algorithm: string;
  status: MatchStatus;
  initiatorId?: ObjectId;       // who clicked "I want to contact"
  iceBreakers?: string[];       // AI-generated, populated at in_progress
  dateIdeas?: string[];         // AI-generated, populated at in_progress
  contactRequestedAt?: Date;
  contactRespondedAt?: Date;
  /** Applicant ids (hex strings) for whom the partner-identity reveal on the
   *  matches page has already been audit-logged — keeps repeat page loads
   *  from writing a new log entry every time. */
  identityViewLoggedFor?: string[];
  /** Set once, the moment status flips to "dating" — the stable anchor for
   *  day-3/day-7 outcome gating. Matches that reached "dating" before this
   *  field existed have none; gating falls back to contactRespondedAt. */
  datingStartedAt?: Date;
  /** Optional context captured when an outcome is reported as "failed".
   *  nudgeAcknowledged tracks whether the one-time distance-preference
   *  suggestion (shown when "too_far" is tagged) has been shown/dismissed. */
  outcomeFeedback?: {
    tags: string[];
    note?: string;
    nudgeAcknowledged?: boolean;
  };
  summary?: MatchSummary;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

import { ObjectId } from "mongodb";

export type ApplicantStatus =
  | "applied"   // submitted form; eligible for matching runs
  | "matched"   // has proposed matches to review; still in pool
  | "dating"    // pursuing someone; other matches hidden; excluded from new runs
  | "inactive"; // left the platform; deletion scheduled in 180 days

export interface ApplicantDoc {
  _id: ObjectId;
  alias: string;
  questionnaireVersion: string;
  answers: Record<string, unknown>;
  status: ApplicantStatus;
  magicToken: string;       // 64-char hex, used in ?token= URL
  passwordHash: string | null; // null until first login; bcrypt hash after set-password
  scoreThreshold: number;   // minimum match score to show (0.6–1.0, default 0.8)
  submissionIp?: string;
  deletionScheduledAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

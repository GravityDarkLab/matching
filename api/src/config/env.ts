/**
 * Centralised environment variable loader.
 * Throws on startup if any required variable is missing or invalid.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, defaultValue: string): string {
  return process.env[name] ?? defaultValue;
}

export function validateEncryptionKey(key: string): string {
  if (!/^[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error(
      "ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)"
    );
  }
  return key;
}

export function validatePositiveInt(name: string, value: string): number {
  const parsed = parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, got "${value}"`);
  }
  return parsed;
}

export function parseAllowedOrigins(value: string): string[] {
  return value
    .split(/[;,]/)
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

export const env = {
  mongodbUri: required("MONGODB_URI"),
  mongodbDbName: optional("MONGODB_DB_NAME", "ons"),
  encryptionKey: validateEncryptionKey(required("ENCRYPTION_KEY")),
  jwtSecret: required("JWT_SECRET"),
  adminJwtExpiry: optional("ADMIN_JWT_EXPIRY", "8h"),
  // Applicant portal session length — separate from the admin session above
  // since the two audiences have very different re-login tolerance.
  applicantJwtExpiry: optional("APPLICANT_JWT_EXPIRY", "30d"),
  allowedOrigins: parseAllowedOrigins(
    optional("ALLOWED_ORIGINS", "http://localhost:3000")
  ),
  // HMAC secret used to sign per-version submission keys — prevents version enumeration.
  // Generate with: openssl rand -hex 32
  formSecret: required("FORM_SECRET"),

  // ── OpenAI (embeddings + chat: matching, rerank, summaries, ice-breakers) ───
  // Matching always calls OpenAI directly — no local-model option here. A
  // local/self-hosted model may still power some *other*, non-matching
  // feature in the future; that would get its own client, not a branch of
  // this one (see api/src/matching/embeddings/provider.ts).
  openaiApiKey: required("OPENAI_API_KEY"),
  embeddingModel: optional("EMBEDDING_MODEL", "text-embedding-3-small"),
  openaiChatModel: optional("OPENAI_CHAT_MODEL", "gpt-4o-mini"),

  // Scheduled matching job — disabled unless a positive interval is set
  matchingJobIntervalHours: parseFloat(optional("MATCHING_JOB_INTERVAL_HOURS", "0")),

  // Grace period (days) before an inactive applicant's personal data is permanently purged
  deletionGraceDays: validatePositiveInt("DELETION_GRACE_DAYS", optional("DELETION_GRACE_DAYS", "180")),

  // Server config
  port: parseInt(optional("PORT", "3001"), 10),
  nodeEnv: optional("NODE_ENV", "development"),
  // Whether a trusted reverse proxy sits in front of the server. Only when
  // true are X-Forwarded-For / X-Real-IP believed for the client IP used in
  // rate limiting and audit logs — a direct-to-Bun deployment must leave this
  // false, or any client can spoof its IP per request (bypassing per-IP rate
  // limits and forging audit-log addresses). See utils/request-meta.ts.
  trustProxy: optional("TRUST_PROXY", "false") === "true",
  // Base URL used in startup logs. Defaults to localhost for dev.
  // Override in test/prod: PUBLIC_URL=https://api.yourdomain.com
  publicUrl: optional("PUBLIC_URL", "").replace(/\/$/, ""),
} as const;

export type Env = typeof env;

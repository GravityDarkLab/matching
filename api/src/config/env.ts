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

export function validateEmbeddingProvider(value: string): "openai" | "local" {
  if (value !== "openai" && value !== "local") {
    throw new Error(`EMBEDDING_PROVIDER must be "openai" or "local", got "${value}"`);
  }
  // Cross-field: validate provider-specific required vars now that we know the provider.
  if (value === "local" && !process.env.EMBEDDING_BASE_URL) {
    throw new Error("EMBEDDING_BASE_URL is required when EMBEDDING_PROVIDER=local");
  }
  if (value === "openai" && !process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required when EMBEDDING_PROVIDER=openai");
  }
  return value;
}

/**
 * Chat (LLM) provider — independent of EMBEDDING_PROVIDER so embeddings and
 * chat completions can point at different backends (e.g. local embeddings
 * you've already cached + a hosted OpenAI model for chat, or vice versa).
 * Defaults to EMBEDDING_PROVIDER when CHAT_PROVIDER is unset, so existing
 * configs that only ever set one provider keep working unchanged.
 */
export function validateChatProvider(
  value: string | undefined,
  embeddingProvider: "openai" | "local"
): "openai" | "local" {
  const provider = value ?? embeddingProvider;
  if (provider !== "openai" && provider !== "local") {
    throw new Error(`CHAT_PROVIDER must be "openai" or "local", got "${provider}"`);
  }
  if (provider === "openai" && !process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required when CHAT_PROVIDER (or EMBEDDING_PROVIDER) resolves to openai");
  }
  if (provider === "local" && !process.env.CHAT_BASE_URL && !process.env.EMBEDDING_BASE_URL) {
    throw new Error(
      "CHAT_BASE_URL (or EMBEDDING_BASE_URL as a fallback) is required when CHAT_PROVIDER resolves to local"
    );
  }
  return provider;
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

const embeddingProvider = validateEmbeddingProvider(required("EMBEDDING_PROVIDER"));

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

  // ── Embedding provider (used only by the "embedding-cosine" algorithm) ──────
  // Providers: openai | local
  // See api/src/matching/embeddings/provider.ts for full documentation.
  embeddingProvider,
  embeddingModel: required("EMBEDDING_MODEL"),
  embeddingBaseUrl: optional("EMBEDDING_BASE_URL", ""),  // required for local — validated above
  openaiApiKey: optional("OPENAI_API_KEY", ""),          // required for openai — validated above
  openaiChatModel: optional("OPENAI_CHAT_MODEL", "gpt-4o-mini"),

  // ── Chat provider (icebreakers, match summaries, match rerank) ─────────────
  // Independent of embeddingProvider above — see validateChatProvider.
  chatProvider: validateChatProvider(process.env.CHAT_PROVIDER, embeddingProvider),
  // Falls back to EMBEDDING_BASE_URL for the common case of one local server
  // (LM Studio/Ollama) serving both embeddings and chat.
  chatBaseUrl: optional("CHAT_BASE_URL", optional("EMBEDDING_BASE_URL", "")),

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

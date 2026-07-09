/**
 * Preloaded before every test file via `bun test --preload`.
 * Sets required env vars so env.ts evaluates without throwing.
 */
process.env.MONGODB_URI = "mongodb://localhost:27017/ons_test";
process.env.ENCRYPTION_KEY = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"; // gitguardian:ignore — test-only placeholder, not a real key
process.env.JWT_SECRET = "test-only-jwt-secret-not-used-in-production"; // gitguardian:ignore
process.env.FORM_SECRET = "test-only-form-secret-not-used-in-production-padding-64c"; // gitguardian:ignore
process.env.EMBEDDING_PROVIDER = "local";
process.env.EMBEDDING_MODEL = "nomic-embed-text";
process.env.EMBEDDING_BASE_URL = "http://localhost:1234/v1";
// Tests run through Hono's in-memory client (no real socket), so they declare
// a trusted proxy and use X-Forwarded-For to simulate distinct client IPs —
// route tests rotate the header to get separate rate-limit buckets.
process.env.TRUST_PROXY = "true";

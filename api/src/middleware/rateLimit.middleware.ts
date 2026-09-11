import { Context, Next } from "hono";
import { getClientIp } from "../utils/request-meta.js";

interface RateLimitRecord {
  timestamps: number[];
}

/**
 * Generic in-memory sliding window rate limiter function.
 *
 * Each unique key (IP address) gets a window of `windowMs` milliseconds
 * and at most `maxRequests` requests per window.
 *
 * Memory is bounded: old timestamps are evicted on each check.
 * 
 * @param options Configuration for the rate limiter
 * @param options.windowMs Time window in milliseconds
 * @param options.maxRequests Maximum allowed requests per window
 * @param options.keyFn Optional function to extract a unique key from the request context (defaults to IP address)
 * @param options.message Custom error message for rate limit responses
 * 
 * @returns Hono middleware function that enforces the specified rate limit
 */
export function createRateLimiter(options: {
  windowMs: number;
  maxRequests: number;
  keyFn?: (c: Context) => string;
  message?: string;
}) {
  const {
    windowMs,
    maxRequests,
    keyFn,
    message = "Too many requests. Please try again later.",
  } = options;

  // In-memory store: Map of key to array of request timestamps
  const store = new Map<string, RateLimitRecord>();

  // Periodically clean up stale entries (every 5 minutes)
  const cleanup = setInterval(() => {
    const now = Date.now();
    const cutoff = now - windowMs;
    for (const [key, record] of store) {
      record.timestamps = record.timestamps.filter((t) => t > cutoff);
      if (record.timestamps.length === 0) {
        store.delete(key);
      }
    }
  }, 5 * 60 * 1000);

  // Allow GC to collect — don't block process exit
  if (cleanup.unref) cleanup.unref();

  return async function rateLimitMiddleware(
    c: Context,
    next: Next
  ): Promise<Response | void> {
    // Determine the unique key for this request (default to IP address)
    const key = keyFn ? keyFn(c) : getClientIp(c);

    const now = Date.now();
    const cutoff = now - windowMs;

    const record = store.get(key) ?? { timestamps: [] };

    // Evict expired timestamps
    record.timestamps = record.timestamps.filter((t) => t > cutoff);

    if (record.timestamps.length >= maxRequests) {
      const resetAt = record.timestamps[0] + windowMs;
      const retryAfterSecs = Math.ceil((resetAt - now) / 1000);

      c.header("X-RateLimit-Limit", String(maxRequests));
      c.header("X-RateLimit-Remaining", "0");
      c.header("X-RateLimit-Reset", String(Math.ceil(resetAt / 1000)));
      c.header("Retry-After", String(retryAfterSecs));

      return c.json({ success: false, error: message }, 429);
    }

    record.timestamps.push(now);
    store.set(key, record);

    c.header("X-RateLimit-Limit", String(maxRequests));
    c.header(
      "X-RateLimit-Remaining",
      String(maxRequests - record.timestamps.length)
    );

    await next();
  };
}

/**
 * Rate limiter for public form submission: 3 submissions per hour per IP.
 * High enough to allow retries; low enough to stop automated loops.
 */
export const formSubmitRateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  maxRequests: 3,
  message: "Too many form submissions. Please wait before trying again.",
});

/**
 * Strict rate limiter for the login endpoint only.
 * Protects against credential brute-force: 10 attempts per minute per IP.
 */
export const adminLoginRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 10,
  message: "Too many login attempts. Please wait before trying again.",
});

/**
 * General rate limiter for authenticated admin data endpoints.
 * 200 requests per minute — enough headroom for normal browsing even
 * with React StrictMode's double-invocation in development.
 */
export const adminRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 200,
  message: "Too many admin requests. Please wait before trying again.",
});

/**
 * Rate limiter for the applicant profile login endpoint.
 * 10 attempts per minute per IP — mirrors admin login protection.
 */
export const profileLoginRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 10,
  message: "Too many login attempts. Please wait before trying again.",
});

/**
 * General rate limiter for authenticated applicant profile endpoints.
 */
export const profileRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 100,
  message: "Too many requests. Please wait before trying again.",
});

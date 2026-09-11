/**
 * App-wide literal constants — values fixed by implementation choice, not by
 * deployment environment. Anything that should vary per-environment (secrets,
 * URLs, expiry lengths, feature toggles) belongs in env.ts instead.
 */

/** Signing algorithm for both admin and applicant session JWTs. */
export const JWT_ALGORITHM = "HS256";

/** HttpOnly cookie name for the admin session. */
export const ADMIN_COOKIE_NAME = "admin_token";

/** HttpOnly cookie name for the applicant portal session. */
export const APPLICANT_COOKIE_NAME = "ons_applicant_session";

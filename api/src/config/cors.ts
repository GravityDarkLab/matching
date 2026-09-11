import { cors } from "hono/cors";
import { env } from "./env.js";

/**
 * Builds the CORS middleware with the allowed origins from the environment variables.
 * @returns The CORS middleware to be used in the Hono app.
 */
export function buildCorsMiddleware() {
  return cors({
    origin: (origin) => {
      if (!origin) return null;
      if (env.allowedOrigins.includes(origin)) return origin;
      return null;
    },
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Submission-Key"],
    exposeHeaders: ["X-Request-Id"],
    maxAge: 600,
    credentials: true,
  });
}

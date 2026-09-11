import { createHash, randomBytes } from "crypto";

export function generateMagicToken(): string {
  return randomBytes(32).toString("hex");
}

/** SHA-256 of the raw token — stored in the DB so plaintext never persists. */
export function hashMagicToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

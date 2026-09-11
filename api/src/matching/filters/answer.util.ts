/** Trimmed, lowercased string answer, or "" if missing/non-string. */
export function normalizeAnswer(answers: Record<string, unknown>, key: string): string {
  const v = answers[key];
  return typeof v === "string" ? v.trim().toLowerCase() : "";
}

#!/usr/bin/env bun
/**
 * Compares the old embedding-only score against the new LLM-reranked score
 * across one full matching pass. No need to run the pass twice — every
 * RankedCandidate already carries both `embeddingScore` (pre-rerank) and
 * `score` (post-rerank, the number actually displayed everywhere). See
 * docs/llm-listwise-rerank-matching-score.md §7 for the methodology this
 * implements.
 *
 * Usage (from repo root):
 *   bun run eval:rerank
 *   bun run eval:rerank --csv=eval-out.csv   → also write every candidate row to CSV
 *   bun run eval:rerank --clear-cache        → wipe match_reranks first, forcing a real LLM
 *                                               call for every applicant instead of reusing
 *                                               cached results (e.g. after switching models —
 *                                               otherwise a cache hit short-circuits before the
 *                                               LLM is ever called, by design)
 *
 * Requires an existing applicant pool (bun run seed applicants) and
 * OPENAI_API_KEY set in api/.env.<env> — this makes real embedding + LLM
 * calls, it is not a mock.
 */

import { getDb, closeDb } from "../db/connection.js";
import { getMatchReranksCollection } from "../db/collections.js";
import { runFullMatchingPass } from "../matching/engine.js";

const args        = process.argv.slice(2);
const csvArg      = args.find((a) => a.startsWith("--csv="))?.split("=")[1];
const clearCache  = args.includes("--clear-cache");

interface Row {
  applicantId: string;
  candidateId: string;
  alias: string;
  embeddingScore: number;
  score: number;
  llmReasoning: string;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

function summarize(label: string, values: number[]): void {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const above80 = values.filter((v) => v >= 0.8).length;
  console.log(
    `${label.padEnd(16)} min=${sorted[0].toFixed(3)}  p50=${percentile(sorted, 0.5).toFixed(3)}  ` +
    `mean=${mean.toFixed(3)}  p90=${percentile(sorted, 0.9).toFixed(3)}  max=${sorted[sorted.length - 1].toFixed(3)}  ` +
    `≥0.8: ${above80}/${values.length} (${((above80 / values.length) * 100).toFixed(1)}%)`
  );
}

async function main(): Promise<void> {
  if (clearCache) {
    const db = await getDb();
    const { deletedCount } = await getMatchReranksCollection(db).deleteMany({});
    console.log(`[eval-rerank] Cleared ${deletedCount} cached rerank result(s).`);
  }

  console.log("[eval-rerank] Running a full matching pass (real embedding + LLM calls)...");
  const results = await runFullMatchingPass();

  const rows: Row[] = [];
  for (const [applicantId, candidates] of Object.entries(results)) {
    for (const c of candidates) {
      rows.push({
        applicantId,
        candidateId:    c.applicantId,
        alias:          c.alias,
        embeddingScore: c.embeddingScore,
        score:          c.score,
        llmReasoning:   c.llmReasoning,
      });
    }
  }

  if (rows.length === 0) {
    console.log(
      "[eval-rerank] No candidate pairs returned — need at least 2 active applicants " +
      "that pass the hard filters (orientation/age/religion/long-distance)."
    );
    return;
  }

  console.log(`\n[eval-rerank] ${rows.length} candidate pairs across ${Object.keys(results).length} applicants.\n`);
  summarize("embeddingScore", rows.map((r) => r.embeddingScore));
  summarize("score (LLM)",    rows.map((r) => r.score));

  const fallbackCount = rows.filter((r) => r.llmReasoning === "").length;
  console.log(
    `\nFell back to the embedding score (no LLM reasoning) for ${fallbackCount}/${rows.length} pairs ` +
    `(${((fallbackCount / rows.length) * 100).toFixed(1)}%) — expect 0% with a healthy LLM provider.`
  );

  const withReasoning = rows.filter((r) => r.llmReasoning !== "");
  if (withReasoning.length > 0) {
    console.log("\nSample reasoning (first 5):");
    for (const r of withReasoning.slice(0, 5)) {
      console.log(`  ${r.alias} → ${r.candidateId}: ${r.score.toFixed(2)} (was ${r.embeddingScore.toFixed(2)}) — "${r.llmReasoning}"`);
    }
  }

  if (csvArg) {
    const header = "applicantId,candidateId,alias,embeddingScore,score,llmReasoning\n";
    const body = rows
      .map((r) => [r.applicantId, r.candidateId, r.alias, r.embeddingScore, r.score, JSON.stringify(r.llmReasoning)].join(","))
      .join("\n");
    await Bun.write(csvArg, header + body + "\n");
    console.log(`\nWrote ${rows.length} rows to ${csvArg}`);
  }
}

main()
  .catch((err) => {
    console.error("[eval-rerank] Failed:", err);
    process.exitCode = 1;
  })
  .finally(closeDb);

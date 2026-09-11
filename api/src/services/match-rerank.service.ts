// api/src/services/match-rerank.service.ts
import { createHash } from "crypto";
import { getDb } from "../db/connection.js";
import { getMatchReranksCollection } from "../db/collections.js";
import { generateChatCompletion, UNTRUSTED_PROFILE_NOTICE } from "./ai.service.js";
import { buildProfileSnippet } from "./profile-snippet.util.js";
import { env } from "../config/env.js";
import type { ApplicantDoc } from "../models/applicant.model.js";

const RERANK_MODEL = env.openaiChatModel;

export interface RerankCandidateInput {
  doc: ApplicantDoc;
  /** 0-1, the pre-rerank embedding-stage score — used as this candidate's fallback. */
  embeddingScore: number;
}

export interface RerankResult {
  applicantId: string;
  /** 0-1, same scale as the rest of the codebase. */
  score: number;
  reasoning: string;
}

const RUBRIC = `  90-100: rare, near-ideal overlap across values, lifestyle, and what each person is looking for
  70-89:  strong compatibility with minor differences
  50-69:  average — some genuine alignment, some real friction
  30-49:  significant mismatches in core preferences or lifestyle
  0-29:   fundamental incompatibility`;

/**
 * Builds the listwise rerank prompt: one target, the whole shortlist at
 * once. Listwise (not pairwise/pointwise) framing gives the LLM real
 * comparison points instead of an abstract 0-100 scale, which avoids the
 * central-tendency bias LLMs show when scoring in isolation — see the
 * "LLM rerank" section of api/src/matching/README.md.
 */
export function buildRerankPrompt(
  target: ApplicantDoc,
  candidates: { id: string; doc: ApplicantDoc }[],
): string {
  const candidateLines = candidates
    .map((c, i) => `${i + 1}. id="${c.id}": <profile>${buildProfileSnippet(c.doc)}</profile>`)
    .join("\n");

  return `You are an expert matchmaker. Score how compatible each candidate below is with the target person, grounded only in what's stated — do not invent details. ${UNTRUSTED_PROFILE_NOTICE} Use the full range; a shortlist usually spans several bands:

${RUBRIC}

Target: <profile>${buildProfileSnippet(target)}</profile>

Candidates (${candidates.length} total):
${candidateLines}

Your response MUST include exactly ${candidates.length} ranking ${candidates.length === 1 ? "entry" : "entries"} — one for every candidate listed above, no more, no fewer, none skipped. Copy each "candidateId" character-for-character exactly as given in the "id=" field above — do not shorten, truncate, paraphrase, or reformat it. Output the JSON object directly — no reasoning, no chain-of-thought, no preamble, no explanation outside the JSON fields themselves.`;
}

/**
 * Hashes the shortlist's composition (which candidates, at what embedding
 * score) so a cached rerank result can be invalidated automatically when
 * the underlying pool or ranking shifts. Order-independent.
 */
export function computeShortlistHash(
  candidates: { id: string; embeddingScore: number }[],
): string {
  const normalized = candidates
    .map((c) => `${c.id}:${c.embeddingScore.toFixed(4)}`)
    .sort()
    .join("|");
  return createHash("sha256").update(normalized).digest("hex");
}

function clampScore(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, value)) / 100;
}

/**
 * Scores a target applicant's embedding-stage shortlist with a single LLM
 * call covering the whole list at once. Never throws — on any failure (LLM
 * call, parsing, cache I/O) falls back to each candidate's embeddingScore
 * with empty reasoning, per-candidate where possible. The matching pipeline
 * must never block on this.
 */
export async function rerankCandidates(
  target: ApplicantDoc,
  candidates: RerankCandidateInput[],
): Promise<RerankResult[]> {
  if (candidates.length === 0) return [];

  const entries = candidates.map((c) => ({
    id:             c.doc._id.toHexString(),
    embeddingScore: c.embeddingScore,
  }));
  const shortlistHash = computeShortlistHash(entries);
  const fallback = (): RerankResult[] =>
    candidates.map((c) => ({
      applicantId: c.doc._id.toHexString(),
      score:       c.embeddingScore,
      reasoning:   "",
    }));

  const db = await getDb();
  const col = getMatchReranksCollection(db);
  const targetOid = target._id;

  try {
    const cached = await col.findOne({ applicantId: targetOid });
    if (cached && cached.shortlistHash === shortlistHash && cached.model === RERANK_MODEL) {
      return cached.rankings;
    }
  } catch (err) {
    console.error("[match-rerank] Cache read failed, proceeding without it:", err);
  }

  const prompt = buildRerankPrompt(
    target,
    candidates.map((c) => ({ id: c.doc._id.toHexString(), doc: c.doc })),
  );

  const raw = await generateChatCompletion(prompt, {
    maxTokens: 4000, // headroom for a 15-candidate prompt on a reasoning model — see ChatCompletionOptions.maxTokens
    timeoutMs: 45000, // full reasoning across up to 15 candidates takes longer than a quick pairwise prompt
    reasoningEffort: "low", // minimize chain-of-thought token spend on models that support it (e.g. gpt-oss)
    responseSchema: {
      name: "match_rerank",
      schema: {
        type: "object",
        properties: {
          rankings: {
            type: "array",
            items: {
              type: "object",
              properties: {
                candidateId: { type: "string" },
                score:       { type: "number" },
                reasoning:   { type: "string" },
              },
              required: ["candidateId", "score", "reasoning"],
              additionalProperties: false,
            },
          },
        },
        required: ["rankings"],
        additionalProperties: false,
      },
    },
  });

  if (!raw) return fallback();

  let rankings: RerankResult[];
  try {
    const parsed = JSON.parse(raw) as {
      rankings?: { candidateId?: unknown; score?: unknown; reasoning?: unknown }[];
    };
    if (!Array.isArray(parsed.rankings)) {
      console.error(`[match-rerank] No rankings array in response. Raw (first 300 chars): ${raw.slice(0, 300)}`);
      return fallback();
    }

    const byId = new Map(
      parsed.rankings
        .filter((r): r is { candidateId: string; score: unknown; reasoning: unknown } =>
          typeof r.candidateId === "string")
        .map((r) => [r.candidateId, r]),
    );

    rankings = candidates.map((c) => {
      const id = c.doc._id.toHexString();
      const r = byId.get(id);
      const score = r ? clampScore(r.score) : null;
      const reasoning = score !== null && r && typeof r.reasoning === "string" ? r.reasoning.trim() : "";
      return {
        applicantId: id,
        score:       score ?? c.embeddingScore,
        reasoning,
      };
    });

    const fellBack = rankings.filter((r) => r.reasoning === "");
    if (fellBack.length > 0) {
      console.warn(
        `[match-rerank] ${fellBack.length}/${candidates.length} candidates missing or invalid in the ` +
        `LLM response (model returned ${parsed.rankings.length} entries for this shortlist). ` +
        `Missing/invalid ids: ${fellBack.map((r) => r.applicantId).join(", ")}. ` +
        `Raw (first 500 chars): ${raw.slice(0, 500)}`
      );
    }
  } catch (err) {
    console.error(
      `[match-rerank] Failed to parse LLM response as JSON: ${(err as Error).message}. ` +
      `Raw (first 300 chars): ${raw.slice(0, 300)}`
    );
    return fallback();
  }

  try {
    await col.updateOne(
      { applicantId: targetOid },
      { $set: { applicantId: targetOid, shortlistHash, model: RERANK_MODEL, rankings, createdAt: new Date() } },
      { upsert: true },
    );
  } catch (err) {
    console.error("[match-rerank] Cache write failed:", err);
  }

  return rankings;
}

/**
 * Embedding Provider
 * ================================
 *
 * Matching always embeds via the OpenAI embeddings API
 * (text-embedding-3-small / text-embedding-3-large). Requires OPENAI_API_KEY.
 *
 * There is deliberately no local/self-hosted option here — matching is the
 * one place in this codebase where output quality and consistency matter
 * more than avoiding API cost, so it always calls OpenAI directly. A future
 * non-matching feature that wants a local model gets its own client; it
 * would not reuse this one.
 *
 * ## Batch embedding
 *
 * `embedBatch()` sends all texts in a single API request. The
 * `embedding-cosine` algorithm uses this in its `prepare()` step to embed
 * all applicants' text fields in O(applicants) API calls instead of O(pairs).
 * For 50 applicants with 3 text fields each, that's 3 requests (one batch each)
 * instead of 50×49×3 = 7350 individual calls.
 */

import { env } from "../../config/env.js";

// ─── Interface ────────────────────────────────────────────────────────────────

export interface EmbeddingProvider {
  readonly name: string;
  readonly model: string;

  /** Embed a single text string. Returns a float vector. */
  embed(text: string): Promise<number[]>;

  /**
   * Embed multiple texts in one API call.
   * Returns vectors in the same order as the input.
   */
  embedBatch(texts: string[]): Promise<number[][]>;
}

// ─── OpenAI provider ───────────────────────────────────────────────────────────

class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly name = "openai";
  readonly model: string;

  private readonly apiKey: string;

  constructor(opts: { model: string; apiKey: string }) {
    this.model = opts.model;
    this.apiKey = opts.apiKey;
  }

  async embed(text: string): Promise<number[]> {
    const [vec] = await this.embedBatch([text]);
    return vec;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body:   JSON.stringify({ input: texts, model: this.model }),
      // Unguarded otherwise: a hung request here blocks the entire matching
      // pass (this runs in prepare(), before any per-applicant rerank call,
      // and has no timeout/fallback of its own) — see ai.service.ts's
      // generateChatCompletion for the same class of fix on the chat side.
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "(no body)");
      throw new Error(`[embedding] OpenAI API error ${response.status}: ${body}`);
    }

    const json = (await response.json()) as {
      data: { index: number; embedding: number[] }[];
    };

    // The API guarantees objects are ordered by index — sort defensively anyway
    return json.data
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

let _instance: EmbeddingProvider | null = null;

/** Returns the OpenAI embedding provider (singleton). */
export function getEmbeddingProvider(): EmbeddingProvider {
  if (!_instance) {
    _instance = new OpenAIEmbeddingProvider({
      model: env.embeddingModel,
      apiKey: env.openaiApiKey,
    });
  }
  return _instance;
}

/** Reset the singleton — useful in tests when switching the mocked model between runs. */
export function resetEmbeddingProvider(): void {
  _instance = null;
}

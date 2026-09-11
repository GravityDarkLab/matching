# Matching System

This directory contains the full matching pipeline: the engine that orchestrates scoring, hard pre-filters, the embedding-based scorer, and shared weights. The score this scorer produces is an internal ranking signal only — the score actually shown to users comes from an LLM rerank stage in [`services/match-rerank.service.ts`](../services/match-rerank.service.ts) (see [Stage 6](#llm-rerank-servicesmatch-rerankservicets) below).

---

## Directory layout

```
matching/
├── engine.ts                  ← Orchestrator — loads applicants, runs filters, calls prepare() + score()
├── scorer.ts                  ← Embedding-cosine scorer (prepare + score)
├── proposals.ts                ← Derives unique couple proposals from a matching pass
├── scoring/
│   └── weights.ts             ← Single source of truth for all scoring weights
├── scorers/
│   └── numeric.scorer.ts      ← Numeric-vector encoding + cosine similarity, shared by scorer.ts
├── filters/
│   ├── orientation.filter.ts  ← Hard orientation-compatibility filter
│   ├── age.filter.ts          ← Hard age-preference filter + soft modifier
│   ├── religion.filter.ts     ← Hard religion deal-breaker filter
│   ├── location.filter.ts     ← Hard long-distance deal-breaker filter
│   └── answer.util.ts         ← Shared case-insensitive answer normalization
└── embeddings/
    └── provider.ts            ← EmbeddingProvider interface + OpenAI-compatible factory

../services/
├── match-rerank.service.ts    ← LLM listwise rerank — produces the score actually shown (see below)
└── profile-snippet.util.ts    ← Shared free-text profile summary used to build LLM prompts
```

---

## Pipeline

Every matching request — single candidate lookup or full pairwise pass — goes through the same stages:

```
1. LOAD      Load all active applicants from MongoDB.

2. FILTER    Remove incompatible pairs before any scoring.
             Hard pass/fail — not scored, not ranked low.
             Four filters run in sequence:
               a) Orientation compatibility (see below)
               b) Age preferences (see below)
               c) Religion deal-breaker (see below)
               d) Long-distance deal-breaker (see below)

3. PREPARE   Batch-embeds all applicants once before pairwise scoring
             begins (O(N) API calls, not O(N²)).
             Embeddings are persisted; subsequent runs hit the DB cache.

4. SCORE     Call score(a, b) for every compatible pair.
             Returns a composite score in [0, 1] + a named breakdown.

5. SHORTLIST Sort descending by embedding score, take max(topN, 15).
             This is the cheap, broad ranking signal — internal only.

6. RERANK    One LLM call per applicant, covering its whole shortlist at
             once. Produces the score and reasoning actually displayed.
             Falls back to the embedding score on any failure. See below.
```

---

## Hard filters

Filters run before scoring. A pair that fails any filter is excluded entirely.

### Orientation compatibility (`filters/orientation.filter.ts`)

Both directions must pass:

| Person A | Person B gender | Compatible? |
|---|---|---|
| Straight (Male) | Female | ✅ |
| Straight | Same gender | ❌ |
| Gay (Male) | Male | ✅ |
| Gay (Male) | Female | ❌ |
| Lesbian (Female) | Female | ✅ |
| Bisexual / Pansexual | Any | ✅ |
| Asexual | Any | ✅ (other side's filter still applies) |
| Unknown / missing | Any | ✅ pass-through |

### Religion deal-breaker (`filters/religion.filter.ts`)

If either applicant has `religion_deal_breaker = true` and their religions differ → reject.

| A `religion_deal_breaker` | B `religion_deal_breaker` | Same religion? | Compatible? |
|---|---|---|---|
| `true` | any | ✅ | ✅ |
| `true` | any | ❌ | ❌ |
| `false` | `true` | ❌ | ❌ |
| `false` | `false` | any | ✅ |

Missing or blank `religion` → skip (pass-through). Comparison is case-insensitive.

### Long-distance deal-breaker (`filters/location.filter.ts`)

If either applicant has `open_to_long_distance = false` and they are in different cities → reject.

| A `open_to_long_distance` | B `open_to_long_distance` | Same city? | Compatible? |
|---|---|---|---|
| `false` | any | ✅ | ✅ |
| `false` | any | ❌ | ❌ |
| `true` | `false` | ❌ | ❌ |
| `true` | `true` | any | ✅ |

Missing or blank `location` → skip (pass-through). Comparison is case-insensitive exact match on the stored string.

### Age preferences (`filters/age.filter.ts`)

Each applicant can express age constraints via three optional answers:

| Field | Type | Meaning |
|---|---|---|
| `max_age_gap` | `number \| null` | Maximum age difference (years). `null` = no preference. |
| `open_to_older` | `boolean \| null` | Allow partner older than self. Only shown/stored when `max_age_gap > 0`. |
| `open_to_younger` | `boolean \| null` | Allow partner younger than self. Same condition. |

**Hard exclusion rules** (either direction failing rejects the pair):

1. `open_to_older = false` and partner is older → reject.
2. `open_to_younger = false` and partner is younger → reject.
3. Gap > `2 × max_age_gap` → hard outer limit, reject.
4. `max_age_gap = null` → skip all checks for that applicant (no preference).
5. Missing `birth_date` on either side → skip filter for that pair.

**Age modifier** (soft multiplier, applied after weighted scoring):

```
gap = |age(A) - age(B)|

gap ≤ max_gap         → modifier = 1.0   (no penalty)
max_gap < gap ≤ 2×max_gap → modifier = cos((gap - max_gap) / max_gap × π/2)
gap > 2×max_gap        → should be filtered; returns 0.0 defensively

final_score = compatibility_score × min(A_modifier, B_modifier)
```

Bidirectional — the stricter (min) of both parties' modifiers is applied.

---

## Scorer (`scorer.ts`)

The single production scorer uses dense text embeddings for semantic comparison. There are no other algorithm variants.

### Weights

```typescript
// matching/scoring/weights.ts
export const WEIGHTS = {
  numeric:               0.22,   // structured numeric preferences
  lifestyle:             0.22,   // semantic lifestyle similarity
  character_cross_match: 0.35,   // bidirectional character match
  deal_breakers:         0.21,   // bidirectional deal-breaker penalty
} as const;
```

### Score components

| Component | Weight | How computed |
|---|---|---|
| Numeric compatibility | 0.22 | `cosine(numeric_vec_A, numeric_vec_B)` — structured fields |
| Lifestyle similarity | 0.22 | `cosine(embed(profile_A), embed(profile_B))` |
| Character cross-match | 0.35 | `(cosine(pref_A, profile_B) + cosine(pref_B, profile_A)) / 2` — bidirectional |
| Deal-breaker penalty | 0.21 | `1 − (cosine(breaks_A, profile_B) + cosine(breaks_B, profile_A)) / 2` |
| **× Age modifier** | ✦ | Multiplied onto the weighted sum — see above |

**Numeric vector** (no text, exact encoding):
```
[rel_long_term, rel_short_term, open_to_long_distance, affection/10, religion_open]
```

**Embedding text composition (v2):**

| Vector | Fields joined |
|---|---|
| `profile` | `lifestyle + " — " + vibe_words + " — " + work` |
| `preference` | `preferred_character_traits + " — " + preferred_physical_traits + " — " + dream_first_date` |
| `dealBreakers` | `deal_breakers` |

### Why semantic embeddings?

| Pair | Bag-of-words | Embedding |
|---|---|---|
| "driven" vs "ambitious" | 0.00 | ~0.85 |
| "funny" vs "humorous" | 0.00 | ~0.91 |
| "gym" vs "fitness" | 0.00 | ~0.87 |
| "spontaneous" vs "adventurous" | 0.00 | ~0.82 |

### `prepare()` — embedding batching

Running the embedding API inside `score()` would cost one call per pair:

```
50 applicants × 49 pairs × 3 text fields = 7,350 API calls per run
```

Instead, `prepare()` runs once and batch-embeds all applicants:

```
50 applicants × 3 text fields = 3 batch requests (150 embeddings total)
```

Embeddings are **persisted** to the `embeddings` MongoDB collection at form-submission time (fire-and-forget). In steady state `prepare()` loads from the DB — zero API calls.

**Stale detection:** embeddings are recomputed automatically when:
- `EMBEDDING_MODEL` changes (different vector space).
- `textVersion` in the stored document differs from `CURRENT_TEXT_VERSION` (text composition changed).

Current `textVersion = 2` (added `work` to profile, `dream_first_date` to preference in v1.1.0).

---

## LLM rerank (`../services/match-rerank.service.ts`)

The embedding scorer above is structurally incapable of producing a score near 100%, even for a genuinely great pair. Two geometric effects compound: **embedding anisotropy** (learned text embeddings cluster in a narrow cone, so even unrelated texts produce a baseline cosine of ~0.6–0.75) and the **inverted deal-breaker term** (`1 - cosine(...)`), which caps near 0.25–0.4 even for a perfect non-overlap since it's an inversion stacked on that already-inflated baseline. Net effect: a realistic ceiling around ~0.85, not 1.0.

Full write-up — the diagnosis with citations, six alternatives considered and why each was rejected, the prompt/caching/failure-handling design, and what has/hasn't been empirically validated yet: [`docs/llm-listwise-rerank-matching-score.md`](../../../docs/llm-listwise-rerank-matching-score.md).

The fix keeps the embedding scorer exactly as documented above for cheap O(N) shortlisting, then replaces what's *displayed* with an LLM judgment:

- **One LLM call per applicant**, covering that applicant's entire shortlist at once (listwise, not pairwise/pointwise — RankGPT/Pairwise-Ranking-Prompting-style). Listwise framing gives the model real comparison points instead of guessing against an abstract 0–100 scale, which avoids the central-tendency bias LLMs show when scoring in isolation.
- Scored against an explicit **anchored rubric** (90-100 / 70-89 / 50-69 / 30-49 / 0-29 with a one-line description each) via OpenAI Structured Outputs (`responseSchema` in [`ai.service.ts`](../services/ai.service.ts)), at low temperature (~0.3) — a grounded judgment call, not creative writing.
- **Cached** per applicant in the `match_reranks` collection, keyed by a hash of the shortlist's composition (candidate IDs + their embedding scores) plus the chat model — invalidates automatically if the pool or ranking shifts, mirrors the staleness pattern in `embedding.service.ts`.
- **Never blocks the pipeline.** On any failure (empty/malformed LLM response, a candidate missing from the response, an invalid score, cache read/write errors) it falls back to that candidate's embedding score individually — a partial LLM response degrades only the affected candidates, not the whole shortlist.

```typescript
// services/match-rerank.service.ts
function rerankCandidates(
  target: ApplicantDoc,
  candidates: { doc: ApplicantDoc; embeddingScore: number }[],
): Promise<{ applicantId: string; score: number; reasoning: string }[]>
```

`engine.ts`'s `applyRerank()` wires this in: shortlist the embedding-ranked list to `max(topN, 15)`, call `rerankCandidates`, re-sort by the result, slice to `topN`. `runFullMatchingPass()` batches this at a concurrency of 5 (not fully sequential — see the `RERANK_CONCURRENCY` comment in `engine.ts`) so a full pass over N applicants doesn't take N × 15s in the worst case.

---

## Embedding provider (`embeddings/provider.ts`)

```typescript
interface EmbeddingProvider {
  name: string;
  model: string;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}
```

Matching always embeds via the OpenAI API (`OPENAI_API_KEY`, `EMBEDDING_MODEL` — default `text-embedding-3-small`). There is deliberately no local/self-hosted option — matching is the one place in this codebase where output quality and consistency matter more than avoiding API cost. A future non-matching feature that wants a local model gets its own client rather than a branch of this one.

> **Why not Claude / Anthropic?** Anthropic does not offer a public embeddings API.

---

## Score output

`scorer.ts`'s raw output (internal, pre-rerank):

```typescript
interface MatchScore {
  score: number;                     // composite weighted score in [0, 1]
  breakdown: Record<string, number>; // named per-component scores + age_modifier
}
```

Breakdown keys: `numeric_compatibility`, `lifestyle_similarity`, `character_cross_match`, `character_a_wants_b`, `character_b_wants_a`, `deal_breaker_penalty`, `age_modifier`. All values are rounded to two decimal places.

`engine.ts`'s `getCandidates()`/`runFullMatchingPass()` return the post-rerank shape — `breakdown` here is still the embedding-stage breakdown above (kept for debugging), but `score` is now the LLM-derived number:

```typescript
interface RankedCandidate {
  alias: string;
  applicantId: string;
  score: number;            // displayed score (0-1) — from the LLM rerank stage,
                             // or the embedding score unchanged if reranking failed
  breakdown: Record<string, number>;
  embeddingScore: number;   // the pre-rerank embedding-cosine score — debug/transparency only
  llmReasoning: string;     // short grounded explanation from the rerank stage; "" if unavailable
}
```

This `score` field is what flows unchanged through `proposals.ts` → `match.service.ts` → `MatchDoc.score` → the frontend — only what computes it changed when the rerank stage was added. `llmReasoning` flows the same path (`CoupleProposal.llmReasoning` → `MatchDoc.llmReasoning` → `ApplicantMatchView.llmReasoning`) and is rendered as a pull-quote at the top of `MatchCard.tsx` once a candidate becomes an actual proposed match — `embeddingScore` does not flow anywhere past `RankedCandidate`; it's debug/transparency only for the admin candidate-list view.

---

## Extending the pipeline

**Add a new hard filter:**
1. Create `filters/my-filter.ts` exporting a `isCompatible(a, b): boolean` function.
2. Call it in `engine.ts` inside `applyFilters()`.

**Change scoring weights:**
- Edit `scoring/weights.ts`. The values must sum to 1.0.

**Change embedded text composition:**
- Update `buildTexts()` in `services/embedding.service.ts`.
- Bump `CURRENT_TEXT_VERSION` in the same file (triggers automatic re-embed for all applicants on next run).

**Add a second scorer:** the engine calls `prepare()` and `score()` directly from `scorer.ts`. To swap or A/B-test a different algorithm, change those imports in `engine.ts`.

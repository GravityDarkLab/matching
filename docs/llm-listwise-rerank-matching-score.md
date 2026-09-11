# Replacing embedding-cosine matching scores with LLM listwise reranking

**Status:** Implemented on `feat/matching-overhaul` ([PR #10](https://github.com/GravityDarkLab/Ons/pull/10)). This document records the problem, the literature consulted, the alternatives considered and rejected, the chosen design, and what has and hasn't been empirically validated.

**Superseded detail:** the dual-provider mechanism described below (`CHAT_PROVIDER`/`CHAT_BASE_URL`/`EMBEDDING_PROVIDER`/`EMBEDDING_BASE_URL`, local-model tuning) was later removed — matching now always calls OpenAI directly (see `api/src/matching/embeddings/provider.ts`, `api/src/services/ai.service.ts`). The problem analysis, rubric design, and empirical findings below are unaffected; only the provider-selection mechanics changed.

## Abstract

Ons's matching engine scored every candidate pair as a weighted sum of `cosine(...)` terms over dense text embeddings and a small hand-built numeric vector. In production use, no pair — including objectively strong ones — ever scored above roughly 80%. We show this is not a tuning artifact but a structural property of cosine similarity over learned embeddings: anisotropy in the embedding space and a non-negative-orthant bias in the numeric vector both inflate the *baseline* similarity between unrelated content, and an inverted deal-breaker term compounds this into a hard ceiling around 0.85. We surveyed six remediation strategies — three that recalibrate or fix the existing cosine pipeline, two that replace it outright (a pointwise LLM judge, a fully structured no-embedding scorer), and one hybrid — and adopted the hybrid: the existing embedding pipeline is kept for cheap, broad shortlisting, and a single LLM call per applicant reranks that shortlist *listwise* (all candidates scored together against an anchored rubric, not one at a time), which is both cheaper and more reliable for LLMs than pointwise scoring. The change required no changes to any downstream consumer of the score (proposal generation, persistence, or the frontend), because the field's name and scale were preserved — only its computation changed.

## 1. Problem statement

`api/src/matching/scorer.ts` computes a compatibility score in `[0, 1]` as:

```
score = 0.22 · numeric          + 0.22 · lifestyle
      + 0.35 · character_cross  + 0.21 · deal_breakers
score *= age_modifier
```

where `numeric`, `lifestyle`, and `character_cross` are cosine similarities of dense text/feature embeddings, and `deal_breakers = 1 - cosine(A.deal_breakers, B.profile)`.

**Observation:** across every matching run the platform had produced, no candidate pair scored above ~0.80, regardless of how well-aligned the underlying profiles actually were. This is the empirical trigger for the investigation below; it was not something we set out to measure formally, but it was consistent enough across runs to treat as a real signal rather than noise, and the diagnosis in §2 explains exactly why it would be expected to hold in general, not just by chance in this particular dataset.

## 2. Diagnosis: why cosine-based scores are structurally capped

### 2.1 Embedding anisotropy

Learned text embeddings do not spread isotropically (uniformly in all directions) through their vector space — they cluster into a narrow cone. A direct consequence is that the cosine similarity between two *unrelated* embedded texts is substantially higher than 0, commonly in the 0.6–0.75 range, purely as an artifact of the embedding geometry rather than any real semantic relationship.

- Ethayarajh, K. (2019). *How Contextual are Contextualized Word Representations? Comparing the Geometry of BERT, ELMo, and GPT-2 Embeddings.* EMNLP-IJCNLP 2019.
- Gao, J., He, D., Tan, X., Qin, T., Wang, L., & Liu, T.-Y. (2019). *Representation Degeneration Problem in Training Natural Language Generation Models.* ICLR 2019.
- Steck, H., Ekanadham, C., & Kallus, N. (2024). *Is Cosine-Similarity of Embeddings Really About Similarity?* [arXiv:2403.05440](https://arxiv.org/abs/2403.05440). This is the most directly applicable citation: it argues explicitly that cosine similarity computed on learned embeddings is not a calibrated measure of semantic similarity in the [-1, 1] sense most engineers assume, and that using it as one without correction produces systematically biased results — exactly the failure mode observed here.

### 2.2 Non-negative-orthant bias

Independent of embeddings, `scorers/numeric.scorer.ts`'s `buildNumericVector()` encodes structured preferences (relationship type, long-distance willingness, affection level, religion openness) as a 5-dimensional vector with **all non-negative entries**. Cosine similarity between any two vectors confined to a single orthant (here, the non-negative one) can never be negative — the geometry itself biases the result upward regardless of how mismatched the underlying preferences are. This is a basic property of cosine similarity over non-negative vectors and is well known in information retrieval, where term-frequency vectors have the same property.

### 2.3 The compounding deal-breaker term

The deal-breaker component is defined as an *inversion*:

```
deal_breaker_score = 1 - cosine(A.deal_breakers_embedding, B.profile_embedding)
```

Because baseline cosine similarity between unrelated content already sits around 0.6–0.75 (§2.1), this term caps near 0.25–0.4 *even for a pair with zero genuine overlap between A's stated deal-breakers and B's profile* — the inversion is applied on top of an already-inflated floor, not a true zero. At 21% weight, this single term alone is enough to cap the entire weighted sum well under 1.0 in the best realistic case.

**Net effect:** the weighted sum is built almost entirely out of terms whose *realistic* ceiling is approximately 0.85, not 1.0. This is sufficient to fully explain the empirical observation in §1 without needing to invoke any flaw in the underlying matches themselves.

## 3. Background and related work

### 3.1 Calibrating embedding similarity

Beyond Steck et al. (2024) above, two standard techniques exist for correcting anisotropy directly in the embedding space rather than in the downstream score:

- Mu, J., & Viswanath, P. (2018). *All-but-the-Top: Simple and Effective Postprocessing for Word Representations.* ICLR 2018. Removes the dominant principal component(s) of a representative embedding corpus (and mean-centers), measurably improving isotropy and the discriminative power of cosine similarity on the corrected vectors.
- Per-pool empirical rescaling (min-max or z-score normalization of observed scores) is standard practice in information retrieval and recommender systems for converting an uncalibrated similarity score into a comparable range relative to the population actually being ranked, rather than against an arbitrary fixed anchor.

### 3.2 LLM-as-judge and its own calibration failure

Using an LLM to directly judge compatibility (rather than computing geometry over embeddings) is well-established for evaluation tasks broadly:

- Zheng, L., Chiang, W.-L., Sheng, Y., et al. (2023). *Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena.* NeurIPS 2023.

However, LLMs asked to produce an *absolute*, pointwise score in isolation (e.g., "rate this 0–100") exhibit a distinct, independently-documented calibration failure: they avoid extreme values and cluster ratings into a narrow middle band — the same *symptom* as §2, produced by a completely different *mechanism* (a property of the model's own scoring behavior, not of the embedding geometry).

- Liu, Y., Iter, D., Xu, Y., Wang, S., Xu, R., & Zhu, C. (2023). *G-Eval: NLG Evaluation using GPT-4 with Better Human Alignment.* EMNLP 2023.
- *Large Language Models are Inconsistent and Biased Evaluators.* [arXiv:2405.01724](https://arxiv.org/abs/2405.01724).
- *Evaluating Scoring Bias in LLM-as-a-Judge.* [arXiv:2506.22316](https://arxiv.org/abs/2506.22316).

The G-Eval line of work also identifies the practical mitigation adopted in this design: providing explicit descriptions of what the *extreme* values of a scale mean is sufficient to make LLM scoring use the full range reliably, without requiring heavier statistical normalization.

### 3.3 Bi-encoders, cross-encoders, and listwise reranking

The existing architecture (embed each side independently, then compare with cosine) is a **bi-encoder** in information-retrieval terminology — fast, but unable to let either side's text inform how the other is read, because neither side ever sees the other.

- Reimers, N., & Gurevych, I. (2019). *Sentence-BERT: Sentence Embeddings using Siamese BERT-Networks.* EMNLP-IJCNLP 2019. Names this exact bi-encoder/cross-encoder accuracy-vs-speed trade-off and establishes the standard mitigation: use the cheap bi-encoder for a first-pass retrieval, then a more expensive model that reads both texts jointly ("cross-encoder") to rerank just the shortlist.
- Nogueira, R., & Cho, K. (2019). *Passage Re-ranking with BERT.* [arXiv:1901.04085](https://arxiv.org/abs/1901.04085). Establishes the retrieve-then-rerank pattern concretely in IR.

No off-the-shelf cross-encoder exists for romantic-compatibility judgment (cross-encoders in IR are trained on query–passage relevance, a different task, and no fine-tuning data for this task exists). The only model capable of reading both sides of a comparison jointly here is an LLM — which converges this approach with §3.2, with the same calibration caveat.

For the specific question of *how* to prompt an LLM to rerank a list reliably, two results are directly relevant and motivate the chosen design:

- Sun, W., Yan, L., Ma, X., et al. (2023). *Is ChatGPT Good at Search? Investigating Large Language Models as Re-Ranking Agents.* EMNLP 2023 (**Outstanding Paper Award**). Commonly cited as "RankGPT." Shows LLMs given a *list* of candidates to rank against each other substantially outperform LLMs scoring candidates one at a time in isolation.
- Qin, Z., Jagerman, R., Hui, K., et al. (2023, published 2024). *Large Language Models are Effective Text Rankers with Pairwise Ranking Prompting.* Findings of NAACL 2024 / [arXiv:2306.17563](https://arxiv.org/abs/2306.17563). Independently confirms that giving an LLM comparison points (pairwise or listwise) produces materially more reliable rankings than asking for an isolated pointwise score.

### 3.4 Structured, embedding-free matching

A real, widely-known precedent exists for scoring compatibility with **no** embeddings or learned vector geometry at all: OkCupid's publicly described match-percentage system asks users structured multiple-choice questions, each carrying a self-assigned importance weight (none / a little / somewhat / very / mandatory), and computes the match percentage as a direct weighted-agreement calculation between two users' answers and stated preferences. There is no academic paper behind this — it is documented in OkCupid's own public explanations and independent write-ups (e.g. the AMS Mathematics blog's breakdown, ["OkCupid: The Math Behind Online Dating"](https://blogs.ams.org/mathgradblog/2016/06/08/okcupid-math-online-dating/)) — but it is a genuine, deployed-at-scale precedent for sidestepping the entire anisotropy problem by never embedding free text in the first place.

### 3.5 Embedding instruction prefixes (explored, not adopted)

Before settling on the LLM-rerank approach, we investigated whether the existing embedding step could be improved through **task-instruction prefixes**, a technique used by some embedding model families to differentiate "query" and "document" roles in the same vector space:

- Wang, L., Yang, N., Huang, X., et al. (2022). *Text Embeddings by Weakly-Supervised Contrastive Pre-training.* [arXiv:2212.03533](https://arxiv.org/abs/2212.03533). The E5 family — `query: ` / `passage: ` prefixes for asymmetric retrieval, `query: ` on both sides for symmetric similarity.
- Nomic AI's `nomic-embed-text-v1.5` model card documents an analogous, more granular scheme: `search_query:` / `search_document:` for asymmetric retrieval, `clustering:` for symmetric similarity/clustering tasks.

This was directly relevant in principle: the scorer's character-cross-match term (`cosine(A.preference, B.profile)`) is exactly the asymmetric "query vs. document" shape these conventions target. It was **not adopted**, for a deployment-fit reason rather than a technical one: this prefix convention is documented for specific local/open-weight model families (Nomic, E5) and explicitly *not* documented or recommended by OpenAI for `text-embedding-3-*` (confirmed directly against OpenAI's current embeddings documentation) — and the project's actual production target is OpenAI (with local models used only for development). Applying the prefix scheme would have added real complexity (separate embedding calls for the same text under different task roles) for a benefit that only materializes if the deployment ever switches its embedding provider to one of those specific model families.

## 4. Alternatives considered

| # | Approach | Fixes | Rejected because |
|---|---|---|---|
| A | Per-run min-max rescaling of the existing cosine scores | The *displayed number's* calibration | Cheap and correct, but only treats the symptom — doesn't change which candidates get ranked highly in the first place, and degenerates at very small candidate-pool sizes |
| B | Global anisotropy correction ("All-but-the-Top": mean-center + remove top principal component) | The *root geometric cause*, for every downstream use of the embeddings | More correct than A in principle, but meaningfully heavier to implement (a corpus-wide centroid recomputed per run, plus a PCA/power-iteration step) and validate, for the same underlying problem A addresses more cheaply |
| C | Pointwise LLM-as-judge (no embeddings) | Replaces geometry with reasoning, captures nuance/complementary traits | LLMs scoring in isolation have their own central-tendency bias (§3.2) — the same symptom via a different mechanism — and a full matching pass costs O(N²) LLM calls (one per pair) |
| D | Dedicated cross-encoder reranker | The bi-encoder's "neither side sees the other" limitation | No cross-encoder exists for this task and no fine-tuning data exists to train one; without one, the only model that can jointly read both profiles is an LLM, which collapses this option into C/F |
| E | Fully structured, no-embedding, no-LLM scoring (OkCupid-style) | Anisotropy entirely, by construction; fully interpretable; zero ongoing inference cost | Today's richest signal lives in free-text answers (`lifestyle`, `vibe_words`, `dream_first_date`, `deal_breakers`); keyword-based comparison would miss synonymy entirely (e.g. "loves quiet nights in" vs. "homebody"). This is really a questionnaire redesign, not a scoring fix, and a substantially larger undertaking than the others |
| F | **Hybrid: keep the embedding shortlist, add an LLM listwise rerank stage** | Both the calibration failure (§2) and C's pointwise bias (§3.2), by combining cheap broad ranking with reliable narrow judgment | — (chosen) |

**Why F over A/B:** A and B are legitimate, cheaper fixes for the *same* geometric problem, but both only repair the calibration of a number that is fundamentally a measurement of embedding overlap. F replaces what's being measured with something that can reason about complementary traits and genuine deal-breakers the way a human matchmaker would — a richer signal, once the LLM's own calibration failure is accounted for via listwise framing and an anchored rubric.

## 5. Chosen design

### 5.1 Two-stage architecture

```
Stage 1 (bi-encoder shortlist, unchanged)
  scorer.ts: cosine over embeddings + the numeric vector, as described in §1–2.
  Cheap, O(N) embedding calls across the whole applicant pool.
  This score is now an internal signal only — used to build a shortlist,
  never shown to a user.

Stage 2 (LLM listwise rerank, new — api/src/services/match-rerank.service.ts)
  One LLM call per applicant, covering that applicant's whole shortlist
  (max(topN, 15) candidates) at once.
  Structured output: { candidateId, score (0-100), reasoning } per candidate,
  scored against an explicit anchored rubric.
  Re-sorts the shortlist by this score — this is what's actually displayed.
```

### 5.2 Prompt and rubric

The rubric explicitly anchors the extremes and middle of the scale (per the G-Eval finding in §3.2 that this alone is sufficient for reliable LLM scoring):

```
90-100: rare, near-ideal overlap across values, lifestyle, and what each person is looking for
70-89:  strong compatibility with minor differences
50-69:  average — some genuine alignment, some real friction
30-49:  significant mismatches in core preferences or lifestyle
0-29:   fundamental incompatibility
```

All candidates in a shortlist are presented to the model together in one prompt (listwise, per §3.3), each tagged with its applicant ID, alongside an explicit instruction to ground the score only in stated information.

### 5.3 Structured outputs and temperature

The LLM call uses OpenAI's Structured Outputs (`response_format: json_schema`, strict mode) — confirmed to also be honored by LM Studio's OpenAI-compatible server, though not by Ollama's (which expects its own `format` parameter; the request is simply ignored there rather than erroring, with no behavioral regression). Temperature is requested at 0.3 — a grounded judgment call, not creative generation — but this is only honored on providers that accept a non-default value; see §5.7 for the OpenAI exception.

### 5.4 Caching

Reranking is cached per applicant in a new `match_reranks` MongoDB collection, keyed by a hash of the shortlist's composition (candidate IDs + their embedding-stage scores) plus the chat model in use — so repeated admin views of the same candidate list don't repeat the LLM call, and the cache invalidates automatically whenever the underlying pool or ranking shifts.

### 5.5 Failure handling

The rerank function is designed to never throw and never block the matching pipeline. On any failure — an empty or malformed LLM response, a candidate missing from the response, an out-of-range or non-numeric score, or a cache read/write error — it falls back to that *specific* candidate's Stage 1 embedding score, individually. A partial LLM response degrades only the affected candidates, not the entire shortlist.

### 5.6 Latency and concurrency

Each LLM call has a timeout (30s default, overridable per call — the rerank call requests 45s, since real chain-of-thought across a 15-candidate prompt takes longer than a quick pairwise prompt; an earlier 15s default, sized for fast local inference, produced a real `TimeoutError` once tested against a hosted reasoning model). A full matching pass batches rerank calls at a concurrency of 5 applicants at a time rather than either fully sequential or fully unbounded, bounding worst-case wall-clock time for N applicants to `ceil(N/5) × timeout` instead of `N × timeout`.

### 5.7 Provider-specific request shaping

Two providers ended up needing genuinely different request shapes, both discovered empirically (HTTP 400s with explicit error messages, not guessed):

- **Chat and embedding providers are configured independently** (`CHAT_PROVIDER`/`CHAT_BASE_URL`, defaulting to `EMBEDDING_PROVIDER`/`EMBEDDING_BASE_URL` when unset) — so already-cached local embeddings don't need to be recomputed just to swap which model handles chat completions, and vice versa.
- **OpenAI's o-series and entire gpt-5.x family are "reasoning models"** that reject `max_tokens` (require `max_completion_tokens` instead) and reject any non-default `temperature`/`top_p`/penalty value outright, fixed at their own default. Both are branched on `chatProvider` rather than a model-name allowlist, since the set of OpenAI models in this restricted tier changes over time.
- **The rankings array's `minItems`/`maxItems`** (enforced at the JSON-schema level, forcing a schema-to-grammar translator to keep the array open until every candidate has an entry — see the listwise-completeness failure mode below) is sent only for the local provider. OpenAI's hosted strict mode doesn't document support for these array keywords and could plausibly reject the request outright; this was left untested against the real API once a hosted model turned out not to need it (see §7's second measurement — plain-text "respond with an entry for every candidate" was sufficient for `gpt-5.4-mini` to return the correct count in the large majority of calls).

## 6. Implementation summary

Full file-by-file detail lives in [`api/src/matching/README.md`](../api/src/matching/README.md) (the operational reference) — this document is the *why*, that one is the *what/where*. In brief: `api/src/matching/scorer.ts` is unchanged; `api/src/services/match-rerank.service.ts` is the new Stage 2; `api/src/matching/engine.ts`'s `applyRerank()` wires the two stages together; `RankedCandidate` gained `embeddingScore` (the retained Stage 1 signal) and `llmReasoning`, while `score` itself kept its name, type, and `[0, 1]` scale — meaning `proposals.ts`, `match.service.ts`, `MatchDoc.score`, and every frontend component that already renders that field required **zero changes**.

## 7. Evaluation

**What has been verified:**
- 540 automated tests (unit tests for the rerank service's prompt construction, cache-key hashing, response parsing, and every documented failure/fallback path; full regression suite for the rest of the matching pipeline), all passing.
- Full TypeScript type-checking across both workspaces.
- Every commit in the implementing range individually builds and passes its tests in a fresh clean-clone simulation, not just the final state of the branch.
- Independent two-stage code review (spec-compliance, then code-quality) of every change, plus a final holistic review of the complete feature together.

**What has not yet been empirically measured, and should be before treating this as fully validated:** an actual before/after comparison of the score *distribution* produced against a real or representative applicant pool — i.e., confirming that the new scores genuinely spread across a wider, more human-meaningful range (and specifically that strong pairs now score meaningfully above 80%) rather than asserting it from the design reasoning alone. The diagnosis in §2 and the design in §5 are theoretically well-grounded, but theory is not the same as a measurement, and this document should not be read as claiming one was taken.

A concrete way to run that evaluation, for whoever does it next: take a snapshot of the current applicant pool (or a synthetic pool built from the seed script), run `runFullMatchingPass()` once with the rerank stage disabled (Stage 1 scores only) and once with it enabled, and compare the two resulting score distributions — histogram, min/max/mean, and specifically how many pairs clear the existing `scoreThreshold` default of 0.8. That comparison is what would turn the diagnosis in §2 from "structurally should be true" into "measured to be true in this deployment." `bun run eval:rerank` (root `package.json`) implements exactly this — it runs one pass and prints both numbers per candidate side by side, since `RankedCandidate` already carries both.

### First measurement

Run against a synthetic pool of 100 seeded applicants (`bun run seed applicants`), local embedding model `text-embedding-qwen3-embedding-0.6b`, local chat model, 209 candidate pairs evaluated:

| | min | p50 | mean | p90 | max | ≥ 0.8 |
|---|---|---|---|---|---|---|
| `embeddingScore` (Stage 1, old) | 0.000 | 0.630 | 0.587 | 0.660 | 0.690 | 0/209 (0.0%) |
| `score` (Stage 2, LLM-reranked) | 0.000 | 0.660 | 0.670 | 0.900 | 0.900 | 58/209 (27.8%) |

This is consistent with the §2 diagnosis: the old score's *entire* distribution sits under 0.69 — not one pair in this pool would ever have cleared the 0.8 `scoreThreshold` default, regardless of how compatible any pair actually was. The new score spreads the same pool from 0.0 to 0.9, with over a quarter of pairs now clearing 0.8. Sampled `llmReasoning` text was grounded in the actual profile fields (shared religion, lifestyle compatibility, named deal-breakers), not generic filler.

**Caveat that needs follow-up before trusting this number at face value:** 90 of the 209 pairs (43.1%) fell back to the embedding score with no LLM reasoning at all — far above the "expect 0% with a healthy provider" baseline stated above. This run used a local chat model serving a 15-candidate listwise prompt; the most likely explanation is that model struggling to produce a fully valid structured-output response for every candidate in one call, not a problem with the design itself (the *fallback* mechanism is working exactly as intended — it's masking a separate reliability issue with this particular local model/prompt-size combination rather than corrupting the result). The headline numbers above are **not free of this skew**: the `score` row blends real LLM judgments with same-as-before embedding fallbacks for 43% of pairs, meaning the true post-rerank distribution (if the LLM had succeeded on every pair) is likely shifted even further from the old distribution than this run shows. Re-running against a more capable model (or a smaller shortlist size) and checking whether the fallback rate drops is the natural next step, not yet done.

### Second measurement — hosted model, fallback rate resolved

Investigating the first measurement's 43.1% fallback rate (and a follow-up local model run that got *worse*, 79.9–98.1%) led to diagnosing and fixing five separate mechanical issues, in order — all via §5.7's provider-specific request shaping: (1) no visibility into *why* calls were falling back — added logging at every failure point; (2) the actual cause turned out to be the model returning 1-2 entries regardless of shortlist size (1 to 15 tested) — root-caused to grammar-constrained decoding never being told a required array length, fixed by adding `minItems`/`maxItems` to the schema (local provider only); (3) switching to a hosted model (`gpt-5.4-mini` via `CHAT_PROVIDER=openai`, embeddings kept local) surfaced three more issues specific to OpenAI's current reasoning-model tier: `max_tokens` rejected outright (needs `max_completion_tokens`), `temperature` rejected outright (fixed at the default for the whole o-series/gpt-5.x family), and a 15s timeout that was sized for fast local inference, not real chain-of-thought across 15 candidates (see §5.6). All five were diagnosed from actual error messages and response payloads, not guessed.

Same 100-applicant pool, same embeddings (local, unchanged), `gpt-5.4-mini` for the rerank stage:

| | min | p50 | mean | p90 | max | ≥ 0.8 |
|---|---|---|---|---|---|---|
| `embeddingScore` (Stage 1, old) | 0.000 | 0.630 | 0.575 | 0.660 | 0.690 | 0/209 (0.0%) |
| `score` (Stage 2, LLM-reranked) | 0.180 | 0.620 | 0.614 | 0.840 | 0.980 | 31/209 (14.8%) |

Fallback rate: 9/209 (4.3%) — down from 43.1%/79.9%/98.1% across the three prior local-model attempts, and for a materially better reason: these 9 are individual candidates a 13-to-15-candidate call didn't address, not whole-call failures.

This is the cleanest evidence yet for the §2 diagnosis, and for a reason beyond the raw numbers: **the LLM score moves in both directions, not just up.** A few examples from this run, `embeddingScore → score`:
- 0.67 → 0.84 ("both want short term, both non-smokers... shared preference for active dates") — a pair the old score under-rated.
- 0.64 → 0.22 ("social smoker and wine lover, which clashes with the target's non-smoker preference... smoking-related dealbreaker") — a pair the old score over-rated, because cosine similarity on embedded text has no way to represent a hard dealbreaker as a hard dealbreaker; it can only nudge a similarity number.
- 0.64 → 0.43 ("the target wants Short Term while the candidate wants Long Term, and the target is Muslim while the candidate is Hindu") — same pattern: real, stated incompatibilities the old score couldn't see as incompatibilities.

That bidirectional correction is the actual point of replacing the measurement, not just rescaling it (§4, why F was chosen over A/B): a pool-relative rescaling of the old cosine scores could only ever stretch the *existing* ranking across more of the [0,1] range — it has no mechanism to re-order pairs based on information the embedding geometry never captured in the first place, like a stated relationship-type mismatch or a named dealbreaker. Here the reordering is visible directly in the sampled reasoning.

## 8. Limitations and future work

- **Stage 1's calibration issue isn't fully gone, only hidden from the user.** It no longer affects the *displayed* score (Stage 2 replaces that), but it can still bias *which candidates make the shortlist* in the first place — a recall concern rather than a precision one. Layering Approach A's cheap per-pool min-max rescaling onto Stage 1 would improve shortlist quality independently of this change, and is a reasonable follow-up rather than something this design depended on.
- **Cost and latency are real, not zero.** Stage 1 is free after the one-time embedding step; Stage 2 adds one genuine LLM call per applicant per matching run, bounded but not eliminated by the concurrency cap in §5.6.
- **Non-determinism.** Two runs over an identical shortlist can produce slightly different scores or ordering. Bounded by the anchored rubric on every provider, and additionally by low temperature on local providers — OpenAI's current reasoning-model tier rejects a non-default temperature outright, so that particular lever isn't available there (§5.7); the rubric is doing more of the calibration work on that provider as a result.
- **No native Anthropic chat support yet.** The chat-completion layer (`ai.service.ts`) currently speaks only the OpenAI-compatible REST shape; adding native Claude support (a different request/response shape, structured output via forced tool-use rather than `response_format`) was explicitly scoped out of this change and would be its own follow-up if the production deployment target changes.
- **`icebreaker.service.ts` intentionally was not unified onto the same profile-snippet helper as the rerank/summary services** — it needs a narrower, different set of profile fields for generating conversation starters, and forcing it onto the shared helper would have been a real (unrequested) change to its output, not a pure refactor.

## References

1. Ethayarajh, K. (2019). *How Contextual are Contextualized Word Representations? Comparing the Geometry of BERT, ELMo, and GPT-2 Embeddings.* EMNLP-IJCNLP 2019.
2. Gao, J., He, D., Tan, X., Qin, T., Wang, L., & Liu, T.-Y. (2019). *Representation Degeneration Problem in Training Natural Language Generation Models.* ICLR 2019.
3. Steck, H., Ekanadham, C., & Kallus, N. (2024). *Is Cosine-Similarity of Embeddings Really About Similarity?* [arXiv:2403.05440](https://arxiv.org/abs/2403.05440)
4. Mu, J., & Viswanath, P. (2018). *All-but-the-Top: Simple and Effective Postprocessing for Word Representations.* ICLR 2018.
5. Zheng, L., Chiang, W.-L., Sheng, Y., et al. (2023). *Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena.* NeurIPS 2023.
6. Liu, Y., Iter, D., Xu, Y., Wang, S., Xu, R., & Zhu, C. (2023). *G-Eval: NLG Evaluation using GPT-4 with Better Human Alignment.* EMNLP 2023.
7. *Large Language Models are Inconsistent and Biased Evaluators.* [arXiv:2405.01724](https://arxiv.org/abs/2405.01724)
8. *Evaluating Scoring Bias in LLM-as-a-Judge.* [arXiv:2506.22316](https://arxiv.org/abs/2506.22316)
9. Reimers, N., & Gurevych, I. (2019). *Sentence-BERT: Sentence Embeddings using Siamese BERT-Networks.* EMNLP-IJCNLP 2019.
10. Nogueira, R., & Cho, K. (2019). *Passage Re-ranking with BERT.* [arXiv:1901.04085](https://arxiv.org/abs/1901.04085)
11. Sun, W., Yan, L., Ma, X., et al. (2023). *Is ChatGPT Good at Search? Investigating Large Language Models as Re-Ranking Agents.* EMNLP 2023 (Outstanding Paper Award).
12. Qin, Z., Jagerman, R., Hui, K., et al. (2023/2024). *Large Language Models are Effective Text Rankers with Pairwise Ranking Prompting.* Findings of NAACL 2024 / [arXiv:2306.17563](https://arxiv.org/abs/2306.17563)
13. Wang, L., Yang, N., Huang, X., et al. (2022). *Text Embeddings by Weakly-Supervised Contrastive Pre-training.* [arXiv:2212.03533](https://arxiv.org/abs/2212.03533)
14. OkCupid match-percentage methodology, as publicly documented; see e.g. ["OkCupid: The Math Behind Online Dating"](https://blogs.ams.org/mathgradblog/2016/06/08/okcupid-math-online-dating/), AMS Mathematics Blog (2016).

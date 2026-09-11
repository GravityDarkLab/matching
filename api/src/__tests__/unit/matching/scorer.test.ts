import { describe, it, expect, beforeEach, mock } from "bun:test";

// Mock only the DB-touching embedding service. The provider singleton is
// never actually called (getOrComputeEmbeddings is fully mocked), so we
// leave provider.ts unmodified to avoid contaminating provider.test.ts.
mock.module("../../../services/embedding.service.js", () => ({
  embedApplicant: mock(async () => {}),
  getOrComputeEmbeddings: mock(async () => new Map()),
}));

import { prepare, score, hasEmbedding } from "../../../matching/scorer.js";
import { getOrComputeEmbeddings } from "../../../services/embedding.service.js";
import { makeApplicant, makeQuestionnaire, FULL_ANSWERS } from "./_fixtures.js";
import { ObjectId } from "mongodb";

const q = makeQuestionnaire();

// Helper to build unit vectors for controlled cosine tests
function unitVec(dim: number, index: number): number[] {
  const v = new Array(dim).fill(0);
  v[index] = 1.0;
  return v;
}

// Helper: builds a ScoreContext for given applicants via prepare()
async function prepareWithVecs(
  applicants: ReturnType<typeof makeApplicant>[],
  vecFn: (id: string) => { profile: number[]; preference: number[]; dealBreakers: number[] }
) {
  const embMap = new Map(
    applicants.map((a) => {
      const id = a._id.toHexString();
      return [
        id,
        {
          _id: new ObjectId(),
          applicantId: a._id,
          provider: "test",
          model: "test-model",
          textVersion: 2,
          createdAt: new Date(),
          ...vecFn(id),
        },
      ];
    })
  );

  (getOrComputeEmbeddings as ReturnType<typeof mock>).mockImplementation(async () => embMap);
  return prepare(applicants, q);
}

describe("scorer — score() without prepare()", () => {
  it("throws when the given context has no embeddings", async () => {
    const a = makeApplicant(FULL_ANSWERS);
    const b = makeApplicant(FULL_ANSWERS);
    const context = await prepareWithVecs([], () => ({ profile: [], preference: [], dealBreakers: [] }));
    expect(() => score(a, b, q, context)).toThrow(/prepare/i);
  });
});

describe("scorer — prepare() + score() pipeline", () => {
  it("does not throw after prepare() is called", async () => {
    const a = makeApplicant(FULL_ANSWERS);
    const b = makeApplicant(FULL_ANSWERS);

    const context = await prepareWithVecs([a, b], () => ({
      profile: [1.0, 0.0, 0.0],
      preference: [1.0, 0.0, 0.0],
      dealBreakers: [0.0, 0.0, 1.0],
    }));

    expect(() => score(a, b, q, context)).not.toThrow();
  });

  it("identical embedding vectors → score = 1.0", async () => {
    const a = makeApplicant(FULL_ANSWERS);
    const b = makeApplicant(FULL_ANSWERS);

    const sameVec = { profile: [1.0, 0.0], preference: [1.0, 0.0], dealBreakers: [0.0, 1.0] };
    const context = await prepareWithVecs([a, b], () => sameVec);

    const { score: s } = score(a, b, q, context);
    expect(s).toBe(1.0);
  });

  it("orthogonal profile vectors → lifestyle_similarity = 0", async () => {
    const a = makeApplicant(FULL_ANSWERS);
    const b = makeApplicant(FULL_ANSWERS);
    const ids = [a._id.toHexString(), b._id.toHexString()];

    const context = await prepareWithVecs([a, b], (id) => ({
      profile:      id === ids[0] ? unitVec(2, 0) : unitVec(2, 1), // orthogonal
      preference:   [1.0, 0.0],
      dealBreakers: [0.0, 1.0],
    }));

    const { breakdown } = score(a, b, q, context);
    expect(breakdown.lifestyle_similarity).toBe(0);
  });

  it("deal breaker overlapping profile → deal_breaker_penalty < 1", async () => {
    const a = makeApplicant(FULL_ANSWERS);
    const b = makeApplicant(FULL_ANSWERS);
    const ids = [a._id.toHexString(), b._id.toHexString()];

    // A's deal breakers = same direction as B's profile → high overlap = bad
    const context = await prepareWithVecs([a, b], (id) => ({
      profile:      id === ids[1] ? [1.0, 0.0] : [0.0, 1.0],
      preference:   [1.0, 0.0],
      dealBreakers: id === ids[0] ? [1.0, 0.0] : [0.0, 1.0], // A's breaks = B's profile
    }));

    const { breakdown } = score(a, b, q, context);
    expect(breakdown.deal_breaker_penalty).toBeLessThan(1.0);
  });

  it("score is always in [0, 1]", async () => {
    const a = makeApplicant(FULL_ANSWERS);
    const b = makeApplicant({ relationship_type: "Short Term", open_to_long_distance: false });

    const context = await prepareWithVecs([a, b], (id) => {
      const isA = id === a._id.toHexString();
      return {
        profile:      isA ? [1.0, 0.0] : [0.0, 1.0],
        preference:   isA ? [0.5, 0.5] : [1.0, 0.0],
        dealBreakers: isA ? [1.0, 0.0] : [0.0, 1.0],
      };
    });

    const { score: s } = score(a, b, q, context);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
  });

  it("score is rounded to 2 decimal places", async () => {
    const a = makeApplicant(FULL_ANSWERS);
    const b = makeApplicant(FULL_ANSWERS);
    const context = await prepareWithVecs([a, b], () => ({
      profile: [0.6, 0.8],
      preference: [0.3, 0.7],
      dealBreakers: [0.0, 1.0],
    }));

    const { score: s } = score(a, b, q, context);
    expect(s).toBe(Math.round(s * 100) / 100);
  });

  it("breakdown contains the expected keys including age_modifier", async () => {
    const a = makeApplicant(FULL_ANSWERS);
    const b = makeApplicant(FULL_ANSWERS);
    const context = await prepareWithVecs([a, b], () => ({
      profile: [1.0, 0.0],
      preference: [1.0, 0.0],
      dealBreakers: [0.0, 1.0],
    }));

    const { breakdown } = score(a, b, q, context);
    expect(Object.keys(breakdown)).toEqual(
      expect.arrayContaining([
        "numeric_compatibility",
        "lifestyle_similarity",
        "character_cross_match",
        "character_a_wants_b",
        "character_b_wants_a",
        "deal_breaker_penalty",
        "age_modifier",
      ])
    );
  });
});

describe("scorer — prepare() internals", () => {
  it("calls getOrComputeEmbeddings with the given applicants", async () => {
    const a = makeApplicant(FULL_ANSWERS);
    const b = makeApplicant(FULL_ANSWERS);

    const spy = getOrComputeEmbeddings as ReturnType<typeof mock>;
    spy.mockClear();
    await prepareWithVecs([a, b], () => ({
      profile: [1.0, 0.0],
      preference: [1.0, 0.0],
      dealBreakers: [0.0, 1.0],
    }));

    expect(spy).toHaveBeenCalledTimes(1);
    const [calledWith] = spy.mock.calls[0] as [typeof a[]];
    expect(calledWith).toHaveLength(2);
  });

  it("applicants with no stored embedding are not scored (cache miss is skipped)", async () => {
    const a = makeApplicant(FULL_ANSWERS);
    const b = makeApplicant(FULL_ANSWERS);

    // Return an empty map → no embeddings stored
    (getOrComputeEmbeddings as ReturnType<typeof mock>).mockResolvedValueOnce(new Map());
    const context = await prepare([a, b], q);

    // Both applicants missing from context -> score() should throw
    expect(() => score(a, b, q, context)).toThrow();
    expect(hasEmbedding(context, a)).toBe(false);
    expect(hasEmbedding(context, b)).toBe(false);
  });

  // Regression: prepare() used to mutate one shared module-level cache, so a
  // concurrent prepare() call (e.g. an admin opening a candidate-detail page
  // mid full-pass) could clear/overwrite another in-flight call's data.
  it("two prepare() calls for different applicant sets don't interfere with each other", async () => {
    const a = makeApplicant(FULL_ANSWERS);
    const b = makeApplicant(FULL_ANSWERS);
    const c = makeApplicant(FULL_ANSWERS);

    const contextAB = await prepareWithVecs([a, b], () => ({
      profile: [1.0, 0.0], preference: [1.0, 0.0], dealBreakers: [0.0, 1.0],
    }));
    // A second, independent prepare() call for a different applicant set —
    // simulates a concurrent request racing the first.
    const contextC = await prepareWithVecs([c], () => ({
      profile: [0.0, 1.0], preference: [0.0, 1.0], dealBreakers: [1.0, 0.0],
    }));

    // The first context must still work after the second prepare() call —
    // it was never cleared, because there is no shared cache to clear.
    expect(hasEmbedding(contextAB, a)).toBe(true);
    expect(hasEmbedding(contextAB, b)).toBe(true);
    expect(() => score(a, b, q, contextAB)).not.toThrow();
    expect(hasEmbedding(contextC, c)).toBe(true);
    expect(hasEmbedding(contextAB, c)).toBe(false); // c was never in contextAB
  });

  // Regression: a thrown getOrComputeEmbeddings (provider outage, DB error)
  // used to abort prepare() entirely, which aborted the whole matching pass
  // for every applicant. It must now degrade to an empty-ish context.
  it("does not throw when getOrComputeEmbeddings rejects — degrades to no embeddings available", async () => {
    const a = makeApplicant(FULL_ANSWERS);
    const b = makeApplicant(FULL_ANSWERS);

    (getOrComputeEmbeddings as ReturnType<typeof mock>).mockRejectedValueOnce(
      new Error("provider unavailable")
    );

    const context = await prepare([a, b], q);
    expect(hasEmbedding(context, a)).toBe(false);
    expect(hasEmbedding(context, b)).toBe(false);
  });
});

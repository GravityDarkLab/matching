// tested: embedding.service
//  - buildTexts — the embedding-relevant text derived from an applicant's
//    answers. profile.service.updateMyAnswers compares buildTexts(old) vs
//    buildTexts(new) to skip re-embedding when an edit doesn't touch
//    lifestyle/vibe_words/work/preferred_*/dream_first_date/deal_breakers.
//  - getOrComputeEmbeddings — cache/recompute behavior, and what survives a
//    provider failure. The DB collection and the provider are mocked.
import { describe, it, expect, mock, beforeEach } from "bun:test";
import { ObjectId } from "mongodb";
import type { EmbeddingDoc } from "../../../models/embedding.model.js";

const MODEL = "text-embedding-3-small";

let storedDocs: EmbeddingDoc[] = [];
const fakeEmbeddingsCol = {
  find: mock((_q: unknown) => ({ toArray: async () => storedDocs })),
  updateOne: mock(async (_f: unknown, _u: unknown, _o: unknown) => ({})),
};

mock.module("../../../db/connection.js", () => ({
  getDb: async () => ({}),
  closeDb: async () => {},
}));
mock.module("../../../db/collections.js", () => ({
  getEmbeddingsCollection: () => fakeEmbeddingsCol,
}));

const embedBatch = mock(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3]));
mock.module("../../../matching/embeddings/provider.js", () => ({
  getEmbeddingProvider: () => ({ name: "openai", model: MODEL, embed: async () => [], embedBatch }),
}));

// Dynamic so the module under test is evaluated after the mocks above.
const { buildTexts, getOrComputeEmbeddings } = await import("../../../services/embedding.service.js");

function applicant() {
  return { _id: new ObjectId(), answers: { lifestyle: "Active", work: "Engineer" } };
}

function storedDoc(applicantId: ObjectId, overrides: Partial<EmbeddingDoc> = {}): EmbeddingDoc {
  return {
    _id: new ObjectId(),
    applicantId,
    provider: "openai",
    model: MODEL,
    textVersion: 2, // CURRENT_TEXT_VERSION
    profile: [9, 9, 9],
    preference: [9, 9, 9],
    dealBreakers: [9, 9, 9],
    createdAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  storedDocs = [];
  fakeEmbeddingsCol.find.mockClear();
  fakeEmbeddingsCol.updateOne.mockReset();
  fakeEmbeddingsCol.updateOne.mockImplementation(async () => ({}));
  embedBatch.mockReset();
  embedBatch.mockImplementation(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3]));
});

describe("buildTexts", () => {
  it("joins profile fields with an em dash, skipping blanks", () => {
    const texts = buildTexts({ lifestyle: "Active", vibe_words: "", work: "Engineer" });
    expect(texts.profile).toBe("Active — Engineer");
  });

  it("produces identical output for unrelated-field-only edits", () => {
    const before = buildTexts({ lifestyle: "Active", location: "Paris", religion: "None" });
    const after = buildTexts({ lifestyle: "Active", location: "Berlin", religion: "Other" });
    expect(after).toEqual(before);
  });

  it("changes when an embedding-relevant field changes", () => {
    const before = buildTexts({ lifestyle: "Active" });
    const after = buildTexts({ lifestyle: "Laid back" });
    expect(after.profile).not.toBe(before.profile);
  });
});

describe("getOrComputeEmbeddings", () => {
  it("returns up-to-date stored embeddings without calling the provider", async () => {
    const a = applicant();
    storedDocs = [storedDoc(a._id)];

    const result = await getOrComputeEmbeddings([a]);

    expect(result.get(a._id.toHexString())?.profile).toEqual([9, 9, 9]);
    expect(embedBatch).not.toHaveBeenCalled();
  });

  it("recomputes and persists embeddings stored under a different model", async () => {
    const a = applicant();
    storedDocs = [storedDoc(a._id, { model: "text-embedding-qwen3-embedding-0.6b" })];

    const result = await getOrComputeEmbeddings([a]);

    expect(result.get(a._id.toHexString())).toMatchObject({ model: MODEL, profile: [0.1, 0.2, 0.3] });
    expect(fakeEmbeddingsCol.updateOne).toHaveBeenCalledTimes(1);
  });

  // Regression: on a provider failure, an outdated embedding from another
  // model used to be returned as-is and scored against current-model vectors
  // — a different vector space (1024 vs 1536 dims in practice), so cosine()
  // produced NaN or meaningless scores instead of skipping the applicant.
  it("on provider failure, drops embeddings from a different model (different vector space)", async () => {
    const a = applicant();
    storedDocs = [storedDoc(a._id, { model: "text-embedding-qwen3-embedding-0.6b" })];
    embedBatch.mockRejectedValue(new Error("429 insufficient_quota"));

    const result = await getOrComputeEmbeddings([a]);

    expect(result.has(a._id.toHexString())).toBe(false);
  });

  it("on provider failure, reuses an embedding that's only outdated on textVersion (same vector space)", async () => {
    const a = applicant();
    storedDocs = [storedDoc(a._id, { textVersion: 1 })];
    embedBatch.mockRejectedValue(new Error("timeout"));

    const result = await getOrComputeEmbeddings([a]);

    expect(result.get(a._id.toHexString())?.profile).toEqual([9, 9, 9]);
  });

  it("on provider failure, still returns up-to-date embeddings for everyone else", async () => {
    const fresh = applicant();
    const neverEmbedded = applicant();
    storedDocs = [storedDoc(fresh._id)];
    embedBatch.mockRejectedValue(new Error("503"));

    const result = await getOrComputeEmbeddings([fresh, neverEmbedded]);

    expect(result.has(fresh._id.toHexString())).toBe(true);
    expect(result.has(neverEmbedded._id.toHexString())).toBe(false);
  });

  it("uses freshly computed vectors for this run even when persisting them fails", async () => {
    const a = applicant();
    storedDocs = [storedDoc(a._id, { model: "text-embedding-qwen3-embedding-0.6b" })];
    fakeEmbeddingsCol.updateOne.mockRejectedValue(new Error("write conflict"));

    const result = await getOrComputeEmbeddings([a]);

    expect(result.get(a._id.toHexString())).toMatchObject({ model: MODEL, profile: [0.1, 0.2, 0.3] });
  });
});

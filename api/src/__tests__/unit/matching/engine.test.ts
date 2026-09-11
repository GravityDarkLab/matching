// tested: matching/engine.ts
//  - getActiveContactApplicantIds — applicants in an in_progress contact must
//    not be offered as candidates or receive new proposals on the next pass.
//  - getCandidates / runFullMatchingPass — orchestration around the scorer:
//    eligibility, embedding availability, ranking, rerank fallback, and
//    per-applicant degradation (one applicant's missing embedding or scoring
//    failure must never abort matching for everyone else).
//
// The hard filters run for real (empty answers pass all four); the scorer,
// the LLM rerank, the questionnaire lookup and the DB are mocked.
import { describe, it, expect, mock, beforeEach } from "bun:test";
import { ObjectId } from "mongodb";
import type { ApplicantDoc } from "../../../models/applicant.model.js";

// ── DB ────────────────────────────────────────────────────────────────────────

let inProgressMatches: Array<{ applicantAId: ObjectId; applicantBId: ObjectId }> = [];
let pool: ApplicantDoc[] = [];

const fakeMatchesCol = {
  find: mock((_filter: any, _opts?: any) => ({
    toArray: async () => inProgressMatches,
  })),
};

// Honors the predicates the engine actually queries with — status.$in (the
// active pool) and _id.$ne / _id — so the eligibility tests fail if the
// engine ever stops filtering out dating/inactive applicants.
const matchesStatus = (filter: any, a: ApplicantDoc) =>
  !filter.status?.$in || filter.status.$in.includes(a.status);
const fakeApplicantsCol = {
  find: mock((filter: any) => ({
    toArray: async () =>
      pool.filter((a) => matchesStatus(filter, a) && (!filter._id?.$ne || !a._id.equals(filter._id.$ne))),
  })),
  findOne: mock(async (filter: any) =>
    pool.find((a) => a._id.equals(filter._id) && matchesStatus(filter, a)) ?? null),
};

mock.module("../../../db/connection.js", () => ({
  getDb: async () => ({}),
  closeDb: async () => {},
}));

mock.module("../../../db/collections.js", () => ({
  COLLECTION_NAMES: {},
  getMatchesCollection:        () => fakeMatchesCol,
  getApplicantsCollection:     () => fakeApplicantsCol,
  getQuestionnairesCollection: () => ({}),
  getIdentitiesCollection:     () => ({}),
  getAuditLogsCollection:      () => ({}),
  getEmbeddingsCollection:     () => ({}),
  getAdminsCollection:         () => ({}),
  getAppConfigCollection:      () => ({}),
  getMatchReranksCollection:   () => ({}),
  ensureIndexes:               async () => {},
}));

// ── Questionnaire / scorer / rerank ──────────────────────────────────────────

let activeQuestionnaire: unknown = { version: "1.2.0" };
mock.module("../../../services/questionnaire.service.js", () => ({
  getActiveQuestionnaire: async () => activeQuestionnaire,
}));

// Aliases (not ids) drive the scorer fakes so tests read naturally.
let embedded = new Set<string>();
let pairScores: Record<string, number> = {};
let throwsFor = new Set<string>();

mock.module("../../../matching/scorer.js", () => ({
  prepare: mock(async (applicants: ApplicantDoc[]) => ({
    cache: new Map(applicants.filter((a) => embedded.has(a.alias)).map((a) => [a._id.toHexString(), {}])),
  })),
  hasEmbedding: (context: { cache: Map<string, unknown> }, a: ApplicantDoc) =>
    context.cache.has(a._id.toHexString()),
  score: (a: ApplicantDoc, b: ApplicantDoc) => {
    if (throwsFor.has(a.alias)) throw new Error(`scoring blew up for ${a.alias}`);
    return { score: pairScores[`${a.alias}>${b.alias}`] ?? 0.5, breakdown: { lifestyle_similarity: 0.5 } };
  },
}));

// Default: the LLM agrees with the embedding stage and explains itself.
type RerankInput = { doc: ApplicantDoc; embeddingScore: number }[];
const agreeingRerank = async (_target: ApplicantDoc, candidates: RerankInput) =>
  candidates.map((c) => ({ applicantId: c.doc._id.toHexString(), score: c.embeddingScore, reasoning: "llm" }));
const mockRerank = mock(agreeingRerank);
mock.module("../../../services/match-rerank.service.js", () => ({
  rerankCandidates: mockRerank,
}));

// Dynamic so the engine is evaluated after the mocks above.
const { getActiveContactApplicantIds, getCandidates, runFullMatchingPass } =
  await import("../../../matching/engine.js");

// ── Fixtures ──────────────────────────────────────────────────────────────────

function applicant(alias: string): ApplicantDoc {
  return {
    _id: new ObjectId(),
    alias,
    questionnaireVersion: "1.2.0",
    answers: {},
    status: "applied",
    magicToken: "a".repeat(64),
    passwordHash: null,
    scoreThreshold: 0.8,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function aliases(candidates: { alias: string }[]): string[] {
  return candidates.map((c) => c.alias);
}

beforeEach(() => {
  inProgressMatches = [];
  pool = [];
  activeQuestionnaire = { version: "1.2.0" };
  embedded = new Set();
  pairScores = {};
  throwsFor = new Set();
  fakeMatchesCol.find.mockClear();
  mockRerank.mockReset();
  mockRerank.mockImplementation(agreeingRerank);
});

// ── getActiveContactApplicantIds ──────────────────────────────────────────────

describe("getActiveContactApplicantIds", () => {
  it("returns an empty set when there are no in_progress matches", async () => {
    const ids = await getActiveContactApplicantIds();
    expect(ids.size).toBe(0);
  });

  it("returns both participants of an in_progress match", async () => {
    const a = new ObjectId();
    const b = new ObjectId();
    inProgressMatches = [{ applicantAId: a, applicantBId: b }];

    const ids = await getActiveContactApplicantIds();
    expect(ids).toEqual(new Set([a.toHexString(), b.toHexString()]));
  });

  it("dedupes participants across multiple in_progress matches", async () => {
    const a = new ObjectId();
    const b = new ObjectId();
    const d = new ObjectId();
    inProgressMatches = [
      { applicantAId: a, applicantBId: b },
      { applicantAId: a, applicantBId: d },
    ];

    const ids = await getActiveContactApplicantIds();
    expect(ids.size).toBe(3);
    expect(ids.has(a.toHexString())).toBe(true);
    expect(ids.has(b.toHexString())).toBe(true);
    expect(ids.has(d.toHexString())).toBe(true);
  });

  it("queries only matches with status in_progress", async () => {
    await getActiveContactApplicantIds();
    const [filter] = fakeMatchesCol.find.mock.calls[0] as any[];
    expect(filter.status).toBe("in_progress");
  });
});

// ── getCandidates ─────────────────────────────────────────────────────────────

describe("getCandidates", () => {
  it("throws 404 when there is no active questionnaire", async () => {
    activeQuestionnaire = null;
    await expect(getCandidates(new ObjectId().toHexString())).rejects.toMatchObject({ statusCode: 404 });
  });

  it("throws 400 for a malformed applicant id", async () => {
    await expect(getCandidates("not-an-object-id")).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws 404 when the target doesn't exist", async () => {
    await expect(getCandidates(new ObjectId().toHexString())).rejects.toMatchObject({ statusCode: 404 });
  });

  it.each(["dating", "inactive"] as const)("throws 404 when the target exists but is %s", async (status) => {
    const target = { ...applicant("Target"), status };
    pool = [target, applicant("Other")];
    embedded = new Set(["Target", "Other"]);

    await expect(getCandidates(target._id.toHexString())).rejects.toMatchObject({ statusCode: 404 });
  });

  it("offers only applied/matched applicants as candidates", async () => {
    const target = applicant("Target");
    pool = [
      target,
      applicant("Applied"),
      { ...applicant("Matched"), status: "matched" },
      { ...applicant("Dating"), status: "dating" },
      { ...applicant("Inactive"), status: "inactive" },
    ];
    embedded = new Set(pool.map((p) => p.alias));

    expect(aliases(await getCandidates(target._id.toHexString())).sort()).toEqual(["Applied", "Matched"]);
  });

  it("ranks scorable candidates by score, descending, and carries rerank reasoning", async () => {
    const target = applicant("Target");
    pool = [target, applicant("Low"), applicant("High"), applicant("Mid")];
    embedded = new Set(["Target", "Low", "High", "Mid"]);
    pairScores = { "Target>Low": 0.2, "Target>High": 0.9, "Target>Mid": 0.6 };

    const result = await getCandidates(target._id.toHexString());

    expect(aliases(result)).toEqual(["High", "Mid", "Low"]);
    expect(result[0]).toMatchObject({ score: 0.9, embeddingScore: 0.9, llmReasoning: "llm" });
  });

  it("respects topN", async () => {
    const target = applicant("Target");
    pool = [target, applicant("A"), applicant("B"), applicant("C")];
    embedded = new Set(["Target", "A", "B", "C"]);
    pairScores = { "Target>A": 0.3, "Target>B": 0.8, "Target>C": 0.5 };

    const result = await getCandidates(target._id.toHexString(), 2);

    expect(aliases(result)).toEqual(["B", "C"]);
  });

  it("returns [] when the target is in an active contact", async () => {
    const target = applicant("Target");
    pool = [target, applicant("Other")];
    embedded = new Set(["Target", "Other"]);
    inProgressMatches = [{ applicantAId: target._id, applicantBId: new ObjectId() }];

    expect(await getCandidates(target._id.toHexString())).toEqual([]);
  });

  it("excludes candidates who are in an active contact", async () => {
    const target = applicant("Target");
    const busy = applicant("Busy");
    pool = [target, busy, applicant("Free")];
    embedded = new Set(["Target", "Busy", "Free"]);
    inProgressMatches = [{ applicantAId: busy._id, applicantBId: new ObjectId() }];

    expect(aliases(await getCandidates(target._id.toHexString()))).toEqual(["Free"]);
  });

  it("returns [] when the target's own embedding couldn't be computed", async () => {
    const target = applicant("Target");
    pool = [target, applicant("Other")];
    embedded = new Set(["Other"]);

    expect(await getCandidates(target._id.toHexString())).toEqual([]);
  });

  it("skips candidates without an embedding instead of failing", async () => {
    const target = applicant("Target");
    pool = [target, applicant("Embedded"), applicant("Missing")];
    embedded = new Set(["Target", "Embedded"]);

    expect(aliases(await getCandidates(target._id.toHexString()))).toEqual(["Embedded"]);
  });

  it("excludes pairs rejected by a hard filter before scoring", async () => {
    const target = { ...applicant("Target"), answers: { sexual_orientation: "Straight", gender_identity: "Male" } };
    const woman = { ...applicant("Woman"), answers: { gender_identity: "Female" } };
    const man = { ...applicant("Man"), answers: { gender_identity: "Male" } };
    pool = [target, woman, man];
    embedded = new Set(["Target", "Woman", "Man"]);

    expect(aliases(await getCandidates(target._id.toHexString()))).toEqual(["Woman"]);
  });

  it("falls back to the embedding order and score when the rerank call throws", async () => {
    const target = applicant("Target");
    pool = [target, applicant("A"), applicant("B")];
    embedded = new Set(["Target", "A", "B"]);
    pairScores = { "Target>A": 0.4, "Target>B": 0.7 };
    mockRerank.mockRejectedValue(new Error("LLM down"));

    const result = await getCandidates(target._id.toHexString());

    expect(aliases(result)).toEqual(["B", "A"]);
    expect(result[0]).toMatchObject({ score: 0.7, llmReasoning: "" });
  });

  it("re-sorts by the reranked score when the LLM disagrees with the embedding stage", async () => {
    const target = applicant("Target");
    const a = applicant("A");
    const b = applicant("B");
    pool = [target, a, b];
    embedded = new Set(["Target", "A", "B"]);
    pairScores = { "Target>A": 0.9, "Target>B": 0.1 };
    mockRerank.mockImplementation(async () => [
      { applicantId: a._id.toHexString(), score: 0.2, reasoning: "weak" },
      { applicantId: b._id.toHexString(), score: 0.95, reasoning: "strong" },
    ]);

    const result = await getCandidates(target._id.toHexString());

    expect(aliases(result)).toEqual(["B", "A"]);
    expect(result[0]).toMatchObject({ score: 0.95, embeddingScore: 0.1, llmReasoning: "strong" });
  });
});

// ── runFullMatchingPass ───────────────────────────────────────────────────────

describe("runFullMatchingPass", () => {
  it("throws 404 when there is no active questionnaire", async () => {
    activeQuestionnaire = null;
    await expect(runFullMatchingPass()).rejects.toMatchObject({ statusCode: 404 });
  });

  it("returns {} with fewer than two active applicants", async () => {
    pool = [applicant("Solo")];
    expect(await runFullMatchingPass()).toEqual({});
  });

  it("returns {} when fewer than two applicants remain outside active contacts", async () => {
    const a = applicant("A");
    pool = [a, applicant("B")];
    inProgressMatches = [{ applicantAId: a._id, applicantBId: new ObjectId() }];

    expect(await runFullMatchingPass()).toEqual({});
  });

  it("scores every eligible applicant against every other one", async () => {
    const a = applicant("A");
    const b = applicant("B");
    const c = applicant("C");
    pool = [a, b, c];
    embedded = new Set(["A", "B", "C"]);

    const results = await runFullMatchingPass();

    expect(Object.keys(results).sort()).toEqual([a, b, c].map((x) => x._id.toHexString()).sort());
    expect(aliases(results[a._id.toHexString()]).sort()).toEqual(["B", "C"]);
  });

  it("includes only applied/matched applicants in the pass", async () => {
    const a = applicant("A");
    const dating = { ...applicant("Dating"), status: "dating" as const };
    const inactive = { ...applicant("Inactive"), status: "inactive" as const };
    pool = [a, { ...applicant("M"), status: "matched" }, dating, inactive];
    embedded = new Set(pool.map((p) => p.alias));

    const results = await runFullMatchingPass();

    expect(results[dating._id.toHexString()]).toBeUndefined();
    expect(results[inactive._id.toHexString()]).toBeUndefined();
    expect(aliases(results[a._id.toHexString()])).toEqual(["M"]);
  });

  it("leaves applicants in an active contact out of the pass entirely", async () => {
    const a = applicant("A");
    const busy = applicant("Busy");
    pool = [a, applicant("B"), busy];
    embedded = new Set(["A", "B", "Busy"]);
    inProgressMatches = [{ applicantAId: busy._id, applicantBId: new ObjectId() }];

    const results = await runFullMatchingPass();

    expect(results[busy._id.toHexString()]).toBeUndefined();
    expect(aliases(results[a._id.toHexString()])).toEqual(["B"]);
  });

  // Regression guard for the per-applicant degradation: a missing embedding
  // used to throw out of score() and abort the whole admin-triggered pass.
  it("gives an applicant without an embedding [] and leaves them out of everyone else's list", async () => {
    const a = applicant("A");
    const b = applicant("B");
    const missing = applicant("Missing");
    pool = [a, b, missing];
    embedded = new Set(["A", "B"]);

    const results = await runFullMatchingPass();

    expect(results[missing._id.toHexString()]).toEqual([]);
    expect(aliases(results[a._id.toHexString()])).toEqual(["B"]);
    expect(aliases(results[b._id.toHexString()])).toEqual(["A"]);
  });

  it("gives an applicant whose scoring throws [] without affecting the rest of their batch", async () => {
    const a = applicant("A");
    const broken = applicant("Broken");
    pool = [a, applicant("B"), broken];
    embedded = new Set(["A", "B", "Broken"]);
    throwsFor = new Set(["Broken"]);

    const results = await runFullMatchingPass();

    expect(results[broken._id.toHexString()]).toEqual([]);
    expect(aliases(results[a._id.toHexString()]).sort()).toEqual(["B", "Broken"]);
  });

  it("isolates a failure across concurrency batches (more applicants than one batch)", async () => {
    // RERANK_CONCURRENCY is 5 — seven applicants span two batches.
    const people = ["A", "B", "C", "D", "E", "F", "G"].map(applicant);
    pool = people;
    embedded = new Set(people.map((p) => p.alias));
    throwsFor = new Set(["C"]);

    const results = await runFullMatchingPass();

    expect(Object.keys(results)).toHaveLength(7);
    expect(results[people[2]._id.toHexString()]).toEqual([]);
    for (const p of people.filter((x) => x.alias !== "C")) {
      expect(results[p._id.toHexString()]).toHaveLength(6);
    }
  });

  it("caps each applicant's list at 10 candidates", async () => {
    const people = Array.from({ length: 13 }, (_, i) => applicant(`P${i}`));
    pool = people;
    embedded = new Set(people.map((p) => p.alias));

    const results = await runFullMatchingPass();

    expect(results[people[0]._id.toHexString()]).toHaveLength(10);
  });
});

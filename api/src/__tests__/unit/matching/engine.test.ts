// tested: getActiveContactApplicantIds — applicants in an in_progress contact
// must not be offered as candidates or receive new proposals on the next pass.
//
// NOTE: runFullMatchingPass/getCandidates (which both call this and filter on
// its result) are not exercised here — route tests mock.module() the engine
// facade globally with stubs for exactly those two exports, which would
// replace them in full-suite runs (same constraint documented in
// proposals.test.ts). Their use of getActiveContactApplicantIds is covered by
// the match-flow smoke test.
import { describe, it, expect, mock, beforeEach } from "bun:test";
import { ObjectId } from "mongodb";

let inProgressMatches: Array<{ applicantAId: ObjectId; applicantBId: ObjectId }> = [];

const fakeMatchesCol = {
  find: mock((_filter: any, _opts?: any) => ({
    toArray: async () => inProgressMatches,
  })),
};

mock.module("../../../db/connection.js", () => ({
  getDb: async () => ({}),
  closeDb: async () => {},
}));

mock.module("../../../db/collections.js", () => ({
  COLLECTION_NAMES: {},
  getMatchesCollection:        () => fakeMatchesCol,
  getApplicantsCollection:     () => ({}),
  getQuestionnairesCollection: () => ({}),
  getIdentitiesCollection:     () => ({}),
  getAuditLogsCollection:      () => ({}),
  getEmbeddingsCollection:     () => ({}),
  getAdminsCollection:         () => ({}),
  getAppConfigCollection:      () => ({}),
  getMatchReranksCollection:   () => ({}),
  ensureIndexes:               async () => {},
}));

import { getActiveContactApplicantIds } from "../../../matching/engine.js";

beforeEach(() => {
  inProgressMatches = [];
  fakeMatchesCol.find.mockClear();
});

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

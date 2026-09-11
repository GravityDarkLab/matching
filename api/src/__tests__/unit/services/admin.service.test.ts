// tested: admin.service
//  - buildApplicantFilter — the three-way filter behind listApplicants ("All"
//    tab excludes pending-deletion, scheduledDeletion=true returns only those,
//    an explicit status shows them regardless) — and the DELETION_GRACE_MS
//    constant used by deactivateApplicant's soft-delete.
//  - listApplicants — pagination, the filter it queries with, and that secrets
//    (magicToken, passwordHash) never leave the service.
//  - deactivateApplicant — the soft-delete write.
// The applicants collection is mocked.
import { describe, it, expect, mock, beforeEach } from "bun:test";
import { ObjectId } from "mongodb";

let docs: Record<string, unknown>[] = [];
let total = 0;
let matchedCount = 1;
const cursorCalls: { sort?: unknown; skip?: number; limit?: number } = {};

const fakeApplicantsCol = {
  find: mock((_filter: unknown) => ({
    sort: (s: unknown) => {
      cursorCalls.sort = s;
      return {
        skip: (n: number) => {
          cursorCalls.skip = n;
          return {
            limit: (l: number) => {
              cursorCalls.limit = l;
              return { toArray: async () => docs };
            },
          };
        },
      };
    },
  })),
  countDocuments: mock(async (_filter: unknown) => total),
  updateOne: mock(async (_f: unknown, _u: unknown) => ({ matchedCount })),
};

mock.module("../../../db/connection.js", () => ({
  getDb: async () => ({}),
  closeDb: async () => {},
}));
mock.module("../../../db/collections.js", () => ({
  COLLECTION_NAMES: {},
  getApplicantsCollection: () => fakeApplicantsCol,
  getAuditLogsCollection: () => ({}),
  getQuestionnairesCollection: () => ({}),
  getAdminsCollection: () => ({}),
  getIdentitiesCollection: () => ({}),
  getMatchesCollection: () => ({}),
}));

// Dynamic so admin.service is evaluated after the mocks above.
const { buildApplicantFilter, listApplicants, deactivateApplicant } =
  await import("../../../services/admin.service.js");
const { DELETION_GRACE_MS } = await import("../../../services/match-state.service.js");

beforeEach(() => {
  docs = [];
  total = 0;
  matchedCount = 1;
  delete cursorCalls.sort;
  delete cursorCalls.skip;
  delete cursorCalls.limit;
  fakeApplicantsCol.find.mockClear();
  fakeApplicantsCol.countDocuments.mockClear();
  fakeApplicantsCol.updateOne.mockClear();
});

describe("buildApplicantFilter", () => {
  it("the 'All' tab (no status, no scheduledDeletion) excludes pending deletion", () => {
    expect(buildApplicantFilter()).toEqual({
      deletionScheduledAt: { $exists: false },
    });
  });

  it("scheduledDeletion=true returns only applicants pending deletion", () => {
    expect(buildApplicantFilter(undefined, undefined, true)).toEqual({
      deletionScheduledAt: { $exists: true },
    });
  });

  it("scheduledDeletion=true ignores an explicit status", () => {
    expect(buildApplicantFilter("applied", undefined, true)).toEqual({
      deletionScheduledAt: { $exists: true },
    });
  });

  it("an explicit status filters by status without a deletionScheduledAt clause", () => {
    expect(buildApplicantFilter("inactive")).toEqual({ status: "inactive" });
  });

  it("adds a case-insensitive alias regex when search is provided", () => {
    const filter = buildApplicantFilter(undefined, "lunar") as any;
    expect(filter.deletionScheduledAt).toEqual({ $exists: false });
    expect(filter.alias).toEqual({ $regex: "lunar", $options: "i" });
  });

  it("escapes regex special characters in the search term", () => {
    const filter = buildApplicantFilter(undefined, "a.b*c") as any;
    expect(filter.alias.$regex).toBe("a\\.b\\*c");
  });
});

describe("DELETION_GRACE_MS", () => {
  it("is 180 days", () => {
    expect(DELETION_GRACE_MS).toBe(180 * 24 * 60 * 60 * 1000);
  });
});

describe("listApplicants", () => {
  it("queries and counts with the same filter buildApplicantFilter produces", async () => {
    await listApplicants(1, 20, "applied", "lunar");

    const expected = buildApplicantFilter("applied", "lunar");
    expect(fakeApplicantsCol.find.mock.calls[0][0]).toEqual(expected);
    expect(fakeApplicantsCol.countDocuments.mock.calls[0][0]).toEqual(expected);
  });

  it("sorts newest first and pages with skip = (page - 1) * limit", async () => {
    await listApplicants(3, 25);

    expect(cursorCalls).toEqual({ sort: { createdAt: -1 }, skip: 50, limit: 25 });
  });

  it("never returns magicToken or passwordHash, and exposes the id as a string", async () => {
    const _id = new ObjectId();
    docs = [{ _id, alias: "Blue Falcon", status: "applied", magicToken: "hashed-token", passwordHash: "bcrypt-hash" }];
    total = 1;

    const { data } = await listApplicants(1, 20);

    expect(data).toEqual([{ id: _id.toHexString(), alias: "Blue Falcon", status: "applied" } as any]);
    expect(data[0]).not.toHaveProperty("magicToken");
    expect(data[0]).not.toHaveProperty("passwordHash");
    expect(data[0]).not.toHaveProperty("_id");
  });

  it("reports pagination metadata, rounding totalPages up", async () => {
    total = 41;

    const result = await listApplicants(2, 20);

    expect(result).toMatchObject({ total: 41, page: 2, limit: 20, totalPages: 3 });
  });
});

describe("deactivateApplicant", () => {
  it("returns false for a malformed id without touching the database", async () => {
    expect(await deactivateApplicant("not-an-object-id")).toBe(false);
    expect(fakeApplicantsCol.updateOne).not.toHaveBeenCalled();
  });

  it("soft-deletes: sets inactive and schedules deletion DELETION_GRACE_MS out", async () => {
    const id = new ObjectId();
    const before = Date.now();

    expect(await deactivateApplicant(id.toHexString())).toBe(true);
    const after = Date.now();

    const [filter, update] = fakeApplicantsCol.updateOne.mock.calls[0] as any[];
    expect(filter._id.equals(id)).toBe(true);
    expect(update.$set.status).toBe("inactive");
    const scheduled = (update.$set.deletionScheduledAt as Date).getTime();
    expect(scheduled).toBeGreaterThanOrEqual(before + DELETION_GRACE_MS);
    expect(scheduled).toBeLessThanOrEqual(after + DELETION_GRACE_MS);
  });

  it("returns false when no applicant matched the id", async () => {
    matchedCount = 0;
    expect(await deactivateApplicant(new ObjectId().toHexString())).toBe(false);
  });
});

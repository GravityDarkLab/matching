// tested: privacy/identity.service.ts — encrypted storage and audit-logged
// reveal of an applicant's Instagram handle and (additively) full name.
import { describe, it, expect, mock, beforeEach } from "bun:test";
import { ObjectId } from "mongodb";
import type { IdentityDoc } from "../../../models/identity.model.js";

const store = new Map<string, IdentityDoc>();

const fakeIdentities = {
  insertOne: mock(async (doc: IdentityDoc) => {
    store.set(doc.applicantId.toHexString(), doc);
    return { insertedId: doc._id };
  }),
  findOne: mock(async (filter: { applicantId?: ObjectId; alias?: string }) => {
    if (filter.applicantId) return store.get(filter.applicantId.toHexString()) ?? null;
    if (filter.alias) {
      for (const doc of store.values()) if (doc.alias === filter.alias) return doc;
    }
    return null;
  }),
};

mock.module("../../../db/connection.js", () => ({
  getDb: async () => ({}),
  closeDb: async () => {},
}));

mock.module("../../../db/collections.js", () => ({
  getIdentitiesCollection: () => fakeIdentities,
}));

const mockWriteAuditLog = mock(async () => {});
mock.module("../../../middleware/audit.middleware.js", () => ({
  writeAuditLog: mockWriteAuditLog,
}));

import {
  storeIdentity,
  resolveIdentityById,
  revealIdentityById,
} from "../../../privacy/identity.service.js";

beforeEach(() => {
  store.clear();
  fakeIdentities.insertOne.mockClear();
  fakeIdentities.findOne.mockClear();
  mockWriteAuditLog.mockReset();
  mockWriteAuditLog.mockResolvedValue(undefined);
});

describe("storeIdentity + resolveIdentityById", () => {
  it("round-trips the Instagram handle with no full name", async () => {
    const applicantId = new ObjectId();
    await storeIdentity(applicantId, "Blue Falcon", "blue.falcon");

    const resolved = await resolveIdentityById(applicantId);
    expect(resolved).toEqual({ instagram: "blue.falcon", fullName: null });
  });

  it("round-trips both the handle and the full name when provided", async () => {
    const applicantId = new ObjectId();
    await storeIdentity(applicantId, "Blue Falcon", "blue.falcon", "Jane Doe");

    const resolved = await resolveIdentityById(applicantId);
    expect(resolved).toEqual({ instagram: "blue.falcon", fullName: "Jane Doe" });
  });

  it("uses a different IV for the name ciphertext than the handle ciphertext", async () => {
    const applicantId = new ObjectId();
    await storeIdentity(applicantId, "Blue Falcon", "blue.falcon", "Jane Doe");

    const doc = store.get(applicantId.toHexString())!;
    expect(doc.fullNameIv).toBeDefined();
    expect(doc.fullNameIv).not.toEqual(doc.encryptionIv);
  });

  it("returns null for an unknown applicant", async () => {
    const resolved = await resolveIdentityById(new ObjectId());
    expect(resolved).toBeNull();
  });
});

describe("revealIdentityById", () => {
  it("returns the resolved identity and writes one audit log entry", async () => {
    const applicantId = new ObjectId();
    await storeIdentity(applicantId, "Blue Falcon", "blue.falcon", "Jane Doe");

    const result = await revealIdentityById(applicantId, {
      actor: { actorId: "admin1", ipAddress: "127.0.0.1", userAgent: "test" },
      action: "RESOLVE_IDENTITY",
      targetAlias: "Blue Falcon",
    });

    expect(result).toEqual({ instagram: "blue.falcon", fullName: "Jane Doe" });
    expect(mockWriteAuditLog).toHaveBeenCalledTimes(1);
  });

  it("returns null and does not audit-log for an unknown applicant", async () => {
    const result = await revealIdentityById(new ObjectId(), {
      actor: { actorId: "admin1", ipAddress: "127.0.0.1", userAgent: "test" },
      action: "RESOLVE_IDENTITY",
    });

    expect(result).toBeNull();
    expect(mockWriteAuditLog).not.toHaveBeenCalled();
  });
});

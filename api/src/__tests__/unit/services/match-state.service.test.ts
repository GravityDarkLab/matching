// tested: services/match-state.service.ts — the shared kernel for match/
// applicant status transitions, used by both the admin override
// (match.service.ts) and the applicant-facing flows (profile.service.ts):
// the state-machine guard (assertMatchTransition), the status-transition
// side effects (transitionApplicantStatus / applyMatchStatusSideEffects /
// recalcOrphanedStatuses), the conflicting-match expiry helper
// (expireConflictingMatches), and the applicant-facing view projection
// (toMatchView).
//
// NOTE: promoteAppliedToMatched is not exercised here — matching.routes.test.ts
// mock.module()s services/match-state.service.js to stub out just that export
// process-globally, which replaces it in full-suite runs (same constraint
// documented in unit/matching/proposals.test.ts). It's covered end-to-end via
// POST /matching/run in the route tests and the matching smoke flow.
import { describe, it, expect, mock, beforeEach } from "bun:test";
import { ObjectId } from "mongodb";
import type { MatchDoc } from "../../../models/match.model.js";

const fakeApplicants = {
  updateMany: mock(async (_f: unknown, _u: unknown) => ({ modifiedCount: 0 })),
  updateOne:  mock(async (_f: unknown, _u: unknown) => ({ modifiedCount: 0 })),
};
const fakeMatches = {
  updateMany: mock(async (_f: unknown, _u: unknown) => ({ modifiedCount: 0 })),
  find: mock((_filter: unknown) => ({ toArray: async () => [] as MatchDoc[] })),
};

mock.module("../../../db/connection.js", () => ({
  getDb:   async () => ({}),
  closeDb: async () => {},
}));

mock.module("../../../db/collections.js", () => ({
  COLLECTION_NAMES: {},
  getQuestionnairesCollection: () => fakeApplicants,
  getApplicantsCollection:     () => fakeApplicants,
  getIdentitiesCollection:     () => fakeApplicants,
  getAuditLogsCollection:      () => fakeApplicants,
  getEmbeddingsCollection:     () => fakeApplicants,
  getAdminsCollection:         () => fakeApplicants,
  getMatchesCollection:        () => fakeMatches,
  getAppConfigCollection:      () => fakeApplicants,
  ensureIndexes:               async () => {},
}));

import {
  assertMatchTransition,
  transitionApplicantStatus,
  applyMatchStatusSideEffects,
  expireConflictingMatches,
  recalcOrphanedStatuses,
  toMatchView,
  DELETION_GRACE_MS,
  daysSince,
  getDatingAnchor,
  assertOutcomeEligible,
} from "../../../services/match-state.service.js";

beforeEach(() => {
  fakeApplicants.updateMany.mockReset();
  fakeApplicants.updateMany.mockResolvedValue({ modifiedCount: 0 });
  fakeApplicants.updateOne.mockReset();
  fakeApplicants.updateOne.mockResolvedValue({ modifiedCount: 0 });
  fakeMatches.updateMany.mockReset();
  fakeMatches.updateMany.mockResolvedValue({ modifiedCount: 0 });
  fakeMatches.find.mockReset();
  fakeMatches.find.mockImplementation(() => ({ toArray: async () => [] }));
});

function makeMatch(overrides: Partial<MatchDoc> = {}): MatchDoc {
  const aId = new ObjectId();
  const bId = new ObjectId();
  return {
    _id: new ObjectId(),
    applicantAId: aId,
    applicantAAlias: "Blue Falcon",
    applicantBId: bId,
    applicantBAlias: "River Storm",
    score: 0.85,
    algorithm: "embedding-cosine",
    status: "proposed",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ── assertMatchTransition ──────────────────────────────────────────────────────

describe("assertMatchTransition – contact", () => {
  it("allows contact on proposed match by participant A", () => {
    const match = makeMatch({ status: "proposed" });
    expect(() => assertMatchTransition(match, "contact", match.applicantAId)).not.toThrow();
  });

  it("allows contact on proposed match by participant B", () => {
    const match = makeMatch({ status: "proposed" });
    expect(() => assertMatchTransition(match, "contact", match.applicantBId)).not.toThrow();
  });

  it("throws when match is not proposed", () => {
    const match = makeMatch({ status: "in_progress" });
    expect(() => assertMatchTransition(match, "contact", match.applicantAId)).toThrow();
  });

  it("throws when actor is not a participant", () => {
    const match = makeMatch({ status: "proposed" });
    expect(() => assertMatchTransition(match, "contact", new ObjectId())).toThrow();
  });
});

describe("assertMatchTransition – respond", () => {
  it("allows respond by the non-initiator", () => {
    const match = makeMatch({
      status: "in_progress",
      initiatorId: new ObjectId(), // someone else
    });
    expect(() => assertMatchTransition(match, "respond", match.applicantAId)).not.toThrow();
  });

  it("throws when initiator tries to respond to own request", () => {
    const match = makeMatch({ status: "in_progress" });
    const initiatorId = match.applicantAId;
    match.initiatorId = initiatorId;
    expect(() => assertMatchTransition(match, "respond", initiatorId)).toThrow();
  });

  it("throws when match is not in_progress", () => {
    const match = makeMatch({ status: "proposed" });
    expect(() => assertMatchTransition(match, "respond", match.applicantBId)).toThrow();
  });

  it("throws when actor is not a participant", () => {
    const match = makeMatch({ status: "in_progress", initiatorId: new ObjectId() });
    expect(() => assertMatchTransition(match, "respond", new ObjectId())).toThrow();
  });
});

describe("assertMatchTransition – withdraw", () => {
  it("allows the initiator to withdraw an in_progress contact", () => {
    const match = makeMatch({ status: "in_progress" });
    match.initiatorId = match.applicantAId;
    expect(() => assertMatchTransition(match, "withdraw", match.applicantAId)).not.toThrow();
  });

  it("throws when the target tries to withdraw", () => {
    const match = makeMatch({ status: "in_progress" });
    match.initiatorId = match.applicantAId;
    expect(() => assertMatchTransition(match, "withdraw", match.applicantBId)).toThrow(
      /Only the initiator/
    );
  });

  it("throws when match is not in_progress", () => {
    const match = makeMatch({ status: "proposed" });
    expect(() => assertMatchTransition(match, "withdraw", match.applicantAId)).toThrow(
      /nothing to withdraw/
    );
  });

  it("throws when actor is not a participant", () => {
    const match = makeMatch({ status: "in_progress" });
    match.initiatorId = match.applicantAId;
    expect(() => assertMatchTransition(match, "withdraw", new ObjectId())).toThrow();
  });
});

describe("assertMatchTransition – outcome", () => {
  it("allows outcome on dating match by participant", () => {
    const match = makeMatch({ status: "dating" });
    expect(() => assertMatchTransition(match, "outcome", match.applicantAId)).not.toThrow();
  });

  it("allows outcome on in_progress match by participant", () => {
    const match = makeMatch({ status: "in_progress", initiatorId: new ObjectId() });
    expect(() => assertMatchTransition(match, "outcome", match.applicantBId)).not.toThrow();
  });

  it("throws when match is proposed", () => {
    const match = makeMatch({ status: "proposed" });
    expect(() => assertMatchTransition(match, "outcome", match.applicantAId)).toThrow();
  });

  it("throws when actor is not a participant", () => {
    const match = makeMatch({ status: "dating" });
    expect(() => assertMatchTransition(match, "outcome", new ObjectId())).toThrow();
  });
});

// ── transitionApplicantStatus / applyMatchStatusSideEffects ────────────────────

describe("transitionApplicantStatus", () => {
  it("sets status on all given applicant ids", async () => {
    const ids = [new ObjectId(), new ObjectId()];
    await transitionApplicantStatus(ids, "dating");

    const [filter, update] = fakeApplicants.updateMany.mock.calls[0] as any[];
    expect(filter._id).toEqual({ $in: ids });
    expect(update.$set.status).toBe("dating");
  });

  it("merges extra fields (e.g. deletionScheduledAt) into the update", async () => {
    const ids = [new ObjectId()];
    const deletionScheduledAt = new Date();
    await transitionApplicantStatus(ids, "inactive", { deletionScheduledAt });

    const [, update] = fakeApplicants.updateMany.mock.calls[0] as any[];
    expect(update.$set.deletionScheduledAt).toBe(deletionScheduledAt);
  });
});

describe("applyMatchStatusSideEffects", () => {
  it("dating: moves both applicants to dating and expires their other matches", async () => {
    const ids = [new ObjectId(), new ObjectId()];
    const excludeMatchId = new ObjectId();
    await applyMatchStatusSideEffects("dating", ids, excludeMatchId);

    const [, appUpdate] = fakeApplicants.updateMany.mock.calls[0] as any[];
    expect(appUpdate.$set.status).toBe("dating");

    const [matchFilter] = fakeMatches.updateMany.mock.calls[0] as any[];
    expect(matchFilter._id).toEqual({ $ne: excludeMatchId });
  });

  it("success: deactivates both applicants with a deletion grace period and expires their other matches", async () => {
    const ids = [new ObjectId(), new ObjectId()];
    const before = Date.now();
    await applyMatchStatusSideEffects("success", ids);
    const after = Date.now();

    const [, appUpdate] = fakeApplicants.updateMany.mock.calls[0] as any[];
    expect(appUpdate.$set.status).toBe("inactive");
    const scheduledAt = (appUpdate.$set.deletionScheduledAt as Date).getTime();
    expect(scheduledAt).toBeGreaterThanOrEqual(before + DELETION_GRACE_MS);
    expect(scheduledAt).toBeLessThanOrEqual(after + DELETION_GRACE_MS);

    expect(fakeMatches.updateMany).toHaveBeenCalledTimes(1);
  });

  it("failed: returns both applicants to applied without expiring other matches", async () => {
    const ids = [new ObjectId(), new ObjectId()];
    await applyMatchStatusSideEffects("failed", ids);

    const [, appUpdate] = fakeApplicants.updateMany.mock.calls[0] as any[];
    expect(appUpdate.$set.status).toBe("applied");
    expect(appUpdate.$set.deletionScheduledAt).toBeUndefined();

    expect(fakeMatches.updateMany).not.toHaveBeenCalled();
  });

  it.each(["proposed", "in_progress", "declined", "expired"] as const)(
    "%s: no applicant or match side effects",
    async (status) => {
      const ids = [new ObjectId()];
      await applyMatchStatusSideEffects(status, ids);

      expect(fakeApplicants.updateMany).not.toHaveBeenCalled();
      expect(fakeMatches.updateMany).not.toHaveBeenCalled();
    }
  );
});

// ── expireConflictingMatches ───────────────────────────────────────────────────

describe("expireConflictingMatches", () => {
  it("expires proposed/in_progress matches for the given applicants", async () => {
    const id = new ObjectId();
    await expireConflictingMatches([id]);

    const [filter, update] = fakeMatches.updateMany.mock.calls[0] as any[];
    expect(filter.status).toEqual({ $in: ["proposed", "in_progress"] });
    expect(filter._id).toBeUndefined();
    expect(filter.$or).toEqual([
      { applicantAId: { $in: [id] } },
      { applicantBId: { $in: [id] } },
    ]);
    expect(update.$set.status).toBe("expired");
  });

  it("excludes the match being acted on when excludeMatchId is given", async () => {
    const id = new ObjectId();
    const keep = new ObjectId();
    await expireConflictingMatches([id], keep);

    const [filter] = fakeMatches.updateMany.mock.calls[0] as any[];
    expect(filter._id).toEqual({ $ne: keep });
  });
});

// ── recalcOrphanedStatuses ──────────────────────────────────────────────────────

describe("recalcOrphanedStatuses", () => {
  it("does nothing for an empty id list", async () => {
    await recalcOrphanedStatuses([]);
    expect(fakeMatches.find).not.toHaveBeenCalled();
    expect(fakeApplicants.updateOne).not.toHaveBeenCalled();
  });

  it("sets status to 'dating' when a dating match remains", async () => {
    const id = new ObjectId();
    fakeMatches.find.mockImplementation(() => ({
      toArray: async () => [makeMatch({ status: "dating" }), makeMatch({ status: "proposed" })],
    }));

    await recalcOrphanedStatuses([id]);

    const [filter, update] = fakeApplicants.updateOne.mock.calls[0] as any[];
    expect(filter._id).toEqual(id);
    expect(update.$set.status).toBe("dating");
  });

  it("sets status to 'matched' when only proposed/in_progress matches remain", async () => {
    const id = new ObjectId();
    fakeMatches.find.mockImplementation(() => ({
      toArray: async () => [makeMatch({ status: "in_progress" })],
    }));

    await recalcOrphanedStatuses([id]);

    const [, update] = fakeApplicants.updateOne.mock.calls[0] as any[];
    expect(update.$set.status).toBe("matched");
  });

  it("sets status to 'applied' when no active matches remain", async () => {
    const id = new ObjectId();
    fakeMatches.find.mockImplementation(() => ({ toArray: async () => [] }));

    await recalcOrphanedStatuses([id]);

    const [, update] = fakeApplicants.updateOne.mock.calls[0] as any[];
    expect(update.$set.status).toBe("applied");
  });

  it("recalculates every affected applicant independently", async () => {
    const datingId = new ObjectId();
    const orphanId = new ObjectId();
    fakeMatches.find.mockImplementation((filter: any) => ({
      toArray: async () =>
        filter.$or[0].applicantAId.equals(datingId)
          ? [makeMatch({ status: "dating" })]
          : [],
    }));

    await recalcOrphanedStatuses([datingId, orphanId]);

    expect(fakeApplicants.updateOne).toHaveBeenCalledTimes(2);
    const calls = fakeApplicants.updateOne.mock.calls as any[];
    const datingCall = calls.find(([f]) => f._id.equals(datingId));
    const orphanCall = calls.find(([f]) => f._id.equals(orphanId));
    expect(datingCall![1].$set.status).toBe("dating");
    expect(orphanCall![1].$set.status).toBe("applied");
  });
});

// ── toMatchView ─────────────────────────────────────────────────────────────────

describe("toMatchView – perspective", () => {
  it("returns perspective 'none' when status is proposed", () => {
    const match = makeMatch({ status: "proposed" });
    const view = toMatchView(match, match.applicantAId);
    expect(view.perspective).toBe("none");
  });

  it("returns perspective 'initiator' when actor is the initiator in in_progress", () => {
    const match = makeMatch({ status: "in_progress" });
    match.initiatorId = match.applicantAId;
    const view = toMatchView(match, match.applicantAId);
    expect(view.perspective).toBe("initiator");
  });

  it("returns perspective 'target' when actor is the non-initiator in in_progress", () => {
    const match = makeMatch({ status: "in_progress" });
    match.initiatorId = match.applicantAId;
    const view = toMatchView(match, match.applicantBId);
    expect(view.perspective).toBe("target");
  });

  it("returns perspective 'none' for dating status", () => {
    const match = makeMatch({ status: "dating" });
    const view = toMatchView(match, match.applicantAId);
    expect(view.perspective).toBe("none");
  });
});

describe("toMatchView – ice-breakers and date ideas", () => {
  it("includes iceBreakers and dateIdeas for initiator in in_progress", () => {
    const match = makeMatch({
      status: "in_progress",
      iceBreakers: ["Q1", "Q2"],
      dateIdeas: ["Idea1"],
    });
    match.initiatorId = match.applicantAId;
    const view = toMatchView(match, match.applicantAId);
    expect(view.iceBreakers).toEqual(["Q1", "Q2"]);
    expect(view.dateIdeas).toEqual(["Idea1"]);
  });

  it("omits iceBreakers and dateIdeas for target in in_progress", () => {
    const match = makeMatch({
      status: "in_progress",
      iceBreakers: ["Q1"],
      dateIdeas: ["Idea1"],
    });
    match.initiatorId = match.applicantAId;
    const view = toMatchView(match, match.applicantBId);
    expect(view.iceBreakers).toBeUndefined();
    expect(view.dateIdeas).toBeUndefined();
  });

  it("omits iceBreakers and dateIdeas for proposed status", () => {
    const match = makeMatch({
      status: "proposed",
      iceBreakers: ["Q1"],
      dateIdeas: ["Idea1"],
    });
    const view = toMatchView(match, match.applicantAId);
    expect(view.iceBreakers).toBeUndefined();
    expect(view.dateIdeas).toBeUndefined();
  });
});

describe("toMatchView – partner profile", () => {
  it("includes the partner's public answers when provided", () => {
    const match = makeMatch();
    const answers = { location: "Paris, France", age: 27, vibe_words: ["calm", "curious"] };
    const view = toMatchView(match, match.applicantAId, answers);
    expect(view.partnerProfile).toEqual(answers);
  });

  it("omits partnerProfile when no answers are provided", () => {
    const match = makeMatch();
    const view = toMatchView(match, match.applicantAId);
    expect(view.partnerProfile).toBeUndefined();
  });

  it("filters out consent-only keys like disclaimer_agreed", () => {
    const match = makeMatch();
    const view = toMatchView(match, match.applicantAId, {
      work: "Student",
      disclaimer_agreed: true,
    });
    expect(view.partnerProfile).toEqual({ work: "Student" });
  });

  it("omits partnerProfile entirely when only excluded keys remain", () => {
    const match = makeMatch();
    const view = toMatchView(match, match.applicantAId, { disclaimer_agreed: true });
    expect(view.partnerProfile).toBeUndefined();
  });

  it("replaces birth_date with the derived age", () => {
    const match = makeMatch();
    const birthYear = new Date().getUTCFullYear() - 28;
    const view = toMatchView(match, match.applicantAId, {
      location: "Paris, France",
      birth_date: `${birthYear}-01-01`, // birthday already passed this year
    });
    expect(view.partnerProfile).not.toHaveProperty("birth_date");
    expect(view.partnerProfile?.["age"]).toBe(28);
  });

  it("passes a legacy stored age through unchanged", () => {
    const match = makeMatch();
    const view = toMatchView(match, match.applicantAId, { age: 31 });
    expect(view.partnerProfile).toEqual({ age: 31 });
  });

  it("strips instagram_handle even if it somehow appears in answers", () => {
    // answers come from the applicants collection which never stores the handle —
    // this is defense in depth in case that invariant is ever broken upstream
    const match = makeMatch();
    const view = toMatchView(match, match.applicantAId, {
      location: "Tunis, Tunisia",
      instagram_handle: "leaked_handle",
    });
    expect(view.partnerProfile).toEqual({ location: "Tunis, Tunisia" });
    expect(JSON.stringify(view)).not.toContain("leaked_handle");
  });
});

describe("toMatchView – partner instagram", () => {
  it("never includes partnerInstagram for in_progress matches (mutual consent not yet given)", () => {
    const match = makeMatch({ status: "in_progress" });
    match.initiatorId = match.applicantAId;
    const view = toMatchView(match, match.applicantBId, undefined, "horizon.swift");
    expect(view.partnerInstagram).toBeUndefined();
  });

  it("includes partnerInstagram for dating matches (mutual acceptance = both consented)", () => {
    const match = makeMatch({ status: "dating" });
    const view = toMatchView(match, match.applicantAId, undefined, "horizon.swift");
    expect(view.partnerInstagram).toBe("horizon.swift");
  });

  it("never includes partnerInstagram for proposed matches, even if passed", () => {
    const match = makeMatch({ status: "proposed" });
    const view = toMatchView(match, match.applicantAId, undefined, "horizon.swift");
    expect(view.partnerInstagram).toBeUndefined();
  });

  it("never includes partnerInstagram for terminal statuses, even if passed", () => {
    for (const status of ["declined", "expired", "failed", "success"] as const) {
      const match = makeMatch({ status });
      const view = toMatchView(match, match.applicantAId, undefined, "horizon.swift");
      expect(view.partnerInstagram).toBeUndefined();
    }
  });

  it("omits partnerInstagram when not provided", () => {
    const match = makeMatch({ status: "in_progress" });
    match.initiatorId = match.applicantAId;
    const view = toMatchView(match, match.applicantBId);
    expect(view.partnerInstagram).toBeUndefined();
  });
});

describe("toMatchView – datingStartedAt", () => {
  it("exposes datingStartedAt when status is dating", () => {
    const datingStartedAt = new Date("2026-01-01T00:00:00Z");
    const match = makeMatch({ status: "dating", datingStartedAt });
    const view = toMatchView(match, match.applicantAId);
    expect(view.datingStartedAt).toEqual(datingStartedAt);
  });

  it("falls back to contactRespondedAt when datingStartedAt is missing", () => {
    const contactRespondedAt = new Date("2026-01-01T00:00:00Z");
    const match = makeMatch({ status: "dating", contactRespondedAt });
    const view = toMatchView(match, match.applicantAId);
    expect(view.datingStartedAt).toEqual(contactRespondedAt);
  });

  it("omits datingStartedAt for non-dating statuses", () => {
    const match = makeMatch({ status: "in_progress", contactRequestedAt: new Date() });
    const view = toMatchView(match, match.applicantAId);
    expect(view.datingStartedAt).toBeUndefined();
  });
});

describe("toMatchView – privacy", () => {
  it("never contains an instagramHandle field", () => {
    const match = makeMatch({ status: "in_progress" });
    match.initiatorId = match.applicantAId;
    const view = toMatchView(match, match.applicantAId) as unknown as Record<string, unknown>;
    expect(view["instagramHandle"]).toBeUndefined();
    expect(view["instagram"]).toBeUndefined();
  });

  it("exposes partner alias, not own alias", () => {
    const match = makeMatch({ status: "proposed" });
    // actor is A → partner is B
    const viewAsA = toMatchView(match, match.applicantAId);
    expect(viewAsA.partnerAlias).toBe(match.applicantBAlias);

    // actor is B → partner is A
    const viewAsB = toMatchView(match, match.applicantBId);
    expect(viewAsB.partnerAlias).toBe(match.applicantAAlias);
  });
});

// ── daysSince / getDatingAnchor / assertOutcomeEligible ────────────────────────

describe("daysSince", () => {
  it("returns 0 for a date less than a day ago", () => {
    const justNow = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
    expect(daysSince(justNow)).toBe(0);
  });

  it("returns 3 for a date exactly 3 days ago", () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    expect(daysSince(threeDaysAgo)).toBe(3);
  });

  it("returns 6 for a date just under 7 days ago", () => {
    const almostSeven = new Date(Date.now() - (7 * 24 * 60 * 60 * 1000 - 60 * 1000));
    expect(daysSince(almostSeven)).toBe(6);
  });
});

describe("getDatingAnchor", () => {
  it("prefers datingStartedAt when present", () => {
    const datingStartedAt = new Date("2026-01-01T00:00:00Z");
    const contactRespondedAt = new Date("2026-01-05T00:00:00Z");
    const match = makeMatch({ status: "dating", datingStartedAt, contactRespondedAt });
    expect(getDatingAnchor(match)).toEqual(datingStartedAt);
  });

  it("falls back to contactRespondedAt when datingStartedAt is missing (pre-existing matches)", () => {
    const contactRespondedAt = new Date("2026-01-05T00:00:00Z");
    const match = makeMatch({ status: "dating", contactRespondedAt });
    expect(getDatingAnchor(match)).toEqual(contactRespondedAt);
  });

  it("returns undefined when neither timestamp exists", () => {
    const match = makeMatch({ status: "dating" });
    expect(getDatingAnchor(match)).toBeUndefined();
  });
});

describe("assertOutcomeEligible", () => {
  // in_progress: the only legal outcome is the initiator bailing with "failed".
  // "success" would deactivate both accounts on a match that never reached
  // dating (identities never revealed), and the target's way out is respond.
  it("allows the initiator to report 'failed' from in_progress (bail-out)", () => {
    const match = makeMatch({ status: "in_progress" });
    match.initiatorId = match.applicantAId;
    expect(() => assertOutcomeEligible(match, "failed", match.applicantAId)).not.toThrow();
  });

  it("rejects 'success' from in_progress for anyone — dating never started", () => {
    const match = makeMatch({ status: "in_progress" });
    match.initiatorId = match.applicantAId;
    expect(() => assertOutcomeEligible(match, "success", match.applicantAId)).toThrow(/once you are dating/);
    expect(() => assertOutcomeEligible(match, "success", match.applicantBId)).toThrow(/once you are dating/);
  });

  it("rejects 'failed' from in_progress by the target — declining goes through respond", () => {
    const match = makeMatch({ status: "in_progress" });
    match.initiatorId = match.applicantAId;
    expect(() => assertOutcomeEligible(match, "failed", match.applicantBId)).toThrow(/Only the initiator/);
  });

  it("does not throw when dating but no anchor exists (defensive fallback)", () => {
    const match = makeMatch({ status: "dating" });
    expect(() => assertOutcomeEligible(match, "failed", match.applicantAId)).not.toThrow();
  });

  it("throws for 'failed' before day 3", () => {
    const datingStartedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const match = makeMatch({ status: "dating", datingStartedAt });
    expect(() => assertOutcomeEligible(match, "failed", match.applicantAId)).toThrow(/Too early/);
  });

  it("allows 'failed' exactly at day 3", () => {
    const datingStartedAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const match = makeMatch({ status: "dating", datingStartedAt });
    expect(() => assertOutcomeEligible(match, "failed", match.applicantAId)).not.toThrow();
  });

  it("throws for 'success' before day 7", () => {
    const datingStartedAt = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
    const match = makeMatch({ status: "dating", datingStartedAt });
    expect(() => assertOutcomeEligible(match, "success", match.applicantAId)).toThrow(/Too early/);
  });

  it("allows 'success' exactly at day 7", () => {
    const datingStartedAt = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const match = makeMatch({ status: "dating", datingStartedAt });
    expect(() => assertOutcomeEligible(match, "success", match.applicantAId)).not.toThrow();
  });

  it("allows 'failed' at day 5 (between the two thresholds)", () => {
    const datingStartedAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const match = makeMatch({ status: "dating", datingStartedAt });
    expect(() => assertOutcomeEligible(match, "failed", match.applicantAId)).not.toThrow();
    expect(() => assertOutcomeEligible(match, "success", match.applicantAId)).toThrow(/Too early/);
  });
});

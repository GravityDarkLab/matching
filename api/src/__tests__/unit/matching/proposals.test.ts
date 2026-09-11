// tested: generateCoupleProposals — pair canonicalisation, symmetric score
// averaging, deduplication, alias propagation, missing-applicant skip, sorting —
// and proposalPairAction, the pair-revival policy used by saveMatchProposals
// (expired pairs are re-proposed next phase, declined/failed/success pairs
// stay permanently excluded).
import { describe, it, expect } from "bun:test";
import { ObjectId } from "mongodb";
// Import from proposals.js directly: route tests mock.module() the engine
// facade globally, which would otherwise replace this function in full-suite runs.
import { generateCoupleProposals, proposalPairAction } from "../../../matching/proposals.js";
import type { RankedCandidate } from "../../../matching/engine.js";
import type { ApplicantDoc } from "../../../models/applicant.model.js";

function makeApplicant(alias: string): ApplicantDoc {
  return {
    _id: new ObjectId(),
    alias,
    questionnaireVersion: "1.0.0",
    answers: {},
    status: "applied",
    magicToken: "a".repeat(64),
    passwordHash: "hash",
    scoreThreshold: 0.8,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function candidate(of: ApplicantDoc, score: number, breakdown: Record<string, number> = {}): RankedCandidate {
  return {
    alias: of.alias,
    applicantId: of._id.toHexString(),
    score,
    breakdown,
    embeddingScore: score,
    llmReasoning: "",
  };
}

describe("generateCoupleProposals", () => {
  it("returns an empty array for empty results", () => {
    expect(generateCoupleProposals([], {})).toEqual([]);
  });

  it("produces one proposal per unique pair even when both directions exist", () => {
    const a = makeApplicant("Alpha One");
    const b = makeApplicant("Beta Two");
    const results = {
      [a._id.toHexString()]: [candidate(b, 0.8)],
      [b._id.toHexString()]: [candidate(a, 0.6)],
    };

    const proposals = generateCoupleProposals([a, b], results);
    expect(proposals).toHaveLength(1);
  });

  it("averages A→B and B→A scores when both directions exist", () => {
    const a = makeApplicant("Alpha One");
    const b = makeApplicant("Beta Two");
    const results = {
      [a._id.toHexString()]: [candidate(b, 0.8)],
      [b._id.toHexString()]: [candidate(a, 0.6)],
    };

    const [proposal] = generateCoupleProposals([a, b], results);
    expect(proposal.score).toBeCloseTo(0.7);
  });

  it("uses the single directed score when only one direction exists", () => {
    const a = makeApplicant("Alpha One");
    const b = makeApplicant("Beta Two");
    const results = {
      [a._id.toHexString()]: [candidate(b, 0.9)],
    };

    const [proposal] = generateCoupleProposals([a, b], results);
    expect(proposal.score).toBeCloseTo(0.9);
  });

  it("canonicalises pairs so the lexicographically smaller hex ID is applicant A", () => {
    const a = makeApplicant("Alpha One");
    const b = makeApplicant("Beta Two");
    const [firstId] = [a._id.toHexString(), b._id.toHexString()].sort();
    const results = {
      [b._id.toHexString()]: [candidate(a, 0.7)],
    };

    const [proposal] = generateCoupleProposals([a, b], results);
    expect(proposal.applicantAId.toHexString()).toBe(firstId);
  });

  it("always populates both aliases from the applicant docs", () => {
    const a = makeApplicant("Alpha One");
    const b = makeApplicant("Beta Two");
    const results = {
      [a._id.toHexString()]: [candidate(b, 0.8)],
      [b._id.toHexString()]: [candidate(a, 0.6)],
    };

    const [proposal] = generateCoupleProposals([a, b], results);
    const aliases = [proposal.applicantAAlias, proposal.applicantBAlias].sort();
    expect(aliases).toEqual(["Alpha One", "Beta Two"]);
    expect(proposal.applicantAAlias).not.toBe("");
    expect(proposal.applicantBAlias).not.toBe("");
  });

  it("skips pairs whose applicant doc is missing from the applicants list", () => {
    const a = makeApplicant("Alpha One");
    const ghost = makeApplicant("Ghost Gone");
    const results = {
      [a._id.toHexString()]: [candidate(ghost, 0.9)],
    };

    // ghost not passed in applicants — proposal must be skipped, not emitted with blanks
    expect(generateCoupleProposals([a], results)).toEqual([]);
  });

  it("uses the canonical (A→B) direction's breakdown when both directions exist", () => {
    const a = makeApplicant("Alpha One");
    const b = makeApplicant("Beta Two");
    const [firstId] = [a._id.toHexString(), b._id.toHexString()].sort();
    const first = a._id.toHexString() === firstId ? a : b;
    const second = first === a ? b : a;

    const breakdownAB = { numeric_compatibility: 0.9 };
    const breakdownBA = { numeric_compatibility: 0.5 };
    const results = {
      [first._id.toHexString()]:  [candidate(second, 0.8, breakdownAB)],
      [second._id.toHexString()]: [candidate(first, 0.6, breakdownBA)],
    };

    const [proposal] = generateCoupleProposals([a, b], results);
    expect(proposal.breakdown).toEqual(breakdownAB);
  });

  it("falls back to the only available direction's breakdown", () => {
    const a = makeApplicant("Alpha One");
    const b = makeApplicant("Beta Two");
    const breakdown = { lifestyle_similarity: 0.7 };
    const results = {
      [a._id.toHexString()]: [candidate(b, 0.9, breakdown)],
    };

    const [proposal] = generateCoupleProposals([a, b], results);
    expect(proposal.breakdown).toEqual(breakdown);
  });

  it("sorts proposals by symmetric score descending", () => {
    const a = makeApplicant("Alpha One");
    const b = makeApplicant("Beta Two");
    const c = makeApplicant("Gamma Three");
    const results = {
      [a._id.toHexString()]: [candidate(b, 0.5), candidate(c, 0.9)],
      [b._id.toHexString()]: [candidate(a, 0.5)],
      [c._id.toHexString()]: [candidate(a, 0.9)],
    };

    const proposals = generateCoupleProposals([a, b, c], results);
    expect(proposals).toHaveLength(2);
    expect(proposals[0].score).toBeGreaterThan(proposals[1].score);
    expect(proposals[0].score).toBeCloseTo(0.9);
  });
});

describe("proposalPairAction", () => {
  it("inserts when the pair has no prior match", () => {
    expect(proposalPairAction(undefined)).toBe("insert");
  });

  it("revives expired pairs so they get another chance next phase", () => {
    expect(proposalPairAction("expired")).toBe("revive");
  });

  it.each(["declined", "failed", "success"] as const)(
    "permanently excludes %s pairs from re-proposal",
    (status) => {
      expect(proposalPairAction(status)).toBe("skip");
    }
  );

  it.each(["proposed", "in_progress", "dating"] as const)(
    "leaves live %s matches alone",
    (status) => {
      expect(proposalPairAction(status)).toBe("skip");
    }
  );
});

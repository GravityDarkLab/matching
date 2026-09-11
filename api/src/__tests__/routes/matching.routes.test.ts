import { describe, it, expect, mock, beforeEach } from "bun:test";
import { AppError } from "../../errors.js";

mock.module("../../middleware/rateLimit.middleware.js", () => {
  const noop = async (_c: unknown, next: () => Promise<void>) => { await next(); };
  return {
    formSubmitRateLimiter:   noop,
    adminRateLimiter:        noop,
    adminLoginRateLimiter:   noop,
    profileRateLimiter:      noop,
    profileLoginRateLimiter: noop,
    createRateLimiter:       () => noop,
  };
});

// ── Mock engine before any imports ────────────────────────────────────────────

const mockGetCandidates         = mock(async () => [] as any[]);
const mockRunFullMatchingPass   = mock(async () => ({} as Record<string, any[]>));
const mockSaveMatchProposals    = mock(async (..._: any[]) => 0);
const mockLoadActiveApplicants  = mock(async () => [] as any[]);

mock.module("../../matching/engine.js", () => ({
  getCandidates:       mockGetCandidates,
  runFullMatchingPass: mockRunFullMatchingPass,
}));

mock.module("../../services/match.service.js", () => ({
  saveMatchProposals:      mockSaveMatchProposals,
  loadActiveApplicants:    mockLoadActiveApplicants,
}));

mock.module("../../services/match-state.service.js", () => ({
  promoteAppliedToMatched: mock(async () => 0),
}));

const mockGetConfig = mock(async () => null as unknown);
const mockSetConfig = mock(async () => {});

mock.module("../../services/appConfig.service.js", () => ({
  getConfig: mockGetConfig,
  setConfig: mockSetConfig,
}));

import { Hono } from "hono";
// Dynamic, not static: static imports evaluate before this file's
// mock.module() calls run, and a route captures its rate limiter by value
// at definition time — a static import would bake in the real limiter.
const { matchingRoutes } = await import("../../routes/matching.routes.js");
import { signAdminToken } from "../../middleware/auth.middleware.js";

// ── Test app ──────────────────────────────────────────────────────────────────

const app = new Hono();
app.route("/matching", matchingRoutes);

async function get(path: string, token?: string) {
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return app.request(path, { headers });
}

async function post(path: string, body: unknown, token?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return app.request(path, { method: "POST", headers, body: JSON.stringify(body) });
}

async function adminToken() {
  return signAdminToken("507f1f77bcf86cd799439011", "test_admin", "admin");
}

// ── Fixture: ranked candidates ───────────────────────────────────────────────

function makeCandidates(n = 3) {
  return Array.from({ length: n }, (_, i) => ({
    alias: `Alias ${i}`,
    applicantId: `64b1234567890abcdef0000${i}`,
    score: 0.9 - i * 0.1,
    breakdown: { numeric_compatibility: 0.8 },
  }));
}

beforeEach(() => {
  mockGetCandidates.mockReset();
  mockRunFullMatchingPass.mockReset();
  mockSaveMatchProposals.mockReset();
  mockLoadActiveApplicants.mockReset();
  mockGetConfig.mockReset();
  mockSetConfig.mockReset();
  mockGetConfig.mockResolvedValue(null);
  mockSetConfig.mockResolvedValue(undefined);
  mockGetCandidates.mockResolvedValue(makeCandidates());
  mockRunFullMatchingPass.mockResolvedValue({
    "64b1234567890abcdef01234": makeCandidates(2),
  });
  mockSaveMatchProposals.mockResolvedValue(0);
  mockLoadActiveApplicants.mockResolvedValue([]);
});

// ── GET /matching/candidates/:applicantId ─────────────────────────────────────

describe("GET /matching/candidates/:applicantId", () => {
  it("returns 200 with a candidates array", async () => {
    const res = await get("/matching/candidates/64b1234567890abcdef01234", await adminToken());
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(Array.isArray(body.candidates)).toBe(true);
    expect(body.applicantId).toBe("64b1234567890abcdef01234");
  });

  it("passes applicantId and topN to getCandidates", async () => {
    await get("/matching/candidates/abc123?top=5", await adminToken());
    const [id, topN] = mockGetCandidates.mock.calls[0] as unknown as [string, number];
    expect(id).toBe("abc123");
    expect(topN).toBe(5);
  });

  it("caps top at 50 regardless of query param", async () => {
    await get("/matching/candidates/abc123?top=999", await adminToken());
    const [, topN] = mockGetCandidates.mock.calls[0] as unknown as [string, number];
    expect(topN).toBe(50);
  });

  it("returns 404 when engine throws 'not found'", async () => {
    mockGetCandidates.mockRejectedValue(new AppError("Active applicant not found: abc123", 404));
    const res = await get("/matching/candidates/abc123", await adminToken());
    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.success).toBe(false);
  });

  it("returns 400 for invalid applicant ID", async () => {
    mockGetCandidates.mockRejectedValue(new AppError("Invalid applicant ID: not-an-id", 400));
    const res = await get("/matching/candidates/not-an-id", await adminToken());
    expect(res.status).toBe(400);
  });

  it("returns 500 when engine throws an unexpected error", async () => {
    mockGetCandidates.mockRejectedValue(new Error("DB connection lost"));
    const res = await get("/matching/candidates/abc123", await adminToken());
    expect(res.status).toBe(500);
  });

  it("returns 401 without a token", async () => {
    const res = await get("/matching/candidates/64b1234567890abcdef01234");
    expect(res.status).toBe(401);
    expect(mockGetCandidates).not.toHaveBeenCalled();
  });
});

// ── POST /matching/run ────────────────────────────────────────────────────────

describe("POST /matching/run", () => {
  it("returns 401 without a token", async () => {
    const res = await post("/matching/run", {});
    expect(res.status).toBe(401);
  });

  it("returns 200 with embedding-cosine algorithm", async () => {
    const token = await adminToken();
    const res = await post("/matching/run", {}, token);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.algorithm).toBe("embedding-cosine");
    expect(typeof body.totalApplicants).toBe("number");
    expect(typeof body.durationMs).toBe("number");
  });

  it("accepts explicit embedding-cosine algorithm", async () => {
    const token = await adminToken();
    const res = await post("/matching/run", { algorithm: "embedding-cosine" }, token);
    expect(res.status).toBe(200);
  });

  it("returns 422 for deprecated algorithm values", async () => {
    const token = await adminToken();
    const res = await post("/matching/run", { algorithm: "baseline" }, token);
    expect(res.status).toBe(422);
  });

  it("returns 422 for cosine algorithm (removed)", async () => {
    const token = await adminToken();
    const res = await post("/matching/run", { algorithm: "cosine" }, token);
    expect(res.status).toBe(422);
  });

  it("returns 422 for an unknown algorithm value", async () => {
    const token = await adminToken();
    const res = await post("/matching/run", { algorithm: "neural-network" }, token);
    expect(res.status).toBe(422);
  });

  it("returns 404 when the engine throws", async () => {
    mockRunFullMatchingPass.mockRejectedValue(new AppError("No active questionnaire found", 404));
    const token = await adminToken();
    const res = await post("/matching/run", {}, token);
    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/questionnaire/i);
  });

  it("totalApplicants reflects the result key count", async () => {
    mockRunFullMatchingPass.mockResolvedValue({
      id1: makeCandidates(2),
      id2: makeCandidates(2),
      id3: makeCandidates(1),
    });
    const token = await adminToken();
    const res = await post("/matching/run", {}, token);
    const body = await res.json() as any;
    expect(body.totalApplicants).toBe(3);
  });
});

// ── GET /matching/last-run ────────────────────────────────────────────────────

describe("GET /matching/last-run", () => {
  it("returns 401 without a token", async () => {
    const res = await get("/matching/last-run");
    expect(res.status).toBe(401);
  });

  it("returns null data when matching has never run", async () => {
    mockGetConfig.mockResolvedValue(null);
    const res = await get("/matching/last-run", await adminToken());
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.data).toBeNull();
  });

  it("returns the stored last-run summary", async () => {
    const stored = {
      at: new Date().toISOString(),
      algorithm: "embedding-cosine",
      totalApplicants: 12,
      couplesProposed: 4,
      durationMs: 850,
      triggeredBy: "admin",
    };
    mockGetConfig.mockResolvedValue(stored);
    const res = await get("/matching/last-run", await adminToken());
    const body = await res.json() as any;
    expect(body.data).toEqual(stored);
  });

  it("POST /matching/run persists the last-run summary with embedding-cosine", async () => {
    const token = await adminToken();
    await post("/matching/run", {}, token);
    expect(mockSetConfig).toHaveBeenCalledTimes(1);
    const [key, value] = mockSetConfig.mock.calls[0] as unknown as [string, any];
    expect(key).toBe("matching.lastRun");
    expect(value.algorithm).toBe("embedding-cosine");
    expect(value.triggeredBy).toBe("admin");
    expect(typeof value.durationMs).toBe("number");
  });
});

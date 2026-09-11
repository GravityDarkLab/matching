import { describe, it, expect, mock, beforeEach } from "bun:test";

// ── Mocks ─────────────────────────────────────────────────────────────────────

mock.module("../../middleware/rateLimit.middleware.js", () => {
  const noop = async (_c: unknown, next: () => Promise<void>) => { await next(); };
  return { adminRateLimiter: noop, createRateLimiter: () => noop };
});

const mockListMatches  = mock(async (..._: any[]) => ({ data: [] as any[], total: 0, page: 1, limit: 20, totalPages: 0 }));
const mockUpdateMatch  = mock(async (..._: any[]) => null as any);
const mockDeleteMatch  = mock(async (..._: any[]) => true as boolean);

mock.module("../../services/match.service.js", () => ({
  listMatches:  mockListMatches,
  updateMatch:  mockUpdateMatch,
  deleteMatch:  mockDeleteMatch,
}));

import { Hono } from "hono";
// Dynamic, not static: static imports evaluate before this file's
// mock.module() calls run, and a route captures its rate limiter by value
// at definition time — a static import would bake in the real limiter.
const { matchRoutes } = await import("../../routes/match.routes.js");
import { signAdminToken } from "../../middleware/auth.middleware.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const app = new Hono();
app.route("/admin/matches", matchRoutes);

let _seq = 0;
function nextIp() { return `10.${Math.floor(_seq / 256)}.${_seq++ % 256}.1`; }

async function get(path: string, token?: string) {
  const headers: Record<string, string> = { "x-forwarded-for": nextIp() };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return app.request(path, { headers });
}

async function patch(path: string, body: unknown, token?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-forwarded-for": nextIp(),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return app.request(path, { method: "PATCH", headers, body: JSON.stringify(body) });
}

async function del(path: string, token?: string) {
  const headers: Record<string, string> = { "x-forwarded-for": nextIp() };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return app.request(path, { method: "DELETE", headers });
}

async function adminToken() { return signAdminToken("507f1f77bcf86cd799439011", "test_admin", "admin"); }

const MATCH_FIXTURE = {
  id: "64b1234567890abcdef01234",
  applicantAId: "64b0000000000000000000a1",
  applicantAAlias: "Lunar Ocean",
  applicantBId: "64b0000000000000000000b2",
  applicantBAlias: "Pearl Lantern",
  score: 0.87,
  algorithm: "baseline",
  status: "proposed",
  notes: "",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

beforeEach(() => {
  mockListMatches.mockReset();
  mockUpdateMatch.mockReset();
  mockDeleteMatch.mockReset();
  mockListMatches.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 });
  mockDeleteMatch.mockResolvedValue(true);
});

// ── GET /admin/matches ────────────────────────────────────────────────────────

describe("GET /admin/matches", () => {
  it("returns 401 without a token", async () => {
    const res = await get("/admin/matches");
    expect(res.status).toBe(401);
  });

  it("returns 200 with paginated list when authenticated", async () => {
    mockListMatches.mockResolvedValue({
      data: [MATCH_FIXTURE],
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    });
    const token = await adminToken();
    const res = await get("/admin/matches", token);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].applicantAAlias).toBe("Lunar Ocean");
    expect(body.total).toBe(1);
  });

  it("passes status filter to service — returns only matching results", async () => {
    mockListMatches.mockImplementation(async (_p: number, _l: number, status: string) =>
      status === "proposed"
        ? { data: [MATCH_FIXTURE] as any[], total: 1, page: 1, limit: 20, totalPages: 1 }
        : { data: [] as any[], total: 0, page: 1, limit: 20, totalPages: 0 },
    );
    const token = await adminToken();
    const res = await get("/admin/matches?status=proposed", token);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.total).toBe(1);
    expect(body.data[0].applicantAAlias).toBe("Lunar Ocean");
  });

  it("passes participantId filter to service — returns only that participant's matches", async () => {
    const pid = "64b0000000000000000000a1";
    mockListMatches.mockImplementation(async (_p: number, _l: number, _s: string, participantId: string) =>
      participantId === pid
        ? { data: [MATCH_FIXTURE] as any[], total: 1, page: 1, limit: 20, totalPages: 1 }
        : { data: [] as any[], total: 0, page: 1, limit: 20, totalPages: 0 },
    );
    const token = await adminToken();
    const res = await get(`/admin/matches?participantId=${pid}`, token);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.total).toBe(1);
  });

  it("passes alias search param to service — returns matches containing search term", async () => {
    mockListMatches.mockImplementation(async (_p: number, _l: number, _s: string, _pid: string, search: string) =>
      search === "lunar"
        ? { data: [MATCH_FIXTURE] as any[], total: 1, page: 1, limit: 20, totalPages: 1 }
        : { data: [] as any[], total: 0, page: 1, limit: 20, totalPages: 0 },
    );
    const token = await adminToken();
    const res = await get("/admin/matches?search=lunar", token);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.total).toBe(1);
  });

  it("returns empty list when no matches exist", async () => {
    const token = await adminToken();
    const res = await get("/admin/matches", token);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data).toHaveLength(0);
    expect(body.total).toBe(0);
  });
});

// ── PATCH /admin/matches:id ──────────────────────────────────────────────────

describe("PATCH /admin/matches/:id", () => {
  it("returns 401 without a token", async () => {
    const res = await patch("/admin/matches/64b1234567890abcdef01234", { status: "in_progress" });
    expect(res.status).toBe(401);
  });

  it("returns 200 with updated match on status change", async () => {
    mockUpdateMatch.mockResolvedValue({ ...MATCH_FIXTURE, status: "in_progress" });
    const token = await adminToken();
    const res = await patch("/admin/matches/64b1234567890abcdef01234", { status: "in_progress" }, token);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.data.status).toBe("in_progress");
  });

  it("returns 200 when updating notes", async () => {
    mockUpdateMatch.mockResolvedValue({ ...MATCH_FIXTURE, notes: "Called both parties" });
    const token = await adminToken();
    const res = await patch("/admin/matches/64b1234567890abcdef01234", { notes: "Called both parties" }, token);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.notes).toBe("Called both parties");
  });

  it("returns 200 when updating both status and notes together", async () => {
    mockUpdateMatch.mockResolvedValue({ ...MATCH_FIXTURE, status: "dating", notes: "Success!" });
    const token = await adminToken();
    const res = await patch(
      "/admin/matches/64b1234567890abcdef01234",
      { status: "dating", notes: "Success!" },
      token,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.status).toBe("dating");
    expect(body.data.notes).toBe("Success!");
  });

  it("returns 404 when match is not found", async () => {
    mockUpdateMatch.mockResolvedValue(null);
    const token = await adminToken();
    const res = await patch("/admin/matches/64b1234567890abcdef09999", { status: "in_progress" }, token);
    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.success).toBe(false);
  });

  it("returns 422 when status value is invalid", async () => {
    const token = await adminToken();
    const res = await patch("/admin/matches/64b1234567890abcdef01234", { status: "ghosted" }, token);
    expect(res.status).toBe(422);
    const body = await res.json() as any;
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/validation/i);
  });

  it("returns 422 when notes exceed 1000 characters", async () => {
    const token = await adminToken();
    const res = await patch(
      "/admin/matches/64b1234567890abcdef01234",
      { notes: "x".repeat(1001) },
      token,
    );
    expect(res.status).toBe(422);
  });

  it("accepts all valid status transitions", async () => {
    const token = await adminToken();
    for (const status of ["proposed", "in_progress", "dating", "success", "failed", "declined", "expired"] as const) {
      mockUpdateMatch.mockResolvedValue({ ...MATCH_FIXTURE, status });
      const res = await patch("/admin/matches/64b1234567890abcdef01234", { status }, token);
      expect(res.status).toBe(200);
    }
  });
});

// ── DELETE /admin/matches:id ─────────────────────────────────────────────────

describe("DELETE /admin/matches/:id", () => {
  it("returns 401 without a token", async () => {
    const res = await del("/admin/matches/64b1234567890abcdef01234");
    expect(res.status).toBe(401);
  });

  it("returns 200 on successful deletion", async () => {
    mockDeleteMatch.mockResolvedValue(true);
    const token = await adminToken();
    const res = await del("/admin/matches/64b1234567890abcdef01234", token);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
  });

  it("returns 404 when match does not exist", async () => {
    mockDeleteMatch.mockResolvedValue(false);
    const token = await adminToken();
    const res = await del("/admin/matches/64b1234567890abcdef09999", token);
    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.success).toBe(false);
  });

  it("only deletes the specified match, not others", async () => {
    let deletedId = "";
    mockDeleteMatch.mockImplementation(async (id?: string) => { deletedId = id ?? ""; return true; });
    const token = await adminToken();
    await del("/admin/matches/64b1234567890abcdef01234", token);
    expect(deletedId).toBe("64b1234567890abcdef01234");
  });
});

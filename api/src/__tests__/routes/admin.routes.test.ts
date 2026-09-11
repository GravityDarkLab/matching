import { describe, it, expect, mock, beforeEach } from "bun:test";
import { AppError } from "../../errors.js";

// ── Mock all DB-touching modules before any imports ───────────────────────────

// Pass-through rate limiter — the real adminRateLimiter would exhaust after
// 20 requests within a single test file, causing spurious 429s. Route tests
// focus on auth / validation / service integration, not rate limiting
// (that's covered in rateLimit.middleware.test.ts).
// NOTE: factory is self-contained so Bun's mock.module hoisting works correctly.
mock.module("../../middleware/rateLimit.middleware.js", () => {
  const noop = async (_c: unknown, next: () => Promise<void>) => { await next(); };
  // Stub that passes through but still sets the expected rate-limit headers
  const stubWithHeaders = async (c: any, next: () => Promise<void>) => {
    c.header("X-RateLimit-Limit", "200");
    c.header("X-RateLimit-Remaining", "199");
    await next();
  };
  return {
    formSubmitRateLimiter:  noop,
    adminRateLimiter:       stubWithHeaders,
    adminLoginRateLimiter:  noop,
    profileRateLimiter:     noop,
    profileLoginRateLimiter: noop,
    createRateLimiter:      () => stubWithHeaders,
  };
});

const mockAdminLogin         = mock(async () => null as string | null);
const mockListApplicants     = mock(async () => ({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 }));
const mockGetApplicantById   = mock(async () => null as any);
const mockGetApplicantIdent  = mock(async () => null as any);
const mockDeactivate         = mock(async () => true);
const mockRegenerateMagicLink = mock(async () => null as any);
const mockListAuditLogs      = mock(async () => ({ data: [], total: 0, page: 1, limit: 50, totalPages: 0 }));
const mockCreateQuestionnaire = mock(async () => ({ id: "abc123", version: "2.0.0", deactivatedCount: 1 }));

mock.module("../../services/admin.service.js", () => ({
  adminLogin:           mockAdminLogin,
  listApplicants:       mockListApplicants,
  getApplicantById:     mockGetApplicantById,
  getApplicantIdentity: mockGetApplicantIdent,
  deactivateApplicant:  mockDeactivate,
  regenerateMagicLink:  mockRegenerateMagicLink,
  listAuditLogs:        mockListAuditLogs,
  createQuestionnaire:  mockCreateQuestionnaire,
}));

mock.module("../../middleware/audit.middleware.js", () => ({
  writeAuditLog:      mock(async () => {}),
  extractAuditContext: mock(() => ({ adminId: "admin", ipAddress: "127.0.0.1", userAgent: "test" })),
}));

import { Hono } from "hono";
// Dynamic, not static: static imports evaluate before this file's
// mock.module() calls run, and a route captures its rate limiter by value
// at definition time — a static import would bake in the real limiter.
const { adminRoutes } = await import("../../routes/admin.routes.js");
import { signAdminToken } from "../../middleware/auth.middleware.js";

// ── Test app ──────────────────────────────────────────────────────────────────

const app = new Hono();
app.route("/admin", adminRoutes);

// Each test gets a unique "IP" so no single rate-limit window is shared.
// The real adminRateLimiter may be active if the mock didn't intercept it.
let _ipSeq = 0;
function nextIp() { return `10.${Math.floor(_ipSeq / 256)}.${_ipSeq++ % 256}.1`; }

async function post(path: string, body: unknown, token?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-forwarded-for": nextIp(),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return app.request(path, { method: "POST", headers, body: JSON.stringify(body) });
}

async function get(path: string, token?: string) {
  const headers: Record<string, string> = { "x-forwarded-for": nextIp() };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return app.request(path, { headers });
}

async function del(path: string, token: string) {
  return app.request(path, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}`, "x-forwarded-for": nextIp() },
  });
}

async function adminToken() {
  return signAdminToken("507f1f77bcf86cd799439011", "test_admin", "admin");
}

beforeEach(() => {
  mockAdminLogin.mockReset();
  mockListApplicants.mockReset();
  mockGetApplicantById.mockReset();
  mockGetApplicantIdent.mockReset();
  mockDeactivate.mockReset();
  mockRegenerateMagicLink.mockReset();
  mockListAuditLogs.mockReset();
  mockCreateQuestionnaire.mockReset();

  // Restore defaults
  mockListApplicants.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 });
  mockListAuditLogs.mockResolvedValue({ data: [], total: 0, page: 1, limit: 50, totalPages: 0 });
  mockDeactivate.mockResolvedValue(true);
  mockCreateQuestionnaire.mockResolvedValue({ id: "abc123", version: "2.0.0", deactivatedCount: 1 });
});

// ── POST /admin/login ─────────────────────────────────────────────────────────

describe("POST /admin/login", () => {
  it("returns 200 and sets an HttpOnly cookie on valid credentials", async () => {
    mockAdminLogin.mockResolvedValue("jwt.token.here");
    const res = await post("/admin/login", { username: "admin", password: "secret" });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.token).toBeUndefined();
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("admin_token=");
    expect(cookie).toContain("HttpOnly");
  });

  it("returns 401 on invalid credentials", async () => {
    mockAdminLogin.mockResolvedValue(null);
    const res = await post("/admin/login", { username: "admin", password: "wrong" });
    expect(res.status).toBe(401);
    const body = await res.json() as any;
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/invalid credentials/i);
  });

  it("returns 422 when username or password is missing", async () => {
    const res = await post("/admin/login", { username: "admin" });
    expect(res.status).toBe(422);
    const body = await res.json() as any;
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/validation/i);
  });

  it("returns 422 for empty strings", async () => {
    const res = await post("/admin/login", { username: "", password: "" });
    expect(res.status).toBe(422);
  });
});

// ── GET /admin/applicants ─────────────────────────────────────────────────────

describe("GET /admin/applicants", () => {
  it("returns 401 without a token", async () => {
    const res = await get("/admin/applicants");
    expect(res.status).toBe(401);
  });

  it("returns 200 with paginated list when authenticated", async () => {
    const token = await adminToken();
    const res = await get("/admin/applicants", token);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(typeof body.total).toBe("number");
  });

  it("returns 200 with a valid token (rate limiter is mocked in tests)", async () => {
    const token = await adminToken();
    const res = await get("/admin/applicants", token);
    expect(res.status).toBe(200);
  });

  it("passes search query param to service for alias filtering", async () => {
    const token = await adminToken();
    await get("/admin/applicants?search=lunar", token);
    const [, , , search] = mockListApplicants.mock.calls[0] as any[];
    expect(search).toBe("lunar");
  });

  it("search is case-insensitive — service receives raw term, DB does $regex /i/", async () => {
    mockListApplicants.mockResolvedValue({
      data: [{ id: "1", alias: "Lunar Ocean", status: "active", answers: {}, questionnaireVersion: "1.0.0", createdAt: new Date(), updatedAt: new Date() }],
      total: 1, page: 1, limit: 20, totalPages: 1,
    } as any);
    const token = await adminToken();
    const res = await get("/admin/applicants?search=LUNAR", token);
    expect(res.status).toBe(200);
    const [, , , search] = mockListApplicants.mock.calls[0] as any[];
    expect(search).toBe("LUNAR");
  });

  it("omits search param when not provided", async () => {
    const token = await adminToken();
    await get("/admin/applicants", token);
    const [, , , search] = mockListApplicants.mock.calls[0] as any[];
    expect(search).toBeUndefined();
  });

  it("passes status and search together", async () => {
    const token = await adminToken();
    await get("/admin/applicants?status=applied&search=ocean", token);
    const [, , status, search] = mockListApplicants.mock.calls[0] as any[];
    expect(status).toBe("applied");
    expect(search).toBe("ocean");
  });

  it("passes scheduledDeletion=true when the 'scheduled' tab is requested", async () => {
    const token = await adminToken();
    await get("/admin/applicants?scheduledDeletion=true", token);
    const [, , , , scheduledDeletion] = mockListApplicants.mock.calls[0] as any[];
    expect(scheduledDeletion).toBe(true);
  });

  it("defaults scheduledDeletion to false when not provided", async () => {
    const token = await adminToken();
    await get("/admin/applicants", token);
    const [, , , , scheduledDeletion] = mockListApplicants.mock.calls[0] as any[];
    expect(scheduledDeletion).toBe(false);
  });
});

// ── GET /admin/applicants/:id ─────────────────────────────────────────────────

describe("GET /admin/applicants/:id", () => {
  it("returns 200 with applicant data when found", async () => {
    mockGetApplicantById.mockResolvedValue({
      id: "64b1234567890abcdef01234",
      alias: "Blue Falcon",
      status: "active",
      answers: {},
      questionnaireVersion: "1.0.0",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const token = await adminToken();
    const res = await get("/admin/applicants/64b1234567890abcdef01234", token);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.data.alias).toBe("Blue Falcon");
  });

  it("returns 404 when the applicant is not found", async () => {
    mockGetApplicantById.mockResolvedValue(null);
    const token = await adminToken();
    const res = await get("/admin/applicants/64b1234567890abcdef09999", token);
    expect(res.status).toBe(404);
  });

  it("returns 401 without a token", async () => {
    const res = await get("/admin/applicants/64b1234567890abcdef01234");
    expect(res.status).toBe(401);
  });
});

// ── GET /admin/applicants/:id/identity ───────────────────────────────────────

describe("GET /admin/applicants/:id/identity", () => {
  async function superAdminToken() {
    return signAdminToken("507f1f77bcf86cd799439011", "test_admin", "super_admin");
  }

  it("returns 200 with decrypted handle when identity exists (super_admin)", async () => {
    mockGetApplicantIdent.mockResolvedValue({
      alias: "Blue Falcon",
      instagramHandle: "@real_handle",
      fullName: "Jane Doe",
    });
    const token = await superAdminToken();
    const res = await get("/admin/applicants/64b1234567890abcdef01234/identity", token);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.data.instagramHandle).toBe("@real_handle");
    expect(body.data.alias).toBe("Blue Falcon");
    expect(body.data.fullName).toBe("Jane Doe");
  });

  it("returns 404 when identity is not found (super_admin)", async () => {
    mockGetApplicantIdent.mockResolvedValue(null);
    const token = await superAdminToken();
    const res = await get("/admin/applicants/64b1234567890abcdef09999/identity", token);
    expect(res.status).toBe(404);
  });

  it("returns 401 without a token — PII is always gated", async () => {
    const res = await get("/admin/applicants/64b1234567890abcdef01234/identity");
    expect(res.status).toBe(401);
  });
});

// ── DELETE /admin/applicants/:id ──────────────────────────────────────────────

describe("DELETE /admin/applicants/:id", () => {
  it("returns 200 on successful deactivation", async () => {
    mockGetApplicantById.mockResolvedValue({ alias: "Blue Falcon", id: "abc" });
    mockDeactivate.mockResolvedValue(true);
    const token = await adminToken();
    const res = await del("/admin/applicants/64b1234567890abcdef01234", token);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
  });

  it("returns 404 when the applicant does not exist", async () => {
    mockGetApplicantById.mockResolvedValue(null);
    const token = await adminToken();
    const res = await del("/admin/applicants/64b1234567890abcdef09999", token);
    expect(res.status).toBe(404);
  });

  it("returns 401 without a token", async () => {
    const res = await app.request("/admin/applicants/64b1234567890abcdef01234", {
      method: "DELETE",
    });
    expect(res.status).toBe(401);
  });
});

// ── GET /admin/audit-logs ─────────────────────────────────────────────────────

describe("GET /admin/audit-logs", () => {
  it("returns 200 with paginated audit logs", async () => {
    const token = await adminToken();
    const res = await get("/admin/audit-logs", token);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("returns 401 without a token", async () => {
    const res = await get("/admin/audit-logs");
    expect(res.status).toBe(401);
  });
});

// ── POST /admin/questionnaires ────────────────────────────────────────────────

const minimalQuestionnaire = {
  version: "2.0.0",
  name: "Ons v2",
  sections: [
    {
      id: "s1",
      title: "Identity",
      order: 1,
      questions: [
        {
          id: "q1",
          label: "Name",
          type: "text",
          sensitive: false,
          required: true,
          order: 1,
        },
      ],
    },
  ],
};

describe("POST /admin/questionnaires", () => {
  it("returns 201 on success", async () => {
    const token = await adminToken();
    const res = await post("/admin/questionnaires", minimalQuestionnaire, token);
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.version).toBe("2.0.0");
  });

  it("returns 422 when version is not semver", async () => {
    const token = await adminToken();
    const bad = { ...minimalQuestionnaire, version: "v2" };
    const res = await post("/admin/questionnaires", bad, token);
    expect(res.status).toBe(422);
  });

  it("returns 422 when sections array is empty", async () => {
    const token = await adminToken();
    const bad = { ...minimalQuestionnaire, sections: [] };
    const res = await post("/admin/questionnaires", bad, token);
    expect(res.status).toBe(422);
  });

  it("returns 409 when service throws (e.g. version already exists)", async () => {
    mockCreateQuestionnaire.mockRejectedValue(
      new AppError("Questionnaire version 2.0.0 already exists.", 409)
    );
    const token = await adminToken();
    const res = await post("/admin/questionnaires", minimalQuestionnaire, token);
    expect(res.status).toBe(409);
    const body = await res.json() as any;
    expect(body.error).toMatch(/already exists/i);
  });

  it("returns 401 without a token", async () => {
    const res = await post("/admin/questionnaires", minimalQuestionnaire);
    expect(res.status).toBe(401);
  });
});

// ── GET /admin/applicants/:id/identity — super_admin restriction ──────────────

describe("GET /admin/applicants/:id/identity — role-based access", () => {
  async function superAdminToken() {
    return signAdminToken("507f1f77bcf86cd799439011", "test_admin", "super_admin");
  }

  it("returns 403 when authenticated as regular admin", async () => {
    mockGetApplicantIdent.mockResolvedValue({
      alias: "Blue Falcon",
      instagramHandle: "@real_handle",
    });
    const token = await adminToken(); // role: "admin"
    const res = await get("/admin/applicants/64b1234567890abcdef01234/identity", token);
    expect(res.status).toBe(403);
  });

  it("returns 200 when authenticated as super_admin", async () => {
    mockGetApplicantIdent.mockResolvedValue({
      alias: "Blue Falcon",
      instagramHandle: "@real_handle",
    });
    const token = await superAdminToken();
    const res = await get("/admin/applicants/64b1234567890abcdef01234/identity", token);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.instagramHandle).toBe("@real_handle");
  });
});

// ── POST /admin/applicants/:id/regenerate-magic-link ──────────────────────────

describe("POST /admin/applicants/:id/regenerate-magic-link", () => {
  async function superAdminToken() {
    return signAdminToken("507f1f77bcf86cd799439011", "test_admin", "super_admin");
  }

  it("returns 200 with the new raw token (super_admin)", async () => {
    mockRegenerateMagicLink.mockResolvedValue({
      alias: "Blue Falcon",
      magicToken: "a".repeat(64),
    });
    const token = await superAdminToken();
    const res = await post("/admin/applicants/64b1234567890abcdef01234/regenerate-magic-link", {}, token);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.data.alias).toBe("Blue Falcon");
    expect(body.data.magicToken).toBe("a".repeat(64));
  });

  it("returns 404 when the applicant does not exist", async () => {
    mockRegenerateMagicLink.mockResolvedValue(null);
    const token = await superAdminToken();
    const res = await post("/admin/applicants/64b1234567890abcdef09999/regenerate-magic-link", {}, token);
    expect(res.status).toBe(404);
  });

  it("returns 403 when authenticated as regular admin", async () => {
    const token = await adminToken(); // role: "admin"
    const res = await post("/admin/applicants/64b1234567890abcdef01234/regenerate-magic-link", {}, token);
    expect(res.status).toBe(403);
    expect(mockRegenerateMagicLink).not.toHaveBeenCalled();
  });

  it("returns 401 without a token", async () => {
    const res = await post("/admin/applicants/64b1234567890abcdef01234/regenerate-magic-link", {});
    expect(res.status).toBe(401);
  });
});

import { describe, it, expect, mock, beforeEach } from "bun:test";
import { AppError } from "../../errors.js";

// ── Mock all dependencies before any imports ──────────────────────────────────

mock.module("../../middleware/rateLimit.middleware.js", () => {
  const noop = async (_c: unknown, next: () => Promise<void>) => { await next(); };
  return {
    formSubmitRateLimiter: noop,
    adminRateLimiter:      noop,
    createRateLimiter:     () => noop,
  };
});

const mockGetActiveQuestionnaire = mock(async () => null as any);
const mockGetAllQuestionnaires   = mock(async () => [] as any[]);
const mockProcessFormSubmission  = mock(async () => ({
  alias: "Blue Falcon",
  applicantId: "64b1234567890abcdef01234",
}));

mock.module("../../services/questionnaire.service.js", () => ({
  getActiveQuestionnaire:   mockGetActiveQuestionnaire,
  getAllQuestionnaires:      mockGetAllQuestionnaires,
  buildQuestionMap:         mock(() => new Map()),
  getSensitiveQuestionIds:  mock(() => new Set()),
  getQuestionnaireByVersion: mock(async () => null),
  flattenQuestions:         mock(() => []),
}));

mock.module("../../services/form.service.js", () => ({
  processFormSubmission: mockProcessFormSubmission,
}));

import { Hono } from "hono";
// Dynamic, not static: static imports evaluate before this file's
// mock.module() calls run, and a route captures its rate limiter by value
// at definition time — a static import would bake in the real limiter.
const { formRoutes } = await import("../../routes/form.routes.js");
import { generateSubmissionKey } from "../../privacy/submission-key.js";
import { ObjectId } from "mongodb";

// ── Fixture: minimal questionnaire ──────────────────────────────────────────

function makeQuestionnaire(overrides = {}) {
  return {
    _id: new ObjectId(),
    version: "1.0.0",
    name: "Ons Application",
    isActive: true,
    sections: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ── Minimal valid submission body ────────────────────────────────────────────

function validBody() {
  return {
    questionnaireVersion: "1.0.0",
    answers: {
      first_name: "Test",
      last_name: "User",
      instagram_handle: "@test_user",
      location: "Tunis",
      birth_date: "2000-05-15",
      work: "Engineer",
      gender_identity: "Male",
      sexual_orientation: "Straight",
      religion: "Islam",
      vibe_words: "funny kind",
      lifestyle: "gym coffee",
      relationship_type: "Long Term",
      open_to_long_distance: false,
      preferred_physical_traits: "tall",
      preferred_character_traits: "kind",
      deal_breakers: "smoking",
      okay_with_opposite_gender_friends: true,
      religion_deal_breaker: false,
      physical_affection_importance: 7,
      dream_first_date: "coffee walk",
      disclaimer_agreed: true,
    },
  };
}

// ── Test app ─────────────────────────────────────────────────────────────────

const app = new Hono();
app.route("/form", formRoutes);

async function get(path: string) {
  return app.request(path);
}

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockGetActiveQuestionnaire.mockReset();
  mockGetAllQuestionnaires.mockReset();
  mockProcessFormSubmission.mockReset();
  mockProcessFormSubmission.mockResolvedValue({
    alias: "Blue Falcon",
    applicantId: "64b1234567890abcdef01234",
  });
});

// ── GET /form/questionnaire ───────────────────────────────────────────────────

describe("GET /form/questionnaire", () => {
  it("returns 200 with questionnaire + submissionKey when active questionnaire exists", async () => {
    mockGetActiveQuestionnaire.mockResolvedValue(makeQuestionnaire());
    const res = await get("/form/questionnaire");
    expect(res.status).toBe(200);

    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.data.version).toBe("1.0.0");
    expect(typeof body.data.submissionKey).toBe("string");
    expect(body.data.submissionKey).toHaveLength(64); // 32-byte hex
  });

  it("submissionKey is valid HMAC for the returned version", async () => {
    mockGetActiveQuestionnaire.mockResolvedValue(makeQuestionnaire({ version: "2.0.0" }));
    const res = await get("/form/questionnaire");
    const body = await res.json() as any;

    const expectedKey = generateSubmissionKey("2.0.0");
    expect(body.data.submissionKey).toBe(expectedKey);
  });

  it("returns 404 when no active questionnaire exists", async () => {
    mockGetActiveQuestionnaire.mockResolvedValue(null);
    const res = await get("/form/questionnaire");
    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.success).toBe(false);
  });

  it("returns 400 for an invalid filter value", async () => {
    const res = await get("/form/questionnaire?filter=invalid");
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/invalid filter/i);
  });

  it("returns all questionnaires when filter=all", async () => {
    mockGetAllQuestionnaires.mockResolvedValue([
      makeQuestionnaire({ version: "2.0.0" }),
      makeQuestionnaire({ version: "1.0.0", isActive: false }),
    ]);
    const res = await get("/form/questionnaire?filter=all");
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toHaveLength(2);
    // submissionKey should NOT be present in the all-list
    expect(body.data[0].submissionKey).toBeUndefined();
  });
});

// ── POST /form/submit ─────────────────────────────────────────────────────────

describe("POST /form/submit", () => {
  it("returns 201 with alias and applicantId on valid submission", async () => {
    const key = generateSubmissionKey("1.0.0");
    const res = await post("/form/submit", validBody(), { "X-Submission-Key": key });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.alias).toBe("Blue Falcon");
    expect(body.applicantId).toBe("64b1234567890abcdef01234");
  });

  it("returns 422 when required fields are missing from the body", async () => {
    const res = await post("/form/submit", { questionnaireVersion: "1.0.0", answers: {} });
    expect(res.status).toBe(422);
    const body = await res.json() as any;
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/validation/i);
  });

  it("returns 422 when questionnaireVersion is not semver", async () => {
    const bad = { ...validBody(), questionnaireVersion: "not-semver" };
    const res = await post("/form/submit", bad, { "X-Submission-Key": "x" });
    expect(res.status).toBe(422);
  });

  it("returns 422 when the birth date is under 18 years ago", async () => {
    const tooYoung = new Date();
    tooYoung.setUTCFullYear(tooYoung.getUTCFullYear() - 16);
    const bad = { ...validBody(), answers: { ...validBody().answers, birth_date: tooYoung.toISOString().slice(0, 10) } };
    const res = await post("/form/submit", bad);
    expect(res.status).toBe(422);
  });

  it("returns 422 when disclaimer_agreed is false", async () => {
    const bad = { ...validBody(), answers: { ...validBody().answers, disclaimer_agreed: false } };
    const res = await post("/form/submit", bad);
    expect(res.status).toBe(422);
  });

  it("returns 422 when instagram_handle has invalid format", async () => {
    const bad = {
      ...validBody(),
      answers: { ...validBody().answers, instagram_handle: "has spaces here" },
    };
    const res = await post("/form/submit", bad);
    expect(res.status).toBe(422);
  });

  it("returns 401 when the service throws (e.g. invalid submission key)", async () => {
    mockProcessFormSubmission.mockRejectedValue(new AppError("Invalid or missing submission key.", 401));
    const res = await post("/form/submit", validBody(), { "X-Submission-Key": "bad" });
    expect(res.status).toBe(401);
    const body = await res.json() as any;
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/invalid.*submission key/i);
  });

  it("returns 404 when questionnaire version is not found by the service", async () => {
    mockProcessFormSubmission.mockRejectedValue(new AppError("Questionnaire not found", 404));
    const key = generateSubmissionKey("99.0.0");
    const bad = { ...validBody(), questionnaireVersion: "99.0.0" };
    const res = await post("/form/submit", bad, { "X-Submission-Key": key });
    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.error).toMatch(/not found/i);
  });

  // ── Honeypot (_verify) ────────────────────────────────────────────────────

  it("passes _verify field to the service so the service can reject bots", async () => {
    const key = generateSubmissionKey("1.0.0");
    const body = { ...validBody(), _verify: "i-am-a-bot" };
    await post("/form/submit", body, { "X-Submission-Key": key });
    // The field must reach the service — service is responsible for enforcement
    const [receivedBody] = mockProcessFormSubmission.mock.calls[0] as any[];
    expect(receivedBody._verify).toBe("i-am-a-bot");
  });

  it("returns 400 when service rejects a filled honeypot", async () => {
    mockProcessFormSubmission.mockRejectedValue(new AppError("Invalid submission", 400));
    const key = generateSubmissionKey("1.0.0");
    const body = { ...validBody(), _verify: "automated-fill" };
    const res = await post("/form/submit", body, { "X-Submission-Key": key });
    expect(res.status).toBe(400);
    const json = await res.json() as any;
    expect(json.success).toBe(false);
  });

  it("accepts a submission when _verify is empty string (real browser always sends empty)", async () => {
    const key = generateSubmissionKey("1.0.0");
    const body = { ...validBody(), _verify: "" };
    const res = await post("/form/submit", body, { "X-Submission-Key": key });
    expect(res.status).toBe(201);
  });

  it("does not expose _verify in the success response", async () => {
    const key = generateSubmissionKey("1.0.0");
    const res = await post("/form/submit", { ...validBody(), _verify: "" }, { "X-Submission-Key": key });
    const json = await res.json() as any;
    expect(json._verify).toBeUndefined();
  });

  // ── Adversarial input ─────────────────────────────────────────────────────

  it("returns 422 for a completely empty body", async () => {
    const res = await post("/form/submit", {});
    expect(res.status).toBe(422);
  });

  it("returns 422 when the body is a primitive string instead of an object", async () => {
    const res = await app.request("/form/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify("not-an-object"),
    });
    expect(res.status).toBe(422);
  });

  it("returns 422 when physical_affection_importance is out of range (0)", async () => {
    const bad = { ...validBody(), answers: { ...validBody().answers, physical_affection_importance: 0 } };
    const res = await post("/form/submit", bad);
    expect(res.status).toBe(422);
  });

  it("returns 422 when physical_affection_importance is out of range (11)", async () => {
    const bad = { ...validBody(), answers: { ...validBody().answers, physical_affection_importance: 11 } };
    const res = await post("/form/submit", bad);
    expect(res.status).toBe(422);
  });

  it("returns 422 when birth_date is in the future", async () => {
    const future = new Date();
    future.setUTCFullYear(future.getUTCFullYear() + 1);
    const bad = { ...validBody(), answers: { ...validBody().answers, birth_date: future.toISOString().slice(0, 10) } };
    const res = await post("/form/submit", bad);
    expect(res.status).toBe(422);
  });

  it("returns 422 when instagram_handle has an @ in the middle (invalid format)", async () => {
    const bad = { ...validBody(), answers: { ...validBody().answers, instagram_handle: "user@name" } };
    const res = await post("/form/submit", bad);
    expect(res.status).toBe(422);
  });

  it("returns 422 when instagram_handle is just whitespace", async () => {
    const bad = { ...validBody(), answers: { ...validBody().answers, instagram_handle: "   " } };
    const res = await post("/form/submit", bad);
    expect(res.status).toBe(422);
  });

  it("returns 422 when open_to_long_distance is a string 'true' instead of boolean", async () => {
    const bad = { ...validBody(), answers: { ...validBody().answers, open_to_long_distance: "true" } };
    const res = await post("/form/submit", bad);
    expect(res.status).toBe(422);
  });

  it("returns 422 when disclaimer_agreed is absent", async () => {
    const { disclaimer_agreed: _, ...answersWithout } = validBody().answers;
    const bad = { ...validBody(), answers: answersWithout };
    const res = await post("/form/submit", bad);
    expect(res.status).toBe(422);
  });

  it("returns 422 when X-Submission-Key header is entirely absent", async () => {
    mockProcessFormSubmission.mockRejectedValue(new AppError("Invalid or missing submission key.", 401));
    const res = await post("/form/submit", validBody());
    // Route accepts (key defaults to ""), service rejects
    expect([401, 422]).toContain(res.status);
  });
});

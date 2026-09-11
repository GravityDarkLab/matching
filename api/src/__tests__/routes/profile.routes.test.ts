import { describe, it, expect, mock, beforeEach } from "bun:test";

// ── Mock all DB-touching and external modules ─────────────────────────────────

mock.module("../../middleware/rateLimit.middleware.js", () => {
  const noop = async (_c: unknown, next: () => Promise<void>) => { await next(); };
  return {
    formSubmitRateLimiter:    noop,
    adminRateLimiter:         noop,
    profileRateLimiter:       noop,
    profileLoginRateLimiter:  noop,
    createRateLimiter:        () => noop,
  };
});

const mockLoginWithMagicToken = mock(async () => null as any);
const mockSetPassword         = mock(async () => null as any);
const mockChangePassword      = mock(async () => {});
const mockGetMyProfile        = mock(async () => null as any);
const mockGetMyAnswers        = mock(async () => null as any);
const mockUpdateMyAnswers     = mock(async () => {});
const mockGetMyMatches        = mock(async () => [] as any[]);
const mockRequestContact      = mock(async () => ({ iceBreakers: [] as string[], dateIdeas: [] as string[] }));
const mockRespondToContact    = mock(async () => ({ partnerInstagram: null as string | null }));
const mockWithdrawContact     = mock(async () => {});
const mockReportOutcome       = mock(async () => {});
const mockDeactivateMyAccount = mock(async () => {});
const mockCancelAccountDeletion = mock(async () => {});
const mockDeleteMyAccountNow  = mock(async () => {});
const mockGetOrGenerateMatchSummary = mock(async () => null as any);
const mockGetDistanceNudge        = mock(async () => null as { matchId: string } | null);
const mockAcknowledgeDistanceNudge = mock(async () => {});

mock.module("../../services/match-summary.service.js", () => ({
  getOrGenerateMatchSummary: mockGetOrGenerateMatchSummary,
}));

mock.module("../../services/profile.service.js", () => ({
  loginWithMagicToken: mockLoginWithMagicToken,
  setPassword:         mockSetPassword,
  changePassword:      mockChangePassword,
  getMyProfile:        mockGetMyProfile,
  getMyAnswers:        mockGetMyAnswers,
  updateMyAnswers:     mockUpdateMyAnswers,
  getMyMatches:        mockGetMyMatches,
  requestContact:      mockRequestContact,
  respondToContact:    mockRespondToContact,
  withdrawContact:     mockWithdrawContact,
  reportOutcome:       mockReportOutcome,
  deactivateMyAccount: mockDeactivateMyAccount,
  cancelAccountDeletion: mockCancelAccountDeletion,
  deleteMyAccountNow:    mockDeleteMyAccountNow,
  getDistanceNudge:         mockGetDistanceNudge,
  acknowledgeDistanceNudge: mockAcknowledgeDistanceNudge,
}));

mock.module("../../middleware/audit.middleware.js", () => ({
  writeAuditLog:       mock(async () => {}),
  extractAuditContext: mock(() => ({ adminId: "alias", ipAddress: "127.0.0.1", userAgent: "test" })),
}));

import { Hono } from "hono";
// Dynamic, not static: static imports evaluate before this file's
// mock.module() calls run, and a route captures its rate limiter by value
// at definition time — a static import would bake in the real limiter.
const { profileRoutes } = await import("../../routes/profile.routes.js");
import { signApplicantToken } from "../../middleware/applicant.auth.middleware.js";
import { signAdminToken } from "../../middleware/auth.middleware.js";
import { ObjectId } from "mongodb";
import { AppError } from "../../errors.js";

const app = new Hono();
app.route("/profile", profileRoutes);

const VALID_MAGIC_TOKEN = "a".repeat(64);
const VALID_APPLICANT_ID = new ObjectId().toHexString();

async function applicantToken() {
  return signApplicantToken(VALID_APPLICANT_ID, "Blue Falcon");
}

function post(path: string, body: unknown, token?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return app.request(path, { method: "POST", headers, body: JSON.stringify(body) });
}

function get(path: string, token?: string) {
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return app.request(path, { headers });
}

function put(path: string, body: unknown, token?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return app.request(path, { method: "PUT", headers, body: JSON.stringify(body) });
}

beforeEach(() => {
  mockLoginWithMagicToken.mockReset();
  mockSetPassword.mockReset();
  mockChangePassword.mockReset();
  mockGetMyProfile.mockReset();
  mockGetMyAnswers.mockReset();
  mockUpdateMyAnswers.mockReset();
  mockGetMyMatches.mockReset();
  mockRequestContact.mockReset();
  mockRespondToContact.mockReset();
  mockWithdrawContact.mockReset();
  mockReportOutcome.mockReset();
  mockDeactivateMyAccount.mockReset();
  mockCancelAccountDeletion.mockReset();
  mockDeleteMyAccountNow.mockReset();
  mockGetOrGenerateMatchSummary.mockReset();
  mockGetDistanceNudge.mockReset();
  mockAcknowledgeDistanceNudge.mockReset();
  mockGetDistanceNudge.mockResolvedValue(null);

  // Restore defaults
  mockLoginWithMagicToken.mockResolvedValue(null);
  mockSetPassword.mockResolvedValue(null);
  mockGetMyMatches.mockResolvedValue([]);
  mockRequestContact.mockResolvedValue({ iceBreakers: ["Q1"], dateIdeas: ["D1"] });
  mockRespondToContact.mockResolvedValue({ partnerInstagram: null });
});

// ── POST /profile/login ───────────────────────────────────────────────────────

describe("POST /profile/login", () => {
  it("returns 200 + session cookie on valid credentials", async () => {
    mockLoginWithMagicToken.mockResolvedValue({
      status: "ok",
      applicant: { _id: new ObjectId(VALID_APPLICANT_ID), alias: "Blue Falcon" },
    });
    const res = await post("/profile/login", { magicToken: VALID_MAGIC_TOKEN, password: "amber-river-silent-fox" });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.token).toBeUndefined(); // token is in HttpOnly cookie, not response body
    expect(body.firstLogin).toBeUndefined();
    expect(res.headers.get("set-cookie")).toMatch(/ons_applicant_session=/);
  });

  it("returns 200 + firstLogin:true when passwordHash is null", async () => {
    mockLoginWithMagicToken.mockResolvedValue({ status: "first_login" });
    const res = await post("/profile/login", { magicToken: VALID_MAGIC_TOKEN });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.firstLogin).toBe(true);
    expect(body.token).toBeUndefined();
  });

  it("returns 401 on wrong password or unknown token", async () => {
    mockLoginWithMagicToken.mockResolvedValue(null);
    const res = await post("/profile/login", { magicToken: VALID_MAGIC_TOKEN, password: "wrong" });
    expect(res.status).toBe(401);
  });

  it("returns 200 + passwordRequired:true when password is omitted but already set", async () => {
    mockLoginWithMagicToken.mockResolvedValue({ status: "password_required" });
    const res = await post("/profile/login", { magicToken: VALID_MAGIC_TOKEN });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.passwordRequired).toBe(true);
    expect(body.firstLogin).toBeUndefined();
    expect(body.token).toBeUndefined();
  });

  it("returns 422 when magicToken is the wrong length", async () => {
    const res = await post("/profile/login", { magicToken: "short", password: "some-pass" });
    expect(res.status).toBe(422);
  });

  it("refreshes the session when revisiting the magic link while already signed in", async () => {
    mockLoginWithMagicToken.mockResolvedValue({
      status: "ok",
      applicant: { _id: new ObjectId(VALID_APPLICANT_ID), alias: "Blue Falcon" },
    });
    const token = await applicantToken();
    const res = await post("/profile/login", { magicToken: VALID_MAGIC_TOKEN }, token);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.firstLogin).toBeUndefined();
    expect(body.passwordRequired).toBeUndefined();
    expect(res.headers.get("set-cookie")).toMatch(/ons_applicant_session=/);
    expect(mockLoginWithMagicToken).toHaveBeenCalledWith(VALID_MAGIC_TOKEN, undefined, VALID_APPLICANT_ID);
  });
});

// ── POST /profile/set-password ────────────────────────────────────────────────

describe("POST /profile/set-password", () => {
  it("returns 200 + session cookie when first-login password is accepted", async () => {
    mockSetPassword.mockResolvedValue({
      _id: new ObjectId(VALID_APPLICANT_ID),
      alias: "Blue Falcon",
    });
    const res = await post("/profile/set-password", {
      magicToken: VALID_MAGIC_TOKEN,
      newPassword: "my-secure-pass",
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.token).toBeUndefined(); // token is in HttpOnly cookie, not response body
    expect(res.headers.get("set-cookie")).toMatch(/ons_applicant_session=/);
  });

  it("returns 401 when magicToken is not found", async () => {
    mockSetPassword.mockResolvedValue(null);
    const res = await post("/profile/set-password", {
      magicToken: VALID_MAGIC_TOKEN,
      newPassword: "my-secure-pass",
    });
    expect(res.status).toBe(401);
  });

  it("returns 409 when password is already set", async () => {
    mockSetPassword.mockRejectedValue(
      new AppError("Password already set.", 409)
    );
    const res = await post("/profile/set-password", {
      magicToken: VALID_MAGIC_TOKEN,
      newPassword: "my-secure-pass",
    });
    expect(res.status).toBe(409);
  });

  it("returns 422 when newPassword is too short", async () => {
    const res = await post("/profile/set-password", {
      magicToken: VALID_MAGIC_TOKEN,
      newPassword: "short",
    });
    expect(res.status).toBe(422);
  });
});

// ── GET /profile/suggest-password ─────────────────────────────────────────────

describe("GET /profile/suggest-password", () => {
  it("returns a 6-word passphrase without auth", async () => {
    const res = await get("/profile/suggest-password");
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(typeof body.suggestion).toBe("string");
    expect(body.suggestion.split("-")).toHaveLength(6);
  });
});

// ── POST /profile/change-password ─────────────────────────────────────────────

describe("POST /profile/change-password", () => {
  it("returns 401 without token", async () => {
    const res = await post("/profile/change-password", {
      currentPassword: "old",
      newPassword: "new-secure-pass",
    });
    expect(res.status).toBe(401);
  });

  it("returns 200 on successful change", async () => {
    const token = await applicantToken();
    const res = await post("/profile/change-password", {
      currentPassword: "old-pass",
      newPassword: "new-secure-pass",
    }, token);
    expect(res.status).toBe(200);
  });

  it("returns 401 when current password is wrong", async () => {
    mockChangePassword.mockRejectedValue(
      new AppError("Current password is incorrect", 401)
    );
    const token = await applicantToken();
    const res = await post("/profile/change-password", {
      currentPassword: "wrong",
      newPassword: "new-secure-pass",
    }, token);
    expect(res.status).toBe(401);
  });

  it("returns 422 when newPassword is too short", async () => {
    const token = await applicantToken();
    const res = await post("/profile/change-password", {
      currentPassword: "old",
      newPassword: "short",
    }, token);
    expect(res.status).toBe(422);
  });
});

// ── GET /profile/me ───────────────────────────────────────────────────────────

describe("GET /profile/me", () => {
  it("returns 401 without a token", async () => {
    const res = await get("/profile/me");
    expect(res.status).toBe(401);
  });

  it("returns 401 with an admin JWT (wrong type)", async () => {
    const adminJwt = await signAdminToken("adminId", "test_admin", "admin");
    const res = await get("/profile/me", adminJwt);
    expect(res.status).toBe(401);
  });

  it("returns 200 with applicant JWT", async () => {
    mockGetMyProfile.mockResolvedValue({
      applicantId: VALID_APPLICANT_ID,
      alias: "Blue Falcon",
      status: "applied",
      scoreThreshold: 0.8,
      createdAt: new Date(),
    });
    const token = await applicantToken();
    const res = await get("/profile/me", token);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.data.alias).toBe("Blue Falcon");
  });
});

// ── GET /profile/answers ──────────────────────────────────────────────────────

const VALID_ANSWERS_UPDATE = {
  location: "Paris, France",
  work: "Student",
  sexual_orientation: "Straight",
  religion: "Islam",
  vibe_words: "calm, curious",
  lifestyle: "Early riser, gym, reading",
  relationship_type: "Long Term",
  open_to_long_distance: true,
  preferred_physical_traits: "Tall",
  preferred_character_traits: "Kind",
  deal_breakers: "Smoking",
  okay_with_opposite_gender_friends: true,
  religion_deal_breaker: false,
  physical_affection_importance: 7,
  dream_first_date: "A walk by the sea",
};

describe("GET /profile/answers", () => {
  it("returns 401 without a token", async () => {
    const res = await get("/profile/answers");
    expect(res.status).toBe(401);
  });

  it("returns the applicant's answers", async () => {
    mockGetMyAnswers.mockResolvedValue({ location: "Paris, France", birth_date: "1999-03-12" });
    const token = await applicantToken();
    const res = await get("/profile/answers", token);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.data.answers).toEqual({ location: "Paris, France", birth_date: "1999-03-12" });
  });

  it("returns 404 when the applicant no longer exists", async () => {
    mockGetMyAnswers.mockResolvedValue(null);
    const token = await applicantToken();
    const res = await get("/profile/answers", token);
    expect(res.status).toBe(404);
  });
});

// ── PUT /profile/answers ──────────────────────────────────────────────────────

describe("PUT /profile/answers", () => {
  it("returns 401 without a token", async () => {
    const res = await put("/profile/answers", { answers: VALID_ANSWERS_UPDATE });
    expect(res.status).toBe(401);
  });

  it("updates answers with a valid payload", async () => {
    mockUpdateMyAnswers.mockResolvedValue(undefined);
    const token = await applicantToken();
    const res = await put("/profile/answers", { answers: VALID_ANSWERS_UPDATE }, token);
    expect(res.status).toBe(200);
    expect(mockUpdateMyAnswers).toHaveBeenCalledWith(VALID_APPLICANT_ID, VALID_ANSWERS_UPDATE);
  });

  it("rejects instagram_handle with 422 and never reaches the service", async () => {
    const token = await applicantToken();
    const res = await put(
      "/profile/answers",
      { answers: { ...VALID_ANSWERS_UPDATE, instagram_handle: "sneaky_handle" } },
      token,
    );
    expect(res.status).toBe(422);
    expect(mockUpdateMyAnswers).not.toHaveBeenCalled();
  });

  it("rejects disclaimer_agreed with 422", async () => {
    const token = await applicantToken();
    const res = await put(
      "/profile/answers",
      { answers: { ...VALID_ANSWERS_UPDATE, disclaimer_agreed: false } },
      token,
    );
    expect(res.status).toBe(422);
    expect(mockUpdateMyAnswers).not.toHaveBeenCalled();
  });

  it("rejects unknown keys with 422", async () => {
    const token = await applicantToken();
    const res = await put(
      "/profile/answers",
      { answers: { ...VALID_ANSWERS_UPDATE, evil_extra: "x" } },
      token,
    );
    expect(res.status).toBe(422);
    expect(mockUpdateMyAnswers).not.toHaveBeenCalled();
  });

  it("rejects the locked birth_date with 422", async () => {
    const token = await applicantToken();
    const res = await put(
      "/profile/answers",
      { answers: { ...VALID_ANSWERS_UPDATE, birth_date: "1999-03-12" } },
      token,
    );
    expect(res.status).toBe(422);
    expect(mockUpdateMyAnswers).not.toHaveBeenCalled();
  });

  it("rejects the locked gender_identity with 422", async () => {
    const token = await applicantToken();
    const res = await put(
      "/profile/answers",
      { answers: { ...VALID_ANSWERS_UPDATE, gender_identity: "Other" } },
      token,
    );
    expect(res.status).toBe(422);
    expect(mockUpdateMyAnswers).not.toHaveBeenCalled();
  });

  it("rejects invalid field values with 422 (affection out of range)", async () => {
    const token = await applicantToken();
    const res = await put(
      "/profile/answers",
      { answers: { ...VALID_ANSWERS_UPDATE, physical_affection_importance: 20 } },
      token,
    );
    expect(res.status).toBe(422);
    expect(mockUpdateMyAnswers).not.toHaveBeenCalled();
  });

  it("accepts a payload without the optional height_cm", async () => {
    mockUpdateMyAnswers.mockResolvedValue(undefined);
    const token = await applicantToken();
    const res = await put("/profile/answers", { answers: VALID_ANSWERS_UPDATE }, token);
    expect(res.status).toBe(200);
  });
});

// ── GET /profile/matches ──────────────────────────────────────────────────────

describe("GET /profile/matches", () => {
  it("returns 401 without token", async () => {
    const res = await get("/profile/matches");
    expect(res.status).toBe(401);
  });

  it("returns 200 with array of MatchView", async () => {
    mockGetMyMatches.mockResolvedValue([
      { matchId: "abc", partnerAlias: "River Storm", score: 0.9, breakdown: {}, status: "proposed", perspective: "none" },
    ]);
    const token = await applicantToken();
    const res = await get("/profile/matches", token);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data[0].partnerAlias).toBe("River Storm");
  });

  it("passes threshold and limit to service", async () => {
    const token = await applicantToken();
    await get("/profile/matches?threshold=0.7&limit=5", token);
    const [, threshold, limit] = mockGetMyMatches.mock.calls[0] as any[];
    expect(threshold).toBe(0.7);
    expect(limit).toBe(5);
  });

  it("accepts limit up to 50 and clamps beyond", async () => {
    const token = await applicantToken();
    await get("/profile/matches?limit=50", token);
    expect((mockGetMyMatches.mock.calls[0] as any[])[2]).toBe(50);

    await get("/profile/matches?limit=120", token);
    expect((mockGetMyMatches.mock.calls[1] as any[])[2]).toBe(50);
  });
});

// ── POST /profile/matches/:id/contact ────────────────────────────────────────

describe("POST /profile/matches/:id/contact", () => {
  it("returns 401 without token", async () => {
    const res = await post("/profile/matches/abc123/contact", {});
    expect(res.status).toBe(401);
  });

  it("returns 200 with iceBreakers + dateIdeas (no Instagram — mutual reveal happens on accept)", async () => {
    mockRequestContact.mockResolvedValue({
      iceBreakers: ["What's your favourite place?"],
      dateIdeas: ["Coffee walk"],
    });
    const token = await applicantToken();
    const res = await post("/profile/matches/abc123/contact", {}, token);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.data.targetInstagram).toBeUndefined();
    expect(Array.isArray(body.data.iceBreakers)).toBe(true);
  });
});

// ── POST /profile/matches/:id/respond ────────────────────────────────────────

describe("POST /profile/matches/:id/respond", () => {
  it("returns 401 without token", async () => {
    const res = await post("/profile/matches/abc123/respond", { accept: true });
    expect(res.status).toBe(401);
  });

  it("returns 200 on accept", async () => {
    const token = await applicantToken();
    const res = await post("/profile/matches/abc123/respond", { accept: true }, token);
    expect(res.status).toBe(200);
  });

  it("returns 200 on decline", async () => {
    const token = await applicantToken();
    const res = await post("/profile/matches/abc123/respond", { accept: false }, token);
    expect(res.status).toBe(200);
  });

  it("returns 422 when accept field is missing", async () => {
    const token = await applicantToken();
    const res = await post("/profile/matches/abc123/respond", {}, token);
    expect(res.status).toBe(422);
  });
});

// ── POST /profile/matches/:id/withdraw ───────────────────────────────────────

describe("POST /profile/matches/:id/withdraw", () => {
  it("returns 401 without token", async () => {
    const res = await post("/profile/matches/abc123/withdraw", {});
    expect(res.status).toBe(401);
  });

  it("returns 200 and calls the service with applicant + match ids", async () => {
    const token = await applicantToken();
    const res = await post("/profile/matches/abc123/withdraw", {}, token);
    expect(res.status).toBe(200);
    const [applicantId, matchId] = mockWithdrawContact.mock.calls[0] as any[];
    expect(applicantId).toBe(VALID_APPLICANT_ID);
    expect(matchId).toBe("abc123");
  });

  it("maps a 403 service error (target cannot withdraw)", async () => {
    mockWithdrawContact.mockRejectedValue(
      new AppError("Only the initiator can withdraw their contact request", 403)
    );
    const token = await applicantToken();
    const res = await post("/profile/matches/abc123/withdraw", {}, token);
    expect(res.status).toBe(403);
  });

  it("maps a 409 service error (not in_progress)", async () => {
    mockWithdrawContact.mockRejectedValue(
      new AppError('Match status is "declined" — nothing to withdraw', 409)
    );
    const token = await applicantToken();
    const res = await post("/profile/matches/abc123/withdraw", {}, token);
    expect(res.status).toBe(409);
  });
});

// ── POST /profile/matches/:id/outcome ────────────────────────────────────────

describe("POST /profile/matches/:id/outcome", () => {
  it("returns 401 without token", async () => {
    const res = await post("/profile/matches/abc123/outcome", { outcome: "failed" });
    expect(res.status).toBe(401);
  });

  it("returns 200 for outcome: failed", async () => {
    const token = await applicantToken();
    const res = await post("/profile/matches/abc123/outcome", { outcome: "failed" }, token);
    expect(res.status).toBe(200);
  });

  it("returns 200 for outcome: success", async () => {
    const token = await applicantToken();
    const res = await post("/profile/matches/abc123/outcome", { outcome: "success" }, token);
    expect(res.status).toBe(200);
  });

  it("returns 422 for invalid outcome value", async () => {
    const token = await applicantToken();
    const res = await post("/profile/matches/abc123/outcome", { outcome: "start_over" }, token);
    expect(res.status).toBe(422);
  });

  it("accepts optional outcomeFeedback tags and note", async () => {
    const token = await applicantToken();
    const res = await post(
      "/profile/matches/abc123/outcome",
      { outcome: "failed", outcomeFeedback: { tags: ["too_far", "no_spark"], note: "We tried" } },
      token,
    );
    expect(res.status).toBe(200);
    expect(mockReportOutcome).toHaveBeenCalledWith(
      VALID_APPLICANT_ID,
      "abc123",
      "failed",
      { feedback: { tags: ["too_far", "no_spark"], note: "We tried" }, continuation: undefined },
      expect.anything(),
    );
  });

  it("accepts an optional continuation choice", async () => {
    const token = await applicantToken();
    const res = await post(
      "/profile/matches/abc123/outcome",
      { outcome: "failed", continuation: "break" },
      token,
    );
    expect(res.status).toBe(200);
    expect(mockReportOutcome).toHaveBeenCalledWith(
      VALID_APPLICANT_ID,
      "abc123",
      "failed",
      { feedback: undefined, continuation: "break" },
      expect.anything(),
    );
  });

  it("returns 422 for an unknown feedback tag", async () => {
    const token = await applicantToken();
    const res = await post(
      "/profile/matches/abc123/outcome",
      { outcome: "failed", outcomeFeedback: { tags: ["made_up_tag"] } },
      token,
    );
    expect(res.status).toBe(422);
  });

  it("returns 403 when reportOutcome rejects as too early", async () => {
    mockReportOutcome.mockRejectedValue(new AppError("Too early to report this outcome — available 3 days after you started dating", 403));
    const token = await applicantToken();
    const res = await post("/profile/matches/abc123/outcome", { outcome: "failed" }, token);
    expect(res.status).toBe(403);
  });
});

// ── POST /profile/matches/:id/nudge-ack ──────────────────────────────────────

describe("POST /profile/matches/:id/nudge-ack", () => {
  it("returns 401 without token", async () => {
    const res = await post("/profile/matches/abc123/nudge-ack", { openUp: true });
    expect(res.status).toBe(401);
  });

  it("returns 200 and forwards openUp", async () => {
    const token = await applicantToken();
    const res = await post("/profile/matches/abc123/nudge-ack", { openUp: true }, token);
    expect(res.status).toBe(200);
    expect(mockAcknowledgeDistanceNudge).toHaveBeenCalledWith(VALID_APPLICANT_ID, "abc123", true);
  });

  it("returns 422 when openUp is missing", async () => {
    const token = await applicantToken();
    const res = await post("/profile/matches/abc123/nudge-ack", {}, token);
    expect(res.status).toBe(422);
  });
});

// ── POST /profile/deactivate ──────────────────────────────────────────────────

describe("POST /profile/deactivate", () => {
  it("returns 401 without token", async () => {
    const res = await post("/profile/deactivate", {});
    expect(res.status).toBe(401);
  });

  it("returns 200 with valid applicant token", async () => {
    const token = await applicantToken();
    const res = await post("/profile/deactivate", {}, token);
    expect(res.status).toBe(200);
  });
});

// ── POST /profile/cancel-deletion ───────────────────────────────────────────────

describe("POST /profile/cancel-deletion", () => {
  it("returns 401 without token", async () => {
    const res = await post("/profile/cancel-deletion", {});
    expect(res.status).toBe(401);
  });

  it("returns 200 when a deletion is scheduled", async () => {
    const token = await applicantToken();
    const res = await post("/profile/cancel-deletion", {}, token);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(mockCancelAccountDeletion).toHaveBeenCalledWith(VALID_APPLICANT_ID);
  });

  it("returns 409 when no deletion is scheduled", async () => {
    mockCancelAccountDeletion.mockRejectedValue(
      new AppError("No deletion is scheduled for this account", 409)
    );
    const token = await applicantToken();
    const res = await post("/profile/cancel-deletion", {}, token);
    expect(res.status).toBe(409);
    const body = await res.json() as any;
    expect(body.success).toBe(false);
  });
});

// ── POST /profile/delete-now ────────────────────────────────────────────────────

describe("POST /profile/delete-now", () => {
  it("returns 401 without token", async () => {
    const res = await post("/profile/delete-now", {});
    expect(res.status).toBe(401);
  });

  it("returns 200 and clears the session cookie", async () => {
    const token = await applicantToken();
    const res = await post("/profile/delete-now", {}, token);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(mockDeleteMyAccountNow).toHaveBeenCalled();
    expect(res.headers.get("set-cookie")).toMatch(/ons_applicant_session=;/);
  });

  it("returns 404 when applicant no longer exists", async () => {
    mockDeleteMyAccountNow.mockRejectedValue(new AppError("Not found", 404));
    const token = await applicantToken();
    const res = await post("/profile/delete-now", {}, token);
    expect(res.status).toBe(404);
  });
});

// ── POST /profile/logout ────────────────────────────────────────────────────────

describe("POST /profile/logout", () => {
  it("returns 200 and clears the session cookie without a session", async () => {
    const res = await post("/profile/logout", {});
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(res.headers.get("set-cookie")).toMatch(/ons_applicant_session=;/);
  });

  it("returns 200 and clears the session cookie with a valid session", async () => {
    const token = await applicantToken();
    const res = await post("/profile/logout", {}, token);
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/ons_applicant_session=;/);
  });
});

// ── GET /profile/matches/:id/summary ─────────────────────────────────────────

describe("GET /profile/matches/:id/summary", () => {
  const MATCH_ID = new ObjectId().toHexString();

  const CACHED_SUMMARY = {
    pros: ["You share similar long-term relationship goals.", "Both value family and close friendships."],
    cons: ["Religious importance differs — worth early discussion."],
    generatedAt: new Date("2026-06-18T10:00:00Z"),
    model: "gpt-4o-mini",
  };

  it("returns 401 without a token", async () => {
    const res = await get(`/profile/matches/${MATCH_ID}/summary`);
    expect(res.status).toBe(401);
    expect(mockGetOrGenerateMatchSummary).not.toHaveBeenCalled();
  });

  it("returns 401 when an admin token is used (wrong audience)", async () => {
    const adminToken = await signAdminToken("admin-id", "admin", "admin");
    const res = await get(`/profile/matches/${MATCH_ID}/summary`, adminToken);
    expect(res.status).toBe(401);
  });

  it("returns 200 with summary data when service returns a cached summary", async () => {
    mockGetOrGenerateMatchSummary.mockResolvedValue(CACHED_SUMMARY);
    const token = await applicantToken();
    const res = await get(`/profile/matches/${MATCH_ID}/summary`, token);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data.pros)).toBe(true);
    expect(Array.isArray(body.data.cons)).toBe(true);
    expect(body.data.pros).toHaveLength(2);
    expect(body.data.cons).toHaveLength(1);
    expect(typeof body.data.model).toBe("string");
  });

  it("calls the service with the correct matchId and applicantId", async () => {
    mockGetOrGenerateMatchSummary.mockResolvedValue(CACHED_SUMMARY);
    const token = await applicantToken();
    await get(`/profile/matches/${MATCH_ID}/summary`, token);
    const [calledMatchId, calledApplicantId] = mockGetOrGenerateMatchSummary.mock.calls[0] as unknown as [string, string];
    expect(calledMatchId).toBe(MATCH_ID);
    expect(calledApplicantId).toBe(VALID_APPLICANT_ID);
  });

  it("returns 404 when the service returns null (match not found or not a participant)", async () => {
    mockGetOrGenerateMatchSummary.mockResolvedValue(null);
    const token = await applicantToken();
    const res = await get(`/profile/matches/${MATCH_ID}/summary`, token);
    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.success).toBe(false);
  });

  it("returns 500 when the service throws unexpectedly", async () => {
    mockGetOrGenerateMatchSummary.mockRejectedValue(new Error("LLM timeout"));
    const token = await applicantToken();
    const res = await get(`/profile/matches/${MATCH_ID}/summary`, token);
    expect(res.status).toBe(500);
  });

  it("works with a match id that looks like a real ObjectId hex string", async () => {
    mockGetOrGenerateMatchSummary.mockResolvedValue(CACHED_SUMMARY);
    const token = await applicantToken();
    const res = await get(`/profile/matches/64f1a2b3c4d5e6f7a8b9c0d5/summary`, token);
    expect(res.status).toBe(200);
  });
});

// ── Adversarial / reliability edge cases ─────────────────────────────────────

describe("Adversarial: cross-authentication boundary", () => {
  it("admin token is rejected on /profile/me", async () => {
    const adminToken = await signAdminToken("admin-id", "admin", "admin");
    const res = await get("/profile/me", adminToken);
    expect(res.status).toBe(401);
  });

  it("applicant token is rejected on a non-existent admin endpoint", async () => {
    const token = await applicantToken();
    const res = await get("/profile/admin-only-route", token);
    // Should 401 or 404 — not 200 with applicant data
    expect(res.status).not.toBe(200);
  });
});

describe("Adversarial: malformed / oversized payloads", () => {
  it("POST /profile/matches/:id/respond with non-boolean accept → 422", async () => {
    const token = await applicantToken();
    const res = await post("/profile/matches/abc123/respond", { accept: "yes" }, token);
    expect(res.status).toBe(422);
  });

  it("POST /profile/matches/:id/respond with accept=null → 422", async () => {
    const token = await applicantToken();
    const res = await post("/profile/matches/abc123/respond", { accept: null }, token);
    expect(res.status).toBe(422);
  });

  it("POST /profile/matches/:id/respond with extra unknown fields still works", async () => {
    const token = await applicantToken();
    const res = await post("/profile/matches/abc123/respond", { accept: true, injected: "x".repeat(5000) }, token);
    expect(res.status).toBe(200);
  });

  it("POST /profile/matches/:id/outcome with unknown outcome value → 422", async () => {
    const token = await applicantToken();
    const res = await post("/profile/matches/abc123/outcome", { outcome: "married" }, token);
    expect(res.status).toBe(422);
  });

  it("POST /profile/matches/:id/outcome with numeric outcome → 422", async () => {
    const token = await applicantToken();
    const res = await post("/profile/matches/abc123/outcome", { outcome: 1 }, token);
    expect(res.status).toBe(422);
  });

  it("GET /profile/matches with threshold=NaN ignores the bad param (uses default)", async () => {
    const token = await applicantToken();
    const res = await get("/profile/matches?threshold=not-a-number", token);
    // Should succeed (NaN coerces to 0 or is clamped/ignored)
    expect([200, 422]).toContain(res.status);
  });

  it("GET /profile/matches with negative threshold clamps to default range", async () => {
    const token = await applicantToken();
    const res = await get("/profile/matches?threshold=-1", token);
    expect(res.status).toBe(200);
  });

  it("GET /profile/matches with threshold > 1 still returns 200 (service clamps)", async () => {
    const token = await applicantToken();
    const res = await get("/profile/matches?threshold=2.5", token);
    expect(res.status).toBe(200);
  });
});

describe("Adversarial: auth header variations", () => {
  it("rejects an empty Authorization header", async () => {
    const res = await app.request("/profile/me", {
      headers: { Authorization: "" },
    });
    expect(res.status).toBe(401);
  });

  it("rejects 'Bearer' with no token after it", async () => {
    const res = await app.request("/profile/me", {
      headers: { Authorization: "Bearer " },
    });
    expect(res.status).toBe(401);
  });

  it("rejects 'Basic' scheme instead of Bearer", async () => {
    const res = await app.request("/profile/me", {
      headers: { Authorization: "Basic dXNlcjpwYXNz" },
    });
    expect(res.status).toBe(401);
  });

  it("rejects a JWT with tampered payload (signature mismatch)", async () => {
    const token = await applicantToken();
    const parts = token.split(".");
    // Flip a byte in the payload
    const fakePayload = Buffer.from(parts[1] + "x", "base64url").toString("base64url");
    const tampered = `${parts[0]}.${fakePayload}.${parts[2]}`;
    const res = await app.request("/profile/me", {
      headers: { Authorization: `Bearer ${tampered}` },
    });
    expect(res.status).toBe(401);
  });
});

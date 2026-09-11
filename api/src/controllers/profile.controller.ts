import { Context } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import {
  loginWithMagicToken,
  setPassword as setPasswordService,
  changePassword as changePasswordService,
  getMyProfile,
  getMyAnswers,
  updateMyAnswers,
  getMyMatches,
  requestContact,
  respondToContact,
  withdrawContact,
  reportOutcome,
  deactivateMyAccount,
  cancelAccountDeletion,
  deleteMyAccountNow,
  acknowledgeDistanceNudge,
} from "../services/profile.service.js";
import { getOrGenerateMatchSummary } from "../services/match-summary.service.js";
import {
  signApplicantToken,
  tryGetApplicantSession,
  APPLICANT_COOKIE_MAX_AGE,
} from "../middleware/applicant.auth.middleware.js";
import { APPLICANT_COOKIE_NAME } from "../config/constants.js";
import { generateReadablePassword } from "../privacy/password-generator.js";
import { errorResponse } from "../utils/error-response.js";
import { getRequestMeta } from "../utils/request-meta.js";
import type { ValidatedContext } from "../utils/validated-context.js";
import type {
  ProfileLoginInput,
  SetPasswordInput,
  ChangePasswordInput,
  UpdateAnswersInput,
  MatchQueryInput,
  RespondInput,
  OutcomeInput,
  NudgeAckInput,
} from "../validators/profile.validator.js";
import { env } from "../config/env.js";

function setSessionCookie(c: Context, token: string): void {
  setCookie(c, APPLICANT_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.nodeEnv === "production",
    sameSite: "Lax",
    maxAge: APPLICANT_COOKIE_MAX_AGE,
    path: "/",
  });
}

export async function login(c: ValidatedContext<{ json: ProfileLoginInput }>): Promise<Response> {
  const { magicToken, password } = c.req.valid("json");

  const currentApplicantId = await tryGetApplicantSession(c);
  const result = await loginWithMagicToken(magicToken, password, currentApplicantId);
  if (result === null) {
    return c.json({ success: false, error: "Invalid credentials" }, 401);
  }
  if (result.status === "first_login") {
    return c.json({ success: true, firstLogin: true });
  }
  if (result.status === "password_required") {
    return c.json({ success: true, passwordRequired: true });
  }

  const token = await signApplicantToken(
    result.applicant._id.toHexString(),
    result.applicant.alias
  );
  setSessionCookie(c, token);
  return c.json({ success: true });
}

export async function setPassword(c: ValidatedContext<{ json: SetPasswordInput }>): Promise<Response> {
  const { magicToken, newPassword } = c.req.valid("json");

  try {
    const applicant = await setPasswordService(magicToken, newPassword);
    if (!applicant) return c.json({ success: false, error: "Invalid token" }, 401);
    const token = await signApplicantToken(applicant._id.toHexString(), applicant.alias);
    setSessionCookie(c, token);
    return c.json({ success: true });
  } catch (err: unknown) {
    return errorResponse(c, err);
  }
}

export async function changePassword(c: ValidatedContext<{ json: ChangePasswordInput }>): Promise<Response> {
  const applicantId = c.get("applicantId") as string;
  const { currentPassword, newPassword } = c.req.valid("json");

  try {
    await changePasswordService(applicantId, currentPassword, newPassword);
    return c.json({ success: true });
  } catch (err: unknown) {
    return errorResponse(c, err);
  }
}

export async function suggestPassword(_c: Context): Promise<Response> {
  return _c.json({ success: true, suggestion: generateReadablePassword() });
}

export async function me(c: Context): Promise<Response> {
  const applicantId = c.get("applicantId") as string;
  const profile = await getMyProfile(applicantId);
  if (!profile) return c.json({ success: false, error: "Not found" }, 404);
  return c.json({ success: true, data: profile });
}

export async function answers(c: Context): Promise<Response> {
  const applicantId = c.get("applicantId") as string;
  const data = await getMyAnswers(applicantId);
  if (!data) return c.json({ success: false, error: "Not found" }, 404);
  return c.json({ success: true, data: { answers: data } });
}

export async function updateAnswers(c: ValidatedContext<{ json: UpdateAnswersInput }>): Promise<Response> {
  const applicantId = c.get("applicantId") as string;
  const { answers: updates } = c.req.valid("json");

  try {
    await updateMyAnswers(applicantId, updates);
    return c.json({ success: true });
  } catch (err: unknown) {
    return errorResponse(c, err);
  }
}

export async function matches(c: ValidatedContext<{ query: MatchQueryInput }>): Promise<Response> {
  const applicantId = c.get("applicantId") as string;
  const { threshold, limit } = c.req.valid("query");
  const data = await getMyMatches(applicantId, threshold, limit, getRequestMeta(c));
  return c.json({ success: true, data });
}

export async function contact(c: Context): Promise<Response> {
  const applicantId = c.get("applicantId") as string;
  const matchId     = c.req.param("id") as string;

  try {
    const result = await requestContact(applicantId, matchId);
    return c.json({ success: true, data: result });
  } catch (err: unknown) {
    return errorResponse(c, err);
  }
}

export async function respond(c: ValidatedContext<{ json: RespondInput }>): Promise<Response> {
  const applicantId = c.get("applicantId") as string;
  const matchId     = c.req.param("id") as string;
  const { accept }  = c.req.valid("json");

  try {
    const { partnerInstagram, partnerFullName } = await respondToContact(applicantId, matchId, accept, getRequestMeta(c));
    return c.json({ success: true, data: { partnerInstagram, partnerFullName } });
  } catch (err: unknown) {
    return errorResponse(c, err);
  }
}

export async function withdraw(c: Context): Promise<Response> {
  const applicantId = c.get("applicantId") as string;
  const matchId     = c.req.param("id") as string;

  try {
    await withdrawContact(applicantId, matchId);
    return c.json({ success: true });
  } catch (err: unknown) {
    return errorResponse(c, err);
  }
}

export async function outcome(c: ValidatedContext<{ json: OutcomeInput }>): Promise<Response> {
  const applicantId = c.get("applicantId") as string;
  const matchId     = c.req.param("id") as string;
  const { outcome: out, outcomeFeedback, continuation } = c.req.valid("json");

  try {
    await reportOutcome(
      applicantId,
      matchId,
      out,
      { feedback: outcomeFeedback, continuation },
      getRequestMeta(c),
    );
    return c.json({ success: true });
  } catch (err: unknown) {
    return errorResponse(c, err);
  }
}

export async function nudgeAck(c: ValidatedContext<{ json: NudgeAckInput }>): Promise<Response> {
  const applicantId = c.get("applicantId") as string;
  const matchId     = c.req.param("id") as string;
  const { openUp }  = c.req.valid("json");

  try {
    await acknowledgeDistanceNudge(applicantId, matchId, openUp);
    return c.json({ success: true });
  } catch (err: unknown) {
    return errorResponse(c, err);
  }
}

export async function logout(c: Context): Promise<Response> {
  deleteCookie(c, APPLICANT_COOKIE_NAME, { path: "/" });
  return c.json({ success: true });
}

export async function deactivate(c: Context): Promise<Response> {
  const applicantId = c.get("applicantId") as string;
  await deactivateMyAccount(applicantId);
  deleteCookie(c, APPLICANT_COOKIE_NAME, { path: "/" });
  return c.json({ success: true });
}

export async function matchSummary(c: Context): Promise<Response> {
  const applicantId = c.get("applicantId") as string;
  const matchId     = c.req.param("id") as string;

  try {
    const summary = await getOrGenerateMatchSummary(matchId, applicantId);
    if (!summary) return c.json({ success: false, error: "Not found" }, 404);
    return c.json({ success: true, data: summary });
  } catch (err: unknown) {
    return errorResponse(c, err);
  }
}

export async function cancelDeletion(c: Context): Promise<Response> {
  const applicantId = c.get("applicantId") as string;

  try {
    await cancelAccountDeletion(applicantId);
    return c.json({ success: true });
  } catch (err: unknown) {
    return errorResponse(c, err);
  }
}

export async function deleteNow(c: Context): Promise<Response> {
  const applicantId = c.get("applicantId") as string;

  try {
    await deleteMyAccountNow(applicantId, getRequestMeta(c));
    deleteCookie(c, APPLICANT_COOKIE_NAME, { path: "/" });
    return c.json({ success: true });
  } catch (err: unknown) {
    return errorResponse(c, err);
  }
}

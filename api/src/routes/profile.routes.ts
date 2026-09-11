import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { validationHook } from "../validators/validation-hook.js";
import {
  profileLoginSchema,
  setPasswordSchema,
  changePasswordSchema,
  matchQuerySchema,
  respondSchema,
  outcomeSchema,
  updateAnswersSchema,
  nudgeAckSchema,
} from "../validators/profile.validator.js";
import {
  login,
  setPassword,
  changePassword,
  suggestPassword,
  me,
  answers,
  updateAnswers,
  matches,
  contact,
  respond,
  withdraw,
  outcome,
  nudgeAck,
  matchSummary,
  deactivate,
  cancelDeletion,
  deleteNow,
  logout,
} from "../controllers/profile.controller.js";
import { requireApplicant } from "../middleware/applicant.auth.middleware.js";
import {
  profileLoginRateLimiter,
  profileRateLimiter,
} from "../middleware/rateLimit.middleware.js";

export const profileRoutes = new Hono();

// ── Public ─────────────────────────────────────────────────────────────────────

profileRoutes.post(
  "/login",
  profileLoginRateLimiter,
  zValidator("json", profileLoginSchema, validationHook),
  login
);

profileRoutes.post(
  "/set-password",
  profileLoginRateLimiter,
  zValidator("json", setPasswordSchema, validationHook),
  setPassword
);

profileRoutes.get("/suggest-password", suggestPassword);

// /logout is a one-shot cookie clear, like admin's — not a brute-force
// surface, so it's exempt from rate limiting and doesn't require a valid
// session (an already-expired session can still "log out" cleanly).
profileRoutes.post("/logout", logout);

// ── Protected ──────────────────────────────────────────────────────────────────

profileRoutes.use("*", profileRateLimiter);

profileRoutes.get("/me", requireApplicant, me);

profileRoutes.get("/answers", requireApplicant, answers);

profileRoutes.put(
  "/answers",
  requireApplicant,
  zValidator("json", updateAnswersSchema, validationHook),
  updateAnswers
);

profileRoutes.get(
  "/matches",
  requireApplicant,
  zValidator("query", matchQuerySchema, validationHook),
  matches
);

profileRoutes.post("/matches/:id/contact", requireApplicant, contact);

profileRoutes.post(
  "/matches/:id/respond",
  requireApplicant,
  zValidator("json", respondSchema, validationHook),
  respond
);

profileRoutes.post("/matches/:id/withdraw", requireApplicant, withdraw);

profileRoutes.get("/matches/:id/summary", requireApplicant, matchSummary);

profileRoutes.post(
  "/matches/:id/outcome",
  requireApplicant,
  zValidator("json", outcomeSchema, validationHook),
  outcome
);

profileRoutes.post(
  "/matches/:id/nudge-ack",
  requireApplicant,
  zValidator("json", nudgeAckSchema, validationHook),
  nudgeAck
);

profileRoutes.post(
  "/change-password",
  requireApplicant,
  zValidator("json", changePasswordSchema, validationHook),
  changePassword
);

profileRoutes.post("/deactivate", requireApplicant, deactivate);

profileRoutes.post("/cancel-deletion", requireApplicant, cancelDeletion);

profileRoutes.post("/delete-now", requireApplicant, deleteNow);

import { Context } from "hono";
import { processFormSubmission } from "../services/form.service.js";
import { getActiveQuestionnaire, getAllQuestionnaires } from "../services/questionnaire.service.js";
import { generateSubmissionKey } from "../privacy/submission-key.js";
import { errorResponse } from "../utils/error-response.js";
import { getClientIp } from "../utils/request-meta.js";
import type { ValidatedContext } from "../utils/validated-context.js";
import type { FormSubmissionInput } from "../validators/form.validator.js";

/**
 * GET /api/v1/form/questionnaire?filter=active (default) | all
 *
 * filter=active  → single active questionnaire + submissionKey (for form submission)
 * filter=all     → list of all questionnaires, newest first (no submissionKey — read-only)
 */
export async function getQuestionnaire(c: Context): Promise<Response> {
  const filter = c.req.query("filter") ?? "active";

  if (filter !== "active" && filter !== "all") {
    return c.json(
      { success: false, error: 'Invalid filter value. Use "active" or "all".' },
      400
    );
  }

  if (filter === "all") {
    const questionnaires = await getAllQuestionnaires();
    return c.json({
      success: true,
      data: questionnaires.map((q) => ({
        version: q.version,
        name: q.name,
        isActive: q.isActive,
        createdAt: q.createdAt,
        updatedAt: q.updatedAt,
      })),
    });
  }

  // filter=active (default)
  const questionnaire = await getActiveQuestionnaire();

  if (!questionnaire) {
    return c.json({ success: false, error: "No active questionnaire found" }, 404);
  }

  return c.json({
    success: true,
    data: {
      version: questionnaire.version,
      name: questionnaire.name,
      isActive: questionnaire.isActive,
      sections: questionnaire.sections,
      submissionKey: generateSubmissionKey(questionnaire.version),
    },
  });
}

/**
 * POST /api/v1/form/submit
 * Requires X-Submission-Key header — obtained from GET /questionnaire.
 */
export async function submitForm(c: ValidatedContext<{ json: FormSubmissionInput }>): Promise<Response> {
  const body = c.req.valid("json");
  const submissionKey = c.req.header("X-Submission-Key") ?? "";
  const ipAddress = getClientIp(c);

  try {
    const result = await processFormSubmission(body, submissionKey, ipAddress);

    return c.json(
      {
        success: true,
        alias:       result.alias,
        applicantId: result.applicantId,
        magicToken:  result.magicToken,
        message: "Your profile has been submitted successfully. Save your magic link — you will set your password on first login.",
      },
      201
    );
  } catch (err: unknown) {
    return errorResponse(c, err, "Submission failed", 400);
  }
}

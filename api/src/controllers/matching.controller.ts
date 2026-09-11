import { Context } from "hono";
import { getCandidates, runFullMatchingPass } from "../matching/engine.js";
import { generateCoupleProposals } from "../matching/proposals.js";
import { saveMatchProposals, loadActiveApplicants } from "../services/match.service.js";
import { promoteAppliedToMatched } from "../services/match-state.service.js";
import { getConfig, setConfig } from "../services/appConfig.service.js";
import { APP_CONFIG_KEYS, type MatchingLastRun } from "../models/appConfig.model.js";
import { errorResponse } from "../utils/error-response.js";
import type { ValidatedContext } from "../utils/validated-context.js";
import type { MatchingRunInput } from "../validators/admin.validator.js";

const ALGORITHM = "embedding-cosine";

/**
 * GET /api/v1/matching/candidates/:applicantId
 * Returns top N candidates scored against the given applicant.
 */
export async function getMatchCandidates(c: Context): Promise<Response> {
  const applicantId = c.req.param("applicantId") ?? "";
  const query = c.req.query();
  const topN = Math.min(50, Math.max(1, parseInt(query.top ?? "10", 10)));

  try {
    const candidates = await getCandidates(applicantId, topN);

    return c.json({
      success: true,
      applicantId,
      candidates,
    });
  } catch (err) {
    return errorResponse(c, err, "Failed to get candidates");
  }
}

/**
 * POST /api/v1/matching/run
 * Admin triggers a full matching pass.
 */
export async function runMatching(c: ValidatedContext<{ json: MatchingRunInput }>): Promise<Response> {
  try {
    const startTime = Date.now();
    const results = await runFullMatchingPass();
    const durationMs = Date.now() - startTime;

    const totalApplicants = Object.keys(results).length;

    let couplesProposed = 0;
    try {
      if (totalApplicants >= 2) {
        const applicants = await loadActiveApplicants();
        const proposals  = generateCoupleProposals(applicants, results);
        couplesProposed  = await saveMatchProposals(proposals, ALGORITHM);
        await promoteAppliedToMatched();
      }
    } catch (coupleErr) {
      console.error("[matching] Couple generation/save failed:", coupleErr);
    }

    try {
      const lastRun: MatchingLastRun = {
        at: new Date(),
        algorithm: ALGORITHM,
        totalApplicants,
        couplesProposed,
        durationMs,
        triggeredBy: "admin",
      };
      await setConfig(APP_CONFIG_KEYS.matchingLastRun, lastRun);
    } catch (configErr) {
      console.error("[matching] Failed to persist last-run info:", configErr);
    }

    return c.json({
      success: true,
      algorithm: ALGORITHM,
      totalApplicants,
      durationMs,
      couplesProposed,
      results,
    });
  } catch (err) {
    return errorResponse(c, err, "Matching failed");
  }
}

/**
 * GET /api/v1/matching/last-run
 * Returns the persisted summary of the most recent matching pass, or null.
 */
export async function getMatchingLastRun(c: Context): Promise<Response> {
  try {
    const lastRun = await getConfig<MatchingLastRun>(APP_CONFIG_KEYS.matchingLastRun);
    return c.json({ success: true, data: lastRun });
  } catch (err) {
    return errorResponse(c, err, "Failed to load last run");
  }
}

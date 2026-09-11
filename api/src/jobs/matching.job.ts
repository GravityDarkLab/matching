import {
  loadActiveApplicants,
  saveMatchProposals,
} from "../services/match.service.js";
import { promoteAppliedToMatched } from "../services/match-state.service.js";
import { runFullMatchingPass } from "../matching/engine.js";
import { generateCoupleProposals } from "../matching/proposals.js";
import { setConfig } from "../services/appConfig.service.js";
import { APP_CONFIG_KEYS, type MatchingLastRun } from "../models/appConfig.model.js";

/**
 * Full scheduled matching run:
 * 1. Load all eligible applicants (applied + matched)
 * 2. Run the embedding-cosine algorithm over all pairs
 * 3. Persist new couple proposals
 * 4. Transition any "applied" applicants who now have proposals to "matched"
 */
export async function runScheduledMatchingJob(): Promise<void> {
  const startedAt = Date.now();
  console.info("[matching-job] Starting scheduled matching run...");

  try {
    const applicants = await loadActiveApplicants();
    if (applicants.length < 2) {
      console.info("[matching-job] Fewer than 2 active applicants — skipping.");
      return;
    }

    const results  = await runFullMatchingPass();
    const proposals = generateCoupleProposals(applicants, results);
    const saved    = await saveMatchProposals(proposals, "embedding-cosine");

    console.info(`[matching-job] Saved ${saved} new proposals from ${proposals.length} candidates.`);

    // Transition applied applicants who now have portal-visible proposals
    const promoted = await promoteAppliedToMatched();
    if (promoted > 0) {
      console.info(`[matching-job] Promoted ${promoted} applicants: applied → matched.`);
    }

    const lastRun: MatchingLastRun = {
      at: new Date(),
      algorithm: "embedding-cosine",
      totalApplicants: applicants.length,
      couplesProposed: saved,
      durationMs: Date.now() - startedAt,
      triggeredBy: "scheduler",
    };
    await setConfig(APP_CONFIG_KEYS.matchingLastRun, lastRun);

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.info(`[matching-job] Done in ${elapsed}s.`);
  } catch (err) {
    console.error("[matching-job] Error during scheduled run:", err);
    // Never rethrow — the caller (setInterval) must not crash the process
  }
}

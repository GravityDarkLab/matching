/**
 * Embedding Service
 * ==================
 * Handles persisting and loading applicant embedding vectors.
 *
 * ## Lifecycle
 *
 *   1. Applicant submits form → embedApplicant() is called fire-and-forget.
 *      The submission returns immediately; embedding happens in the background.
 *
 *   2. Matching run starts → prepare() calls getOrComputeEmbeddings().
 *      - Applicants whose embeddings are already stored → loaded from DB (no API call).
 *      - Applicants with missing or stale embeddings → computed in a single batch
 *        request and saved to DB.
 *
 * ## Stale detection
 *
 *   Embeddings are stale when:
 *   - The configured EMBEDDING_MODEL has changed (different vector space).
 *   - CURRENT_TEXT_VERSION doesn't match the stored textVersion (text composition changed).
 *   In either case vectors are re-computed and overwritten automatically.
 *
 * ## Text composition (v2)
 *
 *   profile      = lifestyle + " — " + vibe_words + " — " + work
 *   preference   = preferred_character_traits + " — " + preferred_physical_traits
 *                  + " — " + dream_first_date
 *   dealBreakers = deal_breakers
 */

import { ObjectId } from "mongodb";
import { getDb } from "../db/connection.js";
import { getEmbeddingsCollection } from "../db/collections.js";
import { getEmbeddingProvider } from "../matching/embeddings/provider.js";
import type { EmbeddingDoc } from "../models/embedding.model.js";

/** Bump this whenever the set of fields fed into any embedding text changes. */
const CURRENT_TEXT_VERSION = 2;

// ─── Text field extraction ────────────────────────────────────────────────────

function str(answers: Record<string, unknown>, key: string): string {
  const v = answers[key];
  return typeof v === "string" ? v.trim() : "";
}

export function buildTexts(answers: Record<string, unknown>): {
  profile: string;
  preference: string;
  dealBreakers: string;
} {
  return {
    profile: [
      str(answers, "lifestyle"),
      str(answers, "vibe_words"),
      str(answers, "work"),
    ]
      .filter(Boolean)
      .join(" — "),
    preference: [
      str(answers, "preferred_character_traits"),
      str(answers, "preferred_physical_traits"),
      str(answers, "dream_first_date"),
    ]
      .filter(Boolean)
      .join(" — "),
    dealBreakers: str(answers, "deal_breakers"),
  };
}

// ─── Persist ──────────────────────────────────────────────────────────────────

async function saveEmbedding(
  applicantId: ObjectId,
  provider: string,
  model: string,
  vectors: { profile: number[]; preference: number[]; dealBreakers: number[] }
): Promise<void> {
  const db = await getDb();
  const col = getEmbeddingsCollection(db);

  await col.updateOne(
    { applicantId },
    {
      $set: {
        applicantId,
        provider,
        model,
        textVersion: CURRENT_TEXT_VERSION,
        profile: vectors.profile,
        preference: vectors.preference,
        dealBreakers: vectors.dealBreakers,
        createdAt: new Date(),
      },
    },
    { upsert: true }
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Computes and persists embeddings for a single applicant.
 * Called fire-and-forget from form.service after submission — never throws
 * to the caller.
 */
export async function embedApplicant(
  applicantId: ObjectId,
  answers: Record<string, unknown>
): Promise<void> {
  const provider = getEmbeddingProvider();
  const texts = buildTexts(answers);

  const [profile, preference, dealBreakers] = await provider.embedBatch([
    texts.profile,
    texts.preference,
    texts.dealBreakers,
  ]);

  await saveEmbedding(applicantId, provider.name, provider.model, {
    profile,
    preference,
    dealBreakers,
  });
}

/**
 * Loads stored embeddings for the given applicants.
 * Computes and saves any that are missing or stale (different model or text version).
 * Returns a map of applicantId hex → EmbeddingDoc.
 *
 * Used by the scorer's prepare() step.
 */
export async function getOrComputeEmbeddings(
  applicants: { _id: ObjectId; answers: Record<string, unknown> }[]
): Promise<Map<string, EmbeddingDoc>> {
  if (applicants.length === 0) return new Map();

  const provider = getEmbeddingProvider();
  const db = await getDb();
  const col = getEmbeddingsCollection(db);

  const ids = applicants.map((a) => a._id);
  const stored = await col.find({ applicantId: { $in: ids } }).toArray();

  const storedByApplicant = new Map(
    stored.map((d) => [d.applicantId.toHexString(), d])
  );

  const stale = applicants.filter((a) => {
    const existing = storedByApplicant.get(a._id.toHexString());
    return (
      !existing ||
      existing.model !== provider.model ||
      (existing.textVersion ?? 1) !== CURRENT_TEXT_VERSION
    );
  });

  if (stale.length > 0) {
    console.log(
      `[embedding] Computing ${stale.length} missing/stale embeddings ` +
      `(model: ${provider.model}, textVersion: ${CURRENT_TEXT_VERSION})...`
    );

    // Never let one bad applicant's text (a provider rate limit, content-
    // policy rejection, or timeout) abort matching for every applicant in
    // this batch — including the majority whose embeddings were already
    // cached and didn't need this call at all. Failed applicants stay marked
    // stale in the DB, so the next matching run retries them automatically.
    try {
      const staleTexts = stale.map((a) => buildTexts(a.answers));
      const profileTexts     = staleTexts.map((t) => t.profile);
      const preferenceTexts  = staleTexts.map((t) => t.preference);
      const dealBreakerTexts = staleTexts.map((t) => t.dealBreakers);

      const [profileEmbs, preferenceEmbs, dealBreakerEmbs] = await Promise.all([
        provider.embedBatch(profileTexts),
        provider.embedBatch(preferenceTexts),
        provider.embedBatch(dealBreakerTexts),
      ]);

      let failedSaves = 0;
      await Promise.all(
        stale.map(async (applicant, i) => {
          const doc: EmbeddingDoc = {
            _id: new ObjectId(),
            applicantId: applicant._id,
            provider: provider.name,
            model: provider.model,
            textVersion: CURRENT_TEXT_VERSION,
            profile:      profileEmbs[i],
            preference:   preferenceEmbs[i],
            dealBreakers: dealBreakerEmbs[i],
            createdAt: new Date(),
          };
          // Use the fresh vectors for this run even if persisting them
          // fails — keeping the old ones could mix two models' vector spaces.
          storedByApplicant.set(applicant._id.toHexString(), doc);

          try {
            await saveEmbedding(applicant._id, provider.name, provider.model, doc);
          } catch (err) {
            failedSaves++;
            console.error(
              `[embedding] Failed to persist embedding for applicant ${applicant._id.toHexString()} ` +
              `(used for this run, recomputed next run):`,
              err
            );
          }
        })
      );

      console.log(
        `[embedding] Done. ${stale.length - failedSaves}/${stale.length} embeddings saved` +
        (failedSaves > 0 ? ` (${failedSaves} failed to persist, will recompute next run).` : ".")
      );
    } catch (err) {
      // An outdated embedding from a different model lives in a different
      // vector space (often a different length) — scoring it against
      // current-model vectors yields meaningless numbers, so drop it. One
      // that's only outdated on textVersion is the same space: reuse it for
      // this round rather than losing that applicant entirely.
      let dropped = 0;
      for (const applicant of stale) {
        const existing = storedByApplicant.get(applicant._id.toHexString());
        if (existing && existing.model !== provider.model) {
          storedByApplicant.delete(applicant._id.toHexString());
          dropped++;
        }
      }
      console.error(
        `[embedding] Failed to compute ${stale.length} missing/stale embeddings — ` +
        `skipping them this round (${dropped} outdated-model embeddings excluded; ` +
        `retried next run):`,
        err
      );
    }
  }

  return storedByApplicant;
}

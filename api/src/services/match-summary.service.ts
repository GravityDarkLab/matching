import { ObjectId } from "mongodb";
import { getDb } from "../db/connection.js";
import { getMatchesCollection, getApplicantsCollection } from "../db/collections.js";
import { generateChatCompletion, UNTRUSTED_PROFILE_NOTICE } from "./ai.service.js";
import { buildProfileSnippet } from "./profile-snippet.util.js";
import { buildSummaryResult } from "./match-summary-result.util.js";
import { env } from "../config/env.js";
import type { MatchSummary } from "../models/match.model.js";
import type { ApplicantDoc } from "../models/applicant.model.js";

const SUMMARY_MODEL = env.openaiChatModel;

export async function getOrGenerateMatchSummary(
  matchId: string,
  applicantId: string,
): Promise<MatchSummary | null> {
  let matchOid: ObjectId;
  let applicantOid: ObjectId;
  try {
    matchOid = new ObjectId(matchId);
    applicantOid = new ObjectId(applicantId);
  } catch {
    return null;
  }

  const db = await getDb();
  const matchCol = getMatchesCollection(db);
  const match = await matchCol.findOne({ _id: matchOid });
  if (!match) return null;

  // Only participants may request the summary
  if (!match.applicantAId.equals(applicantOid) && !match.applicantBId.equals(applicantOid)) {
    return null;
  }

  // Cache hit — provider+model unchanged
  if (match.summary && match.summary.model === SUMMARY_MODEL) {
    return match.summary;
  }

  // Fetch both profiles
  const applicantsCol = getApplicantsCollection(db);
  const [a, b] = await Promise.all([
    applicantsCol.findOne({ _id: match.applicantAId }),
    applicantsCol.findOne({ _id: match.applicantBId }),
  ]);
  if (!a || !b) return null;

  const prompt = `You are a professional matchmaker writing a compatibility note for two people who have been matched. ${UNTRUSTED_PROFILE_NOTICE}

Person A: <profile>${buildProfileSnippet(a)}</profile>

Person B: <profile>${buildProfileSnippet(b)}</profile>

Write a brief, professional, and warm compatibility note grounded only in what's stated above — do not invent details — with:
- 2 to 3 "Strengths": genuine points of alignment (one sentence each, max 18 words)
- 1 to 2 "To keep in mind": honest but constructive points where they differ (one sentence each, max 18 words)

Respond in this exact JSON format (no markdown, no extra text):
{"pros":["strength 1","strength 2"],"cons":["note 1"]}`;

  const raw = await generateChatCompletion(prompt, {
    maxTokens: 1500, // headroom for reasoning-model chain-of-thought before the short final answer
    reasoningEffort: "low", // minimize chain-of-thought spend on models that support it
    responseSchema: {
      name: "match_summary",
      schema: {
        type: "object",
        properties: {
          pros: { type: "array", items: { type: "string" } },
          cons: { type: "array", items: { type: "string" } },
        },
        required: ["pros", "cons"],
        additionalProperties: false,
      },
    },
  });
  const summary: MatchSummary = buildSummaryResult(raw, SUMMARY_MODEL);

  await matchCol.updateOne(
    { _id: matchOid },
    { $set: { summary, updatedAt: new Date() } },
  );

  return summary;
}

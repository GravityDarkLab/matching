import type { ApplicantDoc } from "../models/applicant.model.js";
import { generateChatCompletion, truncateForPrompt, UNTRUSTED_PROFILE_NOTICE } from "./ai.service.js";

const FALLBACK_QUESTIONS = [
  "What's your favourite way to spend a weekend?",
  "If you could travel anywhere tomorrow, where would you go?",
  "What's something you're passionate about that most people don't know?",
  "What does your ideal first date look like?",
  "What's a small thing that always makes your day better?",
];

const FALLBACK_DATE_IDEAS = [
  "Coffee walk in a neighbourhood you've never explored",
  "Visit a local market or street-food spot",
  "Catch a live music set at a cosy venue",
];

export interface IceBreakerResult {
  questions: string[];
  dateIdeas: string[];
}

function profileSnippet(doc: ApplicantDoc): string {
  const a = doc.answers as Record<string, unknown>;
  const t = (v: unknown) => truncateForPrompt(String(v));
  const parts: string[] = [];
  if (a.vibe_words)       parts.push(`Vibes: ${t(a.vibe_words)}`);
  if (a.lifestyle)        parts.push(`Lifestyle: ${t(a.lifestyle)}`);
  if (a.dream_first_date) parts.push(`Dream first date: ${t(a.dream_first_date)}`);
  if (a.location)         parts.push(`Location: ${t(a.location)}`);
  return parts.join(". ") || "No profile details available.";
}

export async function generateIceBreakers(
  a: ApplicantDoc,
  b: ApplicantDoc
): Promise<IceBreakerResult> {
  const prompt = `You are a thoughtful matchmaker. Two people have been matched based on compatibility. ${UNTRUSTED_PROFILE_NOTICE}

Person A: <profile>${profileSnippet(a)}</profile>
Person B: <profile>${profileSnippet(b)}</profile>

Generate exactly 5 creative, personal ice-breaking questions (each under 15 words) that Person A can ask Person B via Instagram to start a meaningful conversation. Then generate exactly 3 specific date ideas (each under 12 words) that would suit both of them.

Respond in this exact JSON format (no markdown, no extra text):
{"questions":["q1","q2","q3","q4","q5"],"dateIdeas":["d1","d2","d3"]}`;

  const raw = await generateChatCompletion(prompt, {
    maxTokens: 1500, // headroom for reasoning-model chain-of-thought before the short final answer
    reasoningEffort: "low", // minimize chain-of-thought spend on models that support it
    responseSchema: {
      name: "ice_breakers",
      schema: {
        type: "object",
        properties: {
          questions: { type: "array", items: { type: "string" } },
          dateIdeas: { type: "array", items: { type: "string" } },
        },
        required: ["questions", "dateIdeas"],
        additionalProperties: false,
      },
    },
  });

  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { questions?: unknown; dateIdeas?: unknown };
      const cleanStrings = (arr: unknown): string[] =>
        Array.isArray(arr) ? arr.filter((v): v is string => typeof v === "string" && v.trim().length > 0) : [];
      const cleanQuestions = cleanStrings(parsed.questions);
      const cleanDateIdeas = cleanStrings(parsed.dateIdeas);
      const questions = cleanQuestions.length >= 3 ? cleanQuestions.slice(0, 5) : FALLBACK_QUESTIONS;
      const dateIdeas = cleanDateIdeas.length >= 1 ? cleanDateIdeas.slice(0, 3) : FALLBACK_DATE_IDEAS;
      return { questions, dateIdeas };
    } catch {
      // fall through to defaults
    }
  }

  return { questions: FALLBACK_QUESTIONS, dateIdeas: FALLBACK_DATE_IDEAS };
}

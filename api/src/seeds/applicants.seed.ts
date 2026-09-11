#!/usr/bin/env bun
/**
 * Populates the database with realistic fake applicants for dev/test.
 *
 * Usage (from repo root):
 *   bun run seed:applicants          → dev  (default)
 *   bun run seed:applicants:test     → test
 *
 * Safety: refuses to run against NODE_ENV=production.
 *
 * Options:
 *   --count=<n>   number of applicants to insert (default: 50)
 *   --clear       wipe existing applicants + identities before seeding
 */

import { ObjectId } from "mongodb";
import { getDb, closeDb } from "../db/connection.js";
import {
  getApplicantsCollection,
  getIdentitiesCollection,
  getMatchesCollection,
} from "../db/collections.js";
import { generateUniqueAlias } from "../privacy/alias.generator.js";
import { encrypt } from "../privacy/encryption.js";
import { hashInstagram, normalizeInstagram } from "../privacy/hash.js";
import { hashMagicToken } from "../privacy/magic-token.js";
import { env } from "../config/env.js";

// ─── Safety guard ─────────────────────────────────────────────────────────────

if (env.nodeEnv === "production") {
  console.error("[SEED:applicants] ❌  Refusing to run in production.");
  process.exit(1);
}

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const countArg = args.find((a) => a.startsWith("--count="));
const COUNT = countArg ? parseInt(countArg.split("=")[1], 10) : 50;
const CLEAR = args.includes("--clear");

// ─── Data pools ───────────────────────────────────────────────────────────────
const QUESTIONNAIRE_VERSION = "1.2.0";

const LOCATIONS = [
  "Paris, France",
  "London, UK",
  "New York, USA",
  "Dubai, UAE",
  "München, Germany",
  "Barcelona, Spain",
  "Dresden, Germany",
  "Casablanca, Morocco",
  "Tunis, Tunisia",
  "Montreal, Canada",
  "Lyon, France",
  "Berlin, Germany",
  "Madrid, Spain",
  "Amsterdam, Netherlands",
  "Brussels, Belgium",
  "Toronto, Canada",
  "Rabat, Morocco",
  "Bizerte, Tunisia",
  "Nabeul, Tunisia",
  "Djerba, Tunisia",
  "Marseille, France",
  "Algiers, Algeria",
  "Beirut, Lebanon",
  "Istanbul, Turkey",
  "Stockholm, Sweden",
  "Geneva, Switzerland",
  "Milan, Italy",
];

const JOBS = [
  "Software Engineer",
  "Product Manager",
  "UX Designer",
  "Data Scientist",
  "Marketing Manager",
  "Teacher",
  "Doctor",
  "Lawyer",
  "Architect",
  "Pharmacist",
  "Journalist",
  "Financial Analyst",
  "Graphic Designer",
  "Nurse",
  "Entrepreneur",
  "Consultant",
  "Photographer",
  "Chef",
  "Civil Engineer",
  "HR Manager",
  "Dentist",
  "Content Creator",
  "Project Manager",
  "Researcher",
  "Psychologist",
];

const GENDERS = ["Male", "Female", "Non-binary"] as const;
const ORIENTATIONS = [
  "Straight",
  "Gay",
  "Lesbian",
  "Bisexual",
  "Pansexual",
  "Prefer not to say",
] as const;

const RELIGIONS = [
  "Muslim",
  "Christian",
  "Jewish",
  "Agnostic",
  "Atheist",
  "Spiritual but not religious",
  "Buddhist",
  "Hindu",
  "Prefer not to say",
];

const VIBE_POOLS = [
  "curious, calm, funny",
  "ambitious, warm, creative",
  "laid-back, loyal, adventurous",
  "nerdy, kind, sarcastic",
  "energetic, spontaneous, caring",
  "introverted, deep, artistic",
  "playful, honest, driven",
  "chill, thoughtful, goofy",
  "passionate, empathetic, focused",
  "bold, witty, grounded",
  "quiet, intellectual, gentle",
  "outgoing, optimistic, driven",
  "romantic, principled, funny",
  "curious, independent, warm",
  "ambitious, sincere, sporty",
];

const LIFESTYLES = [
  "Non-smoker, social drinker, gym 4x a week",
  "Non-smoker, rarely drinks, loves hiking",
  "Social smoker, wine lover, foodie",
  "Non-smoker, teetotal, early riser",
  "Vegan, non-smoker, yoga daily",
  "Non-smoker, coffee addict, night owl",
  "Occasional smoker, craft beer fan",
  "Non-smoker, runs marathons, meal preps",
  "Non-smoker, drinks socially, loves travel",
  "Non-smoker, fitness obsessed, clean eater",
  "Social drinker, non-smoker, bookworm",
  "Non-smoker, tea drinker, calm homebody",
];

const REL_TYPES = [
  "Long Term",
  "Long Term",
  "Long Term",
  "Open to Both",
  "Open to Both",
  "Short Term",
  "Not Sure",
] as const;

const PHYSICAL_TRAITS = [
  "Tall, athletic build",
  "Petite, feminine",
  "Average height, fit",
  "Curvy, confident",
  "Tall, slim",
  "Doesn't matter much, chemistry first",
  "Sporty, active",
  "Well-groomed, put-together",
  "Natural, minimal makeup",
  "Tall, dark features",
];

const CHARACTER_TRAITS = [
  "Ambitious, kind, has a sense of humour",
  "Emotionally intelligent, loyal, curious",
  "Driven but knows how to switch off, funny",
  "Kind-hearted, honest, family-oriented",
  "Independent, confident, caring",
  "Intellectual, calm, has strong values",
  "Adventurous, spontaneous, affectionate",
  "Patient, warm, goal-oriented",
  "Creative, open-minded, reliable",
  "Mature, respectful, playful",
];

const DEAL_BREAKERS = [
  "Dishonesty, arrogance",
  "Smoking, excessive drinking",
  "Lack of ambition, disrespect",
  "Bad communication, jealousy",
  "No sense of humour, rudeness",
  "Dishonesty, instability",
  "Smoking, negativity",
  "Laziness, lack of respect for family",
  "No goals, poor hygiene",
  "Controlling behaviour, dishonesty",
];

const FIRST_DATES = [
  "Coffee at a nice café, then a walk somewhere scenic",
  "Rooftop bar with good music and easy conversation",
  "Museum visit followed by dinner",
  "Farmers market in the morning, brunch after",
  "Bookshop browse then coffee and deep conversation",
  "Walk in a park, grab food from a market",
  "Cooking a meal together at home",
  "Art gallery then cocktails nearby",
  "Beach walk at sunset, nothing fancy",
  "Board game café, lots of laughing",
  "Street food tour of the city",
  "Hiking trail with a picnic at the top",
];

const INSTAGRAM_PREFIXES = [
  "its", "the", "just", "hey", "hi", "iam", "im", "real", "official",
  "only", "not", "", "", "", "",
];

const FIRST_NAMES = [
  "adam", "sami", "lina", "rania", "karim", "nour", "omar", "sarah",
  "ali", "leila", "youssef", "amira", "ines", "mehdi", "yasmine",
  "emma", "lucas", "sofia", "james", "mia", "noah", "chloe", "leo",
  "julia", "max", "anna", "tom", "nina", "alex", "zara",
];

const LAST_NAMES = [
  "Ben Ali", "Trabelsi", "Haddad", "Khelifi", "Mansour", "Saidi",
  "Martin", "Bernard", "Dubois", "Schmidt", "Weber", "Fischer",
  "Smith", "Johnson", "Garcia", "Lopez", "Hernandez", "Khan",
];

function capitalize(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function randomFloat(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 0x100000000;
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(randomFloat() * arr.length)];
}

function pickBool(trueChance = 0.5): boolean {
  return randomFloat() < trueChance;
}

function randInt(min: number, max: number): number {
  return Math.floor(randomFloat() * (max - min + 1)) + min;
}

/** YYYY-MM-DD for someone between minAge and maxAge years old today. */
function randomBirthDate(minAge: number, maxAge: number): string {
  const age = randInt(minAge, maxAge);
  const today = new Date();
  const year = today.getUTCFullYear() - age;
  const month = randInt(1, 12);
  const day = randInt(1, 28); // stay safe for February
  // Keep the birthday in the past so the age holds today
  const candidate = new Date(Date.UTC(year, month - 1, day));
  const cutoff = new Date(Date.UTC(today.getUTCFullYear() - age, today.getUTCMonth(), today.getUTCDate()));
  const finalDate = candidate > cutoff ? new Date(Date.UTC(year - 1, month - 1, day)) : candidate;
  return finalDate.toISOString().slice(0, 10);
}

function fakeInstagram(): string {
  const prefix = pick(INSTAGRAM_PREFIXES);
  const name = pick(FIRST_NAMES);
  const suffix = pickBool(0.4) ? String(randInt(10, 99)) : "";
  return `@${prefix}${name}${suffix}`.replace("@@", "@");
}

function randomCreatedAt(): Date {
  const msAgo = randomFloat() * 90 * 24 * 60 * 60 * 1000;
  return new Date(Date.now() - msAgo);
}

type SeedApplicantStatus = "applied" | "matched" | "dating" | "inactive";

// ─── Main ─────────────────────────────────────────────────────────────────────

// All seeded accounts share one login credential for easy local testing.
// Override with SEED_LOGIN env var; default is intentionally trivial (dev only).
const seedLogin = process.env.SEED_LOGIN ?? "ons-dev-seed";

async function seed() {
  console.log(`[SEED:applicants] Environment : ${env.nodeEnv}`);
  console.log(`[SEED:applicants] Target count : ${COUNT}`);
  console.log(`[SEED:applicants] Clear first  : ${CLEAR}\n`);

  const db = await getDb();
  const applicants = getApplicantsCollection(db);
  const identities = getIdentitiesCollection(db);
  const matches    = getMatchesCollection(db);

  // Hash once; reused for every inserted applicant
  const devPasswordHash = await Bun.password.hash(seedLogin);

  if (CLEAR) {
    const { deletedCount: a } = await applicants.deleteMany({});
    const { deletedCount: i } = await identities.deleteMany({});
    const { deletedCount: m } = await matches.deleteMany({});
    console.log(`[SEED:applicants] Cleared ${a} applicants, ${i} identities, ${m} matches.\n`);
  }

  const existingAliases = await applicants
    .find({}, { projection: { alias: 1 } })
    .map((d) => d.alias)
    .toArray();

  // Track used instagram hashes to avoid duplicate key errors within this seed run
  const usedHashes = new Set<string>();

  let inserted = 0;
  let skipped = 0;

  for (let i = 0; i < COUNT; i++) {
    const alias = generateUniqueAlias(existingAliases);
    existingAliases.push(alias);

    const gender = pick(GENDERS);
    const createdAt = randomCreatedAt();

    // Generate a unique-enough handle for seed data
    let handle: string;
    let instagramHash: string;
    let attempts = 0;
    do {
      handle = fakeInstagram() + (attempts > 0 ? String(randInt(100, 999)) : "");
      instagramHash = hashInstagram(handle);
      attempts++;
    } while (usedHashes.has(instagramHash) && attempts < 20);
    usedHashes.add(instagramHash);

    const fullName = `${capitalize(pick(FIRST_NAMES))} ${pick(LAST_NAMES)}`;

    const answers: Record<string, unknown> = {
      location: pick(LOCATIONS),
      birth_date: randomBirthDate(21, 38),
      height_cm: gender === "Male" ? randInt(170, 192) : gender === "Female" ? randInt(158, 178) : randInt(160, 185),
      work: pick(JOBS),
      gender_identity: gender,
      sexual_orientation: pick(ORIENTATIONS),
      religion: pick(RELIGIONS),
      vibe_words: pick(VIBE_POOLS),
      lifestyle: pick(LIFESTYLES),
      relationship_type: pick(REL_TYPES),
      open_to_long_distance: pickBool(0.45),
      // Age preferences — ~30% of applicants have no preference (null = any age)
      max_age_gap: pickBool(0.7) ? randInt(2, 12) : null,
      open_to_older: pickBool(0.7) ? pickBool(0.75) : null,
      open_to_younger: pickBool(0.7) ? pickBool(0.75) : null,
      preferred_physical_traits: pick(PHYSICAL_TRAITS),
      preferred_character_traits: pick(CHARACTER_TRAITS),
      deal_breakers: pick(DEAL_BREAKERS),
      okay_with_opposite_gender_friends: pickBool(0.72),
      religion_deal_breaker: pickBool(0.3),
      physical_affection_importance: randInt(5, 10),
      dream_first_date: pick(FIRST_DATES),
      disclaimer_agreed: true,
    };

    const applicantId = new ObjectId();

    try {
      const rawToken = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
      const status = "applied" as SeedApplicantStatus;
      await applicants.insertOne({
        _id: applicantId,
        alias,
        questionnaireVersion: QUESTIONNAIRE_VERSION,
        answers,
        status,
        magicToken: hashMagicToken(rawToken),
        passwordHash: devPasswordHash,
        scoreThreshold: 0.8,
        createdAt,
        updatedAt: createdAt,
      });

      const { encrypted, iv, tag } = encrypt(normalizeInstagram(handle));
      // Fresh IV for the name ciphertext too — never reuse the handle's.
      const { encrypted: encName, iv: ivName, tag: tagName } = encrypt(fullName);
      await identities.insertOne({
        _id: new ObjectId(),
        applicantId,
        alias,
        encryptedInstagram: encrypted,
        encryptionIv: iv,
        encryptionTag: tag,
        instagramHash,
        encryptedFullName: encName,
        fullNameIv: ivName,
        fullNameTag: tagName,
        createdAt,
      });

      inserted++;
      console.log(`[SEED:applicants] ${inserted}/${COUNT}  alias: ${alias}  status: ${status}  token: ${rawToken}`);
    } catch (err: unknown) {
      if (
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        (err as { code: number }).code === 11000
      ) {
        skipped++;
      } else {
        throw err;
      }
    }
  }

  console.log(`\n[SEED:applicants] ✅  Done — ${inserted} inserted, ${skipped} skipped.`);
  console.log(`[SEED:applicants] Login credential for all accounts: "${seedLogin}"`);
  await closeDb();
}

seed().catch((err) => {
  console.error("\n[SEED:applicants] Fatal error:", err);
  process.exit(1);
});

/**
 * Seeds the questionnaire into MongoDB.
 * Run with: bun run src/seeds/questionnaire.seed.ts
 *
 * Options:
 *   --clean   drop all existing questionnaires before seeding (full reset)
 *
 * This script is idempotent without --clean — it upserts by version.
 */

import { ObjectId } from "mongodb";
import { getDb, closeDb } from "../db/connection.js";
import { getQuestionnairesCollection } from "../db/collections.js";
import type { QuestionnaireDoc } from "../models/questionnaire.model.js";

const CLEAN = process.argv.includes("--clean");

const questionnaire: Omit<QuestionnaireDoc, "_id" | "createdAt" | "updatedAt"> = {
  version: "1.2.0",
  name: "Matching Form v1",
  isActive: true,
  sections: [
    {
      id: "identity",
      title: "Your Identity",
      order: 1,
      questions: [
        {
          id: "first_name",
          label: "First name",
          type: "text",
          sensitive: true,
          required: true,
          order: 1,
          placeholder: "Your first name",
        },
        {
          id: "last_name",
          label: "Last name",
          type: "text",
          sensitive: true,
          required: true,
          order: 2,
          placeholder: "Your last name",
        },
        {
          id: "instagram_handle",
          label: "Instagram Handle",
          type: "text",
          sensitive: true,
          required: true,
          order: 3,
          placeholder: "@yourhandle",
        },
      ],
    },
    {
      id: "basics",
      title: "The Basics",
      order: 2,
      questions: [
        {
          id: "location",
          label: "Where are you based?",
          type: "text",
          sensitive: false,
          required: true,
          order: 1,
          placeholder: "City, Country",
        },
        {
          id: "birth_date",
          label: "Birth date",
          type: "date",
          sensitive: false,
          required: true,
          order: 2,
        },
        {
          id: "height_cm",
          label: "Height (cm)",
          type: "number",
          sensitive: false,
          required: false,
          order: 3,
          min: 100,
          max: 250,
        },
        {
          id: "work",
          label: "What do you do for work?",
          type: "text",
          sensitive: false,
          required: true,
          order: 4,
          placeholder: "e.g. Software Engineer, Teacher",
        },
        {
          id: "gender_identity",
          label: "Gender Identity",
          type: "select",
          sensitive: false,
          required: true,
          order: 5,
          options: [
            "Male",
            "Female",
            "Non-binary",
            "Genderqueer",
            "Prefer not to say",
            "Other",
          ],
        },
        {
          id: "sexual_orientation",
          label: "Sexual Orientation",
          type: "select",
          sensitive: false,
          required: true,
          order: 6,
          options: [
            "Straight",
            "Gay",
            "Lesbian",
            "Bisexual",
            "Pansexual",
            "Asexual",
            "Prefer not to say",
            "Other",
          ],
        },
        {
          id: "religion",
          label: "Religion / Spirituality",
          type: "text",
          sensitive: false,
          required: true,
          order: 7,
          placeholder: "e.g. Muslim, Christian, Agnostic, Atheist",
        },
      ],
    },
    {
      id: "about_you",
      title: "About You",
      order: 3,
      questions: [
        {
          id: "vibe_words",
          label: "Describe your vibe in 3 words",
          type: "text",
          sensitive: false,
          required: true,
          order: 1,
          placeholder: "e.g. curious, calm, funny",
        },
        {
          id: "lifestyle",
          label: "Describe your lifestyle",
          type: "text",
          sensitive: false,
          required: true,
          order: 2,
          placeholder: "e.g. Social drinker, non-smoker",
        },
      ],
    },
    {
      id: "relationship_preferences",
      title: "Relationship Preferences",
      order: 4,
      questions: [
        {
          id: "relationship_type",
          label: "What type of relationship are you looking for?",
          type: "select",
          sensitive: false,
          required: true,
          order: 1,
          options: ["Long Term", "Short Term", "Open to Both", "Casual", "Not Sure"],
        },
        {
          id: "open_to_long_distance",
          label: "Are you open to long distance?",
          type: "boolean",
          sensitive: false,
          required: true,
          order: 2,
        },
        {
          id: "max_age_gap",
          label: "Maximum age gap you're comfortable with (years)",
          type: "number",
          sensitive: false,
          required: false,
          order: 3,
          min: 0,
          max: 40,
          placeholder: "Leave blank for no preference",
        },
        {
          id: "open_to_older",
          label: "Open to someone older than you?",
          type: "boolean",
          sensitive: false,
          required: false,
          order: 4,
        },
        {
          id: "open_to_younger",
          label: "Open to someone younger than you?",
          type: "boolean",
          sensitive: false,
          required: false,
          order: 5,
        },
        {
          id: "preferred_physical_traits",
          label: "Preferred physical traits in a partner",
          type: "textarea",
          sensitive: false,
          required: true,
          order: 6,
          placeholder: "e.g. Athletic, tall",
        },
        {
          id: "preferred_character_traits",
          label: "Preferred character traits in a partner",
          type: "textarea",
          sensitive: false,
          required: true,
          order: 7,
          placeholder: "e.g. Ambitious, kind, funny",
        },
        {
          id: "deal_breakers",
          label: "Deal breakers",
          type: "textarea",
          sensitive: false,
          required: true,
          order: 8,
          placeholder: "e.g. Dishonesty, smoking",
        },
        {
          id: "okay_with_opposite_gender_friends",
          label: "Okay with partner having friends of opposite gender?",
          type: "boolean",
          sensitive: false,
          required: true,
          order: 9,
        },
        {
          id: "religion_deal_breaker",
          label: "Is different religion a deal breaker?",
          type: "boolean",
          sensitive: false,
          required: true,
          order: 10,
        },
        {
          id: "physical_affection_importance",
          label: "How important is physical affection to you? (1–10)",
          type: "range",
          sensitive: false,
          required: true,
          order: 11,
          min: 1,
          max: 10,
        },
        {
          id: "dream_first_date",
          label: "Describe your dream first date",
          type: "textarea",
          sensitive: false,
          required: true,
          order: 12,
          placeholder: "e.g. Coffee at a bookstore, then a walk by the river",
        },
      ],
    },
    {
      id: "disclaimer",
      title: "Disclaimer",
      order: 5,
      questions: [
        {
          id: "disclaimer_agreed",
          label:
            "I agree that my data will be used solely for the purpose of this matching exercise and will be handled with care.",
          type: "boolean",
          sensitive: false,
          required: true,
          order: 1,
        },
      ],
    },
  ],
};

async function seed() {
  console.log("[SEED] Starting questionnaire seed...");
  console.log(`[SEED] Clean mode: ${CLEAN}`);

  const db = await getDb();
  const col = getQuestionnairesCollection(db);

  if (CLEAN) {
    const { deletedCount } = await col.deleteMany({});
    console.log(`[SEED] Deleted ${deletedCount} existing questionnaire(s).`);
  } else {
    // Deactivate all existing questionnaires before inserting the new one
    await col.updateMany({}, { $set: { isActive: false, updatedAt: new Date() } });
  }

  const result = await col.updateOne(
    { version: questionnaire.version },
    {
      $set: {
        ...questionnaire,
        updatedAt: new Date(),
      },
      $setOnInsert: {
        _id: new ObjectId(),
        createdAt: new Date(),
      },
    },
    { upsert: true }
  );

  if (result.upsertedCount > 0) {
    console.log(
      `[SEED] Created questionnaire v${questionnaire.version} (id: ${result.upsertedId})`
    );
  } else {
    console.log(
      `[SEED] Updated questionnaire v${questionnaire.version}`
    );
  }

  console.log("[SEED] Done.");
  await closeDb();
}

seed().catch((err) => {
  console.error("[SEED] Fatal error:", err);
  process.exit(1);
});

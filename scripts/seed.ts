#!/usr/bin/env bun
/**
 * Interactive seed runner.
 *
 * Usage:
 *   bun run seed                                   → interactive prompt
 *   bun run seed questionnaire                     → seed questionnaire (dev)
 *   bun run seed applicants                        → seed applicants    (dev)
 *   bun run seed admin                             → create / update an admin account
 *   bun run seed both                              → seed questionnaire + applicants (dev)
 *   bun run seed applicants --env=test             → use api/.env.test
 *   bun run seed applicants --env=dev --count=100 --clear
 *   bun run seed both --clean                      → wipe ALL data (questionnaires + applicants + matches) then re-seed
 */

import * as readline from "readline";

// ─── Constants ────────────────────────────────────────────────────────────────

const TARGETS  = ["questionnaire", "applicants", "admin", "both"] as const;
const ENVS     = ["dev", "test", "prod"]                          as const;

type Target = (typeof TARGETS)[number];
type Env    = (typeof ENVS)[number];

const SEED_SCRIPTS: Record<Exclude<Target, "both">, string> = {
  questionnaire: "src/seeds/questionnaire.seed.ts",
  applicants:    "src/seeds/applicants.seed.ts",
  admin:         "src/seeds/admin.seed.ts",
};

const API_DIR = new URL("../api", import.meta.url).pathname;

// ─── Arg parsing ──────────────────────────────────────────────────────────────

const rawArgs  = process.argv.slice(2);
const flags    = rawArgs.filter((a) => a.startsWith("--"));
const positional = rawArgs.filter((a) => !a.startsWith("--"));

const envFlag = flags.find((f) => f.startsWith("--env="))?.split("=")[1];
// --clean: wipe questionnaires + applicants/identities/matches, then re-seed everything fresh
const CLEAN = flags.includes("--clean");
const extraFlags = flags.filter((f) => !f.startsWith("--env=") && f !== "--clean");

// ─── Prompt helpers ───────────────────────────────────────────────────────────

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function pickTarget(): Promise<Target> {
  console.log("\nWhat would you like to seed?");
  console.log("  1) applicants");
  console.log("  2) questionnaire");
  console.log("  3) admin account");
  console.log("  4) both (questionnaire + applicants)\n");
  const answer = await ask("Choice [1]: ");
  const map: Record<string, Target> = {
    "": "applicants", "1": "applicants", "applicants": "applicants",
    "2": "questionnaire", "questionnaire": "questionnaire",
    "3": "admin",        "admin": "admin",
    "4": "both",         "both": "both",
  };
  return map[answer] ?? "applicants";
}

async function pickEnv(): Promise<Env> {
  const answer = await ask("Environment (dev / test / prod) [dev]: ");
  return (ENVS.includes(answer as Env) ? answer : "dev") as Env;
}

// ─── Runner ───────────────────────────────────────────────────────────────────

async function resolveEnvFile(env: Env): Promise<string> {
  // Prefer the named env file (api/.env.dev, api/.env.test, api/.env.prod).
  // Fall back to api/.env so the quick-start "cp .env.example .env" path works.
  const named    = `${API_DIR}/.env.${env}`;
  const fallback = `${API_DIR}/.env`;

  if (await Bun.file(named).exists())    return named;
  if (await Bun.file(fallback).exists()) {
    console.warn(`[seed] ⚠️  api/.env.${env} not found — using api/.env`);
    return fallback;
  }

  console.error(`[seed] ❌  No env file found. Create api/.env.${env} or api/.env.`);
  console.error(`[seed]     cp api/.env.example api/.env.${env}  # then fill in the values`);
  process.exit(1);
}

// ─── Runner ───────────────────────────────────────────────────────────────────

async function run(script: string, env: Env, extra: string[] = []) {
  const envFile = await resolveEnvFile(env);
  console.log(`\n[seed] ▶  ${script.split("/").pop()}  (env: ${envFile.split("/").pop()})`);
  const proc = Bun.spawn(
    ["bun", `--env-file=${envFile}`, "run", script, ...extra],
    { cwd: API_DIR, stdin: "inherit", stdout: "inherit", stderr: "inherit" }
  );
  const code = await proc.exited;
  if (code !== 0) process.exit(code);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  let target = positional[0] as Target | undefined;
  let env    = envFlag as Env | undefined;

  // Validate positional arg if provided
  if (target && !TARGETS.includes(target)) {
    console.error(`[seed] Unknown target: "${target}"`);
    console.error(`[seed] Valid targets: ${TARGETS.join(", ")}`);
    process.exit(1);
  }

  // Validate --env= if provided
  if (env && !ENVS.includes(env)) {
    console.error(`[seed] Unknown env: "${env}"`);
    console.error(`[seed] Valid envs: ${ENVS.join(", ")}`);
    process.exit(1);
  }

  // Interactive mode when called with no arguments
  const interactive = !target && !env;
  if (interactive) {
    target = await pickTarget();
    // "admin" manages its own interactive prompts — no env needed here
    if (target !== "admin") {
      env = await pickEnv();
    }
    console.log();
  } else {
    target ??= "questionnaire";
    env    ??= "dev";
  }

  if (target === "both") {
    const qFlags = CLEAN ? ["--clean"] : [];
    const aFlags = [...extraFlags, ...(CLEAN ? ["--clear"] : [])];
    await run(SEED_SCRIPTS.questionnaire, env!, qFlags);
    await run(SEED_SCRIPTS.applicants,    env!, aFlags);
  } else if (target === "admin") {
    // admin seed is interactive; env defaults to dev if not specified
    await run(SEED_SCRIPTS.admin, env ?? "dev");
  } else {
    let extra: string[] = [];
    if (target === "applicants") {
      extra = [...extraFlags, ...(CLEAN ? ["--clear"] : [])];
    } else if (target === "questionnaire") {
      extra = CLEAN ? ["--clean"] : [];
    }
    await run(SEED_SCRIPTS[target], env!, extra);
  }

  console.log("\n[seed] ✅  All done.");
}

main().catch((err) => {
  console.error("[seed] Fatal:", err);
  process.exit(1);
});

#!/usr/bin/env bun
/**
 * Runs api/src/scripts/eval-rerank.ts against the right env file, mirroring
 * scripts/seed.ts's env-file resolution.
 *
 * Usage (from repo root):
 *   bun run eval:rerank                    → api/.env.dev
 *   bun run eval:rerank --env=test
 *   bun run eval:rerank --csv=out.csv      → also write every candidate row to CSV
 */

const API_DIR = new URL("../api", import.meta.url).pathname;

const args    = process.argv.slice(2);
const envFlag = args.find((a) => a.startsWith("--env="))?.split("=")[1] ?? "dev";
const extra   = args.filter((a) => !a.startsWith("--env="));

async function resolveEnvFile(env: string): Promise<string> {
  const named    = `${API_DIR}/.env.${env}`;
  const fallback = `${API_DIR}/.env`;

  if (await Bun.file(named).exists())    return named;
  if (await Bun.file(fallback).exists()) {
    console.warn(`[eval-rerank] ⚠️  api/.env.${env} not found — using api/.env`);
    return fallback;
  }

  console.error(`[eval-rerank] ❌  No env file found. Create api/.env.${env} or api/.env.`);
  process.exit(1);
}

const envFile = await resolveEnvFile(envFlag);
const proc = Bun.spawn(
  ["bun", `--env-file=${envFile}`, "run", "src/scripts/eval-rerank.ts", ...extra],
  { cwd: API_DIR, stdin: "inherit", stdout: "inherit", stderr: "inherit" }
);
process.exit(await proc.exited);

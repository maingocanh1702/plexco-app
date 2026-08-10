#!/usr/bin/env node
/**
 * Smoke predeploy — minimal liveness check against a RUNNING deployment/dev server.
 * Pattern lifted from BotShopez `scripts/smoke-predeploy.cjs` (proposal
 * docs/proposals/cross-project-standardization-2026-08-07.md §4 C2).
 *
 * Checks /healthz only (intentionally no-DB — mirrors apps/web/app/healthz/route.ts,
 * which is the Fly http_check target). DB connectivity is covered by the test
 * suite via DATABASE_URL_TEST, not by this script.
 *
 * Usage:
 *   SMOKE_BASE_URL=https://<deployment> pnpm smoke:predeploy
 *   pnpm smoke:predeploy            # defaults to http://localhost:3000
 *
 * Exit codes: 0 = pass, 1 = check failed, 2 = bad invocation.
 */

const BASE_URL = (process.env.SMOKE_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 10_000);

if (!/^https?:\/\//.test(BASE_URL)) {
  console.error(`smoke: SMOKE_BASE_URL must start with http(s):// — got "${BASE_URL}"`);
  process.exit(2);
}
if (!Number.isFinite(TIMEOUT_MS) || TIMEOUT_MS <= 0) {
  console.error(`smoke: SMOKE_TIMEOUT_MS must be a positive number`);
  process.exit(2);
}

async function checkHealthz() {
  const url = `${BASE_URL}/healthz`;
  const started = Date.now();
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "error" });
  } catch (cause) {
    throw new Error(`GET ${url} failed: ${cause?.message ?? cause}`, { cause });
  }
  if (res.status !== 200) {
    throw new Error(`GET ${url} → HTTP ${res.status} (expected 200)`);
  }
  let body;
  try {
    body = await res.json();
  } catch {
    throw new Error(`GET ${url} → non-JSON body`);
  }
  if (body?.ok !== true) {
    throw new Error(`GET ${url} → body.ok !== true: ${JSON.stringify(body)}`);
  }
  return Date.now() - started;
}

try {
  const ms = await checkHealthz();
  console.log(`smoke: PASS — ${BASE_URL}/healthz 200 ok=true (${ms}ms)`);
  process.exit(0);
} catch (error) {
  console.error(`smoke: FAIL — ${error.message}`);
  process.exit(1);
}

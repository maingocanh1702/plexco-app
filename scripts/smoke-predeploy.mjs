#!/usr/bin/env node
/**
 * Smoke predeploy: the ONE definition of "a healthy deployment answers", run against a RUNNING
 * deployment or server. Pattern lifted from BotShopez `scripts/smoke-predeploy.cjs` (proposal
 * docs/proposals/cross-project-standardization-2026-08-07.md §4 C2). infra/smoke-check.sh (the
 * post-deploy adapter) runs this file; apps/web/e2e/smoke-predeploy.spec.ts tests it.
 *
 * Unauthenticated, read-only and no-DB by design (apps/web/app/healthz/route.ts opens no database;
 * DB connectivity is covered by the test suite via DATABASE_URL_TEST):
 *   GET /healthz               200, a JSON content type, the WHOLE body exactly one JSON document,
 *                              whose `ok` is the boolean true
 *   GET /                      2xx, text/html (the signed-out landing page)
 *   GET /manifest.webmanifest  2xx, application/manifest+json
 * Every request fails on a 3xx (redirect: "error") and after SMOKE_TIMEOUT_MS. A failure names the
 * check, the status and the content type, never the response body.
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

/** A failed check: the path, the status and the media type; never a byte of the body. */
const failed = (path, res, type, what) =>
  new Error(`GET ${path}: HTTP ${res.status}, content-type ${type || "none"}: ${what}`);

/** GET one path; resolves to the response and its media type (lowercase, parameters dropped). */
async function get(path) {
  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "error",
    });
  } catch (error) {
    // No response, so no body: a 3xx ("unexpected redirect"), a refused connection, a timeout.
    const inner = error?.cause;
    const detail = inner ? ` (${inner.code ?? inner.message ?? inner})` : "";
    throw new Error(`GET ${path}: request failed: ${error?.message ?? error}${detail}`, {
      cause: error,
    });
  }
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  return { res, type };
}

async function checkHealthz() {
  const path = "/healthz";
  const { res, type } = await get(path);
  if (res.status !== 200 || !(type === "application/json" || type.endsWith("+json"))) {
    throw failed(path, res, type, "expected 200 and a JSON content type");
  }
  let text;
  try {
    text = await res.text();
  } catch (error) {
    throw failed(path, res, type, `the body could not be read (${error?.name ?? "error"})`);
  }
  let body;
  try {
    // The WHOLE text, so a second document fails. The parse error quotes its input: dropped.
    body = JSON.parse(text);
  } catch {
    throw failed(path, res, type, "the body is not exactly one JSON document");
  }
  if (body?.ok !== true) throw failed(path, res, type, "field ok is not the boolean true");
  return `${path} ${res.status} ok=true`;
}

async function checkType(path, expected) {
  const { res, type } = await get(path);
  if (!res.ok || type !== expected) throw failed(path, res, type, `expected 2xx and ${expected}`);
  return `${path} ${res.status} ${type}`;
}

const started = Date.now();
try {
  const passed = [
    await checkHealthz(),
    await checkType("/", "text/html"),
    await checkType("/manifest.webmanifest", "application/manifest+json"),
  ];
  console.log(`smoke: PASS — ${BASE_URL}: ${passed.join("; ")} (${Date.now() - started}ms)`);
  process.exit(0);
} catch (error) {
  console.error(`smoke: FAIL — ${BASE_URL} ${error?.message ?? error}`);
  process.exit(1);
}

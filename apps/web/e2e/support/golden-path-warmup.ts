import type { Page } from "@playwright/test";
import { COMPILE_TIMEOUT_MS } from "./golden-path-timeouts";

/**
 * Warm-up phase of the golden-path spec. `next dev` compiles a page or API route on its first
 * request; on a loaded machine that took up to 113 s per route, which made the timed steps fail on
 * cold compiles instead of on product bugs. This requests every page and API route the flow uses
 * ONCE, before the timed steps, with a generous timeout and a per-route log line (so a slow compile
 * is visible, not a mystery). It uses no fixed sleeps: each request returns when its route is built.
 * Idle routes are evicted after ~60 s, so the spec's own timeouts (golden-path-timeouts.ts) stay generous.
 *
 * The probes carry a nil UUID and an empty body: a not-found / invalid-body answer is expected and
 * is not checked. They change no data. POST /api/onboarding/start is NOT probed: it spends the
 * 3-clubs-per-hour tenant-create bucket even on a bad body, and its first real use is the spec's own step.
 */
const NIL = "00000000-0000-0000-0000-000000000000";

const SESSION_API_ROUTES: Array<[method: "GET" | "POST", path: string]> = [
  ["GET", "/api/sports"],
  ["GET", `/api/sessions/${NIL}`],
  ["POST", "/api/sessions"],
  ["POST", `/api/sessions/${NIL}/publish`],
  ["POST", `/api/sessions/${NIL}/players`],
  ["POST", `/api/sessions/${NIL}/mark-paid`],
  ["POST", `/api/sessions/${NIL}/payments/${NIL}/reverse`],
  ["POST", `/api/sessions/${NIL}/close`],
  ["POST", `/api/sessions/${NIL}/cancel`],
];

export async function warmUpDevServer(page: Page, tenantId: string): Promise<void> {
  const pages = [
    "/onboarding/new-club",
    `/c/${tenantId}`,
    `/c/${tenantId}/sessions/new`,
    `/c/${tenantId}/sessions/${NIL}`,
  ];
  for (const path of pages) {
    const started = Date.now();
    const res = await page.request
      .get(path, { timeout: COMPILE_TIMEOUT_MS })
      .catch((error: unknown) => fail("GET", path, error));
    log("GET", path, res.status(), started);
  }
  // The browser's own fetch: goes through the spec's /api/sessions pacer and carries the same-origin
  // headers the real UI sends. The origin page is the signed-in app page the sign-in step left open.
  for (const [method, path] of SESSION_API_ROUTES) {
    const started = Date.now();
    const status = await page
      .evaluate(
        async ({ method, path, timeout }) => {
          const res = await fetch(path, {
            method,
            headers: method === "POST" ? { "content-type": "application/json" } : undefined,
            body: method === "POST" ? "{}" : undefined,
            signal: AbortSignal.timeout(timeout),
          });
          return res.status;
        },
        { method, path, timeout: COMPILE_TIMEOUT_MS },
      )
      .catch((error: unknown) => fail(method, path, error));
    log(method, path, status, started);
  }
}

function log(method: string, path: string, status: number, started: number): void {
  console.log(`[warm-up] ${method} ${path} -> ${status} in ${Date.now() - started} ms`);
}

function fail(method: string, path: string, error: unknown): never {
  throw new Error(
    `warm-up: ${method} ${path} did not answer within ${COMPILE_TIMEOUT_MS / 1000} s ` +
      `(is the dev server from runbook step 7 running and not overloaded?): ${String(error)}`,
  );
}

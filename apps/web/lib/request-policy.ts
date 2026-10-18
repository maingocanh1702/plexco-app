/**
 * Pure, runtime-agnostic policy used by apps/web/middleware.ts (Edge runtime — no Node APIs here,
 * no @plexco/db, no cookies). Kept in lib/ so it is unit-testable under vitest and so the DD-118
 * surface inventory (tenant-lang.test.ts) sees it; middleware.ts itself is a thin adapter.
 *
 * Two policies, both from audit 2026-09-06:
 *
 * W-10 — DISCOVERY ROUTE ALLOWLIST. `start:discovery` is a plain `next start`, so the discovery
 * ingress served EVERY route (auth, sessions, onboarding) and only failed because the `readonly`
 * role lacks EXECUTE. That is a role-grant accident standing in for a routing decision. When
 * PROCESS_ROLE=discovery, anything outside the discovery surface is 404 at the edge, before a
 * handler or a DB connection is touched. The surface is /healthz (Fly http_check) and /discover*
 * (the public read model route, DD-12 — not built yet; reserved here so it needs no middleware
 * change to land), plus the three public read GETs /api/discover, /api/discover/<id> and
 * /api/discover/share/<slug>; the join POST and every /api/sessions path stay web-only. The
 * discovery process answers GET and HEAD only (security review s1 N-2): any other method, on any
 * path, allowlisted or not, gets the same 404 (requestAllowedForRole is the middleware's gate).
 *
 * CSP NONCE (backlog `web-csp-script-src-nonce`, gap left open by lane A6 on purpose) — behind
 * CSP_SCRIPT_NONCE_ENABLED="true". The App Router bootstraps every page with inline scripts, so
 * a `script-src` without a per-request nonce blocks rendering; Next.js applies the nonce it finds
 * in the REQUEST's Content-Security-Policy header (set by middleware) to its own inline scripts.
 * This could not be exercised with `next build`/`next start` in the session that wrote it, hence
 * the flag: OFF sends exactly A6's nonce-free floor from next.config.mjs; ON replaces it with the
 * same directives plus `script-src 'nonce-…' 'strict-dynamic'`. Enable only after a real
 * `next start` + a browser console show zero CSP violations on every page.
 */

export type ProcessRole = "web" | "discovery" | "worker";

export const DISCOVERY_PATH_ALLOWLIST: readonly RegExp[] = [
  /^\/healthz$/,
  /^\/discover(\/|$)/,
  /^\/api\/discover$/,
  /^\/api\/discover\/[^/]+$/,
  /^\/api\/discover\/share\/[^/]+$/,
];

export function parseProcessRole(raw: string | undefined): ProcessRole {
  const v = raw?.trim().toLowerCase();
  return v === "discovery" || v === "worker" ? v : "web";
}

/** true when the path may be served by this process role, whatever the method. */
export function pathAllowedForRole(pathname: string, role: ProcessRole): boolean {
  if (role !== "discovery") return true;
  return DISCOVERY_PATH_ALLOWLIST.some((re) => re.test(pathname));
}

/**
 * The edge gate (W-10 + N-2): discovery serves only GET and HEAD on an allowlisted path; web and
 * worker serve every request. Fetch upper-cases a get/head method, so the exact match drops no
 * real read and fails closed on anything else.
 */
export function requestAllowedForRole(
  method: string,
  pathname: string,
  role: ProcessRole,
): boolean {
  if (role !== "discovery") return true;
  return (method === "GET" || method === "HEAD") && pathAllowedForRole(pathname, role);
}

/** Exactly the string "true" enables the nonce policy — fail closed on anything else. */
export function cspNonceEnabled(raw: string | undefined): boolean {
  return raw === "true";
}

/**
 * The nonce-bearing policy. Mirrors next.config.mjs SECURITY_HEADERS' CSP (frame-ancestors,
 * base-uri, form-action, object-src) so enabling the flag never DROPS a floor directive — it only
 * adds script-src. `'strict-dynamic'` lets the nonced Next bootstrap load its own chunks without
 * enumerating hosts; the `https:` fallback is ignored by browsers that honour strict-dynamic and
 * keeps old engines from blocking everything.
 *
 * `worker-src 'self'` (DD-123 OD-7, owner-signed) is explicit. Measured in Chromium: the same-origin
 * /sw.js (components/pwa/register-sw.tsx) registers WITH OR WITHOUT it, so it is not what keeps the
 * PWA alive. What the directive actually changes is the opposite direction: with no worker-src a
 * worker falls back to child-src and then script-src, and that fallback allowed blob:/data: workers;
 * `worker-src 'self'` blocks them, so workers can only load from a same-origin script URL.
 * next.config.mjs' static CSP has no script-src/default-src/child-src, so workers are
 * unrestricted there and it needs no worker-src.
 */
export function buildNonceCsp(nonce: string): string {
  return [
    `script-src 'nonce-${nonce}' 'strict-dynamic' https:`,
    "worker-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

/** 128 bits, base64 — the size Next's own examples use; Web Crypto so it runs on the Edge. */
export function newNonce(bytes: Uint8Array = crypto.getRandomValues(new Uint8Array(16))): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/**
 * Audit 2026-09-06 W-9. `GET /api/auth/google/state` has side effects (a transaction row + a
 * cookie overwrite), so a cross-site page could fire it ten times through `<img src>` and both
 * burn the victim's IP bucket and overwrite their in-flight binding cookie. The only legitimate
 * caller is a top-level navigation (the login button/link). Fetch-metadata headers are set by the
 * browser and cannot be forged by page script: a request whose `Sec-Fetch-Dest` is present and is
 * NOT `document` (image, script, fetch, iframe…) is refused BEFORE the bucket is spent — a 403
 * that creates nothing. Absent headers (old browsers, curl) pass: this is defence in depth over
 * the state+binding+PKCE design, not the property that makes the flow safe.
 *
 * It lives HERE rather than in the route module because an App Router route may export only the
 * HTTP verbs and a fixed set of config fields: `next build` fails the ENTIRE build with
 * `"isTopLevelNavigation" is not a valid Route export field` on anything else. Neither vitest nor
 * tsc catches that — only a real build does, which is how it was found.
 */
export function isTopLevelNavigation(request: Request): boolean {
  const dest = request.headers.get("sec-fetch-dest");
  if (dest === null) return true;
  return dest.toLowerCase() === "document";
}

/**
 * Hoisted out of `app/api/auth/google/{callback,complete}/route.ts`, where it was duplicated
 * byte-for-byte: a 302 redirect that leaks no referrer (both hops carry auth code/state/handoff
 * on the URL they redirect away from).
 */
export function redirect(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: { location, "referrer-policy": "no-referrer" },
  });
}

/** Also hoisted from the two Google OAuth routes — see `redirect()` above. */
export function noReferrer(response: Response): Response {
  response.headers.set("referrer-policy", "no-referrer");
  return response;
}

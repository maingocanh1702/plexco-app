import { expect, test, type APIRequestContext, type APIResponse } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

/**
 * LOCAL-ONLY real-stack proof, phase 2 of two (lane L72; readiness D5 phase 2 and D6): `next start`
 * (NODE_ENV production) over the scratch database phase 1 (public-share-page.proof.ts) prepared;
 * its share paths and session token arrive in the 0600 state file. Never run in CI: the name is
 * outside Playwright's testMatch and it is skipped unless SHARE_PROOF_BASE_URL is set. Requests
 * only, no page, and never a forwarded client-IP header: every request shares one limiter bucket.
 * A share path and the session token are bearer tokens: neither goes into a title, a console line
 * or an assertion message.
 */
const BASE = process.env.SHARE_PROOF_BASE_URL;
test.skip(!BASE, "local proof: run apps/web/e2e/public-share-page-proof.sh");
test.use({ baseURL: BASE });

const SCRATCH = "/plexco_l39_scratch";
const DB_URL = process.env.SHARE_PROOF_DB_URL ?? ""; // the scratch superuser URL, never printed
const pathOf = (url = "") => new URL(url).pathname;
const root = () => resolve(dirname(test.info().file), "../../.."); // the repo root
const WELL_FORMED = /^\/session\/[A-Za-z0-9_-]{22}$/;
const CACHE = "private, no-cache, no-store, max-age=0, must-revalidate"; // force-dynamic, production
// next.config.mjs:56-66 (SECURITY_HEADERS) verbatim, all but Referrer-Policy (it differs per route);
// lib/security-headers.test.ts pins that source. Copied: importing next.config.mjs fails under
// Playwright's require hook (its import.meta.url).
const GLOBAL_HEADERS = {
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "content-security-policy":
    "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
};

type PgClient = { connect(): Promise<void>; query(q: string, v: unknown[]): Promise<unknown> };
type Pg = { Client: new (o: { connectionString: string }) => PgClient & { end(): Promise<void> } };
type State = {
  run: string;
  tenantId: string;
  paths: { off1: string; off2: string; on: string; priv: string };
  token: string;
};
let state: State;
let reference: { markup: string; flight: string } | undefined;
const s = (code: string, field: string) => `${field} ${code} ${state.run}`; // phase 1's s()

/** One call; a failure throws fixed text, as Playwright's error lists the URL and every header. */
async function send(call: () => Promise<APIResponse>, failure: string) {
  try {
    return await call();
  } catch {
    throw new Error(failure);
  }
}
const valuesOf = (res: APIResponse, name: string) =>
  res
    .headersArray()
    .filter((h) => h.name.toLowerCase() === name)
    .map((h) => h.value);

/** The five global headers once each with their values, one Referrer-Policy, the X-Robots-Tags. */
function expectHeaders(res: APIResponse, referrer: string, robots: string[]) {
  for (const [name, value] of Object.entries(GLOBAL_HEADERS)) {
    expect(valuesOf(res, name), name).toEqual([value]);
  }
  expect(valuesOf(res, "referrer-policy"), "one Referrer-Policy").toEqual([referrer]);
  expect(valuesOf(res, "x-robots-tag"), "the X-Robots-Tag entries").toEqual(robots);
}
/** next.config.mjs's /session/:slug entry over the global set, on the 200 and the 404. */
const expectShareHeaders = (res: APIResponse) =>
  expectHeaders(res, "no-referrer", ["noindex, nofollow"]);

/** One anonymous GET of a share path: its status, the share headers, Cache-Control; its HTML. */
async function share(request: APIRequestContext, path: string, status: 200 | 404) {
  const res = await send(() => request.get(path), "share page request failed");
  expect(res.status(), status === 200 ? "a live link is a 200" : "a miss is a 404").toBe(status);
  expectShareHeaders(res);
  expect(valuesOf(res, "cache-control"), "Cache-Control").toEqual([CACHE]);
  return res.text();
}

// Phase 1's normalization (expect404) without its dev-only parts: next start emits none of the dev
// clock values (the `?v=` asset query, the `:N` time origin, the `:J` I/O timings) and no I/O
// debug rows, so nothing is masked and the Flight of every miss, the malformed one too, is compared.
const markupOf = (html: string) => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");
const flightOf = (html: string) =>
  [...html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)]
    .map((m) => JSON.parse(m[1] ?? '""') as string)
    .join("");

/** A miss: a 404 with the share headers; its markup and Flight equal the reference miss's. */
async function expect404(request: APIRequestContext, path: string) {
  const html = await share(request, path, 404);
  const body = html.split(path.slice("/session/".length)).join("SLUG"); // the slug is in the payload
  const miss = { markup: markupOf(body), flight: flightOf(body) };
  expect(miss.flight.length > 0, "a miss carries its Flight payload").toBe(true);
  reference ??= miss;
  expect(miss.markup === reference.markup, "404 markup equals the reference miss's").toBe(true);
  expect(miss.flight === reference.flight, "404 Flight equals the reference miss's").toBe(true);
}

test.describe.serial("public share page under next start: headers, one 404, the cookie", () => {
  test("phase 1's state file, and every database is the scratch one", () => {
    const file = process.env.SHARE_PROOF_STATE_FILE;
    if (!file) throw new Error("SHARE_PROOF_STATE_FILE is not set");
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      throw new Error("the state file is not readable JSON"); // JSON.parse quotes its input
    }
    // Exactly phase 1's shape. A check message names a key, never a value.
    const o = (parsed ?? {}) as Record<string, unknown>;
    const p = (o.paths ?? {}) as Record<string, unknown>;
    const keys = (x: object) => Object.keys(x).sort().join();
    expect(keys(o) === "paths,run,tenantId,token", "the state keys").toBe(true);
    expect(keys(p) === "off1,off2,on,priv", "the path keys").toBe(true);
    for (const key of ["run", "tenantId", "token"]) {
      expect(typeof o[key] === "string" && o[key] !== "", `${key} is non-empty`).toBe(true);
    }
    for (const [key, v] of Object.entries(p)) {
      expect(typeof v === "string" && WELL_FORMED.test(v), `${key} is a share path`).toBe(true);
    }
    state = o as State;
    for (const name of ["SHARE_PROOF_DB_URL", "DATABASE_URL", "DISCOVERY_DATABASE_URL"]) {
      expect(pathOf(process.env[name]), `${name} is the scratch DB`).toBe(SCRATCH);
    }
  });

  test("the live links: off2 shows its venue, On its area only", async ({ request }) => {
    const off = await share(request, state.paths.off2, 200);
    expect(off.includes(s("Off", "San Rieng")), "the venue name is shown").toBe(true);
    const on = await share(request, state.paths.on, 200);
    expect(on.includes(s("On", "Khu Chia Se")), "the area is shown").toBe(true);
    expect(on.includes(s("On", "Rieng")), "neither the venue name nor the address").toBe(false);
  });

  test("never existed, rotated, private and malformed: one 404", async ({ request }) => {
    await expect404(request, `/session/${randomBytes(16).toString("base64url")}`); // the reference
    await expect404(request, state.paths.off1); // rotated away by phase 1's second link
    await expect404(request, state.paths.priv); // made private in phase 1
    await expect404(request, "/session/notAShareSlug"); // malformed: not 22 characters
  });

  test("a suspended tenant's live link is the same 404", async ({ request }) => {
    // FIRST, fail closed: this URL alone keeps the UPDATE off real data. pg is packages/db's only.
    expect(pathOf(DB_URL), "SHARE_PROOF_DB_URL is the scratch DB").toBe(SCRATCH);
    const { Client } = createRequire(resolve(root(), "packages/db/package.json"))("pg") as Pg;
    const db = new Client({ connectionString: DB_URL });
    await db.connect();
    const suspend = "UPDATE tenants SET status = 'suspended' WHERE id = $1";
    await db.query(suspend, [state.tenantId]).finally(() => db.end());
    await expect404(request, state.paths.off2);
  });

  test("healthz keeps the six global headers and no X-Robots-Tag", async ({ request }) => {
    const res = await send(() => request.get("/healthz"), "healthz request failed");
    expect(res.status(), "healthz is up").toBe(200);
    expectHeaders(res, "strict-origin-when-cross-origin", []);
  });

  test("last, D6: logout clears the cookie with its __Host- attributes", async ({ request }) => {
    // Only the Cookie header. Under next start NODE_ENV is production, so the server reads the
    // __Host- name (lib/session-cookies.ts sessionCookieName). Last: it revokes phase 1's session.
    const res = await send(
      () =>
        request.post("/api/auth/logout", {
          headers: { Cookie: `__Host-plx_session=${state.token}` },
        }),
      "logout request failed",
    );
    expect(res.status(), "logout is a 200").toBe(200);
    const mine = valuesOf(res, "set-cookie").filter((c) => c.startsWith("__Host-plx_session="));
    expect(mine.length, "exactly one Set-Cookie for __Host-plx_session").toBe(1);
    const [pair, ...attrs] = (mine[0] ?? "").split(";").map((part) => part.trim());
    expect(pair === "__Host-plx_session=", "its value is empty").toBe(true);
    const flags = attrs.map((a) => a.toLowerCase());
    for (const flag of ["path=/", "max-age=0", "httponly", "secure", "samesite=strict"]) {
      expect(flags.includes(flag), `the clearing cookie has ${flag}`).toBe(true);
    }
    const domain = flags.some((a) => a.startsWith("domain"));
    expect(domain, "no Domain attribute").toBe(false);
  });
});

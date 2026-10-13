import { resolveLang } from "@plexco/core/i18n";
import { tenantLocale } from "@plexco/db";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveTenantLang } from "./tenant-lang";

vi.mock("@plexco/db", () => ({
  createDb: vi.fn(() => ({ pool: {}, db: {} })),
  tenantLocale: vi.fn(),
}));

// Partial mock: keep the REAL parseLang/resolveLang behaviour (the fail-closed cases below depend
// on it) while making resolveLang observable. DD-118 pins the SEAM, not just the output, and the
// seam is invisible to an output-only assertion: replacing the implementation with
// `return tenantDefault` produces identical results today and silently deletes the place the
// member-locale column has to land.
vi.mock("@plexco/core/i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@plexco/core/i18n")>();
  return { ...actual, resolveLang: vi.fn(actual.resolveLang) };
});

process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";

const TENANT = "11111111-1111-4111-8111-111111111111";
const db = {} as never;

describe("resolveTenantLang — the single DD-118 derivation", () => {
  beforeEach(() => vi.mocked(tenantLocale).mockReset());

  it("returns the tenant's configured language when it is en", async () => {
    vi.mocked(tenantLocale).mockResolvedValue("en");
    expect(await resolveTenantLang(db, TENANT)).toBe("en");
  });

  it("returns vi when the tenant is configured vi", async () => {
    vi.mocked(tenantLocale).mockResolvedValue("vi");
    expect(await resolveTenantLang(db, TENANT)).toBe("vi");
  });

  it("normalises casing and surrounding space, because parseLang owns that vocabulary", async () => {
    vi.mocked(tenantLocale).mockResolvedValue("  EN  ");
    expect(await resolveTenantLang(db, TENANT)).toBe("en");
  });

  // DD-118: "request không resolve được tenant, hoặc tenant có locale không nhận dạng được ⇒ vi".
  // Each of these reaches the default by a DIFFERENT route, and they are asserted separately so a
  // regression in one cannot hide behind another.
  it("fails closed to vi when the locale is undetermined (null)", async () => {
    vi.mocked(tenantLocale).mockResolvedValue(null);
    expect(await resolveTenantLang(db, TENANT)).toBe("vi");
  });

  it("fails closed to vi when the stored value is outside the vi/en vocabulary", async () => {
    vi.mocked(tenantLocale).mockResolvedValue("fr");
    expect(await resolveTenantLang(db, TENANT)).toBe("vi");
  });

  it("fails closed to vi on an empty stored value", async () => {
    vi.mocked(tenantLocale).mockResolvedValue("");
    expect(await resolveTenantLang(db, TENANT)).toBe("vi");
  });

  // The seam DD-118 pins: resolveLang(memberLocale, tenantDefault) is called with memberLocale =
  // null because no member-locale column exists. This asserts the tenant value is what flows
  // through today — the test that will need updating when that column lands, which is the point.
  it("reads the tenant value through tenant_locale exactly once per resolution", async () => {
    vi.mocked(tenantLocale).mockResolvedValue("en");
    await resolveTenantLang(db, TENANT);
    expect(tenantLocale).toHaveBeenCalledTimes(1);
    expect(tenantLocale).toHaveBeenCalledWith(db, TENANT);
  });

  // DD-118: "resolveLang(memberLocale, tenantDefault) giữ nguyên chữ ký, gọi với memberLocale =
  // null cho tới khi có cột locale cấp member — để cái seam đã đúng sẵn khi cột đó xuất hiện."
  // Output-only assertions cannot see this: `return tenantDefault` passes every other test in this
  // file while deleting the seam. Assert the call itself.
  it("routes through the DD-118 seam with memberLocale = null, not around it", async () => {
    vi.mocked(tenantLocale).mockResolvedValue("en");
    vi.mocked(resolveLang).mockClear();

    await resolveTenantLang(db, TENANT);

    expect(resolveLang).toHaveBeenCalledTimes(1);
    expect(resolveLang).toHaveBeenCalledWith(null, "en");
  });

  it("passes the FAIL-CLOSED default through the same seam, not past it", async () => {
    vi.mocked(tenantLocale).mockResolvedValue("fr");
    vi.mocked(resolveLang).mockClear();

    expect(await resolveTenantLang(db, TENANT)).toBe("vi");
    expect(resolveLang).toHaveBeenCalledWith(null, "vi");
  });
});

/**
 * DD-118 surface classification — committed, executable evidence.
 *
 * The lane's reasoning for "exactly one surface needed wiring" lived only in the lane ledger under
 * `.autopilot/state/`, which is gitignored, so it was not reproducible from HEAD (codex round-01
 * [P2]). It lives here instead, where it is committed AND fails when it goes stale.
 *
 * Buckets (DD-118):
 *   a = tenant known AND authenticated at response time -> must runWithLang
 *   b = pre-authentication or tenant-unknown            -> stays Vietnamese, APPROVED behaviour
 *   c = not a user-facing response                      -> out of scope
 *
 * The point of the test is the LAST assertion: a route file that exists on disk but is missing
 * from this map fails, so a new surface cannot be added without being classified.
 */
const SURFACE_BUCKETS: Record<string, "a" | "b" | "c"> = {
  // (a) — wired. Authorization for THIS tenant is proven before the seam.
  "app/api/onboarding/readiness/route.ts": "a",
  // (a) — club configuration (M1b): both delegate to resolveClubGate, which proves authorize()
  // before it resolves language; the PATCH body runs inside runWithLang.
  "app/api/onboarding/club/route.ts": "a",
  // M3a: connector routes are gated by authorize(connector.secret_manage) before language resolves;
  // the webhook is authenticated by the per-bot secret and the bot belongs to exactly ONE tenant,
  // so its locale is that tenant's (DD-118) -- replies before authentication stay Vietnamese.
  "app/api/onboarding/zalo/route.ts": "a",
  "app/api/onboarding/zalo/connect/route.ts": "a",
  "app/api/webhooks/zalo/[token]/route.ts": "a",
  "lib/club-config-route.ts": "a",
  // (a) — already wired upstream: all five delegate to handleSessionCommand, whose handler body
  // runs inside runWithLang. They emit only ok(...).
  "app/api/sessions/route.ts": "a",
  "app/api/sessions/[id]/route.ts": "a",
  "app/api/sessions/[id]/publish/route.ts": "a",
  "app/api/sessions/[id]/close/route.ts": "a",
  "app/api/sessions/[id]/cancel/route.ts": "a",
  // (a) — same wiring as the five above: both delegate to handleSessionCommand and call
  // withGuestNoteErrors (lib/session-guest-note-route.ts) INSIDE that handler, so both run
  // within runWithLang. Neither emits t() directly; the error mapping does.
  "app/api/sessions/[id]/guest-notes/route.ts": "a",
  "app/api/sessions/[id]/guest-notes/[noteId]/route.ts": "a",
  "app/api/sessions/[id]/players/route.ts": "a",
  "app/api/sessions/[id]/players/[playerId]/route.ts": "a",
  "app/api/sessions/[id]/mark-paid/route.ts": "a",
  "app/api/sessions/[id]/payments/[allocationId]/reverse/route.ts": "a",
  // (b) — the tenant does not exist yet: this is the tenant-CREATION route, every t() is an error
  // path, and at the locale check the value is still an unvalidated request-body field. Reading it
  // would be a SECOND language source, which DD-118 forbids.
  "app/api/onboarding/start/route.ts": "b",
  // (b) — pre-authentication: identity is being established, no tenant is in the request.
  "app/api/auth/google/state/route.ts": "b",
  "app/api/auth/google/callback/route.ts": "b",
  "app/api/auth/google/complete/route.ts": "b",
  // (b) — authenticated but NO single tenant is routed. /session returns a LIST of tenants, so no
  // one tenant's locale applies; logout and logout-all are account-scoped.
  "app/api/auth/session/route.ts": "b",
  // (b) — account-scoped linking (M3b): the Zalo identity is global, no tenant is routed; Vietnamese default.
  "app/api/me/link/route.ts": "b",
  "app/api/auth/logout/route.ts": "b",
  "app/api/auth/logout-all/route.ts": "b",
  // (c) — liveness probe: {ok:true}, no DB, no auth.
  "app/healthz/route.ts": "c",

  // SHARED RESPONDERS in apps/web/lib. The task METHOD requires "each route.ts, PLUS any shared
  // responder in apps/web/lib"; walking only `app/` let a shared responder go unclassified
  // (codex round-02 [P2]).
  //
  // (a) — the shared entry gate for the five session routes. It resolves language itself and runs
  // its handler body inside runWithLang; it is the reason those five need no wiring of their own.
  "lib/session-command-route.ts": "a",
  "lib/session-read-route.ts": "a",
  // (a) — the guest-note error boundary. It calls t() to build every mapped message
  // (COMMAND_ID_CONFLICT..SESSION_NOT_OPEN) and its own docstring requires running inside
  // runWithLang; both callers only ever invoke it from within an already-wired "a" route's
  // handleSessionCommand handler, so tenant+auth are always known when its output renders.
  "lib/session-guest-note-route.ts": "a",
  // (c) — reached only through a route, and emits NO translatable string of its own: api-envelope
  // passes `message` through verbatim, and the rest hold zero t() calls (verify:
  // grep -rlP '(?<![A-Za-z0-9_.$])t\(' apps/web/lib). A file with no translatable output cannot
  // render in the wrong language, so it needs no language context.
  "lib/api-envelope.ts": "c",
  "lib/read-bounded-body.ts": "c",
  "lib/tenant-lang.ts": "c",
  "lib/auth-secrets.ts": "c",
  "lib/connector-secrets.ts": "c",
  "lib/link-code-keys.ts": "c",
  // (c) — browser-side state mapping for /me/link (M3b): no t(), no response body; strings live in the view.
  "lib/me-link-client.ts": "c",
  "lib/google-oidc.ts": "c",
  "lib/oauth-transaction.ts": "c",
  // (b) — RECLASSIFIED 2026-09-06 (audit W-4): buildCompletionLanding renders a user-facing
  // document (title, Continue button, <html lang>) on the pre-authentication hop, so this file
  // DOES emit translatable output. It went unclassified as (c) because the old rule inferred
  // "0 t() calls ⇒ 0 user-facing strings" — the landing was English-only OUTSIDE t(), which is
  // exactly the HR5 miss the inference cannot see. The landing now goes through t(); pre-tenant
  // ⇒ Vietnamese default, DD-118-approved.
  "lib/session-cookies.ts": "b",
  // (c) — logger: emits JSON lines to stdout/stderr, never a user-facing response.
  "lib/log.ts": "c",
  // (c) — pure routing/CSP policy consumed by middleware.ts; no response body of its own.
  "lib/request-policy.ts": "c",
};

function discoverRouteFiles(dir: string, prefix: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) return discoverRouteFiles(path.join(dir, entry.name), rel);
    return entry.name === "route.ts" ? [rel] : [];
  });
}

// Every non-test TypeScript module in lib/ counts as a shared responder for classification
// purposes. Deliberately NOT filtered to "files that currently emit t()": that filter would let a
// new helper appear, start emitting a translatable string, and never enter the inventory — the
// exact staleness this test exists to prevent.
function discoverLibFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".ts") && !e.name.endsWith(".test.ts"))
    .map((e) => `lib/${e.name}`);
}

describe("DD-118 — every response surface in apps/web is classified", () => {
  // `app/` and `lib/` only: `.next/` is a generated build artifact (.gitignore:8) carrying a mirror
  // of every route path, which would otherwise double the discovered set.
  const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const discovered = [
    ...discoverRouteFiles(path.join(webRoot, "app"), "app"),
    ...discoverLibFiles(path.join(webRoot, "lib")),
  ].sort();

  it("discovers a non-empty surface set (guards against a silently broken walker)", () => {
    expect(discovered.length).toBeGreaterThan(10);
  });

  it("classifies EVERY route file on disk — an unclassified surface fails here", () => {
    const unclassified = discovered.filter((file) => !(file in SURFACE_BUCKETS));
    expect(unclassified).toEqual([]);
  });

  it("carries no classification for a route that no longer exists", () => {
    const stale = Object.keys(SURFACE_BUCKETS).filter((file) => !discovered.includes(file));
    expect(stale).toEqual([]);
  });
});

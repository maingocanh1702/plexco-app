import { createDb, createWebSession, rotateWebSession } from "@plexco/db";
import { cookies } from "next/headers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runWithLang } from "@plexco/core/i18n";
import {
  assertRuntimeDbRole,
  buildCompletionLanding,
  clientIp,
  COMPLETION_PATH,
  csrfOk,
  HANDOFF_FIELD,
  hashToken,
  issueSession,
  newHandoffToken,
  resetDbRoleViolationForTests,
  sameOriginRequest,
  SESSION_COOKIE,
  sessionCookieName,
  SessionReauthRequiredError,
  trustedIngressProvider,
  appDb,
} from "./session-cookies";

vi.mock("@plexco/db", () => ({
  createDb: vi.fn(() => ({ pool: {} })),
  resolveWebSession: vi.fn(),
  rotateWebSession: vi.fn(),
  createWebSession: vi.fn(),
  rateLimitCheck: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";

function reqWith(headers: Record<string, string>): Request {
  return new Request("https://plexco.app/api/auth/logout", { method: "POST", headers });
}

describe("sameOriginRequest", () => {
  it("accepts a same-origin Origin header", () => {
    expect(sameOriginRequest(reqWith({ host: "plexco.app", origin: "https://plexco.app" }))).toBe(
      true,
    );
  });

  it("rejects a cross-site Origin header (login CSRF vector)", () => {
    expect(
      sameOriginRequest(reqWith({ host: "plexco.app", origin: "https://attacker.example" })),
    ).toBe(false);
  });

  it("falls back to Referer when Origin is absent", () => {
    expect(
      sameOriginRequest(reqWith({ host: "plexco.app", referer: "https://plexco.app/login" })),
    ).toBe(true);
  });

  it("rejects a cross-site Referer when Origin is absent", () => {
    expect(
      sameOriginRequest(reqWith({ host: "plexco.app", referer: "https://attacker.example/x" })),
    ).toBe(false);
  });

  it("fails closed when neither Origin nor Referer is present", () => {
    expect(sameOriginRequest(reqWith({ host: "plexco.app" }))).toBe(false);
  });

  it("fails closed when Host itself is missing", () => {
    expect(sameOriginRequest(reqWith({ origin: "https://plexco.app" }))).toBe(false);
  });
});

describe("sameOriginRequest — scheme enforcement (codex round-03)", () => {
  // vi.stubEnv / vi.unstubAllEnvs rather than hand-rolled save-and-restore: NODE_ENV is typed
  // read-only, and the manual form also has to get "absent originally" right by hand — the exact
  // bug that silently re-zoned a sibling suite when `process.env.X = original` stored the STRING
  // "undefined". vitest owns the restore.
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("in production, rejects a same-host Origin over the WRONG scheme", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(sameOriginRequest(reqWith({ host: "plexco.app", origin: "http://plexco.app" }))).toBe(
      false,
    );
  });

  it("in production, still accepts a same-host Origin over https", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(sameOriginRequest(reqWith({ host: "plexco.app", origin: "https://plexco.app" }))).toBe(
      true,
    );
  });

  it("in production, rejects a same-host Referer over the WRONG scheme", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(
      sameOriginRequest(reqWith({ host: "plexco.app", referer: "http://plexco.app/login" })),
    ).toBe(false);
  });

  it("outside production, scheme is not enforced (local dev commonly runs plain http)", () => {
    vi.stubEnv("NODE_ENV", "test");
    expect(sameOriginRequest(reqWith({ host: "plexco.app", origin: "http://plexco.app" }))).toBe(
      true,
    );
  });
});

describe("clientIp — provider-pinned trusted ingress", () => {
  // Same reason as above, and note vi.unstubAllEnvs restores an ORIGINALLY-ABSENT variable by
  // deleting it — the case the hand-written branch below used to spell out.
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses only DigitalOcean's overwritten client-IP header", () => {
    const request = reqWith({
      "do-connecting-ip": "203.0.113.10",
      "fly-client-ip": "198.51.100.90",
      "x-forwarded-for": "198.51.100.91, 10.0.0.2",
    });

    expect(clientIp(request, "digitalocean")).toBe("203.0.113.10");
  });

  it("does not let a cross-provider or X-Forwarded-For header mint a DO bucket", () => {
    const request = reqWith({
      "fly-client-ip": "198.51.100.90",
      "x-forwarded-for": "198.51.100.91, 10.0.0.2",
    });

    expect(clientIp(request, "digitalocean")).toBe("digitalocean:untrusted");
  });

  it("rejects malformed and multi-value trusted headers", () => {
    expect(clientIp(reqWith({ "do-connecting-ip": "not-an-ip" }), "digitalocean")).toBe(
      "digitalocean:untrusted",
    );
    expect(
      clientIp(reqWith({ "do-connecting-ip": "203.0.113.10, 198.51.100.2" }), "digitalocean"),
    ).toBe("digitalocean:untrusted");
  });

  it("uses only Fly's overwritten header when Fly is the configured edge", () => {
    const request = reqWith({
      "do-connecting-ip": "203.0.113.10",
      "fly-client-ip": "2001:db8::1",
    });

    expect(clientIp(request, "fly")).toBe("2001:db8::1");
  });

  it("uses direct mode only for local development", () => {
    expect(clientIp(reqWith({ "do-connecting-ip": "203.0.113.10" }), "direct")).toBe("local");
  });

  it("requires an explicit trusted ingress provider in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TRUSTED_INGRESS_PROVIDER", undefined);

    expect(() => trustedIngressProvider()).toThrow("TRUSTED_INGRESS_PROVIDER");
  });

  it("forbids direct mode in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TRUSTED_INGRESS_PROVIDER", "direct");

    expect(() => trustedIngressProvider()).toThrow("forbidden in production");
  });

  it("rejects an unsupported provider instead of silently falling back", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("TRUSTED_INGRESS_PROVIDER", "unknown-edge");

    expect(() => trustedIngressProvider()).toThrow("TRUSTED_INGRESS_PROVIDER");
  });

  it("reads the explicit production provider", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TRUSTED_INGRESS_PROVIDER", "digitalocean");

    expect(trustedIngressProvider()).toBe("digitalocean");
  });
});

/**
 * Issuance fence (G3 §4.6 / B0 §6 amendment v1.86, acceptance D0-12): when a
 * request carries a session cookie but rotate returns null (the old session was
 * revoked/expired — e.g. a concurrent logout-all won the race), issueSession
 * must NEVER fall back to minting a fresh session — it clears the cookie and
 * throws SessionReauthRequiredError. A request with no cookie keeps the
 * unchanged create path and cookie attributes.
 */
describe("issueSession — issuance fence (G3-B1/B2, D0-12)", () => {
  function mockCookieStore(value: string | undefined) {
    const store = {
      get: vi.fn(() => (value === undefined ? undefined : { value })),
      set: vi.fn(),
      delete: vi.fn(),
    };
    vi.mocked(cookies).mockResolvedValue(store as never);
    return store;
  }

  beforeEach(() => {
    vi.mocked(rotateWebSession).mockReset();
    vi.mocked(createWebSession).mockReset();
    vi.mocked(cookies).mockReset();
  });

  it("G3-B1/D0-12: cookie exists + rotate returns null → clears cookie, throws SessionReauthRequiredError, NEVER mints", async () => {
    const store = mockCookieStore("stale-revoked-token");
    vi.mocked(rotateWebSession).mockResolvedValue(null);

    await expect(issueSession("acc-1")).rejects.toBeInstanceOf(SessionReauthRequiredError);

    expect(rotateWebSession).toHaveBeenCalledOnce();
    expect(createWebSession).not.toHaveBeenCalled(); // no fallback mint
    // Cleared as an expiring SET, not delete(): a bare delete() emits the header without
    // Secure, which a __Host- prefixed cookie is required to ignore, so the stale cookie would
    // survive and send every later login back down this same failing rotate branch.
    expect(store.set).toHaveBeenCalledWith(
      SESSION_COOKIE,
      "",
      expect.objectContaining({ maxAge: 0, path: "/", httpOnly: true, sameSite: "strict" }),
    );
    expect(store.set).toHaveBeenCalledOnce(); // the clear only — no new session cookie minted
  });

  it("G3-B1: cookie exists + rotate succeeds → mints via rotate, sets the new cookie, never creates", async () => {
    const store = mockCookieStore("live-token");
    vi.mocked(rotateWebSession).mockResolvedValue("new-session-id");

    const { csrfToken } = await issueSession("acc-1");

    expect(typeof csrfToken).toBe("string");
    expect(csrfToken.length).toBeGreaterThan(0);
    expect(createWebSession).not.toHaveBeenCalled();
    expect(store.set).toHaveBeenCalledWith(
      SESSION_COOKIE,
      expect.any(String),
      expect.objectContaining({ httpOnly: true, sameSite: "strict", path: "/" }),
    );
    expect(store.delete).not.toHaveBeenCalled();
  });

  it("G3-B2/D1B-4: NO cookie → unchanged create path + cookie attributes, rotate never called", async () => {
    const store = mockCookieStore(undefined);
    vi.mocked(createWebSession).mockResolvedValue("session-id");

    const { csrfToken } = await issueSession("acc-1");

    expect(typeof csrfToken).toBe("string");
    expect(rotateWebSession).not.toHaveBeenCalled();
    expect(createWebSession).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ accountId: "acc-1", ttlSeconds: expect.any(Number) }),
    );
    // D1B-4: the Strict session cookie attributes are UNCHANGED by this slice —
    // httpOnly/SameSite=Strict/path + maxAge + a secure flag, exactly as before.
    expect(store.set).toHaveBeenCalledWith(
      SESSION_COOKIE,
      expect.any(String),
      expect.objectContaining({
        httpOnly: true,
        sameSite: "strict",
        path: "/",
        maxAge: expect.any(Number),
        secure: expect.any(Boolean),
      }),
    );
    expect(store.delete).not.toHaveBeenCalled();
  });
});

/**
 * OAuth completion hop (auth-s4-d1b, M3). newHandoffToken mints the one-time
 * secret whose sha256 is the durable single-use fence; buildCompletionLanding is
 * the FIRST-PARTY document that carries the raw token in a same-origin POST — a
 * committed document (probe M2..M5), never a bare 302 (probe M1, which withheld
 * the Strict cookie on all three engines).
 */
describe("newHandoffToken", () => {
  it("mints a base64url token whose sha256 is its stored hash, and is unique per call", () => {
    const a = newHandoffToken();
    const b = newHandoffToken();
    expect(a.token).toMatch(/^[A-Za-z0-9_-]+$/); // base64url, no HTML-significant chars
    expect(a.tokenHash).toBe(hashToken(a.token)); // stored hash == sha256(raw)
    expect(a.token).not.toBe(b.token); // fresh entropy each call
    expect(a.tokenHash).not.toBe(b.tokenHash);
  });
});

describe("buildCompletionLanding (M3 first-party landing)", () => {
  it("is a first-party document that auto-submits a same-origin POST carrying the handoff, with a no-JS fallback", () => {
    const { body, headers } = buildCompletionLanding("HANDOFF-TOKEN-123");

    // Same-origin POST form to the completion endpoint, carrying the raw token.
    expect(body).toContain(`method="POST"`);
    expect(body).toContain(`action="${COMPLETION_PATH}"`);
    expect(body).toContain(`name="${HANDOFF_FIELD}"`);
    expect(body).toContain(`value="HANDOFF-TOKEN-123"`);
    // Auto-submit (M3) AND a <noscript> "Continue" fallback (M5, measured to
    // carry Strict) so a no-JS browser can still complete.
    expect(body).toMatch(/<script nonce="[^"]+">[^<]*\.submit\(\)<\/script>/);
    expect(body).toContain("<noscript>");
    expect(body).toMatch(/<button[^>]*type="submit"/);
    expect(headers["content-type"]).toBe("text/html; charset=utf-8");
  });

  it("locks the document down: nonce-only CSP (matching the one script), DENY framing, no-referrer, no-store", () => {
    const { body, headers } = buildCompletionLanding("tok");

    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("no-referrer");
    expect(headers["cache-control"]).toBe("no-store");
    const csp = headers["content-security-policy"];
    // Narrowing GUARD, not a suppression: a missing CSP header becomes a named failure here rather
    // than an incidental throw inside the first toContain. Strengthens the assertion and satisfies
    // the compiler for the .match() below, without a cast or a non-null assertion.
    if (typeof csp !== "string") throw new Error("content-security-policy header is missing");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    // The CSP nonce MUST equal the one on the inline auto-submit script, else the
    // browser blocks it and the hop silently dies.
    const cspNonce = csp.match(/script-src 'nonce-([^']+)'/)?.[1];
    const scriptNonce = body.match(/<script nonce="([^"]+)"/)?.[1];
    expect(cspNonce).toBeTruthy();
    expect(scriptNonce).toBe(cspNonce);
  });

  it("HTML-escapes the token so it cannot break out of the value attribute", () => {
    const { body } = buildCompletionLanding(`a<b>"&'`);
    expect(body).toContain(`value="a&lt;b&gt;&quot;&amp;&#39;"`);
    expect(body).not.toContain(`value="a<b>`);
  });
});

/**
 * Audit 2026-09-06 W-6 — cookie prefixes. `__Host-` is a browser-enforced contract (Secure, no
 * Domain, Path=/) that makes a sibling-subdomain overwrite of the session cookie impossible. It
 * is only usable where the cookie is Secure, i.e. production; dev/test over plain http keep the
 * bare name. The shape is pinned through the pure helper because NODE_ENV cannot be flipped
 * mid-test for the module-load constant.
 */
describe("session cookie name (audit W-6)", () => {
  it("carries the __Host- prefix when secure and the bare name otherwise", () => {
    expect(sessionCookieName(true)).toBe("__Host-plx_session");
    expect(sessionCookieName(false)).toBe("plx_session");
  });

  it("the module constant is the non-secure name under the test runtime (NODE_ENV != production)", () => {
    expect(process.env.NODE_ENV).not.toBe("production");
    expect(SESSION_COOKIE).toBe("plx_session");
  });
});

/**
 * Audit 2026-09-06 W-7 — csrfOk compares in constant time. Behaviour is unchanged (equal → true,
 * anything else → false); the property under test is that a length mismatch or a missing header
 * cannot reach timingSafeEqual (which throws on unequal lengths) and still returns false.
 */
describe("csrfOk (audit W-7 — constant-time compare)", () => {
  const session = {
    sessionId: "s",
    accountId: "a",
    personId: "p",
    csrfSecret: "secret-value-1234567890",
    expiresAt: new Date(Date.now() + 60_000),
  };
  const req = (header?: string) =>
    new Request("https://plexco.app/x", {
      headers: header === undefined ? {} : { "x-csrf-token": header },
    });

  it("accepts the exact secret", () => {
    expect(csrfOk(req("secret-value-1234567890"), session)).toBe(true);
  });
  it("rejects a missing, empty, shorter, longer, or same-length-different header without throwing", () => {
    expect(csrfOk(req(), session)).toBe(false);
    expect(csrfOk(req(""), session)).toBe(false);
    expect(csrfOk(req("secret"), session)).toBe(false);
    expect(csrfOk(req("secret-value-1234567890-extra"), session)).toBe(false);
    expect(csrfOk(req("secret-value-1234567891"), session)).toBe(false);
  });
});

/**
 * Audit 2026-09-06 W-4 (HR5) — the landing is a pre-tenant surface (DD-118 bucket b): it answers in
 * the default language through t(), and follows the request language context when one is set,
 * instead of hard-coding English outside t().
 */
describe("buildCompletionLanding — language (audit W-4)", () => {
  it("defaults to Vietnamese: lang=vi, Vietnamese title and Continue button", () => {
    const { body } = buildCompletionLanding("tok");
    expect(body).toContain(`<html lang="vi">`);
    expect(body).toContain("<title>Đang đăng nhập…</title>");
    expect(body).toContain(">Tiếp tục</button>");
    expect(body).not.toContain("Signing you in");
  });

  it("renders English under an English language context, through the same seam", () => {
    const { body } = runWithLang("en", () => buildCompletionLanding("tok"));
    expect(body).toContain(`<html lang="en">`);
    expect(body).toContain("<title>Signing you in…</title>");
    expect(body).toContain(">Continue</button>");
  });
});

/**
 * Audit 2026-09-06 W-10 — the runtime database role is asserted once when DB_EXPECTED_ROLE is set;
 * a mismatch poisons the handle so every later appDb() fails closed. Exercised through the
 * exported check with a fake pool (the real pool needs Postgres).
 */
describe("assertRuntimeDbRole (audit W-10)", () => {
  afterEach(() => resetDbRoleViolationForTests());

  const fakePool = (row: { u: string; s: string } | Error) => ({
    pool: {
      query: vi.fn(async () => {
        if (row instanceof Error) throw row;
        return { rows: [row] };
      }),
    },
  });

  it("passes when both current_user and session_user are the expected role", async () => {
    expect(await assertRuntimeDbRole(fakePool({ u: "app", s: "app" }) as never, "app")).toBe(true);
  });

  it("fails when the connection is the superuser/owner, or a SET ROLE from another login", async () => {
    expect(await assertRuntimeDbRole(fakePool({ u: "plexco", s: "plexco" }) as never, "app")).toBe(
      false,
    );
    expect(await assertRuntimeDbRole(fakePool({ u: "app", s: "plexco" }) as never, "app")).toBe(
      false,
    );
  });

  it("fails closed when the check itself cannot run", async () => {
    expect(await assertRuntimeDbRole(fakePool(new Error("pg down")) as never, "app")).toBe(false);
  });

  /**
   * The check is worth nothing if traffic can outrun it. Before the gate, appDb() fired the
   * assertion with `void` and handed back a live 10-connection pool in the same tick, so the
   * first business queries could run on other connections and return unscoped rows while the
   * check was still in flight — against exactly the misconfiguration (owner/superuser URL, every
   * RLS policy off) it exists to catch. This drives appDb() with a pool whose role answer is
   * deferred, and proves no business query reaches the database before the verdict does.
   */
  it("appDb GATES every query on the role check: nothing reaches the database before the verdict, and a mismatch rejects", async () => {
    const reached: string[] = [];
    let answerRole!: (row: { u: string; s: string }) => void;
    const roleAnswer = new Promise<{ u: string; s: string }>((resolve) => {
      answerRole = resolve;
    });
    const poolQuery = vi.fn(async (sql: unknown) => {
      if (String(sql).includes("current_user")) {
        reached.push("role-check");
        return { rows: [await roleAnswer] };
      }
      reached.push("business-query");
      return { rows: [{ secret: "unscoped tenant data" }] };
    });
    vi.mocked(createDb).mockReturnValueOnce({
      pool: { query: poolQuery, connect: vi.fn() },
      db: {},
      close: vi.fn(),
    } as never);
    const prevUrl = process.env.DATABASE_URL;
    const prevRole = process.env.DB_EXPECTED_ROLE;
    process.env.DATABASE_URL = "postgres://app@localhost/plexco";
    process.env.DB_EXPECTED_ROLE = "app";
    try {
      const handle = appDb();
      const business = handle.pool.query("SELECT * FROM sessions");
      await new Promise((r) => setTimeout(r, 20));
      expect(reached).toEqual(["role-check"]); // the business query has NOT hit the database

      answerRole({ u: "plexco", s: "plexco" }); // owner role — the misconfiguration W-10 is about
      await expect(business).rejects.toThrow(/refusing to serve with the wrong database role/);
      expect(reached).toEqual(["role-check"]); // and it never hit the database at all
      expect(() => appDb()).toThrow(/refusing to serve/);
    } finally {
      process.env.DATABASE_URL = prevUrl;
      process.env.DB_EXPECTED_ROLE = prevRole;
    }
  });
});

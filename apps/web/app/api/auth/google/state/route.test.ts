import { randomBytes } from "node:crypto";
import { rateLimitCheck } from "@plexco/db";
import { cookies } from "next/headers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { captureSignInLog } from "../../../../../lib/log-capture.testkit";
import * as oauthTxn from "../../../../../lib/oauth-transaction";
import { GET } from "./route";

vi.mock("@plexco/db", () => ({
  createDb: vi.fn(() => ({ pool: {} })),
  rateLimitCheck: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

// Partial mock: keep the REAL PKCE crypto + Lax cookie so the attributes and
// ordering are exercised end-to-end; stub ONLY the DB write.
vi.mock("../../../../../lib/oauth-transaction", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../../lib/oauth-transaction")>();
  return { ...actual, issueOauthTransaction: vi.fn() };
});

process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
process.env.TRUSTED_INGRESS_PROVIDER = "digitalocean";
process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client.apps.googleusercontent.com";
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-secret";
process.env.APP_BASE_URL = "https://plexco.app";
// resolveAuthSecretKey (real) needs a >= 32-byte base64 key for the PKCE cipher.
process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");

function mockCookieStore() {
  const store = { get: vi.fn(), set: vi.fn(), delete: vi.fn() };
  vi.mocked(cookies).mockResolvedValue(store as never);
  return store;
}

function reqFrom(ip: string): Request {
  return new Request("https://plexco.app/api/auth/google/state", {
    headers: { "do-connecting-ip": ip },
  });
}

const REQUEST_ID = /^req_[0-9a-f-]{36}$/; // A-13: the id withRequestLogContext mints
const FAKES = ["203.0.113.68", "FAKE-STATE-COOKIE-L68"]; // L68 D7 seeds: a client IP, a state cookie
const captureLog = captureSignInLog(FAKES, REQUEST_ID); // L68 D7

describe("GET /api/auth/google/state (D1-1)", () => {
  beforeEach(() => {
    vi.mocked(rateLimitCheck).mockReset();
    vi.mocked(oauthTxn.issueOauthTransaction).mockReset().mockResolvedValue(undefined);
  });

  it("D1-1: under the limit — stores the transaction row + a Lax path-scoped cookie, redirects to Google", async () => {
    const store = mockCookieStore();
    vi.mocked(rateLimitCheck).mockResolvedValue(true); // allowed

    const res = await GET(reqFrom("1.2.3.4"));

    // shared oauth-state trusted-IP bucket, 10/min.
    expect(rateLimitCheck).toHaveBeenCalledWith(expect.anything(), "oauth-state:1.2.3.4", 10, 60);
    expect(oauthTxn.issueOauthTransaction).toHaveBeenCalledOnce();
    // provider-scoped SameSite=Lax cookie at the exact callback path (NOT Strict).
    expect(store.set).toHaveBeenCalledWith(
      "plx_oauth_google",
      expect.any(String),
      expect.objectContaining({
        sameSite: "lax",
        path: "/api/auth/google/callback",
        httpOnly: true,
      }),
    );
    // 302 to Google with S256 PKCE + state + nonce.
    expect(res.status).toBe(302);
    expect(res.headers.get("x-request-id")).toMatch(REQUEST_ID); // A-13
    const loc = res.headers.get("location") ?? "";
    expect(loc).toContain("https://accounts.google.com/o/oauth2/v2/auth");
    expect(loc).toContain("code_challenge_method=S256");
    expect(loc).toContain("code_challenge=");
    expect(loc).toContain("nonce=");
    expect(loc).toContain("state=");
  });

  it("D1-1: the 11th attempt (over the limit) → 429 and creates NEITHER a row NOR a cookie", async () => {
    const store = mockCookieStore();
    vi.mocked(rateLimitCheck).mockResolvedValue(false); // over limit

    const res = await GET(reqFrom("9.9.9.9"));

    expect(res.status).toBe(429);
    expect(oauthTxn.issueOauthTransaction).not.toHaveBeenCalled();
    expect(store.set).not.toHaveBeenCalled();
  });

  it("D1-1: the bucket is per trusted-IP (one attacker cannot spend another's budget)", async () => {
    mockCookieStore();
    vi.mocked(rateLimitCheck).mockResolvedValue(true);

    await GET(reqFrom("1.1.1.1"));
    await GET(reqFrom("2.2.2.2"));

    expect(rateLimitCheck).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      "oauth-state:1.1.1.1",
      10,
      60,
    );
    expect(rateLimitCheck).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      "oauth-state:2.2.2.2",
      10,
      60,
    );
  });

  it("returns 503 when Google is not configured (no client id)", async () => {
    mockCookieStore();
    vi.mocked(rateLimitCheck).mockResolvedValue(true);
    const prev = process.env.GOOGLE_OAUTH_CLIENT_ID;
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;

    const res = await GET(reqFrom("3.3.3.3"));

    expect(res.status).toBe(503);
    expect(oauthTxn.issueOauthTransaction).not.toHaveBeenCalled();
    process.env.GOOGLE_OAUTH_CLIENT_ID = prev;
  });

  it("returns 503 on PARTIAL config (client secret missing) — no state, no redirect (codex round-03 [P2])", async () => {
    const store = mockCookieStore();
    vi.mocked(rateLimitCheck).mockResolvedValue(true);
    const prev = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;

    const res = await GET(reqFrom("3.3.3.4"));

    // must fail BEFORE creating a transaction/cookie and leaving for Google.
    expect(res.status).toBe(503);
    expect(oauthTxn.issueOauthTransaction).not.toHaveBeenCalled();
    expect(store.set).not.toHaveBeenCalled();
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = prev;
  });

  it("D1-1: still redirects when the deployed auth secret is LONGER than 32 bytes (codex round-02 [P1])", async () => {
    const store = mockCookieStore();
    vi.mocked(rateLimitCheck).mockResolvedValue(true);
    const { __resetAuthSecretCacheForTest } = await import("../../../../../lib/auth-secrets");
    const prev = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = randomBytes(64).toString("base64"); // 64-byte secret
    __resetAuthSecretCacheForTest();

    const res = await GET(reqFrom("4.4.4.4"));

    // Before the HKDF fix the raw 64-byte key hit encryptPkceVerifier's exact-32
    // guard and threw, 500-ing every state request. Now it redirects normally.
    expect(res.status).toBe(302);
    expect(oauthTxn.issueOauthTransaction).toHaveBeenCalledOnce();
    expect(store.set).toHaveBeenCalled();

    process.env.ENCRYPTION_KEY = prev;
    __resetAuthSecretCacheForTest();
  });

  // L68 D7: the swallowed limiter error is logged by class only, at the default and debug level.
  it.each(["", "debug"])(
    "fails closed to 429 when the rate-limit store is unavailable (codex round-06 [P2]), logged by class only (LOG_LEVEL %j)",
    async (logLevel) => {
      const store = mockCookieStore();
      vi.mocked(rateLimitCheck).mockRejectedValue(
        Object.assign(new Error(`rate-limit store down ${FAKES.join(" ")}`), {
          code: "ECONNREFUSED",
        }),
      );

      const { res, line } = await captureLog(
        logLevel,
        "warn",
        "auth.google.state.limiter_unavailable",
        () => GET(reqFrom("203.0.113.68")),
      );

      expect(res.status).toBe(429); // bounded response, not a Next 500
      expect(oauthTxn.issueOauthTransaction).not.toHaveBeenCalled();
      expect(store.set).not.toHaveBeenCalled();
      expect(line.error).toEqual({ name: "Error", code: "ECONNREFUSED" }); // no message/stack
    },
  );
});

/**
 * Audit 2026-09-06 W-9 — a cross-site page cannot spend the victim's bucket or overwrite the
 * binding cookie through `<img src>`: a non-navigation Sec-Fetch-Dest is refused BEFORE the
 * limiter, the row, and the cookie. Absent header (old browsers) still passes — defence in depth.
 */
describe("GET /api/auth/google/state — fetch-metadata gate (audit W-9)", () => {
  beforeEach(() => {
    vi.mocked(rateLimitCheck).mockReset().mockResolvedValue(true);
    vi.mocked(oauthTxn.issueOauthTransaction).mockReset().mockResolvedValue(undefined);
  });

  function reqWithDest(dest: string | null): Request {
    const headers: Record<string, string> = { "do-connecting-ip": "1.2.3.4" };
    if (dest !== null) headers["sec-fetch-dest"] = dest;
    return new Request("https://plexco.app/api/auth/google/state", { headers });
  }

  it("refuses image/script/iframe/empty fetches with 403 and touches NOTHING (no limiter, no row, no cookie)", async () => {
    const store = mockCookieStore();
    for (const dest of ["image", "script", "iframe", "empty", "object"]) {
      const res = await GET(reqWithDest(dest));
      expect(res.status, dest).toBe(403);
      expect(res.headers.get("x-request-id"), dest).toMatch(REQUEST_ID); // A-13
    }
    expect(rateLimitCheck).not.toHaveBeenCalled();
    expect(oauthTxn.issueOauthTransaction).not.toHaveBeenCalled();
    expect(store.set).not.toHaveBeenCalled();
  });

  it("serves a top-level navigation (Sec-Fetch-Dest: document) and a header-less request", async () => {
    mockCookieStore();
    for (const dest of ["document", "Document", null]) {
      const res = await GET(reqWithDest(dest));
      expect(res.status, String(dest)).toBe(302);
    }
    expect(oauthTxn.issueOauthTransaction).toHaveBeenCalledTimes(3);
  });
});

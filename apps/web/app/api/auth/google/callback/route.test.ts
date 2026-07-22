import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { rateLimitCheck } from "@plexco/db";
import { cookies } from "next/headers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as db from "@plexco/db";
import * as oidc from "../../../../../lib/google-oidc";
import * as oauthTxn from "../../../../../lib/oauth-transaction";
import * as session from "../../../../../lib/session-cookies";
import { GET } from "./route";
import { GET as stateGET } from "../state/route";

vi.mock("@plexco/db", () => ({
  createDb: vi.fn(() => ({ pool: {} })),
  rateLimitCheck: vi.fn(),
  deriveEmailArtifacts: vi.fn(),
  InvalidEmailError: class InvalidEmailError extends Error {},
}));

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

// Keep the REAL sha256Hex + cookie read/clear; stub the DB wrappers + decrypt.
vi.mock("../../../../../lib/oauth-transaction", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../../lib/oauth-transaction")>();
  return {
    ...actual,
    issueOauthTransaction: vi.fn(),
    claimOauthTransaction: vi.fn(),
    loginGoogle: vi.fn(),
    decryptPkceVerifier: vi.fn(),
  };
});

// Keep buildGoogleAuthorizeUrl real; stub exchange + proof.
vi.mock("../../../../../lib/google-oidc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../../lib/google-oidc")>();
  return { ...actual, exchangeGoogleCode: vi.fn(), verifyGoogleIdToken: vi.fn() };
});

// Keep the real clientIp/rateLimited/appDb (drive the limiter via rateLimitCheck);
// stub only issueSession. SessionReauthRequiredError stays the real class.
vi.mock("../../../../../lib/session-cookies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../../lib/session-cookies")>();
  return { ...actual, issueSession: vi.fn() };
});

process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
process.env.TRUSTED_INGRESS_PROVIDER = "digitalocean";
process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client.apps.googleusercontent.com";
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-secret";
process.env.APP_BASE_URL = "https://plexco.app";
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

// `null` = no binding cookie present. (Do NOT use `undefined` — passing it as an
// arg would trigger the default parameter and quietly restore the cookie.)
function mockCookieStore(value: string | null = "st.bd") {
  const store = {
    get: vi.fn().mockReturnValue(value === null ? undefined : { value }),
    set: vi.fn(),
    delete: vi.fn(),
  };
  vi.mocked(cookies).mockResolvedValue(store as never);
  return store;
}

/** Wire every downstream step to succeed; individual tests override one. */
function happyPath(outcome: "login_success" | "identity_conflict" = "login_success") {
  vi.mocked(rateLimitCheck).mockResolvedValue(true); // under the limit
  vi.mocked(oauthTxn.claimOauthTransaction).mockResolvedValue({
    nonceHash: "nh",
    pkceVerifierEnc: Buffer.from([1, 2, 3, 4]),
    kmsKeyVersion: "kv",
  });
  vi.mocked(oauthTxn.decryptPkceVerifier).mockReturnValue("verifier");
  vi.mocked(oidc.exchangeGoogleCode).mockResolvedValue("id-token");
  vi.mocked(oidc.verifyGoogleIdToken).mockResolvedValue({
    ok: true,
    subject: "sub-1",
    email: "u@example.com",
  });
  vi.mocked(db.deriveEmailArtifacts).mockReturnValue({
    canonicalEmail: "u@example.com",
    emailLookupHash: "elh",
    emailEnc: Buffer.from([9]),
    kmsKeyVersion: "kv",
  });
  vi.mocked(oauthTxn.loginGoogle).mockResolvedValue({
    accountId: "acc-1",
    personId: "p-1",
    outcome,
  });
  vi.mocked(session.issueSession).mockResolvedValue({ csrfToken: "csrf" });
}

/** Cross-site GET back from Google — NO Origin/Referer header on purpose. */
function callbackReq(
  ip: string,
  opts: { state?: string | null; code?: string | null } = {},
): Request {
  const u = new URL("https://plexco.app/api/auth/google/callback");
  const state = opts.state === undefined ? "st" : opts.state;
  const code = opts.code === undefined ? "abc" : opts.code;
  if (state !== null) u.searchParams.set("state", state);
  if (code !== null) u.searchParams.set("code", code);
  return new Request(u, { headers: { "do-connecting-ip": ip } });
}

beforeEach(() => {
  vi.mocked(rateLimitCheck).mockReset();
  vi.mocked(oauthTxn.claimOauthTransaction).mockReset();
  vi.mocked(oauthTxn.loginGoogle).mockReset();
  vi.mocked(oauthTxn.decryptPkceVerifier).mockReset();
  vi.mocked(oauthTxn.issueOauthTransaction).mockReset().mockResolvedValue(undefined);
  vi.mocked(oidc.exchangeGoogleCode).mockReset();
  vi.mocked(oidc.verifyGoogleIdToken).mockReset();
  vi.mocked(db.deriveEmailArtifacts).mockReset();
  vi.mocked(session.issueSession).mockReset();
});

describe("GET /api/auth/google/callback", () => {
  it("D1-13: a cross-site GET succeeds regardless of Origin — NO same-origin gate; mints a Strict session, redirects home", async () => {
    const store = mockCookieStore("st.bd");
    happyPath("login_success");

    // (a) the real provider redirect carries NO Origin/Referer at all.
    const res = await GET(callbackReq("1.2.3.4"));
    expect(session.issueSession).toHaveBeenCalledWith("acc-1"); // THE Strict session issuer
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://plexco.app/");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    // on a state MATCH the binding cookie is consumed (single-use).
    expect(store.delete).toHaveBeenCalled();

    // (b) even a HOSTILE cross-site Origin passes — a `sameOriginRequest()` gate
    // (which the Telegram callback DOES use) would reject this; this route must
    // not, because browser continuity is proven by the binding cookie + claim.
    vi.mocked(session.issueSession).mockClear();
    const hostile = new Request("https://plexco.app/api/auth/google/callback?state=st&code=abc", {
      headers: { "do-connecting-ip": "1.2.3.4", origin: "https://evil.example.com" },
    });
    const res2 = await GET(hostile);
    expect(session.issueSession).toHaveBeenCalledWith("acc-1");
    expect(res2.status).toBe(302);
  });

  it("D1-4: a MISSING binding cookie rejects and never claims the transaction", async () => {
    mockCookieStore(null); // no cookie
    happyPath();

    const res = await GET(callbackReq("1.2.3.4"));

    expect(oauthTxn.claimOauthTransaction).not.toHaveBeenCalled();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/?auth_error=AUTH_INVALID");
  });

  it("D1-4: a query state that does NOT match the cookie state rejects, no claim, and PRESERVES the cookie (codex round-03 [P2])", async () => {
    const store = mockCookieStore("DIFFERENT.bd"); // cookie state != query state "st"
    happyPath();

    const res = await GET(callbackReq("1.2.3.4", { state: "st" }));

    expect(oauthTxn.claimOauthTransaction).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toContain("/?auth_error=AUTH_INVALID");
    // a stale/foreign callback must NOT cancel the in-progress flow's binding.
    expect(store.delete).not.toHaveBeenCalled();
  });

  it("D1-3: a replayed/expired claim (zero rows → null) rejects and never runs the finalizer", async () => {
    mockCookieStore("st.bd");
    happyPath();
    vi.mocked(oauthTxn.claimOauthTransaction).mockResolvedValue(null); // single-use already spent

    const res = await GET(callbackReq("1.2.3.4"));

    expect(oauthTxn.loginGoogle).not.toHaveBeenCalled();
    expect(session.issueSession).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toContain("/?auth_error=AUTH_INVALID");
  });

  it("D1-5: a proof-matrix failure rejects BEFORE the DB — the finalizer never runs (cell 8, no audit)", async () => {
    mockCookieStore("st.bd");
    happyPath();
    vi.mocked(oidc.verifyGoogleIdToken).mockResolvedValue({ ok: false, reason: "AUTH_INVALID" });

    const res = await GET(callbackReq("1.2.3.4"));

    expect(oauthTxn.loginGoogle).not.toHaveBeenCalled();
    expect(session.issueSession).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toContain("/?auth_error=AUTH_INVALID");
  });

  it("D1-8: an identity_conflict fails closed to AUTH_IDENTITY_CONFLICT and mints NO session", async () => {
    mockCookieStore("st.bd");
    happyPath("identity_conflict");

    const res = await GET(callbackReq("1.2.3.4"));

    expect(oauthTxn.loginGoogle).toHaveBeenCalledOnce();
    expect(session.issueSession).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toContain("/?auth_error=AUTH_IDENTITY_CONFLICT");
  });

  it("D1-11: the callback bucket is INDEPENDENT of the state bucket (exhausting oauth-state leaves oauth-callback usable)", async () => {
    mockCookieStore("st.bd");
    happyPath("login_success");
    // Only the STATE bucket for this IP is exhausted; every other bucket is fine.
    vi.mocked(rateLimitCheck).mockImplementation(
      async (_pool, key) => key !== "oauth-state:5.5.5.5",
    );

    const stateRes = await stateGET(
      new Request("https://plexco.app/api/auth/google/state", {
        headers: { "do-connecting-ip": "5.5.5.5" },
      }),
    );
    expect(stateRes.status).toBe(429); // state bucket spent

    const cbRes = await GET(callbackReq("5.5.5.5"));
    expect(rateLimitCheck).toHaveBeenCalledWith(
      expect.anything(),
      "oauth-callback:5.5.5.5",
      10,
      60,
    );
    expect(cbRes.status).toBe(302); // callback's own bucket is untouched — flow completes
  });

  it("maps the issuance fence (SessionReauthRequiredError) to a generic reject, no reason leaked", async () => {
    mockCookieStore("st.bd");
    happyPath("login_success");
    vi.mocked(session.issueSession).mockRejectedValue(new session.SessionReauthRequiredError());

    const res = await GET(callbackReq("1.2.3.4"));

    const loc = res.headers.get("location") ?? "";
    expect(loc).toContain("/?auth_error=AUTH_INVALID");
    expect(loc.toLowerCase()).not.toContain("reauth");
  });

  it("returns 503 when Google is not configured (no client secret)", async () => {
    mockCookieStore("st.bd");
    happyPath();
    const prev = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;

    const res = await GET(callbackReq("1.2.3.4"));

    expect(res.status).toBe(503);
    expect(oauthTxn.claimOauthTransaction).not.toHaveBeenCalled();
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = prev;
  });

  it("an unexpected dependency failure still carries the no-referrer leakage fence (never a bare 500)", async () => {
    mockCookieStore("st.bd");
    happyPath();
    // the rate-limit store throws — the handler exits before its own fences.
    vi.mocked(rateLimitCheck).mockRejectedValue(new Error("rate-limit store down"));

    const res = await GET(callbackReq("1.2.3.4"));

    expect(res.status).toBe(302); // fail closed, not a Next 500
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("location")).toContain("auth_error=");
  });
});

describe("negative scope (absence checks)", () => {
  it("D1-14: the Telegram callback route is untouched — still present", () => {
    expect(
      existsSync(fileURLToPath(new URL("../../telegram/callback/route.ts", import.meta.url))),
    ).toBe(true);
    expect(
      existsSync(fileURLToPath(new URL("../../telegram/state/route.ts", import.meta.url))),
    ).toBe(true);
  });

  it("D1-15: NO Facebook adapter routes exist in D1 (order-3 negative scope)", () => {
    expect(existsSync(fileURLToPath(new URL("../../facebook", import.meta.url)))).toBe(false);
  });
});

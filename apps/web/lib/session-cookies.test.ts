import { createWebSession, rotateWebSession } from "@plexco/db";
import { cookies } from "next/headers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildCompletionLanding,
  clientIp,
  COMPLETION_PATH,
  HANDOFF_FIELD,
  hashToken,
  issueSession,
  newHandoffToken,
  sameOriginRequest,
  SESSION_COOKIE,
  SessionReauthRequiredError,
  trustedIngressProvider,
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
  return new Request("https://plexco.app/api/auth/telegram", { method: "POST", headers });
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
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  });

  it("in production, rejects a same-host Origin over the WRONG scheme", () => {
    process.env.NODE_ENV = "production";
    expect(sameOriginRequest(reqWith({ host: "plexco.app", origin: "http://plexco.app" }))).toBe(
      false,
    );
  });

  it("in production, still accepts a same-host Origin over https", () => {
    process.env.NODE_ENV = "production";
    expect(sameOriginRequest(reqWith({ host: "plexco.app", origin: "https://plexco.app" }))).toBe(
      true,
    );
  });

  it("in production, rejects a same-host Referer over the WRONG scheme", () => {
    process.env.NODE_ENV = "production";
    expect(
      sameOriginRequest(reqWith({ host: "plexco.app", referer: "http://plexco.app/login" })),
    ).toBe(false);
  });

  it("outside production, scheme is not enforced (local dev commonly runs plain http)", () => {
    process.env.NODE_ENV = "test";
    expect(sameOriginRequest(reqWith({ host: "plexco.app", origin: "http://plexco.app" }))).toBe(
      true,
    );
  });
});

describe("clientIp — provider-pinned trusted ingress", () => {
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
  const ORIGINAL_PROVIDER = process.env.TRUSTED_INGRESS_PROVIDER;

  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    if (ORIGINAL_PROVIDER === undefined) delete process.env.TRUSTED_INGRESS_PROVIDER;
    else process.env.TRUSTED_INGRESS_PROVIDER = ORIGINAL_PROVIDER;
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
    process.env.NODE_ENV = "production";
    delete process.env.TRUSTED_INGRESS_PROVIDER;

    expect(() => trustedIngressProvider()).toThrow("TRUSTED_INGRESS_PROVIDER");
  });

  it("forbids direct mode in production", () => {
    process.env.NODE_ENV = "production";
    process.env.TRUSTED_INGRESS_PROVIDER = "direct";

    expect(() => trustedIngressProvider()).toThrow("forbidden in production");
  });

  it("rejects an unsupported provider instead of silently falling back", () => {
    process.env.NODE_ENV = "test";
    process.env.TRUSTED_INGRESS_PROVIDER = "unknown-edge";

    expect(() => trustedIngressProvider()).toThrow("TRUSTED_INGRESS_PROVIDER");
  });

  it("reads the explicit production provider", () => {
    process.env.NODE_ENV = "production";
    process.env.TRUSTED_INGRESS_PROVIDER = "digitalocean";

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
    expect(store.delete).toHaveBeenCalledWith(SESSION_COOKIE); // cookie cleared
    expect(store.set).not.toHaveBeenCalled(); // no new cookie set
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

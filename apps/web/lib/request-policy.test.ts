import { describe, expect, it } from "vitest";
import {
  buildNonceCsp,
  cspNonceEnabled,
  DISCOVERY_PATH_ALLOWLIST,
  newNonce,
  noReferrer,
  parseProcessRole,
  pathAllowedForRole,
  redirect,
} from "./request-policy";

/** Audit 2026-09-06 W-10 — the discovery ingress must not serve the whole app. */
describe("pathAllowedForRole (audit W-10)", () => {
  it("web serves everything", () => {
    for (const p of ["/", "/api/sessions", "/api/auth/google/state", "/healthz", "/discover"]) {
      expect(pathAllowedForRole(p, "web")).toBe(true);
    }
  });

  it("discovery serves ONLY /healthz and /discover*", () => {
    expect(pathAllowedForRole("/healthz", "discovery")).toBe(true);
    expect(pathAllowedForRole("/discover", "discovery")).toBe(true);
    expect(pathAllowedForRole("/discover/abc", "discovery")).toBe(true);
    for (const p of [
      "/",
      "/api/sessions",
      "/api/auth/google/state",
      "/api/onboarding/start",
      "/healthz/",
      "/discoverx",
      "/api/discover",
    ]) {
      expect(pathAllowedForRole(p, "discovery"), p).toBe(false);
    }
  });

  it("the allowlist is exactly two anchored patterns (a third entry is a decision, not a drift)", () => {
    expect(DISCOVERY_PATH_ALLOWLIST).toHaveLength(2);
  });

  it("parseProcessRole fails closed to web (the surface-serving role) on junk, and recognises discovery/worker", () => {
    expect(parseProcessRole(undefined)).toBe("web");
    expect(parseProcessRole("")).toBe("web");
    expect(parseProcessRole("Discovery")).toBe("discovery");
    expect(parseProcessRole("worker")).toBe("worker");
    expect(parseProcessRole("nonsense")).toBe("web");
  });
});

/** backlog `web-csp-script-src-nonce` — flag-gated nonce policy. */
describe("CSP nonce policy (flag-gated)", () => {
  it('is enabled only by the exact string "true"', () => {
    expect(cspNonceEnabled("true")).toBe(true);
    for (const v of [undefined, "", "TRUE", "1", "yes", " true"])
      expect(cspNonceEnabled(v)).toBe(false);
  });

  it("the nonce policy keeps every floor directive from next.config.mjs and adds script-src", () => {
    const csp = buildNonceCsp("abc123");
    expect(csp).toMatch(/script-src 'nonce-abc123' 'strict-dynamic'/);
    for (const d of [
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ]) {
      expect(csp).toContain(d);
    }
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval|default-src/);
  });

  it("newNonce is base64 of 16 bytes and differs per call", () => {
    const a = newNonce();
    const b = newNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(a).not.toBe(b);
    expect(newNonce(new Uint8Array(16))).toBe("AAAAAAAAAAAAAAAAAAAAAA==");
  });
});

/**
 * Hoisted from the two Google OAuth routes (callback/route.ts, complete/route.ts) — was
 * duplicated byte-for-byte in both. Pins the exact response shape so the hoist is
 * behaviour-preserving: same status, same headers, same body.
 */
describe("redirect / noReferrer (hoisted OAuth 302 helpers)", () => {
  it("redirect() returns an empty-body 302 with Location and Referrer-Policy: no-referrer", async () => {
    const res = redirect("https://example.test/?auth_error=AUTH_INVALID");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://example.test/?auth_error=AUTH_INVALID");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(await res.text()).toBe("");
  });

  it("noReferrer() sets Referrer-Policy: no-referrer on an existing response without touching status or body", async () => {
    const original = new Response(JSON.stringify({ ok: true }), {
      status: 429,
      headers: { "content-type": "application/json" },
    });
    const res = noReferrer(original);
    expect(res).toBe(original);
    expect(res.status).toBe(429);
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.text()).toBe(JSON.stringify({ ok: true }));
  });
});

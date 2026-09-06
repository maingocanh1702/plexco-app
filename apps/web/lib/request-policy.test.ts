import { describe, expect, it } from "vitest";
import {
  buildNonceCsp,
  cspNonceEnabled,
  DISCOVERY_PATH_ALLOWLIST,
  newNonce,
  parseProcessRole,
  pathAllowedForRole,
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
  it("is enabled only by the exact string \"true\"", () => {
    expect(cspNonceEnabled("true")).toBe(true);
    for (const v of [undefined, "", "TRUE", "1", "yes", " true"]) expect(cspNonceEnabled(v)).toBe(false);
  });

  it("the nonce policy keeps every floor directive from next.config.mjs and adds script-src", () => {
    const csp = buildNonceCsp("abc123");
    expect(csp).toMatch(/script-src 'nonce-abc123' 'strict-dynamic'/);
    for (const d of ["frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", "object-src 'none'"]) {
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

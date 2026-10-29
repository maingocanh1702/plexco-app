import { describe, expect, it } from "vitest";
import nextConfig, { SECURITY_HEADERS } from "../next.config.mjs";

/**
 * Audit 2026-09-06 W-2: apps/web sent NO baseline security headers (no HSTS, no XFO, no
 * nosniff, no Referrer-Policy) — fly.toml force_https redirects but the app never told the
 * browser to stay on https, and only the OAuth landing built its own CSP. The headers now
 * come from `next.config.mjs` on every route, so this pins the config rather than a served
 * response (a served-response test needs `next start`, which the unit suite does not run).
 */
describe("next.config.mjs — baseline security headers (audit W-2)", () => {
  function header(name: string): string | undefined {
    return SECURITY_HEADERS.find((h) => h.key.toLowerCase() === name.toLowerCase())?.value;
  }

  it("applies the header set to EVERY path via headers(), then the share page's no-referrer + noindex entry AFTER it", async () => {
    const rules = await nextConfig.headers!();
    expect(rules).toHaveLength(2);
    expect(rules[0]!.source).toBe("/(.*)");
    expect(rules[0]!.headers).toBe(SECURITY_HEADERS);
    // Order is the contract: of two entries setting one key, the later one wins.
    expect(rules[1]).toEqual({
      source: "/session/:slug",
      headers: [
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
      ],
    });
  });

  it("HSTS: one year, includeSubDomains, no preload (preload is a registry submission, not a header choice)", () => {
    const hsts = header("Strict-Transport-Security");
    expect(hsts).toMatch(/max-age=31536000/);
    expect(hsts).toMatch(/includeSubDomains/);
    expect(hsts).not.toMatch(/preload/);
  });

  it("frames are denied twice: X-Frame-Options DENY and CSP frame-ancestors 'none'", () => {
    expect(header("X-Frame-Options")).toBe("DENY");
    expect(header("Content-Security-Policy")).toMatch(/frame-ancestors 'none'/);
  });

  it("nosniff + strict-origin-when-cross-origin referrer + a Permissions-Policy that turns the sensors off", () => {
    expect(header("X-Content-Type-Options")).toBe("nosniff");
    expect(header("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    const pp = header("Permissions-Policy") ?? "";
    for (const feature of ["camera=()", "microphone=()", "geolocation=()"]) {
      expect(pp).toContain(feature);
    }
  });

  it("CSP carries the nonce-free directives only: base-uri/form-action 'self', object-src 'none'; no unsafe-* and no wildcard", () => {
    const csp = header("Content-Security-Policy") ?? "";
    expect(csp).toMatch(/base-uri 'self'/);
    expect(csp).toMatch(/form-action 'self'/);
    expect(csp).toMatch(/object-src 'none'/);
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval|\*/);
  });

  // INTENDED, not an omission: the App Router bootstraps every page with inline
  // `self.__next_f.push(...)` scripts, so a global `default-src`/`script-src` without a
  // per-request nonce blocks rendering on every route — and the reflex fix ('unsafe-inline')
  // is worse than no directive. script-src arrives with the nonce middleware
  // (backlog `web-csp-script-src-nonce`); until then this test stops a well-meaning
  // "hardening" from shipping a broken app.
  it("CSP deliberately has NO default-src / script-src (App Router inline bootstrap needs a nonce first)", () => {
    const csp = header("Content-Security-Policy") ?? "";
    expect(csp).not.toMatch(/default-src/);
    expect(csp).not.toMatch(/script-src/);
  });

  it("the OAuth landing's own nonce CSP stays compatible with the global floor (same-origin form-action)", () => {
    // The landing auto-submits to /api/auth/google/complete on the SAME origin; even if a Next
    // version sent both policies, `form-action 'self'` admits it. Pin the intersection, not the
    // override mechanism.
    const csp = header("Content-Security-Policy") ?? "";
    expect(csp).toMatch(/form-action 'self'/);
    expect(csp).not.toMatch(/form-action 'none'/);
  });

  it("every header is set exactly once (a duplicate key would make the browser pick one at random)", () => {
    const keys = SECURITY_HEADERS.map((h) => h.key.toLowerCase());
    expect(new Set(keys).size).toBe(keys.length);
  });
});

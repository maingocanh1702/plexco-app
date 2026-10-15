import { runWithLang } from "@plexco/core/i18n";
import { describe, expect, it } from "vitest";
import { buildDevLoginDocument, normalizeDevLoginPageError } from "./page-document";
import { DEV_PERSONAS } from "./personas";

const TOKEN = "tok_abcdefghijklmnopqrstuvwxyz0123456789-_AB";

describe("buildDevLoginDocument", () => {
  it("is a self-contained form: DEV ONLY banner, one button per persona, the token in a hidden field", () => {
    const { body } = buildDevLoginDocument({ csrfToken: TOKEN, error: null });
    expect(body).toContain('<p class="banner" role="note">CHỈ DÀNH CHO DEV');
    expect(body).toContain('<form method="post" action="/api/dev/login">');
    expect(body).toContain(`<input type="hidden" name="csrf" value="${TOKEN}">`);
    for (const persona of DEV_PERSONAS) {
      expect(body).toContain(`<button type="submit" name="persona" value="${persona.key}">`);
      expect(persona.email.endsWith("@dev.invalid")).toBe(true);
    }
    expect(body.match(/<button /g)).toHaveLength(DEV_PERSONAS.length);
  });

  it("runs no script at all and nonces its only style; its own CSP allows nothing else", () => {
    const { body, headers } = buildDevLoginDocument({ csrfToken: TOKEN, error: null });
    expect(body).not.toMatch(/<script/i);
    const nonce = /<style nonce="([^"]+)">/.exec(body)?.[1];
    expect(nonce).toBeTruthy();
    expect(headers["content-security-policy"]).toBe(
      `default-src 'none'; style-src 'nonce-${nonce}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
    );
    expect(headers["cache-control"]).toBe("no-store");
    expect(headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(headers["x-frame-options"]).toBe("DENY");
  });

  it("speaks the request language through t(vi, en) — Vietnamese by default, English on request (DD-118 b)", () => {
    const vi = buildDevLoginDocument({ csrfToken: TOKEN, error: null }).body;
    expect(vi).toContain('<html lang="vi">');
    expect(vi).toContain("Đăng nhập bằng persona dev");
    const en = runWithLang(
      "en",
      () => buildDevLoginDocument({ csrfToken: TOKEN, error: null }).body,
    );
    expect(en).toContain('<html lang="en">');
    expect(en).toContain("DEV ONLY: this page exists only on a local dev server");
    expect(en).toContain("Sign in as a dev persona");
    expect(en).not.toContain("Đăng nhập bằng persona dev");
  });

  it("escapes the token and never reflects an unknown error value", () => {
    const { body } = buildDevLoginDocument({ csrfToken: '"><script>x</script>', error: null });
    expect(body).toContain('value="&quot;&gt;&lt;script&gt;x&lt;/script&gt;"');
    expect(body).not.toMatch(/<script/i);
    expect(normalizeDevLoginPageError("<img src=x onerror=alert(1)>")).toBeNull();
    expect(normalizeDevLoginPageError("reauth")).toBe("reauth");
    expect(normalizeDevLoginPageError("unavailable")).toBe("unavailable");
    expect(normalizeDevLoginPageError(null)).toBeNull();
  });

  it("announces a known error with role=alert", () => {
    const { body } = buildDevLoginDocument({ csrfToken: TOKEN, error: "reauth" });
    expect(body).toMatch(/<p class="error" role="alert">Phiên đăng nhập cũ không còn hợp lệ/);
  });
});

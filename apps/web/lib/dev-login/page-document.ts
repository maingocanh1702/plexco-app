import { getLang, t } from "@plexco/core/i18n";
import { DEV_LOGIN_CSRF_FIELD } from "./csrf";
import { DEV_PERSONAS, DEV_CLUB, type DevPersonaKey } from "./personas";
import { DEV_LOGIN_API_PATH } from "./routing";

/**
 * The /dev-login document. Rendered by a route handler, like the OAuth completion landing
 * (lib/session-cookies.ts buildCompletionLanding), rather than a React page, because:
 *  - the double-submit CSRF cookie must be set in the SAME response that renders its token, and a
 *    server component cannot set cookies;
 *  - a route handler emits no client chunk under /_next/static and no RSC payload, so nothing about
 *    the page is served from anywhere but this gated handler.
 * Plain HTML form, no script at all, one inline <style>: it renders unchanged under the global
 * nonce-free CSP and under the CSP_SCRIPT_NONCE_ENABLED policy (neither sets style-src).
 *
 * Headers: only content-type, cache-control and x-robots-tag are set here. next.config.mjs
 * headers() apply to every path and REPLACE a route's own CSP, X-Frame-Options and Referrer-Policy
 * (measured under next dev), so this document is served with the global set: frame-ancestors
 * 'none', form-action 'self', X-Frame-Options DENY, Referrer-Policy
 * strict-origin-when-cross-origin. The last one matters: under `no-referrer` a browser form POST
 * carries `Origin: null` and sameOriginRequest() refuses the login.
 *
 * Pre-authentication surface, no tenant known: DD-118 bucket b, every string through t(vi, en) in
 * the request's (default Vietnamese) language.
 */

export type DevLoginPageError = "reauth" | "unavailable";

/** Closed set only: the raw query value is never reflected. */
export function normalizeDevLoginPageError(raw: string | null): DevLoginPageError | null {
  return raw === "reauth" || raw === "unavailable" ? raw : null;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function personaLabel(key: DevPersonaKey): string {
  switch (key) {
    case "owner":
      return t("Chủ CLB (owner, host)", "Club owner (owner, host)");
    case "co_admin":
      return t("Đồng quản trị (co_admin)", "Co-admin (co_admin)");
    case "player":
      return t("Người chơi (player, không có quyền quản trị)", "Player (player, no admin rights)");
  }
}

function errorMessage(error: DevLoginPageError): string {
  return error === "reauth"
    ? t(
        "Phiên đăng nhập cũ không còn hợp lệ và đã được xoá. Bấm lại persona để đăng nhập.",
        "Your previous session was no longer valid and has been cleared. Press the persona again to sign in.",
      )
    : t(
        "Đăng nhập dev thất bại. Xem log của dev server (thiếu ENCRYPTION_KEY hoặc database chưa sẵn sàng?).",
        "Dev login failed. Check the dev server log (missing ENCRYPTION_KEY or database not ready?).",
      );
}

const STYLE = [
  ":root{color-scheme:light dark;font-family:system-ui,-apple-system,'Segoe UI',sans-serif}",
  "body{margin:0;background:Canvas;color:CanvasText;line-height:1.5}",
  ".banner{margin:0;padding:12px 16px;background:#7f1d1d;color:#fff;font-weight:700;font-size:1.05rem}",
  "main{max-width:36rem;margin:0 auto;padding:24px 16px}",
  "fieldset{border:1px solid GrayText;border-radius:8px;padding:12px 16px}",
  "button{display:block;width:100%;margin:8px 0;padding:12px;font:inherit;font-weight:600;",
  "border:2px solid #1d4ed8;border-radius:8px;background:#1d4ed8;color:#fff;cursor:pointer}",
  "button:focus-visible{outline:3px solid #f59e0b;outline-offset:2px}",
  ".hint{font-size:.9rem}",
  ".error{padding:8px 12px;border:2px solid #b91c1c;border-radius:8px}",
  "code{font-family:ui-monospace,monospace}",
].join("");

export function buildDevLoginDocument(input: {
  csrfToken: string;
  error: DevLoginPageError | null;
}): { body: string; headers: Record<string, string> } {
  const lang = getLang();
  const title = escapeHtml(t("Đăng nhập dev (chỉ local)", "Dev login (local only)"));
  const banner = escapeHtml(
    t(
      "CHỈ DÀNH CHO DEV: trang này chỉ tồn tại trên dev server local (next dev, localhost) và không bao giờ có trong bản build production.",
      "DEV ONLY: this page exists only on a local dev server (next dev, localhost) and is never part of a production build.",
    ),
  );
  const heading = escapeHtml(t("Đăng nhập bằng persona dev", "Sign in as a dev persona"));
  const intro = escapeHtml(
    t(
      `Chọn một persona do pnpm dev:seed tạo trong CLB "${DEV_CLUB.name}". Phiên đăng nhập đi đúng đường của Google sign-in: tài khoản, Person, rồi issueSession().`,
      `Pick a persona created by pnpm dev:seed in the club "${DEV_CLUB.name}". The session takes the same path as Google sign-in: account, Person, then issueSession().`,
    ),
  );
  const legend = escapeHtml(t("Persona", "Persona"));
  const fakeNote = escapeHtml(
    t(
      "Mọi persona là dữ liệu giả, email thuộc tên miền dành riêng .invalid.",
      "Every persona is fake data with an email on the reserved .invalid domain.",
    ),
  );
  const buttons = DEV_PERSONAS.map(
    (persona) =>
      `<button type="submit" name="persona" value="${escapeHtml(persona.key)}">` +
      `${escapeHtml(personaLabel(persona.key))}</button>` +
      `<p class="hint">${escapeHtml(persona.email)}</p>`,
  ).join("");
  const alert = input.error
    ? `<p class="error" role="alert">${escapeHtml(errorMessage(input.error))}</p>`
    : "";

  const body =
    `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta name="robots" content="noindex, nofollow">` +
    `<title>${title}</title><style>${STYLE}</style></head><body>` +
    `<p class="banner" role="note">${banner}</p>` +
    `<main><h1>${heading}</h1><p>${intro}</p>${alert}` +
    `<form method="post" action="${DEV_LOGIN_API_PATH}">` +
    `<input type="hidden" name="${DEV_LOGIN_CSRF_FIELD}" value="${escapeHtml(input.csrfToken)}">` +
    `<fieldset><legend>${legend}</legend>${buttons}</fieldset></form>` +
    `<p class="hint">${fakeNote}</p></main></body></html>`;

  const headers = {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "x-robots-tag": "noindex, nofollow",
  };
  return { body, headers };
}

import { randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { cookieSecure } from "../session-cookies";
import { DEV_LOGIN_API_ROUTE } from "./routing";

/**
 * CSRF for the dev-login POST. There is no session yet, so there is no session csrf_secret to echo
 * (csrfOk). Two checks, both required, and they are NOT equally strong:
 *  1. sameOriginRequest() — the existing helper the Google completion hop uses. The browser sets
 *     Origin (else Referer) and page script cannot forge it; it must name exactly this Host
 *     (scheme + host + port). `Origin: null` is refused. This is the check that carries the weight.
 *  2. a page-bound double-submit token: the dev-login page sets a random token in an HttpOnly,
 *     SameSite=Strict cookie scoped to the implementation POST path (the form posts to
 *     /api/dev/login, whose 307 re-sends it there) and renders the same token in a hidden field;
 *     the POST must carry both, equal (constant-time). It stops a cross-SITE page, which can neither
 *     read the token nor set a cookie for localhost. It does NOT stop a page served from another
 *     port of the same host (http://localhost:4000): cookies ignore the port, so such a page can
 *     overwrite plx_dev_login_csrf with a value it knows, post the matching field, and is
 *     same-site, so the Strict cookie rides along. Only check 1 refuses it, because its Origin
 *     names the other port.
 * The cookie is single-use: a successful login clears it.
 */
export const DEV_LOGIN_CSRF_COOKIE = "plx_dev_login_csrf";
export const DEV_LOGIN_CSRF_FIELD = "csrf";
export const DEV_LOGIN_CSRF_TTL_SECONDS = 30 * 60;

export function newDevLoginCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: "strict" as const,
    path: DEV_LOGIN_API_ROUTE,
    maxAge,
  };
}

export async function setDevLoginCsrfCookie(token: string): Promise<void> {
  (await cookies()).set(DEV_LOGIN_CSRF_COOKIE, token, cookieOptions(DEV_LOGIN_CSRF_TTL_SECONDS));
}

export async function readDevLoginCsrfCookie(): Promise<string | undefined> {
  return (await cookies()).get(DEV_LOGIN_CSRF_COOKIE)?.value;
}

/** Same attributes as the set, maxAge 0 (the prefix-free equivalent of clearSessionCookie). */
export async function clearDevLoginCsrfCookie(): Promise<void> {
  (await cookies()).set(DEV_LOGIN_CSRF_COOKIE, "", cookieOptions(0));
}

/** Both present, non-empty and equal, compared in constant time (length is not secret). */
export function devLoginCsrfTokensMatch(
  cookieValue: string | undefined,
  fieldValue: string | null,
): boolean {
  if (typeof cookieValue !== "string" || cookieValue.length === 0) return false;
  if (typeof fieldValue !== "string" || fieldValue.length === 0) return false;
  const a = Buffer.from(cookieValue, "utf8");
  const b = Buffer.from(fieldValue, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

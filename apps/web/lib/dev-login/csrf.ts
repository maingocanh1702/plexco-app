import { randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { cookieSecure } from "../session-cookies";
import { DEV_LOGIN_API_ROUTE } from "./routing";

/**
 * CSRF for the dev-login POST. There is no session yet, so there is no session csrf_secret to echo
 * (csrfOk). Two independent layers instead, both required:
 *  1. sameOriginRequest() — the existing helper the Google completion hop uses (Origin, else Referer,
 *     must name this Host);
 *  2. a page-bound double-submit token: the dev-login page sets a random token in an HttpOnly,
 *     SameSite=Strict cookie scoped to the implementation POST path (the form posts to
 *     /api/dev/login, whose 307 re-sends it there) AND renders the same token in a hidden field.
 *     The POST must carry both, equal (constant-time). A cross-site page can neither read the token
 *     nor make the browser send the Strict cookie.
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

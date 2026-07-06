import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { createDb, resolveWebSession, type DbHandle, type ResolvedSession } from "@plexco/db";

/**
 * Web session plumbing shared by the API routes.
 * Cookie carries the RAW token; the DB stores sha256(token) only. CSRF uses
 * the session's csrf_secret returned to the client at login — mutations must
 * echo it in the x-csrf-token header (secret never lives in a cookie).
 */

export const SESSION_COOKIE = "plx_session";
export const SESSION_TTL_SECONDS = 30 * 24 * 3600; // refresh-style single cookie for P4 shell

let handle: DbHandle | null = null;
/** App-role pool (RLS enforced); one per server process. */
export function appDb(): DbHandle {
  if (!handle) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    handle = createDb(url);
  }
  return handle;
}

export function newSessionToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function setSessionCookie(token: string): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function currentSession(): Promise<ResolvedSession | null> {
  const raw = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  return resolveWebSession(appDb().pool, hashToken(raw));
}

/**
 * Issue a session for the JUST-AUTHENTICATED / JUST-PRIVILEGED account: rotates
 * the live cookie when present (revoking it), else mints fresh; sets the new
 * cookie. THE single path for session issuance — every privilege transition
 * (login, tenant provisioning, future owner-assignment/tenant-switch) uses it.
 */
export async function issueSession(accountId: string): Promise<{ csrfToken: string }> {
  const { createWebSession, rotateWebSession } = await import("@plexco/db");
  const { randomBytes: rb } = await import("node:crypto");
  const { token, tokenHash } = newSessionToken();
  const csrfToken = rb(24).toString("base64url");
  const existing = (await cookies()).get(SESSION_COOKIE)?.value;
  let rotated: string | null = null;
  if (existing) {
    rotated = await rotateWebSession(appDb().pool, {
      oldTokenHash: hashToken(existing),
      newTokenHash: tokenHash,
      newCsrfSecret: csrfToken,
      ttlSeconds: SESSION_TTL_SECONDS,
      accountId,
    });
  }
  if (!rotated) {
    await createWebSession(appDb().pool, {
      accountId,
      tokenHash,
      csrfSecret: csrfToken,
      ttlSeconds: SESSION_TTL_SECONDS,
    });
  }
  await setSessionCookie(token);
  return { csrfToken };
}

/** CSRF double-submit: mutation requests must echo the session secret. */
export function csrfOk(request: Request, session: ResolvedSession): boolean {
  const header = request.headers.get("x-csrf-token");
  return typeof header === "string" && header.length > 0 && header === session.csrfSecret;
}

/**
 * Same-origin check for endpoints that mint a session WITHOUT an existing
 * one to echo a CSRF secret against (e.g. the login callback). Browsers
 * attach Origin — not spoofable by page JS — to every POST, including
 * same-origin ones, so its absence or mismatch against the request's own
 * Host means the request did not originate from this app's own pages.
 * Falls back to Referer only when Origin is entirely absent; fails closed.
 */
export function sameOriginRequest(request: Request): boolean {
  const host = request.headers.get("host");
  if (!host) return false;
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).host === host;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Client IP for rate limiting. Order of trust: Fly-Client-IP (set/overwritten
 * by the Fly edge — not client-forgeable through it), else the LAST value of
 * X-Forwarded-For (appended by the nearest trusted proxy; the FIRST value is
 * client-supplied and would let an attacker mint a fresh bucket per request).
 */
export function clientIp(request: Request): string {
  const fly = request.headers.get("fly-client-ip");
  if (fly) return fly.trim();
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",");
    const last = parts[parts.length - 1]?.trim();
    if (last) return last;
  }
  return "local";
}

/**
 * Sliding-window limiter for the auth endpoints (BL-SEC-5 login 10/min/IP),
 * backed by ONE shared Postgres store — replicas/restarts cannot multiply or
 * reset the buckets.
 */
export async function rateLimited(key: string, limit = 10, windowSeconds = 60): Promise<boolean> {
  const { rateLimitCheck } = await import("@plexco/db");
  return !(await rateLimitCheck(appDb().pool, key, limit, windowSeconds));
}

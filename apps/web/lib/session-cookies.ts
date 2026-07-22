import { createHash, randomBytes } from "node:crypto";
import { isIP } from "node:net";
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
 * Thrown by issueSession when the request carries a session cookie but the DB
 * refuses to rotate it — the old session is revoked/expired (e.g. a concurrent
 * logout-all won the race). The cookie is already cleared before this throws;
 * live callers map it to a generic AUTH_INVALID 401. It carries NO token, hash
 * or account id — there is nothing sensitive to leak into a log or a response
 * (G3-B1/B3, D0-12).
 */
export class SessionReauthRequiredError extends Error {
  constructor() {
    super("session reauth required");
    this.name = "SessionReauthRequiredError";
  }
}

/**
 * Issue a session for the JUST-AUTHENTICATED / JUST-PRIVILEGED account: rotates
 * the live cookie when present (revoking it), else mints fresh; sets the new
 * cookie. THE single path for session issuance — every privilege transition
 * (login, tenant provisioning, future owner-assignment/tenant-switch) uses it.
 *
 * Issuance fence (G3-B1, D0-12): when a cookie EXISTS but rotate returns null
 * (the old session is revoked/expired — e.g. a concurrent logout-all won),
 * NEVER fall back to minting a fresh session for that stale cookie. Clear the
 * cookie and throw SessionReauthRequiredError so the caller answers 401; the
 * cookie-less retry then mints normally as a brand-new authentication. Only a
 * request with NO cookie takes the create path, whose calls and cookie
 * attributes stay unchanged (G3-B2).
 */
export async function issueSession(accountId: string): Promise<{ csrfToken: string }> {
  const { createWebSession, rotateWebSession } = await import("@plexco/db");
  const { randomBytes: rb } = await import("node:crypto");
  const { token, tokenHash } = newSessionToken();
  const csrfToken = rb(24).toString("base64url");
  const existing = (await cookies()).get(SESSION_COOKIE)?.value;
  if (existing) {
    const rotated = await rotateWebSession(appDb().pool, {
      oldTokenHash: hashToken(existing),
      newTokenHash: tokenHash,
      newCsrfSecret: csrfToken,
      ttlSeconds: SESSION_TTL_SECONDS,
      accountId,
    });
    if (!rotated) {
      await clearSessionCookie();
      throw new SessionReauthRequiredError();
    }
  } else {
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

/* ---------------------------------------------------------------------------
 * OAuth completion hop (M3) — auth-s4-d1b.
 *
 * A SameSite=Strict session cookie is NOT sent on the cross-site OAuth callback,
 * so the callback cannot read/rotate a pre-existing session. The measured fix
 * (docs/probe-strict-cookie-completion-hop.md) is a same-site completion hop:
 * the callback commits a FIRST-PARTY landing document that auto-submits a
 * same-origin POST to /complete, where the Strict cookie IS present, so the
 * EXISTING issueSession() above runs its EXISTING rotate branch. A bare 302
 * (M1) does NOT carry the cookie on any engine — hence a committed document, not
 * a redirect. The raw handoff token rides the POST body (hidden field); only its
 * sha256 is stored server-side and single-use enforced there (migration 0018).
 * ------------------------------------------------------------------------- */

/** Same-site completion endpoint the M3 landing POSTs to. */
export const COMPLETION_PATH = "/api/auth/google/complete";
/** POST body field carrying the raw one-time handoff token. */
export const HANDOFF_FIELD = "handoff";
/** Short handoff TTL — the hop happens immediately in the user's own browser. */
export const HANDOFF_TTL_SECONDS = 120;

/** A fresh one-time handoff token (raw for the form body) + its at-rest sha256. */
export function newHandoffToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

/** Escape the few HTML-significant chars (base64url has none, but be defensive). */
function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

/**
 * Build the M3 completion landing: a first-party document that auto-submits a
 * same-origin POST carrying the raw handoff, with a <noscript> "Continue" button
 * as the no-JS fallback. Returns the body AND the locked-down headers together so
 * the CSP nonce always matches the one inline script (default-src 'none' blocks
 * everything else; form-action 'self' scopes the POST; frame-ancestors 'none' +
 * X-Frame-Options DENY stop clickjacking; no-store never caches the one-time
 * handoff; no-referrer keeps the callback URL's code/state out of the referrer).
 */
export function buildCompletionLanding(handoffToken: string): {
  body: string;
  headers: Record<string, string>;
} {
  const nonce = randomBytes(16).toString("base64");
  const token = escapeHtml(handoffToken);
  const body =
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>Signing you in…</title></head><body>` +
    `<form id="plx-complete" method="POST" action="${COMPLETION_PATH}">` +
    `<input type="hidden" name="${HANDOFF_FIELD}" value="${token}">` +
    `<noscript><button type="submit">Continue</button></noscript>` +
    `</form>` +
    `<script nonce="${nonce}">document.getElementById("plx-complete").submit()</script>` +
    `</body></html>`;
  const headers = {
    "content-type": "text/html; charset=utf-8",
    "referrer-policy": "no-referrer",
    "cache-control": "no-store",
    "x-frame-options": "DENY",
    "content-security-policy":
      `default-src 'none'; script-src 'nonce-${nonce}'; form-action 'self'; ` +
      `base-uri 'none'; frame-ancestors 'none'`,
  };
  return { body, headers };
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
 *
 * A browser origin is scheme + host + port (codex round-03) — comparing
 * `.host` alone would accept e.g. `http://plexco.app` as "same-origin" for
 * a `plexco.app` Host header even though browsers treat http/https as
 * different origins. In production this must be `https:`; non-production
 * (local dev, which commonly runs plain http) does not enforce a scheme,
 * matching the existing `secure` cookie flag's own production gate.
 */
export function sameOriginRequest(request: Request): boolean {
  const host = request.headers.get("host");
  if (!host) return false;
  const requiredProtocol = process.env.NODE_ENV === "production" ? "https:" : null;
  const matchesThisOrigin = (rawUrl: string): boolean => {
    try {
      const url = new URL(rawUrl);
      if (url.host !== host) return false;
      return requiredProtocol === null || url.protocol === requiredProtocol;
    } catch {
      return false;
    }
  };
  const origin = request.headers.get("origin");
  if (origin) return matchesThisOrigin(origin);
  const referer = request.headers.get("referer");
  if (referer) return matchesThisOrigin(referer);
  return false;
}

export type TrustedIngressProvider = "digitalocean" | "fly" | "direct";

/**
 * Production must name the proxy whose client-IP header is trusted. Accepting
 * every provider's header, or guessing from X-Forwarded-For, lets a request
 * choose its own rate-limit bucket when that header is not overwritten by the
 * actual edge. Local development is the only implicit direct mode.
 */
export function trustedIngressProvider(): TrustedIngressProvider {
  const configured = process.env.TRUSTED_INGRESS_PROVIDER?.trim().toLowerCase();
  if (configured === "digitalocean" || configured === "fly") return configured;
  if (configured === "direct") {
    if (process.env.NODE_ENV !== "production") return configured;
    throw new Error("TRUSTED_INGRESS_PROVIDER=direct is forbidden in production");
  }
  if (!configured && process.env.NODE_ENV !== "production") return "direct";
  throw new Error("TRUSTED_INGRESS_PROVIDER must be digitalocean or fly in production");
}

function singleIpHeader(request: Request, header: string): string | null {
  const value = request.headers.get(header)?.trim();
  if (!value || value.includes(",") || isIP(value) === 0) return null;
  return value;
}

/**
 * Resolve the rate-limit identity from exactly one configured trusted edge.
 * DigitalOcean App Platform overwrites `do-connecting-ip`; Fly overwrites
 * `fly-client-ip`. Missing/invalid trusted headers collapse into one bounded
 * bucket instead of falling back to a client-forgeable cross-provider header.
 */
export function clientIp(
  request: Request,
  provider: TrustedIngressProvider = trustedIngressProvider(),
): string {
  if (provider === "digitalocean") {
    return singleIpHeader(request, "do-connecting-ip") ?? "digitalocean:untrusted";
  }
  if (provider === "fly") {
    return singleIpHeader(request, "fly-client-ip") ?? "fly:untrusted";
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

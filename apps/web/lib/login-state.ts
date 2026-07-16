import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import {
  consumeLoginState as dbConsumeLoginState,
  issueLoginState as dbIssueLoginState,
} from "@plexco/db";
import { appDb } from "./session-cookies";

/**
 * Pre-auth login-state CSRF binding (DD-31 SI-1). Distinct from the
 * post-login session cookie (session-cookies.ts): this cookie exists ONLY
 * between "widget shown" and "callback consumed," proving the callback is a
 * continuation of the SAME browser that started the login — independent of
 * Origin/Referer transport (supplements sameOriginRequest, does not replace
 * it). Random token + plain hash lookup, same pattern as web_sessions: the
 * token is high-entropy random, not a low-entropy id, so no keying is needed
 * (unlike SI-2's platform-hash).
 */

export const LOGIN_STATE_COOKIE = "plx_login_state";
export const LOGIN_STATE_TTL_SECONDS = 600; // 10 minutes

function hashState(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Mints a state token, stores its hash, sets the pre-auth cookie. */
export async function issueLoginStateCookie(): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  await dbIssueLoginState(appDb().pool, {
    stateHash: hashState(token),
    ttlSeconds: LOGIN_STATE_TTL_SECONDS,
  });
  (await cookies()).set(LOGIN_STATE_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: LOGIN_STATE_TTL_SECONDS,
  });
}

/**
 * Consumes the pre-auth cookie against its DB row — single-use. Returns
 * false (never throws) for missing/mismatched/expired/already-consumed
 * state, so the callback route can uniformly reject with AUTH_INVALID.
 * Always clears the cookie so a failed/used state is never retried.
 */
export async function consumeLoginStateCookie(): Promise<boolean> {
  const store = await cookies();
  const token = store.get(LOGIN_STATE_COOKIE)?.value;
  store.delete(LOGIN_STATE_COOKIE);
  if (!token) return false;
  return dbConsumeLoginState(appDb().pool, hashState(token));
}

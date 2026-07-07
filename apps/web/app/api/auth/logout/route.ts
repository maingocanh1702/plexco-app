import { revokeWebSession } from "@plexco/db";
import { cookies } from "next/headers";
import { ok } from "../../../../lib/api-envelope";
import {
  appDb,
  clearSessionCookie,
  hashToken,
  SESSION_COOKIE,
} from "../../../../lib/session-cookies";

/**
 * POST /api/auth/logout — revoke server-side, clear cookie. Idempotent.
 * Clearing is gated on an actually-revoked session: an unconditional clear
 * lets a cross-site POST with no ambient cookie (e.g. SameSite=strict
 * withholding it) still force the browser to drop a REAL session cookie,
 * since Set-Cookie on the response is honored regardless of how the request
 * arrived — a logout CSRF with no session ever touched server-side.
 */
export async function POST(): Promise<Response> {
  const raw = (await cookies()).get(SESSION_COOKIE)?.value;
  const revoked = raw ? await revokeWebSession(appDb().pool, hashToken(raw)) : false;
  if (revoked) await clearSessionCookie();
  return ok({ loggedOut: true });
}

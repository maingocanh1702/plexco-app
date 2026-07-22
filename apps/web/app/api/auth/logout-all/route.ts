import { t } from "@plexco/core/i18n";
import { resolveWebSession, revokeAllWebSessions } from "@plexco/db";
import { cookies } from "next/headers";
import { err, ok } from "../../../../lib/api-envelope";
import {
  appDb,
  clearSessionCookie,
  csrfOk,
  hashToken,
  SESSION_COOKIE,
} from "../../../../lib/session-cookies";

/**
 * POST /api/auth/logout-all — account-self "log out everywhere" (DD-80 v1.88,
 * G3 §4.5). Revokes EVERY web session of the caller's account by bumping the
 * account session epoch, then clears this browser's cookie.
 *
 * The account is derived server-side by the DB wrapper from the current
 * session token hash — this route NEVER accepts an `account_id` from the body
 * (D0-3). Order is fixed and fail-closed:
 *   1. no/invalid/revoked/replayed cookie → generic 401 AUTH_INVALID, and we
 *      never reach the wrapper, so a replay mutates nothing (D0-4);
 *   2. CSRF is validated (double-submit, reusing csrfOk) BEFORE any mutation —
 *      a missing/wrong secret is 403 CSRF_INVALID with zero revoke (D0-5);
 *   3. only then the real DB wrapper revokes all sessions and we clear the
 *      cookie and report success (D0-3).
 * The same raw cookie is read and hashed once; the hash is reused for the
 * CSRF-bearing resolve and for the revoke so both act on one identity.
 */
export async function POST(request: Request): Promise<Response> {
  const raw = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!raw) {
    return err("AUTH_INVALID", t("Xác thực không hợp lệ.", "Invalid authentication."), 401);
  }
  const tokenHash = hashToken(raw);

  // Resolve first — we need the session's csrf_secret to validate CSRF, and a
  // revoked/expired/replayed cookie resolves to null (generic 401, D0-4).
  const session = await resolveWebSession(appDb().pool, tokenHash);
  if (!session) {
    return err("AUTH_INVALID", t("Xác thực không hợp lệ.", "Invalid authentication."), 401);
  }

  // CSRF BEFORE any mutation (D0-5, G3-B5).
  if (!csrfOk(request, session)) {
    return err("CSRF_INVALID", t("Yêu cầu không hợp lệ.", "Invalid request."), 403);
  }

  // Real DB wrapper: derives the account from the token hash and revokes all
  // of that account's live sessions. null = the session lost a race after the
  // CSRF check (revoked/rotated between resolve and revoke) → zero net
  // mutation. Do NOT clear the cookie here: a concurrent privilege-transition
  // rotate may have just minted a NEW valid cookie, and clearing would wipe it
  // (a spurious logout while the new session stays live). Clearing only ever
  // follows a real revoke — exactly how the single-session logout route gates
  // its own clear (D0-4).
  const revoked = await revokeAllWebSessions(appDb().pool, tokenHash);
  if (revoked === null) {
    return err("AUTH_INVALID", t("Xác thực không hợp lệ.", "Invalid authentication."), 401);
  }

  // Revoke succeeded — every account session (this one included) is gone;
  // drop the cookie and report the count.
  await clearSessionCookie();
  return ok({ revoked });
}

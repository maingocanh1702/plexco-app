import { t } from "@plexco/core/i18n";
import { consumeOauthCompletionHandoff } from "@plexco/db";
import { err } from "../../../../../lib/api-envelope";
import {
  appDb,
  HANDOFF_FIELD,
  hashToken,
  issueSession,
  sameOriginRequest,
  SessionReauthRequiredError,
} from "../../../../../lib/session-cookies";

/**
 * POST /api/auth/google/complete — the same-site second hop of the Google login
 * (auth-s4-d1b, M3). The cross-site callback commits a first-party landing that
 * auto-submits here, so — unlike the callback — this request IS same-site and
 * the browser DOES send the Strict `plx_session` cookie. That lets the EXISTING
 * issueSession() take its EXISTING rotate branch and revoke a pre-existing
 * session (the whole point of the slice — no new primitive).
 *
 * Order: config gate (503 when Google is unconfigured — D1B-10, no bypass) →
 * `sameOriginRequest()` (a POST carries Origin, so the mutating step is guarded
 * independently of cookie semantics — D1B-7) → read the raw handoff from the
 * POST body → single-use consume it against the durable server-side fence
 * (replay/expiry → null → generic reject, D1B-5/D1B-6) → issueSession(resolved
 * account): rotate when the Strict cookie is present, else create; the issuance
 * fence maps a lost logout-all race to a generic reject (D1B-8). Every reject is
 * generic and `Referrer-Policy: no-referrer`; the handoff is never logged.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    return await handleComplete(request);
  } catch {
    // Fail closed to the home page with a generic error — never a bare Next 500.
    const base = process.env.APP_BASE_URL?.trim() ?? "";
    return redirect(`${base}/?auth_error=AUTH_UNAVAILABLE`);
  }
}

async function handleComplete(request: Request): Promise<Response> {
  const baseUrl = process.env.APP_BASE_URL?.trim();
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  // Fail-closed enablement gate (D1B-10): the whole Google surface is 503 until
  // config is present — the completion hop must not be a bypass around it.
  if (!clientId || !clientSecret || !baseUrl) {
    return noReferrer(
      err(
        "AUTH_UNAVAILABLE",
        t("Đăng nhập Google chưa được cấu hình.", "Google login is not configured."),
        503,
      ),
    );
  }

  const fail = (): Response => redirect(`${baseUrl}/?auth_error=AUTH_INVALID`);

  // The mutating step carries an Origin on a POST, so assert same-origin here
  // independently of cookie semantics (D1B-7). A cross-site POST cannot rotate.
  if (!sameOriginRequest(request)) return fail();

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(); // malformed body
  }
  const raw = form.get(HANDOFF_FIELD);
  if (typeof raw !== "string" || raw.length === 0) return fail();

  // Single-use, durable server-side fence — replay (already consumed) or expiry
  // both return null (D1B-5/D1B-6): generic reject, zero session.
  const accountId = await consumeOauthCompletionHandoff(appDb().pool, hashToken(raw));
  if (!accountId) return fail();

  try {
    // THE single session issuer. The Strict cookie IS present now, so a
    // pre-existing session takes the rotate branch (revoke old + mint new,
    // atomic — 0015); a cookie-less browser takes the unchanged create path.
    await issueSession(accountId);
  } catch (error) {
    // Issuance fence (D0-12/D1B-8): a stale cookie could not rotate (a concurrent
    // logout-all won) — generic reject, no internal reason leaked.
    if (error instanceof SessionReauthRequiredError) return fail();
    throw error;
  }
  return redirect(`${baseUrl}/`);
}

/** 302 redirect that leaks no referrer. */
function redirect(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: { location, "referrer-policy": "no-referrer" },
  });
}

function noReferrer(response: Response): Response {
  response.headers.set("referrer-policy", "no-referrer");
  return response;
}

import { t } from "@plexco/core/i18n";
import { consumeOauthCompletionHandoff } from "@plexco/db";
import { err } from "../../../../../lib/api-envelope";
import { log } from "../../../../../lib/log";
import {
  appDb,
  clientIp,
  HANDOFF_FIELD,
  hashToken,
  issueSession,
  rateLimited,
  sameOriginRequest,
  SessionReauthRequiredError,
} from "../../../../../lib/session-cookies";

/**
 * The handoff is 32 random bytes as base64url = 43 chars; the whole urlencoded
 * body is `handoff=<43>` ≈ 51 bytes. 1 KiB is ~20× that with room for a
 * charset suffix — anything larger is not this form (audit 2026-09-06 W-3:
 * `request.formData()` had no bound at all).
 */
const MAX_COMPLETE_BODY_BYTES = 1024;

/**
 * POST /api/auth/google/complete — the same-site second hop of the Google login
 * (auth-s4-d1b, M3). The cross-site callback commits a first-party landing that
 * auto-submits here, so — unlike the callback — this request IS same-site and
 * the browser DOES send the Strict `plx_session` cookie. That lets the EXISTING
 * issueSession() take its EXISTING rotate branch and revoke a pre-existing
 * session (the whole point of the slice — no new primitive).
 *
 * Order: config gate (503 when Google is unconfigured — D1B-10, no bypass) →
 * rate limit per trusted IP (10/min, same bucket shape as the sibling hops) →
 * `sameOriginRequest()` (a POST carries Origin, so the mutating step is guarded
 * independently of cookie semantics — D1B-7) → read the raw handoff from a
 * bounded, form-typed POST body → single-use consume it against the durable server-side fence
 * (replay/expiry → null → generic reject, D1B-5/D1B-6) → issueSession(resolved
 * account): rotate when the Strict cookie is present, else create; the issuance
 * fence maps a lost logout-all race to a generic reject (D1B-8). Every reject is
 * generic and `Referrer-Policy: no-referrer`; the handoff is never logged.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    return await handleComplete(request);
  } catch (error) {
    // Fail closed to the home page with a generic error — never a bare Next 500.
    // Logged by class only (audit 2026-09-06 W-11); the handoff never reaches the logger.
    log.error("auth.google.complete.unhandled", { error });
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

  // Rate limit BEFORE the body is read or any row is touched — same bucket shape
  // and limit as the sibling hops (`oauth-state:<ip>` / `oauth-callback:<ip>`,
  // BL-SEC-5 10/min/IP), and fail closed if the limiter store is down exactly as
  // the state route does (codex round-06 [P2] there). Until audit 2026-09-06 W-3
  // this was the one auth mutation hop with no bucket: every POST cost one UPDATE.
  const ip = clientIp(request);
  let limited: boolean;
  try {
    limited = await rateLimited(`oauth-complete:${ip}`);
  } catch {
    limited = true;
  }
  if (limited) {
    return noReferrer(
      err(
        "LOGIN_RATE_LIMITED",
        t("Quá nhiều lần thử — đợi một phút.", "Too many attempts — wait a minute."),
        429,
      ),
    );
  }

  // The mutating step carries an Origin on a POST, so assert same-origin here
  // independently of cookie semantics (D1B-7). A cross-site POST cannot rotate.
  if (!sameOriginRequest(request)) return fail();

  // Bounded, typed body: the landing posts application/x-www-form-urlencoded and
  // nothing else should reach here. Declared length is checked first, then the
  // bytes actually read — a missing/lying Content-Length must not bypass the cap.
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/x-www-form-urlencoded")) {
    return fail();
  }
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_COMPLETE_BODY_BYTES) return fail();
  let text: string;
  try {
    text = await request.text();
  } catch {
    return fail(); // malformed body
  }
  if (Buffer.byteLength(text, "utf8") > MAX_COMPLETE_BODY_BYTES) return fail();
  const raw = new URLSearchParams(text).get(HANDOFF_FIELD);
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

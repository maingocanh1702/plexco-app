import { t } from "@plexco/core/i18n";
import { err, ok } from "../../../../../lib/api-envelope";
import { issueLoginStateCookie } from "../../../../../lib/login-state";
import { clientIp, rateLimited } from "../../../../../lib/session-cookies";

/**
 * GET /api/auth/telegram/state — issues the pre-auth login-state cookie
 * (DD-31 SI-1). Call before rendering the TG Login Widget.
 * Unauthenticated by nature (pre-login) — rate-limited by IP (same 10/min
 * bucket shape as the login callback, BL-SEC-5) so it cannot be hammered
 * into unbounded auth_login_state row growth (codex round-01 finding).
 */
export async function GET(request: Request): Promise<Response> {
  const ip = clientIp(request);
  if (await rateLimited(`login-state:${ip}`)) {
    return err(
      "LOGIN_RATE_LIMITED",
      t("Quá nhiều lần thử — đợi một phút.", "Too many attempts — wait a minute."),
      429,
    );
  }
  await issueLoginStateCookie();
  return ok({ issued: true });
}

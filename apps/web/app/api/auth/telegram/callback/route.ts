import { t } from "@plexco/core/i18n";
import { loginTelegram, LoginReplayError } from "@plexco/db";
import { err, ok } from "../../../../../lib/api-envelope";
import { consumeLoginStateCookie } from "../../../../../lib/login-state";
import {
  appDb,
  clientIp,
  issueSession,
  rateLimited,
  sameOriginRequest,
} from "../../../../../lib/session-cookies";
import {
  normalizeTelegramPayload,
  telegramLoginNonce,
  telegramUserLookupHash,
  verifyTelegramLogin,
} from "../../../../../lib/telegram-login";

/**
 * POST /api/auth/telegram/callback — TG Login Widget callback (WAO-UC-1).
 * Two independent, additive continuity checks BEFORE the payload is even
 * parsed (DD-31 SI-1): same-origin (Origin/Referer vs Host) AND a consumed
 * pre-auth login-state cookie — proves this callback continues the SAME
 * browser session that called GET /api/auth/telegram/state, independent of
 * which transport delivered the request. Neither alone is sufficient: the
 * DB replay nonce (auth_login_nonces) only makes a payload single-use, it
 * does not prove THIS browser started the login. See
 * BE/auth-security-invariant-table.md SI-1.
 *
 * Ordering: the free same-origin check runs first, then the IP rate limiter,
 * THEN login-state consume. The limiter must bound EVERY attempt regardless
 * of login-state validity (codex round-04) — placing it after state-consume
 * would let missing/expired/forged-cookie attempts hit the DB at unlimited
 * rate, never touching the documented 10/min/IP callback bound (BL-SEC-5).
 */
export async function POST(request: Request): Promise<Response> {
  if (!sameOriginRequest(request)) {
    return err("AUTH_INVALID", t("Xác thực không hợp lệ.", "Invalid authentication."), 401);
  }
  const ip = clientIp(request);
  if (await rateLimited(`login:${ip}`)) {
    return err(
      "LOGIN_RATE_LIMITED",
      t("Quá nhiều lần thử — đợi một phút.", "Too many attempts — wait a minute."),
      429,
    );
  }
  if (!(await consumeLoginStateCookie())) {
    return err("AUTH_INVALID", t("Xác thực không hợp lệ.", "Invalid authentication."), 401);
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return err(
      "AUTH_UNAVAILABLE",
      t("Đăng nhập Telegram chưa được cấu hình.", "Telegram login is not configured."),
      503,
    );
  }

  let payload: Record<string, string>;
  try {
    const normalized = normalizeTelegramPayload(await request.json());
    if (!normalized) {
      return err("AUTH_INVALID", t("Xác thực không hợp lệ.", "Invalid authentication."), 401);
    }
    payload = normalized;
  } catch {
    return err("AUTH_INVALID", t("Xác thực không hợp lệ.", "Invalid authentication."), 401);
  }

  const verdict = verifyTelegramLogin(payload, botToken);
  if (!verdict.ok) {
    return verdict.reason === "AUTH_STALE"
      ? err("AUTH_STALE", t("Phiên xác thực đã hết hạn.", "Authentication expired."), 401)
      : err("AUTH_INVALID", t("Xác thực không hợp lệ.", "Invalid authentication."), 401);
  }

  try {
    const login = await loginTelegram(appDb().pool, {
      platformUserHash: await telegramUserLookupHash(verdict.telegramUserId),
      displayName: verdict.displayName,
      loginHash: telegramLoginNonce(payload),
    });

    // Session fixation defense + account binding — via the single issuer.
    const { csrfToken } = await issueSession(login.accountId);
    return ok({ personId: login.personId, created: login.created, csrfToken });
  } catch (error) {
    if (error instanceof LoginReplayError) {
      return err("AUTH_INVALID", t("Xác thực không hợp lệ.", "Invalid authentication."), 401);
    }
    throw error;
  }
}

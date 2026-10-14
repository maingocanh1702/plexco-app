import { t } from "@plexco/core/i18n";
import { linkZaloToAccount } from "@plexco/db";
import { err, ok } from "../../../../lib/api-envelope";
import { linkCodeKeys } from "../../../../lib/link-code-keys";
import { log } from "../../../../lib/log";
import { readBoundedBody } from "../../../../lib/read-bounded-body";
import { actorThrottled, isUnsafeCommandKey } from "../../../../lib/session-command-route";
import {
  appDb,
  clientIp,
  csrfOk,
  currentSession,
  rateLimited,
} from "../../../../lib/session-cookies";

/**
 * POST /api/me/link -- the signed-in web user enters the one-time code the Zalo bot gave them
 * (`/link`); on success that Zalo identity belongs to the account's Person.
 *
 * Gate order: session -> CSRF -> actor ceiling -> per-account bucket + per-IP bucket (both spent
 * BEFORE the consume, so guessing costs the guesser the budget) -> bounded body -> key config ->
 * linkZaloToAccount. The acting account comes ONLY from the session; a body `accountId`
 * is refused as an unknown key. Responses carry the coarse outcome only: no person ids, counters or
 * blocking-table names, and "no such code" / "wrong code" / "already used" are all the same LINK_CODE_INVALID (existence
 * oracle). Merging a Person that holds real data is refused (MERGE_REQUIRES_REVIEW), never done.
 * A deadlock / serialization failure inside the link transaction rolled back whole (nothing written)
 * and is the retryable LINK_UNAVAILABLE, like a missing key.
 * commandId is validated for parity with the other command routes but nothing is stored under it:
 * the code is single-use at the DB, so a replay is simply an invalid code.
 *
 * The two 429s say what is true for each: RATE_LIMITED is the 60 per 60 s actor ceiling;
 * LINK_CODE_RATE_LIMITED is BOTH an app bucket (600 s windows) and the DB attempt cap (that code is
 * dead), so its copy holds for both: wait 10 minutes, then use a new code (by then the old code's
 * 10-minute TTL has run out anyway).
 */
const MAX_BODY_BYTES = 1024;
const MAX_CODE_CHARS = 40;
const ACCOUNT_LIMIT = { limit: 5, windowSeconds: 600 };
const IP_LIMIT = { limit: 20, windowSeconds: 600 };

const invalidBody = () => err("INVALID_BODY", t("Dữ liệu không hợp lệ.", "Invalid payload."), 400);
const invalidCode = () =>
  err(
    "LINK_CODE_INVALID",
    t("Mã liên kết không đúng hoặc đã hết hạn.", "That code is not valid or has expired."),
    400,
  );
const linkUnavailable = () =>
  err(
    "LINK_UNAVAILABLE",
    t("Liên kết Zalo tạm thời không khả dụng.", "Zalo linking is temporarily unavailable."),
    503,
  );

export async function POST(request: Request): Promise<Response> {
  const session = await currentSession();
  if (!session) return err("AUTH_REQUIRED", t("Chưa đăng nhập.", "Not signed in."), 401);
  if (!csrfOk(request, session)) {
    return err("CSRF_INVALID", t("Yêu cầu không hợp lệ.", "Invalid request."), 403);
  }
  const tooMany = () =>
    err(
      "RATE_LIMITED",
      t(
        "Bạn gửi quá nhiều yêu cầu. Hãy đợi 1 phút rồi thử lại.",
        "Too many requests. Wait a minute and try again.",
      ),
      429,
    );
  if (await actorThrottled(session.accountId)) return tooMany();
  const linkTooMany = () =>
    err(
      "LINK_CODE_RATE_LIMITED",
      t(
        "Bạn đã thử quá nhiều lần. Hãy đợi 10 phút, rồi gửi /link cho bot để lấy mã mới và thử lại.",
        "Too many attempts. Wait 10 minutes, then send /link to the bot for a new code and try again.",
      ),
      429,
    );
  if (
    (await rateLimited(
      `me-link:${session.accountId}`,
      ACCOUNT_LIMIT.limit,
      ACCOUNT_LIMIT.windowSeconds,
    )) ||
    (await rateLimited(`me-link-ip:${clientIp(request)}`, IP_LIMIT.limit, IP_LIMIT.windowSeconds))
  ) {
    log.info("me_link", { accountId: session.accountId, outcome: "rate_limited" });
    return linkTooMany();
  }

  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return invalidBody();
  }
  const read = await readBoundedBody(request, MAX_BODY_BYTES);
  if (!read.ok) return invalidBody();
  let raw: unknown;
  try {
    raw = JSON.parse(read.text);
  } catch {
    return invalidBody();
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return invalidBody();
  const body = raw as Record<string, unknown>;
  if (Object.keys(body).some((k) => k !== "commandId" && k !== "code")) return invalidBody();
  const { code, commandId } = body;
  if (
    typeof commandId !== "string" ||
    commandId.trim().length === 0 ||
    commandId.length > 200 ||
    isUnsafeCommandKey(commandId)
  ) {
    return err("INVALID_BODY", t("Thiếu commandId.", "Missing commandId."), 400);
  }
  if (typeof code !== "string" || code.trim().length === 0 || code.length > MAX_CODE_CHARS) {
    return invalidBody();
  }

  const keys = linkCodeKeys();
  if (!keys) {
    log.error("me_link_unconfigured", { accountId: session.accountId });
    return linkUnavailable();
  }

  const { outcome } = await linkZaloToAccount(appDb().pool, code, session.accountId, keys);
  log.info("me_link", { accountId: session.accountId, outcome });
  switch (outcome) {
    case "linked":
    case "already_linked":
      return ok({ outcome });
    case "requires_review":
      return err(
        "MERGE_REQUIRES_REVIEW",
        t(
          "Không thể tự động liên kết Zalo này; cần bộ phận hỗ trợ gộp thủ công.",
          "This Zalo cannot be linked automatically; support must merge it.",
        ),
        409,
      );
    case "rate_limited":
      return linkTooMany();
    case "unavailable": // 40P01 / 40001: rolled back whole, nothing written; a retry may pass
      return linkUnavailable();
    case "invalid":
    case "unsupported": // never reveal the issuer shape
      return invalidCode();
  }
}

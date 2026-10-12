import { ApiClientError, CLIENT_BAD_RESPONSE, CLIENT_NETWORK_ERROR } from "./api-client";
import type { TFn } from "./i18n-client";

/**
 * ONE mapping from an API failure to what the screen does (FE-INV-6, fail closed).
 *
 * Message source: domain codes the session BE catalog pins (MESSAGE_BY_CODE in
 * session-command-route.ts) are shown as the envelope's own `message` — it is resolved in the
 * TENANT's language after authorization. Codes raised BEFORE the tenant is known-and-authorized
 * (AUTH_REQUIRED, FORBIDDEN, CSRF_INVALID, actor RATE_LIMITED, INVALID_BODY) are always Vietnamese
 * server-side (DD-118), so the client renders them from its own t() instead. Any code not listed
 * here, or a domain code with an empty message, becomes the generic message + requestId; a
 * screen is never blank and never shows a raw server string it does not recognise.
 */
export type ErrorAction = "none" | "reload" | "retry" | "sign-in";

export interface ErrorView {
  code: string;
  message: string;
  action: ErrorAction;
  requestId: string | null;
  /** True when the code is in the known catalog; false = generic fail-closed rendering. */
  known: boolean;
}

/** Form fields an error should be pinned to, when the code is about one field. */
export type ErrorField = "sportId" | "startsAt" | "endsAt" | "area" | "slotsMax" | "priceAmount";

const DOMAIN_CODES = new Set([
  "CANCEL_REQUIRES_REVIEW",
  "CAPACITY_BELOW_OCCUPANCY",
  "CAPACITY_BELOW_ROSTER",
  "COMMAND_ID_CONFLICT",
  "INVALID_TIME_RANGE",
  "MISSING_DISCOVERY_FIELDS",
  "PRICE_CHANGE_REQUIRES_POLICY",
  "SESSION_NOT_OPEN",
  "SPORT_INACTIVE",
  "STALE_VERSION",
  "TENANT_SUSPENDED",
]);

export function errorField(code: string): ErrorField | null {
  switch (code) {
    case "INVALID_TIME_RANGE":
      return "endsAt";
    case "MISSING_DISCOVERY_FIELDS":
      return "area";
    case "CAPACITY_BELOW_ROSTER":
    case "CAPACITY_BELOW_OCCUPANCY":
      return "slotsMax";
    case "PRICE_CHANGE_REQUIRES_POLICY":
      return "priceAmount";
    case "SPORT_INACTIVE":
      return "sportId";
    default:
      return null;
  }
}

export function describeSessionError(error: unknown, t: TFn): ErrorView {
  const requestId = error instanceof ApiClientError ? error.requestId : null;
  const code = error instanceof ApiClientError ? error.code : "CLIENT_UNKNOWN";
  const message = error instanceof ApiClientError ? error.message.trim() : "";
  const view = (m: string, action: ErrorAction, known = true): ErrorView => ({
    code,
    message: m,
    action,
    requestId,
    known,
  });

  if (code === CLIENT_NETWORK_ERROR) {
    return view(
      t(
        "Không có kết nối mạng. Kiểm tra mạng rồi thử lại.",
        "No connection. Check your network and try again.",
      ),
      "retry",
    );
  }
  switch (code) {
    case "AUTH_REQUIRED":
      return view(
        t(
          "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.",
          "Your session expired. Please sign in again.",
        ),
        "sign-in",
      );
    case "FORBIDDEN":
      return view(
        t(
          "Bạn không có quyền thực hiện thao tác này ở CLB này.",
          "You are not allowed to do this in this club.",
        ),
        "none",
      );
    case "CSRF_INVALID":
      return view(
        t(
          "Yêu cầu không hợp lệ. Tải lại trang rồi thử lại.",
          "Invalid request. Reload the page and try again.",
        ),
        "reload",
      );
    case "RATE_LIMITED":
      return view(
        t(
          "Bạn thao tác quá nhanh. Đợi một lát rồi thử lại.",
          "Too many requests. Wait a moment and try again.",
        ),
        "retry",
      );
    case "INVALID_BODY":
      return view(
        t(
          "Dữ liệu chưa hợp lệ. Kiểm tra lại các trường rồi thử lại.",
          "Some data is not valid. Check the fields and try again.",
        ),
        "none",
      );
    case "SESSION_NOT_FOUND":
      return view(t("Không tìm thấy buổi chơi này.", "This session was not found."), "none");
    default:
      break;
  }
  if (DOMAIN_CODES.has(code) && message.length > 0) {
    return view(message, code === "STALE_VERSION" ? "reload" : "none");
  }
  return view(
    t(
      "Đã có lỗi không mong muốn. Thử lại sau.",
      "Something unexpected went wrong. Try again later.",
    ),
    "retry",
    false,
  );
}

/**
 * True only when the server DEFINITELY did not apply the command (a 4xx envelope: validation,
 * stale version, authz, rate limit). Then the idempotency key may be discarded and a fresh one
 * used for the next attempt. Network loss, a non-envelope reply, 5xx or anything unrecognised may
 * have committed server-side, so the SAME commandId must be reused on retry (DD-117 D5).
 */
export function isDefiniteFailure(error: unknown): boolean {
  if (!(error instanceof ApiClientError)) return false;
  if (error.code === CLIENT_NETWORK_ERROR || error.code === CLIENT_BAD_RESPONSE) return false;
  return error.statusCode >= 400 && error.statusCode < 500;
}

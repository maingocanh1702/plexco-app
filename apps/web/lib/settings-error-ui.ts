import { ApiClientError } from "./api-client";
import type { TFn } from "./i18n-client";
import { describeSessionError, type ErrorView } from "./session-error-ui";

/**
 * Settings screens (/me/settings, /c/[tenantId]/settings): the codes the profile / channel / club /
 * Zalo routes add on top of the shared mapping in session-error-ui.ts, which stays the fallback
 * (AUTH_REQUIRED, FORBIDDEN, CSRF_INVALID, RATE_LIMITED, INVALID_BODY, network, unknown -> generic
 * + requestId). Fail closed: an unrecognised code never shows a raw server string.
 */
export function describeSettingsError(error: unknown, t: TFn): ErrorView {
  const base = describeSessionError(error, t);
  if (!(error instanceof ApiClientError)) return base;
  const view = (message: string, action: ErrorView["action"]): ErrorView => ({
    ...base,
    message,
    action,
    known: true,
  });
  switch (error.code) {
    case "CHANNEL_NOT_LINKED":
      return view(
        t(
          "Kênh này không còn liên kết với tài khoản của bạn. Danh sách sẽ được tải lại.",
          "This channel is no longer linked to your account. The list will reload.",
        ),
        "reload",
      );
    case "NOT_FOUND":
      return view(
        t("Không tìm thấy dữ liệu cần cập nhật.", "The data to update was not found."),
        "none",
      );
    case "ZALO_TOKEN_INVALID":
      return view(
        t(
          "Token bot Zalo không hợp lệ. Kiểm tra lại token rồi nhập lại.",
          "That Zalo bot token is not valid. Check it and enter it again.",
        ),
        "none",
      );
    case "AUTH_UNAVAILABLE":
      return view(
        t(
          "Kết nối Zalo tạm thời chưa khả dụng. Thử lại sau.",
          "Zalo connection is temporarily unavailable. Try again later.",
        ),
        "retry",
      );
    case "TENANT_SUSPENDED":
      return view(
        error.message.trim() || t("CLB đang bị tạm ngưng.", "This club is suspended."),
        "none",
      );
    case "COMMAND_ID_CONFLICT":
    case "CONNECT_SUPERSEDED":
      return view(
        t(
          "Thao tác này đã được xử lý hoặc bị thay thế. Tải lại rồi thử lại.",
          "This action was already handled or superseded. Reload and try again.",
        ),
        "reload",
      );
    default:
      return base;
  }
}

/** True when the failure is the uniform "not permitted" (403) of the club/Zalo routes. */
export function isForbidden(error: unknown): boolean {
  return error instanceof ApiClientError && error.code === "FORBIDDEN";
}

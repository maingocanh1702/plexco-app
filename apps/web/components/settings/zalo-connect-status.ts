import type { ZaloStatus } from "../../lib/club-settings-client";
import type { TFn } from "../../lib/i18n-client";
import type { BadgeTone } from "../ui/badge";

/**
 * Zalo connect card copy, split out of zalo-connect-card.tsx: the badge for a connector status,
 * the outcome message for a 200 from POST /api/onboarding/zalo/connect, and the revoked / reloaded
 * notes. Pure, so the vitest suite can pin every branch, including the fail-closed one for a status
 * this build does not know.
 */
const TONE: Record<ZaloStatus, BadgeTone> = {
  not_connected: "neutral",
  connecting: "info",
  registered: "warning",
  active: "success",
  drift: "warning",
  error: "error",
  revoked: "error",
};

/** A status this build does not know (a newer server) gets a neutral badge, never a blank one. */
export function statusTone(status: string): BadgeTone {
  return (TONE as Record<string, BadgeTone | undefined>)[status] ?? "neutral";
}

export function statusLabel(status: string, t: TFn): string {
  switch (status) {
    case "not_connected":
      return t("Chưa kết nối", "Not connected");
    case "connecting":
      return t("Đang kết nối", "Connecting");
    case "registered":
      return t("Đã đăng ký webhook, chờ xác minh", "Webhook registered, awaiting verification");
    case "active":
      return t("Đang hoạt động", "Active");
    case "drift":
      return t("Cần đăng ký lại webhook", "Webhook needs re-registering");
    case "error":
      return t("Lỗi kết nối", "Connection error");
    case "revoked":
      return t("Đã thu hồi", "Revoked");
    default:
      return t("Không rõ trạng thái", "Unknown status");
  }
}

/**
 * The note that replaces the connect form for a revoked bot. Revoked is terminal (0053): the upsert
 * refuses ANY connect for a club whose bot row is revoked (a different token included) and the route
 * answers ZALO_TOKEN_INVALID 400, so the card offers no reconnect and says why instead (this note
 * comes from the refetched revoked state, not from that answer).
 */
export function revokedNote(t: TFn): string {
  return t(
    "Kết nối Zalo của câu lạc bộ này đã bị thu hồi. Không thể kết nối lại từ trang này, kể cả bằng token bot khác.",
    "This club's Zalo connection was revoked. It cannot be reconnected from this page, not even with a different bot token.",
  );
}

/** Announced after a reload the user asked for has landed (the reload button is gone by then). */
export function reloadedNote(t: TFn): string {
  return t("Đã tải lại trạng thái kết nối Zalo.", "The Zalo connection status was reloaded.");
}

/**
 * What a 200 from connect means, worded from the status it RETURNED: the route answers 200 with
 * status "error" when Zalo refused the webhook registration (the token is stored, the webhook is
 * not), so a fixed "registered" message would contradict the badge next to it.
 */
export function connectOutcome(
  status: string,
  t: TFn,
): { message: string; tone: "success" | "warning" } {
  switch (status) {
    case "registered":
      return {
        message: t(
          "Đã gửi token và đăng ký webhook. Đang chờ Zalo xác minh.",
          "Token sent and webhook registered. Waiting for Zalo to verify it.",
        ),
        tone: "success",
      };
    case "active":
      return {
        message: t("Đã kết nối. Bot Zalo đang hoạt động.", "Connected. The Zalo bot is active."),
        tone: "success",
      };
    case "error":
      return {
        message: t(
          "Đã lưu token nhưng Zalo chưa nhận đăng ký webhook. Hãy thử kết nối lại.",
          "The token was saved, but Zalo did not accept the webhook registration. Try reconnecting.",
        ),
        tone: "warning",
      };
    default:
      return {
        message: t(
          "Zalo chưa xác nhận kết nối. Xem trạng thái ở trên rồi thử lại nếu cần.",
          "Zalo has not confirmed the connection. Check the status above and try again if needed.",
        ),
        tone: "warning",
      };
  }
}

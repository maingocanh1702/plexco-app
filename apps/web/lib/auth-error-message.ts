import type { TFn } from "./i18n-client";

/**
 * Maps the `?auth_error=<CODE>` the Google callback/complete routes redirect with to a message.
 * Closed set, fail-closed: any other value (including attacker-supplied text) gets the generic
 * message and is never echoed.
 */
export function authErrorMessage(code: string | null | undefined, t: TFn): string | null {
  if (!code) return null;
  switch (code) {
    case "AUTH_UNAVAILABLE":
      return t(
        "Đăng nhập Google chưa sẵn sàng. Vui lòng thử lại sau.",
        "Google sign-in is not available right now. Please try again later.",
      );
    case "AUTH_STALE":
      return t(
        "Phiên đăng nhập đã hết hạn. Hãy thử đăng nhập lại.",
        "The sign-in attempt expired. Please try again.",
      );
    case "AUTH_IDENTITY_CONFLICT":
      return t(
        "Email này đang gắn với một tài khoản khác nên chưa thể đăng nhập.",
        "This email is linked to a different account, so we could not sign you in.",
      );
    case "AUTH_INVALID":
    default:
      return t(
        "Không thể đăng nhập. Vui lòng thử lại.",
        "We could not sign you in. Please try again.",
      );
  }
}

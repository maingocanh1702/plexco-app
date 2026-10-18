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

/** Roster / manual-payment codes (lane M2c) after which a refetch is the right next step. */
const RELOAD_DOMAIN_CODES = new Set([
  "ALLOCATION_EXCEEDS_FUNDS",
  "ALLOCATION_NOT_FOUND",
  "CHARGE_ALREADY_SETTLED",
  "CHARGE_NOT_PAYABLE",
  "MARK_PAID_TOTAL_MISMATCH",
  "PLAYER_NOT_FOUND",
  "REVERSAL_EXCEEDS_EFFECTIVE",
  "STALE_VERSION",
]);

const DOMAIN_CODES = new Set([
  ...RELOAD_DOMAIN_CODES,
  "ALREADY_JOINED",
  "REJOIN_REQUIRES_REVIEW",
  "REMOVE_REQUIRES_REVIEW",
  "REVERSAL_NOT_SUPPORTED",
  // cancel-only since DD-131 OD-1 (a close refuses with CLOSE_BLOCKED_OPEN_DEBT instead)
  "CANCEL_REQUIRES_REVIEW",
  "CAPACITY_BELOW_OCCUPANCY",
  "CAPACITY_BELOW_ROSTER",
  // DD-39: the server's fixed, gender-free 503 text; GENDER_FORBIDDEN stays generic on purpose
  "CHARGE_DERIVATION_UNAVAILABLE",
  // the host collects the open balances and closes again: a domain refusal, never a reload
  "CLOSE_BLOCKED_OPEN_DEBT",
  "COMMAND_ID_CONFLICT",
  "INVALID_TIME_RANGE",
  "MISSING_DISCOVERY_FIELDS",
  "PRICE_CHANGE_REQUIRES_POLICY",
  "SESSION_NOT_OPEN",
  "SPORT_INACTIVE",
  "TENANT_SUSPENDED",
]);

/** One player of a CLOSE_BLOCKED_OPEN_DEBT list, validated for rendering. */
export interface OpenBalancePlayerView {
  playerId: string;
  /** null when the player has no display name (the screen then shows its unnamed placeholder). */
  displayName: string | null;
}

/**
 * The players a CLOSE_BLOCKED_OPEN_DEBT refusal names, or [] when the error is any other code or its
 * `details` is missing / empty / malformed. Fail closed: `details` crossed the network, so one bad
 * entry (not an object, missing or non-string playerId, a displayName that is neither string nor
 * null) voids the WHOLE list rather than showing a partial one a host could read as "only these owe";
 * the screen then renders the generic server message only. Nothing but id + name is ever read, so an
 * amount or any other key the server might add is never shown.
 */
export function openBalancePlayersOf(error: unknown): OpenBalancePlayerView[] {
  if (!(error instanceof ApiClientError) || error.code !== "CLOSE_BLOCKED_OPEN_DEBT") return [];
  const list: unknown = (error.details as { openBalancePlayers?: unknown } | undefined)
    ?.openBalancePlayers;
  if (!Array.isArray(list) || list.length === 0) return [];
  const players: OpenBalancePlayerView[] = [];
  const seen = new Set<string>();
  for (const entry of list as unknown[]) {
    if (typeof entry !== "object" || entry === null) return [];
    const { playerId, displayName } = entry as { playerId?: unknown; displayName?: unknown };
    if (typeof playerId !== "string" || playerId.length === 0) return [];
    if (displayName !== null && typeof displayName !== "string") return [];
    if (seen.has(playerId)) continue; // React key must be unique; a repeat adds no information
    seen.add(playerId);
    players.push({ playerId, displayName: displayName?.trim() ? displayName : null });
  }
  return players;
}

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
    return view(message, RELOAD_DOMAIN_CODES.has(code) ? "reload" : "none");
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

/**
 * Reversal-dialog variant (OD-5): reversal is owner-only until a grant UI exists, so FORBIDDEN there
 * tells the host to ask the club owner, which the generic "not allowed" text would not explain. No
 * internal permission key is shown.
 */
export function describeReverseError(error: unknown, t: TFn): ErrorView {
  const view = describeSessionError(error, t);
  if (view.code !== "FORBIDDEN") return view;
  return {
    ...view,
    message: t(
      "Chỉ chủ CLB mới hoàn tác được thanh toán. Hãy nhờ chủ CLB thực hiện.",
      "Only the club owner can reverse a payment. Ask the club owner to do it.",
    ),
  };
}

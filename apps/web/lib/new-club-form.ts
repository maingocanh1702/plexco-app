import type { TFn } from "./i18n-client";
import { stripInvisibleChars } from "./session-form-model";

/** Mirrors the server check in api/onboarding/start (and tenant_provision). */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;
export const MAX_NAME_CHARS = 120;
export const DEFAULT_TIMEZONE = "Asia/Ho_Chi_Minh";
/** Used until the browser's full IANA list is available (and where Intl.supportedValuesOf is not). */
export const SHORT_TIMEZONES = [
  "Asia/Ho_Chi_Minh",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Asia/Tokyo",
  "UTC",
];

/**
 * Option values for the time zone select. Chrome's `Intl.supportedValuesOf` returns CANONICAL ids
 * (it lists `Asia/Saigon`, not `Asia/Ho_Chi_Minh`), so the default must be added explicitly or the
 * <select> silently shows the first zone while the form state still holds the default.
 */
export function buildTimezoneOptions(supported: string[]): string[] {
  return [DEFAULT_TIMEZONE, ...supported.filter((zone) => zone !== DEFAULT_TIMEZONE)];
}

/** "Câu Lạc Bộ Cầu Lông Đống Đa" -> "cau-lac-bo-cau-long-dong-da" (<= 63 chars, no edge dashes). */
export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/g, "");
}

export interface NewClubValues {
  name: string;
  slug: string;
  timezone: string;
  locale: "vi" | "en";
}

export type NewClubErrors = Partial<Record<"name" | "slug", string>>;

export function validateNewClub(values: NewClubValues, t: TFn): NewClubErrors {
  const errors: NewClubErrors = {};
  // L27: strip first (the web mirror of the server list), then trim, as the server stores it.
  const name = stripInvisibleChars(values.name).trim();
  if (name.length === 0) errors.name = t("Nhập tên câu lạc bộ.", "Enter a club name.");
  else if (name.length > MAX_NAME_CHARS) {
    errors.name = t(
      `Tên tối đa ${MAX_NAME_CHARS} ký tự.`,
      `Name can be at most ${MAX_NAME_CHARS} characters.`,
    );
  }
  if (!SLUG_RE.test(values.slug.trim().toLowerCase())) {
    errors.slug = t(
      "Chỉ dùng chữ thường, số và dấu gạch ngang (2-63 ký tự).",
      "Use lowercase letters, digits and dashes only (2-63 characters).",
    );
  }
  return errors;
}

/** Maps an API error code from POST /api/onboarding/start; `null` means "redirect to sign-in" (no/invalid session). */
export function onboardingErrorMessage(code: string, t: TFn): string | null {
  switch (code) {
    case "AUTH_REQUIRED":
    case "AUTH_INVALID":
      return null;
    case "SLUG_TAKEN":
      return t(
        "Đường dẫn này đã có câu lạc bộ khác dùng. Hãy chọn đường dẫn khác.",
        "Another club already uses this address. Please pick a different one.",
      );
    case "RATE_LIMITED":
      return t(
        "Bạn thử quá nhiều lần. Vui lòng đợi một lát rồi thử lại.",
        "Too many attempts. Please wait a moment and try again.",
      );
    case "INVALID_BODY":
      return t(
        "Thông tin chưa hợp lệ. Kiểm tra lại tên và đường dẫn.",
        "Some details are invalid. Check the name and address.",
      );
    default:
      return t(
        "Không tạo được câu lạc bộ. Vui lòng thử lại.",
        "We could not create the club. Please try again.",
      );
  }
}

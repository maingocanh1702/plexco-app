/** sessions.price_amount is int4 (VND, no minor unit). */
export const INT4_MAX = 2_147_483_647;

/** Lowercase d-stroke (U+0111). Never the dong sign U+20AB, and never separated from the digits. */
const DONG = "\u0111";

/** Shown instead of an amount that cannot be rendered truthfully (never a rounded or guessed one). */
const NO_AMOUNT = "\u2014";

/**
 * Dot-grouped digits of a whole number ("1234567" -> "1.234.567", "-1000" -> "-1.000"), or null
 * when the value is not a safe integer (fractions, NaN, +-Infinity, > 2^53, non-numbers). Same
 * output for every UI language (DD-128 OD-4b): the payment bot's fmtMoney groups the same way.
 */
function groupDigits(amount: unknown): string | null {
  if (typeof amount !== "number" || !Number.isSafeInteger(amount)) return null;
  const digits = String(Math.abs(amount)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return amount < 0 ? `-${digits}` : digits; // -0 is not < 0, so it renders "0"
}

/**
 * THE one VND display formatter of the web (DD-128 OD-4b): "150.000đ" in vi AND en, dot thousands
 * separators, lowercase đ directly after the digits (no space of any kind). Fail-safe: a value that
 * is not a whole number renders as an em dash instead of a rounded, truncated or "NaN" amount.
 * Render inside an element with `font-variant-numeric: tabular-nums`.
 */
export function formatVnd(amount: number): string {
  const grouped = groupDigits(amount);
  return grouped === null ? NO_AMOUNT : `${grouped}${DONG}`;
}

/** Dot-grouped digits for an input box ("50.000", any language); "" for null or a non-whole value. */
export function formatVndInput(amount: number | null): string {
  return groupDigits(amount) ?? "";
}

/**
 * Digits-only parse of what the host typed or pasted ("50.000", "50,000", "50.000đ" all -> 50000).
 * "" -> null (empty); a value above int4 -> NaN (invalid, never silently clamped).
 */
export function parseVndInput(raw: string): number | null {
  const digits = raw.replace(/\D/g, "");
  if (digits === "") return null;
  const value = Number(digits);
  return Number.isSafeInteger(value) && value <= INT4_MAX ? value : Number.NaN;
}

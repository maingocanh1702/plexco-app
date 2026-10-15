import type { ClientLang } from "./i18n-client";

/** sessions.price_amount is int4 (VND, no minor unit). */
export const INT4_MAX = 2_147_483_647;

const locale = (lang: ClientLang) => (lang === "en" ? "en-US" : "vi-VN");

/** "50.000 ₫" (vi) / "₫50,000" (en). Render inside an element with `font-variant-numeric: tabular-nums`. */
export function formatVnd(amount: number, lang: ClientLang): string {
  return new Intl.NumberFormat(locale(lang), {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(amount);
}

/** Thousands-grouped digits for an input box ("50.000" vi / "50,000" en); "" for null. */
export function formatVndInput(amount: number | null, lang: ClientLang): string {
  if (amount === null) return "";
  return new Intl.NumberFormat(locale(lang), { maximumFractionDigits: 0 }).format(amount);
}

/**
 * Digits-only parse of what the host typed or pasted ("50.000", "50,000", "50 000 ₫" all -> 50000).
 * "" -> null (empty); a value above int4 -> NaN (invalid, never silently clamped).
 */
export function parseVndInput(raw: string): number | null {
  const digits = raw.replace(/\D/g, "");
  if (digits === "") return null;
  const value = Number(digits);
  return Number.isSafeInteger(value) && value <= INT4_MAX ? value : Number.NaN;
}

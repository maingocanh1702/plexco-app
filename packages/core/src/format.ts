/**
 * Pure display primitives shared by every surface.
 *
 * Lifted from the production single-club bot (src/format.ts) — ONLY the pure
 * helpers. The bot's DB-coupled render views (progressView, sessionStatusText,
 * sessionDetailText, ...) are NOT lifted: Plexco derives paid state from the
 * payment ledger, so those views are rebuilt per-surface on ledger-derived
 * read models in later slices.
 */

/** 110000 -> "110.000đ" (vi-VN grouping; money is integer minor units VND). */
export function fmtMoney(n: number): string {
  return n.toLocaleString("vi-VN") + "đ";
}

/** Escape user data for Telegram legacy-Markdown messages. */
export function esc(s: string): string {
  return s.replace(/([_*`[])/g, "\\$1");
}

/** Render user data as inline code, neutralizing backticks. */
export function mdCode(s: string): string {
  return "`" + s.replace(/`/g, "'") + "`";
}

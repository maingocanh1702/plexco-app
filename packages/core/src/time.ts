/**
 * Single source of truth for "today" + year inference.
 *
 * Lifted from the production single-club bot (src/time.ts). Uses process local
 * time (set `TZ=Asia/Ho_Chi_Minh` in env) so parsing matches user expectations.
 */

/** Local calendar date as ISO "YYYY-MM-DD". */
export function todayIso(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
}

/** If no year given: current year, or next year when the date is >30 days past. */
export function inferYear(month: number, day: number, now: Date = new Date()): number {
  const y = now.getFullYear();
  const candidate = new Date(y, month - 1, day);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  return candidate < thirtyDaysAgo ? y + 1 : y;
}

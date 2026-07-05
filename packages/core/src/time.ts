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

/** Local midnight for the given date's calendar day (drops the time-of-day part). */
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * If no year given: current year, or next year when the date is >30 days past.
 * Both sides of the cutoff are calendar-date-only (midnight) — comparing a
 * midnight candidate against a cutoff still carrying "now"'s time-of-day made
 * the effective threshold drift between 29 and 31 days depending on the clock.
 */
export function inferYear(month: number, day: number, now: Date = new Date()): number {
  const y = now.getFullYear();
  const candidate = new Date(y, month - 1, day);
  const thirtyDaysAgo = new Date(startOfDay(now).getTime() - 30 * 24 * 3600 * 1000);
  return candidate < thirtyDaysAgo ? y + 1 : y;
}

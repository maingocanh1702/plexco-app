import type { ClientLang } from "./i18n-client";

/**
 * Pure time helpers for the session screens. A session's wall-clock is meaningful only in ITS
 * IANA zone, so the browser's own zone is never consulted: `<input type="datetime-local">` text is
 * converted to an ISO string carrying the zone's explicit offset (the server rejects offset-less
 * strings), and instants are rendered back in that same zone with Intl.
 */

export const FALLBACK_TIMEZONE = "Asia/Ho_Chi_Minh";

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The zone to use when the club profile has none (or an unusable one). */
export function resolveTimeZone(tz: string | null | undefined): string {
  return tz && isValidTimeZone(tz) ? tz : FALLBACK_TIMEZONE;
}

const WALL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** Offset (ms, east positive) of `tz` at the instant `ms`. */
function offsetAt(ms: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: resolveTimeZone(tz), // a zone this browser's ICU lacks must not crash the page
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUtc - Math.floor(ms / 1000) * 1000;
}

function formatOffset(offsetMs: number): string {
  const sign = offsetMs < 0 ? "-" : "+";
  const minutes = Math.abs(offsetMs) / 60_000;
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return `${sign}${hh}:${mm}`;
}

/**
 * "2026-10-20T18:30" (wall clock in `tz`) -> "2026-10-20T18:30:00+07:00".
 * Returns null for malformed text, a non-existent date, or a wall time skipped by a DST gap.
 */
export function localInputToIso(local: string, tz: string): string | null {
  const m = WALL_RE.exec(local);
  if (!m || !isValidTimeZone(tz)) return null;
  const [year, month, day, hour, minute] = m.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  const check = new Date(wallAsUtc);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    check.getUTCHours() !== hour ||
    check.getUTCMinutes() !== minute
  ) {
    return null; // e.g. 2026-02-30 or 25:00
  }
  // Two-pass fixed point: the offset valid at the guess may differ from the one at the result.
  let offset = offsetAt(wallAsUtc, tz);
  let instant = wallAsUtc - offset;
  const second = offsetAt(instant, tz);
  if (second !== offset) {
    offset = second;
    instant = wallAsUtc - offset;
  }
  // Round-trip: a DST-gap wall time does not survive being read back in the zone.
  if (isoToLocalInput(new Date(instant).toISOString(), tz) !== local) return null;
  return `${local}:00${formatOffset(offset)}`;
}

/** ISO instant -> "YYYY-MM-DDTHH:mm" wall clock in `tz` (prefill for a datetime-local input). */
export function isoToLocalInput(iso: string, tz: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  const offset = offsetAt(ms, tz);
  return new Date(ms + offset).toISOString().slice(0, 16);
}

const locale = (lang: ClientLang) => (lang === "en" ? "en-GB" : "vi-VN");

/** "T3, 20/10/2026" style date in the session's zone. */
export function formatSessionDate(iso: string, tz: string, lang: ClientLang): string {
  return new Intl.DateTimeFormat(locale(lang), {
    timeZone: resolveTimeZone(tz),
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(iso));
}

export function formatSessionTime(iso: string, tz: string, lang: ClientLang): string {
  return new Intl.DateTimeFormat(locale(lang), {
    timeZone: resolveTimeZone(tz),
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

/** "T3, 20/10/2026 · 18:30–20:00" */
export function formatSessionRange(
  startsAt: string,
  endsAt: string,
  tz: string,
  lang: ClientLang,
): string {
  return `${formatSessionDate(startsAt, tz, lang)} · ${formatSessionTime(startsAt, tz, lang)}–${formatSessionTime(endsAt, tz, lang)}`;
}

/** Full timestamp for the details tab (createdAt / updatedAt). */
export function formatTimestamp(iso: string, tz: string, lang: ClientLang): string {
  return `${formatSessionDate(iso, tz, lang)} ${formatSessionTime(iso, tz, lang)}`;
}

/**
 * Flexible date/time/money parsing + display formatting ("2026 Jun 13").
 *
 * Lifted verbatim from the production single-club bot (src/dates.ts) — pure,
 * battle-tested against real Vietnamese bank-transfer/host input.
 */
import { inferYear } from "./time.js";

export const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * BOUNDED month-token alternation — matches exactly a short form or the real
 * full month name, never an arbitrary suffix: `(jun)[a-z]*` would turn
 * "MAYBANK 13"/"MARTIN 13" into dates and falsely boost payment confidence.
 * Wrap with token boundaries at the use site: (?<![a-z0-9]) … (?![a-z0-9]).
 * Single source — matching.ts reuses it for memo date extraction.
 */
export const MONTH_TOKEN_ALT =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?" +
  "|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const MONTH_RE = MONTH_TOKEN_ALT;

function toIso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** True only for real calendar dates — "31/2" or month 13 must never become an ISO string. */
function isRealDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

export interface ParsedDate {
  iso: string;
  /** leftover text after the date part (e.g. session name) */
  rest: string;
}

const deaccent = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const WEEKDAYS: Record<string, number> = {
  sun: 0,
  cn: 0,
  mon: 1,
  t2: 1,
  tue: 2,
  t3: 2,
  wed: 3,
  t4: 3,
  thu: 4,
  t5: 4,
  fri: 5,
  t6: 5,
  sat: 6,
  t7: 6,
};

/**
 * Parse a date at the START of `text`. Accepted forms:
 *   2026-06-13 | 2026 Jun 13 | Jun 13 2026 | Jun 13 | 13/6 | 13/6/2026
 *   today/hnay/hôm nay | tmr/tomorrow/mai/ngày mai
 *   sat/sun/... | t2..t7/cn  (next occurrence, today counts)
 * Returns null if no date found.
 */
export function parseFlexibleDate(text: string, now = new Date()): ParsedDate | null {
  const t = text.trim();
  let m: RegExpMatchArray | null;

  // relative keywords
  const dt = deaccent(t);
  const relative = (days: number, matchedLen: number): ParsedDate => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    return {
      iso: toIso(d.getFullYear(), d.getMonth() + 1, d.getDate()),
      rest: t.slice(matchedLen).trim(),
    };
  };
  if ((m = dt.match(/^(hom nay|today|tdy|hnay)\b/))) return relative(0, m[0].length);
  if ((m = dt.match(/^(ngay mai|tomorrow|tmr|mai)\b/))) return relative(1, m[0].length);
  if (
    (m = dt.match(
      /^(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|wed|thu|fri|sat|cn|t[2-7])\b/,
    ))
  ) {
    const key = m[1]!.startsWith("t") && /^t[2-7]$/.test(m[1]!) ? m[1]! : m[1]!.slice(0, 3);
    const target = WEEKDAYS[key];
    if (target !== undefined) {
      const diff = (target - now.getDay() + 7) % 7; // 0 = today
      return relative(diff, m[0].length);
    }
  }

  // 2026-06-13
  if ((m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})\b/))) {
    if (!isRealDate(+m[1]!, +m[2]!, +m[3]!)) return null;
    return { iso: toIso(+m[1]!, +m[2]!, +m[3]!), rest: t.slice(m[0].length).trim() };
  }
  // 2026 Jun 13
  if ((m = t.match(new RegExp(`^(\\d{4})\\s+(${MONTH_RE})(?![a-z0-9])\\s+(\\d{1,2})\\b`, "i")))) {
    const month = MONTHS[m[2]!.toLowerCase().slice(0, 3)]!;
    if (!isRealDate(+m[1]!, month, +m[3]!)) return null;
    return {
      iso: toIso(+m[1]!, month, +m[3]!),
      rest: t.slice(m[0].length).trim(),
    };
  }
  // Jun 13 2026 | Jun 13
  if (
    (m = t.match(new RegExp(`^(${MONTH_RE})(?![a-z0-9])\\s+(\\d{1,2})(?:\\s+(\\d{4}))?\\b`, "i")))
  ) {
    const month = MONTHS[m[1]!.toLowerCase().slice(0, 3)]!;
    const day = +m[2]!;
    const year = m[3] ? +m[3] : inferYear(month, day, now);
    if (!isRealDate(year, month, day)) return null;
    return { iso: toIso(year, month, day), rest: t.slice(m[0].length).trim() };
  }
  // 13/6 | 13-6 | 13/6/2026 (day first, VN convention)
  if ((m = t.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{4}))?\b/))) {
    const day = +m[1]!;
    const month = +m[2]!;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const year = m[3] ? +m[3] : inferYear(month, day, now);
      if (!isRealDate(year, month, day)) return null;
      return { iso: toIso(year, month, day), rest: t.slice(m[0].length).trim() };
    }
  }
  return null;
}

/** "2026-06-13" -> "2026 Jun 13" */
export function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${y} ${MONTH_NAMES[m! - 1]} ${d}`;
}

/** "2026-06-13" -> "Jun 13" (for transfer-content templates) */
export function fmtDateShort(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${MONTH_NAMES[m! - 1]} ${d}`;
}

/**
 * Parse a time at the START of `text`: "10:00", "10:00 AM", "7pm", "19h", "19h30".
 * Returns 24h "HH:MM" + leftover text, or null.
 */
export function parseTimeAtStart(text: string): { time: string; rest: string } | null {
  const t = text.trim();
  let m: RegExpMatchArray | null;
  let hour: number, minute: number, matchedLen: number;

  if ((m = t.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?(?=[\s\-–]|$)/i))) {
    hour = +m[1]!;
    minute = +m[2]!;
    matchedLen = m[0].length;
    const ap = m[3]?.toLowerCase();
    // 12-hour clock only goes 1..12 — "13pm"/"23:00pm" is invalid, never 24h
    if (ap && (hour < 1 || hour > 12)) return null;
    if (ap === "pm" && hour < 12) hour += 12;
    if (ap === "am" && hour === 12) hour = 0;
  } else if ((m = t.match(/^(\d{1,2})\s*(am|pm)(?=[\s\-–]|$)/i))) {
    hour = +m[1]!;
    minute = 0;
    matchedLen = m[0].length;
    if (hour < 1 || hour > 12) return null;
    if (m[2]!.toLowerCase() === "pm" && hour < 12) hour += 12;
    if (m[2]!.toLowerCase() === "am" && hour === 12) hour = 0;
  } else if ((m = t.match(/^(\d{1,2})h(\d{2})?(?=[\s\-–]|$)/i))) {
    hour = +m[1]!;
    minute = m[2] ? +m[2] : 0;
    matchedLen = m[0].length;
  } else {
    return null;
  }
  if (hour > 23 || minute > 59) return null;
  return {
    time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    rest: t.slice(matchedLen).trim(),
  };
}

/** "110k" | "110000" | "110.000" -> 110000 (integer minor units, VND) */
export function parseMoney(text: string): number | null {
  const t = text
    .trim()
    .toLowerCase()
    .replace(/[.,\s]/g, "");
  const m = t.match(/^(\d+)(k)?(?:vnd|d|đ)?$/);
  if (!m) return null;
  return +m[1]! * (m[2] ? 1000 : 1);
}

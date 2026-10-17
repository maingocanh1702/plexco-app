import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { DiscoveryKeyset } from "@plexco/db";

/**
 * The discovery list's opaque signed keyset cursor (readiness 4.4):
 * `v1.<b64url(startsAt|publicListingId)>.<b64url(HMAC-SHA256 of "v1.<payload>")>`.
 * It carries the keyset only, never a filter (filters are re-sent with every page). startsAt is
 * the DB's UTC microsecond text, so the keyset never passes through a JS Date (which truncates).
 * A rejection is `null` (the route answers INVALID_FILTER); a key configuration error throws
 * (the route answers 500).
 */
const VERSION = "v1";
const CURSOR_MAX_LENGTH = 256;
const KEY_MIN_LENGTH = 32;
// to_char(starts_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'); year 0000 is out (Postgres rejects it).
const KEYSET_STARTS_AT =
  /^[1-9]\d{3}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{6}Z$/;
const PUBLIC_LISTING_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let processKey: Buffer | null = null;

/** DISCOVERY_CURSOR_KEY, read at use time; unset or empty outside production => one random key per process. */
function cursorKey(): Buffer {
  const configured = process.env.DISCOVERY_CURSOR_KEY;
  if (configured) {
    if (configured.length < KEY_MIN_LENGTH) {
      throw new Error(`DISCOVERY_CURSOR_KEY must be at least ${KEY_MIN_LENGTH} characters`);
    }
    return Buffer.from(configured, "utf8");
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("DISCOVERY_CURSOR_KEY is required in production");
  }
  return (processKey ??= randomBytes(32));
}

function mac(head: string): string {
  return createHmac("sha256", cursorKey()).update(head).digest("base64url");
}

/** Resolve the key now: the list route calls it at entry, so a bad key is the 500 on every page. */
export function assertDiscoveryCursorKey(): void {
  cursorKey();
}

/** The public_listing_id shape (a uuid, any case): check it before a value reaches a ::uuid cast. */
export function isPublicListingId(value: string): boolean {
  return PUBLIC_LISTING_ID.test(value);
}

/** True for a real calendar day `YYYY-MM-DD` (Date would roll 2026-02-30 over into March). */
export function isCalendarDay(day: string): boolean {
  const ms = Date.parse(`${day}T00:00:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === day;
}

export function encodeDiscoveryCursor(keyset: DiscoveryKeyset): string {
  const payload = Buffer.from(`${keyset.startsAt}|${keyset.publicListingId}`, "utf8");
  const head = `${VERSION}.${payload.toString("base64url")}`;
  return `${head}.${mac(head)}`;
}

/** The keyset of an authentic v1 cursor, else null. The length gate runs before any key or MAC work. */
export function decodeDiscoveryCursor(cursor: string): DiscoveryKeyset | null {
  if (cursor.length > CURSOR_MAX_LENGTH) return null;
  const parts = cursor.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) return null;
  const [version, payload, given] = parts as [string, string, string];
  // Compare the MAC text, not decoded bytes: base64url decoding is lenient, the text is exact.
  const expected = Buffer.from(mac(`${version}.${payload}`));
  const actual = Buffer.from(given);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  const fields = Buffer.from(payload, "base64url").toString("utf8").split("|");
  if (fields.length !== 2) return null;
  const [startsAt, publicListingId] = fields as [string, string];
  if (!KEYSET_STARTS_AT.test(startsAt) || !isCalendarDay(startsAt.slice(0, 10))) return null;
  return isPublicListingId(publicListingId) ? { startsAt, publicListingId } : null;
}

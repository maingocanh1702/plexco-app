import { isIP } from "node:net";
import { t } from "@plexco/core/i18n";
import {
  createDb,
  DISCOVERY_PAGE_LIMIT_MAX,
  type DbHandle,
  type DiscoveryListFilter,
  type DiscoveryListingRow,
} from "@plexco/db";
import { err, NO_STORE, ok } from "./api-envelope";
import { decodeDiscoveryCursor, isCalendarDay } from "./discovery-cursor";
import { log } from "./log";
import { SESSION_NOT_FOUND_MESSAGE } from "./session-command-route";
import { clientIp } from "./session-cookies";

/**
 * Shared by the anonymous discovery routes (readiness 4.2-4.5, 4.7): the readonly handle, the
 * per-IP limiter, the list-query validator, the whitelist DTO and the error responses. Every
 * response is `cache-control: no-store`; nothing here logs a slug, a listing id, an IP or a person id.
 */

type Pool = DbHandle["pool"];
let discoveryHandle: DbHandle | null = null;
// The probed pool, or a poisoned handle's rejected promise, which then rejects every call.
let discoveryReady: Promise<Pool> | null = null;
// One probe (security N-1): Postgres answers a row only while current_user is NOSUPERUSER NOBYPASSRLS.
const ROLE_PROBE =
  "SELECT current_user AS u, session_user AS s FROM pg_roles r WHERE r.rolname = current_user AND NOT r.rolsuper AND NOT r.rolbypassrls";

/**
 * The readonly pool, behind an always-on, once-per-process assert awaited before the first query:
 * current_user and session_user are `readonly`, and current_user is neither SUPERUSER nor
 * BYPASSRLS. A missing DISCOVERY_DATABASE_URL or any other probe answer poisons the handle: every
 * call rejects and the route answers 500 (fail closed). An unavailable probe rejects only this
 * call; the next one re-probes the same handle.
 */
export function discoveryPool(): Promise<Pool> {
  return (discoveryReady ??= openDiscoveryPool());
}

async function openDiscoveryPool(): Promise<Pool> {
  const url = process.env.DISCOVERY_DATABASE_URL;
  if (!url) throw new Error("DISCOVERY_DATABASE_URL is not set: refusing to serve discovery");
  discoveryHandle ??= createDb(url, { max: 5 });
  const { rows } = await discoveryHandle.pool
    .query<{ u: string; s: string }>(ROLE_PROBE)
    .catch((error: unknown) => {
      discoveryReady = null;
      throw error;
    });
  const row = rows[0];
  if (!row || row.u !== "readonly" || row.s !== "readonly") {
    log.error("discovery.db.role.mismatch", { currentUser: row?.u, sessionUser: row?.s });
    throw new Error("DISCOVERY_DATABASE_URL is not a plain readonly role: refusing to serve");
  }
  return discoveryHandle.pool;
}

const DISCOVERY_RATE_LIMIT = 60;
const DISCOVERY_RATE_WINDOW_MS = 60_000;
const DISCOVERY_RATE_MAX_KEYS = 10_000;
// Every window has the same length, so insertion order is expiry order: a sweep stops at the
// first live window. Counters only, never a cache of responses.
const discoveryWindows = new Map<string, { count: number; resetAt: number }>();

/**
 * null while `discover:<key>` is within 60 requests per fixed 60 s window, else the 429; the key
 * is the clientIp, an IPv6 one cut to its /64 (rateLimitKey). clientIp throws on a production
 * ingress misconfiguration (the route answers 500).
 * ponytail: in-process counters, so the ceiling is per process and per replica and resets on
 * restart (locally every request shares the one bucket `local`). The map holds at most 10 000
 * live keys, and a full map answers 429 to every new key until windows expire (fail closed).
 * One holder of an IPv6 /48 (65 536 /64 keys, for example a free tunnel-broker allocation) or
 * many IPv4 sources can fill it, and then every new visitor is refused until up to one window
 * after the filling stops. That is the readiness O-6 ceiling of an in-process, per-replica
 * limiter, so the exposure precondition is: no process that serves /api/discover* (the discovery
 * process or the web process, each holding its own copy of this map) is exposed beyond local
 * until this in-process limiter is replaced by the O-6 readonly-executable DB limiter (an owner
 * migration), or by an ingress limit that counts each IPv6 /48 as one client; that is the upgrade
 * path. A per-IP edge limit in front of this map does not close the fill (one request per /64 per
 * window is enough). A per-/48 sub-cap was considered and not built, because the durable limiter
 * replaces this one.
 */
export function discoveryRateLimited(request: Request): Response | null {
  const key = `discover:${rateLimitKey(clientIp(request))}`;
  const now = Date.now();
  let bucket = discoveryWindows.get(key);
  if (bucket && bucket.resetAt <= now) {
    discoveryWindows.delete(key);
    bucket = undefined;
  }
  if (!bucket) {
    for (const [staleKey, stale] of discoveryWindows) {
      if (stale.resetAt > now) break;
      discoveryWindows.delete(staleKey);
    }
    // Still full of live windows: limited (fail closed); each of them ends within one window.
    if (discoveryWindows.size >= DISCOVERY_RATE_MAX_KEYS) {
      return rateLimitedResponse(DISCOVERY_RATE_WINDOW_MS / 1000);
    }
    bucket = { count: 0, resetAt: now + DISCOVERY_RATE_WINDOW_MS };
    discoveryWindows.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count <= DISCOVERY_RATE_LIMIT) return null;
  return rateLimitedResponse(Math.ceil((bucket.resetAt - now) / 1000));
}

/**
 * The limiter key of a clientIp value: an IPv6 address is its /64, the first four hextets of the
 * fully expanded address, so every spelling of one /64 shares a key. An IPv4-mapped address
 * (::ffff:a.b.c.d or its hex form ::ffff:XXXX:XXXX) is keyed as the plain a.b.c.d, never as the
 * /64 0000:0000:0000:0000 that every mapped client would share. The non-mapped IPv4-in-IPv6
 * forms (::a.b.c.d, ::ffff:0:a.b.c.d, 64:ff9b::a.b.c.d) keep their /64 key, so the clients of
 * each such form share one bucket; no supported ingress writes them. IPv4 and the non-IP
 * fallbacks (`local`, `fly:untrusted`, ...) are unchanged.
 */
function rateLimitKey(ip: string): string {
  if (isIP(ip) !== 6) return ip;
  const [address = ""] = ip.toLowerCase().split("%"); // drop a zone index
  const [head = "", tail] = address.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  // `::` stands for the missing zero hextets; a dotted IPv4 tail fills two.
  const missing = 8 - left.length - right.length - (right.at(-1)?.includes(".") ? 1 : 0);
  const hextets =
    tail === undefined ? left : [...left, ...Array<string>(missing).fill("0"), ...right];
  const padded = hextets.map((hextet) => hextet.padStart(4, "0")); // a dotted tail stays as is
  if (padded.slice(0, 6).join(":") === "0000:0000:0000:0000:0000:ffff") {
    const [high = "", low] = padded.slice(6);
    if (low === undefined) return high; // ::ffff:a.b.c.d
    return [high.slice(0, 2), high.slice(2), low.slice(0, 2), low.slice(2)]
      .map((byte) => parseInt(byte, 16))
      .join(".");
  }
  return padded.slice(0, 4).join(":");
}

function rateLimitedResponse(retryAfterSeconds: number): Response {
  const response = err(
    "DISCOVERY_RATE_LIMITED",
    t("Quá nhiều truy vấn, thử lại sau.", "Too many requests, try again later."),
    429,
  );
  response.headers.set("retry-after", String(retryAfterSeconds));
  return response;
}

const DISCOVERY_PAGE_LIMIT_DEFAULT = 20;
const DISCOVERY_MAX_PRICE = 100_000_000;
const DISCOVERY_AREA_MAX_LENGTH = 64;
const SPORT_KEY = /^[a-z][a-z0-9_]{0,31}$/;
const CONTROL_OR_BIDI = /[\p{Cc}\p{Bidi_Control}]/u;
const NON_NEGATIVE_INTEGER = /^(?:0|[1-9]\d{0,8})$/;
// ISO 8601 with an explicit offset (Z or +-HH:MM); seconds and milliseconds optional; no year 0000.
const FILTER_INSTANT =
  /^([1-9]\d{3}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01]))T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

function parseFilterInstant(value: string): Date | null {
  const day = FILTER_INSTANT.exec(value)?.[1];
  // A FILTER_INSTANT match on a real calendar day is always a valid Date.
  return day && isCalendarDay(day) ? new Date(value) : null;
}

/**
 * The list query (readiness 4.4), validated before any DB call. null => INVALID_FILTER: an
 * unknown param (skill and level_* included), a repeated one, or a bad value. A cursor-key
 * configuration error throws (the route answers 500).
 */
export function parseDiscoveryListQuery(params: URLSearchParams): DiscoveryListFilter | null {
  const filter: DiscoveryListFilter = { limit: DISCOVERY_PAGE_LIMIT_DEFAULT };
  const seen = new Set<string>();
  for (const [name, value] of params) {
    if (seen.has(name)) return null;
    seen.add(name);
    switch (name) {
      case "sport":
        if (!SPORT_KEY.test(value)) return null;
        filter.sport = value;
        break;
      case "area": {
        const area = value.trim();
        if (!area || area.length > DISCOVERY_AREA_MAX_LENGTH || CONTROL_OR_BIDI.test(area)) {
          return null;
        }
        filter.area = area;
        break;
      }
      case "start_after":
      case "start_before": {
        const at = parseFilterInstant(value);
        if (!at) return null;
        if (name === "start_after") filter.startAfter = at;
        else filter.startBefore = at;
        break;
      }
      case "max_price":
        if (!NON_NEGATIVE_INTEGER.test(value) || Number(value) > DISCOVERY_MAX_PRICE) return null;
        filter.maxPrice = Number(value);
        break;
      case "available_only":
        if (value !== "true" && value !== "false") return null;
        filter.availableOnly = value === "true";
        break;
      case "limit": {
        const limit = Number(value);
        if (!NON_NEGATIVE_INTEGER.test(value) || limit < 1 || limit > DISCOVERY_PAGE_LIMIT_MAX) {
          return null;
        }
        filter.limit = limit;
        break;
      }
      case "cursor": {
        const after = decodeDiscoveryCursor(value);
        if (!after) return null;
        filter.after = after;
        break;
      }
      default:
        return null;
    }
  }
  const { startAfter, startBefore } = filter;
  return startAfter && startBefore && startAfter > startBefore ? null : filter;
}

/** DD-41 columns, served only when non-NULL (all NULL today, P-1). */
const OPTIONAL_DTO_KEYS = [
  ["title", "title"],
  ["sessionType", "session_type"],
  ["levelMinRank", "level_min_rank"],
  ["levelMaxRank", "level_max_rank"],
  ["levelStrict", "level_strict"],
  ["genderRestriction", "gender_restriction"],
  ["ageMin", "age_min"],
  ["ageMax", "age_max"],
] as const;

/** The whitelist DTO (readiness 4.4), built key by key: a column the view gains is never served. */
export function toDiscoveryListingDto(
  row: DiscoveryListingRow,
): Record<string, string | number | boolean> {
  const dto: Record<string, string | number | boolean> = {
    publicListingId: row.public_listing_id,
    sportKey: row.sport_key,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    area: row.area,
    priceAmount: row.price_amount,
    slotsOpen: row.slots_open,
    clubDisplayName: row.club_display_name,
    joinPolicy: row.join_policy,
  };
  for (const [key, column] of OPTIONAL_DTO_KEYS) {
    const value = row[column];
    if (value !== null) dto[key] = value;
  }
  return dto;
}

/** The ONE miss response (readiness 4.5): every miss shares status, headers and body, bar meta.requestId. */
export function discoveryNotFound(): Response {
  return err("NOT_FOUND", t(SESSION_NOT_FOUND_MESSAGE[0], SESSION_NOT_FOUND_MESSAGE[1]), 404);
}

export function discoveryInvalidFilter(): Response {
  return err("INVALID_FILTER", t("Bộ lọc không hợp lệ.", "Invalid filter."), 400);
}

/** A configuration or database failure: an empty 500 (fail closed, nothing to leak). */
export function discoveryServerError(): Response {
  return new Response(null, { status: 500, headers: { "cache-control": NO_STORE } });
}

/**
 * One-listing GET (readiness 4.5), shared by the detail and share routes so both answer alike:
 * the limiter, the shape check before any DB call, then the whitelist `{ listing }` or the ONE
 * 404. Any failure is the empty 500; the key is never logged.
 */
export async function serveDiscoveryListing(
  request: Request,
  key: string,
  wellFormed: (key: string) => boolean,
  read: (pool: Pool, key: string) => Promise<DiscoveryListingRow | null>,
): Promise<Response> {
  try {
    const limited = discoveryRateLimited(request);
    if (limited) return limited;
    if (!wellFormed(key)) return discoveryNotFound();
    const row = await read(await discoveryPool(), key);
    return row ? ok({ listing: toDiscoveryListingDto(row) }) : discoveryNotFound();
  } catch {
    return discoveryServerError();
  }
}

/** Test seam: forget the limiter windows and the readonly handle, a poisoned one included. */
export function resetDiscoveryRouteSupportForTests(): void {
  discoveryWindows.clear();
  discoveryHandle = null;
  discoveryReady = null;
}

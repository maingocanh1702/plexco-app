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
import { clientIp, type TrustedIngressProvider } from "./session-cookies";

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
// Readiness 6.3 (R6): the server cancels a discovery statement past 2 s (57014), a saturated pool
// rejects an acquire after 2 s, and the client gives up 0.5 s after the server cancel was due.
const DISCOVERY_STATEMENT_TIMEOUT_MS = 2_000;
const DISCOVERY_ACQUIRE_TIMEOUT_MS = 2_000;
const DISCOVERY_QUERY_TIMEOUT_MS = 2_500;

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
  discoveryHandle ??= createDb(url, {
    max: 5,
    statement_timeout: DISCOVERY_STATEMENT_TIMEOUT_MS,
    connectionTimeoutMillis: DISCOVERY_ACQUIRE_TIMEOUT_MS,
    query_timeout: DISCOVERY_QUERY_TIMEOUT_MS,
  });
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

// Readiness 6.3 and 8.1: 5 failures in a fixed 10 s window open the breaker for 30 s, then 1 probe.
const DISCOVERY_BREAKER_FAILURES = 5;
const DISCOVERY_BREAKER_WINDOW_MS = 10_000;
const DISCOVERY_BREAKER_OPEN_MS = 30_000;
const DISCOVERY_BREAKER_HALF_OPEN_PROBES = 1;

interface DiscoveryBreaker {
  state: "CLOSED" | "OPEN" | "HALF_OPEN";
  failures: number; // counted in the fixed window that ends at windowEndsAt
  windowEndsAt: number;
  openUntil: number;
  probes: number; // admitted in the current HALF_OPEN period
  generation: number; // carried by every admitted call: a stale outcome is ignored (row 11)
}
const closedBreaker = (generation: number): DiscoveryBreaker => ({
  state: "CLOSED",
  failures: 0,
  windowEndsAt: 0,
  openUntil: 0,
  probes: 0,
  generation,
});
// One breaker per process (readiness 8.1), on Date.now() so fake timers drive it.
let breaker = closedBreaker(0);

/** The empty 503 (readiness 8.2): no-store, with retry-after when the breaker refused the call. */
function discoveryUnavailable(retryAfterSeconds?: number): Response {
  const headers: Record<string, string> = { "cache-control": NO_STORE };
  if (retryAfterSeconds !== undefined) headers["retry-after"] = String(retryAfterSeconds);
  return new Response(null, { status: 503, headers });
}

function openBreaker(now: number): void {
  breaker.state = "OPEN";
  breaker.openUntil = now + DISCOVERY_BREAKER_OPEN_MS;
  breaker.generation += 1;
}

/** Admission (readiness 8.1 rows 1 and 6-8, 12): an admitted call's generation, else the 503. */
function admitDiscoveryCall(now: number): number | Response {
  if (breaker.state === "OPEN" && now >= breaker.openUntil) {
    breaker.state = "HALF_OPEN"; // row 7
    breaker.probes = 0;
    breaker.generation += 1;
  }
  switch (breaker.state) {
    case "CLOSED":
      return breaker.generation; // row 1
    case "OPEN":
      return discoveryUnavailable(Math.ceil((breaker.openUntil - now) / 1000)); // row 6
    case "HALF_OPEN":
      if (breaker.probes >= DISCOVERY_BREAKER_HALF_OPEN_PROBES) return discoveryUnavailable(1); // row 8
      breaker.probes += 1; // row 7: this call is the probe
      return breaker.generation;
    default: {
      const unknown: never = breaker.state;
      log.error("discovery.breaker.state.unknown", { state: String(unknown) });
      openBreaker(now); // row 12: as OPEN, a real open period, then rows 6, 7 and 9
      return discoveryUnavailable(Math.ceil(DISCOVERY_BREAKER_OPEN_MS / 1000));
    }
  }
}

/** An admitted call's outcome (readiness 8.1 rows 2-5 and 9-11). */
function settleDiscoveryCall(generation: number, failed: boolean): void {
  if (generation !== breaker.generation) return; // row 11: a stale outcome changes nothing
  const now = Date.now();
  if (breaker.state === "HALF_OPEN") {
    // row 10: the probe failed, a fresh open period; row 9: it succeeded, closed with count 0
    if (failed) openBreaker(now);
    else breaker = closedBreaker(breaker.generation + 1);
    return;
  }
  if (!failed) return; // row 2: a success keeps the count
  if (now >= breaker.windowEndsAt) {
    breaker.failures = 0; // row 3: a fixed window from now
    breaker.windowEndsAt = now + DISCOVERY_BREAKER_WINDOW_MS;
  }
  breaker.failures += 1; // row 4
  if (breaker.failures >= DISCOVERY_BREAKER_FAILURES) openBreaker(now); // row 5
}

/**
 * The ONE choke point of every discovery DB call (readiness 8.1): the limiter and the API reads.
 * The breaker admits the call or answers its 503. A rejection of an admitted call is a failure and
 * any resolved value a success; a counted failure rethrows, or answers `failed()` when given. A
 * discoveryPool() rejection is not counted, bar the probe's (row 10), and rethrows (the base 500).
 */
export async function discoveryQuery<T>(
  run: (pool: Pool) => Promise<T>,
  failed?: () => Response,
): Promise<T | Response> {
  const generation = admitDiscoveryCall(Date.now());
  if (generation instanceof Response) return generation;
  const pool = await discoveryPool().catch((error: unknown) => {
    if (breaker.state === "HALF_OPEN") settleDiscoveryCall(generation, true);
    throw error;
  });
  try {
    const value = await run(pool);
    settleDiscoveryCall(generation, false);
    return value;
  } catch (error) {
    settleDiscoveryCall(generation, true);
    if (failed) return failed();
    throw error;
  }
}

// Mirrors 0075:66 DISCOVERY_RATE_WINDOW_SECONDS; 0075:73's retry-after is at most one window.
const DISCOVERY_RATE_WINDOW_SECONDS = 60;

/**
 * null when the request may proceed, else its answer (readiness 6.1, 8.2); every discovery call
 * site awaits it before its read. The durable limiter `discovery_rate_limit_hit` (0075) counts
 * the key per clock-aligned 60 s window in one table for every process and replica, and
 * closes the /64 fill: one /48 never holds more than half of the table, and a full table refuses
 * every new key (fail closed). The key is discoveryRateLimitKey(request), passed bare (0075:82-85),
 * never a slug or a listing id, and is never logged. 0 => null; 1..60 => the 429 with that
 * retry-after; any other result, a query failure or the breaker => the empty 503. A clientIp
 * misconfiguration (production) or a discoveryPool() failure rejects: the caller's 500.
 */
export async function discoveryRateLimited(request: Request): Promise<Response | null> {
  const key = discoveryRateLimitKey(request);
  const retryAfter = await discoveryQuery(async (pool) => {
    const { rows } = await pool.query<{ discovery_rate_limit_hit: unknown }>(
      "SELECT discovery_rate_limit_hit($1)",
      [key],
    );
    const value = rows[0]?.discovery_rate_limit_hit;
    // Only an integer in 0..DISCOVERY_RATE_WINDOW_SECONDS is an answer: NULL (Number(null) is 0)
    // fails closed.
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < 0 ||
      value > DISCOVERY_RATE_WINDOW_SECONDS
    ) {
      throw new Error("discovery limiter: invalid result");
    }
    return value;
  }, discoveryUnavailable);
  if (typeof retryAfter !== "number") return retryAfter;
  return retryAfter === 0 ? null : rateLimitedResponse(retryAfter);
}

/**
 * The ONE builder of the limiter key, and the whole key expression of discoveryRateLimited: the
 * clientIp value (an undefined provider keeps clientIp's default), an IPv6 one cut to its /64
 * (rateLimitKey). 0075:82-85 accepts only these bare forms and RAISEs 22023 on any other, a
 * `discover:` prefix included; discovery-rate-limit-key-db.test.ts pins each form against it.
 */
export function discoveryRateLimitKey(request: Request, provider?: TrustedIngressProvider): string {
  return rateLimitKey(clientIp(request, provider));
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
  // 0067 (DD-139 / B1): present only when the projector wrote them (hide_exact_address OFF and a venue typed); the null-drop below keeps them absent otherwise
  ["venueName", "venue_name"],
  ["venueAddress", "venue_address"],
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
 * the limiter (keyed by client IP, never the request key) is the one DB call before the shape
 * check, then the read through the breaker gives the whitelist `{ listing }` or the ONE 404. Any
 * other failure is the empty 500; the key is never logged.
 */
export async function serveDiscoveryListing(
  request: Request,
  key: string,
  wellFormed: (key: string) => boolean,
  read: (pool: Pool, key: string) => Promise<DiscoveryListingRow | null>,
): Promise<Response> {
  try {
    const limited = await discoveryRateLimited(request);
    if (limited) return limited;
    if (!wellFormed(key)) return discoveryNotFound();
    const row = await discoveryQuery((pool) => read(pool, key));
    if (row instanceof Response) return row;
    return row ? ok({ listing: toDiscoveryListingDto(row) }) : discoveryNotFound();
  } catch {
    return discoveryServerError();
  }
}

/** Test seam: clear the breaker and forget the readonly handle, a poisoned one included. */
export function resetDiscoveryRouteSupportForTests(): void {
  breaker = closedBreaker(breaker.generation + 1); // a call still in flight settles as stale
  discoveryHandle = null;
  discoveryReady = null;
}

/** Test seam (readiness 8.1 rows 10, 12): write only breaker.state, an unknown one included. */
export function setDiscoveryBreakerStateForTests(state: string): void {
  breaker.state = state as DiscoveryBreaker["state"];
}

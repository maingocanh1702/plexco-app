import { ApiClientError, CLIENT_BAD_RESPONSE, apiFetch } from "./api-client";

/**
 * Read client for the public discovery pages and the public join command (L12), and the small parse
 * layer me-player-api.ts shares. Every response is rebuilt key by key from the whitelisted DTO
 * fields, so a key the server must never send (gender, a per-gender price, bank or QR data, a pay
 * link) cannot reach a screen. A missing or wrongly typed value stays null and renders as "not
 * available", never as 0; a row without the keys a screen cannot work without fails the whole read
 * as CLIENT_BAD_RESPONSE. Every call gives up after 15 s as CLIENT_NETWORK_ERROR (P-15).
 */

const TIMEOUT_MS = 15_000;

export type Rec = Record<string, unknown>;

/** A plain JSON object, else null. */
export const rec = (value: unknown): Rec | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Rec) : null;

/** A non-empty string, else null. */
export const str = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

/** A safe integer, else null: a missing, fractional or unsafe amount is never turned into 0. */
export const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) ? value : null;

/** The value when it is one of `allowed`, else null (an unknown enum value has no label). */
export function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return allowed.find((candidate) => candidate === value) ?? null;
}

/** The server answered 200 but not with the shape this client was built for. */
export const badResponse = (): ApiClientError =>
  new ApiClientError(CLIENT_BAD_RESPONSE, "Unexpected response", 200);

/** The string values of `keys`, or null when any one is missing (the row is unusable). */
export function required<K extends string>(
  row: Rec | null,
  keys: readonly K[],
): Record<K, string> | null {
  if (!row) return null;
  const picked = {} as Record<K, string>;
  for (const key of keys) {
    const value = str(row[key]);
    if (value === null) return null;
    picked[key] = value;
  }
  return picked;
}

/** Every element through `parse`; a body that is not a list fails the read. */
export function rows<T>(value: unknown, parse: (row: unknown) => T): T[] {
  if (!Array.isArray(value)) throw badResponse();
  return value.map((row) => parse(row));
}

/** GET `path` and return the envelope's data. */
export const readData = (path: string): Promise<unknown> =>
  apiFetch<unknown>(path, { signal: AbortSignal.timeout(TIMEOUT_MS) });

export interface DiscoveryListing {
  /** The opaque public key of the listing; never a session id. Keys the detail page and the join. */
  publicListingId: string;
  sportKey: string;
  startsAt: string;
  endsAt: string;
  title: string | null;
  area: string | null;
  clubDisplayName: string | null;
  priceAmount: number | null;
  slotsOpen: number | null;
  joinPolicy: "open" | "approval" | null;
  // DD-139 / B1: present when the host left hide_exact_address OFF and typed a venue; absent (null here) otherwise.
  venueName: string | null;
  venueAddress: string | null;
}

export interface DiscoveryPage {
  items: DiscoveryListing[];
  nextCursor: string | null;
}

export interface PublicJoinResult {
  outcome: "active" | "waitlisted" | "requested" | null;
  /** Only with a waitlisted seat. */
  waitlistPosition: number | null;
}

export interface DiscoveryFilter {
  sport?: string;
  area?: string;
  startAfter?: string;
  startBefore?: string;
  maxPrice?: number;
  availableOnly?: boolean;
  limit?: number;
  cursor?: string;
}

const JOIN_POLICIES = ["open", "approval"] as const;
const JOIN_OUTCOMES = ["active", "waitlisted", "requested"] as const;

function parseListing(value: unknown): DiscoveryListing {
  const row = rec(value);
  const keys = required(row, ["publicListingId", "sportKey", "startsAt", "endsAt"]);
  if (!row || !keys) throw badResponse();
  return {
    ...keys,
    title: str(row.title),
    area: str(row.area),
    clubDisplayName: str(row.clubDisplayName),
    priceAmount: num(row.priceAmount),
    slotsOpen: num(row.slotsOpen),
    joinPolicy: oneOf(row.joinPolicy, JOIN_POLICIES),
    venueName: str(row.venueName),
    venueAddress: str(row.venueAddress),
  };
}

/** The set filters as the server's snake_case params; "" when none is set. */
function discoveryQuery(filter: DiscoveryFilter): string {
  const params = new URLSearchParams();
  const set = (key: string, value: string | number | undefined) => {
    if (value !== undefined && value !== "") params.set(key, String(value));
  };
  set("sport", filter.sport);
  set("area", filter.area);
  set("start_after", filter.startAfter);
  set("start_before", filter.startBefore);
  set("max_price", filter.maxPrice);
  set("available_only", filter.availableOnly ? "true" : undefined);
  set("limit", filter.limit);
  set("cursor", filter.cursor);
  const query = params.toString();
  return query ? `?${query}` : "";
}

export async function listDiscovery(filter: DiscoveryFilter = {}): Promise<DiscoveryPage> {
  const data = rec(await readData(`/api/discover${discoveryQuery(filter)}`));
  return { items: rows(data?.items, parseListing), nextCursor: str(data?.nextCursor) };
}

export async function getDiscoveryListing(publicListingId: string): Promise<DiscoveryListing> {
  const data = rec(await readData(`/api/discover/${encodeURIComponent(publicListingId)}`));
  return parseListing(data?.listing);
}

/** Posts only the commandId; the result keeps the outcome and, for a waitlisted seat, the position. */
export async function joinPublicListing(
  publicListingId: string,
  { commandId, csrfToken }: { commandId: string; csrfToken: string | null },
): Promise<PublicJoinResult> {
  const data = rec(
    await apiFetch<unknown>(`/api/public-listings/${encodeURIComponent(publicListingId)}/join`, {
      method: "POST",
      json: { commandId },
      csrfToken,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }),
  );
  const join = rec(data?.join);
  if (!join) throw badResponse();
  const outcome = oneOf(join.outcome, JOIN_OUTCOMES);
  return {
    outcome,
    waitlistPosition: outcome === "waitlisted" ? num(join.waitlistPosition) : null,
  };
}

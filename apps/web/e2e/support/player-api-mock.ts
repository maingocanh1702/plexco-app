import type { Page } from "@playwright/test";
import type { DiscoveryListing } from "../../lib/discover-api";
import type { MySession } from "../../lib/me-player-api";
import { installApiMock, signIn, type MockError, type RecordedCall } from "./session-api-mock";

/**
 * page.route mocks for the player pages (L12): discovery, the public join, the /me reads and the
 * host join-request inbox. Data-driven: a route table, one standing reply per route, and one-shot
 * failures and holds. The session, sports and host-session routes stay in session-api-mock.ts,
 * installed first, so the catch-all below wins on overlap and falls back for every other path.
 * Nothing here formats an amount: the money guard scans this file.
 */
const ROUTES = {
  discover: ["GET", /^\/api\/discover$/],
  discoverDetail: ["GET", /^\/api\/discover\/[^/]+$/],
  join: ["POST", /^\/api\/public-listings\/[^/]+\/join$/],
  meClubs: ["GET", /^\/api\/me\/clubs$/],
  meSessions: ["GET", /^\/api\/me\/sessions$/],
  meCharges: ["GET", /^\/api\/me\/charges$/],
  meRequests: ["GET", /^\/api\/me\/requests$/],
  hostRequests: ["GET", /^\/api\/sessions\/[^/]+\/join-requests$/],
  approve: ["POST", /^\/api\/join-requests\/[^/]+\/approve$/],
  reject: ["POST", /^\/api\/join-requests\/[^/]+\/reject$/],
} as const satisfies Record<string, readonly [string, RegExp]>;
export type RouteKey = keyof typeof ROUTES;
const KEYS = Object.keys(ROUTES) as RouteKey[];

/** What a route answers: a 200 envelope (ready, or empty with an empty list), an error, or a dropped connection. */
export type Reply = { data: unknown } | { error: MockError } | "network";
export const ok = (data: unknown): Reply => ({ data });
export const fail = (code: string, statusCode: number): Reply => ({
  error: { code, message: code, statusCode },
});
export const NETWORK: Reply = "network";

const DAY = 86_400_000;
const iso = (days: number, hours = 0) =>
  new Date(Date.now() + days * DAY + hours * 3_600_000).toISOString();

export const LISTING_ID = "pl-e2e-1";
export const PRICE = 60_000;
export const VENUE = "Sân Phú Mỹ Hưng";
/** Overrides may carry one injected key that no whitelist holds (a venue, a gender, a bank string). */
type Wire<T> = Partial<T> & Record<string, unknown>;

export const listing = (over: Wire<DiscoveryListing> = {}) => ({
  publicListingId: LISTING_ID,
  sportKey: "badminton",
  startsAt: iso(2),
  endsAt: iso(2, 2),
  title: "Cầu lông tối thứ 5",
  area: "Quận 7",
  clubDisplayName: "CLB Cầu Lông Test",
  priceAmount: PRICE,
  slotsOpen: 4,
  joinPolicy: "open",
  ...over,
});

export const mySession = (over: Wire<MySession> = {}) => ({
  sessionId: "sess-e2e-1",
  clubRef: "club-e2e",
  clubLabel: "CLB Cầu Lông Test",
  sportKey: "badminton",
  startsAt: iso(2),
  endsAt: iso(2, 2),
  timezone: "Asia/Ho_Chi_Minh",
  area: "Quận 7",
  myStatus: "active",
  waitlistPosition: null,
  venueName: VENUE,
  venueAddress: "12 Nguyễn Văn Linh",
  ...over,
});

/** One club with one open charge of PRICE; `extra` is merged into the club's status. */
export const myCharges = (extra: Record<string, unknown> = {}) => {
  const asOf = iso(0);
  const item = {
    sessionRef: "sess-e2e-1",
    startsAt: iso(2),
    amountDue: PRICE,
    amountAllocated: 0,
    remaining: PRICE,
    status: "open",
  };
  const known = { kind: "known_amount", currency: "VND", totalOutstanding: PRICE, asOf };
  return {
    summary: { ...known, clubCount: 1 },
    clubs: [
      {
        clubRef: "club-e2e",
        clubLabel: "CLB Cầu Lông Test",
        status: { ...known, chargeCount: 1, items: [item], ...extra },
      },
    ],
  };
};

/** The discovery routes' ready replies: one open listing and an instant `active` join. */
export const READY: Partial<Record<RouteKey, Reply>> = {
  discover: ok({ items: [listing()], nextCursor: null }),
  discoverDetail: ok({ listing: listing() }),
  join: ok({ join: { outcome: "active", waitlistPosition: null }, replayed: false }),
};

export type PlayerCall = RecordedCall & { key: RouteKey };

export interface PlayerApi {
  calls: PlayerCall[];
  callsTo(key: RouteKey): PlayerCall[];
  /** Replaces the standing reply of a route. */
  reply(key: RouteKey, reply: Reply): void;
  /** The next request to this route is answered with `reply` instead (consumed once). */
  failNext(key: RouteKey, reply: Reply): void;
  /** The next request to this route waits until the returned resolver is called (consumed once). */
  holdNext(key: RouteKey): () => void;
}

/**
 * Signs the browser in (cookie + session mock) unless `signedIn` is false, then answers the player
 * routes: `replies` over READY. An unstubbed route answers 500 E2E_NOT_STUBBED, so a test fails loudly.
 */
export async function installPlayerApi(
  page: Page,
  replies: Partial<Record<RouteKey, Reply>> = {},
  opts: { signedIn?: boolean } = {},
): Promise<PlayerApi> {
  if (opts.signedIn ?? true) {
    await signIn(page.context());
    await installApiMock(page, []);
  }
  const standing = new Map(Object.entries({ ...READY, ...replies }) as [RouteKey, Reply][]);
  const once = new Map<RouteKey, Reply[]>();
  const holds = new Map<RouteKey, Promise<void>[]>();
  const api: PlayerApi = {
    calls: [],
    callsTo: (key) => api.calls.filter((c) => c.key === key),
    reply(key, reply) {
      standing.set(key, reply);
    },
    failNext(key, reply) {
      once.set(key, [...(once.get(key) ?? []), reply]);
    },
    holdNext(key) {
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      holds.set(key, [...(holds.get(key) ?? []), gate]);
      return release;
    },
  };

  await page.route(
    (url) => url.pathname.startsWith("/api/"),
    async (route) => {
      const request = route.request();
      const { pathname, searchParams } = new URL(request.url());
      const method = request.method();
      const key = KEYS.find((k) => ROUTES[k][0] === method && ROUTES[k][1].test(pathname));
      if (!key) return route.fallback();
      const raw = request.postData();
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
      api.calls.push({ key, method, path: pathname, query: searchParams, body });

      await holds.get(key)?.shift();
      const reply = once.get(key)?.shift() ?? standing.get(key) ?? fail("E2E_NOT_STUBBED", 500);
      if (reply === "network") return route.abort("internetdisconnected");
      const failed = "error" in reply;
      return route.fulfill({
        status: failed ? reply.error.statusCode : 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: failed ? null : reply.data,
          error: failed ? reply.error : null,
          meta: { requestId: "req-e2e" },
        }),
      });
    },
  );
  return api;
}

import { expect, type Locator, type Page } from "@playwright/test";
import type { DiscoveryListing } from "../../lib/discover-api";
import type { MySession } from "../../lib/me-player-api";
import {
  TENANT_ID,
  installApiMock,
  makeSession,
  signIn,
  type MockError,
  type MockSession,
  type RecordedCall,
} from "./session-api-mock";

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
  opts: { signedIn?: boolean; sessions?: MockSession[] } = {},
): Promise<PlayerApi> {
  if (opts.signedIn ?? true) {
    await signIn(page.context());
    await installApiMock(page, opts.sessions ?? []); // `sessions` seeds the host session page (S-10)
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

// ---- R 4.6 / B-1: every L12 screen put into one of its five states by one call ----

export type ScreenState = "loading" | "ready" | "empty" | "error" | "offline";
export const SCREEN_STATES: readonly ScreenState[] = [
  "loading",
  "ready",
  "empty",
  "error",
  "offline",
];

/** One cell of the matrix. A state a screen does not have is n/a in R 4.6 and has no cell: never faked. */
export interface Cell {
  /** The data-state value the screen's root must carry. */
  expect: string;
  /** Standing replies laid over READY. */
  replies?: Partial<Record<RouteKey, Reply>>;
  /** The first request to this route stays open until `release()`: the page is held in loading. */
  hold?: RouteKey;
  /** What the user does once the page is up: press Join, open the host tab, lose the connection. */
  act?: (page: Page, root: Locator) => Promise<void>;
}
type Cells = Partial<Record<ScreenState, Cell>>;

export interface ScreenDef {
  path: string;
  /** The element that carries data-state: the page's main, the join panel or the inbox section. */
  root: string;
  /** The public discovery pages run with no session at all; every other screen is signed in. */
  signedIn: boolean;
  /** Host sessions behind the session routes (the S-10 page). */
  sessions?: MockSession[];
  cells: Cells;
}

const pressJoin = (page: Page) =>
  page.getByRole("button", { name: "Tham gia", exact: true }).click();
const openRequestsTab = (page: Page) => page.getByRole("tab", { name: "Yêu cầu tham gia" }).click();
/** The connection drops after the page is up: the screens that read `useOnlineStatus` show it. */
const goOffline = async (page: Page, root: Locator) => {
  await expect(root).toHaveAttribute("data-state", "ready");
  await page.context().setOffline(true);
};

/**
 * A screen driven by one read. `ready` and `empty` are that read's replies (no `ready` keeps the
 * READY default, no `empty` means n/a), `error` is a failure no table maps (the fail-closed row),
 * offline is a dropped connection and loading holds the read open.
 */
function routed(
  route: RouteKey,
  replies: { ready?: Reply; empty?: Reply; error?: Reply },
  act?: Cell["act"],
): Cells {
  const cell = (expect: string, reply?: Reply): Cell => ({
    expect,
    replies: reply && ({ [route]: reply } as Cell["replies"]),
    act,
  });
  return {
    loading: { expect: "loading", hold: route, act },
    ready: cell("ready", replies.ready),
    ...(replies.empty && { empty: cell("empty", replies.empty) }),
    error: cell("error", replies.error ?? fail("INTERNAL_ERROR", 500)),
    offline: cell("offline", NETWORK),
  };
}

const CLUB = { clubRef: "club-e2e", clubLabel: "CLB Cầu Lông Test" };
const HOST_SESSION = makeSession({ id: "s-host-1" });
const seats = [
  mySession(),
  mySession({ sessionId: "sess-e2e-2", myStatus: "waitlisted", waitlistPosition: 2 }),
  mySession({ sessionId: "sess-e2e-3", myStatus: "pending" }),
];
const request = {
  requestId: "jr-e2e-1",
  sessionId: "sess-e2e-3",
  clubRef: CLUB.clubRef,
  clubLabel: CLUB.clubLabel,
  startsAt: iso(3),
  createdAt: iso(0, -2),
};
const pending = [
  { requestId: "jr-e2e-1", displayName: "Nguyễn Văn An", createdAt: iso(0, -3) },
  { requestId: "jr-e2e-2", displayName: null, createdAt: iso(0, -1) },
];

export const SCREENS: Record<string, ScreenDef> = {
  "discover list": {
    path: "/discover",
    root: "main",
    signedIn: false,
    cells: routed("discover", { empty: ok({ items: [], nextCursor: null }) }),
  },
  "discover detail": {
    path: `/discover/${LISTING_ID}`,
    root: "main",
    signedIn: false,
    cells: routed("discoverDetail", { empty: fail("NOT_FOUND", 404) }),
  },
  "join button": {
    path: `/discover/${LISTING_ID}`,
    root: "main [data-state]",
    signedIn: true,
    cells: {
      loading: { expect: "loading", hold: "join", act: pressJoin },
      ready: { expect: "ready" },
      error: { expect: "error", replies: { join: fail("INTERNAL_ERROR", 500) }, act: pressJoin },
      offline: { expect: "offline", act: goOffline },
    },
  },
  "me hub": {
    path: "/me",
    root: "main",
    signedIn: true,
    cells: { ready: { expect: "ready" }, offline: { expect: "offline", act: goOffline } },
  },
  "me clubs": {
    path: "/me/clubs",
    root: "main",
    signedIn: true,
    cells: routed("meClubs", {
      ready: ok({ clubs: [CLUB], truncated: false }),
      empty: ok({ clubs: [], truncated: false }),
    }),
  },
  "me sessions": {
    path: "/me/sessions",
    root: "main",
    signedIn: true,
    cells: routed("meSessions", {
      ready: ok({ sessions: seats, truncated: false }),
      empty: ok({ sessions: [], truncated: false }),
    }),
  },
  "me charges": {
    path: "/me/charges",
    root: "main",
    signedIn: true,
    cells: routed("meCharges", {
      ready: ok(myCharges()),
      empty: ok({ summary: { kind: "known_zero", currency: "VND", asOf: iso(0) }, clubs: [] }),
      // The fail-closed amount: an unknown total is never shown as 0.
      error: ok({
        summary: { kind: "unknown", reasonCode: "READ_FAILED", retryable: true },
        clubs: [],
      }),
    }),
  },
  "me requests": {
    path: "/me/requests",
    root: "main",
    signedIn: true,
    cells: routed("meRequests", {
      ready: ok({ requests: [request], truncated: false }),
      empty: ok({ requests: [], truncated: false }),
    }),
  },
  "host requests tab": {
    path: `/c/${TENANT_ID}/sessions/${HOST_SESSION.id}`,
    root: "[data-state]",
    signedIn: true,
    sessions: [HOST_SESSION],
    cells: routed(
      "hostRequests",
      { ready: ok({ requests: pending }), empty: ok({ requests: [] }) },
      openRequestsTab,
    ),
  },
};

/**
 * Puts `screen` into `state` and returns the root to assert data-state on, the value it must carry
 * and `release()` for a held read. `replies` overrides the cell's standing replies (B-15 puts one
 * representative error code on the screen's route). Throws for an n/a cell.
 */
export async function putScreenInState(
  page: Page,
  screen: string,
  state: ScreenState,
  replies: Partial<Record<RouteKey, Reply>> = {},
) {
  const def = SCREENS[screen];
  const cell = def?.cells[state];
  if (!def || !cell) throw new Error(`${screen} has no ${state} state (n/a in R 4.6)`);
  const api = await installPlayerApi(
    page,
    { ...cell.replies, ...replies },
    {
      signedIn: def.signedIn,
      sessions: def.sessions,
    },
  );
  const release = cell.hold ? api.holdNext(cell.hold) : () => {};
  await page.goto(def.path);
  const root = page.locator(def.root).first();
  await cell.act?.(page, root);
  return { api, root, expected: cell.expect, release };
}

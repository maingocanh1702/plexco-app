import type { BrowserContext, Page, Route } from "@playwright/test";
import { handleRoster, rosterRouteKey } from "./roster-api-mock";

/**
 * Deterministic browser-side mock of the session API for the workspace specs. Every /api call the
 * screens make is answered here via page.route; the server renders pages only (its single DB
 * query is answered by fake-postgres.mjs). The mock keeps real state so create -> detail, edit and
 * transitions behave end to end, and records every request body for assertions.
 */
// Same literal as E2E_SESSION_TOKEN in ./fake-postgres.mjs (the stub DB hashes it); keep them equal.
export const E2E_SESSION_TOKEN = "e2e-session-token";
export const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const SPORT_ID = "22222222-2222-4222-8222-222222222222";

export interface MockSession {
  id: string;
  sportId: string;
  sportKey: string;
  sportName: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  venueName: string | null;
  venueAddress: string | null;
  area: string | null;
  skillLevel: null;
  priceAmount: number;
  slotsMax: number | null;
  visibility: string;
  joinPolicy: string;
  status: string;
  version: number;
  allowPlayerInvite: boolean;
  createdAt: string;
  updatedAt: string;
  players: unknown[];
  guestNotes: unknown[];
}

export interface MockError {
  code: string;
  message: string;
  statusCode: number;
  /** Optional structured payload of the envelope's error (CLOSE_BLOCKED_OPEN_DEBT's player list). */
  details?: unknown;
}
export interface RecordedCall {
  method: string;
  path: string;
  query: URLSearchParams;
  body: Record<string, unknown> | null;
}

const DAY = 86_400_000;
export function makeSession(over: Partial<MockSession> & { id: string }): MockSession {
  const start = Date.now() + 3 * DAY;
  return {
    sportId: SPORT_ID,
    sportKey: "badminton",
    sportName: "Cầu lông",
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(start + 2 * 3_600_000).toISOString(),
    timezone: "Asia/Ho_Chi_Minh",
    venueName: "Sân Phú Mỹ Hưng",
    venueAddress: null,
    area: "Quận 7",
    skillLevel: null,
    priceAmount: 50000,
    slotsMax: 12,
    visibility: "private",
    joinPolicy: "open",
    status: "open",
    version: 1,
    allowPlayerInvite: false,
    createdAt: new Date(start - 7 * DAY).toISOString(),
    updatedAt: new Date(start - 6 * DAY).toISOString(),
    players: [],
    guestNotes: [],
    ...over,
  };
}

export const ROSTER_PLAYERS = [
  {
    id: "p1",
    membershipId: "m1",
    displayName: "Lan Nguyễn",
    status: "active",
    joinedAt: "2026-10-01T00:00:00.000Z",
    waitlistPosition: null,
    charge: {
      id: "c1",
      amountDue: 50000,
      amountAllocated: 50000,
      status: "paid",
      effectiveAllocated: 50000,
      remaining: 0,
      allocations: [
        {
          id: "a1",
          source: "cash",
          amount: 50000,
          createdAt: "2026-10-02T03:00:00.000Z",
          reasonCode: null,
          reversesAllocationId: null,
        },
      ],
    },
  },
  {
    id: "p2",
    membershipId: "m2",
    displayName: "Minh Trần",
    status: "active",
    joinedAt: "2026-10-01T00:01:00.000Z",
    waitlistPosition: null,
    charge: {
      id: "c2",
      amountDue: 50000,
      amountAllocated: 20000,
      status: "partial",
      effectiveAllocated: 20000,
      remaining: 30000,
      allocations: [
        {
          id: "a2",
          source: "attested_transfer",
          amount: 20000,
          createdAt: "2026-10-02T04:00:00.000Z",
          reasonCode: "ck lần 1",
          reversesAllocationId: null,
        },
      ],
    },
  },
  {
    id: "p3",
    membershipId: "m3",
    displayName: "Hà Phạm",
    status: "waitlisted",
    joinedAt: "2026-10-01T00:02:00.000Z",
    waitlistPosition: 1,
    charge: null,
  },
];

export interface ApiMock {
  state: MockSession[];
  calls: RecordedCall[];
  /**
   * The next call to this route key is answered with `error` instead (consumed once). `"network"`
   * drops the request BEFORE the server sees it; `"lost-response"` (roster keys only) lets the
   * server APPLY it and then drops the reply, the case an idempotent retry must replay.
   */
  failNext(key: string, error: MockError | "network" | "lost-response"): void;
  /** The next call to this route key waits until the returned resolver is called (consumed once). */
  holdNext(key: string): () => void;
  /** Delay (ms) applied to the list response, to observe the loading state. */
  listDelayMs: number;
  /** Delay (ms) applied only to cursor (load-more) list requests. */
  moreDelayMs: number;
  callsTo(method: string, pathPattern: RegExp): RecordedCall[];
}

const envelope = (data: unknown) => ({ data, error: null, meta: { requestId: "req-e2e" } });
const errorEnvelope = (e: MockError, requestId = "req-e2e-err") => ({
  data: null,
  error: e,
  meta: { requestId },
});

export async function signIn(context: BrowserContext): Promise<void> {
  // Production build => the cookie is `__Host-plx_session` (Secure, Path=/, no Domain attribute is
  // modelled by domain+path here; Chromium treats 127.0.0.1 as a secure context).
  await context.addCookies([
    {
      name: "__Host-plx_session",
      value: E2E_SESSION_TOKEN,
      domain: "127.0.0.1",
      path: "/",
      secure: true,
      httpOnly: true,
    },
  ]);
}

export async function installApiMock(
  page: Page,
  initial: MockSession[],
  opts: { locale?: "vi" | "en" } = {},
): Promise<ApiMock> {
  // Deep copy: fixtures are module-level and the roster mock mutates players/ledgers in place.
  const state = initial.map((s) => structuredClone(s));
  const failures = new Map<string, (MockError | "network" | "lost-response")[]>();
  const holds = new Map<string, Promise<void>[]>();
  let seq = 0;
  const mock: ApiMock = {
    state,
    calls: [],
    listDelayMs: 0,
    moreDelayMs: 0,
    holdNext(key) {
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      holds.set(key, [...(holds.get(key) ?? []), gate]);
      return release;
    },
    failNext(key, error) {
      failures.set(key, [...(failures.get(key) ?? []), error]);
    },
    callsTo(method, pattern) {
      return mock.calls.filter((c) => c.method === method && pattern.test(c.path));
    },
  };
  const json = (route: Route, status: number, body: unknown) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  const take = (key: string) => failures.get(key)?.shift();

  await page.route("**/api/auth/session", (route) =>
    json(
      route,
      200,
      envelope({
        personId: "p-e2e",
        expiresAt: "2099-01-01T00:00:00.000Z",
        csrfToken: "e2e-csrf-secret",
        tenants: [
          {
            tenantId: TENANT_ID,
            role: "owner",
            name: "CLB Cầu Lông Test",
            timezone: "Asia/Ho_Chi_Minh",
            locale: opts.locale ?? "vi",
          },
        ],
      }),
    ),
  );
  await page.route("**/api/sports", (route) =>
    json(route, 200, envelope({ sports: [{ id: SPORT_ID, key: "badminton", name: "Cầu lông" }] })),
  );

  await page.route(/\/api\/sessions(\/|\?|$)/, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname;
    const raw = request.postData();
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    mock.calls.push({ method, path, query: url.searchParams, body });

    const detailMatch = /^\/api\/sessions\/([^/]+)(?:\/(publish|close|cancel))?$/.exec(path);
    const key =
      path === "/api/sessions"
        ? method === "GET"
          ? "list"
          : "create"
        : (rosterRouteKey(method, path, body) ??
          detailMatch?.[2] ??
          (method === "PUT" ? "update" : "detail"));

    await holds.get(key)?.shift();
    const injected = take(key);
    if (injected === "network") return route.abort("internetdisconnected");
    if (injected && injected !== "lost-response")
      return json(route, injected.statusCode, errorEnvelope(injected));

    const rosterKey = rosterRouteKey(method, path, body);
    if (injected === "lost-response") {
      if (!rosterKey) throw new Error(`lost-response needs a roster route key, got "${key}"`);
      handleRoster(state, rosterKey, path, body);
      return route.abort("internetdisconnected");
    }
    if (rosterKey) {
      const result = handleRoster(state, rosterKey, path, body);
      return "error" in result
        ? json(route, result.status, errorEnvelope(result.error))
        : json(route, 200, envelope(result.data));
    }

    const view = (s: MockSession) => {
      const { players, guestNotes, ...scalars } = s;
      void players;
      void guestNotes;
      return scalars;
    };
    const activeOf = (s: MockSession) =>
      (s.players as { status: string }[]).filter((p) => p.status === "active").length;
    // The real BE computes occupancy server-side (active players + guest notes); mirror it here.
    const withActive = (s: MockSession) => ({
      ...view(s),
      activeCount: activeOf(s),
      occupiedCount: activeOf(s) + s.guestNotes.length,
    });

    if (path === "/api/sessions" && method === "GET") {
      if (mock.listDelayMs) await new Promise((r) => setTimeout(r, mock.listDelayMs));
      if (mock.moreDelayMs && url.searchParams.get("cursor")) {
        await new Promise((r) => setTimeout(r, mock.moreDelayMs));
      }
      const status = url.searchParams.get("status");
      const limit = Number(url.searchParams.get("limit") ?? 20);
      const offset = Number((url.searchParams.get("cursor") ?? "c:0").slice(2));
      const rows = state
        .filter((s) => (status ? s.status === status : true))
        .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));
      const page_ = rows.slice(offset, offset + limit);
      const hasMore = rows.length > offset + limit;
      return json(
        route,
        200,
        envelope({
          sessions: page_.map(withActive),
          pageInfo: { hasMore, nextCursor: hasMore ? `c:${offset + limit}` : null },
        }),
      );
    }
    if (path === "/api/sessions" && method === "POST" && body) {
      seq += 1;
      const created = makeSession({
        id: `new-${seq}`,
        status: "draft",
        version: 1,
        sportId: String(body.sportId),
        startsAt: new Date(String(body.startsAt)).toISOString(),
        endsAt: new Date(String(body.endsAt)).toISOString(),
        priceAmount: Number(body.priceAmount ?? 0),
        slotsMax: (body.slotsMax as number | null) ?? null,
        area: (body.area as string | undefined) ?? null,
        venueName: (body.venueName as string | undefined) ?? null,
        venueAddress: (body.venueAddress as string | undefined) ?? null,
        visibility: String(body.visibility ?? "private"),
        joinPolicy: String(body.joinPolicy ?? "open"),
      });
      state.push(created);
      return json(
        route,
        200,
        envelope({ session: { id: created.id, status: "draft", version: 1 } }),
      );
    }
    const target = detailMatch ? state.find((s) => s.id === detailMatch[1]) : undefined;
    if (!detailMatch || !target) {
      return json(
        route,
        404,
        errorEnvelope({
          code: "SESSION_NOT_FOUND",
          message: "Không tìm thấy kèo.",
          statusCode: 404,
        }),
      );
    }
    if (method === "GET") {
      const active = (target.players as { status: string }[]).filter(
        (p) => p.status === "active",
      ).length;
      const waitlisted = (target.players as { status: string }[]).filter(
        (p) => p.status === "waitlisted",
      ).length;
      return json(
        route,
        200,
        envelope({
          session: {
            ...target,
            counts: {
              active,
              waitlisted,
              guestNotes: target.guestNotes.length,
              occupied: active + target.guestNotes.length,
            },
          },
        }),
      );
    }
    // Commands: expectedVersion must match (the real BE answers STALE_VERSION otherwise).
    if (body && body.expectedVersion !== target.version) {
      return json(
        route,
        409,
        errorEnvelope({
          code: "STALE_VERSION",
          message: "Kèo vừa được cập nhật — tải lại rồi thử lại.",
          statusCode: 409,
        }),
      );
    }
    const action = detailMatch[2];
    if (action === "publish") target.status = "open";
    else if (action === "close") target.status = "closed";
    else if (action === "cancel") target.status = "cancelled";
    else if (body) {
      for (const field of [
        "startsAt",
        "endsAt",
        "priceAmount",
        "slotsMax",
        "visibility",
        "joinPolicy",
        "area",
        "venueName",
        "venueAddress",
      ] as const) {
        if (field in body) (target as unknown as Record<string, unknown>)[field] = body[field];
      }
    }
    target.version += 1;
    return json(
      route,
      200,
      envelope({ session: { id: target.id, status: target.status, version: target.version } }),
    );
  });

  return mock;
}

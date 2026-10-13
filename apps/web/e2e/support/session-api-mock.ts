import type { BrowserContext, Page, Route } from "@playwright/test";

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
    charge: { id: "c1", amountDue: 50000, amountAllocated: 50000, status: "paid" },
  },
  {
    id: "p2",
    membershipId: "m2",
    displayName: "Minh Trần",
    status: "active",
    joinedAt: "2026-10-01T00:01:00.000Z",
    waitlistPosition: null,
    charge: { id: "c2", amountDue: 50000, amountAllocated: 20000, status: "partial" },
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
  /** The next call to this route key is answered with `error` instead (consumed once). */
  failNext(key: string, error: MockError | "network"): void;
  /** Delay (ms) applied to the list response, to observe the loading state. */
  listDelayMs: number;
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
  const state = initial.map((s) => ({ ...s }));
  const failures = new Map<string, (MockError | "network")[]>();
  let seq = 0;
  const mock: ApiMock = {
    state,
    calls: [],
    listDelayMs: 0,
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
        : (detailMatch?.[2] ?? (method === "PUT" ? "update" : "detail"));

    const injected = take(key);
    if (injected === "network") return route.abort("internetdisconnected");
    if (injected) return json(route, injected.statusCode, errorEnvelope(injected));

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

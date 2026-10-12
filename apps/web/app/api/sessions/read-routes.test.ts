import { SessionReadError, authorize, getSessionDetail, listSessions } from "@plexco/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { csrfOk, currentSession, rateLimited } from "../../../lib/session-cookies";
import { GET as GET_DETAIL } from "./[id]/route";
import { GET as GET_LIST } from "./route";

// GET /api/sessions and GET /api/sessions/:id. The real read gate runs (auth, authorize, buckets,
// language); only @plexco/db's authorize/withTenant/readers and the cookie layer are stubbed.
vi.mock("@plexco/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@plexco/db")>();
  return {
    ...actual,
    authorize: vi.fn(),
    withTenant: vi.fn(async (_db: unknown, _tenantId: string, fn: (tx: unknown) => unknown) =>
      fn({}),
    ),
    listSessions: vi.fn(),
    getSessionDetail: vi.fn(),
  };
});

let locale = "vi";
vi.mock("../../../lib/session-cookies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/session-cookies")>();
  return {
    ...actual,
    appDb: vi.fn(() => ({ pool: {}, db: { execute: async () => ({ rows: [{ locale }] }) } })),
    currentSession: vi.fn(),
    csrfOk: vi.fn(),
    rateLimited: vi.fn(),
  };
});

process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";

const TENANT = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "33333333-3333-4333-8333-333333333333";

const get = (path: string, tenant: string | null = TENANT) =>
  new Request(
    `https://plexco.app${path}${tenant === null ? "" : `${path.includes("?") ? "&" : "?"}tenant=${tenant}`}`,
  );
const ctx = () => ({ params: Promise.resolve({ id: SESSION_ID }) });
const envelope = async (r: Response) =>
  (await r.json()) as {
    data: Record<string, unknown> | null;
    error: { code: string; statusCode: number; message: string } | null;
  };

beforeEach(() => {
  vi.clearAllMocks();
  locale = "vi";
  vi.mocked(currentSession).mockResolvedValue({
    sessionId: "s",
    accountId: "a",
    personId: "p",
    csrfSecret: "secret",
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  vi.mocked(rateLimited).mockResolvedValue(false);
  vi.mocked(authorize).mockResolvedValue({ allowed: true, role: "co_admin" });
  vi.mocked(listSessions).mockResolvedValue({
    sessions: [],
    pageInfo: { hasMore: false, nextCursor: null },
  });
  vi.mocked(getSessionDetail).mockResolvedValue(null);
});

describe.each([
  [
    "GET /api/sessions",
    () => GET_LIST(get("/api/sessions")),
    (t: string | null) => GET_LIST(get("/api/sessions", t)),
  ],
  [
    "GET /api/sessions/:id",
    () => GET_DETAIL(get(`/api/sessions/${SESSION_ID}`), ctx()),
    (t: string | null) => GET_DETAIL(get(`/api/sessions/${SESSION_ID}`, t), ctx()),
  ],
])("%s — shared read gate", (_name, call, callWithTenant) => {
  it("401 AUTH_REQUIRED when anonymous", async () => {
    vi.mocked(currentSession).mockResolvedValue(null);
    const response = await call();
    expect(response.status).toBe(401);
    expect(authorize).not.toHaveBeenCalled();
  });

  it("does NOT require a CSRF token (body-less read)", async () => {
    vi.mocked(csrfOk).mockReturnValue(false);
    await call();
    expect(csrfOk).not.toHaveBeenCalled();
    expect(authorize).toHaveBeenCalled();
  });

  it.each([null, "not-a-uuid"])(
    "400 INVALID_BODY for tenant param %s, before authorize",
    async (tenant) => {
      const response = await callWithTenant(tenant);
      expect(response.status).toBe(400);
      expect(authorize).not.toHaveBeenCalled();
    },
  );

  it("asks authorize() for session.manage and answers one 403 on denial, with no tenant bucket spent", async () => {
    vi.mocked(authorize).mockResolvedValue({ allowed: false, reason: "not_a_member" });
    const response = await call();
    expect(response.status).toBe(403);
    expect((await envelope(response)).error?.code).toBe("FORBIDDEN");
    expect(authorize).toHaveBeenCalledWith(expect.anything(), {
      tenantId: TENANT,
      action: "session.manage",
      actorPersonId: "p",
    });
    const buckets = vi.mocked(rateLimited).mock.calls.map(([bucket]) => bucket);
    expect(buckets).toEqual(["session-actor:a"]);
    expect(listSessions).not.toHaveBeenCalled();
    expect(getSessionDetail).not.toHaveBeenCalled();
  });

  it("an authorize() infrastructure failure is not a 403 and not an allow", async () => {
    vi.mocked(authorize).mockRejectedValue(new Error("connection reset"));
    await expect(call()).rejects.toThrow(/connection reset/);
    expect(listSessions).not.toHaveBeenCalled();
    expect(getSessionDetail).not.toHaveBeenCalled();
  });

  it("spends the 60/min per-tenant bucket only after authorization, and answers its 429 in the tenant language", async () => {
    locale = "en";
    vi.mocked(rateLimited).mockImplementation(async (bucket: string) =>
      bucket.startsWith("session-read:"),
    );
    const response = await call();
    expect(response.status).toBe(429);
    expect(vi.mocked(rateLimited)).toHaveBeenCalledWith(`session-read:${TENANT}`, 60, 60);
    expect((await envelope(response)).error?.message).toBe("Too many requests — wait.");
  });
});

describe("GET /api/sessions", () => {
  it("returns the DD-60 envelope with pageInfo and forwards validated filters", async () => {
    vi.mocked(listSessions).mockResolvedValue({
      sessions: [{ id: SESSION_ID } as never],
      pageInfo: { hasMore: true, nextCursor: "abc" },
    });
    const response = await GET_LIST(get("/api/sessions?status=open&limit=5"));
    expect(response.status).toBe(200);
    expect(await envelope(response)).toMatchObject({
      data: { sessions: [{ id: SESSION_ID }], pageInfo: { hasMore: true, nextCursor: "abc" } },
      error: null,
    });
    expect(listSessions).toHaveBeenCalledWith(expect.anything(), {
      tenantId: TENANT,
      status: "open",
      cursor: undefined,
      limit: 5,
    });
  });

  it.each([
    "status=deleted",
    "limit=0",
    "limit=51",
    "limit=abc",
    "limit=-1",
    "cursor=not-a-cursor",
    "limit=1e2",
  ])("400 INVALID_BODY for %s without touching the database reader", async (query) => {
    const response = await GET_LIST(get(`/api/sessions?${query}`));
    expect(response.status).toBe(400);
    expect((await envelope(response)).error?.code).toBe("INVALID_BODY");
    expect(listSessions).not.toHaveBeenCalled();
  });

  it("maps a SessionReadError from the reader onto the same 400", async () => {
    vi.mocked(listSessions).mockRejectedValue(new SessionReadError("INVALID_CURSOR", "x"));
    const response = await GET_LIST(get("/api/sessions"));
    expect(response.status).toBe(400);
  });

  it("rethrows any other reader failure (a fault is not a client error)", async () => {
    vi.mocked(listSessions).mockRejectedValue(new Error("boom"));
    await expect(GET_LIST(get("/api/sessions"))).rejects.toThrow(/boom/);
  });
});

describe("GET /api/sessions/:id", () => {
  it("404 SESSION_NOT_FOUND when the id is not in the caller's tenant", async () => {
    const response = await GET_DETAIL(get(`/api/sessions/${SESSION_ID}`), ctx());
    expect(response.status).toBe(404);
    expect((await envelope(response)).error?.code).toBe("SESSION_NOT_FOUND");
    expect(getSessionDetail).toHaveBeenCalledWith(expect.anything(), {
      tenantId: TENANT,
      sessionId: SESSION_ID,
    });
  });

  it("returns { data: { session } } on success", async () => {
    vi.mocked(getSessionDetail).mockResolvedValue({ id: SESSION_ID, players: [] } as never);
    const response = await GET_DETAIL(get(`/api/sessions/${SESSION_ID}`), ctx());
    expect(response.status).toBe(200);
    expect(await envelope(response)).toMatchObject({
      data: { session: { id: SESSION_ID } },
      error: null,
    });
  });
});

import {
  RosterMoneyError,
  approveJoinRequest,
  authorize,
  cancelJoinRequest,
  hasLiveMembership,
  listPendingJoinRequests,
  rejectJoinRequest,
} from "@plexco/db";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { csrfOk, currentSession, rateLimited } from "../../../../lib/session-cookies";
import { GET } from "../../sessions/[id]/join-requests/route";
import { POST as APPROVE } from "./approve/route";
import { POST as REJECT } from "./reject/route";
import { DELETE } from "./route";

// The four L8 join-request routes share ONE file (mocks, helpers, tables) to keep the lane's B3
// test budget: DELETE cancel, POST approve, POST reject, and the host read GET
// /api/sessions/:id/join-requests (readiness 4.6, A-10, DT-1, DT-8, DT-11, P-11, P-13, P-17).
vi.mock("@plexco/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@plexco/db")>();
  return {
    ...actual,
    createDb: vi.fn(() => ({
      pool: {},
      db: { execute: async () => ({ rows: [{ locale: "vi" }] }) },
    })),
    cancelJoinRequest: vi.fn(),
    approveJoinRequest: vi.fn(),
    rejectJoinRequest: vi.fn(),
    listPendingJoinRequests: vi.fn(),
    hasLiveMembership: vi.fn(),
    authorize: vi.fn(),
    withTenant: vi.fn(async (_db: unknown, _tenantId: string, fn: (tx: unknown) => unknown) =>
      fn({}),
    ),
  };
});

vi.mock("../../../../lib/session-cookies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../lib/session-cookies")>();
  return {
    ...actual,
    appDb: vi.fn(() => ({ pool: {}, db: { execute: async () => ({ rows: [{ locale: "vi" }] }) } })),
    currentSession: vi.fn(),
    csrfOk: vi.fn(),
    rateLimited: vi.fn(),
  };
});

process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";
const PERSON = "44444444-4444-4444-8444-444444444444"; // the requester: a plain member of TENANT
const HOST = "55555555-5555-4555-8555-555555555555"; // session.manage in TENANT only
const PLAYER_ID = "66666666-6666-4666-8666-666666666666";
const OTHER_PERSON = "77777777-7777-4777-8777-777777777777";
const SESSION_ID = "88888888-8888-4888-8888-888888888888";

// cancel is the requester's (selfService gate); approve and reject are the host's (session.manage
// at the entry gate, no association fallback).
const ROUTES = {
  cancel: { handler: DELETE, service: cancelJoinRequest, actor: PERSON },
  approve: { handler: APPROVE, service: approveJoinRequest, actor: HOST },
  reject: { handler: REJECT, service: rejectJoinRequest, actor: HOST },
} as const;
type RouteName = keyof typeof ROUTES;
const NAMES = Object.keys(ROUTES) as RouteName[];
const service = (name: RouteName) => ROUTES[name].service as unknown as Mock;

function call(name: RouteName, options: { body?: object; tenant?: string; id?: string } = {}) {
  const { body = { commandId: "c1" }, tenant = TENANT, id = REQUEST_ID } = options;
  const cancel = name === "cancel";
  const url = `https://plexco.app/api/join-requests/${id}${cancel ? "" : `/${name}`}?tenant=${tenant}`;
  const request = new Request(url, {
    method: cancel ? "DELETE" : "POST",
    headers: { "content-type": "application/json", "x-csrf-token": "secret" },
    body: JSON.stringify(body),
  });
  return ROUTES[name].handler(request, { params: Promise.resolve({ id }) });
}
const get = (tenant = TENANT) =>
  GET(new Request(`https://plexco.app/api/sessions/${SESSION_ID}/join-requests?tenant=${tenant}`), {
    params: Promise.resolve({ id: SESSION_ID }),
  });
const envelope = async (response: Response) =>
  (await response.json()) as {
    data: Record<string, unknown> | null;
    error: { code: string; message: string } | null;
  };
const COOKIE = {
  sessionId: "s",
  csrfSecret: "secret",
  expiresAt: new Date(Date.now() + 3_600_000),
};
const signedIn = (personId: string | null) =>
  vi
    .mocked(currentSession)
    .mockResolvedValue(
      personId === null ? null : { ...COOKIE, accountId: `account-${personId}`, personId },
    );

const PENDING = [
  { requestId: "r1", displayName: "Lan", createdAt: "2026-10-17T01:00:00.000Z" },
  { requestId: "r2", displayName: null, createdAt: "2026-10-17T02:00:00.000Z" },
];
// Service rows carry more than the DTOs (money, contact data, ids): the routes must drop it.
const LEAKY = {
  phone: "0901234567",
  email: "lan@example.com",
  amountDue: 100000,
  personId: PERSON,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(csrfOk).mockReturnValue(true);
  vi.mocked(rateLimited).mockResolvedValue(false);
  vi.mocked(authorize).mockImplementation(async (_tx, input) =>
    input.tenantId === TENANT && input.actorPersonId === HOST && input.action === "session.manage"
      ? { allowed: true, role: "co_admin" }
      : { allowed: false, reason: "not_permitted" },
  );
  vi.mocked(hasLiveMembership).mockImplementation(async (_tx, tenantId) => tenantId === TENANT);
  const closed = { requestId: REQUEST_ID, replayed: false };
  vi.mocked(cancelJoinRequest).mockResolvedValue({ ...closed, status: "cancelled" });
  vi.mocked(rejectJoinRequest).mockResolvedValue({ ...closed, status: "rejected" });
  vi.mocked(approveJoinRequest).mockResolvedValue({
    ...{ requestId: REQUEST_ID, status: "approved", outcome: "waitlisted", playerId: PLAYER_ID },
    ...{ waitlistPosition: 2, replayed: true, chargeId: PLAYER_ID, ...LEAKY },
  } as Awaited<ReturnType<typeof approveJoinRequest>>);
  vi.mocked(listPendingJoinRequests).mockResolvedValue(
    PENDING.map((row) => ({ ...row, ...LEAKY })),
  );
});

const DECIDE = [[`join-request-decide:${TENANT}`, 30, 60]];
const APPROVED = { id: REQUEST_ID, status: "approved", outcome: "waitlisted", playerId: PLAYER_ID };
const EXPECTED = {
  cancel: {
    actor: { personId: PERSON },
    buckets: [
      [`join-request-cancel:${PERSON}`, 20, 3600],
      [`session-self-service:${TENANT}`, 60, 60],
    ],
    data: { request: { id: REQUEST_ID, status: "cancelled" }, replayed: false },
  },
  approve: {
    actor: { actorPersonId: HOST },
    buckets: DECIDE,
    data: { request: { ...APPROVED, waitlistPosition: 2 }, replayed: true },
  },
  reject: {
    actor: { actorPersonId: HOST },
    buckets: DECIDE,
    data: { request: { id: REQUEST_ID, status: "rejected" }, replayed: false },
  },
};
// P-17 copy (and the existing TENANT_SUSPENDED / FORBIDDEN pairs) in the 'vi' tenant's language.
const CODES = [
  ["REQUEST_DECIDED", 409, "Yêu cầu này đã được xử lý."],
  ["REQUEST_EXPIRED", 409, "Yêu cầu này đã hết hạn."],
  ["JOIN_REQUEST_NOT_FOUND", 404, "Không tìm thấy yêu cầu tham gia."],
  ["TENANT_SUSPENDED", 403, "CLB đang bị tạm ngưng."],
  ["FORBIDDEN", 403, "Bạn không có quyền thực hiện thao tác này."],
] as const;

describe("join-request routes (L8 M9): DELETE cancel, POST approve, POST reject", () => {
  it.each([
    ["cancel", "DT-1 no session", 401, "AUTH_REQUIRED", null, TENANT],
    ["approve", "DT-1 no session", 401, "AUTH_REQUIRED", null, TENANT],
    ["reject", "DT-1 no session", 401, "AUTH_REQUIRED", null, TENANT],
    ["approve", "A-10/DT-8 plain member (no session.manage)", 403, "FORBIDDEN", PERSON, TENANT],
    ["reject", "A-10/DT-8 plain member (no session.manage)", 403, "FORBIDDEN", PERSON, TENANT],
    ["cancel", "A-6 member of club A sending ?tenant=B", 403, "FORBIDDEN", PERSON, OTHER_TENANT],
    ["approve", "A-6 host of club A sending ?tenant=B", 403, "FORBIDDEN", HOST, OTHER_TENANT],
    ["reject", "A-6 host of club A sending ?tenant=B", 403, "FORBIDDEN", HOST, OTHER_TENANT],
  ] as const)(
    "%s, %s -> %i %s at the entry gate; the command never runs",
    async (name, _case, status, code, person, tenant) => {
      signedIn(person);
      const response = await call(name, { tenant });
      expect(response.status).toBe(status);
      expect((await envelope(response)).error?.code).toBe(code);
      expect(service(name)).not.toHaveBeenCalled();
    },
  );

  it.each(NAMES)(
    "DT-1 %s: body ids are ignored (actor = COOKIE person, tenant = ?tenant=, id = path); P-13 buckets; DTO key by key, no amount",
    async (name) => {
      signedIn(ROUTES[name].actor);
      const evil = { personId: OTHER_PERSON, actorPersonId: OTHER_PERSON, requestId: PLAYER_ID };
      const response = await call(name, {
        body: { commandId: "c1", tenantId: OTHER_TENANT, ...evil },
      });
      expect(response.status).toBe(200);
      const { actor, buckets, data } = EXPECTED[name];
      expect(service(name)).toHaveBeenCalledWith(expect.anything(), {
        tenantId: TENANT,
        ...actor,
        requestId: REQUEST_ID,
        commandId: "c1",
      });
      const calls = vi.mocked(rateLimited).mock.calls;
      expect(calls.filter(([key]) => !key.startsWith("session-actor:"))).toEqual(buckets);
      expect((await envelope(response)).data).toEqual(data);
    },
  );

  it.each(NAMES.flatMap((name) => CODES.map((row) => [name, ...row] as const)))(
    "DT-8 / P-17 %s: the service's %s -> %i with its t(vi, en) copy, never the internal detail",
    async (name, code, status, copy) => {
      signedIn(ROUTES[name].actor);
      service(name).mockRejectedValue(new RosterMoneyError(code, "internal detail"));
      const response = await call(name);
      expect(response.status).toBe(status);
      expect((await envelope(response)).error).toMatchObject({ code, message: copy });
    },
  );

  it.each(NAMES)(
    "P-11 %s: an unknown, junk, foreign or not-own id is forwarded as-is and answers ONE identical 404",
    async (name) => {
      signedIn(ROUTES[name].actor);
      service(name).mockRejectedValue(new RosterMoneyError("JOIN_REQUEST_NOT_FOUND", "detail"));
      const ids = [PLAYER_ID, "not-a-uuid", OTHER_TENANT];
      const answers = new Set<string>();
      for (const id of ids) {
        const response = await call(name, { id });
        const { data, error } = await envelope(response); // meta.requestId differs per response
        answers.add(JSON.stringify({ status: response.status, data, error }));
      }
      expect([...answers]).toEqual([expect.stringContaining('"status":404')]);
      expect(service(name).mock.calls.map((args) => args[1] as unknown)).toEqual(
        ids.map((id) => expect.objectContaining({ requestId: id })),
      );
    },
  );

  it("DT-11: the 21st cancel in an hour by one person -> RATE_LIMITED 429 (join-request-cancel 20/3600 s); another person still cancels", async () => {
    const counts = new Map<string, number>();
    vi.mocked(rateLimited).mockImplementation(async (key: string, limit = 10) => {
      counts.set(key, (counts.get(key) ?? 0) + 1);
      return counts.get(key)! > limit;
    });
    signedIn(PERSON);
    for (let i = 1; i <= 20; i += 1) {
      expect((await call("cancel", { body: { commandId: `c${i}` } })).status).toBe(200);
    }
    const limited = await call("cancel", { body: { commandId: "c21" } });
    expect([limited.status, (await envelope(limited)).error?.code]).toEqual([429, "RATE_LIMITED"]);
    expect(cancelJoinRequest).toHaveBeenCalledTimes(20);
    expect(counts.get(`session-self-service:${TENANT}`)).toBe(20);
    signedIn(OTHER_PERSON);
    expect((await call("cancel", { body: { commandId: "c22" } })).status).toBe(200);
  });
});

describe("GET /api/sessions/:id/join-requests (L8 M9 host read, A-10, P-12)", () => {
  it.each([
    ["DT-1 no session", null, TENANT, 401, "AUTH_REQUIRED"],
    ["a plain member of the club (no session.manage)", PERSON, TENANT, 403, "FORBIDDEN"],
    ["a host of club A sending ?tenant=B", HOST, OTHER_TENANT, 403, "FORBIDDEN"],
  ] as const)(
    "A-10: %s -> refused before anything is read",
    async (_case, person, tenant, status, code) => {
      signedIn(person);
      const response = await get(tenant);
      expect(response.status).toBe(status);
      expect((await envelope(response)).error?.code).toBe(code);
      expect(listPendingJoinRequests).not.toHaveBeenCalled();
    },
  );

  it("A-10: the host gets the rows key by key: exactly requestId, displayName, createdAt; never money or contact data", async () => {
    signedIn(HOST);
    const response = await get();
    expect(response.status).toBe(200);
    expect(listPendingJoinRequests).toHaveBeenCalledWith(expect.anything(), {
      tenantId: TENANT,
      actorPersonId: HOST,
      sessionId: SESSION_ID,
    });
    const { data } = await envelope(response);
    expect(data).toEqual({ requests: PENDING });
    expect(JSON.stringify(data)).not.toMatch(/phone|email|amount|person|0901|example/i);
    expect(rateLimited).toHaveBeenCalledWith(`session-read:${TENANT}`, 60, 60);
  });

  it.each([
    ["FORBIDDEN", 403],
    ["SESSION_NOT_FOUND", 404],
  ] as const)("the service's %s maps to %i inside the read, never a 500", async (code, status) => {
    signedIn(HOST);
    vi.mocked(listPendingJoinRequests).mockRejectedValue(new RosterMoneyError(code, "detail x"));
    const response = await get();
    expect(response.status).toBe(status);
    const { error } = await envelope(response);
    expect(error?.code).toBe(code);
    expect(error?.message).not.toContain("detail x");
  });
});

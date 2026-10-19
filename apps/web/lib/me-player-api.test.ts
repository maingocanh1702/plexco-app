import { afterEach, describe, expect, it, vi } from "vitest";
import { CLIENT_BAD_RESPONSE, CLIENT_NETWORK_ERROR } from "./api-client";
import { getMyCharges, getMyClubs, getMyRequests, getMySessions } from "./me-player-api";

const AS_OF = "2026-10-19T03:00:00.000Z";
const STARTS_AT = "2026-10-20T11:00:00.000Z";
const ENDS_AT = "2026-10-20T13:00:00.000Z";

const CLUB = { clubRef: "dev-club", clubLabel: "Dev Club", membershipStatus: "active" };
const SESSION = {
  sessionId: "s-1",
  clubRef: "dev-club",
  clubLabel: "Dev Club",
  sportKey: "pickleball",
  startsAt: STARTS_AT,
  endsAt: ENDS_AT,
  timezone: "Asia/Ho_Chi_Minh",
  area: "Quận 7",
  myStatus: "active",
  waitlistPosition: null,
  venueName: "Court 1",
  venueAddress: "1 Nguyễn Văn Linh",
};
const REQUEST = {
  requestId: "r-1",
  sessionId: "s-2",
  clubRef: "dev-club",
  clubLabel: "Dev Club",
  startsAt: STARTS_AT,
  area: "Quận 7",
  status: "pending",
  createdAt: AS_OF,
  decidedAt: null,
  expiresAt: ENDS_AT,
};
const ITEM = {
  sessionRef: "s-1",
  startsAt: STARTS_AT,
  amountDue: 60000,
  amountAllocated: 20000,
  remaining: 40000,
  status: "partial",
};
const KNOWN_AMOUNT = {
  kind: "known_amount",
  currency: "VND",
  totalOutstanding: 40000,
  asOf: AS_OF,
};
const CLUB_AMOUNT = { ...KNOWN_AMOUNT, chargeCount: 1, items: [ITEM] };
const UNAVAILABLE = { kind: "unknown", reasonCode: "READ_FAILED", retryable: false };

// Keys no screen may ever show: gender, a per-gender price, bank and QR data, a pay-now link.
const INJECTED = {
  gender: "female",
  priceByGender: { female: 40000 },
  bankAccount: "0123456789",
  qrImage: "https://example.test/qr.png",
  payNowUrl: "https://example.test/pay",
};

function mockFetch(data: unknown) {
  const body = JSON.stringify({ data, error: null, meta: { requestId: "req_1" } });
  const fn = vi.fn(async () => new Response(body, { status: 200 }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

/** A request that never answers; it fails only when its signal aborts, like fetch on a timeout. */
function hangingFetch() {
  const fn = vi.fn(
    (_path: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(new DOMException("timed out", "TimeoutError")),
        );
      }),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

const callOf = (fn: { mock: { calls: unknown[][] } }, index = 0) =>
  fn.mock.calls[index] as [string, RequestInit];

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("player /me reads", () => {
  it("ignores non-whitelisted keys", async () => {
    mockFetch({ clubs: [{ ...CLUB, ...INJECTED }], truncated: true, ...INJECTED });
    await expect(getMyClubs()).resolves.toStrictEqual({ clubs: [CLUB], truncated: true });
    mockFetch({ sessions: [{ ...SESSION, ...INJECTED }], truncated: false, ...INJECTED });
    await expect(getMySessions()).resolves.toStrictEqual({ sessions: [SESSION], truncated: false });
    mockFetch({ requests: [{ ...REQUEST, ...INJECTED }], truncated: false, ...INJECTED });
    await expect(getMyRequests()).resolves.toStrictEqual({ requests: [REQUEST], truncated: false });
    mockFetch({
      clubs: [
        {
          clubRef: "dev-club",
          clubLabel: "Dev Club",
          ...INJECTED,
          status: { ...CLUB_AMOUNT, ...INJECTED, items: [{ ...ITEM, ...INJECTED }] },
        },
      ],
      summary: { ...KNOWN_AMOUNT, clubCount: 1, ...INJECTED },
      ...INJECTED,
    });
    await expect(getMyCharges()).resolves.toStrictEqual({
      clubs: [{ clubRef: "dev-club", clubLabel: "Dev Club", status: CLUB_AMOUNT }],
      summary: { ...KNOWN_AMOUNT, clubCount: 1 },
    });
  });

  it("shows a venue only for an active seat and a position only for a waitlisted one", async () => {
    const injected = { venueName: "Injected Court", venueAddress: "Injected street" };
    mockFetch({
      sessions: [
        SESSION,
        { ...SESSION, myStatus: "waitlisted", waitlistPosition: 2, ...injected },
        { ...SESSION, myStatus: "pending", waitlistPosition: 5, ...injected },
        { ...SESSION, myStatus: "banned", waitlistPosition: 6, ...injected },
      ],
      truncated: false,
    });
    const { sessions } = await getMySessions();
    expect(
      sessions.map(({ myStatus, waitlistPosition, venueName, venueAddress }) => ({
        myStatus,
        waitlistPosition,
        venueName,
        venueAddress,
      })),
    ).toStrictEqual([
      {
        myStatus: "active",
        waitlistPosition: null,
        venueName: "Court 1",
        venueAddress: "1 Nguyễn Văn Linh",
      },
      { myStatus: "waitlisted", waitlistPosition: 2, venueName: null, venueAddress: null },
      { myStatus: "pending", waitlistPosition: null, venueName: null, venueAddress: null },
      { myStatus: null, waitlistPosition: null, venueName: null, venueAddress: null },
    ]);
  });

  it("an unknown enum value has no label, and only a literal true is truncated", async () => {
    mockFetch({ clubs: [{ ...CLUB, membershipStatus: "vip" }], truncated: "yes" });
    await expect(getMyClubs()).resolves.toStrictEqual({
      clubs: [{ ...CLUB, membershipStatus: null }],
      truncated: false,
    });
    mockFetch({
      requests: [
        REQUEST,
        { ...REQUEST, requestId: "r-2", status: "approved", decidedAt: AS_OF },
        { ...REQUEST, requestId: "r-3", status: "weird" },
      ],
      truncated: true,
    });
    const { requests, truncated } = await getMyRequests();
    expect(truncated).toBe(true);
    // an expiry belongs to a pending request only
    expect(requests.map((r) => [r.status, r.decidedAt, r.expiresAt])).toStrictEqual([
      ["pending", null, ENDS_AT],
      ["approved", AS_OF, null],
      [null, null, null],
    ]);
  });

  it("fails closed on a row without its keys or a body that is not a list", async () => {
    mockFetch({ clubs: [{ clubRef: "dev-club" }], truncated: false });
    await expect(getMyClubs()).rejects.toMatchObject({ code: CLIENT_BAD_RESPONSE });
    mockFetch({ sessions: [{ ...SESSION, timezone: undefined }], truncated: false });
    await expect(getMySessions()).rejects.toMatchObject({ code: CLIENT_BAD_RESPONSE });
    mockFetch({ requests: {}, truncated: false });
    await expect(getMyRequests()).rejects.toMatchObject({ code: CLIENT_BAD_RESPONSE });
    mockFetch({ clubs: [{ clubRef: "a", status: CLUB_AMOUNT }], summary: UNAVAILABLE });
    await expect(getMyCharges()).rejects.toMatchObject({ code: CLIENT_BAD_RESPONSE });
  });
});

describe("my charges", () => {
  it("fails closed to the unavailable state, never to 0", async () => {
    const club = (clubRef: string, status: unknown) => ({ clubRef, clubLabel: clubRef, status });
    mockFetch({
      clubs: [
        club("usd", { ...CLUB_AMOUNT, currency: "USD" }),
        club("text-total", { ...CLUB_AMOUNT, totalOutstanding: "40000" }),
        club("bad-item", { ...CLUB_AMOUNT, items: [{ ...ITEM, remaining: null }] }),
        club("no-items", { ...CLUB_AMOUNT, items: undefined }),
        club("mystery", { kind: "mystery" }),
        club("usd-zero", { kind: "known_zero", currency: "USD", asOf: AS_OF }),
        club("fine", CLUB_AMOUNT),
      ],
      summary: { ...KNOWN_AMOUNT, totalOutstanding: null, clubCount: 1 },
    });
    const { clubs, summary } = await getMyCharges();
    expect(clubs.slice(0, 6).map((c) => c.status)).toStrictEqual(Array(6).fill(UNAVAILABLE));
    expect(clubs[6]?.status).toStrictEqual(CLUB_AMOUNT);
    expect(summary).toStrictEqual(UNAVAILABLE);
  });

  it("a fractional or beyond-2^53 amount is unavailable, never a known amount (P-7)", async () => {
    const club = (clubRef: string, status: unknown) => ({ clubRef, clubLabel: clubRef, status });
    mockFetch({
      clubs: [
        club("fraction", { ...CLUB_AMOUNT, totalOutstanding: 150000.5 }),
        club("unsafe", { ...CLUB_AMOUNT, totalOutstanding: 2 ** 53 }),
        club("item-fraction", { ...CLUB_AMOUNT, items: [{ ...ITEM, remaining: 0.5 }] }),
      ],
      summary: { ...KNOWN_AMOUNT, totalOutstanding: 150000.5, clubCount: 1 },
    });
    const { clubs, summary } = await getMyCharges();
    expect(clubs.map((c) => c.status)).toStrictEqual(Array(3).fill(UNAVAILABLE));
    expect(summary).toStrictEqual(UNAVAILABLE);
  });

  it("a known amount of 0 or below is unavailable, never a rendered amount (B-3, P-7)", async () => {
    // The server contract: a known_amount club always owes more than 0 (me-player-reads.ts).
    const club = (clubRef: string, status: unknown) => ({ clubRef, clubLabel: clubRef, status });
    mockFetch({
      clubs: [
        club("zero", { ...CLUB_AMOUNT, totalOutstanding: 0 }),
        club("negative", { ...CLUB_AMOUNT, totalOutstanding: -60000 }),
        club("smallest", { ...CLUB_AMOUNT, totalOutstanding: 1 }),
      ],
      summary: { ...KNOWN_AMOUNT, totalOutstanding: -60000, clubCount: 1 },
    });
    const { clubs, summary } = await getMyCharges();
    expect(clubs.slice(0, 2).map((c) => c.status)).toStrictEqual(Array(2).fill(UNAVAILABLE));
    expect(clubs[2]?.status).toMatchObject({ kind: "known_amount", totalOutstanding: 1 });
    expect(summary).toStrictEqual(UNAVAILABLE);
  });

  it("passes a declared zero and a declared unavailable state through", async () => {
    mockFetch({
      clubs: [
        {
          clubRef: "zero",
          clubLabel: "Zero",
          status: { kind: "known_zero", currency: "VND", asOf: AS_OF },
        },
        {
          clubRef: "busy",
          clubLabel: "Busy",
          status: { kind: "unknown", reasonCode: "TOO_MANY_OPEN_CHARGES", retryable: true },
        },
        {
          clubRef: "odd",
          clubLabel: "Odd",
          status: { kind: "unknown", reasonCode: "X", retryable: "yes" },
        },
      ],
      summary: { kind: "known_zero", currency: "VND", asOf: AS_OF },
    });
    const { clubs, summary } = await getMyCharges();
    expect(summary).toStrictEqual({ kind: "known_zero", currency: "VND", asOf: AS_OF });
    expect(clubs.map((c) => c.status)).toStrictEqual([
      { kind: "known_zero", currency: "VND", asOf: AS_OF },
      { kind: "unknown", reasonCode: "TOO_MANY_OPEN_CHARGES", retryable: true },
      UNAVAILABLE,
    ]);
  });
});

describe("request timeout (P-15)", () => {
  const READS = [
    ["/api/me/clubs", () => getMyClubs()],
    ["/api/me/sessions", () => getMySessions()],
    ["/api/me/charges", () => getMyCharges()],
    ["/api/me/requests", () => getMyRequests()],
  ] as const;

  it.each(READS)("%s gives up after 15 s as CLIENT_NETWORK_ERROR", async (path, read) => {
    const clock = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(clock.signal);
    const fn = hangingFetch();
    const settled = expect(read()).rejects.toMatchObject({
      code: CLIENT_NETWORK_ERROR,
      statusCode: 0,
    });
    expect(timeout).toHaveBeenCalledWith(15_000);
    expect(callOf(fn)[0]).toBe(path);
    expect(callOf(fn)[1].signal).toBe(clock.signal);
    clock.abort();
    await settled;
  });
});

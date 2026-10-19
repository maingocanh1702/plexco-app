import { afterEach, describe, expect, it, vi } from "vitest";
import { CLIENT_BAD_RESPONSE, CLIENT_NETWORK_ERROR } from "./api-client";
import { getDiscoveryListing, joinPublicListing, listDiscovery } from "./discover-api";

const LISTING = {
  publicListingId: "pl_abc",
  sportKey: "pickleball",
  startsAt: "2026-10-20T11:00:00.000Z",
  endsAt: "2026-10-20T13:00:00.000Z",
  title: "Kèo tối thứ Ba",
  area: "Quận 7",
  priceAmount: 60000,
  slotsOpen: 3,
  clubDisplayName: "Dev Club",
  joinPolicy: "approval",
};

// Keys no screen may ever show: gender, a per-gender price, bank and QR data, and the DD-41 columns
// the player UI leaves out (readiness 4.2 D-1).
const INJECTED = {
  gender: "female",
  genderRestriction: "female",
  priceByGender: { female: 40000, male: 60000 },
  bankAccount: "0123456789",
  qrImage: "https://example.test/qr.png",
  sessionType: "doubles",
  levelMinRank: 3,
  ageMin: 18,
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

describe("discovery reads", () => {
  it("ignores non-whitelisted keys", async () => {
    mockFetch({ items: [{ ...LISTING, ...INJECTED }], nextCursor: "next-1", debug: "x" });
    await expect(listDiscovery()).resolves.toStrictEqual({
      items: [LISTING],
      nextCursor: "next-1",
    });
    mockFetch({ listing: { ...LISTING, ...INJECTED } });
    await expect(getDiscoveryListing("pl_abc")).resolves.toStrictEqual(LISTING);
  });

  it("keeps an absent or wrongly typed value as null, never a made-up 0", async () => {
    const row = {
      ...LISTING,
      title: undefined,
      area: null,
      priceAmount: "60000",
      slotsOpen: null,
      joinPolicy: "vip",
    };
    mockFetch({ items: [row], nextCursor: null });
    await expect(listDiscovery()).resolves.toStrictEqual({
      items: [
        {
          ...LISTING,
          title: null,
          area: null,
          priceAmount: null,
          slotsOpen: null,
          joinPolicy: null,
        },
      ],
      nextCursor: null,
    });
  });

  it("fails closed on a row without its link key or times, and on a non-list body", async () => {
    mockFetch({ items: [{ ...LISTING, publicListingId: undefined }], nextCursor: null });
    await expect(listDiscovery()).rejects.toMatchObject({ code: CLIENT_BAD_RESPONSE });
    mockFetch({ listing: { ...LISTING, startsAt: 5 } });
    await expect(getDiscoveryListing("pl_abc")).rejects.toMatchObject({
      code: CLIENT_BAD_RESPONSE,
    });
    mockFetch({ items: "nope" });
    await expect(listDiscovery()).rejects.toMatchObject({ code: CLIENT_BAD_RESPONSE });
  });

  it("sends only the set filters as the server's snake_case params", async () => {
    const fn = mockFetch({ items: [], nextCursor: null });
    await listDiscovery({
      sport: "pickleball",
      area: "Quận 7",
      availableOnly: true,
      maxPrice: 80000,
      limit: 20,
      cursor: "c 1",
    });
    await listDiscovery();
    const url = new URL(callOf(fn, 0)[0], "http://localhost");
    expect(url.pathname).toBe("/api/discover");
    expect(Object.fromEntries(url.searchParams)).toStrictEqual({
      sport: "pickleball",
      area: "Quận 7",
      available_only: "true",
      max_price: "80000",
      limit: "20",
      cursor: "c 1",
    });
    expect(callOf(fn, 1)[0]).toBe("/api/discover");
  });

  it("keys the detail by the encoded publicListingId", async () => {
    const fn = mockFetch({ listing: LISTING });
    await getDiscoveryListing("pl/ab c");
    expect(callOf(fn)[0]).toBe("/api/discover/pl%2Fab%20c");
  });
});

describe("public join", () => {
  const join = () => joinPublicListing("pl_abc", { commandId: "cmd-1", csrfToken: "tok" });

  it("posts only the commandId with the CSRF header and keeps only outcome and position", async () => {
    const fn = mockFetch({
      join: {
        outcome: "waitlisted",
        waitlistPosition: 4,
        playerId: "p-1",
        requestId: null,
        venueName: "Court 1",
        amountDue: 60000,
      },
      replayed: true,
    });
    await expect(join()).resolves.toStrictEqual({ outcome: "waitlisted", waitlistPosition: 4 });
    const [path, init] = callOf(fn);
    expect(path).toBe("/api/public-listings/pl_abc/join");
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"commandId":"cmd-1"}');
    expect(new Headers(init.headers).get("x-csrf-token")).toBe("tok");
  });

  it("a position only comes with a waitlisted seat; an unknown outcome has no result text", async () => {
    mockFetch({ join: { outcome: "active", waitlistPosition: 3 } });
    await expect(join()).resolves.toStrictEqual({ outcome: "active", waitlistPosition: null });
    mockFetch({ join: { outcome: "banned", waitlistPosition: 3 } });
    await expect(join()).resolves.toStrictEqual({ outcome: null, waitlistPosition: null });
    mockFetch({ nope: 1 });
    await expect(join()).rejects.toMatchObject({ code: CLIENT_BAD_RESPONSE });
  });
});

describe("request timeout (P-15)", () => {
  const CALLS = [
    ["listDiscovery", () => listDiscovery()],
    ["getDiscoveryListing", () => getDiscoveryListing("pl_abc")],
    [
      "joinPublicListing",
      () => joinPublicListing("pl_abc", { commandId: "cmd-1", csrfToken: "tok" }),
    ],
  ] as const;

  it.each(CALLS)("%s gives up after 15 s as CLIENT_NETWORK_ERROR", async (_name, call) => {
    const clock = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(clock.signal);
    const fn = hangingFetch();
    const settled = expect(call()).rejects.toMatchObject({
      code: CLIENT_NETWORK_ERROR,
      statusCode: 0,
    });
    expect(timeout).toHaveBeenCalledWith(15_000);
    expect(callOf(fn)[1].signal).toBe(clock.signal);
    clock.abort();
    await settled;
  });
});

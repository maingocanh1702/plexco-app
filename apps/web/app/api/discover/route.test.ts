import { createDb, listDiscoveryListings } from "@plexco/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeDiscoveryCursor, encodeDiscoveryCursor } from "../../../lib/discovery-cursor";
import {
  discoveryRateLimitKey,
  resetDiscoveryRouteSupportForTests,
} from "../../../lib/discovery-route-support";
import { GET } from "./route";

vi.mock("@plexco/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@plexco/db")>()),
  createDb: vi.fn(),
  listDiscoveryListings: vi.fn(),
}));

const ID = "0b5c7a7e-1f2d-4c3b-9a8e-6d5f4e3c2b1a";
const ID2 = "1c6d8b8f-2a3e-4d4c-8b9f-7e6a5f4d3c2b";
const TENANT = "9f0e1d2c-3b4a-4596-8877-665544332211";
const SESSION = "5e4d3c2b-1a09-4f8e-9d7c-6b5a49382716";
const IP = "203.0.113.7";
const ROW = {
  public_listing_id: ID,
  sport_key: "pickleball",
  starts_at: new Date("2026-11-01T10:00:00.000Z"),
  ends_at: new Date("2026-11-01T12:00:00.000Z"),
  area: "District 1",
  price_amount: 120000,
  slots_open: 3,
  club_display_name: "Sunrise Club",
  join_policy: "open",
  title: null,
  session_type: null,
  level_min_rank: null,
  level_max_rank: null,
  level_strict: null,
  gender_restriction: null,
  age_min: null,
  age_max: null,
  // 0067 (DD-139 / B1) A-1: the projector wrote the venue (hide_exact_address OFF, a venue typed).
  venue_name: "Sân Pickleball Lê Lợi",
  venue_address: "12 Lê Lợi, Phường Bến Nghé, Quận 1, TP. Hồ Chí Minh",
};
// DD-39 4.6 (T-20): the twelve exact keys no public JSON may carry (gender_restriction is DD-41).
const GENDER_KEYS =
  `gender_enc gender_key_version gender_pricing_consent price_male price_female genderEnc
  genderKeyVersion genderPricingConsent priceMale priceFemale gender genderConsent`.split(/\s+/);
const GENDER_LEAK: object = Object.fromEntries(GENDER_KEYS.map((k) => [k, 1]));
// Columns outside the whitelist: the key-by-key mapper must never serve them (readiness 4.4).
const LEAKY = { ...ROW, tenant_id: TENANT, session_id: SESSION, confirmed_count: 7, slots_max: 10 };
const DTO = {
  publicListingId: ID,
  sportKey: "pickleball",
  startsAt: "2026-11-01T10:00:00.000Z",
  endsAt: "2026-11-01T12:00:00.000Z",
  area: "District 1",
  priceAmount: 120000,
  slotsOpen: 3,
  clubDisplayName: "Sunrise Club",
  joinPolicy: "open",
  venueName: "Sân Pickleball Lê Lợi",
  venueAddress: "12 Lê Lợi, Phường Bến Nghé, Quận 1, TP. Hồ Chí Minh",
};
const NEXT = { startsAt: "2026-11-01T10:00:00.000000Z", publicListingId: ID2 };
// R9: the DB limiter as a keyed fake, reset per test: 0 while a key has at most 60 hits, then 30.
const hits = new Map<string, number>();
const POOL = {
  query: async (sql: string, [key = ""]: string[] = []) => {
    if (sql !== "SELECT discovery_rate_limit_hit($1)") {
      return { rows: [{ u: "readonly", s: "readonly" }] };
    }
    const count = (hits.get(key) ?? 0) + 1;
    hits.set(key, count);
    return { rows: [{ discovery_rate_limit_hit: count > 60 ? 30 : 0 }] };
  },
};
// Each bad value of readiness 4.4; hidden characters are URL escapes (NUL, U+202E).
const BAD_QUERIES = `skill=3 level_min=2 level_strict=true q=x sport=a&sport=b limit=5&limit=5
  sport=Pickleball sport=9ball sport=${"a".repeat(33)} area= area=%20 area=${"a".repeat(65)}
  area=a%00b area=a%E2%80%AEb start_after=2026-11-01 start_after=2026-11-01T10:00:00
  start_after=2026-02-30T10:00:00Z start_before=soon
  start_after=2026-11-02T00:00:00Z&start_before=2026-11-01T00:00:00Z
  max_price=-1 max_price=1.5 max_price=01 max_price=100000001 available_only=yes available_only=1
  limit=0 limit=51 limit=2.0 cursor=nope cursor=v1.e30.AAAA cursor=${"a".repeat(257)}`.split(/\s+/);

const keys = (o: object) => Object.keys(o).sort();
const request = (path: string, ip = IP) =>
  new Request(`https://plexco.app${path}`, { headers: { "fly-client-ip": ip } });
const get = (query = "", ip = IP) => GET(request(`/api/discover${query}`, ip));

async function expectError(res: Response, status: number, code: string) {
  expect([res.status, res.headers.get("cache-control")]).toEqual([status, "no-store"]);
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe(code);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetDiscoveryRouteSupportForTests();
  hits.clear();
  vi.stubEnv("DISCOVERY_DATABASE_URL", "postgres://readonly@127.0.0.1:5432/plexco_test");
  vi.stubEnv("TRUSTED_INGRESS_PROVIDER", "fly");
  vi.mocked(createDb).mockReturnValue({ pool: POOL } as never);
  vi.mocked(listDiscoveryListings).mockResolvedValue({ rows: [], next: null });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/discover", () => {
  it("A-2 (DD-139 / B1): a row projected with the venue hidden (both columns NULL) serves the area and no venue key", async () => {
    vi.mocked(listDiscoveryListings).mockResolvedValueOnce({
      rows: [{ ...LEAKY, venue_name: null, venue_address: null }],
      next: null,
    });
    const res = await get();
    expect([res.status, res.headers.get("cache-control")]).toEqual([200, "no-store"]);
    const body = (await res.json()) as { data: { items: object[] } };
    const { venueName, venueAddress, ...areaOnly } = DTO;
    expect(body.data.items).toEqual([areaOnly]);
    expect(body.data.items.map(keys)).toEqual([keys(areaOnly)]);
    const text = JSON.stringify(body.data);
    for (const hidden of [venueName, venueAddress, "venue"]) expect(text).not.toContain(hidden);
  });

  it("A-8 (DD-139 / B1): the DTO key set is the pre-0067 whitelist plus exactly venueName and venueAddress", async () => {
    const dd41 = `title session_type level_min_rank level_max_rank level_strict gender_restriction
      age_min age_max`.split(/\s+/);
    const everyOptional: object = Object.fromEntries(dd41.map((column) => [column, 1]));
    vi.mocked(listDiscoveryListings).mockResolvedValueOnce({
      rows: [{ ...LEAKY, ...GENDER_LEAK, ...everyOptional }],
      next: null,
    });
    const res = await get();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { items: object[] } };
    const pre0067 = `publicListingId sportKey startsAt endsAt area priceAmount slotsOpen
      clubDisplayName joinPolicy title sessionType levelMinRank levelMaxRank levelStrict
      genderRestriction ageMin ageMax`.split(/\s+/);
    const expected = [...pre0067, "venueName", "venueAddress"].sort();
    expect(body.data.items.map(keys)).toEqual([expected]);
  });

  it("A-5: the whitelist page { items, nextCursor } in the DD-60 envelope, no-store; the cursor resumes the keyset", async () => {
    vi.mocked(listDiscoveryListings).mockResolvedValueOnce({
      rows: [LEAKY, { ...ROW, ...GENDER_LEAK, public_listing_id: ID2, title: "Evening drills" }],
      next: NEXT,
    });
    const res = await get("?sport=pickleball&available_only=true&limit=2");
    expect([res.status, res.headers.get("cache-control")]).toEqual([200, "no-store"]);
    const text = await res.text();
    const body = JSON.parse(text) as { data: { items: object[]; nextCursor: string } };
    expect(body).toEqual({
      data: {
        items: [DTO, { ...DTO, publicListingId: ID2, title: "Evening drills" }],
        nextCursor: expect.any(String),
      },
      error: null,
      meta: { requestId: expect.stringMatching(/^req_/) },
    });
    expect(body.data.items.map(keys)).toEqual([keys(DTO), keys({ ...DTO, title: "" })]);
    for (const hidden of [TENANT, SESSION, "confirmed", "slots_max", "slotsMax"]) {
      expect(text).not.toContain(hidden);
    }
    for (const k of GENDER_KEYS) expect(text).not.toContain(`"${k}"`);
    expect(decodeDiscoveryCursor(body.data.nextCursor)).toEqual(NEXT);
    expect(listDiscoveryListings).toHaveBeenCalledWith(POOL, {
      sport: "pickleball",
      availableOnly: true,
      limit: 2,
    });

    const last = await get(`?cursor=${body.data.nextCursor}`);
    expect(((await last.json()) as { data: unknown }).data).toEqual({
      items: [],
      nextCursor: null,
    });
    expect(listDiscoveryListings).toHaveBeenLastCalledWith(POOL, { limit: 20, after: NEXT });
  });

  it("A-6: INVALID_FILTER 400 for skill, level_*, an unknown or repeated param and each bad value; no DB call", async () => {
    const cursor = encodeDiscoveryCursor(NEXT);
    const tampered = `${cursor.slice(0, -1)}${cursor.endsWith("A") ? "B" : "A"}`;
    for (const query of [...BAD_QUERIES, `cursor=${tampered}`]) {
      await expectError(await get(`?${query}`), 400, "INVALID_FILTER");
    }
    expect(listDiscoveryListings).not.toHaveBeenCalled();
    expect(createDb).not.toHaveBeenCalled();
  });

  it("A-7: request 61 within 60 s is DISCOVERY_RATE_LIMITED 429 + retry-after; another IP passes; a refused new key is 429", async () => {
    for (let i = 0; i < 60; i += 1) expect((await get()).status).toBe(200);
    const limited = await get();
    const retryAfter = Number(limited.headers.get("retry-after"));
    expect(retryAfter > 0 && retryAfter <= 60).toBe(true);
    await expectError(limited, 429, "DISCOVERY_RATE_LIMITED");
    expect((await get("", "198.51.100.9")).status).toBe(200);
    expect(listDiscoveryListings).toHaveBeenCalledTimes(61);

    // A full table refuses a new key (the DB tests pin it): the 429 carries the limiter's retry-after.
    vi.spyOn(POOL, "query").mockResolvedValueOnce({ rows: [{ discovery_rate_limit_hit: 60 }] });
    const full = await get("", "198.51.100.10");
    expect(full.headers.get("retry-after")).toBe("60");
    await expectError(full, 429, "DISCOVERY_RATE_LIMITED");
  });

  it("L73 A-13: the awaited limiter's refusal is the 429 with its retry-after and no-store, before the read", async () => {
    expect((await get()).status).toBe(200); // warms the pool: its role probe is the first query
    vi.spyOn(POOL, "query").mockResolvedValueOnce({ rows: [{ discovery_rate_limit_hit: 42 }] });
    const limited = await get();
    expect(limited.headers.get("retry-after")).toBe("42");
    await expectError(limited, 429, "DISCOVERY_RATE_LIMITED");
    expect(listDiscoveryListings).toHaveBeenCalledTimes(1); // the warm-up's read only
  });

  it("A-7: an unset DISCOVERY_DATABASE_URL or any probe answer but a plain readonly poisons the handle: empty 500, no-store, no re-probe, no read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    // [] is what Postgres answers for a SUPERUSER or BYPASSRLS current_user: the probe filters it out.
    for (const rows of [[{ u: "app", s: "app" }], [{ u: "readonly", s: "app" }], []]) {
      resetDiscoveryRouteSupportForTests();
      const query = vi
        .fn()
        .mockResolvedValueOnce({ rows })
        .mockResolvedValue({ rows: [{ u: "readonly", s: "readonly" }] });
      vi.mocked(createDb).mockReturnValue({ pool: { query } } as never);
      for (const res of [await get(), await get()]) {
        expect([res.status, res.headers.get("cache-control"), await res.text()]).toEqual([
          500,
          "no-store",
          "",
        ]);
      }
      expect(query.mock.calls).toEqual([
        [
          expect.stringMatching(
            /r\.rolname = current_user AND NOT r\.rolsuper AND NOT r\.rolbypassrls$/,
          ),
        ],
      ]);
    }
    resetDiscoveryRouteSupportForTests();
    vi.stubEnv("DISCOVERY_DATABASE_URL", "");
    expect((await get()).status).toBe(500);
    expect(listDiscoveryListings).not.toHaveBeenCalled();
  });

  it("A-7: an unavailable probe is the 500 of that call only; the next call re-probes the same handle", async () => {
    const query = vi.fn(POOL.query).mockRejectedValueOnce(new Error("connect ECONNREFUSED"));
    vi.mocked(createDb).mockReturnValue({ pool: { query } } as never);
    expect([(await get()).status, (await get()).status]).toEqual([500, 200]);
    // the failed probe, the re-probe and the limiter query
    expect([vi.mocked(createDb).mock.calls.length, query.mock.calls.length]).toEqual([1, 3]);
  });

  it("A-16: the discovery pool is built by createDb with max 5 and the three R6 timeouts", async () => {
    expect((await get()).status).toBe(200);
    expect(vi.mocked(createDb).mock.calls).toEqual([
      [
        "postgres://readonly@127.0.0.1:5432/plexco_test",
        { max: 5, statement_timeout: 2_000, connectionTimeoutMillis: 2_000, query_timeout: 2_500 },
      ],
    ]);
  });

  it("A-7: an IPv6 client is keyed by its /64, so every spelling in one /64 shares the bucket; another /64 passes", async () => {
    const spellings = [
      "2001:db8::1",
      "2001:0DB8:0000:0000:0:0:0:2",
      "2001:db8:0:0:1::5",
      "2001:db8::1.2.3.4",
    ];
    for (let i = 0; i < 60; i += 1) expect((await get("", spellings[i % 4])).status).toBe(200);
    await expectError(await get("", "2001:db8::ffff"), 429, "DISCOVERY_RATE_LIMITED");
    expect((await get("", "2001:db8:0:1::1")).status).toBe(200);
  });

  it("R1-2b: an IPv4-mapped IPv6 client is keyed as its IPv4 address, never the /64 every mapped client shares", async () => {
    const spellings = [
      "::ffff:192.0.2.1",
      "::FFFF:c000:201",
      "0:0:0:0:0:ffff:192.0.2.1",
      "192.0.2.1",
    ];
    for (let i = 0; i < 60; i += 1) expect((await get("", spellings[i % 4])).status).toBe(200);
    await expectError(await get("", "::ffff:c000:0201"), 429, "DISCOVERY_RATE_LIMITED");
    expect((await get("", "::ffff:192.0.2.2")).status).toBe(200);
  });

  it("L73 key form: the limiter's parameter is exactly discoveryRateLimitKey(request), unprefixed: an IPv6 client sends its /64", async () => {
    // The call-site half of discovery-rate-limit-key-db.test.ts, which pins the builder to 0075.
    const query = vi.spyOn(POOL, "query");
    const req = request("/api/discover", "2001:db8:1:2::abcd");
    expect((await GET(req)).status).toBe(200);
    const limiter = query.mock.calls.filter(
      ([sql]) => sql === "SELECT discovery_rate_limit_hit($1)",
    );
    expect(limiter.map(([, params]) => params)).toEqual([[discoveryRateLimitKey(req)]]);
    expect(discoveryRateLimitKey(req)).toBe("2001:0db8:0001:0002");
  });

  it("A-7: in production a missing or short DISCOVERY_CURSOR_KEY is the empty 500 on every list page, before any DB call", async () => {
    vi.stubEnv("NODE_ENV", "production");
    for (const key of ["", "k".repeat(31)]) {
      vi.stubEnv("DISCOVERY_CURSOR_KEY", key);
      const res = await get();
      expect([res.status, await res.text()]).toEqual([500, ""]);
    }
    expect(createDb).not.toHaveBeenCalled();
    vi.stubEnv("DISCOVERY_CURSOR_KEY", "k".repeat(32));
    expect((await get()).status).toBe(200);
  });

  it("A-17: no log line carries a listing id, an IP, money or the DB error text", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    );
    vi.mocked(listDiscoveryListings)
      .mockResolvedValueOnce({ rows: [LEAKY], next: NEXT })
      .mockRejectedValueOnce(new Error(`boom ${ID} ${IP} 120000`));
    expect([(await get()).status, (await get()).status, (await get("?skill=3")).status]).toEqual([
      200, 500, 400,
    ]);
    const logged = JSON.stringify(spies.map((spy) => spy.mock.calls));
    for (const secret of [ID, ID2, IP, "120000", TENANT, SESSION]) {
      expect(logged).not.toContain(secret);
    }
  });
});

import { createDb, readDiscoveryListing } from "@plexco/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDiscoveryRouteSupportForTests } from "../../../../lib/discovery-route-support";
import { GET } from "./route";

vi.mock("@plexco/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@plexco/db")>()),
  createDb: vi.fn(),
  readDiscoveryListing: vi.fn(),
}));

const ID = "0b5c7a7e-1f2d-4c3b-9a8e-6d5f4e3c2b1a";
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
const LEAKY = { ...ROW, tenant_id: TENANT, session_id: SESSION, confirmed_count: 7 };
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
const POOL = { query: async () => ({ rows: [{ u: "readonly", s: "readonly" }] }) };

const get = (id: string, ip = IP) =>
  GET(
    new Request(`https://plexco.app/api/discover/${encodeURIComponent(id)}`, {
      headers: { "fly-client-ip": ip },
    }),
    { params: Promise.resolve({ publicListingId: id }) },
  );

/** The response minus meta.requestId: every miss must be equal under this view (readiness 4.5). */
async function settled(res: Response) {
  const body = (await res.json()) as { meta: { requestId?: string } };
  delete body.meta.requestId;
  return { status: res.status, headers: [...res.headers], body };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetDiscoveryRouteSupportForTests();
  vi.stubEnv("DISCOVERY_DATABASE_URL", "postgres://readonly@127.0.0.1:5432/plexco_test");
  vi.stubEnv("TRUSTED_INGRESS_PROVIDER", "fly");
  vi.mocked(createDb).mockReturnValue({ pool: POOL } as never);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/discover/[publicListingId]", () => {
  it("A-2 (DD-139 / B1): a listing projected with the venue hidden (both columns NULL) serves the area and no venue key", async () => {
    vi.mocked(readDiscoveryListing).mockResolvedValueOnce({
      ...LEAKY,
      venue_name: null,
      venue_address: null,
    });
    const res = await get(ID);
    expect([res.status, res.headers.get("cache-control")]).toEqual([200, "no-store"]);
    const body = (await res.json()) as { data: { listing: object } };
    const { venueName, venueAddress, ...areaOnly } = DTO;
    expect(body.data.listing).toEqual(areaOnly);
    expect(Object.keys(body.data.listing).sort()).toEqual(Object.keys(areaOnly).sort());
    const text = JSON.stringify(body.data);
    for (const hidden of [venueName, venueAddress, "venue"]) expect(text).not.toContain(hidden);
  });

  it("A-9: a hit is the whitelist { listing } in the DD-60 envelope, no-store, read as readonly", async () => {
    vi.mocked(readDiscoveryListing).mockResolvedValueOnce({ ...LEAKY, ...GENDER_LEAK });
    const res = await get(ID);
    expect([res.status, res.headers.get("cache-control")]).toEqual([200, "no-store"]);
    const text = await res.text();
    const body = JSON.parse(text) as { data: { listing: object } };
    expect(body).toEqual({
      data: { listing: DTO },
      error: null,
      meta: { requestId: expect.stringMatching(/^req_/) },
    });
    expect(Object.keys(body.data.listing).sort()).toEqual(Object.keys(DTO).sort());
    for (const hidden of [TENANT, SESSION, "confirmed"]) expect(text).not.toContain(hidden);
    for (const k of GENDER_KEYS) expect(text).not.toContain(`"${k}"`);
    expect(readDiscoveryListing).toHaveBeenCalledWith(POOL, ID);
  });

  it("A-9: unknown, wrong-shape and raw-session-uuid ids return the ONE 404; a bad shape makes no DB call", async () => {
    vi.mocked(readDiscoveryListing).mockResolvedValue(null);
    const wellFormed = [ID, ID.toUpperCase(), SESSION];
    const wrongShape = [
      "share",
      "not-a-uuid",
      ID.replace(/-/g, ""),
      `${ID}0`,
      ` ${ID}`,
      `${ID.slice(0, -1)}g`,
    ];
    const misses = [];
    for (const id of [...wellFormed, ...wrongShape]) misses.push(await settled(await get(id)));
    expect(misses[0]).toMatchObject({
      status: 404,
      body: { data: null, error: { code: "NOT_FOUND" } },
    });
    expect(misses[0]?.headers).toContainEqual(["cache-control", "no-store"]);
    for (const miss of misses) expect(miss).toEqual(misses[0]);
    expect(vi.mocked(readDiscoveryListing).mock.calls).toEqual(wellFormed.map((id) => [POOL, id]));
  });

  it("A-7: id enumeration meets the per-IP limit at request 61; another IP passes; a readonly mismatch is an empty 500", async () => {
    vi.mocked(readDiscoveryListing).mockResolvedValue(null);
    for (let i = 0; i < 60; i += 1) expect((await get(`probe-${i}`)).status).toBe(404);
    const limited = await get(ID);
    expect([limited.status, Number(limited.headers.get("retry-after")) > 0]).toEqual([429, true]);
    const { error } = (await limited.json()) as { error: { code: string } };
    expect(error.code).toBe("DISCOVERY_RATE_LIMITED");
    expect((await get(ID, "198.51.100.9")).status).toBe(404);

    resetDiscoveryRouteSupportForTests();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const mismatch = { query: async () => ({ rows: [{ u: "readonly", s: "app" }] }) };
    vi.mocked(createDb).mockReturnValue({ pool: mismatch } as never);
    const res = await get(ID);
    expect([res.status, await res.text()]).toEqual([500, ""]);
    expect(readDiscoveryListing).toHaveBeenCalledTimes(1);
  });

  it("A-17: no log line carries the listing id, the IP, money or the DB error text", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    );
    vi.mocked(readDiscoveryListing)
      .mockResolvedValueOnce(LEAKY)
      .mockRejectedValueOnce(new Error(`boom ${ID} ${IP}`));
    expect([(await get(ID)).status, (await get(ID)).status, (await get("x")).status]).toEqual([
      200, 500, 404,
    ]);
    const logged = JSON.stringify(spies.map((spy) => spy.mock.calls));
    for (const secret of [ID, IP, "120000", TENANT, SESSION]) expect(logged).not.toContain(secret);
  });
});

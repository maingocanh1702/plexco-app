import { createDb, readDiscoveryListing, readDiscoveryListingByShareSlug } from "@plexco/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDiscoveryRouteSupportForTests } from "../../../../../lib/discovery-route-support";
import { GET as getDetail } from "../../[publicListingId]/route";
import { GET } from "./route";

vi.mock("@plexco/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@plexco/db")>()),
  createDb: vi.fn(),
  readDiscoveryListing: vi.fn(),
  readDiscoveryListingByShareSlug: vi.fn(),
}));

const SLUG = "Ab3_dE-fGhIjKlMnOpQrSt";
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
};
// Columns outside the whitelist: the key-by-key mapper must never serve them (readiness 4.4).
const LEAKY = { ...ROW, tenant_id: TENANT, session_id: SESSION, slots_max: 10 };
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
};
const POOL = { query: async () => ({ rows: [{ u: "readonly", s: "readonly" }] }) };

const request = (path: string, ip: string) =>
  new Request(`https://plexco.app/api/discover/${path}`, { headers: { "fly-client-ip": ip } });
const get = (slug: string, ip = IP) =>
  GET(request(`share/${encodeURIComponent(slug)}`, ip), { params: Promise.resolve({ slug }) });
const getById = (id: string, ip = IP) =>
  getDetail(request(id, ip), { params: Promise.resolve({ publicListingId: id }) });

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
  vi.mocked(readDiscoveryListing).mockResolvedValue(null);
  vi.mocked(readDiscoveryListingByShareSlug).mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/discover/share/[slug]", () => {
  it("A-9: a hit is the whitelist { listing } in the DD-60 envelope, no-store; the slug resolves in the DB only", async () => {
    vi.mocked(readDiscoveryListingByShareSlug).mockResolvedValueOnce(LEAKY);
    const res = await get(SLUG);
    expect([res.status, res.headers.get("cache-control")]).toEqual([200, "no-store"]);
    const text = await res.text();
    const body = JSON.parse(text) as { data: { listing: object } };
    expect(body).toEqual({
      data: { listing: DTO },
      error: null,
      meta: { requestId: expect.stringMatching(/^req_/) },
    });
    expect(Object.keys(body.data.listing).sort()).toEqual(Object.keys(DTO).sort());
    for (const hidden of [TENANT, SESSION, SLUG, "slots_max"]) expect(text).not.toContain(hidden);
    expect(readDiscoveryListingByShareSlug).toHaveBeenCalledWith(POOL, SLUG);
  });

  it("A-9: unknown, wrong-shape and raw-session-uuid slugs return the ONE 404, equal to the detail route's; a bad shape makes no DB call", async () => {
    const wellFormed = [SLUG, "0".repeat(22)];
    const wrongShape = [
      SLUG.slice(1),
      `${SLUG}x`,
      SESSION,
      `${SLUG.slice(1)}.`,
      `${SLUG.slice(1)}=`,
    ];
    const misses = [];
    for (const slug of [...wellFormed, ...wrongShape]) misses.push(await settled(await get(slug)));
    misses.push(await settled(await getById(SESSION)));
    expect(misses[0]).toMatchObject({
      status: 404,
      body: { data: null, error: { code: "NOT_FOUND" } },
    });
    expect(misses[0]?.headers).toContainEqual(["cache-control", "no-store"]);
    for (const miss of misses) expect(miss).toEqual(misses[0]);
    expect(vi.mocked(readDiscoveryListingByShareSlug).mock.calls).toEqual(
      wellFormed.map((slug) => [POOL, slug]),
    );
  });

  it("A-7: share and detail probes share one per-IP budget: request 61 is 429; another IP passes; a readonly mismatch is 500", async () => {
    for (let i = 0; i < 30; i += 1) {
      expect([(await get(`s${i}`)).status, (await getById(`d${i}`)).status]).toEqual([404, 404]);
    }
    const limited = await get(SLUG);
    expect([limited.status, Number(limited.headers.get("retry-after")) > 0]).toEqual([429, true]);
    const { error } = (await limited.json()) as { error: { code: string } };
    expect(error.code).toBe("DISCOVERY_RATE_LIMITED");
    expect((await get(SLUG, "198.51.100.9")).status).toBe(404);

    resetDiscoveryRouteSupportForTests();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const mismatch = { query: async () => ({ rows: [] }) };
    vi.mocked(createDb).mockReturnValue({ pool: mismatch } as never);
    const res = await get(SLUG);
    expect([res.status, await res.text()]).toEqual([500, ""]);
    expect(readDiscoveryListingByShareSlug).toHaveBeenCalledTimes(1);
  });

  it("A-17: no log line carries the slug, the listing id, the IP, money or the DB error text", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    );
    vi.mocked(readDiscoveryListingByShareSlug)
      .mockResolvedValueOnce(LEAKY)
      .mockRejectedValueOnce(new Error(`boom ${SLUG} ${IP}`));
    expect([(await get(SLUG)).status, (await get(SLUG)).status, (await get("x")).status]).toEqual([
      200, 500, 404,
    ]);
    const logged = JSON.stringify(spies.map((spy) => spy.mock.calls));
    for (const secret of [SLUG, ID, IP, "120000", TENANT, SESSION]) {
      expect(logged).not.toContain(secret);
    }
  });
});

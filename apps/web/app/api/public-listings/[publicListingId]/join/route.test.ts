import {
  createDb,
  joinSession,
  readDiscoveryListing,
  resolveDiscoveryListing,
  RosterMoneyError,
} from "@plexco/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDiscoveryRouteSupportForTests } from "../../../../../lib/discovery-route-support";
import { csrfOk, currentSession, rateLimited } from "../../../../../lib/session-cookies";
import { resolveTenantLang } from "../../../../../lib/tenant-lang";
import { GET as getDetail } from "../../../discover/[publicListingId]/route";
import { POST } from "./route";

vi.mock("@plexco/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@plexco/db")>()),
  createDb: vi.fn(),
  joinSession: vi.fn(),
  readDiscoveryListing: vi.fn(),
  resolveDiscoveryListing: vi.fn(),
}));

vi.mock("../../../../../lib/session-cookies", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../../lib/session-cookies")>()),
  appDb: vi.fn(() => ({ pool: {}, db: {} })),
  currentSession: vi.fn(),
  csrfOk: vi.fn(),
  rateLimited: vi.fn(),
}));

vi.mock("../../../../../lib/tenant-lang", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../../lib/tenant-lang")>()),
  resolveTenantLang: vi.fn(),
}));

const ID = "0b5c7a7e-1f2d-4c3b-9a8e-6d5f4e3c2b1a";
const TENANT = "9f0e1d2c-3b4a-4596-8877-665544332211";
const SESSION = "5e4d3c2b-1a09-4f8e-9d7c-6b5a49382716";
const PERSON = "44444444-4444-4444-8444-444444444444";
const PLAYER = "55555555-5555-4555-8555-555555555555";
const OTHER = "66666666-6666-4666-8666-666666666666";
const IP = "203.0.113.7";
const POOL = { query: async () => ({ rows: [{ u: "readonly", s: "readonly" }] }) };
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
// DD-39 4.6 (T-20): the twelve exact keys no public JSON may carry (gender_restriction is DD-41).
const GENDER_KEYS =
  `gender_enc gender_key_version gender_pricing_consent price_male price_female genderEnc
  genderKeyVersion genderPricingConsent priceMale priceFemale gender genderConsent`.split(/\s+/);
const GENDER_LEAK: object = Object.fromEntries(GENDER_KEYS.map((k) => [k, 1]));
const BODY = JSON.stringify({ commandId: "cmd-1" });
const JOINED = {
  outcome: "active",
  playerId: PLAYER,
  waitlistPosition: null,
  requestId: null,
  replayed: false,
} as const;

const post = (body: string, id = ID) =>
  POST(
    new Request(`https://plexco.app/api/public-listings/${id}/join`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": "secret",
        "fly-client-ip": IP,
      },
      body,
    }),
    { params: Promise.resolve({ publicListingId: id }) },
  );

/** The response minus meta.requestId: the join 404 must equal the detail route's (readiness 4.5). */
async function settled(res: Response) {
  const body = (await res.json()) as { meta: { requestId?: string } };
  delete body.meta.requestId;
  return { status: res.status, headers: [...res.headers], body };
}

const errorCode = async (res: Response) => [
  res.status,
  ((await res.json()) as { error: { code: string } }).error.code,
];

beforeEach(() => {
  vi.clearAllMocks();
  resetDiscoveryRouteSupportForTests();
  vi.stubEnv("DISCOVERY_DATABASE_URL", "postgres://readonly@127.0.0.1:5432/plexco_test");
  vi.stubEnv("TRUSTED_INGRESS_PROVIDER", "fly");
  vi.mocked(createDb).mockReturnValue({ pool: POOL } as never);
  vi.mocked(currentSession).mockResolvedValue({
    sessionId: "s",
    accountId: "account-1",
    personId: PERSON,
    csrfSecret: "secret",
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  vi.mocked(csrfOk).mockReturnValue(true);
  vi.mocked(rateLimited).mockResolvedValue(false);
  vi.mocked(readDiscoveryListing).mockResolvedValue(null);
  vi.mocked(resolveDiscoveryListing).mockResolvedValue({ tenantId: TENANT, sessionId: SESSION });
  vi.mocked(joinSession).mockResolvedValue(JOINED);
  vi.mocked(resolveTenantLang).mockResolvedValue("vi");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/public-listings/:publicListingId/join (L10b, readiness 4.6)", () => {
  it("A-10: no session 401, CSRF 403, actor or person bucket 429, bad body or commandId 400 / 413, each before the resolve", async () => {
    const refusals: unknown[] = [];
    vi.mocked(currentSession).mockResolvedValueOnce(null);
    refusals.push(await errorCode(await post(BODY)));
    vi.mocked(csrfOk).mockReturnValueOnce(false);
    refusals.push(await errorCode(await post(BODY)));
    for (const bucket of ["session-actor:account-1", `session-join:${PERSON}`]) {
      vi.mocked(rateLimited).mockImplementation(async (key: string) => key === bucket);
      refusals.push(await errorCode(await post(BODY)));
    }
    vi.mocked(rateLimited).mockResolvedValue(false);
    const nul = String.fromCharCode(0);
    const badBodies = [
      "{",
      "[]",
      "null",
      "{}",
      JSON.stringify({ commandId: " " }),
      JSON.stringify({ commandId: "x".repeat(201) }),
      JSON.stringify({ commandId: `a${nul}b` }),
      JSON.stringify({ commandId: 7 }),
    ];
    for (const body of badBodies) refusals.push(await errorCode(await post(body)));
    refusals.push(await errorCode(await post(JSON.stringify({ commandId: "x".repeat(65_536) }))));
    expect(refusals).toEqual([
      [401, "AUTH_REQUIRED"],
      [403, "CSRF_INVALID"],
      [429, "RATE_LIMITED"],
      [429, "RATE_LIMITED"],
      ...badBodies.map(() => [400, "INVALID_BODY"]),
      [413, "INVALID_BODY"],
    ]);
    expect(resolveDiscoveryListing).not.toHaveBeenCalled();
    expect(joinSession).not.toHaveBeenCalled();
  });

  it("A-11: joinSession gets the COOKIE person, the resolved tenant and session, the body commandId and allowGuestMembership; the body is exactly { join, replayed }, no-store, no uuid", async () => {
    const forged = JSON.stringify({
      commandId: "cmd-1",
      personId: OTHER,
      tenantId: OTHER,
      sessionId: OTHER,
      publicListingId: OTHER,
    });
    vi.mocked(joinSession).mockResolvedValueOnce({
      ...GENDER_LEAK,
      outcome: "waitlisted",
      playerId: PLAYER,
      waitlistPosition: 3,
      requestId: OTHER,
      replayed: true,
    });
    const bodies: unknown[] = [];
    for (const res of [await post(forged), await post(forged)]) {
      expect([res.status, res.headers.get("cache-control")]).toEqual([200, "no-store"]);
      const body = (await res.json()) as { meta: { requestId?: string } };
      expect(body.meta.requestId).toMatch(/^req_/);
      delete body.meta.requestId;
      expect(JSON.stringify([body, ...res.headers])).not.toMatch(UUID);
      bodies.push(body);
    }
    expect(bodies).toEqual([
      {
        data: { join: { outcome: "waitlisted", waitlistPosition: 3 }, replayed: true },
        error: null,
        meta: {},
      },
      {
        data: { join: { outcome: "active", waitlistPosition: null }, replayed: false },
        error: null,
        meta: {},
      },
    ]);
    expect(vi.mocked(resolveDiscoveryListing).mock.calls).toEqual([
      [POOL, ID],
      [POOL, ID],
    ]);
    expect(joinSession).toHaveBeenCalledWith(expect.anything(), {
      tenantId: TENANT,
      personId: PERSON,
      sessionId: SESSION,
      commandId: "cmd-1",
      allowGuestMembership: true,
    });
    expect(rateLimited).toHaveBeenCalledWith(`session-join:${PERSON}`, 10, 3600);
  });

  it.each([
    ["ALREADY_JOINED", 409],
    ["SESSION_NOT_JOINABLE", 400],
  ] as const)("L8's %s maps through mapSessionCommandError to %i", async (code, status) => {
    vi.mocked(joinSession).mockRejectedValue(new RosterMoneyError(code, "internal detail"));
    expect(await errorCode(await post(BODY))).toEqual([status, code]);
  });

  it("DD-118: an L8 refusal after the resolve answers in the club's language; a refusal before it keeps the default and never reads that language", async () => {
    vi.mocked(resolveTenantLang).mockResolvedValue("en");
    const errorText = async (res: Response) => [
      res.status,
      ((await res.json()) as { error: { message: string } }).error.message,
    ];

    vi.mocked(currentSession).mockResolvedValueOnce(null);
    expect(await errorText(await post(BODY))).toEqual([401, "Chưa đăng nhập."]);
    vi.mocked(resolveDiscoveryListing).mockResolvedValueOnce(null);
    expect((await post(BODY)).status).toBe(404);
    expect(resolveTenantLang).not.toHaveBeenCalled();

    vi.mocked(joinSession).mockRejectedValueOnce(
      new RosterMoneyError("SESSION_NOT_JOINABLE", "internal detail"),
    );
    expect(await errorText(await post(BODY))).toEqual([
      400,
      "This session is not open for joining.",
    ]);
    expect(vi.mocked(resolveTenantLang).mock.calls.map((call) => call[1])).toEqual([TENANT]);
  });

  it("DD-39 T-3: CHARGE_DERIVATION_UNAVAILABLE answers 503 with the gender-free pair in the club's language, no fallback join", async () => {
    vi.mocked(joinSession).mockRejectedValue(
      new RosterMoneyError("CHARGE_DERIVATION_UNAVAILABLE", "internal detail male"),
    );
    for (const [lang, message] of [
      ["vi", "Chưa tính được giá. Chưa có gì được ghi lại, vui lòng thử lại sau."],
      ["en", "The price could not be worked out. Nothing was saved; please try again later."],
    ] as const) {
      vi.mocked(resolveTenantLang).mockResolvedValueOnce(lang);
      const res = await post(BODY);
      const body = (await res.json()) as {
        data: unknown;
        error: { code: string; message: string };
      };
      expect([res.status, body.error.code, body.error.message]).toEqual([
        503,
        "CHARGE_DERIVATION_UNAVAILABLE",
        message,
      ]);
      expect(JSON.stringify(body)).not.toMatch(/internal detail|outcome/);
    }
  });

  it("a non-domain failure is rethrown (500), never turned into a success or a 404", async () => {
    vi.mocked(joinSession).mockRejectedValue(new Error("boom"));
    await expect(post(BODY)).rejects.toThrow("boom");
  });

  it("A-12: an unresolvable, raw-session-uuid or wrong-shape listing id returns the detail route's ONE 404; a bad shape is never resolved", async () => {
    vi.mocked(resolveDiscoveryListing).mockResolvedValue(null);
    const detail = await settled(
      await getDetail(
        new Request(`https://plexco.app/api/discover/${ID}`, { headers: { "fly-client-ip": IP } }),
        { params: Promise.resolve({ publicListingId: ID }) },
      ),
    );
    expect(detail).toMatchObject({
      status: 404,
      body: { data: null, error: { code: "NOT_FOUND" } },
    });
    for (const id of [ID, SESSION, "x", `${ID}x`]) {
      expect(await settled(await post(BODY, id))).toEqual(detail);
    }
    expect(vi.mocked(resolveDiscoveryListing).mock.calls).toEqual([
      [POOL, ID],
      [POOL, SESSION],
    ]);
    expect(joinSession).not.toHaveBeenCalled();
  });

  it("A-17: no log line carries the listing id, the person, the IP, the tenant, the session or the player id", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    );
    vi.mocked(resolveDiscoveryListing).mockResolvedValueOnce(null);
    vi.mocked(joinSession)
      .mockResolvedValueOnce(JOINED)
      .mockRejectedValueOnce(new RosterMoneyError("ALREADY_JOINED", "internal detail"));
    const statuses = [];
    for (const id of [ID, ID, ID, "x"]) statuses.push((await post(BODY, id)).status);
    expect(statuses).toEqual([404, 200, 409, 404]);
    const logged = JSON.stringify(spies.map((spy) => spy.mock.calls));
    for (const secret of [ID, PERSON, IP, TENANT, SESSION, PLAYER]) {
      expect(logged).not.toContain(secret);
    }
  });
});

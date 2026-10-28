import { createDb, listDiscoveryListings } from "@plexco/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  discoveryRateLimited,
  resetDiscoveryRouteSupportForTests,
  setDiscoveryBreakerStateForTests,
} from "../../../lib/discovery-route-support";
import { log } from "../../../lib/log";
import { GET } from "./route";

vi.mock("@plexco/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@plexco/db")>()),
  createDb: vi.fn(),
  listDiscoveryListings: vi.fn(),
}));

// The breaker (readiness 8.1) and the statuses (8.2) through the list route and the limiter: a
// failure is a limiter query that rejects or answers a bad value, a held probe is a deferred query,
// and fake timers drive Date.now().
const IP = "203.0.113.7";
const LIMITER_SQL = "SELECT discovery_rate_limit_hit($1)";
const T0 = Date.parse("2026-11-01T09:00:00.000Z");
type Rows = { rows: unknown[] };
// null: the keyed fake below; a test sets it to make the limiter SQL reject, hold or answer badly.
let fault: (() => Promise<Rows>) | null = null;
// R9: the DB limiter as a keyed fake, reset per test: 0 while a key has at most 60 hits, then 30.
const hits = new Map<string, number>();
const POOL = {
  query: vi.fn(async (sql: string, [key = ""]: string[] = []): Promise<Rows> => {
    if (sql !== LIMITER_SQL) return { rows: [{ u: "readonly", s: "readonly" }] };
    if (fault) return fault();
    const count = (hits.get(key) ?? 0) + 1;
    hits.set(key, count);
    return { rows: [{ discovery_rate_limit_hit: count > 60 ? 30 : 0 }] };
  }),
};

const request = (path: string, ip = IP) =>
  new Request(`https://plexco.app${path}`, { headers: { "fly-client-ip": ip } });
const get = () => GET(request("/api/discover"));
const at = (ms: number) => vi.setSystemTime(T0 + ms);
const limiterCalls = () => POOL.query.mock.calls.filter(([sql]) => sql === LIMITER_SQL).length;
const returns = (value: unknown) => () =>
  Promise.resolve({ rows: [{ discovery_rate_limit_hit: value }] });
const down = () => Promise.reject(new Error("connect ECONNRESET"));

/** The empty 503 of readiness 8.2: no-store, with the row's retry-after (null: none). */
async function is503(res: Response, retryAfter: string | null) {
  const headers = [res.headers.get("cache-control"), res.headers.get("retry-after")];
  expect([res.status, await res.text(), ...headers]).toEqual([503, "", "no-store", retryAfter]);
}

/** One list call that answers the 503, and whether POOL.query ran for it. */
async function expect503(retryAfter: string | null, db: boolean) {
  const before = POOL.query.mock.calls.length;
  await is503(await get(), retryAfter);
  expect(POOL.query.mock.calls.length > before).toBe(db);
}

/** n calls whose limiter query rejects: each is the limiter's 503, no retry-after, after its query. */
async function fail(n: number) {
  fault = down;
  for (let i = 0; i < n; i += 1) await expect503(null, true);
  fault = null;
}

/** One list call admitted to the DB (one limiter query) that answers the base 200. */
async function expect200() {
  const before = limiterCalls();
  expect((await get()).status).toBe(200);
  expect(limiterCalls()).toBe(before + 1);
}

/** Holds the next limiter query: `inFlight` settles once a call is inside it; `release` answers 0,
 * `reject` fails it. */
function holdLimiter() {
  let reached: () => void = () => {};
  let settle: (rows: Rows) => void = () => {};
  let refuse: (error: Error) => void = () => {};
  const inFlight = new Promise<void>((resolve) => {
    reached = () => resolve();
  });
  fault = () => {
    reached();
    return new Promise<Rows>((resolve, reject) => {
      settle = resolve;
      refuse = reject;
    });
  };
  return {
    inFlight,
    release: () => settle({ rows: [{ discovery_rate_limit_hit: 0 }] }),
    reject: () => refuse(new Error("connect ECONNRESET")),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetDiscoveryRouteSupportForTests();
  hits.clear();
  fault = null;
  vi.useFakeTimers();
  vi.setSystemTime(T0);
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

describe("discovery breaker and statuses (readiness 8.1, 8.2)", () => {
  it("L73 A-14 row 1: a CLOSED call reaches the DB", async () => {
    await expect200();
    expect(listDiscoveryListings).toHaveBeenCalledTimes(1);
  });

  it("L73 A-14 row 2: a success keeps the count: 4 failures, a success and 1 failure open it", async () => {
    await fail(4);
    await expect200();
    await fail(1);
    await expect503("30", false);
  });

  it("L73 A-14 row 2: a limiter refusal (429) is a success and never counts: after 6 the next allowed call reaches the DB", async () => {
    fault = returns(30);
    for (let i = 0; i < 6; i += 1) {
      const res = await get();
      expect([res.status, res.headers.get("retry-after")]).toEqual([429, "30"]);
    }
    fault = null;
    await expect200();
  });

  it("L73 A-14 row 3: a failure after the window expired restarts the count at 1", async () => {
    await fail(4);
    at(10_000);
    await fail(4); // a window from now: all four still reach the DB
    await fail(1); // the 5th in the new window opens it
    await expect503("30", false);
  });

  it("L73 A-14 row 4: four failures in 10 s keep it CLOSED", async () => {
    for (const ms of [0, 3_000, 6_000, 9_999]) {
      at(ms);
      await fail(1);
    }
    await expect200();
  });

  it("L73 A-14 row 5: the 5th failure in the window opens it: the next call is 503 retry-after 30 with no DB call", async () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => {});
    await fail(5);
    await expect503("30", false);
    expect(listDiscoveryListings).not.toHaveBeenCalled();
    // One key-free line per opening, none per refused call.
    expect(warn.mock.calls).toEqual([["discovery.breaker.open"]]);
  });

  it("L73 A-14 row 6: OPEN answers retry-after = ceil(remaining s): 18 at +12.5 s", async () => {
    await fail(5);
    at(12_500);
    await expect503("18", false);
  });

  it("L73 A-14 row 7: the call at openUntil runs once as the probe (1 ms before, it is refused)", async () => {
    await fail(5);
    at(29_999);
    await expect503("1", false);
    at(30_000);
    await expect200();
  });

  it("L73 A-14 row 8: while the probe is held, a second call is 503 retry-after 1 with no DB call", async () => {
    await fail(5);
    at(30_000);
    const probe = holdLimiter();
    const first = get();
    await probe.inFlight;
    await expect503("1", false);
    probe.release();
    expect((await first).status).toBe(200);
  });

  it("L73 A-14 row 9: a probe success closes it with count 0: 4 failures then keep it CLOSED", async () => {
    await fail(5);
    at(30_000);
    await expect200();
    await fail(4);
    await expect200();
  });

  it("L73 A-14 row 10: a probe failure, or a probe whose discoveryPool() rejects (the 500), reopens it for a fresh 30 s", async () => {
    await fail(5);
    at(30_000);
    await fail(1); // the probe
    await expect503("30", false);
    resetDiscoveryRouteSupportForTests();
    vi.stubEnv("DISCOVERY_DATABASE_URL", "");
    setDiscoveryBreakerStateForTests("HALF_OPEN");
    const res = await get();
    expect([res.status, await res.text(), res.headers.get("cache-control")]).toEqual([
      500,
      "",
      "no-store",
    ]);
    await expect503("30", false);
  });

  it("L73 A-14 row 11: a call admitted while CLOSED that fails after the breaker opened leaves openUntil: retry-after 25 at +5 s, not a fresh 30", async () => {
    const early = holdLimiter();
    const admitted = discoveryRateLimited(request("/api/discover"));
    await early.inFlight;
    await fail(5);
    at(5_000); // inside the 10 s window: counted, this 6th failure would reopen it for 30 s
    early.reject(); // a late failure of the old generation
    await is503((await admitted) as Response, null); // its own answer: the limiter's 503
    await expect503("25", false);
  });

  it("L73 A-14 row 11: a stale success settling while the probe is held leaves it HALF_OPEN: the next call is 503 retry-after 1", async () => {
    const early = holdLimiter();
    const admitted = discoveryRateLimited(request("/api/discover"));
    await early.inFlight;
    await fail(5);
    at(30_000);
    const probe = holdLimiter();
    const first = get(); // the probe (row 7)
    await probe.inFlight;
    fault = null; // a call wrongly admitted next reaches the keyed fake: 200, not a hang
    early.release(); // a late success of the CLOSED generation
    expect(await admitted).toBeNull(); // its own base answer: allowed
    await expect503("1", false); // the probe is still the only one (row 8)
    probe.release();
    expect((await first).status).toBe(200);
  });

  it("L73 A-14 row 12: an unknown state opens a real period: 503 retry-after 30, no DB call, only the state logged; the next call is row 6", async () => {
    const error = vi.spyOn(log, "error").mockImplementation(() => {});
    setDiscoveryBreakerStateForTests("BROKEN");
    await expect503("30", false);
    expect(error).toHaveBeenCalledWith("discovery.breaker.state.unknown", { state: "BROKEN" });
    at(10_000);
    await expect503("20", false);
    expect(error).toHaveBeenCalledTimes(1);
    at(30_000);
    await expect200(); // rows 7 and 9: the probe closes it
  });

  it.each([
    { name: "rejection (a plain Error)", limiter: () => Promise.reject(new Error("boom")) },
    {
      name: "statement timeout (57014)",
      limiter: () =>
        Promise.reject(Object.assign(new Error("canceling statement"), { code: "57014" })),
    },
    { name: "client timeout", limiter: () => Promise.reject(new Error("Query read timeout")) },
    { name: "NULL result", limiter: returns(null) },
    { name: "result 61", limiter: returns(61) },
    { name: "result -1", limiter: returns(-1) },
    { name: 'string result "0"', limiter: returns("0") },
  ])(
    "L73 A-15: a limiter $name is the empty 503, no-store, without retry-after, and no list read",
    async ({ limiter }) => {
      fault = limiter;
      await expect503(null, true);
      expect(listDiscoveryListings).not.toHaveBeenCalled();
    },
  );

  it("L73 A-15: five calls whose role probe is unavailable answer the 500 and do not open the breaker", async () => {
    for (let i = 0; i < 5; i += 1) {
      POOL.query.mockRejectedValueOnce(new Error("connect ECONNREFUSED"));
    }
    for (let i = 0; i < 5; i += 1) {
      const res = await get();
      expect([res.status, await res.text(), res.headers.get("cache-control")]).toEqual([
        500,
        "",
        "no-store",
      ]);
    }
    expect(limiterCalls()).toBe(0);
    await expect200(); // a working probe: the next call reaches the limiter
  });

  it("L73 A-17: a limiter query that rejects as pg's client timeout at 2 500 ms answers 503 no-store, no hang", async () => {
    fault = () =>
      new Promise<Rows>((_, reject) => {
        setTimeout(() => reject(new Error("Query read timeout")), 2_500);
      });
    let settled = false;
    const pending = get().finally(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(2_499);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await is503(await pending, null);
    expect(limiterCalls()).toBe(1);
    // the fake's 2 500 ms is the client timeout drs gives the pool (DISCOVERY_QUERY_TIMEOUT_MS)
    expect(vi.mocked(createDb).mock.calls[0]?.[1]).toMatchObject({ query_timeout: 2_500 });
  }, 2_000);
});

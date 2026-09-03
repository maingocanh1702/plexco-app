import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { acquireChatDefinerLock } from "./test-harness.js";

/**
 * Covers the harness itself rather than using it (CDL-1..CDL-6).
 *
 * acquireChatDefinerLock hands back `release` as the ONLY way to close the client it opened, so
 * every rejection before that handoff is a client with no owner. This suite pins both pre-return
 * rejection points -- connect() and the advisory-lock query -- plus the happy path they must not
 * disturb.
 *
 * On proving "no client remains open". The two branches admit different evidence and it matters
 * which one is used where:
 *   - lock-query branch: the client really connected, so the backend is visible in
 *     pg_stat_activity. Each acquiring connection carries a unique application_name, which makes
 *     the count exact under fileParallelism instead of racing every other suite's connections.
 *     This is server-side proof and is the strong one.
 *   - connect branch: no backend was ever established, so the server has nothing to say. The only
 *     honest observable is that end() was called on the client, asserted by identity on the
 *     instances the spy saw -- not a count, which would silently pass if some other client in the
 *     process happened to close.
 */

const BASE = process.env.DATABASE_URL_TEST;
if (!BASE) {
  throw new Error(
    "DATABASE_URL_TEST is required for the test-harness suite (CI sets it; locally: " +
      "docker compose -f infra/docker-compose.yml up -d postgres and export " +
      "DATABASE_URL_TEST=postgres://plexco:plexco_dev@localhost:5432/plexco_test)",
  );
}

// Must equal test-harness.ts's own CHAT_DEFINER_LOCK_KEY. Not imported because it is deliberately
// module-private there, and exporting it purely for a test would widen that module's surface for
// no behavioural reason -- so this suite asserts against the real lock through pg_locks/
// pg_try_advisory_lock, which fails loudly if the two ever diverge (CDL-5 would stop observing a
// held lock).
const CHAT_DEFINER_LOCK_KEY = 0x63686164;

let observer: pg.Client;
let appNameCounter = 0;

/** A fresh application_name per acquisition, so backend counting is exact under fileParallelism. */
function taggedUrl(): { url: string; appName: string } {
  const appName = `cdl_test_${process.pid}_${++appNameCounter}`;
  const u = new URL(BASE!);
  u.searchParams.set("application_name", appName);
  return { url: u.toString(), appName };
}

function unreachableDbUrl(): string {
  const u = new URL(BASE!);
  u.pathname = `/cdl_no_such_db_${process.pid}`;
  return u.toString();
}

async function countBackends(appName: string): Promise<number> {
  const r = await observer.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name = $1",
    [appName],
  );
  return r.rows[0]!.n;
}

/**
 * Advisory locks on the chat_definer key held BY ONE tagged connection.
 *
 * Deliberately not a cluster-wide count (codex round-02 [P1]). The key is cluster-global and
 * legitimately contended: migrate.test.ts and rls-invariants.test.ts take it at 39 sites between
 * them, and migrate.test.ts:366 holds it across a whole bootstrap+migrate+restore. With
 * fileParallelism:true a peer acquiring or releasing between two cluster-wide samples moves the
 * number for reasons that have nothing to do with this slice, so a before/after comparison would
 * fail on correct cleanup -- a flake that reads as a real leak. Joining pg_locks to
 * pg_stat_activity on pid and filtering by the per-acquisition application_name makes the
 * measurement immune to every other holder.
 */
async function advisoryLocksHeldBy(appName: string): Promise<number> {
  const r = await observer.query<{ n: number }>(
    `SELECT count(*)::int AS n
       FROM pg_locks l
       JOIN pg_stat_activity a ON a.pid = l.pid
      WHERE l.locktype = 'advisory' AND l.objid = $1 AND l.granted AND a.application_name = $2`,
    [CHAT_DEFINER_LOCK_KEY, appName],
  );
  return r.rows[0]!.n;
}

/**
 * CDL-5 and CDL-6 take the REAL cluster-global lock, so they queue behind any peer file already
 * holding it -- by design, that is what the lock is for. The 30s default testTimeout
 * (vitest.config.ts) measures only this test's own work and does not budget for that wait, so a
 * peer mid-migration could time them out despite everything being correct. This is the wait, not
 * the work; hookTimeout's own 120s is the repo's existing sense of "long cluster-global operation".
 */
const REAL_LOCK_TIMEOUT_MS = 120_000;

/**
 * Mirrors migrate.test.ts's mockQuerySiteFailure: intercept ONE statement on the shared prototype
 * and delegate everything else, so the observer connection keeps working while the lock query
 * fails. The spy is process-local, so it cannot reach another test file's worker.
 */
function rejectLockQueryWith(error: Error) {
  const original = pg.Client.prototype.query;
  return vi.spyOn(pg.Client.prototype, "query").mockImplementation(function (
    this: pg.Client,
    ...args: unknown[]
  ) {
    const text = typeof args[0] === "string" ? args[0] : (args[0] as { text?: string })?.text;
    if (typeof text === "string" && text.includes("pg_advisory_lock(")) {
      return Promise.reject(error);
    }
    return (original as (...a: unknown[]) => unknown).apply(this, args) as Promise<unknown>;
  });
}

/** Records the client instances end() was called on, so assertions are by identity, not by count. */
function spyOnEndedClients() {
  const ended = new Set<pg.Client>();
  const original = pg.Client.prototype.end;
  const spy = vi.spyOn(pg.Client.prototype, "end").mockImplementation(function (
    this: pg.Client,
    ...args: unknown[]
  ) {
    ended.add(this);
    return (original as (...a: unknown[]) => unknown).apply(this, args) as Promise<void>;
  });
  return { ended, spy };
}

beforeAll(async () => {
  observer = new pg.Client({ connectionString: BASE });
  // No guardClientErrors here on purpose: this connection is never torn down by a DROP DATABASE
  // FORCE, so a 57P01 on it would be a genuine fault and must not be swallowed.
  await observer.connect();
});

afterAll(async () => {
  await observer.end();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("acquireChatDefinerLock", () => {
  it("CDL-1: a connect() rejection closes the client and propagates the ORIGINAL error", async () => {
    const { ended } = spyOnEndedClients();

    const caught = await acquireChatDefinerLock(unreachableDbUrl()).then(
      () => null,
      (e: unknown) => e,
    );

    // Unwrapped: the pg error itself, still carrying the code that says why. A wrapper would show
    // up as a missing code or a populated .cause.
    expect(caught).toBeInstanceOf(Error);
    expect(caught).toMatchObject({ code: "3D000" });
    expect((caught as Error).cause).toBeUndefined();

    // Exactly the client this call opened was closed -- asserted by identity.
    expect(ended.size).toBe(1);
  });

  it("CDL-2: a lock-query rejection leaves NO backend on the server", async () => {
    const { url, appName } = taggedUrl();
    const sentinel = new Error("lock query exploded");
    const spy = rejectLockQueryWith(sentinel);

    try {
      // toBe, not toMatchObject: identity is the assertion. Any rewrap fails here.
      await expect(acquireChatDefinerLock(url)).rejects.toBe(sentinel);
    } finally {
      spy.mockRestore();
    }

    // Server-side proof. Polled rather than read once: end() resolving and the backend
    // disappearing are two different events, and asserting the first while claiming the second is
    // exactly the gap this test exists to close.
    await expect.poll(() => countBackends(appName), { timeout: 5_000 }).toBe(0);
  });

  // Complementary property, NOT a leak detector: measured against the pre-fix shape this test still
  // passes, because a mocked-away lock query never took a lock in the first place. It is here to pin
  // that the failure path strands nothing cluster-global, which is the consequence that would
  // outlive the process. CDL-1 and CDL-2 are the two that actually fail without the fix.
  it("CDL-3: a lock-query rejection strands no advisory lock on its own connection", async () => {
    const { url, appName } = taggedUrl();
    const spy = rejectLockQueryWith(new Error("lock query exploded"));

    try {
      await expect(acquireChatDefinerLock(url)).rejects.toThrow("lock query exploded");
    } finally {
      spy.mockRestore();
    }

    // Absolute zero for THIS connection, not a delta against a cluster-wide sample -- see
    // advisoryLocksHeldBy. Concurrent peers may hold the same key throughout; that is correct and
    // must not register here.
    await expect.poll(() => advisoryLocksHeldBy(appName), { timeout: 5_000 }).toBe(0);
  });

  it("CDL-4: the fix is not vacuous — without it the failed acquisition WOULD leak a backend", async () => {
    // Reproduces the pre-fix shape inline (same three calls, no try) and shows it leaks, so CDL-2
    // cannot pass for reasons unrelated to the catch. Cleaned up by hand, which is the whole point:
    // the real function gives its caller no handle to do this with.
    const { url, appName } = taggedUrl();
    const leaked = new pg.Client({ connectionString: url });
    leaked.on("error", () => {});
    await leaked.connect();
    // end() is unconditional from the moment the connection exists (codex round-01 [P2]). Without
    // this finally, a throw from the rejection assertion or the count below would strand a
    // connected client for the rest of the run -- this file demonstrating, live, the exact defect
    // it was written to prove. The reproduction must be the only thing here that leaks, and only
    // while it is being measured.
    try {
      const boom = new Error("lock query exploded");
      const spy = rejectLockQueryWith(boom);
      try {
        await expect(
          leaked.query("SELECT pg_advisory_lock($1)", [CHAT_DEFINER_LOCK_KEY]),
        ).rejects.toBe(boom);
      } finally {
        spy.mockRestore();
      }

      // The backend is STILL there — this is the defect, reproduced.
      expect(await countBackends(appName)).toBe(1);
    } finally {
      await leaked.end();
    }

    await expect.poll(() => countBackends(appName), { timeout: 5_000 }).toBe(0);
  });

  it(
    "CDL-5: the happy path still acquires a real lock, and release() frees it",
    async () => {
      const { url, appName } = taggedUrl();
      // May block here behind a peer file holding the same cluster-global key -- see
      // REAL_LOCK_TIMEOUT_MS.
      const { release } = await acquireChatDefinerLock(url);

      try {
        expect(await countBackends(appName)).toBe(1);

        // The lock is genuinely held BY THIS connection. Asserted per-connection rather than by a
        // cluster-wide probe, for the same reason as CDL-3: a peer holding the same key is normal.
        expect(await advisoryLocksHeldBy(appName)).toBe(1);

        // And it genuinely excludes others: a non-blocking attempt from another session must fail.
        // pg_try_advisory_lock rather than pg_advisory_lock — the blocking form from a second
        // connection is the deadlock this file's own comments warn about.
        const tried = await observer.query<{ got: boolean }>(
          "SELECT pg_try_advisory_lock($1) AS got",
          [CHAT_DEFINER_LOCK_KEY],
        );
        if (tried.rows[0]!.got) {
          // Defensive: if it unexpectedly succeeded, give it back before failing, or this session
          // holds the cluster-global lock for the rest of the run.
          await observer.query("SELECT pg_advisory_unlock($1)", [CHAT_DEFINER_LOCK_KEY]);
        }
        expect(tried.rows[0]!.got).toBe(false);
      } finally {
        await release();
      }

      await expect.poll(() => countBackends(appName), { timeout: 5_000 }).toBe(0);
      expect(await advisoryLocksHeldBy(appName)).toBe(0);
    },
    REAL_LOCK_TIMEOUT_MS,
  );

  it(
    "CDL-6: a second release() is still a no-op",
    async () => {
      const { url, appName } = taggedUrl();
      // May block here behind a peer, exactly as CDL-5 may.
      const { release } = await acquireChatDefinerLock(url);

      const { ended } = spyOnEndedClients();
      await release();
      await expect(release()).resolves.toBeUndefined();
      await expect(release()).resolves.toBeUndefined();

      // Idempotent by the `released` flag, so end() runs once however often release() is called.
      expect(ended.size).toBe(1);
      await expect.poll(() => countBackends(appName), { timeout: 5_000 }).toBe(0);
      expect(await advisoryLocksHeldBy(appName)).toBe(0);
    },
    REAL_LOCK_TIMEOUT_MS,
  );
});

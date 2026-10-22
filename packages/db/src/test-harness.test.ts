import { execFile } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acquireChatDefinerLock,
  bootstrapJobDefiner,
  createRolePasswordLeaser,
  MIGRATE_ADVISORY_LOCK_KEY,
  setupRlsTestContext,
  withAdvisoryLocks,
  withDefinerReadLock,
  withJobDefinerLock,
  type TestRolePasswordLease,
} from "./test-harness.js";

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
function rejectLockQueryWith(error: Error, statement = /pg_advisory_lock\(/) {
  const original = pg.Client.prototype.query;
  return vi.spyOn(pg.Client.prototype, "query").mockImplementation(function (
    this: pg.Client,
    ...args: unknown[]
  ) {
    const text = typeof args[0] === "string" ? args[0] : (args[0] as { text?: string })?.text;
    if (typeof text === "string" && statement.test(text)) {
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

const HERE = path.dirname(fileURLToPath(import.meta.url));
// test-harness.ts's module-private keys, re-stated for the same reason as CHAT_DEFINER_LOCK_KEY.
const JOB_DEFINER_LOCK_KEY = 0x6a6f6264;
const CHAT_DEFINER_STATE_LOCK_KEY = 0x63687374;
/** Advisory keys of this process alone: the proofs below never touch a real definer lock. */
const scratchKey = (n: number) => 0x7a000000 + (process.pid % 0x10000) * 16 + n;

describe("createRolePasswordLeaser, on scratch roles and keys (RPW)", () => {
  const role = (suffix: string) => `zz_rpw_${process.pid}_${suffix}`;
  const [roleA, roleB, roleC] = [role("a"), role("b"), role("c")];
  const passwords = { [roleA]: "rpw_test_a", [roleB]: "rpw_test_b", [roleC]: "rpw_test_c" };
  let config: Parameters<typeof createRolePasswordLeaser>[0];
  let lease: (base: string) => Promise<TestRolePasswordLease>;
  const stateSql =
    "SELECT rolname, rolpassword, rolcanlogin FROM pg_authid WHERE rolname = ANY($1)";
  const roleState = async () =>
    (await observer.query(`${stateSql} ORDER BY 1`, [[roleA, roleB, roleC]])).rows;

  beforeEach(async () => {
    const storeDir = mkdtempSync(path.join(os.tmpdir(), "plexco-rpw-"));
    config = { passwords, mutexKey: scratchKey(1), participantKey: scratchKey(2), storeDir };
    lease = createRolePasswordLeaser(config);
    for (const name of [roleA, roleB, roleC]) await observer.query(`DROP ROLE IF EXISTS ${name}`);
    // Pre-run state: A logs in with a password of its own, B is NOLOGIN with one, C is absent.
    await observer.query(`CREATE ROLE ${roleA} LOGIN PASSWORD 'rpw_orig_a'`);
    await observer.query(`CREATE ROLE ${roleB} NOLOGIN PASSWORD 'rpw_orig_b'`);
  });

  afterEach(async () => {
    for (const name of [roleA, roleB, roleC]) await observer.query(`DROP ROLE IF EXISTS ${name}`);
    rmSync(config.storeDir, { recursive: true, force: true });
  });

  it("RPW-1: concurrent participants write one at a time — no two ALTER ROLE ... PASSWORD overlap", async () => {
    const spans: [number, number][] = [];
    const original = pg.Client.prototype.query;
    vi.spyOn(pg.Client.prototype, "query").mockImplementation(function (
      this: pg.Client,
      ...args: unknown[]
    ) {
      const result = (original as (...a: unknown[]) => Promise<unknown>).apply(this, args);
      if (!/^ALTER ROLE .* PASSWORD/.test(String(args[0]))) return result;
      const start = performance.now();
      return result.finally(() => spans.push([start, performance.now()]));
    });
    const leases = await Promise.all([1, 2, 3, 4].map(() => lease(BASE!)));
    vi.restoreAllMocks();
    for (const held of leases) await held.release();
    expect(spans).toHaveLength(8); // 4 participants x the 2 roles that exist
    spans.sort((x, y) => x[0] - y[0]);
    for (let i = 1; i < spans.length; i++)
      expect(spans[i]![0]).toBeGreaterThanOrEqual(spans[i - 1]![1]);
  });

  it("RPW-2: only the last participant restores, exactly; a role absent at the snapshot ends with no password and stays", async () => {
    const before = await roleState();
    const first = await lease(BASE!);
    await observer.query(`CREATE ROLE ${roleC} LOGIN PASSWORD 'rpw_orig_c'`);
    const second = await lease(BASE!);
    await first.release();
    const midRun = await roleState(); // a participant is still alive: nothing restored under it
    expect(midRun.filter((r) => before.some((b) => b.rolpassword === r.rolpassword))).toEqual([]);
    await second.release();
    const after = await roleState();
    expect(after.slice(0, 2)).toEqual(before);
    expect(after[2]).toMatchObject({ rolname: roleC, rolpassword: null, rolcanlogin: true });
    expect(readdirSync(config.storeDir)).toEqual([]);
  });

  it(
    "RPW-3: a participant killed mid-run leaves its snapshot; the next complete run restores the original, not the test value",
    async () => {
      const before = await roleState();
      const script = path.join(config.storeDir, "..", `plexco-rpw-killed-${process.pid}.mts`);
      const harness = pathToFileURL(path.join(HERE, "test-harness.ts")).href;
      writeFileSync(
        script,
        `const { createRolePasswordLeaser } = await import(${JSON.stringify(harness)});
         await createRolePasswordLeaser(JSON.parse(process.env.RPW_CONFIG))(process.env.DATABASE_URL_TEST);
         process.kill(process.pid, "SIGKILL");`,
      );
      const tsx = path.join(HERE, "..", "node_modules", ".bin", "tsx");
      const env = { ...process.env, RPW_CONFIG: JSON.stringify(config) };
      const killed = await promisify(execFile)(tsx, [script], { env }).then(
        () => null,
        (error: { code?: number; signal?: string }) => error.signal ?? error.code, // tsx relays 137
      );
      rmSync(script, { force: true });
      expect(["SIGKILL", 137]).toContain(killed);
      expect((await roleState())[0]!.rolpassword).not.toBe(before[0]!.rolpassword); // test value left
      expect(readdirSync(config.storeDir)).toHaveLength(1);
      const held =
        "SELECT count(*)::int AS n FROM pg_locks WHERE objid = $1 AND locktype = 'advisory'";
      await expect // the killed session's backend is gone once its participant hold is
        .poll(async () => (await observer.query(held, [config.participantKey])).rows[0].n)
        .toBe(0);
      await (await lease(BASE!)).release();
      expect(await roleState()).toEqual(before);
    },
    REAL_LOCK_TIMEOUT_MS,
  );

  it("RPW-4: a failed lock, snapshot or restore rejects with the ORIGINAL error and closes its client; a failed restore keeps the snapshot", async () => {
    for (const statement of [/^SELECT pg_advisory_lock\(/, /FROM pg_authid/]) {
      const sentinel = new Error(`injected at ${statement}`);
      const { ended } = spyOnEndedClients();
      rejectLockQueryWith(sentinel, statement);
      await expect(lease(BASE!)).rejects.toBe(sentinel);
      vi.restoreAllMocks();
      expect(ended.size).toBe(1);
    }
    const before = await roleState();
    const held = await lease(BASE!);
    const sentinel = new Error("injected restore failure");
    rejectLockQueryWith(sentinel, /^ALTER ROLE/);
    await expect(held.release()).rejects.toBe(sentinel);
    vi.restoreAllMocks();
    expect(readdirSync(config.storeDir)).toHaveLength(1);
    await (await lease(BASE!)).release();
    expect(await roleState()).toEqual(before);
  });
});

describe("withAdvisoryLocks, on scratch keys (LCK)", () => {
  const [k1, k2] = [scratchKey(3), scratchKey(4)];
  /** Holds keys on a tagged session: `inside` resolves once fn runs, `leave()` lets it finish. */
  function hold(keys: number[], mode: "shared" | "exclusive") {
    const { url, appName } = taggedUrl();
    let enter!: () => void;
    let exit!: () => void;
    const inside = new Promise<void>((r) => (enter = r));
    const body = () => (enter(), new Promise<void>((r) => (exit = r)));
    const done = withAdvisoryLocks(url, keys, mode, body);
    return { appName, inside, leave: () => (exit(), done) };
  }
  const locksSql = `SELECT l.objid::text AS key, l.mode, l.granted FROM pg_locks l JOIN pg_stat_activity a
    ON a.pid = l.pid WHERE l.locktype = 'advisory' AND a.application_name = $1 ORDER BY 1`;
  type Held = { key: string; mode: string; granted: boolean };
  const locksOf = async (appName: string) => (await observer.query<Held>(locksSql, [appName])).rows;
  const waiting = async (appName: string, key: number) =>
    (await locksOf(appName)).some((l) => l.key === String(key) && !l.granted);
  const waitsOn = (appName: string, key: number) =>
    expect.poll(() => waiting(appName, key), { timeout: 10_000 }).toBe(true);

  it("LCK-1: readers share a key; a breaker excludes readers and readers exclude a breaker", async () => {
    const reader = hold([k1], "shared");
    await reader.inside;
    const second = hold([k1], "shared");
    await second.inside; // in while the first reader still is
    const breaker = hold([k1], "exclusive");
    await waitsOn(breaker.appName, k1);
    const late = hold([k1], "shared");
    await waitsOn(late.appName, k1); // queued behind the waiting breaker
    await Promise.all([reader.leave(), second.leave()]);
    await breaker.inside;
    expect((await locksOf(late.appName)).some((l) => l.granted)).toBe(false);
    await breaker.leave();
    await late.inside;
    await late.leave();
  });

  it("LCK-2: a reader waiting on one busy key holds none of the others", async () => {
    const breaker = hold([k2], "exclusive");
    await breaker.inside;
    const reader = hold([k1, k2], "shared");
    await waitsOn(reader.appName, k2);
    expect((await locksOf(reader.appName)).filter((l) => l.granted)).toEqual([]);
    await breaker.leave();
    await reader.inside;
    expect((await locksOf(reader.appName)).map((l) => l.granted)).toEqual([true, true]);
    await reader.leave();
  });

  it(
    "LCK-3: the reader wrappers hold the shared side of jobd, and withDefinerReadLock of chst too",
    async () => {
      const { url, appName } = taggedUrl();
      const held = async () => (await locksOf(appName)).map((l) => `${l.key} ${l.mode}`).sort();
      const [jobd, chst] = [JOB_DEFINER_LOCK_KEY, CHAT_DEFINER_STATE_LOCK_KEY].map(
        (k) => `${k} ShareLock`,
      );
      expect(await withJobDefinerLock(url, held)).toEqual([jobd]);
      expect(await withDefinerReadLock(url, held)).toEqual([jobd, chst].sort());
    },
    REAL_LOCK_TIMEOUT_MS,
  );
});

describe("setupRlsTestContext (HRN)", () => {
  it(
    "HRN-1: teardown drops the database the context created",
    async () => {
      await (await setupRlsTestContext("plexco_harness_teardown_check")).teardown();
      const sql = "SELECT 1 FROM pg_database WHERE datname = 'plexco_harness_teardown_check'";
      expect((await observer.query(sql)).rows).toEqual([]);
    },
    REAL_LOCK_TIMEOUT_MS,
  );
});

describe("withJobDefinerBootstrapLock (JDB)", () => {
  // Advisory locks are database-local, so every JDB client works on this scratch database alone.
  const JDB_DB = "plexco_harness_jdb_check";
  /** NOLOGIN grantee for the runner-like GRANT/REVOKE writers of the serialization tests. */
  const JDB_ROLE = "plexco_harness_jdb_grantee";
  const jdbUrl = () => {
    const u = new URL(taggedUrl().url);
    u.pathname = `/${JDB_DB}`;
    return u.toString();
  };
  /** Runner-like: rewrites 01:179's row (pg_namespace's `public`) inside one transaction. */
  const RUNNER_LIKE_WRITE =
    `BEGIN; GRANT USAGE ON SCHEMA public TO ${JDB_ROLE}; ` +
    `REVOKE USAGE ON SCHEMA public FROM ${JDB_ROLE}; COMMIT`;

  beforeAll(async () => {
    await observer.query(`DROP DATABASE IF EXISTS ${JDB_DB} WITH (FORCE)`);
    await observer.query(`DROP ROLE IF EXISTS ${JDB_ROLE}`);
    await observer.query(`CREATE ROLE ${JDB_ROLE} NOLOGIN`);
    await observer.query(`CREATE DATABASE ${JDB_DB}`);
  }, REAL_LOCK_TIMEOUT_MS);

  afterAll(async () => {
    // The database first: it holds the role's grants, which would block DROP ROLE.
    await observer.query(`DROP DATABASE IF EXISTS ${JDB_DB} WITH (FORCE)`);
    await observer.query(`DROP ROLE IF EXISTS ${JDB_ROLE}`);
  }, REAL_LOCK_TIMEOUT_MS);

  it("JDB-1: the key is migrate.ts's ADVISORY_LOCK_KEY, taken there with pg_advisory_lock($1)", () => {
    const src = readFileSync(path.join(HERE, "migrate.ts"), "utf8");
    const parsed = /^const ADVISORY_LOCK_KEY = (0x[0-9a-fA-F]+);/m.exec(src)?.[1];
    expect(Number(parsed)).toBe(MIGRATE_ADVISORY_LOCK_KEY);
    expect(src).toContain(`client.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_KEY])`);
  });

  it(
    "JDB-2: a bootstrap waits in pg_locks while the runner holds plxc, then resolves lock-free",
    async () => {
      const h = new pg.Client({ connectionString: jdbUrl() });
      const b = new pg.Client({ connectionString: jdbUrl() });
      try {
        await h.connect();
        await b.connect();
        await h.query("SELECT pg_advisory_lock($1)", [MIGRATE_ADVISORY_LOCK_KEY]); // migrate.ts's SQL
        const pid: number = (await b.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
        let settled = false;
        const settle = () => {
          settled = true;
        };
        const boot = withDefinerReadLock(BASE!, () => bootstrapJobDefiner(b));
        void boot.then(settle, settle);
        const mine =
          "SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND pid = $1";
        // plxc as one bigint key: classid = its high 32 bits (0), objid = its low 32, objsubid = 1.
        const waiting = `${mine} AND classid = 0 AND objid = 1886156899 AND objsubid = 1 AND NOT granted`;
        await expect
          .poll(async () => (await h.query(waiting, [pid])).rows[0].n, { timeout: 90_000 })
          .toBe(1);
        expect(settled).toBe(false);
        await h.query(RUNNER_LIKE_WRITE);
        await h.query("SELECT pg_advisory_unlock($1)", [MIGRATE_ADVISORY_LOCK_KEY]);
        await boot;
        expect((await h.query(mine, [pid])).rows).toEqual([{ n: 0 }]);
      } finally {
        await Promise.all([h.end(), b.end()]);
      }
    },
    REAL_LOCK_TIMEOUT_MS,
  );

  it(
    "JDB-3: a bootstrap whose SQL throws rejects with that error, its client usable and plxc free",
    async () => {
      const client = new pg.Client({ connectionString: jdbUrl() });
      const other = new pg.Client({ connectionString: jdbUrl() });
      try {
        await client.connect();
        await other.connect();
        // 01 runs inside its own BEGIN, so a read-only default fails its first write with 25006
        // while plxc is held: CREATE ROLE when job_definer is missing, else GRANT ROLE (01:159).
        await client.query("SET default_transaction_read_only = on");
        await expect(bootstrapJobDefiner(client)).rejects.toMatchObject({
          code: "25006",
          message: expect.stringMatching(
            /^cannot execute (CREATE ROLE|GRANT ROLE|GRANT) in a read-only transaction$/,
          ),
        });
        expect((await client.query("SELECT 1 AS one")).rows).toEqual([{ one: 1 }]);
        await client.query("RESET default_transaction_read_only");
        const tryLock = "SELECT pg_try_advisory_lock($1) AS ok";
        const { rows } = await other.query(tryLock, [MIGRATE_ADVISORY_LOCK_KEY]);
        expect(rows).toEqual([{ ok: true }]);
        await other.query("SELECT pg_advisory_unlock($1)", [MIGRATE_ADVISORY_LOCK_KEY]);
      } finally {
        await Promise.all([client.end(), other.end()]);
      }
    },
    REAL_LOCK_TIMEOUT_MS,
  );

  it("JDB-4: 20 rounds of a bootstrap racing a runner-like plxc writer all fulfil", async () => {
    const h = new pg.Client({ connectionString: jdbUrl() });
    const b = new pg.Client({ connectionString: jdbUrl() });
    const runnerLike = async () => {
      await h.query("SELECT pg_advisory_lock($1)", [MIGRATE_ADVISORY_LOCK_KEY]);
      try {
        await h.query(RUNNER_LIKE_WRITE);
      } finally {
        await h.query("SELECT pg_advisory_unlock($1)", [MIGRATE_ADVISORY_LOCK_KEY]);
      }
    };
    try {
      await h.connect();
      await b.connect();
      const started = performance.now();
      for (let round = 0; round < 20; round++) {
        await Promise.all([withDefinerReadLock(BASE!, () => bootstrapJobDefiner(b)), runnerLike()]);
      }
      console.info(`JDB-4: 20 rounds in ${Math.round(performance.now() - started)} ms`);
    } finally {
      await Promise.all([h.end(), b.end()]);
    }
  }, 120_000);
});

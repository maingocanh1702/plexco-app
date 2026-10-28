import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "./client.js";
import {
  ROLE_PW,
  setupNonSuperuserOwnerContext,
  setupRlsTestContext,
  type NonSuperuserOwnerContext,
  type RlsTestContext,
} from "./test-harness.js";

// 0075 discovery_rate_limit_hit, called AS readonly (the discovery pool's role); the owner only
// seeds, truncates and inspects. Contract: sections 6, 7 and 11 (A-1..A-10) of
// docs/sessions/web-mvp-phase5-readiness-p5-discovery-isolation-controls.md. Window rollover: each
// behaviour is ONE readonly transaction (now() is fixed per transaction) that reads its window and
// retry-after in the statement of each call, and every owner seed derives its window from the DB
// clock in its own statement, for the current and the next window, so a rollover between a seed and
// a call cannot change an outcome.

const WINDOW = "floor(extract(epoch FROM now()) / 60)::int";
const RETRY =
  "ceil((floor(extract(epoch FROM now()) / 60) + 1) * 60 - extract(epoch FROM now()))::int";

type Hit = { r: number; w: number; retry: number };

/** Each key in order, in ONE readonly transaction: the result, its window and the retry-after. */
async function series(pool: pg.Pool, keys: (string | null)[]): Promise<Hit[]> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const out: Hit[] = [];
    for (const key of keys) {
      const sql = `SELECT discovery_rate_limit_hit($1) AS r, ${WINDOW} AS w, ${RETRY} AS retry`;
      out.push((await c.query<Hit>(sql, [key])).rows[0]!);
    }
    await c.query("COMMIT");
    return out;
  } catch (error) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    c.release();
  }
}

const expectRetry = (r: number) => {
  expect(Number.isInteger(r)).toBe(true);
  expect(r).toBeGreaterThanOrEqual(1);
  expect(r).toBeLessThanOrEqual(60);
};

/** The SQLSTATE and the client-visible text of a rejection ("ok" when it resolves). */
const failure = (p: Promise<unknown>) =>
  p.then(
    () => ({ code: "ok", text: "" }),
    (e: unknown) => {
      const x = e as { code?: string; message?: string; detail?: string; hint?: string };
      return { code: String(x.code), text: [x.message, x.detail, x.hint].join(" ") };
    },
  );

/** A-1 and A-2 on one key: 60 calls return 0, the 61st the seconds to the end of its window. */
async function expectA1A2(pool: pg.Pool) {
  const got = await series(pool, Array<string>(61).fill("203.0.113.7"));
  const retry = got[60]!.retry;
  expectRetry(retry);
  expect(got.map((g) => g.r)).toEqual([...Array<number>(60).fill(0), retry]);
}

describe("0075 discovery_rate_limit_hit (A-1..A-9)", () => {
  let ctx: RlsTestContext;
  const truncate = () => ctx.owner.query("TRUNCATE discovery_rate_limit_counters");
  /** Each [bucket, hits] at the DB clock's window + d, for every offset d (default: now and next). */
  const seed = (rows: [string, number][], offsets = [0, 1]) =>
    ctx.owner.query(
      `INSERT INTO discovery_rate_limit_counters (window_id, bucket, hits)
       SELECT floor(extract(epoch FROM now()) / 60)::bigint + d, s.bucket, s.hits
         FROM unnest($1::int[]) AS o(d), unnest($2::text[], $3::int[]) AS s(bucket, hits)`,
      [offsets, rows.map((x) => x[0]), rows.map((x) => x[1])],
    );
  const count = async () =>
    (
      await ctx.owner.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM discovery_rate_limit_counters",
      )
    ).rows[0]!.n;
  /** A bucket's hits in every window, oldest first; null when it has no row. */
  const hitsOf = async (bucket: string) =>
    (
      await ctx.owner.query<{ h: number[] | null }>(
        "SELECT array_agg(hits ORDER BY window_id) AS h FROM discovery_rate_limit_counters WHERE bucket = $1",
        [bucket],
      )
    ).rows[0]!.h;
  /** Every bucket of one window, as bucket -> hits. */
  const rowsAt = async (w: number) =>
    Object.fromEntries(
      (
        await ctx.owner.query<{ bucket: string; hits: number }>(
          "SELECT bucket, hits FROM discovery_rate_limit_counters WHERE window_id = $1",
          [w],
        )
      ).rows.map((x) => [x.bucket, x.hits]),
    );

  beforeAll(async () => {
    ctx = await setupRlsTestContext("plexco_discovery_rate_limit");
  }, 240_000);
  afterAll(async () => {
    await ctx?.teardown();
  });
  beforeEach(async () => {
    await truncate();
  });

  it("A-1 and A-2: 60 calls of one key in one window return 0, the 61st the seconds to the window end", async () => {
    await expectA1A2(ctx.readonlyPool);
  });

  it("A-3 /48 aggregate: at the gate a full /48 refuses its 257th NEW /64 and serves the rest; under it, admits", async () => {
    await seed([
      ["#keys", 10000],
      ["p48:2001:0db8:0001", 256],
      ["k:2001:0db8:0001:0001", 1],
    ]);
    const [refused, admitted, other] = await series(ctx.readonlyPool, [
      "2001:0db8:0001:0101",
      "2001:0db8:0001:0001",
      "2001:0db8:0002:0001",
    ]);
    expectRetry(refused!.r);
    expect([admitted!.r, other!.r]).toEqual([0, 0]);
    expect(await hitsOf("k:2001:0db8:0001:0101")).toBeNull();
    expect(await rowsAt(refused!.w)).toEqual({
      "#keys": 10001,
      "p48:2001:0db8:0001": 256,
      "k:2001:0db8:0001:0001": 2,
      "p48:2001:0db8:0002": 1,
      "k:2001:0db8:0002:0001": 1,
    });

    await truncate();
    await seed([
      ["#keys", 9999],
      ["p48:2001:0db8:0001", 256],
    ]);
    const [under] = await series(ctx.readonlyPool, ["2001:0db8:0001:0101"]);
    expect(under!.r).toBe(0);
    expect(await rowsAt(under!.w)).toEqual({
      "#keys": 10000,
      "p48:2001:0db8:0001": 257,
      "k:2001:0db8:0001:0101": 1,
    });
  });

  it("A-4 window reset: a key refused in an earlier window starts at 1 in the current one", async () => {
    await seed([["k:198.51.100.9", 61]], [-1]);
    const [a] = await series(ctx.readonlyPool, ["198.51.100.9"]);
    expect(a!.r).toBe(0);
    expect(await rowsAt(a!.w)).toEqual({ "#keys": 1, "k:198.51.100.9": 1 });
  });

  it("A-5 cleanup: an admission deletes at most 100 rows of older windows and none of its own", async () => {
    const old = Array.from({ length: 150 }, (_, i): [string, number] => [
      `k:198.51.100.${i + 1}`,
      1,
    ]);
    await seed(old, [-5]);
    const own = [1, 2, 3].map((i): [string, number] => [`k:192.0.2.${i}`, 1]);
    await seed(own);
    const [a] = await series(ctx.readonlyPool, ["10.2.0.1"]);
    expect(a!.r).toBe(0);
    // 156 seeded + '#keys' + the key - 100 deleted, whichever window the call fell in.
    expect(await count()).toBe(58);
    expect(await rowsAt(a!.w)).toEqual({
      ...Object.fromEntries(own),
      "#keys": 1,
      "k:10.2.0.1": 1,
    });
  });

  it("A-6 size bound full = fail closed: a NEW key is refused and adds no row; admitted keys are counted and served", async () => {
    await seed([
      ["#keys", 20000],
      ["k:192.0.2.1", 60],
      ["k:192.0.2.2", 1],
    ]);
    const [fresh, spent, served] = await series(ctx.readonlyPool, [
      "192.0.2.3",
      "192.0.2.1",
      "192.0.2.2",
    ]);
    expectRetry(fresh!.r);
    expectRetry(spent!.r);
    expect(served!.r).toBe(0);
    expect(await count()).toBe(6);
    expect(await hitsOf("#keys")).toEqual([20000, 20000]);
  });

  it("A-7 readonly gets 42501 on SELECT, INSERT, UPDATE and DELETE of the table and may EXECUTE the function", async () => {
    for (const sql of [
      "SELECT * FROM discovery_rate_limit_counters",
      "INSERT INTO discovery_rate_limit_counters VALUES (0, 'k:192.0.2.1', 1)",
      "UPDATE discovery_rate_limit_counters SET hits = 0",
      "DELETE FROM discovery_rate_limit_counters",
    ]) {
      expect([sql, (await failure(ctx.readonlyPool.query(sql))).code]).toEqual([sql, "42501"]);
    }
    expect((await series(ctx.readonlyPool, ["192.0.2.10"]))[0]!.r).toBe(0);
  });

  it("A-8 attribute and owner pins of the function and the table (section 7 item 15)", async () => {
    const fn = await ctx.owner.query<Record<string, unknown>>(
      `SELECT p.proowner = c.relowner AS same_owner, p.prosecdef, p.proconfig, p.provolatile,
              p.proisstrict, p.proparallel, pg_get_function_identity_arguments(p.oid) AS args,
              pg_get_function_result(p.oid) AS result,
              has_function_privilege('public', p.oid, 'EXECUTE') AS x_public,
              has_function_privilege('app', p.oid, 'EXECUTE') AS x_app,
              has_function_privilege('app_worker', p.oid, 'EXECUTE') AS x_app_worker,
              has_function_privilege('readonly', p.oid, 'EXECUTE') AS x_readonly,
              coalesce(array_to_string(p.proacl, ','), '') AS acl,
              c.relpersistence, c.relrowsecurity, c.relforcerowsecurity,
              (SELECT count(*)::int FROM pg_policy WHERE polrelid = c.oid) AS policies
         FROM pg_proc p, pg_class c
        WHERE p.oid = 'discovery_rate_limit_hit(text)'::regprocedure
          AND c.oid = 'discovery_rate_limit_counters'::regclass`,
    );
    expect(fn.rows).toHaveLength(1);
    const { acl, ...pins } = fn.rows[0]!;
    expect(pins).toEqual({
      same_owner: true,
      prosecdef: true,
      proconfig: ["search_path=pg_catalog, public, pg_temp"],
      provolatile: "v",
      proisstrict: false,
      proparallel: "u",
      args: "p_key text",
      result: "integer",
      x_public: false,
      x_app: false,
      x_app_worker: false,
      x_readonly: true,
      relpersistence: "u",
      relrowsecurity: true,
      relforcerowsecurity: false,
      policies: 0,
    });
    expect(String(acl)).not.toMatch(/(^|,)=X/);

    // MAINTAIN exists from PostgreSQL 17; has_table_privilege rejects it on older servers.
    const table = await ctx.owner.query(
      `SELECT r AS role, has_table_privilege(r, 'discovery_rate_limit_counters',
                'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER' ||
                CASE WHEN current_setting('server_version_num')::int >= 170000
                     THEN ',MAINTAIN' ELSE '' END) AS any_privilege
         FROM unnest(ARRAY['app', 'app_worker', 'readonly']) AS r ORDER BY 1`,
    );
    expect(table.rows).toEqual(
      ["app", "app_worker", "readonly"].map((role) => ({ role, any_privilege: false })),
    );
  });

  it("A-9 input check: NULL, an over-long key and a key outside the set RAISE 22023 without the key, no row", async () => {
    for (const key of [null, "a".repeat(23), "203.0.113.7;", "2001:0DB8:0001:0001"]) {
      const e = await failure(series(ctx.readonlyPool, [key]));
      expect([key, e.code]).toEqual([key, "22023"]);
      expect(e.text).not.toContain(String(key));
    }
    expect(await count()).toBe(0);
  });
});

describe("0075 under a NOSUPERUSER NOBYPASSRLS owner (A-10)", () => {
  let ns: NonSuperuserOwnerContext;
  let ro: pg.Pool;

  beforeAll(async () => {
    ns = await setupNonSuperuserOwnerContext("plexco_discovery_rate_limit_nobypass");
    await ns.bootstrapAndMigrateAsOwner();
    await ns.useRuntimeRolePasswords();
    const url = new URL(process.env.DATABASE_URL_TEST!);
    url.pathname = `/${ns.dbName}`;
    url.username = "readonly";
    url.password = ROLE_PW.readonly;
    ro = new pg.Pool({ connectionString: url.toString(), max: 1 });
  }, 240_000);
  afterAll(async () => {
    await ro?.end();
    await ns?.teardown();
  });

  it("A-10 NOBYPASSRLS owner replay: the definer is the non-superuser table owner, and A-1 and A-2 hold", async () => {
    const owner = await ns.ownerPool.query(
      `SELECT pg_get_userbyid(p.proowner) AS owner, r.rolsuper, r.rolbypassrls,
              p.proowner = c.relowner AS same_owner
         FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner, pg_class c
        WHERE p.oid = 'discovery_rate_limit_hit(text)'::regprocedure
          AND c.oid = 'discovery_rate_limit_counters'::regclass`,
    );
    expect(owner.rows).toEqual([
      { owner: ns.ownerRole, rolsuper: false, rolbypassrls: false, same_owner: true },
    ]);
    await expectA1A2(ro);
  });
});

describe("createDb options (A-11)", () => {
  // The pool-config rows contact no server: a pool connects on its first query only.
  const url = "postgres://a11@127.0.0.1:1/a11";
  const timeouts = ["statement_timeout", "connectionTimeoutMillis", "query_timeout"] as const;

  it("A-11 a short statement_timeout reaches the session: SHOW answers it and a longer pg_sleep fails 57014", async () => {
    const handle = createDb(process.env.DATABASE_URL_TEST!, { statement_timeout: 200 });
    try {
      const shown = await handle.pool.query<{ statement_timeout: string }>(
        "SHOW statement_timeout",
      );
      expect(shown.rows[0]!.statement_timeout).toBe("200ms");
      expect((await failure(handle.pool.query("SELECT pg_sleep(2)"))).code).toBe("57014");
    } finally {
      await handle.close();
    }
  });

  it("A-11 default unchanged: createDb(url) and createDb(url, { max: 3 }) set no timeout key", async () => {
    for (const [options, max] of [
      [undefined, 10],
      [{ max: 3 }, 3],
    ] as const) {
      const handle = createDb(url, options);
      try {
        expect(handle.pool.options).toMatchObject({ connectionString: url, max });
        expect(timeouts.filter((key) => key in handle.pool.options)).toEqual([]);
      } finally {
        await handle.close();
      }
    }
  });

  it("A-11 given timeouts reach pool.options unchanged", async () => {
    const given = { statement_timeout: 200, connectionTimeoutMillis: 2000, query_timeout: 2500 };
    const handle = createDb(url, given);
    try {
      expect(handle.pool.options).toMatchObject({ connectionString: url, max: 10, ...given });
    } finally {
      await handle.close();
    }
  });
});

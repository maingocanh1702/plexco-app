import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ROLE_PW,
  setupNonSuperuserOwnerContext,
  type NonSuperuserOwnerContext,
} from "./test-harness.js";

// 0075 discovery_rate_limit_hit replayed under a NOSUPERUSER NOBYPASSRLS owner (A-10, section 11 of
// docs/sessions/web-mvp-phase5-readiness-p5-discovery-isolation-controls.md). An isolated file
// (packages/db/vitest.config.ts): setupNonSuperuserOwnerContext hands a shared role membership to a
// non-superuser owner. The helpers below are kept in step with discovery-rate-limit-definer.test.ts.

const WINDOW = "floor(extract(epoch FROM now()) / 60)::int";
const RETRY =
  "ceil((floor(extract(epoch FROM now()) / 60) + 1) * 60 - extract(epoch FROM now()))::int";

type Hit = { r: number; w: number; retry: number };
/** One call, with its window and retry-after read in the same statement. */
const HIT = `SELECT discovery_rate_limit_hit($1) AS r, ${WINDOW} AS w, ${RETRY} AS retry`;

/** Each key in order, in ONE readonly transaction: the result, its window and the retry-after. */
async function series(pool: pg.Pool, keys: (string | null)[]): Promise<Hit[]> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const out: Hit[] = [];
    for (const key of keys) {
      out.push((await c.query<Hit>(HIT, [key])).rows[0]!);
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

/** A-1 and A-2 on one key: 60 calls return 0, the 61st the seconds to the end of its window. */
async function expectA1A2(pool: pg.Pool) {
  const got = await series(pool, Array<string>(61).fill("203.0.113.7"));
  const retry = got[60]!.retry;
  expectRetry(retry);
  expect(got.map((g) => g.r)).toEqual([...Array<number>(60).fill(0), retry]);
}

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

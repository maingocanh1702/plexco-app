import { randomUUID } from "node:crypto";
import type pg from "pg";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  authorizeTenantAction,
  type ActionClass,
  type AuthorizationDecision,
} from "./authorization.js";
import type { Db } from "./client.js";
import { setupRlsTestContext, type RlsTestContext } from "./test-harness.js";

/**
 * `authorizeTenantAction` acceptance suite — case numbers cite
 * docs/autopilot-authorize-tenant-action-core.md's acceptance matrix, which
 * in turn cites the 6-case decision table in
 * feature_billing_lifecycle_tech.md §3 Status Authority. Cross-reference,
 * don't copy: reading the spec's case content here is how it goes stale.
 *
 * Runs against `ctx.superuserDb` rather than the real `app`-role connection:
 * the `app` role currently has no grant on `tenants` at all (unlike the
 * analogous platform-tier `plans`/`sports`, which get SELECT — only
 * `subscriptions` is covered by the tenant_tables RLS+grant loop in 0009),
 * and a locking read needs UPDATE privilege on top of that, not just
 * SELECT (PostgreSQL requires UPDATE for any row-locking clause, FOR SHARE
 * included). See the NOTE on authorizeTenantAction itself for why the right
 * fix is a narrow SECURITY DEFINER function, not a raw grant — the gap is
 * flagged in this slice's READY report as a follow-up for whoever wires the
 * first real (`app`-role) caller.
 */

let ctx: RlsTestContext;

beforeAll(async () => {
  ctx = await setupRlsTestContext("plexco_authz_check");
}, 120_000);

afterAll(async () => {
  await ctx?.teardown();
});

async function seedTenant(
  owner: pg.Client,
  opts: { tenantStatus: string; subStatus: string | "missing" },
): Promise<string> {
  const unique = randomUUID();
  const { rows } = await owner.query(
    `INSERT INTO tenants (name, slug, status) VALUES ($1, $2, $3) RETURNING id`,
    [`AuthZ Test ${unique}`, `authz-test-${unique}`, opts.tenantStatus],
  );
  const tenantId = (rows[0] as { id: string }).id;
  if (opts.subStatus !== "missing") {
    await owner.query(
      `INSERT INTO subscriptions (tenant_id, plan_key, plan_version, status, period_start, period_end)
       VALUES ($1, 'free_web', 1, $2, now(), now() + interval '30 days')`,
      [tenantId, opts.subStatus],
    );
  }
  return tenantId;
}

/**
 * `authorizeTenantAction` requires an already-open transaction (codex
 * round-01 [P1] — see authorization.ts's docstring). This wraps a call in a
 * fresh, dedicated transaction for tests that only care about the resolved
 * decision, not about composing with a caller's own subsequent mutation
 * (that composition is what the dedicated "lock survives past return" test
 * below proves directly, by NOT using this helper).
 */
function authorizeInOwnTransaction(
  db: Db,
  tenantId: string,
  actionClass: ActionClass,
): Promise<AuthorizationDecision> {
  return db.transaction((tx) => authorizeTenantAction(tx, tenantId, actionClass));
}

async function backendPid(client: pg.PoolClient): Promise<number> {
  const { rows } = await client.query(`SELECT pg_backend_pid() AS pid`);
  return (rows[0] as { pid: number }).pid;
}

/**
 * Discovers whichever backend is currently blocked specifically by
 * `holderPid`, polling `pg_blocking_pids()` (mirrors auth.test.ts's
 * `waitUntilBlockedByHolder`, generalised to not require knowing the
 * waiter's pid in advance — `authorizeTenantAction` runs inside a
 * transaction the test opens via `db.transaction()`, so the test has no
 * direct handle on which pool connection drizzle ends up using).
 * Deterministic barrier, not a timing sleep (G3 §8).
 */
async function waitUntilSomeoneBlockedByHolder(
  owner: pg.Client,
  holderPid: number,
): Promise<number> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const { rows } = await owner.query(
      `SELECT pid FROM pg_stat_activity
       WHERE wait_event_type = 'Lock' AND $1 = ANY(pg_blocking_pids(pid))`,
      [holderPid],
    );
    if (rows.length > 0) return (rows[0] as { pid: number }).pid;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error(`no backend became blocked by holder ${holderPid} within 5s`);
}

/**
 * E3 fixture only — deliberately NOT what authorizeTenantAction does. Same
 * resolution logic and same already-open-tx contract, but plain re-SELECTs
 * instead of `FOR SHARE`. Exists to prove, by direct contrast against E1,
 * that the locking read is load-bearing — a concurrency test that would pass
 * against both a locking and a non-locking implementation proves nothing
 * (E3's own requirement).
 */
async function authorizeWithoutLock(
  tx: Parameters<Parameters<Db["transaction"]>[0]>[0],
  tenantId: string,
): Promise<AuthorizationDecision> {
  const tenantResult = await tx.execute(sql`SELECT status FROM tenants WHERE id = ${tenantId}`);
  const tenantStatus = (tenantResult.rows as { status: string }[])[0]?.status;
  if (tenantStatus !== "active" && tenantStatus !== "trialing") {
    return { allowed: false, code: "TENANT_SUSPENDED" };
  }
  await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
  const subResult = await tx.execute(
    sql`SELECT status FROM subscriptions WHERE tenant_id = ${tenantId}`,
  );
  const subStatus = (subResult.rows as { status: string }[])[0]?.status;
  if (subStatus === "trialing" || subStatus === "active" || subStatus === "past_due") {
    return { allowed: true, effectiveStatus: subStatus };
  }
  return { allowed: false, code: "TENANT_SUSPENDED" };
}

describe("status resolution — decision table cases (feature_billing_lifecycle_tech.md §3)", () => {
  it("A1: tenant active, subscription active — allow, case 3", async () => {
    const tenantId = await seedTenant(ctx.owner, { tenantStatus: "active", subStatus: "active" });
    const decision = await authorizeInOwnTransaction(
      ctx.superuserDb.db,
      tenantId,
      "publish_new_sessions",
    );
    expect(decision).toEqual({ allowed: true, effectiveStatus: "active" });
  });

  it("A2: tenant trialing, subscription trialing — allow, case 3", async () => {
    const tenantId = await seedTenant(ctx.owner, {
      tenantStatus: "trialing",
      subStatus: "trialing",
    });
    const decision = await authorizeInOwnTransaction(
      ctx.superuserDb.db,
      tenantId,
      "publish_new_sessions",
    );
    expect(decision).toEqual({ allowed: true, effectiveStatus: "trialing" });
  });

  it("A3: tenant active, subscription past_due — allow, past_due does not block", async () => {
    const tenantId = await seedTenant(ctx.owner, { tenantStatus: "active", subStatus: "past_due" });
    const decision = await authorizeInOwnTransaction(
      ctx.superuserDb.db,
      tenantId,
      "publish_new_sessions",
    );
    expect(decision).toEqual({ allowed: true, effectiveStatus: "past_due" });
  });

  it("B1: tenant active, missing subscriptions row — deny, case 4 fail-closed", async () => {
    const tenantId = await seedTenant(ctx.owner, { tenantStatus: "active", subStatus: "missing" });
    const decision = await authorizeInOwnTransaction(
      ctx.superuserDb.db,
      tenantId,
      "publish_new_sessions",
    );
    expect(decision).toEqual({ allowed: false, code: "TENANT_SUSPENDED" });
  });

  it("B2: tenant suspended, subscription active — deny, case 1 (tenant axis wins at step 1, step 2 not consulted)", async () => {
    const tenantId = await seedTenant(ctx.owner, {
      tenantStatus: "suspended",
      subStatus: "active",
    });
    const decision = await authorizeInOwnTransaction(
      ctx.superuserDb.db,
      tenantId,
      "publish_new_sessions",
    );
    expect(decision).toEqual({ allowed: false, code: "TENANT_SUSPENDED" });
  });

  it("B3: tenant past_due (anomaly value), subscription active — deny, case 1b", async () => {
    const tenantId = await seedTenant(ctx.owner, { tenantStatus: "past_due", subStatus: "active" });
    const decision = await authorizeInOwnTransaction(
      ctx.superuserDb.db,
      tenantId,
      "publish_new_sessions",
    );
    expect(decision).toEqual({ allowed: false, code: "TENANT_SUSPENDED" });
  });

  it("B4: tenant cancelled (anomaly value), subscription active — deny, case 1b", async () => {
    const tenantId = await seedTenant(ctx.owner, {
      tenantStatus: "cancelled",
      subStatus: "active",
    });
    const decision = await authorizeInOwnTransaction(
      ctx.superuserDb.db,
      tenantId,
      "publish_new_sessions",
    );
    expect(decision).toEqual({ allowed: false, code: "TENANT_SUSPENDED" });
  });

  it("B5: tenant active, subscription cancelled — deny, case 2b (closes the suspended-to-cancelled debt shortcut)", async () => {
    const tenantId = await seedTenant(ctx.owner, {
      tenantStatus: "active",
      subStatus: "cancelled",
    });
    const decision = await authorizeInOwnTransaction(
      ctx.superuserDb.db,
      tenantId,
      "publish_new_sessions",
    );
    expect(decision).toEqual({ allowed: false, code: "TENANT_SUSPENDED" });
  });

  it("B6: tenant active, subscription suspended — deny, case 2", async () => {
    const tenantId = await seedTenant(ctx.owner, {
      tenantStatus: "active",
      subStatus: "suspended",
    });
    const decision = await authorizeInOwnTransaction(
      ctx.superuserDb.db,
      tenantId,
      "publish_new_sessions",
    );
    expect(decision).toEqual({ allowed: false, code: "TENANT_SUSPENDED" });
  });

  it("recognises all three mutating action classes named by billing §3's Concurrency clause identically", async () => {
    // Deliberately an ALLOW fixture, not a deny one (codex round-04 [P2] on
    // this slice): with a deny fixture, an accidentally-removed action class
    // would hit the SAME "unrecognised → deny" path and produce the
    // identical decision shape, so the test would stay green while that
    // class silently became unusable. An allow fixture actually
    // discriminates recognised-and-allowed from not-recognised-at-all.
    const tenantId = await seedTenant(ctx.owner, { tenantStatus: "active", subStatus: "active" });
    for (const actionClass of [
      "publish_new_sessions",
      "admin_mutation",
      "integration_changes",
    ] as const) {
      const decision = await authorizeInOwnTransaction(ctx.superuserDb.db, tenantId, actionClass);
      expect(decision).toEqual({ allowed: true, effectiveStatus: "active" });
    }
  });
});

describe("AuthZ / failure / security — C1, C2, D1, G1", () => {
  it("C1: unknown tenantId denies fail-closed without leaking whether it exists", async () => {
    const decision = await authorizeInOwnTransaction(
      ctx.superuserDb.db,
      randomUUID(),
      "publish_new_sessions",
    );
    expect(decision).toEqual({ allowed: false, code: "TENANT_SUSPENDED" });
  });

  it("C2: an unrecognised actionClass denies fail-closed — never allow-by-default", async () => {
    const tenantId = await seedTenant(ctx.owner, { tenantStatus: "active", subStatus: "active" });
    const decision = await authorizeInOwnTransaction(
      ctx.superuserDb.db,
      tenantId,
      "not_a_real_action_class" as ActionClass,
    );
    expect(decision).toEqual({ allowed: false, code: "TENANT_SUSPENDED" });
  });

  it("D1: a query failure propagates as a rejection — an error never collapses into allow", async () => {
    const brokenTx = {
      execute: () => Promise.reject(new Error("simulated dependency-unavailable failure")),
    } as unknown as Parameters<typeof authorizeTenantAction>[0];
    await expect(
      authorizeTenantAction(brokenTx, randomUUID(), "publish_new_sessions"),
    ).rejects.toThrow("simulated dependency-unavailable failure");
  });

  it("an unrecognised subscriptions.status value denies fail-closed — the allowlist decides allow, not a denylist (codex round-02 [P1])", async () => {
    // The live CHECK constraint cannot produce a value outside the 5-value
    // enum, so this property can only be exercised through a fake tx (the
    // reviewer's own suggested fix) — not a real Postgres row. Sequenced by
    // call order: 1) tenants read, 2) set_config, 3) subscriptions read.
    let callCount = 0;
    const fakeTx = {
      execute: () => {
        callCount += 1;
        if (callCount === 1) return Promise.resolve({ rows: [{ status: "active" }] });
        if (callCount === 2) return Promise.resolve({ rows: [] });
        return Promise.resolve({ rows: [{ status: "not_a_real_status" }] });
      },
    } as unknown as Parameters<typeof authorizeTenantAction>[0];
    const decision = await authorizeTenantAction(fakeTx, randomUUID(), "publish_new_sessions");
    expect(decision).toEqual({ allowed: false, code: "TENANT_SUSPENDED" });
  });

  it("G1: every deny path returns the identical cause-agnostic shape — no field reveals which axis blocked", async () => {
    const unrecognizedActionClass = await authorizeInOwnTransaction(
      ctx.superuserDb.db,
      randomUUID(),
      "not_a_real_action_class" as ActionClass,
    );
    const missingTenant = await authorizeInOwnTransaction(
      ctx.superuserDb.db,
      randomUUID(),
      "publish_new_sessions",
    );
    const tenantAxisSuspended = await authorizeInOwnTransaction(
      ctx.superuserDb.db,
      await seedTenant(ctx.owner, { tenantStatus: "suspended", subStatus: "active" }),
      "publish_new_sessions",
    );
    const subscriptionAxisSuspended = await authorizeInOwnTransaction(
      ctx.superuserDb.db,
      await seedTenant(ctx.owner, { tenantStatus: "active", subStatus: "suspended" }),
      "publish_new_sessions",
    );
    const expected = { allowed: false, code: "TENANT_SUSPENDED" };
    for (const decision of [
      unrecognizedActionClass,
      missingTenant,
      tenantAxisSuspended,
      subscriptionAxisSuspended,
    ]) {
      expect(decision).toEqual(expected);
      expect(Object.keys(decision).sort()).toEqual(["allowed", "code"]);
    }
  });
});

describe("concurrency — mutating branch locking read (E1, E2, E3)", () => {
  // Modeled after the same competing-writer scenario billing test #36/#36a
  // exercises for the Daily Lifecycle Job (feature_billing_lifecycle_tech.md
  // §4/§5) — but that job doesn't exist as code in this repo yet, only as
  // spec prose, and these tests seed a free_web/active fixture rather than
  // its exact eligibility predicate (a paid plan, subscriptions.status =
  // 'past_due', grace_end elapsed, joined through plans.price > 0). They
  // prove the FOR SHARE / FOR UPDATE SKIP LOCKED lock-primitive interaction
  // authorizeTenantAction depends on, using the job's own claim shape
  // (`FOR UPDATE SKIP LOCKED`) — not byte-for-byte parity with #36/#36a's
  // preconditions or the job's not-yet-built exact query. Whichever slice
  // builds that job is the one that must prove it interacts correctly with
  // this resolver under its real eligibility predicate.

  it("E1: competing writer holds FOR UPDATE first — re-check BLOCKS, then observes the fresh suspended value", async () => {
    const tenantId = await seedTenant(ctx.owner, { tenantStatus: "active", subStatus: "active" });
    const holder = await ctx.superuserDb.pool.connect();
    try {
      await holder.query("BEGIN");
      await holder.query(`SELECT status FROM subscriptions WHERE tenant_id = $1 FOR UPDATE`, [
        tenantId,
      ]);
      const holderPid = await backendPid(holder);

      // Not awaited yet — must still be pending when we assert it is blocked below.
      const pending = authorizeInOwnTransaction(
        ctx.superuserDb.db,
        tenantId,
        "publish_new_sessions",
      );
      await waitUntilSomeoneBlockedByHolder(ctx.owner, holderPid);

      await holder.query(`UPDATE subscriptions SET status = 'suspended' WHERE tenant_id = $1`, [
        tenantId,
      ]);
      await holder.query("COMMIT");

      const decision = await pending;
      expect(decision).toEqual({ allowed: false, code: "TENANT_SUSPENDED" });
    } finally {
      await holder.query("ROLLBACK").catch(() => {});
      holder.release();
    }
  });

  it("the tenant-axis FOR SHARE is equally load-bearing — a competing writer on tenants blocks the real helper, which then observes the fresh suspended value (codex round-03 [P1])", async () => {
    // E1 proves this for the subscriptions read; every other concurrency
    // test here either targets subscriptions too or replicates the tenants
    // lock manually rather than going through authorizeTenantAction itself
    // (E2), so none of them would catch FOR SHARE being dropped from JUST
    // the tenants query at authorization.ts's step 1. This is E1's exact
    // construction, aimed at the other table, through the real function.
    const tenantId = await seedTenant(ctx.owner, { tenantStatus: "active", subStatus: "active" });
    const holder = await ctx.superuserDb.pool.connect();
    try {
      await holder.query("BEGIN");
      await holder.query(`SELECT status FROM tenants WHERE id = $1 FOR UPDATE`, [tenantId]);
      const holderPid = await backendPid(holder);

      const pending = authorizeInOwnTransaction(
        ctx.superuserDb.db,
        tenantId,
        "publish_new_sessions",
      );
      await waitUntilSomeoneBlockedByHolder(ctx.owner, holderPid);

      await holder.query(`UPDATE tenants SET status = 'suspended' WHERE id = $1`, [tenantId]);
      await holder.query("COMMIT");

      const decision = await pending;
      expect(decision).toEqual({ allowed: false, code: "TENANT_SUSPENDED" });
    } finally {
      await holder.query("ROLLBACK").catch(() => {});
      holder.release();
    }
  });

  it("E2: FOR SHARE acquired first — a competing SKIP LOCKED claim defers, function proceeds on the validly observed state", async () => {
    const tenantId = await seedTenant(ctx.owner, { tenantStatus: "active", subStatus: "active" });

    // Faithfully replicate authorizeTenantAction's own locking read (same
    // SQL, same table order) under manual control: an opaque single-call
    // async function gives no external hook to pause mid-flight, so this is
    // the deterministic way to hold the lock open for exactly as long as
    // needed to prove a concurrent claim attempt defers to it.
    const reader = await ctx.superuserDb.pool.connect();
    try {
      await reader.query("BEGIN");
      await reader.query(`SELECT status FROM tenants WHERE id = $1 FOR SHARE`, [tenantId]);
      await reader.query(`SELECT status FROM subscriptions WHERE tenant_id = $1 FOR SHARE`, [
        tenantId,
      ]);

      // A FOR UPDATE SKIP LOCKED claim attempt using the job's own claim
      // shape (billing §4) — not its exact eligibility predicate, see the
      // describe-block comment above.
      const claim = await ctx.owner.query(
        `SELECT status FROM subscriptions WHERE tenant_id = $1 FOR UPDATE SKIP LOCKED`,
        [tenantId],
      );
      expect(claim.rows).toHaveLength(0); // deferred to next run — not blocked, not mutated

      await reader.query("COMMIT");
    } finally {
      await reader.query("ROLLBACK").catch(() => {});
      reader.release();
    }

    // The claim attempt never acquired the row, so state is exactly as
    // seeded. The real function, called after the reader releases, proceeds
    // on that validly observed state.
    const decision = await authorizeInOwnTransaction(
      ctx.superuserDb.db,
      tenantId,
      "publish_new_sessions",
    );
    expect(decision).toEqual({ allowed: true, effectiveStatus: "active" });
  });

  it("E3: a plain re-SELECT (no FOR SHARE) does not block and wrongly allows mid-suspend — proves the locking read is load-bearing", async () => {
    const tenantId = await seedTenant(ctx.owner, { tenantStatus: "active", subStatus: "active" });
    const holder = await ctx.superuserDb.pool.connect();
    try {
      await holder.query("BEGIN");
      await holder.query(`SELECT status FROM subscriptions WHERE tenant_id = $1 FOR UPDATE`, [
        tenantId,
      ]);
      // Deliberately NOT committed yet — the suspend transition is still in flight.

      // The non-locking variant does not contend for the lock, so it reads
      // the still-committed 'active' value immediately instead of blocking —
      // exactly the false "allow" a naive re-SELECT implementation would
      // produce mid-suspend, and exactly what E1 proves the real
      // implementation does NOT do.
      const decision = await ctx.superuserDb.db.transaction((tx) =>
        authorizeWithoutLock(tx, tenantId),
      );
      expect(decision).toEqual({ allowed: true, effectiveStatus: "active" });

      await holder.query(`UPDATE subscriptions SET status = 'suspended' WHERE tenant_id = $1`, [
        tenantId,
      ]);
      await holder.query("COMMIT");
    } finally {
      await holder.query("ROLLBACK").catch(() => {});
      holder.release();
    }
  });

  it("the FOR SHARE lock survives past authorizeTenantAction's return, inside the caller's own transaction — a mutation right after an allowed decision is still protected (codex round-01 [P1])", async () => {
    const tenantId = await seedTenant(ctx.owner, { tenantStatus: "active", subStatus: "active" });
    let stillLockedAfterDecision = false;

    const decision = await ctx.superuserDb.db.transaction(async (tx) => {
      const result = await authorizeTenantAction(tx, tenantId, "publish_new_sessions");
      // Still inside the SAME transaction that produced `result` — this is
      // exactly where a real caller (e.g. session publish step 6) would now
      // mutate. Prove the lock survived past the function's return by
      // confirming a competing SKIP LOCKED claim, from a wholly separate
      // connection, still defers — i.e. this transaction, not the one
      // authorizeTenantAction opened and released internally in the earlier
      // draft, is the one actually holding the row.
      const claim = await ctx.owner.query(
        `SELECT status FROM subscriptions WHERE tenant_id = $1 FOR UPDATE SKIP LOCKED`,
        [tenantId],
      );
      stillLockedAfterDecision = claim.rows.length === 0;
      return result;
    });

    expect(decision).toEqual({ allowed: true, effectiveStatus: "active" });
    expect(stillLockedAfterDecision).toBe(true);
  });
});

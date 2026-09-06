import { randomUUID } from "node:crypto";
import type pg from "pg";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveCapability, type Capability, type CapabilityDecision } from "./capability.js";
import { authorizeTenantAction } from "./authorization.js";
import type { Db } from "./client.js";
import { setupRlsTestContext, type RlsTestContext } from "./test-harness.js";
import { TenantContextMismatchError } from "./tenant.js";

/**
 * `resolveCapability` acceptance suite (capability.ts). The commercial-
 * entitlement axis of DD-29 / feature_billing_lifecycle_tech.md §4b
 * `hasCapability`. Case names cross-reference the spec's edge cases / unit tests
 * (#13, #21, #22, #37) and its §4b invariants; per the repo convention
 * (authorization.test.ts) they cross-reference, they do not copy the spec text.
 *
 * The canonical DD-29 capability seed (free vs host_pro @ v1) is applied by the
 * migration runner (0028) inside setupRlsTestContext; these tests read it, they
 * never re-seed the two canonical rows. Custom plan rows at throwaway versions
 * (free@2.., host_pro@2..) exercise config-driven flips and malformed shapes
 * through REAL Postgres (the FK subscriptions_plan_fk is satisfied); the two
 * states that are structurally impossible through the live schema — a
 * subscription pointing at a nonexistent plan row (blocked by the FK), and a
 * query-layer failure — are exercised through a fake tx, exactly as
 * authorization.test.ts does for its own CHECK-impossible states.
 */

let ctx: RlsTestContext;

beforeAll(async () => {
  ctx = await setupRlsTestContext("plexco_capability_check");
}, 120_000);

afterAll(async () => {
  await ctx?.teardown();
});

type Tx = Parameters<typeof resolveCapability>[0];

async function seedTenant(
  owner: pg.Client,
  subscription: { planKey: string; planVersion: number; status?: string } | "no-subscription",
): Promise<string> {
  const unique = randomUUID();
  const { rows } = await owner.query(
    `INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'active') RETURNING id`,
    [`Cap Test ${unique}`, `cap-test-${unique}`],
  );
  const tenantId = (rows[0] as { id: string }).id;
  if (subscription !== "no-subscription") {
    await owner.query(
      `INSERT INTO subscriptions (tenant_id, plan_key, plan_version, status, period_start, period_end)
       VALUES ($1, $2, $3, $4, now(), now() + interval '30 days')`,
      [tenantId, subscription.planKey, subscription.planVersion, subscription.status ?? "active"],
    );
  }
  return tenantId;
}

/**
 * Seed a throwaway plan row (idempotent). plan_key must be 'free'|'host_pro'
 * (plans_key_chk); the version is free to vary, which is how a malformed
 * `entitlements` shape reaches the resolver without colliding with the canonical
 * v1 rows the migration seeded.
 */
async function seedPlan(
  owner: pg.Client,
  planKey: "free" | "host_pro",
  version: number,
  entitlementsJson: string,
): Promise<void> {
  await owner.query(
    `INSERT INTO plans (plan_key, version, price, currency, interval, limits, entitlements, active)
     VALUES ($1, $2, 0, 'VND', 'monthly', '{}'::jsonb, $3::jsonb, true)
     ON CONFLICT (plan_key, version) DO UPDATE SET entitlements = EXCLUDED.entitlements`,
    [planKey, version, entitlementsJson],
  );
}

function resolveInOwnTransaction(
  db: Db,
  tenantId: string,
  capability: Capability,
): Promise<CapabilityDecision> {
  return db.transaction((tx) => resolveCapability(tx, tenantId, capability));
}

const ALLOW: CapabilityDecision = { allowed: true };
const DENY: CapabilityDecision = { allowed: false, code: "PLAN_UPGRADE_REQUIRED" };

async function backendPid(client: pg.PoolClient): Promise<number> {
  const { rows } = await client.query(`SELECT pg_backend_pid() AS pid`);
  return (rows[0] as { pid: number }).pid;
}

/**
 * Discover whichever backend is currently blocked specifically by `holderPid`
 * (mirrors authorization.test.ts's helper of the same name — the resolver runs
 * inside a tx the test opens via db.transaction(), so the test has no direct
 * handle on which pool connection drizzle uses). Deterministic barrier, not a
 * timing sleep.
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
 * E3 contrast fixture only — deliberately NOT what resolveCapability does: the
 * same resolution logic and same already-open-tx contract, but a plain re-SELECT
 * of the subscription binding instead of `FOR SHARE`. Exists to prove, by direct
 * contrast, that the locking read is load-bearing — a concurrency test that
 * passes against both a locking and a non-locking implementation proves nothing.
 */
async function resolveCapabilityWithoutLock(
  tx: Tx,
  tenantId: string,
  capability: Capability,
): Promise<CapabilityDecision> {
  await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
  const subResult = await tx.execute(
    sql`SELECT plan_key, plan_version FROM subscriptions WHERE tenant_id = ${tenantId}`,
  );
  const subRows = subResult.rows as { plan_key: string; plan_version: number }[];
  const subscription = subRows[0];
  if (!subscription) return DENY;
  const planResult = await tx.execute(
    sql`SELECT entitlements FROM plans
        WHERE plan_key = ${subscription.plan_key} AND version = ${subscription.plan_version}`,
  );
  const planRows = planResult.rows as { entitlements: unknown }[];
  const plan = planRows[0] as
    { entitlements: { capabilities?: Record<string, unknown> } } | undefined;
  if (!plan) return DENY;
  const capabilities = plan.entitlements?.capabilities;
  if (capabilities && typeof capabilities === "object" && capabilities[capability] === true) {
    return { allowed: true };
  }
  return DENY;
}

/**
 * A fake tx that returns a fixed `entitlements` value from the plans read —
 * used to inject shapes the DB path cannot produce (a JS object with a genuine
 * custom prototype), for the prototype-safety suite. Call order: 1 set_config,
 * 2 subscriptions (host_pro@1), 3 plans (the injected entitlements).
 */
/**
 * The statement sequence resolveCapability issues, which these fakes must mirror exactly:
 *   1. ensureTenantContext's READ  (SELECT current_setting('app.tenant_id')) — D-15 made the GUC
 *      set-or-ASSERT, so it reads first; returning no row means "unset"
 *   2. ensureTenantContext's WRITE (set_config), taken only because step 1 came back unset
 *   3. resolve_subscription_locked  -> plan_key / plan_version
 *   4. plans                        -> entitlements
 * Before D-15 the context cost ONE call, so these fakes were numbered 1..3; leaving them that way
 * feeds the plans row to the subscriptions read and every such test dies on "malformed
 * subscriptions row" instead of exercising what it was written for.
 */
function fakeTxWithEntitlements(entitlements: unknown): Tx {
  let call = 0;
  return {
    execute: () => {
      call += 1;
      if (call <= 2) return Promise.resolve({ rows: [] }); // context read (unset) + set_config
      if (call === 3) {
        return Promise.resolve({ rows: [{ plan_key: "host_pro", plan_version: 1 }] });
      }
      return Promise.resolve({ rows: [{ entitlements }] });
    },
  } as unknown as Tx;
}

describe("entitlement resolution — free vs host_pro (billing §4b, tests #21/#22, edge #13)", () => {
  it("host_pro grants payment_reconcile_auto — the DD-114 D2 first-enforced capability", async () => {
    const tenantId = await seedTenant(ctx.owner, { planKey: "host_pro", planVersion: 1 });
    expect(
      await resolveInOwnTransaction(ctx.superuserDb.db, tenantId, "payment_reconcile_auto"),
    ).toEqual(ALLOW);
  });

  it("free is DENIED payment_reconcile_auto — PLAN_UPGRADE_REQUIRED (#21, edge #13)", async () => {
    const tenantId = await seedTenant(ctx.owner, { planKey: "free", planVersion: 1 });
    expect(
      await resolveInOwnTransaction(ctx.superuserDb.db, tenantId, "payment_reconcile_auto"),
    ).toEqual(DENY);
  });

  it("every host_pro-only automation capability is granted to host_pro, denied to free", async () => {
    const hostPro = await seedTenant(ctx.owner, { planKey: "host_pro", planVersion: 1 });
    const free = await seedTenant(ctx.owner, { planKey: "free", planVersion: 1 });
    const proOnly: Capability[] = [
      "payment_reconcile_auto",
      "reminders_auto",
      "assistant_ai_kb",
      "crm_dashboard",
    ];
    for (const cap of proOnly) {
      expect(await resolveInOwnTransaction(ctx.superuserDb.db, hostPro, cap)).toEqual(ALLOW);
      expect(await resolveInOwnTransaction(ctx.superuserDb.db, free, cap)).toEqual(DENY);
    }
  });

  it("universal capabilities are granted on BOTH tiers (free is not a blanket deny)", async () => {
    const hostPro = await seedTenant(ctx.owner, { planKey: "host_pro", planVersion: 1 });
    const free = await seedTenant(ctx.owner, { planKey: "free", planVersion: 1 });
    const universal: Capability[] = [
      "web_app",
      "bot_zalo",
      "bot_messenger",
      "session_management",
      "discovery_marketplace",
      "payment_mark_manual",
      "reminders_manual",
    ];
    for (const cap of universal) {
      expect(await resolveInOwnTransaction(ctx.superuserDb.db, hostPro, cap)).toEqual(ALLOW);
      expect(await resolveInOwnTransaction(ctx.superuserDb.db, free, cap)).toEqual(ALLOW);
    }
  });

  it("config-driven: flipping crm_dashboard:true in the seed grants it with NO code change (#22)", async () => {
    // A free-priced plan at a fresh version whose ONLY difference from canonical
    // free is crm_dashboard flipped to true — proves the gate reads the flag,
    // not the plan_key label (§4b: "changing which feature is free/pro = edit
    // the seed, not code").
    await seedPlan(ctx.owner, "free", 2, JSON.stringify({ capabilities: { crm_dashboard: true } }));
    const tenantId = await seedTenant(ctx.owner, { planKey: "free", planVersion: 2 });
    expect(await resolveInOwnTransaction(ctx.superuserDb.db, tenantId, "crm_dashboard")).toEqual(
      ALLOW,
    );
    // ...and a capability NOT set in that config still denies.
    expect(
      await resolveInOwnTransaction(ctx.superuserDb.db, tenantId, "payment_reconcile_auto"),
    ).toEqual(DENY);
  });
});

describe("fail-closed on every degenerate state", () => {
  it("missing subscription row denies — cannot prove entitlement (not allow-by-default)", async () => {
    const tenantId = await seedTenant(ctx.owner, "no-subscription");
    expect(
      await resolveInOwnTransaction(ctx.superuserDb.db, tenantId, "payment_mark_manual"),
    ).toEqual(DENY);
  });

  it("unknown tenant denies fail-closed without leaking whether it exists", async () => {
    expect(
      await resolveInOwnTransaction(ctx.superuserDb.db, randomUUID(), "payment_mark_manual"),
    ).toEqual(DENY);
  });

  it("a non-UUID tenantId throws (programming error propagates, never a silent deny)", async () => {
    await expect(
      resolveInOwnTransaction(ctx.superuserDb.db, "not-a-uuid", "web_app"),
    ).rejects.toThrow(/UUID/i);
  });

  it("capabilities key absent (entitlements = {}) denies", async () => {
    await seedPlan(ctx.owner, "free", 3, JSON.stringify({}));
    const tenantId = await seedTenant(ctx.owner, { planKey: "free", planVersion: 3 });
    expect(await resolveInOwnTransaction(ctx.superuserDb.db, tenantId, "web_app")).toEqual(DENY);
  });

  it("capabilities is a non-object (string / null / array) denies", async () => {
    await seedPlan(ctx.owner, "free", 4, JSON.stringify({ capabilities: "not-an-object" }));
    await seedPlan(ctx.owner, "free", 5, JSON.stringify({ capabilities: null }));
    await seedPlan(ctx.owner, "host_pro", 2, JSON.stringify({ capabilities: ["web_app"] }));
    for (const [key, version] of [
      ["free", 4],
      ["free", 5],
      ["host_pro", 2],
    ] as const) {
      const tenantId = await seedTenant(ctx.owner, { planKey: key, planVersion: version });
      expect(await resolveInOwnTransaction(ctx.superuserDb.db, tenantId, "web_app")).toEqual(DENY);
    }
  });

  it("a non-object TOP-LEVEL entitlements value (jsonb null / string / array) denies", async () => {
    // entitlements is `jsonb NOT NULL DEFAULT {}` — jsonb null, a string and an
    // array are all valid NON-SQL-NULL values, so the top-level isPlainRecord
    // guard must fail closed on each, not only on a malformed `capabilities`
    // sub-field (codex round-02 [P2]).
    await seedPlan(ctx.owner, "free", 6, JSON.stringify(null));
    await seedPlan(ctx.owner, "free", 7, JSON.stringify("a string"));
    await seedPlan(ctx.owner, "host_pro", 5, JSON.stringify([1, 2, 3]));
    for (const [key, version] of [
      ["free", 6],
      ["free", 7],
      ["host_pro", 5],
    ] as const) {
      const tenantId = await seedTenant(ctx.owner, { planKey: key, planVersion: version });
      expect(await resolveInOwnTransaction(ctx.superuserDb.db, tenantId, "web_app")).toEqual(DENY);
    }
  });

  it("a non-boolean capability value (string 'yes' / number 1) denies — strict === true only", async () => {
    await seedPlan(
      ctx.owner,
      "host_pro",
      3,
      JSON.stringify({ capabilities: { payment_reconcile_auto: "yes" } }),
    );
    await seedPlan(
      ctx.owner,
      "host_pro",
      4,
      JSON.stringify({ capabilities: { payment_reconcile_auto: 1 } }),
    );
    for (const version of [3, 4]) {
      const tenantId = await seedTenant(ctx.owner, { planKey: "host_pro", planVersion: version });
      expect(
        await resolveInOwnTransaction(ctx.superuserDb.db, tenantId, "payment_reconcile_auto"),
      ).toEqual(DENY);
    }
  });

  it("subscription pointing at a nonexistent plan row denies (FK-impossible → fake tx)", async () => {
    // subscriptions_plan_fk makes this unreachable through the live schema, so
    // it is exercised through a fake tx: set_config, then a subscription on
    // (free, 99), then an empty plans read.
    let call = 0;
    const fakeTx = {
      execute: () => {
        call += 1;
        if (call === 1) return Promise.resolve({ rows: [] }); // set_config
        if (call === 2) return Promise.resolve({ rows: [{ plan_key: "free", plan_version: 99 }] });
        return Promise.resolve({ rows: [] }); // plans → no row
      },
    } as unknown as Tx;
    expect(await resolveCapability(fakeTx, randomUUID(), "web_app")).toEqual(DENY);
  });

  it("an unrecognised capability name denies — even for a fully-entitled host_pro tenant", async () => {
    const tenantId = await seedTenant(ctx.owner, { planKey: "host_pro", planVersion: 1 });
    for (const nearMiss of [
      "payment_reconcile", // truncated
      "reconcile_auto", // reordered
      "PAYMENT_RECONCILE_AUTO", // wrong case
      "crm", // partial
      "not_a_real_capability",
    ]) {
      expect(
        await resolveInOwnTransaction(ctx.superuserDb.db, tenantId, nearMiss as Capability),
      ).toEqual(DENY);
    }
  });
});

describe("cause-agnostic deny shape + error propagation (G1, D1)", () => {
  it("G1: every deny path returns the identical {allowed:false, code:'PLAN_UPGRADE_REQUIRED'} shape", async () => {
    const freeLacksPro = await resolveInOwnTransaction(
      ctx.superuserDb.db,
      await seedTenant(ctx.owner, { planKey: "free", planVersion: 1 }),
      "payment_reconcile_auto",
    );
    const missingSubscription = await resolveInOwnTransaction(
      ctx.superuserDb.db,
      await seedTenant(ctx.owner, "no-subscription"),
      "payment_reconcile_auto",
    );
    const unknownTenant = await resolveInOwnTransaction(
      ctx.superuserDb.db,
      randomUUID(),
      "payment_reconcile_auto",
    );
    const unknownCapability = await resolveInOwnTransaction(
      ctx.superuserDb.db,
      await seedTenant(ctx.owner, { planKey: "host_pro", planVersion: 1 }),
      "totally_made_up" as Capability,
    );
    for (const decision of [freeLacksPro, missingSubscription, unknownTenant, unknownCapability]) {
      expect(decision).toEqual(DENY);
      expect(Object.keys(decision).sort()).toEqual(["allowed", "code"]);
    }
  });

  it("D1: a query failure propagates as a rejection — an error never collapses into allow OR deny", async () => {
    const brokenTx = {
      execute: () => Promise.reject(new Error("simulated dependency-unavailable failure")),
    } as unknown as Tx;
    await expect(
      resolveCapability(brokenTx, randomUUID(), "payment_reconcile_auto"),
    ).rejects.toThrow("simulated dependency-unavailable failure");
  });

  it("a structurally malformed subscriptions row (present but missing plan_key/plan_version) THROWS — not masked as a deny (codex round-05 [P2])", async () => {
    // A returned row that lacks a NOT-NULL column the query SELECTed is a driver/
    // contract anomaly, distinct from the legitimate "no subscription row" deny.
    let call = 0;
    const fakeTx = {
      execute: () => {
        call += 1;
        if (call === 1) return Promise.resolve({ rows: [] }); // set_config
        return Promise.resolve({ rows: [{ tenant_id: "x" }] }); // present row, no plan_key/plan_version
      },
    } as unknown as Tx;
    await expect(resolveCapability(fakeTx, randomUUID(), "payment_reconcile_auto")).rejects.toThrow(
      /malformed subscriptions row/,
    );
  });

  it("a structurally malformed plans row (present but missing the entitlements column) THROWS — not masked as a deny (codex round-05 [P2])", async () => {
    let call = 0;
    const fakeTx = {
      execute: () => {
        call += 1;
        if (call <= 2) return Promise.resolve({ rows: [] }); // context read (unset) + set_config
        if (call === 3) {
          return Promise.resolve({ rows: [{ plan_key: "host_pro", plan_version: 1 }] });
        }
        return Promise.resolve({ rows: [{ price: 0 }] }); // present plan row, no entitlements column
      },
    } as unknown as Tx;
    await expect(resolveCapability(fakeTx, randomUUID(), "payment_reconcile_auto")).rejects.toThrow(
      /malformed plans row/,
    );
  });
});

/**
 * Real app-role coverage. Every suite above runs through ctx.superuserDb; these
 * exercise the actual `app` connection (NOBYPASSRLS) — proving the subscriptions
 * read works under FORCE RLS via the app.tenant_id GUC the resolver sets itself,
 * and the plans read works via 0009's `GRANT SELECT ON plans TO app` (no lock,
 * no UPDATE privilege needed — the 0027 lesson made concrete here).
 */
describe("app-role access under RLS + plans grant", () => {
  it("app role: host_pro grants payment_reconcile_auto", async () => {
    const tenantId = await seedTenant(ctx.owner, { planKey: "host_pro", planVersion: 1 });
    expect(await resolveInOwnTransaction(ctx.appDb.db, tenantId, "payment_reconcile_auto")).toEqual(
      ALLOW,
    );
  });

  it("app role: free is denied payment_reconcile_auto", async () => {
    const tenantId = await seedTenant(ctx.owner, { planKey: "free", planVersion: 1 });
    expect(await resolveInOwnTransaction(ctx.appDb.db, tenantId, "payment_reconcile_auto")).toEqual(
      DENY,
    );
  });

  it("app role: missing subscription denies fail-closed under RLS", async () => {
    const tenantId = await seedTenant(ctx.owner, "no-subscription");
    expect(await resolveInOwnTransaction(ctx.appDb.db, tenantId, "payment_mark_manual")).toEqual(
      DENY,
    );
  });

  it("app role: a DIFFERENT tenant's GUC already set in the tx makes the resolver THROW, not silently re-scope (audit D-15)", async () => {
    // This assertion inverted with D-15. resolveCapability used to set app.tenant_id to its own
    // argument unconditionally, which reads as "cross-tenant safe" — it does resolve the right
    // plan — but it silently RE-SCOPES a transaction that some earlier statement had already
    // pinned to another tenant, so every unrelated read after it in that same transaction
    // quietly changes meaning. ensureTenantContext is set-or-assert: unset it sets, mismatched
    // it refuses. A caller that genuinely wants a different tenant must use its own transaction.
    const other = await seedTenant(ctx.owner, { planKey: "host_pro", planVersion: 1 });
    const self = await seedTenant(ctx.owner, { planKey: "free", planVersion: 1 });
    await expect(
      ctx.appDb.db.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('app.tenant_id', ${other}, true)`);
        return resolveCapability(tx, self, "payment_reconcile_auto");
      }),
    ).rejects.toThrow(TenantContextMismatchError);
    // and the honest shape — its own transaction — still resolves `self` (free) to a deny
    expect(await resolveInOwnTransaction(ctx.appDb.db, self, "payment_reconcile_auto")).toEqual(DENY);
  });
});

/**
 * Integration — the two orthogonal axes compose inside ONE caller transaction,
 * which is the realistic money-action enforcement shape: STATUS
 * (authorizeTenantAction) AND ENTITLEMENT (resolveCapability). This is the
 * pattern a future wiring slice for payment_reconcile_auto (DD-114 D2) will use.
 */
describe("integration — composes with authorizeTenantAction (status ∧ entitlement)", () => {
  it("host_pro active: status allows AND entitlement allows → money action would proceed", async () => {
    const tenantId = await seedTenant(ctx.owner, { planKey: "host_pro", planVersion: 1 });
    const result = await ctx.appDb.db.transaction(async (tx) => {
      const authz = await authorizeTenantAction(tx, tenantId, "publish_new_sessions");
      const entitlement = await resolveCapability(tx, tenantId, "payment_reconcile_auto");
      return { authz, entitlement };
    });
    expect(result.authz).toEqual({ allowed: true, effectiveStatus: "active" });
    expect(result.entitlement).toEqual(ALLOW);
  });

  it("free active: status ALLOWS but entitlement DENIES payment_reconcile_auto — the two axes are independent", async () => {
    const tenantId = await seedTenant(ctx.owner, { planKey: "free", planVersion: 1 });
    const result = await ctx.appDb.db.transaction(async (tx) => {
      const authz = await authorizeTenantAction(tx, tenantId, "publish_new_sessions");
      const entitlement = await resolveCapability(tx, tenantId, "payment_reconcile_auto");
      return { authz, entitlement };
    });
    expect(result.authz).toEqual({ allowed: true, effectiveStatus: "active" });
    expect(result.entitlement).toEqual(DENY);
  });

  it("free active: status allows AND entitlement allows the universal payment_mark_manual (DD-40 baseline)", async () => {
    const tenantId = await seedTenant(ctx.owner, { planKey: "free", planVersion: 1 });
    const result = await ctx.appDb.db.transaction(async (tx) => {
      const authz = await authorizeTenantAction(tx, tenantId, "publish_new_sessions");
      const entitlement = await resolveCapability(tx, tenantId, "payment_mark_manual");
      return { authz, entitlement };
    });
    expect(result.authz).toEqual({ allowed: true, effectiveStatus: "active" });
    expect(result.entitlement).toEqual(ALLOW);
  });

  it("suspended host_pro: status DENIES but entitlement still ALLOWS — the axes are independent (a suspended tenant stays ENTITLED; status is what blocks it)", async () => {
    // The docstring's axis-separation promise, proven end to end: subscription
    // status='suspended' makes authorizeTenantAction deny (subscription axis),
    // while resolveCapability — which reads only plan_key/plan_version, never
    // status — still returns the host_pro entitlement (codex round-02 [P2]).
    const tenantId = await seedTenant(ctx.owner, {
      planKey: "host_pro",
      planVersion: 1,
      status: "suspended",
    });
    const result = await ctx.appDb.db.transaction(async (tx) => {
      const authz = await authorizeTenantAction(tx, tenantId, "publish_new_sessions");
      const entitlement = await resolveCapability(tx, tenantId, "payment_reconcile_auto");
      return { authz, entitlement };
    });
    expect(result.authz).toEqual({ allowed: false, code: "TENANT_SUSPENDED" });
    expect(result.entitlement).toEqual(ALLOW);
  });
});

/**
 * The subscription FOR SHARE is load-bearing (codex round-01 [P1]). Without it a
 * concurrent host_pro→free downgrade committing between the subscription read
 * and the plans read would let the resolver return a STALE paid capability.
 * These mirror authorization.test.ts's E1/E3 competing-writer construction, on
 * the (plan_key, plan_version) binding this resolver depends on.
 */
describe("concurrency — the subscription FOR SHARE prevents a stale-plan grant during a downgrade", () => {
  it("writer-first: a downgrade holds FOR UPDATE first — resolveCapability BLOCKS, then observes the fresh free binding and denies", async () => {
    const tenantId = await seedTenant(ctx.owner, { planKey: "host_pro", planVersion: 1 });
    const holder = await ctx.superuserDb.pool.connect();
    try {
      await holder.query("BEGIN");
      await holder.query(`SELECT plan_key FROM subscriptions WHERE tenant_id = $1 FOR UPDATE`, [
        tenantId,
      ]);
      const holderPid = await backendPid(holder);

      // Not awaited yet — must still be pending (blocked on FOR SHARE) below.
      const pending = resolveInOwnTransaction(
        ctx.superuserDb.db,
        tenantId,
        "payment_reconcile_auto",
      );
      await waitUntilSomeoneBlockedByHolder(ctx.owner, holderPid);

      await holder.query(
        `UPDATE subscriptions SET plan_key = 'free', plan_version = 1 WHERE tenant_id = $1`,
        [tenantId],
      );
      await holder.query("COMMIT");

      expect(await pending).toEqual(DENY); // saw the committed free binding, not stale host_pro
    } finally {
      await holder.query("ROLLBACK").catch(() => {});
      holder.release();
    }
  });

  it("E3 contrast: a plain (no FOR SHARE) re-read wrongly ALLOWS mid-downgrade — proving the lock is load-bearing", async () => {
    const tenantId = await seedTenant(ctx.owner, { planKey: "host_pro", planVersion: 1 });
    const holder = await ctx.superuserDb.pool.connect();
    try {
      await holder.query("BEGIN");
      // Stage the downgrade under a row lock — deliberately NOT committed yet.
      await holder.query(
        `UPDATE subscriptions SET plan_key = 'free', plan_version = 1 WHERE tenant_id = $1`,
        [tenantId],
      );
      // The non-locking variant does not contend for the lock, so under READ
      // COMMITTED it reads the still-committed host_pro binding immediately and
      // wrongly allows — exactly the stale grant FOR SHARE (and the writer-first
      // test above) prevents.
      const stale = await ctx.superuserDb.db.transaction((tx) =>
        resolveCapabilityWithoutLock(tx, tenantId, "payment_reconcile_auto"),
      );
      expect(stale).toEqual(ALLOW);
      await holder.query("COMMIT");
    } finally {
      await holder.query("ROLLBACK").catch(() => {});
      holder.release();
    }
  });

  it("the FOR SHARE lock survives past resolveCapability's return inside the caller's tx — a mutation right after an allowed decision stays protected", async () => {
    const tenantId = await seedTenant(ctx.owner, { planKey: "host_pro", planVersion: 1 });
    let stillLockedAfterDecision = false;

    const decision = await ctx.superuserDb.db.transaction(async (tx) => {
      const result = await resolveCapability(tx, tenantId, "payment_reconcile_auto");
      // Still inside the SAME tx that produced `result` — where a real caller
      // would now mutate. Prove the subscription row is still locked by
      // confirming a competing SKIP LOCKED claim from a separate connection
      // defers (0 rows), i.e. this tx still holds the FOR SHARE.
      const claim = await ctx.owner.query(
        `SELECT plan_key FROM subscriptions WHERE tenant_id = $1 FOR UPDATE SKIP LOCKED`,
        [tenantId],
      );
      stillLockedAfterDecision = claim.rows.length === 0;
      return result;
    });

    expect(decision).toEqual(ALLOW);
    expect(stillLockedAfterDecision).toBe(true);
  });
});

/**
 * Prototype-safety (codex round-03 [P1]). A bracket lookup traverses the
 * prototype chain, so the resolver must read only OWN properties and reject
 * objects with a custom prototype — otherwise an inherited/polluted
 * `payment_reconcile_auto: true` could fail this authz gate OPEN.
 */
describe("prototype-safety — inherited / polluted flags never grant a capability", () => {
  it("a `__proto__` key inside the capabilities jsonb does not grant the nested flag (own-key check)", async () => {
    // Stored + retrieved through real Postgres jsonb. JSON.parse makes `__proto__`
    // an OWN data key on capabilities (it does NOT set the prototype), so
    // payment_reconcile_auto is NOT an own key of capabilities → deny; the
    // sibling own `web_app: true` still resolves → allow.
    // Raw JSON text on purpose: an object-literal `{ __proto__: ... }` sets the
    // prototype and is dropped by JSON.stringify, so the "__proto__" key would
    // never reach jsonb. A literal string stores it as a real jsonb key.
    const raw = '{"capabilities":{"__proto__":{"payment_reconcile_auto":true},"web_app":true}}';
    await seedPlan(ctx.owner, "host_pro", 6, raw);
    const tenantId = await seedTenant(ctx.owner, { planKey: "host_pro", planVersion: 6 });
    expect(
      await resolveInOwnTransaction(ctx.superuserDb.db, tenantId, "payment_reconcile_auto"),
    ).toEqual(DENY);
    expect(await resolveInOwnTransaction(ctx.superuserDb.db, tenantId, "web_app")).toEqual(ALLOW);
  });

  it("entitlements carrying the map on a CUSTOM prototype (not an own key) denies", async () => {
    const entitlements = Object.create({ capabilities: { payment_reconcile_auto: true } });
    expect(
      await resolveCapability(
        fakeTxWithEntitlements(entitlements),
        randomUUID(),
        "payment_reconcile_auto",
      ),
    ).toEqual(DENY);
  });

  it("a capabilities object whose flag is only on a CUSTOM prototype denies", async () => {
    const entitlements = { capabilities: Object.create({ payment_reconcile_auto: true }) };
    expect(
      await resolveCapability(
        fakeTxWithEntitlements(entitlements),
        randomUUID(),
        "payment_reconcile_auto",
      ),
    ).toEqual(DENY);
  });

  it("global Object.prototype pollution cannot grant a capability the plan does not own — the crux of the own-key defense", async () => {
    // A plan whose capabilities map OMITS crm_dashboard, so the ONLY place a
    // `true` could come from is a polluted prototype. A bare bracket read would
    // then wrongly ALLOW; the own-key check must still DENY.
    await seedPlan(ctx.owner, "free", 8, JSON.stringify({ capabilities: { web_app: true } }));
    const tenantId = await seedTenant(ctx.owner, { planKey: "free", planVersion: 8 });
    expect(await resolveInOwnTransaction(ctx.superuserDb.db, tenantId, "crm_dashboard")).toEqual(
      DENY,
    );
    const polluted = Object.prototype as unknown as Record<string, unknown>;
    try {
      polluted.crm_dashboard = true;
      expect(await resolveInOwnTransaction(ctx.superuserDb.db, tenantId, "crm_dashboard")).toEqual(
        DENY,
      );
      // an own true flag still resolves correctly under the same pollution
      expect(await resolveInOwnTransaction(ctx.superuserDb.db, tenantId, "web_app")).toEqual(ALLOW);
    } finally {
      delete polluted.crm_dashboard;
    }
  });
});

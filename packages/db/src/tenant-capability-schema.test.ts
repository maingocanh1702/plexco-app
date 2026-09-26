import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  expectErrorChainToMatch,
  setupRlsTestContext,
  type RlsTestContext,
} from "./test-harness.js";

/**
 * tenant-capability-authority-core M1 (migration 0047) storage invariants:
 * the closed registry seed (exactly 17 tenant-scoped keys), role privilege
 * posture (app / app_worker / readonly), tenant_isolation RLS on grants and
 * audit, the expires_at > granted_at CHECK, the one-active-grant partial
 * unique index (WHERE revoked_at IS NULL), the non-delegable storage
 * rejection trigger and the append-only audit trigger.
 *
 * Schema/constraint/seed/RLS only — no authorization-decision tests; those
 * belong to Milestone 2's authorize() primitive.
 */

const TEST_DB_NAME = "plexco_tenant_capability_schema_check";

const PRESET_KEYS = [
  "session.manage",
  "content.manage",
  "member.manage_routine",
  "member.ban",
  "money.read",
  "money.mark_paid",
  "chat.channel.manage",
  "chat.channel.post_restricted",
  "chat.message.moderate",
  "chat.member.mute",
];
const OWNER_GRANTABLE_KEYS = [
  "money.correct",
  "money.refund",
  "money.waive_or_void",
  "bank_account.manage",
  "connector.secret_manage",
  "billing.manage",
];
const OWNER_ONLY_KEYS = ["role.manage"];

let ctx: RlsTestContext;
let ownerA: string;
let granteeA: string;
let ownerB: string;
let granteeB: string;

beforeAll(async () => {
  ctx = await setupRlsTestContext(TEST_DB_NAME);
  ownerA = await seedPerson("Owner A");
  granteeA = await seedPerson("Grantee A");
  ownerB = await seedPerson("Owner B");
  granteeB = await seedPerson("Grantee B");
}, 120_000);

afterAll(async () => {
  await ctx?.teardown();
});

async function seedPerson(name: string): Promise<string> {
  const { rows } = await ctx.owner.query<{ id: string }>(
    `INSERT INTO persons (display_name) VALUES ($1) RETURNING id`,
    [name],
  );
  return rows[0]!.id;
}

/** Direct owner-connection insert: no runtime role can write grants in this slice. */
async function insertGrant(opts: {
  tenantId: string;
  grantee: string;
  grantedBy: string;
  actionKey: string;
}): Promise<string> {
  const { rows } = await ctx.owner.query<{ id: string }>(
    `INSERT INTO tenant_capability_grants
       (tenant_id, grantee_person_id, action_key, reason, granted_by_person_id, expires_at)
     VALUES ($1, $2, $3, 'test grant', $4, clock_timestamp() + interval '7 days')
     RETURNING id`,
    [opts.tenantId, opts.grantee, opts.actionKey, opts.grantedBy],
  );
  return rows[0]!.id;
}

async function insertAudit(tenantId: string, grantId: string, actor: string, action = "grant") {
  const { rows } = await ctx.owner.query<{ id: string }>(
    `INSERT INTO tenant_capability_grant_audit (tenant_id, grant_id, action, actor_person_id, reason)
     VALUES ($1, $2, $3, $4, 'test audit') RETURNING id`,
    [tenantId, grantId, action, actor],
  );
  return rows[0]!.id;
}

/** Run `fn` on one app-role connection inside a transaction with app.tenant_id set (or unset). */
async function asAppInTenant<T>(
  tenantId: string | null,
  fn: (c: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const c = await ctx.appPool.connect();
  try {
    await c.query("BEGIN");
    if (tenantId) await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    const out = await fn(c);
    await c.query("ROLLBACK");
    return out;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

async function tablePrivileges(role: string, table: string): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  for (const priv of [
    "SELECT",
    "INSERT",
    "UPDATE",
    "DELETE",
    "TRUNCATE",
    "REFERENCES",
    "TRIGGER",
  ]) {
    const { rows } = await ctx.owner.query<{ ok: boolean }>(
      `SELECT has_table_privilege($1, $2, $3) AS ok`,
      [role, table, priv],
    );
    out[priv] = rows[0]!.ok;
  }
  return out;
}

const NONE = {
  SELECT: false,
  INSERT: false,
  UPDATE: false,
  DELETE: false,
  TRUNCATE: false,
  REFERENCES: false,
  TRIGGER: false,
};
const SELECT_ONLY = { ...NONE, SELECT: true };

describe("tenant_capability_actions — closed registry seed", () => {
  it("is seeded with exactly 17 tenant-scoped keys, each in its DD-56 authority class", async () => {
    const { rows } = await ctx.owner.query<{
      action_key: string;
      co_admin_default: boolean;
      delegable: boolean;
      authority_class: string;
    }>(`SELECT action_key, co_admin_default, delegable, authority_class
        FROM tenant_capability_actions ORDER BY action_key`);
    expect(rows).toHaveLength(17);
    const expected = [
      ...PRESET_KEYS.map((k) => [k, true, false, "preset"]),
      ...OWNER_GRANTABLE_KEYS.map((k) => [k, false, true, "owner_grantable"]),
      ...OWNER_ONLY_KEYS.map((k) => [k, false, false, "owner_only"]),
    ].sort((a, b) => String(a[0]).localeCompare(String(b[0]), "en"));
    const actual = rows
      .map((r) => [r.action_key, r.co_admin_default, r.delegable, r.authority_class])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]), "en"));
    expect(actual).toEqual(expected);
  });

  it("seeds no platform_admin_only row (DD-51 / DD-53 resolve through their own services)", async () => {
    const { rows } = await ctx.owner.query(
      `SELECT action_key FROM tenant_capability_actions WHERE authority_class = 'platform_admin_only'`,
    );
    expect(rows).toEqual([]);
  });

  it("rejects an authority_class outside the closed set", async () => {
    await expectErrorChainToMatch(
      ctx.owner.query(
        `INSERT INTO tenant_capability_actions (action_key, co_admin_default, delegable, authority_class)
         VALUES ('bogus.key', false, false, 'superuser')`,
      ),
      /tenant_capability_actions_authority_class_chk/,
    );
  });

  it("rejects a row whose delegable / co_admin_default flags disagree with its class", async () => {
    for (const [coAdmin, delegable, cls] of [
      [true, true, "preset"],
      [false, true, "owner_only"],
      [true, false, "owner_grantable"],
      [false, false, "preset"],
    ] as const) {
      await expectErrorChainToMatch(
        ctx.owner.query(
          `INSERT INTO tenant_capability_actions (action_key, co_admin_default, delegable, authority_class)
           VALUES ('bogus.flags', $1, $2, $3)`,
          [coAdmin, delegable, cls],
        ),
        /tenant_capability_actions_class_flags_chk/,
      );
    }
  });

  it("grants no privilege of any kind to app, app_worker or readonly", async () => {
    for (const role of ["app", "app_worker", "readonly"]) {
      expect(await tablePrivileges(role, "tenant_capability_actions"), role).toEqual(NONE);
    }
    await expectErrorChainToMatch(
      ctx.appPool.query(`SELECT action_key FROM tenant_capability_actions`),
      /permission denied/,
    );
    await expectErrorChainToMatch(
      ctx.readonlyPool.query(`SELECT action_key FROM tenant_capability_actions`),
      /permission denied/,
    );
    await expectErrorChainToMatch(
      ctx.workerPool.query(`SELECT action_key FROM tenant_capability_actions`),
      /permission denied/,
    );
  });
});

describe("tenant_capability_grants — storage constraints", () => {
  it("app is SELECT-only; app_worker and readonly have nothing", async () => {
    expect(await tablePrivileges("app", "tenant_capability_grants")).toEqual(SELECT_ONLY);
    expect(await tablePrivileges("app_worker", "tenant_capability_grants")).toEqual(NONE);
    expect(await tablePrivileges("readonly", "tenant_capability_grants")).toEqual(NONE);
    await expectErrorChainToMatch(
      asAppInTenant(ctx.tenantA, (c) =>
        c.query(
          `INSERT INTO tenant_capability_grants
             (tenant_id, grantee_person_id, action_key, reason, granted_by_person_id, expires_at)
           VALUES ($1, $2, 'money.refund', 'r', $3, now() + interval '1 day')`,
          [ctx.tenantA, granteeA, ownerA],
        ),
      ),
      /permission denied/,
    );
  });

  it("accepts a grant for an owner-grantable (delegable) action", async () => {
    const id = await insertGrant({
      tenantId: ctx.tenantA,
      grantee: granteeA,
      grantedBy: ownerA,
      actionKey: "money.correct",
    });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("rejects a non-delegable action at storage: role.manage and every preset key", async () => {
    for (const actionKey of [...OWNER_ONLY_KEYS, ...PRESET_KEYS]) {
      await expectErrorChainToMatch(
        insertGrant({ tenantId: ctx.tenantA, grantee: granteeA, grantedBy: ownerA, actionKey }),
        /non-delegable/,
      );
    }
  });

  it("rejects an UPDATE that re-points an existing grant at a non-delegable action", async () => {
    const id = await insertGrant({
      tenantId: ctx.tenantA,
      grantee: granteeA,
      grantedBy: ownerA,
      actionKey: "money.waive_or_void",
    });
    await expectErrorChainToMatch(
      ctx.owner.query(
        `UPDATE tenant_capability_grants SET action_key = 'role.manage' WHERE id = $1`,
        [id],
      ),
      /non-delegable/,
    );
  });

  // The BEFORE trigger fires ahead of the FK check, so an unknown key (NULL delegable) is
  // rejected by the non-delegable guard first; the FK is the second line of defense.
  it("rejects an action_key that is not in the registry", async () => {
    await expectErrorChainToMatch(
      insertGrant({
        tenantId: ctx.tenantA,
        grantee: granteeA,
        grantedBy: ownerA,
        actionKey: "money.print",
      }),
      /non-delegable/,
    );
  });

  it("CHECK expires_at > granted_at rejects an already-expired or zero-length grant", async () => {
    // Explicit timestamps: two clock_timestamp() calls in one INSERT are not ordered reliably.
    for (const expiresAt of ["2026-01-01T00:00:00Z", "2025-12-31T00:00:00Z"]) {
      await expectErrorChainToMatch(
        ctx.owner.query(
          `INSERT INTO tenant_capability_grants
             (tenant_id, grantee_person_id, action_key, reason, granted_by_person_id, granted_at, expires_at)
           VALUES ($1, $2, 'billing.manage', 'r', $3, '2026-01-01T00:00:00Z', $4)`,
          [ctx.tenantA, granteeA, ownerA, expiresAt],
        ),
        /tenant_capability_grants_expiry_chk/,
      );
    }
  });

  it("allows one active grant per (tenant, grantee, action) — the index is WHERE revoked_at IS NULL", async () => {
    const first = await insertGrant({
      tenantId: ctx.tenantA,
      grantee: granteeA,
      grantedBy: ownerA,
      actionKey: "bank_account.manage",
    });
    await expectErrorChainToMatch(
      insertGrant({
        tenantId: ctx.tenantA,
        grantee: granteeA,
        grantedBy: ownerA,
        actionKey: "bank_account.manage",
      }),
      /idx_tenant_capability_grants_active/,
    );
    await ctx.owner.query(
      `UPDATE tenant_capability_grants SET revoked_at = clock_timestamp() WHERE id = $1`,
      [first],
    );
    const second = await insertGrant({
      tenantId: ctx.tenantA,
      grantee: granteeA,
      grantedBy: ownerA,
      actionKey: "bank_account.manage",
    });
    expect(second).not.toBe(first);
    // Same tuple in another tenant never collided in the first place.
    await insertGrant({
      tenantId: ctx.tenantB,
      grantee: granteeA,
      grantedBy: ownerB,
      actionKey: "bank_account.manage",
    });
  });
});

describe("tenant_isolation RLS on grants and audit", () => {
  let grantA: string;
  let grantB: string;
  let auditA: string;
  let auditB: string;

  beforeAll(async () => {
    grantA = await insertGrant({
      tenantId: ctx.tenantA,
      grantee: granteeA,
      grantedBy: ownerA,
      actionKey: "connector.secret_manage",
    });
    grantB = await insertGrant({
      tenantId: ctx.tenantB,
      grantee: granteeB,
      grantedBy: ownerB,
      actionKey: "connector.secret_manage",
    });
    auditA = await insertAudit(ctx.tenantA, grantA, ownerA);
    auditB = await insertAudit(ctx.tenantB, grantB, ownerB);
  });

  it("both tables are ENABLE + FORCE RLS with a tenant_isolation policy", async () => {
    const { rows } = await ctx.owner.query<{
      relname: string;
      forced: boolean;
      policy: string | null;
    }>(
      `SELECT c.relname, (c.relrowsecurity AND c.relforcerowsecurity) AS forced, p.policyname AS policy
       FROM pg_class c
       LEFT JOIN pg_policies p ON p.tablename = c.relname AND p.schemaname = 'public'
       WHERE c.relname IN ('tenant_capability_grants', 'tenant_capability_grant_audit')
         AND c.relnamespace = 'public'::regnamespace
       ORDER BY c.relname`,
    );
    expect(rows).toEqual([
      { relname: "tenant_capability_grant_audit", forced: true, policy: "tenant_isolation" },
      { relname: "tenant_capability_grants", forced: true, policy: "tenant_isolation" },
    ]);
  });

  it("app in tenant A sees only tenant A's grants and audit rows", async () => {
    const seen = await asAppInTenant(ctx.tenantA, async (c) => ({
      grants: (
        await c.query<{ id: string; tenant_id: string }>(
          `SELECT id, tenant_id FROM tenant_capability_grants`,
        )
      ).rows,
      audit: (await c.query<{ id: string }>(`SELECT id FROM tenant_capability_grant_audit`)).rows,
    }));
    expect(seen.grants.map((r) => r.id)).toContain(grantA);
    expect(seen.grants.map((r) => r.id)).not.toContain(grantB);
    expect(seen.grants.every((r) => r.tenant_id === ctx.tenantA)).toBe(true);
    expect(seen.audit.map((r) => r.id)).toEqual([auditA]);
  });

  it("app in tenant B cannot see tenant A's rows, even by id", async () => {
    const seen = await asAppInTenant(ctx.tenantB, async (c) => ({
      grant: (await c.query(`SELECT id FROM tenant_capability_grants WHERE id = $1`, [grantA]))
        .rows,
      audit: (await c.query(`SELECT id FROM tenant_capability_grant_audit`)).rows,
    }));
    expect(seen.grant).toEqual([]);
    expect(seen.audit).toEqual([{ id: auditB }]);
  });

  it("app without tenant context sees nothing (fail closed)", async () => {
    const seen = await asAppInTenant(null, async (c) => ({
      grants: (await c.query(`SELECT id FROM tenant_capability_grants`)).rows,
      audit: (await c.query(`SELECT id FROM tenant_capability_grant_audit`)).rows,
    }));
    expect(seen).toEqual({ grants: [], audit: [] });
  });
});

describe("tenant_capability_grant_audit — append-only history", () => {
  let grantId: string;
  let auditId: string;

  beforeAll(async () => {
    grantId = await insertGrant({
      tenantId: ctx.tenantA,
      grantee: granteeB,
      grantedBy: ownerA,
      actionKey: "money.refund",
    });
    auditId = await insertAudit(ctx.tenantA, grantId, ownerA);
  });

  it("app is SELECT-only; app_worker and readonly have nothing", async () => {
    expect(await tablePrivileges("app", "tenant_capability_grant_audit")).toEqual(SELECT_ONLY);
    expect(await tablePrivileges("app_worker", "tenant_capability_grant_audit")).toEqual(NONE);
    expect(await tablePrivileges("readonly", "tenant_capability_grant_audit")).toEqual(NONE);
  });

  it("is append-only: UPDATE and DELETE are blocked even for the table owner", async () => {
    await expectErrorChainToMatch(
      ctx.owner.query(
        `UPDATE tenant_capability_grant_audit SET reason = 'rewritten' WHERE id = $1`,
        [auditId],
      ),
      /append-only \(UPDATE blocked\)/,
    );
    await expectErrorChainToMatch(
      ctx.owner.query(`DELETE FROM tenant_capability_grant_audit WHERE id = $1`, [auditId]),
      /append-only \(DELETE blocked\)/,
    );
    const { rows } = await ctx.owner.query(
      `SELECT reason FROM tenant_capability_grant_audit WHERE id = $1`,
      [auditId],
    );
    expect(rows).toEqual([{ reason: "test audit" }]);
  });

  it("accepts a revoke event and rejects any action outside grant/revoke", async () => {
    await insertAudit(ctx.tenantA, grantId, ownerA, "revoke");
    await expectErrorChainToMatch(
      insertAudit(ctx.tenantA, grantId, ownerA, "extend"),
      /tenant_capability_grant_audit_action_chk/,
    );
  });

  it("rejects an audit row whose tenant differs from its grant's tenant", async () => {
    await expectErrorChainToMatch(
      insertAudit(ctx.tenantB, grantId, ownerB),
      /tenant_capability_grant_audit_tenant_grant_fk/,
    );
  });
});

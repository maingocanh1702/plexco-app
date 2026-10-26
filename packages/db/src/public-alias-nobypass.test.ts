import { createHash } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupNonSuperuserOwnerContext, type NonSuperuserOwnerContext } from "./test-harness.js";

/**
 * 0060 under a NOSUPERUSER NOBYPASSRLS migration owner (A-17). The main suite migrates as a
 * superuser, which bypasses FORCE RLS, so only here does tenant_public_alias_decide's own
 * set_config prove necessary: outbox_events and tenant_public_alias_audit are FORCE RLS, and the
 * owner's inserts pass WITH CHECK only because the definer scopes the GUC to the decided tenant
 * itself, then restores the caller's value.
 */
let ns: NonSuperuserOwnerContext;
let app: pg.Pool;
// ns.superuser is connected to the BASE database, so seeds and assertions go through a superuser
// connection INTO the owner-context database.
let su: pg.Client;
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const PRIOR_GUC = "00000000-0000-0000-0000-000000000000";

beforeAll(async () => {
  ns = await setupNonSuperuserOwnerContext("plexco_public_alias_nobypass");
  await ns.bootstrapAndMigrateAsOwner();
  app = await ns.connectAsApp();
  const url = new URL(process.env.DATABASE_URL_TEST!);
  url.pathname = `/${ns.dbName}`;
  su = new pg.Client({ connectionString: url.toString() });
  await su.connect();
}, 240_000);
afterAll(async () => {
  await su?.end();
  await ns?.teardown();
});

describe("0060 under a NOBYPASSRLS owner (A-17)", () => {
  it("A-17: app sets, the owner approves; one audit row and one event under FORCE RLS; GUC restored", async () => {
    const id = async (sql: string, params: unknown[] = []) =>
      (await su.query<{ id: string }>(sql, params)).rows[0]!.id;
    const tenantId = await id(
      `INSERT INTO tenants (name, slug) VALUES ('Nobypass Club', 'pa-nobypass') RETURNING id`,
    );
    const personId = await id(
      `INSERT INTO persons (display_name) VALUES ('Nobypass Owner') RETURNING id`,
    );
    await su.query(
      `INSERT INTO tenant_admins (tenant_id, platform, platform_user_lookup_hash, role, active)
       VALUES ($1, 'web', $2, 'owner', true)`,
      [tenantId, personId],
    );

    const c = await app.connect();
    try {
      await c.query("BEGIN");
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      const set = await c.query(`SELECT * FROM tenant_public_alias_set($1, $2, 'Nobypass Alias')`, [
        tenantId,
        personId,
      ]);
      expect(set.rows).toEqual([
        { public_alias: "Nobypass Alias", public_alias_status: "pending", changed: true },
      ]);
      await c.query("COMMIT");
    } finally {
      c.release();
    }

    const o = await ns.ownerPool.connect();
    try {
      await o.query("BEGIN");
      await o.query(`SELECT set_config('app.tenant_id', $1, true)`, [PRIOR_GUC]);
      // FORCE RLS binds this owner: under a foreign GUC it sees none of the tenant's rows.
      const visible = await o.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM outbox_events WHERE aggregate_id = $1`,
        [tenantId],
      );
      expect(visible.rows[0]!.n).toBe(0);
      const pending = await o.query(`SELECT * FROM tenant_public_alias_pending()`);
      expect(pending.rows).toEqual([
        {
          tenant_id: tenantId,
          public_alias: "Nobypass Alias",
          alias_sha256: sha("Nobypass Alias"),
        },
      ]);
      const decided = await o.query(
        `SELECT * FROM tenant_public_alias_decide($1, 'approved', $2, 'owner-cli')`,
        [tenantId, sha("Nobypass Alias")],
      );
      expect(decided.rows).toEqual([{ tenant_id: tenantId, public_alias_status: "approved" }]);
      const guc = await o.query<{ g: string }>(`SELECT current_setting('app.tenant_id') AS g`);
      expect(guc.rows[0]!.g).toBe(PRIOR_GUC);
      await o.query("COMMIT");
    } finally {
      o.release();
    }

    const audit = await su.query(
      `SELECT tenant_id, decision, alias, decided_by FROM tenant_public_alias_audit`,
    );
    expect(audit.rows).toEqual([
      {
        tenant_id: tenantId,
        decision: "approved",
        alias: "Nobypass Alias",
        decided_by: "owner-cli",
      },
    ]);
    const events = await su.query(
      `SELECT sequence, type, payload FROM outbox_events WHERE aggregate_id = $1 ORDER BY sequence`,
      [tenantId],
    );
    expect(events.rows).toEqual([
      { sequence: 1, type: "tenant.public_alias_set", payload: { status: "pending" } },
      { sequence: 2, type: "tenant.public_alias_approved", payload: { status: "approved" } },
    ]);
  });
});

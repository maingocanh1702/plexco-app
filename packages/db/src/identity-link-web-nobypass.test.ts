import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { issueLinkCode } from "./identity.js";
import { linkZaloToAccount } from "./identity-link-web.js";
import {
  setupNonSuperuserOwnerContext,
  withJobDefinerLock,
  type NonSuperuserOwnerContext,
} from "./test-harness.js";

/**
 * 0054 measured under a NOSUPERUSER NOBYPASSRLS owner (the rest of the suite migrates as a
 * superuser, so only the bypass branch is proven there). Tenant tables are FORCE RLS, so a count
 * made by the definer with no tenant GUC would read 0 for a Person that HAS a membership: the
 * "never a false empty" proof is that the link is refused anyway.
 */
let ns: NonSuperuserOwnerContext;
let app: pg.Pool;
// ns.superuser is connected to the BASE database (it creates/drops the throwaway one), so seeds that
// the `app` role must see go through a superuser connection INTO the owner-context database.
let su: pg.Client;
const keys = { lookupHmacKey: randomBytes(32) };

beforeAll(async () => {
  ns = await setupNonSuperuserOwnerContext("plexco_link_web_nobypass");
  await withJobDefinerLock(process.env.DATABASE_URL_TEST!, async () => {
    await ns.bootstrapJobDefinerForOwner();
    await ns.bootstrapChatDefinerForOwner();
    await ns.runMigration();
  });
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

describe("0054 under a NOBYPASSRLS owner", () => {
  it("a Person with a membership is requires_review: the owner cannot read memberships (0 rows) yet nothing moves", async () => {
    const tenant = (
      await su.query(
        `INSERT INTO tenants (name, slug, status) VALUES ('NB Club', 'nb-club', 'active') RETURNING id`,
      )
    ).rows[0].id as string;
    const web = (await su.query(`INSERT INTO persons (display_name) VALUES ('Web') RETURNING id`))
      .rows[0].id as string;
    const accountId = (
      await su.query(`INSERT INTO accounts (person_id) VALUES ($1) RETURNING id`, [web])
    ).rows[0].id as string;
    const zalo = (await su.query(`INSERT INTO persons (display_name) VALUES ('Zalo') RETURNING id`))
      .rows[0].id as string;
    const ciId = randomUUID();
    await su.query(
      `INSERT INTO channel_identities (id, person_id, platform, platform_user_id_enc, platform_user_lookup_hash, status)
       VALUES ($1, $2, 'zalo', $3, $4, 'active')`,
      [ciId, zalo, Buffer.from("x"), `nb-${ciId}`],
    );
    await su.query(`INSERT INTO memberships (tenant_id, person_id) VALUES ($1, $2)`, [
      tenant,
      zalo,
    ]);

    // The hazard, measured: superuser sees the row, the NOBYPASSRLS owner (no GUC) reads 0.
    expect(
      Number((await su.query(`SELECT count(*) AS n FROM memberships`)).rows[0].n),
    ).toBeGreaterThan(0);
    expect(
      Number((await ns.ownerPool.query(`SELECT count(*) AS n FROM memberships`)).rows[0].n),
    ).toBe(0);

    const issued = await issueLinkCode(app, { channelIdentityId: ciId }, keys);
    expect(await linkZaloToAccount(app, issued.code, accountId, keys)).toEqual({
      outcome: "requires_review",
    });

    const ci = await su.query(`SELECT person_id FROM channel_identities WHERE id = $1`, [ciId]);
    expect(ci.rows[0].person_id).toBe(zalo);
    const p = await su.query(`SELECT status FROM persons WHERE id = $1`, [zalo]);
    expect(p.rows[0].status).toBe("active");
    const audit = await su.query(
      `SELECT detail FROM routing_audit WHERE action = 'identity.link_requires_review' AND actor_id = $1`,
      [accountId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].detail.blocking_tables).toContain("memberships.person_id");
  });
});

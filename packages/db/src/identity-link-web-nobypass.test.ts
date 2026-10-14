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
 * 0054 under a NOSUPERUSER NOBYPASSRLS migration owner (the rest of the suite migrates as a
 * superuser). Tenant tables are FORCE RLS, so the migration owner itself, with no tenant GUC, reads
 * 0 rows. The function is owned by identity_definer (BYPASSRLS, created inside 0054's SET ROLE
 * bracket; DD-127 / DD-131 OD-3), so its scan reads those tables for real: an EMPTY Person links,
 * and a Person with a membership is refused because the membership is COUNTED.
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

async function seedLinkPair(
  tag: string,
): Promise<{ web: string; accountId: string; zalo: string; ciId: string }> {
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
    [ciId, zalo, Buffer.from("x"), `${tag}-${ciId}`],
  );
  return { web, accountId, zalo, ciId };
}

describe("0054 under a NOBYPASSRLS migration owner", () => {
  it("an EMPTY Zalo Person links: the identity moves, the source is tombstoned, audit rows are written", async () => {
    // The premise, measured: neither the migration owner nor the caller can bypass RLS.
    const roles = await su.query(
      `SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname IN ($1, 'app') ORDER BY rolname`,
      [ns.ownerRole],
    );
    expect(roles.rows).toEqual([
      { rolname: "app", rolsuper: false, rolbypassrls: false },
      { rolname: ns.ownerRole, rolsuper: false, rolbypassrls: false },
    ]);
    const { web, accountId, zalo, ciId } = await seedLinkPair("nb-empty");

    // Behaviour first: under the pre-OD-3 owner (the NOBYPASSRLS migration role) this was
    // requires_review, because every FORCE-RLS reference onto persons was unprovable.
    const issued = await issueLinkCode(app, { channelIdentityId: ciId }, keys);
    expect(await linkZaloToAccount(app, issued.code, accountId, keys)).toEqual({
      outcome: "linked",
    });
    const owner = await su.query(
      `SELECT pg_get_userbyid(proowner) AS owner FROM pg_proc
        WHERE oid = 'link_code_reparent_empty_person(uuid, uuid)'::regprocedure`,
    );
    expect(owner.rows[0].owner).toBe("identity_definer");

    const ci = await su.query(`SELECT person_id FROM channel_identities WHERE id = $1`, [ciId]);
    expect(ci.rows[0].person_id).toBe(web);
    const p = await su.query(`SELECT status, merged_into_person_id FROM persons WHERE id = $1`, [
      zalo,
    ]);
    expect(p.rows[0]).toEqual({ status: "merged", merged_into_person_id: web });
    const tomb = await su.query(
      `SELECT a.reason_code FROM merge_tombstones t JOIN merge_audit a ON a.id = t.merge_audit_id
        WHERE t.old_person_id = $1`,
      [zalo],
    );
    expect(tomb.rows).toEqual([{ reason_code: "link_code_empty_reparent" }]);
    const audit = await su.query(
      `SELECT count(*) AS n FROM routing_audit WHERE action = 'identity.link_reparented' AND actor_id = $1`,
      [accountId],
    );
    expect(Number(audit.rows[0].n)).toBe(1);
  });

  it("a Person with a membership is requires_review: the owner reads 0 memberships, the definer counts 1, nothing moves", async () => {
    const tenant = (
      await su.query(
        `INSERT INTO tenants (name, slug, status) VALUES ('NB Club', 'nb-club', 'active') RETURNING id`,
      )
    ).rows[0].id as string;
    const { accountId, zalo, ciId } = await seedLinkPair("nb");
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

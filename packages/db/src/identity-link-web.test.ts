import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import {
  issueLinkCode,
  formatLinkCode,
  linkCodeLookupComponent,
  normalizeLinkCode,
} from "./identity.js";
import { linkZaloToAccount } from "./identity-link-web.js";
import { setupRlsTestContext, type RlsTestContext } from "./test-harness.js";

/**
 * Real-Postgres tests for 0054 link_code_reparent_empty_person + linkZaloToAccount (lane M3b).
 * Runtime calls go through ctx.appPool (role `app`); seeds/inspection through ctx.owner.
 * A "Zalo user" is a Person minted the way zalo_identity_resolve mints one: one persons row, one
 * active zalo channel_identities row, nothing else.
 */
let ctx: RlsTestContext;
const keys = { lookupHmacKey: randomBytes(32) };

beforeAll(async () => {
  ctx = await setupRlsTestContext("plexco_identity_link_web");
}, 180_000);
afterAll(async () => {
  await ctx?.teardown();
});

async function webUser(): Promise<{ accountId: string; personId: string }> {
  const p = await ctx.owner.query<{ id: string }>(
    `INSERT INTO persons (display_name) VALUES ('Web') RETURNING id`,
  );
  const a = await ctx.owner.query<{ id: string }>(
    `INSERT INTO accounts (person_id) VALUES ($1) RETURNING id`,
    [p.rows[0]!.id],
  );
  return { accountId: a.rows[0]!.id, personId: p.rows[0]!.id };
}

async function zaloUser(): Promise<{ personId: string; ciId: string }> {
  const p = await ctx.owner.query<{ id: string }>(
    `INSERT INTO persons (display_name) VALUES ('Zalo') RETURNING id`,
  );
  const personId = p.rows[0]!.id;
  const ciId = randomUUID();
  await ctx.owner.query(
    `INSERT INTO channel_identities
       (id, person_id, platform, platform_user_id_enc, platform_user_lookup_hash, status)
     VALUES ($1, $2, 'zalo', $3, $4, 'active')`,
    [ciId, personId, Buffer.from("x"), `lw-${ciId}`],
  );
  return { personId, ciId };
}

/** Issue a channel code the way the bot's /link does. */
const issueFor = (ciId: string) => issueLinkCode(ctx.appPool, { channelIdentityId: ciId }, keys);

async function reparent(codeId: string, accountId: string): Promise<string> {
  const { rows } = await ctx.appPool.query(
    `SELECT outcome FROM link_code_reparent_empty_person($1, $2)`,
    [codeId, accountId],
  );
  return (rows[0] as { outcome: string }).outcome;
}

const personRow = async (id: string) =>
  (await ctx.owner.query(`SELECT status, merged_into_person_id FROM persons WHERE id = $1`, [id]))
    .rows[0] as { status: string; merged_into_person_id: string | null };
const ciPerson = async (id: string) =>
  (await ctx.owner.query(`SELECT person_id FROM channel_identities WHERE id = $1`, [id])).rows[0]
    .person_id as string;
const blockingTables = async (accountId: string) =>
  (
    await ctx.owner.query(
      `SELECT detail FROM routing_audit WHERE action = 'identity.link_requires_review' AND actor_id = $1`,
      [accountId],
    )
  ).rows[0].detail.blocking_tables as string[];
/** requires_review moved nothing: identity still on the Zalo person, which is active and untombstoned. */
async function expectNothingMoved(zalo: { personId: string; ciId: string }) {
  expect(await ciPerson(zalo.ciId)).toBe(zalo.personId);
  expect((await personRow(zalo.personId)).status).toBe("active");
  const n = await ctx.owner.query(
    `SELECT count(*) AS n FROM merge_tombstones WHERE old_person_id = $1`,
    [zalo.personId],
  );
  expect(Number(n.rows[0].n)).toBe(0);
}
const auditCount = async (action: string, accountId: string) =>
  Number(
    (
      await ctx.owner.query(
        `SELECT count(*) AS n FROM routing_audit WHERE action = $1 AND actor_id = $2`,
        [action, accountId],
      )
    ).rows[0].n,
  );

describe("linkZaloToAccount - empty Zalo person", () => {
  it("links: identity moves to the account's person, source tombstoned with audit, other codes revoked", async () => {
    const web = await webUser();
    const zalo = await zaloUser();
    const issued = await issueFor(zalo.ciId);
    // A second live code of the source person cannot coexist (supersede-on-issue), so insert one
    // directly to prove the revoke step.
    const extra = await ctx.owner.query<{ id: string }>(
      `INSERT INTO link_codes (source_person_id, source_channel_identity_id, code_lookup_hash,
                               code_hash, salt, action, expires_at)
       VALUES ($1, $2, $3, $4, $5, 'merge_identity', now() + interval '5 minutes') RETURNING id`,
      [
        zalo.personId,
        zalo.ciId,
        `x-${randomUUID()}-${randomUUID()}`,
        randomBytes(32),
        randomBytes(16),
      ],
    );

    // Lower-case, dashless input: normalization is the server's job.
    const typed = issued.code.replaceAll("-", "").toLowerCase();
    expect(await linkZaloToAccount(ctx.appPool, typed, web.accountId, keys)).toEqual({
      outcome: "linked",
    });

    expect(await ciPerson(zalo.ciId)).toBe(web.personId);
    expect(await personRow(zalo.personId)).toEqual({
      status: "merged",
      merged_into_person_id: web.personId,
    });
    const tomb = await ctx.owner.query(
      `SELECT t.canonical_person_id, a.method, a.reason_code, a.actor_type
         FROM merge_tombstones t JOIN merge_audit a ON a.id = t.merge_audit_id
        WHERE t.old_person_id = $1`,
      [zalo.personId],
    );
    expect(tomb.rows).toEqual([
      {
        canonical_person_id: web.personId,
        method: "link_code",
        reason_code: "link_code_empty_reparent",
        actor_type: "system",
      },
    ]);
    const revoked = await ctx.owner.query(`SELECT revoked_at FROM link_codes WHERE id = $1`, [
      extra.rows[0]!.id,
    ]);
    expect(revoked.rows[0].revoked_at).not.toBeNull();
    expect(await auditCount("identity.link_reparented", web.accountId)).toBe(1);
  });

  it("re-calling the definer with the same consumed code is same_person and writes nothing more", async () => {
    const web = await webUser();
    const zalo = await zaloUser();
    const issued = await issueFor(zalo.ciId);
    expect(await linkZaloToAccount(ctx.appPool, issued.code, web.accountId, keys)).toEqual({
      outcome: "linked",
    });
    expect(await reparent(issued.linkCodeId, web.accountId)).toBe("same_person");
    const n = await ctx.owner.query(
      `SELECT count(*) AS n FROM merge_tombstones WHERE old_person_id = $1`,
      [zalo.personId],
    );
    expect(Number(n.rows[0].n)).toBe(1);
    // The raw code is single-use at consume level: a second submit is the generic invalid.
    expect(await linkZaloToAccount(ctx.appPool, issued.code, web.accountId, keys)).toEqual({
      outcome: "invalid",
    });
  });

  it("an account that already owns the Zalo identity gets already_linked from consume", async () => {
    const web = await webUser();
    const zalo = await zaloUser();
    await ctx.owner.query(`UPDATE channel_identities SET person_id = $1 WHERE id = $2`, [
      web.personId,
      zalo.ciId,
    ]);
    const issued = await issueFor(zalo.ciId);
    expect(await linkZaloToAccount(ctx.appPool, issued.code, web.accountId, keys)).toEqual({
      outcome: "already_linked",
    });
  });
});

describe("linkZaloToAccount - refusals", () => {
  it("a Zalo person with a membership is requires_review: nothing moves, one audit row, no blocking list leaked", async () => {
    const web = await webUser();
    const zalo = await zaloUser();
    await ctx.owner.query(`INSERT INTO memberships (tenant_id, person_id) VALUES ($1, $2)`, [
      ctx.tenantA,
      zalo.personId,
    ]);
    const issued = await issueFor(zalo.ciId);
    const res = await linkZaloToAccount(ctx.appPool, issued.code, web.accountId, keys);
    expect(res).toEqual({ outcome: "requires_review" });
    expect(await ciPerson(zalo.ciId)).toBe(zalo.personId);
    expect((await personRow(zalo.personId)).status).toBe("active");
    expect(
      Number(
        (
          await ctx.owner.query(
            `SELECT count(*) AS n FROM merge_tombstones WHERE old_person_id = $1`,
            [zalo.personId],
          )
        ).rows[0].n,
      ),
    ).toBe(0);
    expect(await auditCount("identity.link_requires_review", web.accountId)).toBe(1);
    const detail = (
      await ctx.owner.query(
        `SELECT detail FROM routing_audit WHERE action = 'identity.link_requires_review' AND actor_id = $1`,
        [web.accountId],
      )
    ).rows[0].detail;
    expect(detail.blocking_tables).toContain("memberships.person_id");
  });

  it("a table added after 0054 that references persons blocks until it grants identity_definer its FK column, then counts rows (dynamic scan)", async () => {
    await ctx.owner.query(
      `CREATE TABLE zz_future_person_ref (id serial PRIMARY KEY, person_id uuid NOT NULL REFERENCES persons(id))`,
    );
    try {
      // No grant yet: unprovable, so even with ZERO rows the Person is not "empty".
      const web = await webUser();
      const zalo = await zaloUser();
      const issued = await issueFor(zalo.ciId);
      expect(await linkZaloToAccount(ctx.appPool, issued.code, web.accountId, keys)).toEqual({
        outcome: "requires_review",
      });
      expect(await blockingTables(web.accountId)).toContain("zz_future_person_ref.person_id");
      await expectNothingMoved(zalo);

      // The grant a later migration owes: now an empty Person links, and a row blocks again.
      await ctx.owner.query(`GRANT SELECT (person_id) ON zz_future_person_ref TO identity_definer`);
      const web2 = await webUser();
      const empty = await zaloUser();
      expect(
        await linkZaloToAccount(
          ctx.appPool,
          (await issueFor(empty.ciId)).code,
          web2.accountId,
          keys,
        ),
      ).toEqual({ outcome: "linked" });
      const web3 = await webUser();
      const used = await zaloUser();
      await ctx.owner.query(`INSERT INTO zz_future_person_ref (person_id) VALUES ($1)`, [
        used.personId,
      ]);
      expect(
        await linkZaloToAccount(
          ctx.appPool,
          (await issueFor(used.ciId)).code,
          web3.accountId,
          keys,
        ),
      ).toEqual({ outcome: "requires_review" });
      await expectNothingMoved(used);
    } finally {
      await ctx.owner.query(`DROP TABLE zz_future_person_ref`);
    }
  });

  it("a composite FK onto persons is unprovable even when readable and empty", async () => {
    await ctx.owner.query(
      `ALTER TABLE persons ADD CONSTRAINT zz_persons_id_status_key UNIQUE (id, status)`,
    );
    try {
      await ctx.owner.query(
        `CREATE TABLE zz_composite_person_ref (person_id uuid, person_status text,
           FOREIGN KEY (person_id, person_status) REFERENCES persons (id, status))`,
      );
      await ctx.owner.query(`GRANT SELECT ON zz_composite_person_ref TO identity_definer`);
      const web = await webUser();
      const zalo = await zaloUser();
      const issued = await issueFor(zalo.ciId);
      expect(await linkZaloToAccount(ctx.appPool, issued.code, web.accountId, keys)).toEqual({
        outcome: "requires_review",
      });
      expect(await blockingTables(web.accountId)).toContain("zz_composite_person_ref.person_id");
      await expectNothingMoved(zalo);
    } finally {
      await ctx.owner.query(`DROP TABLE IF EXISTS zz_composite_person_ref`);
      await ctx.owner.query(`ALTER TABLE persons DROP CONSTRAINT zz_persons_id_status_key`);
    }
  });

  it("a referencing table the definer cannot reach (no schema USAGE) fails closed: the call raises, nothing moves, no audit row", async () => {
    // The column grant makes the prediction say "provable", but schema USAGE is missing, so the
    // count itself is a read error. The definer has no exception handler: the call aborts whole.
    await ctx.owner.query(`CREATE SCHEMA zz_unreachable`);
    try {
      await ctx.owner.query(
        `CREATE TABLE zz_unreachable.person_ref (person_id uuid REFERENCES public.persons (id))`,
      );
      await ctx.owner.query(
        `GRANT SELECT (person_id) ON zz_unreachable.person_ref TO identity_definer`,
      );
      const web = await webUser();
      const zalo = await zaloUser();
      const issued = await issueFor(zalo.ciId);
      await expect(
        linkZaloToAccount(ctx.appPool, issued.code, web.accountId, keys),
      ).rejects.toMatchObject({ code: "42501" });
      await expectNothingMoved(zalo);
      expect(await auditCount("identity.link_requires_review", web.accountId)).toBe(0);
      expect(await auditCount("identity.link_reparented", web.accountId)).toBe(0);
    } finally {
      await ctx.owner.query(`DROP SCHEMA zz_unreachable CASCADE`);
    }
  });

  it("defence branch: an identity_definer without BYPASSRLS finds FORCE-RLS references unprovable and moves nothing", async () => {
    const web = await webUser();
    const zalo = await zaloUser();
    const issued = await issueFor(zalo.ciId);
    await ctx.owner.query(`UPDATE link_codes SET consumed_at = now() WHERE id = $1`, [
      issued.linkCodeId,
    ]);
    // ALTER ROLE is transactional: the drift exists only inside this rolled-back transaction, so no
    // other connection (or parallel test file) ever sees identity_definer without BYPASSRLS.
    await ctx.owner.query("BEGIN");
    try {
      await ctx.owner.query("ALTER ROLE identity_definer NOBYPASSRLS");
      const { rows } = await ctx.owner.query(
        `SELECT outcome FROM link_code_reparent_empty_person($1, $2)`,
        [issued.linkCodeId, web.accountId],
      );
      expect(rows[0].outcome).toBe("requires_review");
      expect(await blockingTables(web.accountId)).toContain("memberships.person_id");
    } finally {
      await ctx.owner.query("ROLLBACK");
    }
    await expectNothingMoved(zalo);
    const role = await ctx.owner.query(
      `SELECT rolbypassrls FROM pg_roles WHERE rolname = 'identity_definer'`,
    );
    expect(role.rows[0].rolbypassrls).toBe(true);
  });

  it("a source person that already owns an account is requires_review", async () => {
    const web = await webUser();
    const zalo = await zaloUser();
    await ctx.owner.query(`INSERT INTO accounts (person_id) VALUES ($1)`, [zalo.personId]);
    const issued = await issueFor(zalo.ciId);
    expect(await linkZaloToAccount(ctx.appPool, issued.code, web.accountId, keys)).toEqual({
      outcome: "requires_review",
    });
  });

  it("a second (revoked) identity on the source person blocks: channel_identities must count exactly 1", async () => {
    const web = await webUser();
    const zalo = await zaloUser();
    const extra = randomUUID();
    await ctx.owner.query(
      `INSERT INTO channel_identities
         (id, person_id, platform, platform_user_id_enc, platform_user_lookup_hash, status)
       VALUES ($1, $2, 'zalo', $3, $4, 'inactive')`,
      [extra, zalo.personId, Buffer.from("x"), `lw-${extra}`],
    );
    const issued = await issueFor(zalo.ciId);
    expect(await linkZaloToAccount(ctx.appPool, issued.code, web.accountId, keys)).toEqual({
      outcome: "requires_review",
    });
    expect(await ciPerson(zalo.ciId)).toBe(zalo.personId);
  });

  it("a person merged INTO the source (persons.merged_into_person_id self-reference) blocks", async () => {
    const web = await webUser();
    const zalo = await zaloUser();
    await ctx.owner.query(
      `INSERT INTO persons (display_name, status, merged_into_person_id) VALUES ('Old', 'merged', $1)`,
      [zalo.personId],
    );
    const issued = await issueFor(zalo.ciId);
    expect(await linkZaloToAccount(ctx.appPool, issued.code, web.accountId, keys)).toEqual({
      outcome: "requires_review",
    });
    const detail = (
      await ctx.owner.query(
        `SELECT detail FROM routing_audit WHERE action = 'identity.link_requires_review' AND actor_id = $1`,
        [web.accountId],
      )
    ).rows[0].detail;
    expect(detail.blocking_tables).toContain("persons.merged_into_person_id");
  });

  it("an account with no active person: consume's target raise is mapped to invalid", async () => {
    const zalo = await zaloUser();
    const orphan = (
      await ctx.owner.query(`INSERT INTO accounts (person_id) VALUES (NULL) RETURNING id`)
    ).rows[0].id as string;
    const issued = await issueFor(zalo.ciId);
    // consume's own target RAISE is the one 42501 mapped to the generic invalid.
    expect(await linkZaloToAccount(ctx.appPool, issued.code, orphan, keys)).toEqual({
      outcome: "invalid",
    });
  });

  it("any OTHER 42501 (a revoked EXECUTE grant) propagates instead of reading as an invalid code", async () => {
    const web = await webUser();
    const zalo = await zaloUser();
    const issued = await issueFor(zalo.ciId);
    // Committed (an uncommitted REVOKE is invisible to the app connection) and restored in finally;
    // the DB is private to this file and its tests run sequentially.
    const sig = "link_code_consume(text, bytea, uuid, uuid, interval)";
    try {
      await ctx.owner.query(`REVOKE EXECUTE ON FUNCTION ${sig} FROM app`);
      await expect(
        linkZaloToAccount(ctx.appPool, issued.code, web.accountId, keys),
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await ctx.owner.query(`GRANT EXECUTE ON FUNCTION ${sig} TO app`);
    }
  });

  it("an account-issued code is unsupported", async () => {
    const web = await webUser();
    const other = await webUser();
    const issued = await issueLinkCode(ctx.appPool, { accountId: other.accountId }, keys);
    expect(await linkZaloToAccount(ctx.appPool, issued.code, web.accountId, keys)).toEqual({
      outcome: "unsupported",
    });
  });

  it("unknown code and wrong tail are both invalid; the cap is rate_limited", async () => {
    const web = await webUser();
    const zalo = await zaloUser();
    const issued = await issueFor(zalo.ciId);
    expect(
      await linkZaloToAccount(ctx.appPool, formatLinkCode("0".repeat(18)), web.accountId, keys),
    ).toEqual({ outcome: "invalid" });
    const canonical = normalizeLinkCode(issued.code)!;
    const lookup = linkCodeLookupComponent(canonical);
    const wrong = lookup + "0".repeat(canonical.length - lookup.length);
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await linkZaloToAccount(ctx.appPool, wrong, web.accountId, keys, {
        cooldownSeconds: 0,
      });
      seen.push(r.outcome);
    }
    // attempts 1-4 are the generic invalid; the 5th reaches the cap; later ones hit a terminal row.
    expect(seen).toEqual(["invalid", "invalid", "invalid", "invalid", "rate_limited", "invalid"]);
    expect(await ciPerson(zalo.ciId)).toBe(zalo.personId);
  });

  it("definer refuses a stale consumed code (older than 10 minutes) and a non-consumed one", async () => {
    const web = await webUser();
    const zalo = await zaloUser();
    const issued = await issueFor(zalo.ciId);
    expect(await reparent(issued.linkCodeId, web.accountId)).toBe("invalid"); // not consumed yet
    await ctx.owner.query(
      `UPDATE link_codes SET consumed_at = now() - interval '11 minutes' WHERE id = $1`,
      [issued.linkCodeId],
    );
    expect(await reparent(issued.linkCodeId, web.accountId)).toBe("invalid");
    expect(await reparent(randomUUID(), web.accountId)).toBe("invalid");
    expect(await ciPerson(zalo.ciId)).toBe(zalo.personId);
  });

  it("a code consumed 9 minutes ago is still inside the 10 minute replay window and links", async () => {
    const web = await webUser();
    const zalo = await zaloUser();
    const issued = await issueFor(zalo.ciId);
    await ctx.owner.query(
      `UPDATE link_codes SET consumed_at = now() - interval '9 minutes' WHERE id = $1`,
      [issued.linkCodeId],
    );
    expect(await reparent(issued.linkCodeId, web.accountId)).toBe("consumed");
    expect(await ciPerson(zalo.ciId)).toBe(web.personId);
  });
});

describe("concurrency", () => {
  it("two simultaneous submits of one code: exactly one linked, never two tombstones", async () => {
    const web = await webUser();
    const zalo = await zaloUser();
    const issued = await issueFor(zalo.ciId);
    const results = await Promise.all([
      linkZaloToAccount(ctx.appPool, issued.code, web.accountId, keys),
      linkZaloToAccount(ctx.appPool, issued.code, web.accountId, keys),
    ]);
    const outcomes = results.map((r) => r.outcome).sort();
    expect(outcomes.filter((o) => o === "linked")).toHaveLength(1);
    expect(outcomes.filter((o) => o !== "linked")[0]).toMatch(/^(invalid|already_linked)$/);
    const n = await ctx.owner.query(
      `SELECT count(*) AS n FROM merge_tombstones WHERE old_person_id = $1`,
      [zalo.personId],
    );
    expect(Number(n.rows[0].n)).toBe(1);
  });

  it("two simultaneous definer calls on one consumed code: one consumed, one same_person", async () => {
    const web = await webUser();
    const zalo = await zaloUser();
    const issued = await issueFor(zalo.ciId);
    await ctx.owner.query(`UPDATE link_codes SET consumed_at = now() WHERE id = $1`, [
      issued.linkCodeId,
    ]);
    const out = await Promise.all([
      reparent(issued.linkCodeId, web.accountId),
      reparent(issued.linkCodeId, web.accountId),
    ]);
    expect(out.sort()).toEqual(["consumed", "same_person"]);
  });
});

/** app's own view of memberships for one person: tenant GUC set (SET LOCAL semantics) or none. */
async function appMembershipCount(personId: string, tenantId: string | null): Promise<number> {
  const c = await ctx.appPool.connect();
  try {
    await c.query("BEGIN");
    if (tenantId) await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    const { rows } = await c.query(
      `SELECT count(*)::int AS n FROM memberships WHERE person_id = $1`,
      [personId],
    );
    await c.query("COMMIT");
    return rows[0].n as number;
  } catch (error) {
    await c.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    c.release();
  }
}

describe("cross-tenant RLS is unchanged by the BYPASSRLS definer owner", () => {
  it("the definer counts a tenant-B membership (requires_review), while app reads it only inside tenant B and still cannot write across", async () => {
    const web = await webUser();
    const zalo = await zaloUser();
    await ctx.owner.query(`INSERT INTO memberships (tenant_id, person_id) VALUES ($1, $2)`, [
      ctx.tenantB,
      zalo.personId,
    ]);
    const issued = await issueFor(zalo.ciId);
    expect(await linkZaloToAccount(ctx.appPool, issued.code, web.accountId, keys)).toEqual({
      outcome: "requires_review",
    });
    await expectNothingMoved(zalo);

    // The bypass lives in the function owner only: app is still bound by tenant isolation.
    expect(await appMembershipCount(zalo.personId, ctx.tenantB)).toBe(1);
    expect(await appMembershipCount(zalo.personId, ctx.tenantA)).toBe(0);
    expect(await appMembershipCount(zalo.personId, null)).toBe(0);
    const c = await ctx.appPool.connect();
    try {
      await c.query("BEGIN");
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [ctx.tenantA]);
      await expect(
        c.query(`INSERT INTO memberships (tenant_id, person_id) VALUES ($1, $2)`, [
          ctx.tenantB,
          zalo.personId,
        ]),
      ).rejects.toThrow(/row-level security/i);
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
    const flags = await ctx.owner.query(
      `SELECT relrowsecurity AS rls, relforcerowsecurity AS force FROM pg_class
        WHERE oid = 'public.memberships'::regclass`,
    );
    expect(flags.rows[0]).toEqual({ rls: true, force: true });
  });
});

describe("0054 definer ACL and hardening", () => {
  const sig = "link_code_reparent_empty_person(uuid, uuid)";
  it("EXECUTE for app only; not PUBLIC, app_worker or readonly", async () => {
    const { rows } = await ctx.owner.query(
      `SELECT has_function_privilege('app', $1, 'EXECUTE') AS app,
              has_function_privilege('app_worker', $1, 'EXECUTE') AS worker,
              has_function_privilege('readonly', $1, 'EXECUTE') AS ro,
              has_function_privilege('public', $1, 'EXECUTE') AS pub`,
      [sig],
    );
    expect(rows[0]).toEqual({ app: true, worker: false, ro: false, pub: false });
  });
  it("is SECURITY DEFINER with a pinned search_path", async () => {
    const { rows } = await ctx.owner.query(
      `SELECT prosecdef, proconfig FROM pg_proc WHERE oid = $1::regprocedure`,
      [sig],
    );
    expect(rows[0].prosecdef).toBe(true);
    expect(rows[0].proconfig).toContain("search_path=pg_catalog, public, pg_temp");
  });

  it("is owned by identity_definer, which owns nothing else and keeps no schema CREATE", async () => {
    // pg_shdepend 'o' rows = every object a role owns: here (this database + shared objects) only
    // the function. Other test databases on the cluster own their own copy, hence the dbid filter.
    const owned = await ctx.owner.query(
      `SELECT pg_describe_object(d.classid, d.objid, d.objsubid) AS obj
         FROM pg_shdepend d
        WHERE d.refclassid = 'pg_authid'::regclass AND d.deptype = 'o'
          AND d.refobjid = 'identity_definer'::regrole
          AND d.dbid IN (0, (SELECT oid FROM pg_database WHERE datname = current_database()))`,
    );
    expect(owned.rows).toEqual([{ obj: "function link_code_reparent_empty_person(uuid,uuid)" }]);
    const { rows } = await ctx.owner.query(
      `SELECT has_schema_privilege('identity_definer', 'public', 'CREATE') AS can_create`,
    );
    expect(rows[0].can_create).toBe(false);
  });

  it("identity_definer is NOLOGIN BYPASSRLS NOINHERIT and unreachable from the runtime roles", async () => {
    const attrs = await ctx.owner.query(
      `SELECT rolsuper, rolcanlogin, rolbypassrls, rolinherit, rolcreaterole, rolcreatedb, rolreplication
         FROM pg_roles WHERE rolname = 'identity_definer'`,
    );
    expect(attrs.rows[0]).toEqual({
      rolsuper: false,
      rolcanlogin: false,
      rolbypassrls: true,
      rolinherit: false,
      rolcreaterole: false,
      rolcreatedb: false,
      rolreplication: false,
    });
    const reach = await ctx.owner.query(
      `SELECT r AS role, pg_has_role(r, 'identity_definer', 'MEMBER') AS member
         FROM unnest(ARRAY['app', 'app_worker', 'readonly']) AS r ORDER BY r`,
    );
    expect(reach.rows).toEqual([
      { role: "app", member: false },
      { role: "app_worker", member: false },
      { role: "readonly", member: false },
    ]);
    // ...and identity_definer itself inherits nothing: it is a member of no role.
    const memberOf = await ctx.owner.query(
      `SELECT count(*)::int AS n FROM pg_auth_members WHERE member = 'identity_definer'::regrole`,
    );
    expect(memberOf.rows[0].n).toBe(0);
    const app = await ctx.appPool.connect();
    try {
      await expect(app.query(`SET ROLE identity_definer`)).rejects.toMatchObject({
        code: "42501",
      });
    } finally {
      app.release();
    }
    // The function is the ONLY path: app holds no direct privilege on anything the definer touches.
    const direct = await ctx.owner.query(
      `SELECT t FROM unnest(ARRAY['persons', 'accounts', 'channel_identities', 'link_codes',
                                  'merge_audit', 'merge_tombstones', 'routing_audit']) AS t
        WHERE has_any_column_privilege('app', t, 'SELECT, INSERT, UPDATE, REFERENCES')
           OR has_table_privilege('app', t, 'DELETE, TRUNCATE, TRIGGER')`,
    );
    expect(direct.rows).toEqual([]);
  });

  it("can read the FK column of every single-column FK onto persons (a later migration owes its own grant)", async () => {
    const { rows } = await ctx.owner.query(
      `SELECT c.relname || '.' || a.attname AS fk
         FROM pg_constraint con
         JOIN pg_class c ON c.oid = con.conrelid
         JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
        WHERE con.contype = 'f' AND con.confrelid = 'public.persons'::regclass
          AND array_length(con.conkey, 1) = 1
          AND NOT has_column_privilege('identity_definer', c.oid, a.attnum, 'SELECT')`,
    );
    expect(rows).toEqual([]);
  });
});

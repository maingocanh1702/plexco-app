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

  it("a table that only exists in the future and references persons also blocks (dynamic scan)", async () => {
    await ctx.owner.query(
      `CREATE TABLE IF NOT EXISTS zz_future_person_ref (id serial PRIMARY KEY, person_id uuid NOT NULL REFERENCES persons(id))`,
    );
    const web = await webUser();
    const zalo = await zaloUser();
    await ctx.owner.query(`INSERT INTO zz_future_person_ref (person_id) VALUES ($1)`, [
      zalo.personId,
    ]);
    const issued = await issueFor(zalo.ciId);
    expect(await linkZaloToAccount(ctx.appPool, issued.code, web.accountId, keys)).toEqual({
      outcome: "requires_review",
    });
    expect((await personRow(zalo.personId)).status).toBe("active");
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
});

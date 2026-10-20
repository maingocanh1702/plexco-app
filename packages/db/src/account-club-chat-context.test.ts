import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { readMyClubChatContext } from "./me-player-reads.js";
import { seedPersonAccount, setupRlsTestContext, type RlsTestContext } from "./test-harness.js";

/**
 * Real-Postgres decision table for 0066 account_club_chat_context (Phase 3 lane L16c, readiness
 * section 3.1: rows D1-D13 are CC-1..CC-13; D14 is CC-14 in me-player-reads-nobypass.test.ts).
 * Runtime calls go through ctx.appPool (role `app`, NOBYPASSRLS); seeds and catalog inspection go
 * through ctx.owner. This suite migrates as a superuser, so the definer bypasses tenant RLS here and
 * isolation rests on its explicit tenant and person predicates. A deny is zero rows, never an error.
 */
let ctx: RlsTestContext;

beforeAll(async () => {
  ctx = await setupRlsTestContext("plexco_account_club_chat_context");
}, 180_000);
afterAll(async () => {
  await ctx?.teardown();
});

const FN = "public.account_club_chat_context(uuid, text)";

async function insertId(sql: string, params: unknown[]): Promise<string> {
  return (await ctx.owner.query<{ id: string }>(sql, params)).rows[0]!.id;
}

// A non-default zone proves the row carries the asked club's own tenants.timezone.
async function club(
  name: string,
  timezone = "Asia/Bangkok",
): Promise<{ id: string; slug: string }> {
  const slug = `cc-${randomUUID()}`;
  const sql = `INSERT INTO tenants (name, slug, timezone) VALUES ($1, $2, $3) RETURNING id`;
  return { id: await insertId(sql, [name, slug, timezone]), slug };
}

async function person(name: string): Promise<{ accountId: string; personId: string }> {
  return seedPersonAccount(ctx.owner, randomUUID(), { displayName: name });
}

async function member(tenantId: string, personId: string, status = "active"): Promise<string> {
  return insertId(
    `INSERT INTO memberships (tenant_id, person_id, display_name, status)
     VALUES ($1, $2, 'Alias Secret', $3) RETURNING id`,
    [tenantId, personId, status],
  );
}

async function chatContext(accountId: string | null, clubRef: string | null) {
  const { rows } = await ctx.appPool.query<{ tenant_id: string; timezone: string }>(
    `SELECT * FROM account_club_chat_context($1::uuid, $2::text)`,
    [accountId, clubRef],
  );
  return rows;
}

describe("0066 decision table (D1-D10)", () => {
  it("CC-1 (D1): an ACTIVE membership in the asked club is exactly one row, that club's tenant id and time zone", async () => {
    const t = await club("CC One");
    const a = await person("Alice One");
    await member(t.id, a.personId);
    expect(await chatContext(a.accountId, t.slug)).toEqual([
      { tenant_id: t.id, timezone: "Asia/Bangkok" },
    ]);
  });

  it("CC-2 (D2): a guest membership is zero rows", async () => {
    const t = await club("CC Two");
    const a = await person("Gina Guest");
    await member(t.id, a.personId, "guest");
    await member(t.id, (await person("Other Active")).personId);
    expect(await chatContext(a.accountId, t.slug)).toEqual([]);
  });

  it("CC-3 (D3): a left membership is zero rows", async () => {
    const t = await club("CC Three");
    const a = await person("Leo Left");
    await member(t.id, a.personId, "left");
    await member(t.id, (await person("Other Active")).personId);
    expect(await chatContext(a.accountId, t.slug)).toEqual([]);
  });

  it("CC-4 (D4): a merged membership is zero rows", async () => {
    const t = await club("CC Four");
    const a = await person("Meg Merged");
    await member(t.id, a.personId, "merged");
    await member(t.id, (await person("Other Active")).personId);
    expect(await chatContext(a.accountId, t.slug)).toEqual([]);
  });

  it("CC-5 (D5): no membership in an existing club is zero rows, even when active in another club", async () => {
    const t = await club("CC Five");
    const elsewhere = await club("CC Five Elsewhere");
    const a = await person("Nora None");
    await member(elsewhere.id, a.personId);
    await member(t.id, (await person("Other Active")).personId);
    expect(await chatContext(a.accountId, t.slug)).toEqual([]);
  });

  it("CC-6 (D6): an unknown well-formed slug and malformed slugs are zero rows each", async () => {
    const t = await club("CC Six");
    const a = await person("Uma Unknown");
    await member(t.id, a.personId);
    const slugs = [`cc-${randomUUID()}`, "Dev Club", "", "a".repeat(64), t.slug.toUpperCase()];
    for (const slug of slugs) {
      expect(await chatContext(a.accountId, slug), JSON.stringify(slug)).toEqual([]);
    }
  });

  it("CC-7 (D7): a NULL account and a NULL slug are zero rows each, never an error", async () => {
    const t = await club("CC Seven");
    const a = await person("Nils Null");
    await member(t.id, a.personId);
    await expect(chatContext(null, t.slug)).resolves.toEqual([]);
    await expect(chatContext(a.accountId, null)).resolves.toEqual([]);
    await expect(chatContext(null, null)).resolves.toEqual([]);
  });

  it("CC-8 (D8): a merged person, a deleted person, an account with no person and an unknown account are zero rows each", async () => {
    const t = await club("CC Eight");
    const merged = await person("Mia Merged");
    const survivor = await person("Sam Survivor");
    const deleted = await person("Dan Deleted");
    await member(t.id, merged.personId);
    await member(t.id, deleted.personId);
    await ctx.owner.query(
      `UPDATE persons SET status = 'merged', merged_into_person_id = $2 WHERE id = $1`,
      [merged.personId, survivor.personId],
    );
    await ctx.owner.query(`UPDATE persons SET status = 'deleted' WHERE id = $1`, [
      deleted.personId,
    ]);
    const noPerson = await insertId(
      `INSERT INTO accounts (person_id) VALUES (NULL) RETURNING id`,
      [],
    );
    for (const accountId of [merged.accountId, deleted.accountId, noPerson, randomUUID()]) {
      expect(await chatContext(accountId, t.slug), accountId).toEqual([]);
    }
  });

  it("CC-9 (D9): a person active in clubs X and Y gets only the asked club's row, never the other's", async () => {
    const x = await club("CC Nine X", "Asia/Bangkok");
    const y = await club("CC Nine Y", "Asia/Tokyo");
    const a = await person("Xena Two Clubs");
    await member(x.id, a.personId);
    await member(y.id, a.personId);
    expect(await chatContext(a.accountId, x.slug)).toEqual([
      { tenant_id: x.id, timezone: "Asia/Bangkok" },
    ]);
    expect(await chatContext(a.accountId, y.slug)).toEqual([
      { tenant_id: y.id, timezone: "Asia/Tokyo" },
    ]);
  });

  it("CC-10 (D10): the caller's app.tenant_id, unset or set to another tenant, reads back unchanged after a hit and after each deny", async () => {
    const t = await club("CC Ten");
    const other = await club("CC Ten Other");
    const a = await person("Ada Guc");
    await member(t.id, a.personId);
    const denied: string[] = [];
    for (const status of ["guest", "left", "merged"]) {
      const p = await person(`Guc ${status}`);
      await member(t.id, p.personId, status);
      denied.push(p.accountId);
    }
    const gone = await person("Dee Deleted");
    await member(t.id, gone.personId);
    await ctx.owner.query(`UPDATE persons SET status = 'deleted' WHERE id = $1`, [gone.personId]);
    // every exit of the function: the hit, the zero-row read after set_config (guest, left, merged,
    // no membership) and the two early returns before it (no tenant for the slug, no active person)
    const calls: Array<[string | null, string | null, number]> = [
      [a.accountId, t.slug, 1],
      ...denied.map((id): [string, string, number] => [id, t.slug, 0]),
      [a.accountId, other.slug, 0],
      [a.accountId, `cc-${randomUUID()}`, 0],
      [a.accountId, "Dev Club", 0],
      [a.accountId, null, 0],
      [null, t.slug, 0],
      [gone.accountId, t.slug, 0],
      [randomUUID(), t.slug, 0],
    ];
    const c = await ctx.appPool.connect();
    const guc = async () =>
      (
        await c.query<{ v: string }>(
          `SELECT coalesce(current_setting('app.tenant_id', true), '') AS v`,
        )
      ).rows[0]!.v;
    try {
      for (const prev of ["", other.id]) {
        await c.query("BEGIN");
        if (prev) await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [prev]);
        expect(await guc()).toBe(prev);
        for (const [accountId, slug, n] of calls) {
          const r = await c.query(`SELECT * FROM account_club_chat_context($1::uuid, $2::text)`, [
            accountId,
            slug,
          ]);
          expect(r.rows, `${accountId} ${slug}`).toHaveLength(n);
          expect(await guc(), `${accountId} ${slug}`).toBe(prev);
        }
        await c.query("ROLLBACK");
      }
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  });
});

describe("0066 catalog and shape (D11-D13)", () => {
  it("CC-11 (D11): one SECURITY DEFINER plpgsql VOLATILE function, args (p_account_id uuid, p_club_ref text), pinned search_path, owned like person_profile_read", async () => {
    const { rows } = await ctx.owner.query(
      `SELECT p.prosecdef, p.provolatile, p.proconfig, l.lanname,
              pg_get_function_identity_arguments(p.oid) AS args, pg_get_userbyid(p.proowner) AS owner
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         JOIN pg_language l ON l.oid = p.prolang
        WHERE n.nspname = 'public' AND p.proname = 'account_club_chat_context'`,
    );
    const ref = await ctx.owner.query<{ owner: string }>(
      `SELECT pg_get_userbyid(proowner) AS owner FROM pg_proc WHERE proname = 'person_profile_read'`,
    );
    expect(rows).toEqual([
      {
        prosecdef: true,
        provolatile: "v",
        lanname: "plpgsql",
        args: "p_account_id uuid, p_club_ref text",
        owner: ref.rows[0]!.owner,
        proconfig: ["search_path=pg_catalog, public, pg_temp"],
      },
    ]);
  });

  it("CC-12 (D12): EXECUTE is revoked from PUBLIC and held by exactly the owner and app (no app_worker, readonly or other role)", async () => {
    const { rows } = await ctx.owner.query<{ owner: string; execute_grantees: string[] }>(
      `SELECT has_function_privilege('app', $1::text, 'EXECUTE') AS app,
              has_function_privilege('app_worker', $1::text, 'EXECUTE') AS worker,
              has_function_privilege('readonly', $1::text, 'EXECUTE') AS ro,
              p.proacl IS NOT NULL AS explicit_acl,
              EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0) AS public_grant,
              pg_get_userbyid(p.proowner)::text AS owner,
              ARRAY(SELECT (CASE WHEN a.grantee = 0 THEN 'PUBLIC'
                                 ELSE pg_get_userbyid(a.grantee) END)::text
                      FROM aclexplode(p.proacl) a
                     WHERE a.privilege_type = 'EXECUTE') AS execute_grantees
         FROM pg_proc p WHERE p.oid = $1::text::regprocedure`,
      [FN],
    );
    const { owner, execute_grantees: grantees, ...flags } = rows[0]!;
    // the exact grantee set, owner derived from proowner: a stray GRANT EXECUTE to any role fails
    expect([...grantees].sort()).toEqual([owner, "app"].sort());
    expect(flags).toEqual({
      app: true,
      worker: false,
      ro: false,
      explicit_acl: true,
      public_grant: false,
    });
  });

  it("CC-13 (D13): the result is exactly (tenant_id uuid, timezone text) and the body names no tenant_admins, display_name, phone, pay_code or _enc column", async () => {
    const t = await club("CC Thirteen");
    const a = await person("Tia Thirteen");
    await member(t.id, a.personId);
    const [row] = await chatContext(a.accountId, t.slug);
    expect(Object.keys(row!).sort()).toEqual(["tenant_id", "timezone"]);
    const { rows } = await ctx.owner.query<{ result: string; src: string }>(
      `SELECT pg_get_function_result(p.oid) AS result, p.prosrc AS src
         FROM pg_proc p WHERE p.oid = $1::text::regprocedure`,
      [FN],
    );
    expect(rows[0]!.result).toBe("TABLE(tenant_id uuid, timezone text)");
    expect(rows[0]!.src).not.toMatch(/tenant_admins|display_name|phone|pay_code|_enc/i);
  });
});

// Readiness section 4, the typed wrapper (CW-1, CW-2 real DB; CW-3, CW-4 pg-shaped stubs).
describe("readMyClubChatContext wrapper (CW-1..CW-4)", () => {
  it("CW-1: an active member gets exactly {tenantId, timezone} of the asked club", async () => {
    const t = await club("CW One", "Asia/Tokyo");
    const a = await person("Cara One");
    await member(t.id, a.personId);
    expect(await readMyClubChatContext(ctx.appPool, a.accountId, t.slug)).toStrictEqual({
      tenantId: t.id,
      timezone: "Asia/Tokyo",
    });
  });

  it("CW-2: a deny is null, for a guest membership and an unknown slug alike", async () => {
    const t = await club("CW Two");
    const a = await person("Cara Two");
    await member(t.id, a.personId, "guest");
    expect(await readMyClubChatContext(ctx.appPool, a.accountId, t.slug)).toBeNull();
    expect(await readMyClubChatContext(ctx.appPool, a.accountId, `cc-${randomUUID()}`)).toBeNull();
  });

  it("CW-3: more than one row fails closed, naming neither the account nor the slug", async () => {
    const accountId = randomUUID();
    const clubRef = `cc-${randomUUID()}`;
    const rows = [
      { tenant_id: randomUUID(), timezone: "Asia/Bangkok" },
      { tenant_id: randomUUID(), timezone: "Asia/Tokyo" },
    ];
    const pool = { query: async () => ({ rows }) } as unknown as pg.Pool;
    const error = await readMyClubChatContext(pool, accountId, clubRef).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain(accountId);
    expect((error as Error).message).not.toContain(clubRef);
  });

  it("CW-4: one query with exactly the pinned SQL and [accountId, clubRef]", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const accountId = randomUUID();
    const clubRef = `cc-${randomUUID()}`;
    await readMyClubChatContext({ query } as unknown as pg.Pool, accountId, clubRef);
    expect(query.mock.calls).toEqual([
      [
        "SELECT c.tenant_id, c.timezone FROM public.account_club_chat_context($1, $2) c",
        [accountId, clubRef],
      ],
    ]);
  });
});

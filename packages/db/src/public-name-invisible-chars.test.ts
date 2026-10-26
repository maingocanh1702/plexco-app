/**
 * L23 (DD-138 owner sign-off A.1, "#61 R1-5 ... REJECTED"): the SQL layer of migration 0068
 * (docs/sessions/web-mvp-phase3-readiness-p3-public-name-invisible-chars.md, sections 4-6).
 *   PS-PIN  public_name_strip_invisible strips a code point exactly when STRIP_CHAR_RANGES (the one
 *           TypeScript list, text-safety.ts) holds it, over every code point, and changes nothing else.
 *   MG-*    the one-time cleanup (D5-D8), read from 0068 between its two L23-CLEANUP marker lines and
 *           run again inside a transaction that is always rolled back, on a fixture of each class.
 *   D11     the emoji consequence of the owner rule at the SQL layer: stated, no exception.
 *   PS-ACL  the helper's catalog contract (D9): attributes, owned like its SECURITY DEFINER caller,
 *           EXECUTE for that owner only.
 *   PS-OWNER-REPAIR  0068's block between its two L23-OWNER marker lines gives a helper whose owner
 *           drifted the definer's owner back, with both owners first moved off the runner (the
 *           harness migrates as it queries), inside a transaction that is always rolled back.
 * Inputs are built from code points (String.fromCodePoint), never pasted.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupRlsTestContext, type RlsTestContext } from "./test-harness.js";
import { STRIP_CHAR_RANGES, stripInvisibleChars } from "./text-safety.js";

type Row = Record<string, unknown>;
let ctx: RlsTestContext;
const ch = (...codePoints: number[]) => String.fromCodePoint(...codePoints);
const cps = (s: string) => [...s].map((c) => c.codePointAt(0)!);

/** A 0068 DO block: the text between its two L23-<name> marker lines, each present exactly once. */
function markedBlock(name: "CLEANUP" | "OWNER"): string {
  const text = readFileSync(
    fileURLToPath(new URL("../migrations/0068_public_name_invisible_chars.sql", import.meta.url)),
    "utf8",
  );
  const begin = `\n-- L23-${name}-BEGIN\n`;
  const end = `\n-- L23-${name}-END`;
  const from = text.indexOf(begin);
  const to = text.indexOf(end);
  if (from < 0 || to < from || text.includes(begin, from + 1) || text.includes(end, to + 1)) {
    throw new Error(`0068: expected one L23-${name}-BEGIN line, then one L23-${name}-END line`);
  }
  return text.slice(from + begin.length, to);
}
const CLEANUP = markedBlock("CLEANUP");
const OWNER_REPAIR = markedBlock("OWNER");

const HELPER = `'public.public_name_strip_invisible(text)'::regprocedure`;
const DEFINER = `'public.tenant_public_alias_set(uuid, uuid, text)'::regprocedure`;

/** The helper's owner and ACL against its one SECURITY DEFINER caller; a NULL ACL reads as the default (PUBLIC). */
async function helperOwnership(c: pg.ClientBase): Promise<Row> {
  const { rows } = await c.query<Row>(
    `SELECT pg_get_userbyid(h.proowner)::text AS owner,
            h.proowner = d.proowner AS same_owner,
            ARRAY(SELECT a.privilege_type
                    FROM aclexplode(coalesce(h.proacl, acldefault('f', h.proowner))) a
                   WHERE a.grantee = h.proowner) AS owner_privileges,
            ARRAY(SELECT CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END
                    FROM aclexplode(coalesce(h.proacl, acldefault('f', h.proowner))) a
                   WHERE a.grantee <> h.proowner) AS other_grantees
       FROM pg_proc h, pg_proc d
      WHERE h.oid = ${HELPER} AND d.oid = ${DEFINER}`,
  );
  return rows[0]!;
}

// Stored values as they could exist at the base: R1-5 allowed variation selectors and unassigned
// default-ignorables; U+200B stands for a legacy or direct write.
const DIRTY = {
  area: "Quan" + ch(0xfe00) + " 7" + ch(0x2065),
  venue: "San" + ch(0x200b) + " Cau Long B" + ch(0xe0100),
  address: "5 Le Loi" + ch(0xfe0f, 0x2065),
  approved: "CLB Cau Long " + ch(0x2764, 0xfe0f),
  pending: "Smash Club " + ch(0x2065), // the trim after the strip removes the space it uncovers
  blankAlias: ch(0xfe0f, 0xe0100),
  blankArea: ch(0x200b, 0xfe0f),
  blankVenue: ch(0x3164),
};

/** fn on one superuser connection, inside a transaction that is always rolled back. */
async function rolledBack(fn: (c: pg.PoolClient) => Promise<void>): Promise<void> {
  const c = await ctx.superuserDb.pool.connect();
  try {
    await c.query("BEGIN");
    await fn(c);
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
}

/** Runs the cleanup on c and returns the NOTICE messages it raised. */
async function runCleanup(c: pg.PoolClient): Promise<string[]> {
  const notices: string[] = [];
  const onNotice = (n: { message?: string | undefined }) => notices.push(n.message ?? "");
  c.on("notice", onNotice);
  try {
    await c.query(CLEANUP);
  } finally {
    c.off("notice", onNotice);
  }
  return notices;
}

/** The R6 fixture: one club (clean approved alias) hosting every session; each class once. */
async function seed(c: pg.PoolClient) {
  const tenant = async (alias: string, status: string) =>
    (
      await c.query<{ id: string }>(
        `INSERT INTO tenants (name, slug, public_alias, public_alias_status) VALUES ($1, $2, $3, $4) RETURNING id`,
        [`L23 Club ${randomUUID()}`, `l23-${randomUUID()}`, alias, status],
      )
    ).rows[0]!.id;
  const club = await tenant("Hanoi Smash", "approved");
  const session = async (
    area: string,
    venueName: string,
    venueAddress: string,
    visibility = "public",
  ) =>
    (
      await c.query<{ id: string }>(
        `INSERT INTO sessions (tenant_id, sport_id, starts_at, ends_at, timezone, venue_name, venue_address, area,
           price_amount, slots_max, visibility, join_policy, status)
         VALUES ($1, $2, now() + interval '7 days', now() + interval '7 days 2 hours', 'Asia/Ho_Chi_Minh',
           $3, $4, $5, 50000, 10, $6, 'open', 'open')
         RETURNING id`,
        [club, ctx.badmintonSportId, venueName, venueAddress, area, visibility],
      )
    ).rows[0]!.id;
  const f = {
    club,
    approved: await tenant(DIRTY.approved, "approved"),
    pending: await tenant(DIRTY.pending, "pending"),
    blankAlias: await tenant(DIRTY.blankAlias, "pending"),
    area: await session(DIRTY.area, "San Cau Long A", "1 Public Street"),
    venue: await session("Quan 1", DIRTY.venue, "2 Public Street"),
    clean: await session("Quan 3", "San Cau Long C", "3 Public Street"),
    address: await session("Quan 5", "San Cau Long D", DIRTY.address),
    blank: await session(DIRTY.blankArea, DIRTY.blankVenue, "9 Private Street", "private"),
  };
  for (const id of [f.area, f.venue, f.clean, f.address]) {
    const { rows } = await c.query<{ d: string }>(
      `SELECT public_sessions_project_session($1, NULL) AS d`,
      [id],
    );
    expect(rows[0]!.d).toBe("upserted");
  }
  return f;
}

const one = async (c: pg.PoolClient, sql: string, id: string) =>
  (await c.query<Row>(sql, [id])).rows[0];
const stored = (c: pg.PoolClient, id: string) =>
  one(
    c,
    `SELECT ctid::text AS ctid, area, venue_name, venue_address FROM sessions WHERE id = $1`,
    id,
  );
const projected = (c: pg.PoolClient, id: string) =>
  one(
    c,
    `SELECT area, venue_name, venue_address, public_projection_version::int AS version
       FROM public_sessions WHERE id = $1`,
    id,
  );
const alias = (c: pg.PoolClient, id: string) =>
  one(
    c,
    `SELECT ctid::text AS ctid, public_alias, public_alias_status FROM tenants WHERE id = $1`,
    id,
  );
const leftUnchanged = (f: Awaited<ReturnType<typeof seed>>) => [
  `0068 cleanup: session ${f.blank} area left unchanged (no visible character after the strip)`,
  `0068 cleanup: session ${f.blank} venue_name left unchanged (no visible character after the strip)`,
  `0068 cleanup: tenant ${f.blankAlias} public alias left unchanged (no visible character after the strip)`,
];

beforeAll(async () => {
  ctx = await setupRlsTestContext("plexco_public_name_invisible_chars");
}, 120_000);
afterAll(async () => {
  await ctx?.teardown();
});

describe("PS-PIN: the 0068 helper strips exactly the TypeScript list", () => {
  it("over U+0001..U+10FFFF (surrogates excluded) it removes 4162 code points, those of STRIP_CHAR_RANGES, and alters none", async () => {
    const { rows } = await ctx.owner.query<Row>(
      `WITH r AS (SELECT * FROM unnest($1::int[], $2::int[]) AS r(f, l)),
            cp AS (
              SELECT n, public.public_name_strip_invisible(chr(n)) AS out,
                     EXISTS (SELECT 1 FROM r WHERE n BETWEEN r.f AND r.l) AS listed
                FROM generate_series(1, 1114111) AS n
               WHERE n NOT BETWEEN 55296 AND 57343)
       SELECT count(*) FILTER (WHERE out = '')::int AS stripped,
              coalesce((array_agg(n ORDER BY n) FILTER (WHERE (out = '') <> listed))[1:10], '{}') AS mismatched,
              count(*) FILTER (WHERE out NOT IN ('', chr(n)))::int AS altered
         FROM cp`,
      [STRIP_CHAR_RANGES.map(([first]) => first), STRIP_CHAR_RANGES.map(([, last]) => last)],
    );
    expect(rows[0]).toEqual({ stripped: 4162, mismatched: [], altered: 0 });
  }, 120_000);
});

describe("D11 at the SQL layer: U+200D and U+FE0F are stripped inside emoji too (the owner rule as written)", () => {
  it.each([
    { name: "a VS16 heart becomes the text heart", input: [0x2764, 0xfe0f], left: [0x2764] },
    {
      name: "a ZWJ family splits into its three emoji",
      input: [0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467],
      left: [0x1f468, 0x1f469, 0x1f467],
    },
  ])("$name", async ({ input, left }) => {
    const { rows } = await ctx.owner.query<{ out: string }>(
      `SELECT public.public_name_strip_invisible($1) AS out`,
      [ch(...input)],
    );
    expect(cps(rows[0]!.out)).toEqual(left);
    expect(cps(stripInvisibleChars(ch(...input)))).toEqual(left); // the TypeScript layer agrees
  });
});

describe("PS-ACL (D9): the helper's catalog contract", () => {
  it("LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE, SECURITY INVOKER, search_path=pg_catalog, pg_temp; owned like its definer caller, not by job_definer; EXECUTE for that owner only", async () => {
    const { rows } = await ctx.owner.query<Row>(
      `SELECT l.lanname::text AS language, h.provolatile AS volatility, h.proisstrict AS strict,
              h.proparallel AS parallel, h.prosecdef AS security_definer, h.proconfig AS config,
              pg_get_userbyid(h.proowner) <> 'job_definer' AS not_job_definer,
              has_function_privilege('app', h.oid, 'EXECUTE') AS app,
              has_function_privilege('app_worker', h.oid, 'EXECUTE') AS app_worker,
              has_function_privilege('readonly', h.oid, 'EXECUTE') AS readonly,
              has_function_privilege(d.proowner, h.oid, 'EXECUTE') AS definer_owner
         FROM pg_proc h JOIN pg_language l ON l.oid = h.prolang, pg_proc d
        WHERE h.oid = ${HELPER} AND d.oid = ${DEFINER}`,
    );
    expect(rows[0]).toEqual({
      language: "sql",
      volatility: "i",
      strict: true,
      parallel: "s",
      security_definer: false,
      config: ["search_path=pg_catalog, pg_temp"],
      not_job_definer: true,
      app: false,
      app_worker: false,
      readonly: false,
      definer_owner: true,
    });
    // The owner's own EXECUTE entry: has_function_privilege alone is vacuous for a superuser owner.
    expect(await helperOwnership(ctx.owner)).toMatchObject({
      same_owner: true,
      owner_privileges: ["EXECUTE"],
      other_grantees: [],
    });
  });
});

describe("PS-OWNER-REPAIR: the 0068 owner block gives the helper its definer caller's owner", () => {
  it("with the definer moved to app_worker and the helper to readonly, the block gives the helper app_worker (the definer's owner, not the runner), its owner-only ACL moving with it; a second run changes nothing", async () => {
    await rolledBack(async (c) => {
      // The harness migrates and queries as one superuser, so the definer's owner is normally the
      // runner and a block that took CURRENT_USER would pass unseen: move both owners off the runner.
      await c.query(
        `ALTER FUNCTION public.tenant_public_alias_set(uuid, uuid, text) OWNER TO app_worker`,
      );
      await c.query(`ALTER FUNCTION public.public_name_strip_invisible(text) OWNER TO readonly`);
      const { rows } = await c.query<Row>(
        `SELECT pg_get_userbyid(d.proowner)::text AS definer_owner,
                pg_get_userbyid(d.proowner) NOT IN (session_user, current_user) AS definer_not_runner,
                pg_get_userbyid(h.proowner) NOT IN (session_user, current_user) AS helper_not_runner
           FROM pg_proc h, pg_proc d
          WHERE h.oid = ${HELPER} AND d.oid = ${DEFINER}`,
      );
      expect(rows[0]).toEqual({
        definer_owner: "app_worker",
        definer_not_runner: true,
        helper_not_runner: true,
      });
      expect(await helperOwnership(c)).toEqual({
        owner: "readonly",
        same_owner: false,
        owner_privileges: ["EXECUTE"],
        other_grantees: [],
      });
      await c.query(OWNER_REPAIR);
      const repaired = await helperOwnership(c);
      expect(repaired).toEqual({
        owner: "app_worker",
        same_owner: true,
        owner_privileges: ["EXECUTE"],
        other_grantees: [],
      });
      await c.query(OWNER_REPAIR); // the normal case: owners already match
      expect(await helperOwnership(c)).toEqual(repaired);
    });
  });
});

describe("0068 cleanup on a fixture holding each class (R6, D5-D7), rolled back", () => {
  it("MG-area-R6: a public session's area loses its STRIP code points and its public row is re-projected", async () => {
    await rolledBack(async (c) => {
      const f = await seed(c);
      // The projector refuses any isolation but READ COMMITTED (0067:234): the server default holds.
      expect((await c.query(`SHOW transaction_isolation`)).rows[0]).toEqual({
        transaction_isolation: "read committed",
      });
      expect(await projected(c, f.area)).toMatchObject({ area: DIRTY.area, version: 1 });
      await runCleanup(c);
      expect(await stored(c, f.area)).toMatchObject({
        area: "Quan 7",
        venue_name: "San Cau Long A",
      });
      expect(await projected(c, f.area)).toMatchObject({
        area: "Quan 7",
        venue_name: "San Cau Long A",
        version: 2,
      });
    });
  });

  it("MG-venue-R6: a public session's venue_name loses its STRIP code points and its public row is re-projected", async () => {
    await rolledBack(async (c) => {
      const f = await seed(c);
      expect(await projected(c, f.venue)).toMatchObject({ venue_name: DIRTY.venue, version: 1 });
      await runCleanup(c);
      expect(await stored(c, f.venue)).toMatchObject({
        area: "Quan 1",
        venue_name: "San Cau Long B",
      });
      expect(await projected(c, f.venue)).toMatchObject({
        area: "Quan 1",
        venue_name: "San Cau Long B",
        version: 2,
      });
    });
  });

  it("MG-alias-R6: approved and pending aliases are stripped then trimmed, keep their status, one NOTICE per tenant id, no audit row, no event", async () => {
    await rolledBack(async (c) => {
      const f = await seed(c);
      const counts = async () =>
        (
          await c.query<Row>(
            `SELECT (SELECT count(*)::int FROM tenant_public_alias_audit) AS audits,
                    (SELECT count(*)::int FROM outbox_events WHERE aggregate_type = 'tenant') AS events`,
          )
        ).rows[0];
      const before = await counts();
      const notices = await runCleanup(c);
      expect(await alias(c, f.approved)).toMatchObject({
        public_alias: "CLB Cau Long " + ch(0x2764),
        public_alias_status: "approved",
      });
      expect(await alias(c, f.pending)).toMatchObject({
        public_alias: "Smash Club",
        public_alias_status: "pending",
      });
      expect(notices.filter((n) => n.endsWith("status kept")).sort()).toEqual(
        [f.approved, f.pending]
          .map((id) => `0068 cleanup: tenant ${id} public alias stripped, status kept`)
          .sort(),
      );
      expect(await counts()).toEqual(before);
    });
  });

  it("MG-blank (D7): a value with no visible character after the strip stays unchanged, one NOTICE each", async () => {
    await rolledBack(async (c) => {
      const f = await seed(c);
      const session = await stored(c, f.blank);
      const tenant = await alias(c, f.blankAlias);
      expect(session).toMatchObject({ area: DIRTY.blankArea, venue_name: DIRTY.blankVenue });
      const notices = await runCleanup(c);
      expect(await stored(c, f.blank)).toEqual(session); // same ctid: not even rewritten
      expect(await alias(c, f.blankAlias)).toEqual(tenant);
      expect(notices.filter((n) => n.endsWith("after the strip)")).sort()).toEqual(
        leftUnchanged(f).sort(),
      );
    });
  });

  it("a clean row and venue_address (out of scope) are not written, re-projected or reported; the summary counts are exact", async () => {
    await rolledBack(async (c) => {
      const f = await seed(c);
      const state = async () => [
        await stored(c, f.clean),
        await stored(c, f.address),
        await alias(c, f.club),
        await projected(c, f.clean),
        await projected(c, f.address),
      ];
      const before = await state();
      expect(before[1]).toMatchObject({ venue_address: DIRTY.address });
      expect(before[4]).toMatchObject({ venue_address: DIRTY.address, version: 1 });
      const notices = await runCleanup(c);
      expect(await state()).toEqual(before);
      expect(notices.sort()).toEqual(
        [
          ...leftUnchanged(f),
          `0068 cleanup: tenant ${f.approved} public alias stripped, status kept`,
          `0068 cleanup: tenant ${f.pending} public alias stripped, status kept`,
          "0068 cleanup: 2 sessions changed, 2 re-projected, 2 public aliases changed, 3 values left unchanged",
        ].sort(),
      );
    });
  });

  it("a second run changes nothing and reports only the D7 values again", async () => {
    await rolledBack(async (c) => {
      const f = await seed(c);
      await runCleanup(c);
      const notices = await runCleanup(c);
      expect(notices.sort()).toEqual(
        [
          ...leftUnchanged(f),
          "0068 cleanup: 0 sessions changed, 0 re-projected, 0 public aliases changed, 3 values left unchanged",
        ].sort(),
      );
      expect(await projected(c, f.area)).toMatchObject({ area: "Quan 7", version: 2 });
      expect(await projected(c, f.venue)).toMatchObject({
        venue_name: "San Cau Long B",
        version: 2,
      });
    });
  });
});

describe("MG-guard (D8): the cleanup fails closed under row security", () => {
  it("as app (NOSUPERUSER NOBYPASSRLS) on a non-empty sessions table it raises 42501 before any write", async () => {
    await rolledBack(async (c) => {
      await seed(c);
      await c.query("SET LOCAL ROLE app");
      expect(
        (
          await c.query<Row>(
            `SELECT r.rolsuper, r.rolbypassrls, row_security_active('public.sessions') AS rls,
                    pg_relation_size('public.sessions') > 0 AS nonempty
               FROM pg_roles r WHERE r.rolname = current_user`,
          )
        ).rows[0],
      ).toEqual({ rolsuper: false, rolbypassrls: false, rls: true, nonempty: true });
      const err = await c.query(CLEANUP).then(
        () => null,
        (e: unknown) => e as { code?: string; message?: string },
      );
      // The message pins the guard: a missing EXECUTE on the helper would also be 42501.
      expect(err).toMatchObject({
        code: "42501",
        message:
          "0068 cleanup: row security applies to app and sessions or tenants holds rows it may not see; apply 0068 as the superuser migration role",
      });
    });
  });
});

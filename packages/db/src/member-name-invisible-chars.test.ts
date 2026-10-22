/**
 * L27 (owner decision item 6, 2026-10-22): the SQL layer of migration 0069 for the member-facing names
 * (docs/sessions/web-mvp-phase3-readiness-p3-strip-invisible-member-names.md, sections 6, 7, 10 and 11),
 * over the seven definers 0069 re-creates (P1-P4 persons.display_name, M2 memberships.display_name,
 * T1-T2 tenants.name).
 *   MN        rows R1-R5 of the section 6 decision table per definer, each called the way its
 *             TypeScript caller calls it, as role `app`; ctx.owner seeds and reads the stored value.
 *   RC-BODY   each live body is its previous CREATE's with exactly the section 10 substitution.
 *   RC-ACL    each keeps its previous CREATE's attributes, the helper's owner and EXECUTE for app only.
 *   RC-OWNER  the 0069 L27-OWNER-CHECK block passes as applied and raises 42501 once any one of the
 *             seven has another owner, rolled back.
 *   MG        (unit U2c) the 0069 L27-CLEANUP block replayed on fixtures, rolled back.
 * Inputs are built from code points (String.fromCodePoint), never pasted.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupRlsTestContext, type RlsTestContext } from "./test-harness.js";
import { withTenant } from "./tenant.js";
import { resolveZaloIdentity } from "./zalo-ingress.js";

let ctx: RlsTestContext;
/** Visible ASCII parts as strings, every other code point as a number. */
const mix = (...parts: (string | number)[]) =>
  parts.map((p) => (typeof p === "number" ? String.fromCodePoint(p) : p)).join("");
const cps = (s: string | null) => (s === null ? null : [...s].map((c) => c.codePointAt(0)!));
const hex = (cp: number) => cp.toString(16).toUpperCase().padStart(4, "0");

type ErrorChain = { code?: unknown; cause?: unknown } | undefined;
/** The first SQLSTATE on the error's cause chain (drizzle wraps the pg error); rethrows when none. */
function sqlstate(error: unknown): string {
  for (let e = error as ErrorChain; e; e = e.cause as ErrorChain) {
    if (typeof e.code === "string" && /^[0-9A-Z]{5}$/.test(e.code)) return e.code;
  }
  throw error;
}

const SEED = "Web";
let host: string; // an active web admin of tenant A: the actor create_host_added_person checks
let bot: string; // a Zalo bot of tenant A: the bot zalo_identity_resolve checks

async function insertPerson(name: string | null): Promise<string> {
  const { rows } = await ctx.owner.query<{ id: string }>(
    `INSERT INTO persons (display_name) VALUES ($1) RETURNING id`,
    [name],
  );
  return rows[0]!.id;
}
async function nameOf(personId: string): Promise<string | null> {
  const { rows } = await ctx.owner.query<{ display_name: string | null }>(
    `SELECT display_name FROM persons WHERE id = $1`,
    [personId],
  );
  return rows[0]!.display_name;
}
async function personCount(): Promise<number> {
  const { rows } = await ctx.owner.query<{ n: number }>(`SELECT count(*)::int AS n FROM persons`);
  return rows[0]!.n;
}

beforeAll(async () => {
  ctx = await setupRlsTestContext("plexco_member_name_invisible_chars");
  host = await insertPerson(`host-${randomUUID()}`);
  await ctx.owner.query(
    `INSERT INTO tenant_admins (tenant_id, platform, platform_user_lookup_hash, role, active)
     VALUES ($1, 'web', $2, 'owner', true)`,
    [ctx.tenantA, host],
  );
  bot = randomUUID();
  // The zalo-ingress.test.ts fixture: the bot is registered through its own definer, as `app`.
  await withTenant(ctx.appDb.db, ctx.tenantA, (tx) =>
    tx.execute(
      sql`SELECT bot_id FROM zalo_bot_upsert_for_tenant(
            ${ctx.tenantA}::uuid, ${host}::uuid, ${bot}::uuid, 'enc-token', ${`wh-${randomUUID()}`},
            ${Buffer.from("secret-enc", "utf8")}, 'local', 'connecting')`,
    ),
  );
}, 120_000);
afterAll(async () => {
  await ctx?.teardown();
});

/** A writer's verdict: the stored name as code points, or the SQLSTATE raised and whether nothing was written. */
type Outcome = { stored: number[] | null } | { code: string; untouched: boolean };
interface Writer {
  name: string;
  /** R3: today's empty-value behaviour, refused with 22023 or stored as NULL. */
  empty: "refuse" | "null";
  /** R4: a control, bidi, line-separator or U+2800 character is refused, or stored as sent (O1). */
  r4: "refuse" | "keep";
  call: (input: string) => Promise<Outcome>;
}

const WRITERS: Writer[] = [
  {
    name: "P1 person_profile_update (me-settings.ts writeProfile)",
    empty: "refuse",
    r4: "refuse",
    call: async (input) => {
      const personId = await insertPerson(SEED);
      const { rows } = await ctx.owner.query<{ id: string }>(
        `INSERT INTO accounts (person_id) VALUES ($1) RETURNING id`,
        [personId],
      );
      try {
        await ctx.appPool.query(`SELECT 1 FROM person_profile_update($1::uuid, $2::text)`, [
          rows[0]!.id,
          input,
        ]);
      } catch (error) {
        return { code: sqlstate(error), untouched: (await nameOf(personId)) === SEED };
      }
      return { stored: cps(await nameOf(personId)) };
    },
  },
  {
    name: "P2 create_host_added_person (roster-service.ts)",
    empty: "refuse",
    r4: "keep",
    call: async (input) => {
      const before = await personCount();
      let id: string;
      try {
        const res = await withTenant(ctx.appDb.db, ctx.tenantA, (tx) =>
          tx.execute(
            sql`SELECT create_host_added_person(${ctx.tenantA}::uuid, ${host}::uuid, ${input.trim()}) AS id`,
          ),
        );
        id = (res.rows[0] as { id: string }).id;
      } catch (error) {
        return { code: sqlstate(error), untouched: (await personCount()) === before };
      }
      return { stored: cps(await nameOf(id)) };
    },
  },
  {
    name: "P3 zalo_identity_resolve (zalo-ingress.ts resolveZaloIdentity)",
    empty: "null",
    r4: "keep",
    call: async (input) => {
      const r = await withTenant(ctx.appDb.db, ctx.tenantA, (tx) =>
        resolveZaloIdentity(tx, {
          tenantId: ctx.tenantA,
          botId: bot,
          scopeHash: "scope-mn",
          userHash: `user-${randomUUID()}`,
          userIdEnc: Buffer.from("enc", "utf8"),
          displayName: input,
        }),
      );
      const stored = await nameOf(r.personId);
      expect(r.created).toBe(true); // the identity resolves, an invisible-only name included
      expect(cps(r.displayName)).toEqual(cps(stored)); // the returned display_name is the stored one
      return { stored: cps(stored) };
    },
  },
  {
    name: "P4 auth_login_google (apps/web/lib/oauth-transaction.ts)",
    empty: "null",
    r4: "keep",
    call: async (input) => {
      const { rows } = await ctx.appPool.query<{ person_id: string; outcome: string }>(
        `SELECT account_id, person_id, outcome FROM auth_login_google($1, $2, $3, $4, $5, $6, $7)`,
        [
          `gsub-${randomBytes(16).toString("hex")}`,
          `glk-${randomBytes(10).toString("hex")}`,
          randomBytes(24),
          "kv1",
          randomUUID(),
          input,
          `req-mn-${randomBytes(4).toString("hex")}`,
        ],
      );
      expect(rows[0]!.outcome).toBe("login_success"); // a new Google subject mints a new Person
      return { stored: cps(await nameOf(rows[0]!.person_id)) };
    },
  },
];

type Row = { row: string; cls: "R1" | "R2" | "R3" | "R4" | "R5"; input: string; clean: string };
/** Section 6 rows; `clean` is what a writer that accepts the row stores. */
const ROWS: Row[] = [
  { row: "R1 a clean value", cls: "R1", input: "Lan Nguyen", clean: "Lan Nguyen" },
  {
    row: "R2 invisible code points among visible text",
    cls: "R2",
    input: mix("L", 0x200b, "an", 0xad, " ", 0x3164, "Ng", 0xfe00, "uy", 0xe0001, "e", 0x2065, "n"),
    clean: "Lan Nguyen",
  },
  { row: "R3 invisible-only", cls: "R3", input: mix(0x200b, 0x3164, 0xe0001), clean: "" },
  {
    row: "R3 invisible-only with spaces",
    cls: "R3",
    input: mix(" ", 0x200b, " ", 0x2065, " "),
    clean: "",
  },
  ...[0x07, 0x202e, 0x2028, 0x2800].map((cp): Row => {
    const value = mix("Lan", cp, "Nguyen");
    return { row: `R4 U+${hex(cp)} among visible text`, cls: "R4", input: value, clean: value };
  }),
  // R5 (section 7): U+200D and U+FE0F are in the strip set, so composed emoji split. This is the
  // owner's rule (decision item 6) applied as written: no emoji exception.
  {
    row: "R5 a ZWJ family splits into its three emoji",
    cls: "R5",
    input: mix("An ", 0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467),
    clean: mix("An ", 0x1f468, 0x1f469, 0x1f467),
  },
  {
    row: "R5 a VS16 heart becomes the text heart",
    cls: "R5",
    input: mix("An ", 0x2764, 0xfe0f),
    clean: mix("An ", 0x2764),
  },
];

function expected(w: Writer, r: Row): Outcome {
  if (r.cls === "R3")
    return w.empty === "refuse" ? { code: "22023", untouched: true } : { stored: null };
  if (r.cls === "R4" && w.r4 === "refuse") return { code: "22023", untouched: true };
  return { stored: cps(r.clean) };
}

describe("MN persons.display_name definers", () => {
  it.each(WRITERS.flatMap((w) => ROWS.map((r) => ({ name: `${w.name}: ${r.row}`, w, r }))))(
    "$name",
    async ({ w, r }) => {
      expect(await w.call(r.input)).toEqual(expected(w, r));
    },
  );
});

// MN rows R1-R5 for the membership and tenant definers 0069 re-creates (unit U2a2): M2
// create_guest_membership, T1 tenant_provision and T2 tenant_profile_update, each called as role
// `app` with the statement its TypeScript caller runs. All three keep R4 as sent: M2 copies the
// source as it holds it, T1 accepts it (O1), and T2 refuses Cc and Cf only in its TypeScript
// validator (club-config.ts, the U5 rows), never in the definer. R5 (section 7) for
// memberships.display_name and tenants.name: the ZWJ family and the VS16 heart lose U+200D and
// U+FE0F. This is the owner's rule (decision item 6) applied as written: no emoji exception.
describe("MN memberships.display_name and tenants.name definers", () => {
  const tenantName = async (id: string) =>
    (await ctx.owner.query<{ name: string }>(`SELECT name FROM tenants WHERE id = $1`, [id]))
      .rows[0]?.name ?? null;
  type Definer = {
    name: string;
    r3: (r: Row) => Outcome;
    call: (input: string | null) => Promise<Outcome>;
  };
  /** `r3` is the definer's R3 verdict; every other row stores the row's `clean` value. */
  const DEFINERS: Definer[] = [
    {
      name: "M2 create_guest_membership (session-join-service.ts mintGuestMembership)",
      // The copy is the strip alone (no trim, no NULLIF), so R3 leaves what an empty source leaves
      // today (its live body copies it as it is): the visible remainder, '' or the spaces.
      r3: (r) => ({ stored: cps([...r.input].filter((c) => c === " ").join("")) }),
      call: async (input) => {
        // After 0069 an unstripped persons name exists only as a value the cleanup left (B6), so
        // ctx.owner seeds it, then resets it after the read (no stray value for the MG block).
        const personId = await insertPerson(input);
        const res = await withTenant(ctx.appDb.db, ctx.tenantA, (tx) =>
          tx.execute(
            sql`SELECT create_guest_membership(${ctx.tenantA}::uuid, ${personId}::uuid) AS id`,
          ),
        );
        const { rows } = await ctx.owner.query<{ display_name: string | null }>(
          `SELECT display_name FROM memberships WHERE id = $1`,
          [(res.rows[0] as { id: string }).id],
        );
        await ctx.owner.query(`UPDATE persons SET display_name = $2 WHERE id = $1`, [
          personId,
          SEED,
        ]);
        return { stored: cps(rows[0]!.display_name) };
      },
    },
    {
      name: "T1 tenant_provision (auth.ts provisionTenant)",
      r3: () => ({ code: "22023", untouched: true }), // 'name required', as for an empty name today
      call: async (input) => {
        const slug = `mn-${randomBytes(6).toString("hex")}`;
        const personId = await insertPerson(SEED);
        let id: string;
        try {
          const { rows } = await ctx.appPool.query<{ id: string }>(
            `SELECT tenant_provision($1, $2, $3, $4, $5) AS id`,
            [slug, input, null, null, personId],
          );
          id = rows[0]!.id;
        } catch (error) {
          const { rows } = await ctx.owner.query(`SELECT 1 FROM tenants WHERE slug = $1`, [slug]);
          return { code: sqlstate(error), untouched: rows.length === 0 };
        }
        return { stored: cps(await tenantName(id)) };
      },
    },
    {
      name: "T2 tenant_profile_update (club-config.ts updateClubConfig)",
      r3: () => ({ code: "22023", untouched: true }), // 'name must be 1..120 chars', as for ''
      call: async (input) => {
        await ctx.owner.query(`UPDATE tenants SET name = $2 WHERE id = $1`, [ctx.tenantA, SEED]);
        try {
          await withTenant(ctx.appDb.db, ctx.tenantA, (tx) =>
            tx.execute(
              sql`SELECT id FROM tenant_profile_update(${ctx.tenantA}::uuid, ${host}::uuid, ${input}, ${null}, ${null})`,
            ),
          );
        } catch (error) {
          return { code: sqlstate(error), untouched: (await tenantName(ctx.tenantA)) === SEED };
        }
        return { stored: cps(await tenantName(ctx.tenantA)) };
      },
    },
  ];
  it.each(DEFINERS.flatMap((w) => ROWS.map((r) => ({ name: `${w.name}: ${r.row}`, w, r }))))(
    "$name",
    async ({ w, r }) => {
      expect(await w.call(r.input)).toEqual(r.cls === "R3" ? w.r3(r) : { stored: cps(r.clean) });
    },
  );
  // The NULL rows (section 6 has none): the helper is STRICT (0068:54), so a NULL stays NULL. T2 with
  // p_name NULL (a timezone- or locale-only update) keeps the stored name; M2 for a person with no
  // display name (a Google login without one, DD-26) stores a NULL membership name, never ''.
  const byId = (id: string) => DEFINERS.find((d) => d.name.startsWith(`${id} `))!;
  it("T2 tenant_profile_update: NULL p_name keeps the stored name", async () => {
    expect(await byId("T2").call(null)).toEqual({ stored: cps(SEED) });
  });
  it("M2 create_guest_membership: a person with a NULL display_name gives a NULL name", async () => {
    expect(await byId("M2").call(null)).toEqual({ stored: null });
  });
});

// RC-BODY, RC-ACL and RC-OWNER (unit U2b, section 11): one row per definer 0069 re-creates. Every pin
// is read off the definer's previous CREATE in the migration its row names; `subs` is the section 10
// substitution table verbatim, as [today, 0069] pairs.
const H = "public.public_name_strip_invisible";
const HELPER_SIG = `${H}(text)`;
type Recreated = { sig: string; file: string; searchPath: string; subs: [string, string][] };
const RECREATED: Recreated[] = [
  {
    sig: "public.auth_login_google(text, text, bytea, text, uuid, text, text)",
    file: "0017_oauth_transactions.sql",
    searchPath: "public, pg_temp",
    subs: [["NULLIF(trim(p_display_name), '')", `NULLIF(trim(${H}(p_display_name)), '')`]],
  },
  {
    sig: "public.create_host_added_person(uuid, uuid, text)",
    file: "0051_host_add_person_definer.sql",
    searchPath: "pg_catalog, public, pg_temp",
    subs: [["v_name := btrim(p_display_name);", `v_name := btrim(${H}(p_display_name));`]],
  },
  {
    sig: "public.zalo_identity_resolve(uuid, uuid, text, text, bytea, text)",
    file: "0053_zalo_ingress.sql",
    searchPath: "pg_catalog, public, pg_temp",
    subs: [
      [
        "left(nullif(btrim(p_display_name), ''), 120)",
        `left(nullif(btrim(${H}(p_display_name)), ''), 120)`,
      ],
    ],
  },
  {
    sig: "public.person_profile_update(uuid, text)",
    file: "0055_me_settings_definers.sql",
    searchPath: "pg_catalog, public, pg_temp",
    subs: [["regexp_replace(p_display_name, ", `regexp_replace(${H}(p_display_name), `]],
  },
  {
    sig: "public.create_guest_membership(uuid, uuid)",
    file: "0058_player_self_join.sql",
    searchPath: "pg_catalog, public, pg_temp",
    subs: [["SELECT p.display_name INTO v_name", `SELECT ${H}(p.display_name) INTO v_name`]],
  },
  {
    sig: "public.tenant_provision(text, text, text, text, uuid)",
    file: "0037_tenant_provision_rls_self_scope.sql",
    searchPath: "public, pg_temp",
    subs: [
      ["trim(coalesce(p_name, ''))", `trim(coalesce(${H}(p_name), ''))`],
      ["trim(p_name)", `trim(${H}(p_name))`],
    ],
  },
  {
    sig: "public.tenant_profile_update(uuid, uuid, text, text, text)",
    file: "0052_tenant_profile_definers.sql",
    searchPath: "pg_catalog, public, pg_temp",
    subs: [["v_name text := btrim(p_name);", `v_name text := btrim(${H}(p_name));`]],
  },
];
const fnName = (w: Recreated) => w.sig.slice("public.".length, w.sig.indexOf("("));
const migration = (file: string) =>
  readFileSync(fileURLToPath(new URL(`../migrations/${file}`, import.meta.url)), "utf8");

/** The definer's last CREATE in its migration: the header up to `AS $$`, and the body as prosrc holds it. */
function previousCreate(w: Recreated): { header: string; body: string } {
  const text = migration(w.file);
  const at = Math.max(
    text.lastIndexOf(`\nCREATE FUNCTION ${fnName(w)}(`),
    text.lastIndexOf(`\nCREATE OR REPLACE FUNCTION ${fnName(w)}(`),
  );
  const open = text.indexOf("\nAS $$\n", at);
  const close = text.indexOf("\n$$;\n", open);
  if (at < 0 || open < 0 || close < 0) throw new Error(`${w.file}: no CREATE of ${fnName(w)}`);
  return { header: text.slice(at, open + 1), body: text.slice(open + 6, close + 1) };
}

/** A 0069 block: the text between its two L27-<name> marker lines, each present exactly once. */
function l27Block(name: "OWNER-CHECK" | "CLEANUP"): string {
  const text = migration("0069_member_name_invisible_chars.sql");
  const begin = `\n-- L27-${name}-BEGIN\n`;
  const end = `\n-- L27-${name}-END`;
  const from = text.indexOf(begin);
  const to = text.indexOf(end);
  if (from < 0 || to < from || text.includes(begin, from + 1) || text.includes(end, to + 1)) {
    throw new Error(`0069: expected one L27-${name}-BEGIN line, then one L27-${name}-END line`);
  }
  return text.slice(from + begin.length, to);
}

/** Runs fn on a superuser connection inside a transaction that is always rolled back. */
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

/** Owner and ACL of the helper and the seven: what a no-op block or a rolled-back move leaves as it was. */
async function ownership(c: pg.ClientBase): Promise<Record<string, unknown>[]> {
  const { rows } = await c.query<Record<string, unknown>>(
    `SELECT p.oid::regprocedure::text AS fn, p.proowner::regrole::text AS owner, p.proacl::text AS acl
       FROM pg_proc p WHERE p.oid = ANY($1::regprocedure[]) ORDER BY 1`,
    [[HELPER_SIG, ...RECREATED.map((w) => w.sig)]],
  );
  return rows;
}

describe("RC-BODY: each live body is its previous CREATE's with exactly the section 10 substitution", () => {
  it.each(RECREATED)("$sig from $file", async (w) => {
    const previous = previousCreate(w).body;
    let want = previous;
    for (const [today, next] of w.subs) {
      expect(previous.split(today).length - 1, today).toBe(1); // tenant_provision: two pairs, once each
      want = want.split(today).join(next);
    }
    const { rows } = await ctx.owner.query<{ src: string }>(
      `SELECT prosrc AS src FROM pg_proc WHERE oid = $1::regprocedure`,
      [w.sig],
    );
    expect(rows[0]!.src).toBe(want);
  });
});

describe("RC-ACL: each keeps its previous CREATE's attributes, the helper's owner and EXECUTE for app only", () => {
  it.each(RECREATED)("$sig", async (w) => {
    // The previous CREATE states SECURITY DEFINER with this search_path and no STABLE, IMMUTABLE,
    // STRICT or PARALLEL clause, so the pins are VOLATILE, CALLED ON NULL INPUT and PARALLEL UNSAFE.
    const { header } = previousCreate(w);
    expect(header).toContain(`\nSECURITY DEFINER\nSET search_path = ${w.searchPath}\n`);
    expect(header).not.toMatch(
      /STABLE|IMMUTABLE|STRICT|PARALLEL|RETURNS NULL|COST|ROWS|LEAKPROOF|SUPPORT/,
    );
    // Nor a COST, ROWS, LEAKPROOF or SUPPORT clause (and no migration ALTERs one), so the values before
    // 0069 are the defaults: COST 100, ROWS 1000 for a set-returning function (else 0), NOT LEAKPROOF,
    // no support function. The owner is also pinned absolutely, to the owner of 0068's alias definer
    // (the PS-OWNER-REPAIR anchor, untouched by 0069): moving the helper and all seven together fails.
    const set = header.includes("RETURNS TABLE") || header.includes("RETURNS SETOF");
    const { rows } = await ctx.owner.query<Record<string, unknown>>(
      `SELECT p.prosecdef AS security_definer, p.proconfig AS config, p.provolatile AS volatility,
              p.proisstrict AS strict, p.proparallel AS parallel, p.proleakproof AS leakproof,
              p.procost::int AS cost, p.proretset AS returns_set, p.prorows::int AS est_rows,
              p.prosupport::text AS support, p.proowner = h.proowner AS helper_owner,
              p.proowner = anchor.proowner AS anchor_owner,
              ARRAY(SELECT a.privilege_type
                      FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                     WHERE a.grantee = p.proowner) AS owner_privileges,
              ARRAY(SELECT CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END
                           || ':' || a.privilege_type
                      FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                     WHERE a.grantee <> p.proowner ORDER BY 1) AS grants
         FROM pg_proc p, pg_proc h, pg_proc anchor
        WHERE p.oid = $1::regprocedure AND h.oid = $2::regprocedure
          AND anchor.oid = 'public.tenant_public_alias_set(uuid, uuid, text)'::regprocedure`,
      [w.sig, HELPER_SIG],
    );
    expect(rows[0]).toEqual({
      security_definer: true,
      config: [`search_path=${w.searchPath}`],
      volatility: "v",
      strict: false,
      parallel: "u",
      leakproof: false,
      cost: 100,
      returns_set: set,
      est_rows: set ? 1000 : 0,
      support: "-",
      helper_owner: true,
      anchor_owner: true,
      owner_privileges: ["EXECUTE"],
      grants: ["app:EXECUTE"], // the base ACL (0012-0058): REVOKE ALL FROM PUBLIC, GRANT EXECUTE TO app
    });
  });
});

describe("RC-OWNER: the 0069 owner check (B7) covers each of the seven", () => {
  const OWNER_CHECK = l27Block("OWNER-CHECK");
  it.each(RECREATED)(
    "$sig: a no-op as applied; 42501 once its owner moves to readonly; rolled back, nothing changed",
    async (w) => {
      const before = await ownership(ctx.owner);
      await rolledBack(async (c) => {
        await c.query(OWNER_CHECK);
        expect(await ownership(c)).toEqual(before);
        await c.query(`ALTER FUNCTION ${w.sig} OWNER TO readonly`);
        const err = await c.query(OWNER_CHECK).catch((e: unknown) => e);
        expect(err).toMatchObject({ code: "42501" });
        // Ends with "<fnName>(<arguments without ')'>) (owner readonly)", fnName taken literally:
        // plain string checks, no RegExp built from data (Semgrep detect-non-literal-regexp).
        const msg = (err as Error).message;
        const head = `${fnName(w)}(`;
        const tail = ") (owner readonly)";
        expect(msg.endsWith(tail), msg).toBe(true);
        const body = msg.slice(0, -tail.length);
        const at = body.lastIndexOf(head);
        expect(at, msg).toBeGreaterThanOrEqual(0);
        expect(body.slice(at + head.length), msg).not.toContain(")");
      });
      expect(await ownership(ctx.owner)).toEqual(before);
    },
  );
});

// MG (unit U2c, section 11, default B6): the exact text of the 0069 L27-CLEANUP block, replayed on
// fixture rows seeded through the privileged path, in transactions that are always rolled back. A first
// run inside the same transaction absorbs what the blocks above left behind, so every expectation is
// exact; the values that first run leaves unchanged are re-reported by every later run (`carried`).
describe("MG the 0069 L27-CLEANUP block", () => {
  const CLEANUP = l27Block("CLEANUP");
  const COLS = [
    {
      table: "persons",
      col: "display_name",
      noun: "person",
      what: "display name",
      done: "stripped",
    },
    {
      table: "memberships",
      col: "display_name",
      noun: "membership",
      what: "display name",
      done: "stripped",
    },
    { table: "tenants", col: "name", noun: "tenant", what: "name", done: "stripped" },
    {
      table: "sessions",
      col: "venue_address",
      noun: "session",
      what: "venue address",
      done: "stripped and re-projected",
    },
  ] as const;
  type Col = (typeof COLS)[number];
  const VENUE = COLS[3];
  // The seeded value of each class and `stripped`, what the block stores for `mixed`: the three name
  // columns are stripped then trimmed; venue_address is stripped alone, so its outer spaces stay.
  // `residue` is invisible too, but what is left is not empty (U+202E; two spaces): it tells the
  // block's `~ c_visible` test apart from `<> ''`.
  const NAME = {
    mixed: mix(0xfeff, " L27", 0x200b, " Mai ", 0xad),
    stripped: "L27 Mai",
    invisible: mix(0x200b, 0x2060),
    residue: mix(0x200b, 0x202e),
    clean: "L27 Lan",
  };
  const ADDRESS = {
    mixed: mix(" So 1", 0x200b, " Pho", 0x2060, " "),
    stripped: " So 1 Pho ",
    invisible: mix(0xfeff),
    residue: mix(" ", 0x200b, " "),
    clean: "So 2 Pho",
  };
  const valuesOf = (col: Col) => (col.table === "sessions" ? ADDRESS : NAME);
  const changed = (col: Col, id: string) =>
    `0069 cleanup: ${col.noun} ${id} ${col.what} ${col.done}`;
  const left = (col: Col, id: string) =>
    `0069 cleanup: ${col.noun} ${id} ${col.what} left unchanged (no visible character after the strip)`;
  const closing = (p: number, m: number, t: number, s: number, l: number) =>
    `0069 cleanup: ${p} person names, ${m} membership names, ${t} tenant names changed, ${s} sessions changed and re-projected, ${l} values left unchanged`;

  /** Runs the block on c and returns the NOTICE messages it raised. */
  async function run(c: pg.PoolClient): Promise<string[]> {
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

  /** One club (clean name, approved alias) hosts every row: per column one row of each class, plus a
   *  second mixed address with hide_exact_address ON; every session is projected (version 1). */
  async function seed(c: pg.PoolClient) {
    const carried = (await run(c)).filter((n) =>
      n.endsWith("(no visible character after the strip)"),
    );
    const insert = async (statement: string, params: unknown[]) =>
      (await c.query<{ id: string }>(`${statement} RETURNING id`, params)).rows[0]!.id;
    const slug = () => `l27-${randomUUID()}`;
    const club = await insert(
      `INSERT INTO tenants (name, slug, public_alias, public_alias_status) VALUES ($1, $2, 'L27 Alias', 'approved')`,
      [NAME.clean, slug()],
    );
    const tenant = (name: string) =>
      insert(`INSERT INTO tenants (name, slug) VALUES ($1, $2)`, [name, slug()]);
    const person = (name: string) =>
      insert(`INSERT INTO persons (display_name) VALUES ($1)`, [name]);
    const member = (personId: string, name: string) =>
      insert(`INSERT INTO memberships (tenant_id, person_id, display_name) VALUES ($1, $2, $3)`, [
        club,
        personId,
        name,
      ]);
    const session = (address: string, hidden = false) =>
      insert(
        `INSERT INTO sessions (tenant_id, sport_id, starts_at, ends_at, timezone, venue_name, venue_address, area,
           price_amount, slots_max, visibility, join_policy, status, hide_exact_address)
         VALUES ($1, $2, now() + interval '7 days', now() + interval '7 days 2 hours', 'Asia/Ho_Chi_Minh',
           'San L27', $3, 'Quan 1', 50000, 10, 'public', 'open', 'open', $4)`,
        [club, ctx.badmintonSportId, address, hidden],
      );
    const persons = {
      mixed: await person(NAME.mixed),
      invisible: await person(NAME.invisible),
      residue: await person(NAME.residue),
      clean: await person(NAME.clean),
    };
    const ids = {
      persons,
      memberships: {
        mixed: await member(persons.mixed, NAME.mixed),
        invisible: await member(persons.invisible, NAME.invisible),
        residue: await member(persons.residue, NAME.residue),
        clean: await member(persons.clean, NAME.clean),
      },
      tenants: {
        mixed: await tenant(NAME.mixed),
        invisible: await tenant(NAME.invisible),
        residue: await tenant(NAME.residue),
        clean: club,
      },
      sessions: {
        mixed: await session(ADDRESS.mixed),
        invisible: await session(ADDRESS.invisible),
        residue: await session(ADDRESS.residue),
        clean: await session(ADDRESS.clean),
      },
    };
    const hidden = await session(ADDRESS.mixed, true);
    for (const id of [...Object.values(ids.sessions), hidden]) {
      const { rows } = await c.query<{ d: string }>(
        `SELECT public_sessions_project_session($1, NULL) AS d`,
        [id],
      );
      expect(rows[0]!.d).toBe("upserted");
    }
    return { ids, hidden, carried };
  }
  type Fixture = Awaited<ReturnType<typeof seed>>;
  const sessionIds = (f: Fixture) => [...Object.values(f.ids.sessions), f.hidden];

  /** id -> [ctid, stored value] of each fixture row (every UPDATE moves the ctid), and
   *  "public <id>" -> [version, venue_address] of each session's public row. */
  async function state(c: pg.PoolClient, f: Fixture): Promise<Record<string, unknown[]>> {
    const out: Record<string, unknown[]> = {};
    for (const col of COLS) {
      const { rows } = await c.query<{ id: string; ctid: string; v: string | null }>(
        `SELECT id, ctid::text AS ctid, ${col.col} AS v FROM ${col.table} WHERE id = ANY($1::uuid[])`,
        [col === VENUE ? sessionIds(f) : Object.values(f.ids[col.table])],
      );
      for (const r of rows) out[r.id] = [r.ctid, r.v];
    }
    const { rows } = await c.query<{ id: string; version: number; v: string | null }>(
      `SELECT id, public_projection_version::int AS version, venue_address AS v
         FROM public_sessions WHERE id = ANY($1::uuid[])`,
      [sessionIds(f)],
    );
    for (const r of rows) out[`public ${r.id}`] = [r.version, r.v];
    return out;
  }

  /** A fingerprint of the four columns and the public rows, read outside every fixture transaction. */
  const snapshot = async () =>
    (
      await ctx.superuserDb.pool.query<{ s: string }>(
        `SELECT concat_ws(' ',
           (SELECT md5(string_agg(concat_ws(':', id, display_name), ',' ORDER BY id)) FROM persons),
           (SELECT md5(string_agg(concat_ws(':', id, display_name), ',' ORDER BY id)) FROM memberships),
           (SELECT md5(string_agg(concat_ws(':', id, name), ',' ORDER BY id)) FROM tenants),
           (SELECT md5(string_agg(concat_ws(':', id, venue_address), ',' ORDER BY id)) FROM sessions),
           (SELECT md5(string_agg(concat_ws(':', id, public_projection_version, venue_address), ',' ORDER BY id))
              FROM public_sessions)) AS s`,
      )
    ).rows[0]!.s;
  let atStart: string;
  beforeAll(async () => {
    atStart = await snapshot();
  });

  it("strips each mixed value (names then trimmed, venue_address not), keeps invisible-only and clean values, names each row by id only", async () => {
    await rolledBack(async (c) => {
      const f = await seed(c);
      const before = await state(c, f);
      const notices = await run(c);
      const after = await state(c, f);
      for (const col of COLS) {
        for (const k of ["mixed", "invisible", "residue", "clean"] as const) {
          const id = f.ids[col.table][k];
          expect(after[id]![1]).toBe(k === "mixed" ? valuesOf(col).stripped : valuesOf(col)[k]);
          expect(after[id]![0] === before[id]![0]).toBe(k !== "mixed"); // only a mixed row is rewritten
        }
      }
      // Re-projection: the public row follows the stripped address; a hidden address stays masked.
      const pub = (id: string) => [before[`public ${id}`], after[`public ${id}`]];
      expect(after[f.hidden]![1]).toBe(ADDRESS.stripped);
      expect(pub(f.ids.sessions.mixed)).toEqual([
        [1, ADDRESS.mixed],
        [2, ADDRESS.stripped],
      ]);
      expect(pub(f.hidden)).toEqual([
        [1, null],
        [1, null],
      ]);
      for (const k of ["invisible", "residue", "clean"] as const) {
        expect(pub(f.ids.sessions[k])).toEqual([
          [1, ADDRESS[k]],
          [1, ADDRESS[k]],
        ]);
      }
      expect(notices.sort()).toEqual(
        [
          ...COLS.map((col) => changed(col, f.ids[col.table].mixed)),
          changed(VENUE, f.hidden),
          ...COLS.map((col) => left(col, f.ids[col.table].invisible)),
          ...COLS.map((col) => left(col, f.ids[col.table].residue)),
          ...f.carried,
          closing(1, 1, 1, 2, 2 * COLS.length + f.carried.length),
        ].sort(),
      );
      // No NOTICE carries fixture text: none of its visible words, no code point outside printable ASCII.
      expect(notices.filter((n) => /L27|Mai|Lan|Pho|[^ -~]/.test(n))).toEqual([]);
    });
  });

  it("a second run rewrites no row, bumps no version and re-reports only the values left unchanged", async () => {
    await rolledBack(async (c) => {
      const f = await seed(c);
      await run(c);
      const before = await state(c, f);
      const notices = await run(c);
      expect(await state(c, f)).toEqual(before);
      expect(notices.sort()).toEqual(
        [
          ...COLS.map((col) => left(col, f.ids[col.table].invisible)),
          ...COLS.map((col) => left(col, f.ids[col.table].residue)),
          ...f.carried,
          closing(0, 0, 0, 0, 2 * COLS.length + f.carried.length),
        ].sort(),
      );
    });
  });

  // The 42501 run below reaches the guard through sessions alone; this text pin covers all four.
  it("guards each of the four tables with its own row_security_active clause, before the first loop", () => {
    const loop = CLEANUP.indexOf("FOR r IN");
    const clause = (t: string) =>
      `row_security_active('public.${t}') AND pg_relation_size('public.${t}') > 0`;
    expect(loop).toBeGreaterThan(0);
    expect(CLEANUP.split("row_security_active('").length - 1).toBe(4);
    for (const col of COLS) {
      expect(CLEANUP.slice(0, loop).split(clause(col.table)).length - 1, col.table).toBe(1);
    }
  });

  it("as app (NOSUPERUSER NOBYPASSRLS) over a non-empty table it fails closed with 42501", async () => {
    await rolledBack(async (c) => {
      await seed(c);
      await c.query("SET LOCAL ROLE app");
      expect(
        (
          await c.query(
            `SELECT r.rolsuper, r.rolbypassrls, row_security_active('public.sessions') AS rls,
                    pg_relation_size('public.sessions') > 0 AS nonempty
               FROM pg_roles r WHERE r.rolname = current_user`,
          )
        ).rows[0],
      ).toEqual({ rolsuper: false, rolbypassrls: false, rls: true, nonempty: true });
      // The message pins the guard: a missing EXECUTE on the helper would also be 42501.
      await expect(c.query(CLEANUP)).rejects.toMatchObject({
        code: "42501",
        message:
          "0069 cleanup: row security applies to app and persons, memberships, tenants or sessions holds rows it may not see; apply 0069 as the superuser migration role",
      });
    });
  });

  it("leaves the database exactly as it found it", async () => {
    expect(await snapshot()).toBe(atStart);
  });
});

// End of the L27 RC and MG blocks; the L29 blocks follow.

// L29 (lane p3-name-writers-refuse-control-bidi, unit U1; readiness file sections 4, 5 and 11):
// public.member_name_apply_rule of 0070 section A. EXECUTE is owner-only, so the rule runs as the
// superuser; the catalog is read through ctx.owner as above.
describe("L29-F public.member_name_apply_rule (0070 section A)", () => {
  const RULE = "public.member_name_apply_rule";
  const RULE_SIG = `${RULE}(text, boolean)`;
  const run = async <T extends pg.QueryResultRow>(text: string, values: unknown[] = []) =>
    (await ctx.superuserDb.pool.query<T>(text, values)).rows;
  const catalog = async (text: string, values: unknown[]) =>
    (await ctx.owner.query<Record<string, unknown>>(text, values)).rows;

  it("L29-F1 exists once, in public, a plpgsql function returning text", async () => {
    expect(
      await catalog(
        `SELECT n.nspname AS schema, pg_get_function_identity_arguments(p.oid) AS args,
                p.prorettype::regtype::text AS returns, p.proretset AS returns_set, l.lanname AS language
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           JOIN pg_language l ON l.oid = p.prolang
          WHERE p.proname = 'member_name_apply_rule'`,
        [],
      ),
    ).toEqual([
      {
        schema: "public",
        args: "p_value text, p_external boolean",
        returns: "text",
        returns_set: false,
        language: "plpgsql",
      },
    ]);
  });

  it("L29-F2 its attributes are the 0068 helper's: IMMUTABLE, STRICT, PARALLEL SAFE, INVOKER, pg_catalog", async () => {
    const attrs = (sig: string) =>
      catalog(
        `SELECT provolatile AS volatility, proisstrict AS strict, proparallel AS parallel,
                prosecdef AS security_definer, proconfig AS config
           FROM pg_proc WHERE oid = $1::regprocedure`,
        [sig],
      );
    const helper = await attrs(HELPER_SIG);
    expect(helper).toEqual([
      {
        volatility: "i",
        strict: true,
        parallel: "s",
        security_definer: false,
        config: ["search_path=pg_catalog"],
      },
    ]);
    expect(await attrs(RULE_SIG)).toEqual(helper);
  });

  it("L29-F3 its owner is the 0068 helper's owner", async () => {
    expect(
      await catalog(
        `SELECT p.proowner = h.proowner AS helper_owner FROM pg_proc p, pg_proc h
          WHERE p.oid = $1::regprocedure AND h.oid = $2::regprocedure`,
        [RULE_SIG, HELPER_SIG],
      ),
    ).toEqual([{ helper_owner: true }]);
  });

  it("L29-F4 no EXECUTE for PUBLIC, app, app_worker or readonly, and no grant at all", async () => {
    expect(
      await catalog(
        `SELECT has_function_privilege('public', p.oid, 'EXECUTE') AS public_role,
                has_function_privilege('app', p.oid, 'EXECUTE') AS app,
                has_function_privilege('app_worker', p.oid, 'EXECUTE') AS app_worker,
                has_function_privilege('readonly', p.oid, 'EXECUTE') AS readonly,
                ARRAY(SELECT a.grantee::regrole::text FROM aclexplode(p.proacl) a
                       WHERE a.grantee <> p.proowner) AS grantees
           FROM pg_proc p WHERE p.oid = $1::regprocedure`,
        [RULE_SIG],
      ),
    ).toEqual([
      { public_role: false, app: false, app_worker: false, readonly: false, grantees: [] },
    ]);
  });

  it("L29-F5 its R, V and T constants are byte-equal to person_profile_update's (A-12); no RAISE", async () => {
    const end = "|| ']';";
    const constants = async (sig: string) => {
      const [row] = await catalog(`SELECT prosrc FROM pg_proc WHERE oid = $1::regprocedure`, [sig]);
      const src = String(row!.prosrc);
      const start = src.indexOf("  c_ws     CONSTANT");
      const visible = src.indexOf("c_visible CONSTANT", start);
      const stop = src.indexOf(end, visible);
      expect(start >= 0 && visible > start && stop > visible, sig).toBe(true);
      return { src, block: src.slice(start, stop + end.length) };
    };
    const rule = await constants(RULE_SIG);
    expect(rule.block).toBe((await constants("public.person_profile_update(uuid, text)")).block);
    expect(rule.src.toUpperCase()).not.toContain("RAISE");
  });

  const BIDI = [
    0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069,
  ];
  /** [class, input, mode false (interactive), mode true (ingress and copy)]: section 4's order and edge rule. */
  type Case = [label: string, input: string, interactive: string | null, ingress: string | null];
  const CASES: Case[] = [
    ["ordinary", "Ann Lee", "Ann Lee", "Ann Lee"],
    [
      "T at both edges (TAB, U+3000, NBSP, U+2029)",
      mix(0x09, 0x3000, "Ann", 0xa0, 0x2029),
      "Ann",
      "Ann",
    ],
    ["Cc inside (U+0001)", mix("Ann", 0x01, "Lee"), null, "AnnLee"],
    ["Cc inside (U+009F)", mix("Ann", 0x9f, "Lee"), null, "AnnLee"],
    ["Cc that is also T, inside (TAB)", mix("Ann", 0x09, "Lee"), null, "AnnLee"],
    ...BIDI.map((cp): Case => [
      `Bidi_Control U+${hex(cp)} inside`,
      mix("Ann", cp, "Lee"),
      null,
      "AnnLee",
    ]),
    ["U+2028 inside", mix("Ann", 0x2028, "Lee"), null, "AnnLee"],
    ["U+2029 inside", mix("Ann", 0x2029, "Lee"), null, "AnnLee"],
    [
      "Zs inside is kept (NBSP)",
      mix("Ann", 0xa0, "Lee"),
      mix("Ann", 0xa0, "Lee"),
      mix("Ann", 0xa0, "Lee"),
    ],
    ["Zs only (NBSP, U+3000, U+202F)", mix(0xa0, 0x3000, 0x202f), null, null],
    ["U+2800 only", mix(0x2800), null, null],
    ["U+2800 inside", mix("Ann", 0x2800, "Lee"), null, "AnnLee"],
    ["bidi only", mix(0x202e, 0x2066), null, null],
    ["invisible only (U+200B, U+2060, VS16)", mix(0x200b, 0x2060, 0xfe0f), null, null],
    ["invisible inside is stripped (ZWJ)", mix("Ann", 0x200d, "Lee"), "AnnLee", "AnnLee"],
    ["other R inside (Cf U+0600)", mix("Ann", 0x600, "Lee"), null, "AnnLee"],
    ["other R inside (Cf U+110BD)", mix("Ann", 0x110bd, "Lee"), null, "AnnLee"],
    ["T before a removed R is trimmed again (NBSP, U+202E)", mix("Ann", 0xa0, 0x202e), null, "Ann"],
  ];
  it.each(CASES)("L29-F5 %s", async (_label, input, interactive, ingress) => {
    const [row] = await run<{ interactive: string | null; ingress: string | null }>(
      `SELECT ${RULE}($1::text, false) AS interactive, ${RULE}($1::text, true) AS ingress`,
      [input],
    );
    expect([cps(row!.interactive), cps(row!.ingress)]).toEqual([cps(interactive), cps(ingress)]);
  });

  it("L29-F5 STRICT: a NULL value or a NULL mode gives NULL", async () => {
    expect(
      await run(
        `SELECT ${RULE}(NULL, false) AS a, ${RULE}(NULL, true) AS b, ${RULE}('Ann', NULL) AS c`,
      ),
    ).toEqual([{ a: null, b: null, c: null }]);
  });

  it("L29-F5 never raises: one value holding every scalar SQL text holds is refused by mode false; mode true gives a value both modes keep", async () => {
    expect(
      await run(
        `WITH s AS MATERIALIZED (
           SELECT string_agg(chr(g), '' ORDER BY g) AS v
             FROM generate_series(1, 1114111) g WHERE g < 55296 OR g > 57343
         ), r AS MATERIALIZED (SELECT ${RULE}(v, false) AS refused, ${RULE}(v, true) AS kept FROM s)
         SELECT refused, kept IS NOT NULL AS visible, ${RULE}(kept, false) = kept AS interactive_keeps,
                ${RULE}(kept, true) = kept AS ingress_keeps
           FROM r`,
      ),
    ).toEqual([{ refused: null, visible: true, interactive_keeps: true, ingress_keeps: true }]);
  }, 30_000);
});

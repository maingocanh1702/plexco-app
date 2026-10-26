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
import { provisionTenant } from "./auth.js";
import { ClubConfigError, validatePatch } from "./club-config-validation.js";
import { fixtures, nextCommandId } from "./roster-money-fixtures.js";
import { RosterMoneyError } from "./roster-money-shared.js";
import { addMemberToSession } from "./roster-service.js";
import { createSession, updateSession } from "./session-service.js";
import { seedPersonAccount, setupRlsTestContext, type RlsTestContext } from "./test-harness.js";
import { withTenant } from "./tenant.js";
import { checkTypedName, normalizeExternalName } from "./text-safety.js";
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
  /** R4: a control, bidi, line-separator or U+2800 character is refused, or removed (0070). */
  r4: "refuse" | "remove";
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
    r4: "refuse",
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
    r4: "remove",
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
    r4: "remove",
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
    // 0070: the writers that accept R4 (mode true) remove the code point (readiness section 7).
    return {
      row: `R4 U+${hex(cp)} among visible text`,
      cls: "R4",
      input: value,
      clean: "LanNguyen",
    };
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
// `app` with the statement its TypeScript caller runs. Since 0070 (RO-L29-2, readiness section 7)
// T1 and T2 refuse R4 with 22023 (mode false) and M2 removes the code point from the copy (mode
// true), and M2 copies an R3 source as NULL, never '' (RO-L29-3 group 3). R5 (section 7) for
// memberships.display_name and tenants.name: the ZWJ family and the VS16 heart lose U+200D and
// U+FE0F. This is the owner's rule (decision item 6) applied as written: no emoji exception.
describe("MN memberships.display_name and tenants.name definers", () => {
  const tenantName = async (id: string) =>
    (await ctx.owner.query<{ name: string }>(`SELECT name FROM tenants WHERE id = $1`, [id]))
      .rows[0]?.name ?? null;
  type Definer = {
    name: string;
    r3: (r: Row) => Outcome;
    r4: Writer["r4"];
    call: (input: string | null) => Promise<Outcome>;
  };
  /** `r3` is the definer's R3 verdict, `r4` as in WRITERS; every other row stores its `clean`. */
  const DEFINERS: Definer[] = [
    {
      name: "M2 create_guest_membership (session-join-service.ts mintGuestMembership)",
      // Since 0070 the copy is mode true: an invisible-only or blank-only source is copied as NULL,
      // never '' (RO-L29-3 group 3), and an R4 code point is removed (RO-L29-2).
      r3: () => ({ stored: null }),
      r4: "remove",
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
      r4: "refuse",
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
      r4: "refuse",
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
      let want: Outcome = { stored: cps(r.clean) };
      if (r.cls === "R3") want = w.r3(r);
      else if (r.cls === "R4" && w.r4 === "refuse") want = { code: "22023", untouched: true };
      expect(await w.call(r.input)).toEqual(want);
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
// substitution table verbatim, as [today, 0069] pairs. `l29` (RO-L29-2) is the one more layer for
// the six definers 0070 re-creates: its section B and C substitutions as [0069, 0070] pairs.
const H = "public.public_name_strip_invisible";
const HELPER_SIG = `${H}(text)`;
const L29_RULE = "public.member_name_apply_rule";
type Recreated = {
  sig: string;
  file: string;
  searchPath: string;
  subs: [string, string][];
  l29?: [string, string][];
};
const RECREATED: Recreated[] = [
  {
    sig: "public.auth_login_google(text, text, bytea, text, uuid, text, text)",
    file: "0017_oauth_transactions.sql",
    searchPath: "public, pg_temp",
    subs: [["NULLIF(trim(p_display_name), '')", `NULLIF(trim(${H}(p_display_name)), '')`]],
    l29: [
      [
        `INSERT INTO persons(display_name) VALUES (NULLIF(trim(${H}(p_display_name)), ''))`,
        `INSERT INTO persons(display_name) VALUES (${L29_RULE}(p_display_name, true))`,
      ],
    ],
  },
  {
    sig: "public.create_host_added_person(uuid, uuid, text)",
    file: "0051_host_add_person_definer.sql",
    searchPath: "pg_catalog, public, pg_temp",
    subs: [["v_name := btrim(p_display_name);", `v_name := btrim(${H}(p_display_name));`]],
    l29: [
      [`v_name := btrim(${H}(p_display_name));`, `v_name := ${L29_RULE}(p_display_name, false);`],
    ],
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
    l29: [
      [
        `v_name text := left(nullif(btrim(${H}(p_display_name)), ''), 120);`,
        `v_name text := left(${L29_RULE}(p_display_name, true), 120);`,
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
    l29: [
      [
        `SELECT ${H}(p.display_name) INTO v_name`,
        `SELECT ${L29_RULE}(p.display_name, true) INTO v_name`,
      ],
    ],
  },
  {
    sig: "public.tenant_provision(text, text, text, text, uuid)",
    file: "0037_tenant_provision_rls_self_scope.sql",
    searchPath: "public, pg_temp",
    subs: [
      ["trim(coalesce(p_name, ''))", `trim(coalesce(${H}(p_name), ''))`],
      ["trim(p_name)", `trim(${H}(p_name))`],
    ],
    l29: [
      [
        `IF trim(coalesce(${H}(p_name), '')) = '' THEN`,
        `IF ${L29_RULE}(p_name, false) IS NULL THEN`,
      ],
      [`VALUES (trim(${H}(p_name)), p_slug,`, `VALUES (${L29_RULE}(p_name, false), p_slug,`],
    ],
  },
  {
    sig: "public.tenant_profile_update(uuid, uuid, text, text, text)",
    file: "0052_tenant_profile_definers.sql",
    searchPath: "pg_catalog, public, pg_temp",
    subs: [["v_name text := btrim(p_name);", `v_name text := btrim(${H}(p_name));`]],
    l29: [
      [`v_name text := btrim(${H}(p_name));`, `v_name text := ${L29_RULE}(p_name, false);`],
      [
        "IF p_name IS NOT NULL AND (char_length(v_name) < 1 OR",
        "IF p_name IS NOT NULL AND (v_name IS NULL OR char_length(v_name) < 1 OR",
      ],
    ],
  },
];
const fnName = (w: Recreated) => w.sig.slice("public.".length, w.sig.indexOf("("));
const migration = (file: string) =>
  readFileSync(fileURLToPath(new URL(`../migrations/${file}`, import.meta.url)), "utf8");

/** The CREATE at offset at: the header up to `AS $$`, and the body as prosrc holds it. */
function cutCreate(text: string, at: number, missing: string): { header: string; body: string } {
  const open = text.indexOf("\nAS $$\n", at);
  const close = text.indexOf("\n$$;\n", open);
  if (at < 0 || open < 0 || close < 0) throw new Error(missing);
  return { header: text.slice(at, open + 1), body: text.slice(open + 6, close + 1) };
}

/** The definer's last CREATE in its migration: the header up to `AS $$`, and the body as prosrc holds it. */
function previousCreate(w: Recreated): { header: string; body: string } {
  const text = migration(w.file);
  const at = Math.max(
    text.lastIndexOf(`\nCREATE FUNCTION ${fnName(w)}(`),
    text.lastIndexOf(`\nCREATE OR REPLACE FUNCTION ${fnName(w)}(`),
  );
  return cutCreate(text, at, `${w.file}: no CREATE of ${fnName(w)}`);
}

/** The last CREATE of name in file, spelled `name(` or `public.name(`: its body as prosrc holds it. */
function lastCreateBody(file: string, name: string): string {
  const text = migration(file);
  const heads = ["\nCREATE FUNCTION ", "\nCREATE OR REPLACE FUNCTION "].flatMap((c) => [
    `${c}${name}(`,
    `${c}public.${name}(`,
  ]);
  const at = Math.max(...heads.map((h) => text.lastIndexOf(h)));
  return cutCreate(text, at, `${file}: no CREATE of ${name}`).body;
}

const M0072 = migration("0072_member_name_definers_qualify_builtins.sql");
/** 0072's CREATE lines, `CREATE [OR REPLACE] FUNCTION [public.]<name>(`, group 1 the name (a static regex literal). */
const CREATES_0072 = [...M0072.matchAll(/^CREATE (?:OR REPLACE )?FUNCTION (?:public\.)?(\w+)\(/gm)];

/** 0072's one CREATE line of name (either spelling; one asserted): its body as prosrc holds it. */
function body0072(name: string): string {
  const hits = CREATES_0072.filter((m) => m[1] === name);
  if (hits.length !== 1)
    throw new Error(`0072: ${hits.length} CREATE lines of ${name}, expected one`);
  return cutCreate(M0072, M0072.indexOf(`\n${hits[0]![0]}`), `0072: no CREATE of ${name}`).body;
}

const M0073 = migration("0073_member_name_length_cap_120.sql");
/** 0073's CREATE lines: the same static regex literal as CREATES_0072, group 1 the name. */
const CREATES_0073 = [...M0073.matchAll(/^CREATE (?:OR REPLACE )?FUNCTION (?:public\.)?(\w+)\(/gm)];

/** 0073's one CREATE line of name (either spelling; one asserted): its body as prosrc holds it. */
function body0073(name: string): string {
  const hits = CREATES_0073.filter((m) => m[1] === name);
  if (hits.length !== 1)
    throw new Error(`0073: ${hits.length} CREATE lines of ${name}, expected one`);
  return cutCreate(M0073, M0073.indexOf(`\n${hits[0]![0]}`), `0073: no CREATE of ${name}`).body;
}

// The literal edits 0073 makes to each re-created 0072 body, [old, new]; every other byte is 0072's.
const EDITS_0073: Record<string, [string, string][]> = {
  create_host_added_person: [
    ["pg_catalog.char_length(v_name) > 100", "pg_catalog.char_length(v_name) > 120"],
    ["1..100 characters", "1..120 characters"],
  ],
  auth_login_google: [
    [
      "VALUES (public.member_name_apply_rule(p_display_name, true))",
      "VALUES (pg_catalog.left(public.member_name_apply_rule(p_display_name, true), 120))",
    ],
  ],
};

/** 0073's layer: next is previous with each old text, found once, swapped for its new text and nothing else; the failure, or null. */
function layer0073(previous: string, next: string, edits: [string, string][]): string | null {
  let want = previous;
  for (const [from, to] of edits) {
    const count = previous.split(from).length - 1;
    if (count !== 1) return `"${from}" occurs ${count} times in the previous body, not once`;
    want = want.split(from).join(to);
  }
  return want === next ? null : "the bodies differ beyond the named edits";
}

// The pg_catalog. prefixes 0072 adds to each body it re-creates, measured: 45 in all, none in any previous body.
const INSERTS: Record<string, number> = {
  public_name_strip_invisible: 1,
  member_name_apply_rule: 3,
  person_profile_update: 3,
  create_host_added_person: 3,
  tenant_provision: 6,
  tenant_profile_update: 5,
  zalo_identity_resolve: 2,
  auth_login_google: 13,
  create_guest_membership: 1,
  tenant_public_alias_set: 8,
};
const stripCatalog = (s: string) => s.split("pg_catalog.").join("");
const catalogPrefixes = (s: string) => s.split("pg_catalog.").length - 1;

/** 0072's layer: next is previous plus exactly n pg_catalog. prefixes and nothing else; the failure, or null. */
function layer0072(previous: string, next: string, n: number | undefined): string | null {
  const before = catalogPrefixes(previous);
  if (before !== 0) return `the previous body has ${before} pg_catalog. prefixes, not 0`;
  if (stripCatalog(next) !== stripCatalog(previous))
    return "the bodies differ beyond pg_catalog. prefixes";
  const added = catalogPrefixes(next) - before;
  if (added !== n) return `${added} pg_catalog. prefixes added, not ${String(n)}`;
  return null;
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

describe("RC-BODY: each live body is its previous CREATE's with exactly the section 10 substitution, then 0072's pg_catalog. prefixes", () => {
  it.each(RECREATED)("$sig from $file", async (w) => {
    const previous = previousCreate(w).body;
    let want = previous;
    for (const [today, next] of w.subs) {
      expect(previous.split(today).length - 1, today).toBe(1); // tenant_provision: two pairs, once each
      want = want.split(today).join(next);
    }
    const body0069 = want; // L29's layer edits the 0069 body, so its once check runs against it
    for (const [in0069, in0070] of w.l29 ?? []) {
      expect(body0069.split(in0069).length - 1, in0069).toBe(1);
      want = want.split(in0069).join(in0070);
    }
    // 0072's layer: the previous live body plus exactly INSERTS prefixes; prosrc is then pinned to 0072's body.
    const next0072 = body0072(fnName(w));
    expect(layer0072(want, next0072, INSERTS[fnName(w)]), fnName(w)).toBeNull();
    want = next0072;
    // 0073's layer, for its two: 0072's body with exactly EDITS_0073's edits; prosrc is pinned to 0073's body instead.
    const edits = EDITS_0073[fnName(w)];
    if (edits) {
      const next0073 = body0073(fnName(w));
      expect(layer0073(want, next0073, edits), fnName(w)).toBeNull();
      want = next0073;
    }
    const { rows } = await ctx.owner.query<{ src: string }>(
      `SELECT prosrc AS src FROM pg_proc WHERE oid = $1::regprocedure`,
      [w.sig],
    );
    expect(rows[0]!.src).toBe(want);
  });
});

describe("RC-BODY-0072: 0072 re-creates exactly the ten, each its previous body plus INSERTS pg_catalog. prefixes", () => {
  it("RC-BODY-0072 INSERTS sums to 45 and names exactly 0072's ten CREATE OR REPLACE FUNCTION lines", () => {
    expect(Object.values(INSERTS).reduce((a, b) => a + b, 0)).toBe(45);
    expect(M0072.split("\nCREATE OR REPLACE FUNCTION ").length - 1).toBe(10);
    // Any CREATE spelling counts here, so an eleventh function or a second CREATE of one fails too.
    expect(CREATES_0072.map((m) => m[1] ?? "").sort()).toEqual(Object.keys(INSERTS).sort());
  });

  it("RC-BODY-0072 layer0072 passes the helper's real pair and names a planted missing prefix or extra character", () => {
    const previous = lastCreateBody(
      "0068_public_name_invisible_chars.sql",
      "public_name_strip_invisible",
    );
    const next = body0072("public_name_strip_invisible");
    const n = INSERTS.public_name_strip_invisible;
    expect(layer0072(previous, next, n)).toBeNull();
    // (i) the first prefix removed: equal once stripped, so only the count check can fail.
    expect(layer0072(previous, next.replace("pg_catalog.", ""), n)).toBe(
      "0 pg_catalog. prefixes added, not 1",
    );
    // (ii) one extra character with every prefix kept: only the strip equality can fail.
    expect(layer0072(previous, next.replace("pg_catalog.", " pg_catalog."), n)).toBe(
      "the bodies differ beyond pg_catalog. prefixes",
    );
  });

  // The three RECREATED does not hold, each against its last CREATE before 0072 (0071 re-creates none of them).
  it.each([
    {
      sig: "public.member_name_apply_rule(text,boolean)",
      file: "0070_member_name_control_chars.sql",
    },
    {
      sig: "public.public_name_strip_invisible(text)",
      file: "0068_public_name_invisible_chars.sql",
    },
    {
      sig: "public.tenant_public_alias_set(uuid,uuid,text)",
      file: "0068_public_name_invisible_chars.sql",
    },
  ])("RC-BODY-0072 $sig from $file", async ({ sig, file }) => {
    const name = sig.slice("public.".length, sig.indexOf("("));
    const next = body0072(name);
    expect(layer0072(lastCreateBody(file, name), next, INSERTS[name]), name).toBeNull();
    const { rows } = await ctx.owner.query<{ src: string }>(
      `SELECT prosrc AS src FROM pg_proc WHERE oid = $1::regprocedure`,
      [sig],
    );
    expect(rows[0]!.src).toBe(next);
  });
});

describe("RC-BODY-0073: 0073 re-creates exactly the two, each its 0072 body with exactly the named edits", () => {
  it("RC-BODY-0073 EDITS_0073 names exactly 0073's two CREATE OR REPLACE FUNCTION lines", () => {
    expect(M0073.split("\nCREATE OR REPLACE FUNCTION ").length - 1).toBe(2);
    // Any CREATE spelling counts here, so a third function or a second CREATE of one fails too.
    expect(CREATES_0073.map((m) => m[1] ?? "").sort()).toEqual(Object.keys(EDITS_0073).sort());
  });

  it.each(Object.entries(EDITS_0073))(
    "RC-BODY-0073 %s is its 0072 body with exactly the named edits",
    (name, edits) => {
      expect(layer0073(body0072(name), body0073(name), edits)).toBeNull();
    },
  );

  it("RC-BODY-0073 layer0073 names a planted dropped edit, extra character and edit already made", () => {
    const previous = body0072("create_host_added_person");
    const next = body0073("create_host_added_person");
    const edits = EDITS_0073.create_host_added_person!;
    // (i) the message edit dropped: the cap edit is found once, so only the final equality can fail.
    expect(layer0073(previous, next, edits.slice(0, 1))).toBe(
      "the bodies differ beyond the named edits",
    );
    // (ii) one extra character in next with both edits listed: only the final equality can fail.
    const at = next.indexOf("120");
    expect(layer0073(previous, `${next.slice(0, at)} ${next.slice(at)}`, edits)).toBe(
      "the bodies differ beyond the named edits",
    );
    // (iii) the 0073 body given as previous: its cap text is gone, so the once check fails first.
    expect(layer0073(next, next, edits)).toBe(
      '"pg_catalog.char_length(v_name) > 100" occurs 0 times in the previous body, not once',
    );
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

  it("L29-F2 its attributes are the 0068 helper's: IMMUTABLE, STRICT, PARALLEL SAFE, INVOKER, pg_catalog, pg_temp", async () => {
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
        config: ["search_path=pg_catalog, pg_temp"],
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
    // (e) mode true joins the 8 interior separators, U+0020 and U+00A0 are not joined: known residual, pinned as current behaviour (member-name-rule-residual-precision).
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
    ...(
      [
        ["a", 0xfdd0, "a noncharacter"],
        ["a", 0xffff, "a noncharacter"],
        ["b", 0xe000, "private use"],
        ["c", 0x40000, "unassigned in every Unicode version so far"],
        ["d", 0x301, "a lone combining mark"],
      ] as const
    ).map(([item, cp, what]): Case => [
      `(${item}) U+${hex(cp)} (${what}) alone is kept: known residual, pinned as current behaviour (member-name-rule-residual-precision)`,
      mix(cp),
      mix(cp),
      mix(cp),
    ]),
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

// L29-W1 (unit U2, section 11): P2 create_host_added_person, T1 tenant_provision and T2
// tenant_profile_update apply member_name_apply_rule's mode false (section 7's P2, T1 and T2 SQL rows).
// A refused value raises 22023 with the writer's existing message and writes nothing; any other value
// stores its strip-and-trim result. Each is called as role `app` with the raw value (WRITERS' P2 trims
// first, as roster-service.ts does), so the definer's own edge rule decides the edge cells.
describe("L29-W1 P2, T1 and T2 refuse control, bidi, separator, U+2800 and blank-only names (0070, mode false)", () => {
  type Verdict =
    { stored: number[] | null } | { code: string; message: string; untouched: boolean };
  /** sqlstate's SQLSTATE, with the message of the pg error that carries it. */
  const refusal = (error: unknown) => {
    const code = sqlstate(error);
    let e = error as { code?: unknown; message?: unknown; cause?: unknown };
    while (e.code !== code) e = e.cause as typeof e;
    return { code, message: String(e.message) };
  };
  const tenantName = async (id: string) =>
    (await ctx.owner.query<{ name: string }>(`SELECT name FROM tenants WHERE id = $1`, [id]))
      .rows[0]!.name;
  type W1Writer = { id: string; message: string; call: (input: string | null) => Promise<Verdict> };
  const W1: W1Writer[] = [
    {
      id: "P2",
      message: "create_host_added_person: display name must be 1..120 characters",
      call: async (input) => {
        const before = await personCount();
        let id: string;
        try {
          const res = await withTenant(ctx.appDb.db, ctx.tenantA, (tx) =>
            tx.execute(
              sql`SELECT create_host_added_person(${ctx.tenantA}::uuid, ${host}::uuid, ${input}) AS id`,
            ),
          );
          id = (res.rows[0] as { id: string }).id;
        } catch (error) {
          return { ...refusal(error), untouched: (await personCount()) === before };
        }
        return { stored: cps(await nameOf(id)) };
      },
    },
    {
      id: "T1",
      message: "tenant_provision: name required",
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
          return { ...refusal(error), untouched: rows.length === 0 };
        }
        return { stored: cps(await tenantName(id)) };
      },
    },
    {
      id: "T2",
      message: "tenant_profile_update: name must be 1..120 chars",
      call: async (input) => {
        await ctx.owner.query(`UPDATE tenants SET name = $2 WHERE id = $1`, [ctx.tenantA, SEED]);
        try {
          await withTenant(ctx.appDb.db, ctx.tenantA, (tx) =>
            tx.execute(
              sql`SELECT id FROM tenant_profile_update(${ctx.tenantA}::uuid, ${host}::uuid, ${input}, ${null}, ${null})`,
            ),
          );
        } catch (error) {
          return { ...refusal(error), untouched: (await tenantName(ctx.tenantA)) === SEED };
        }
        return { stored: cps(await tenantName(ctx.tenantA)) };
      },
    },
  ];
  const byId = (id: string) => W1.find((w) => w.id === id)!;
  const BIDI_CONTROL = [
    0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069,
  ];
  /** Section 4's 16 Zs blanks: U+00A0, U+1680, U+2000-U+200A, U+202F, U+205F, U+3000. */
  const ZS_BLANKS = [
    0xa0,
    0x1680,
    ...Array.from({ length: 11 }, (_, i) => 0x2000 + i),
    0x202f,
    0x205f,
    0x3000,
  ];
  /** [cell, input, the stored value, or null when the writer refuses]: section 7's P2, T1 and T2 rows. */
  type Cell = [cell: string, input: string, stored: string | null];
  const inside =
    (cls: string) =>
    (cp: number): Cell => [`${cls} U+${hex(cp)} inside`, mix("Lan", cp, "Nguyen"), null];
  const CELLS: Cell[] = [
    ...[0x01, 0x1f, 0x7f, 0x80, 0x9f].map(inside("Cc")),
    ...BIDI_CONTROL.map(inside("Bidi_Control")),
    ...[0x2028, 0x2029].map(inside("separator")),
    ["blank-only: NBSP", mix(0xa0), null],
    ["blank-only: U+3000", mix(0x3000), null],
    ["blank-only: the 16 Zs blanks", mix(...ZS_BLANKS), null],
    ["U+2800 only", mix(0x2800), null],
    ["U+2800 inside", mix("Lan", 0x2800, "Nguyen"), null],
    ["invisible-only", mix(0x200b, 0x3164, 0xe0001), null],
    ["ordinary", "Lan Nguyen", "Lan Nguyen"],
    [
      "ordinary: a Zs blank inside is kept (NBSP)",
      mix("Lan", 0xa0, "Nguyen"),
      mix("Lan", 0xa0, "Nguyen"),
    ],
    [
      "ordinary: the strip-and-trim result (NBSP, U+200B, U+3000)",
      mix(0xa0, "Lan", 0x200b, " Nguyen", 0x3000),
      "Lan Nguyen",
    ],
    ["edge: TAB at both edges is trimmed", mix(0x09, "Lan Nguyen", 0x09), "Lan Nguyen"],
    [
      "edge: U+2028 and U+2029 at the edges are trimmed",
      mix(0x2028, "Lan Nguyen", 0x2029),
      "Lan Nguyen",
    ],
    ["edge: TAB inside is refused", mix("Lan", 0x09, "Nguyen"), null],
  ];
  it.each(
    W1.flatMap((w) =>
      CELLS.map(([cell, input, stored]) => ({ name: `${w.id}: ${cell}`, w, input, stored })),
    ),
  )("L29-W1 $name", async ({ w, input, stored }) => {
    expect(await w.call(input)).toEqual(
      stored === null
        ? { code: "22023", message: w.message, untouched: true }
        : { stored: cps(stored) },
    );
  });
  it("L29-W1 T2: a NULL p_name keeps the stored name", async () => {
    expect(await byId("T2").call(null)).toEqual({ stored: cps(SEED) });
  });
  it("L29-W1 T1 and T2 accept and refuse the same values (create versus set, threat 4)", async () => {
    const verdict = (v: Verdict) => ("stored" in v ? v.stored : v.code);
    for (const [cell, input] of CELLS) {
      const created = await byId("T1").call(input);
      const set = await byId("T2").call(input);
      expect(verdict(created), cell).toEqual(verdict(set));
    }
  }, 30_000);
});

// L29-RC (units U2 and U3, section 11): each definer 0070 re-creates keeps its owner, prosecdef,
// proconfig and ACL (the RC-ACL pattern above) and its body calls member_name_apply_rule( with the mode
// of its class. This part pins the three interactive definers, mode false: P2, T1 and T2.
describe("L29-RC P2, T1 and T2 keep their attributes and call member_name_apply_rule with mode false", () => {
  const RULE_SIG = "public.member_name_apply_rule(text, boolean)";
  const RC = [
    { fn: "create_host_added_person", arg: "p_display_name", calls: 1 },
    { fn: "tenant_provision", arg: "p_name", calls: 2 },
    { fn: "tenant_profile_update", arg: "p_name", calls: 1 },
  ].map((r) => ({ ...r, w: RECREATED.find((w) => fnName(w) === r.fn)! }));
  it.each(RC)("L29-RC $fn", async ({ arg, calls, w }) => {
    const { rows } = await ctx.owner.query<Record<string, unknown>>(
      `SELECT p.prosecdef AS security_definer, p.proconfig AS config,
              p.proowner = h.proowner AS helper_owner, p.proowner = r.proowner AS rule_owner,
              p.proowner = anchor.proowner AS anchor_owner,
              ARRAY(SELECT a.privilege_type
                      FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                     WHERE a.grantee = p.proowner) AS owner_privileges,
              ARRAY(SELECT CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END
                           || ':' || a.privilege_type
                      FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                     WHERE a.grantee <> p.proowner ORDER BY 1) AS grants,
              p.prosrc AS src
         FROM pg_proc p, pg_proc h, pg_proc r, pg_proc anchor
        WHERE p.oid = $1::regprocedure AND h.oid = $2::regprocedure AND r.oid = $3::regprocedure
          AND anchor.oid = 'public.tenant_public_alias_set(uuid, uuid, text)'::regprocedure`,
      [w.sig, HELPER_SIG, RULE_SIG],
    );
    const { src, ...attrs } = rows[0]!;
    expect(attrs).toEqual({
      security_definer: true,
      config: [`search_path=${w.searchPath}`],
      helper_owner: true,
      rule_owner: true,
      anchor_owner: true,
      owner_privileges: ["EXECUTE"],
      grants: ["app:EXECUTE"],
    });
    // Every call of the rule is the interactive one on the writer's own argument, and the L27 strip
    // call it replaced is gone (one definition of the rule, threat 6).
    const body = String(src);
    expect({
      calls: body.split("member_name_apply_rule(").length - 1,
      interactive: body.split(`public.member_name_apply_rule(${arg}, false)`).length - 1,
      strip: body.includes("public_name_strip_invisible("),
    }).toEqual({ calls, interactive: calls, strip: false });
  });
});

// L29-W2 and L29-I1-I3 (unit U3, section 11): P3 zalo_identity_resolve, P4 auth_login_google and
// M2 create_guest_membership apply member_name_apply_rule's mode true (section 7's P3, P4 and M2 SQL
// rows): the class is removed and the rest stored, NULL when no visible character is left, never ''.
// Each SQL is called as role `app` with the raw value (no TypeScript normalizer in front), so the
// definer's own rule decides every cell; P3 cuts to 120 after it. A name never fails an ingress
// writer and never changes the identity it resolves (threat 5).
describe("L29-W2 and L29-I1-I3 P3, P4 and M2 normalize control, bidi, separator, U+2800 and blank-only names and never raise (0070, mode true)", () => {
  type Zalo = { person_id: string; created: boolean; display_name: string | null };
  type Google = { account_id: string; person_id: string; outcome: string };
  /** P3's SQL as resolveZaloIdentity calls it; the returned display_name is the stored one. */
  const zalo = async (input: string | null, userHash = `user-${randomUUID()}`) => {
    const res = await withTenant(ctx.appDb.db, ctx.tenantA, (tx) =>
      tx.execute(
        sql`SELECT person_id, created, display_name
              FROM zalo_identity_resolve(${ctx.tenantA}::uuid, ${bot}::uuid, 'scope-mn', ${userHash},
                                         ${Buffer.from("enc", "utf8")}, ${input})`,
      ),
    );
    const r = res.rows[0] as Zalo;
    expect(cps(r.display_name)).toEqual(cps(await nameOf(r.person_id)));
    return r;
  };
  /** P4 as WRITERS' P4 calls it; a caller may repeat the subject and the email lookup hash. */
  const google = async (
    input: string | null,
    subject = `gsub-${randomBytes(16).toString("hex")}`,
    email = `glk-${randomBytes(10).toString("hex")}`,
  ) =>
    (
      await ctx.appPool.query<Google>(
        `SELECT account_id, person_id, outcome FROM auth_login_google($1, $2, $3, $4, $5, $6, $7)`,
        [
          subject,
          email,
          randomBytes(24),
          "kv1",
          randomUUID(),
          input,
          `req-mn-${randomBytes(4).toString("hex")}`,
        ],
      )
    ).rows[0]!;
  /** M2: the source seeded raw by ctx.owner and reset after the read, as the MN block's M2 does. */
  const guest = async (input: string | null) => {
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
    await ctx.owner.query(`UPDATE persons SET display_name = $2 WHERE id = $1`, [personId, SEED]);
    return rows[0]!.display_name;
  };
  type W2Writer = { id: string; stored: (input: string | null) => Promise<string | null> };
  const W2: W2Writer[] = [
    {
      id: "P3",
      stored: async (input) => {
        const r = await zalo(input);
        expect(r.created).toBe(true); // a new Zalo user resolves whatever its name
        return r.display_name;
      },
    },
    {
      id: "P4",
      stored: async (input) => {
        const r = await google(input);
        expect(r.outcome).toBe("login_success"); // a new Google subject signs in whatever its name
        return nameOf(r.person_id);
      },
    },
    { id: "M2", stored: guest },
  ];
  const BIDI_CONTROL = [
    0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069,
  ];
  /** Section 4's 16 Zs blanks: U+00A0, U+1680, U+2000-U+200A, U+202F, U+205F, U+3000. */
  const ZS_BLANKS = [
    0xa0,
    0x1680,
    ...Array.from({ length: 11 }, (_, i) => 0x2000 + i),
    0x202f,
    0x205f,
    0x3000,
  ];
  /** [cell, input, the stored value, or null for NULL]: section 7's P3, P4 and M2 SQL rows. */
  type Cell = [cell: string, input: string, stored: string | null];
  const inside =
    (cls: string) =>
    (cp: number): Cell => [`${cls} U+${hex(cp)} inside`, mix("Lan", cp, "Nguyen"), "LanNguyen"];
  const CELLS: Cell[] = [
    ...[0x01, 0x1f, 0x7f, 0x80, 0x9f].map(inside("Cc")),
    ...BIDI_CONTROL.map(inside("Bidi_Control")),
    ...[0x2028, 0x2029].map(inside("separator")),
    ["blank-only: NBSP", mix(0xa0), null],
    ["blank-only: U+3000", mix(0x3000), null],
    ["blank-only: the 16 Zs blanks", mix(...ZS_BLANKS), null],
    ["U+2800 only", mix(0x2800), null],
    ["U+2800 inside is removed", mix("Lan", 0x2800, "Nguyen"), "LanNguyen"],
    ["invisible-only", mix(0x200b, 0x3164, 0xe0001), null],
    ["invisible-only with spaces", mix(" ", 0x200b, " ", 0xfeff, " "), null],
    ["bidi-only (an override and an isolate)", mix(0x202e, 0x2066), null],
    ["ordinary", "Lan Nguyen", "Lan Nguyen"],
    [
      "ordinary: a Zs blank inside is kept (NBSP)",
      mix("Lan", 0xa0, "Nguyen"),
      mix("Lan", 0xa0, "Nguyen"),
    ],
    [
      "ordinary: the strip-and-trim result (NBSP, U+200B, U+3000)",
      mix(0xa0, "Lan", 0x200b, " Nguyen", 0x3000),
      "Lan Nguyen",
    ],
    ["edge: TAB at both edges is trimmed", mix(0x09, "Lan Nguyen", 0x09), "Lan Nguyen"],
    [
      "edge: U+2028 and U+2029 at the edges are trimmed",
      mix(0x2028, "Lan Nguyen", 0x2029),
      "Lan Nguyen",
    ],
    ["edge: TAB inside is removed", mix("Lan", 0x09, "Nguyen"), "LanNguyen"],
    [
      "edge: a blank left before a removed bidi is trimmed (NBSP, U+202E)",
      mix("Lan", 0xa0, 0x202e),
      "Lan",
    ],
  ];
  it.each(
    W2.flatMap((w) =>
      CELLS.map(([cell, input, stored]) => ({ name: `${w.id}: ${cell}`, w, input, stored })),
    ),
  )("L29-W2 $name", async ({ w, input, stored }) => {
    expect(cps(await w.stored(input))).toEqual(cps(stored));
  });
  it("L29-W2 P3: the 120 cut applies after the normalization", async () => {
    // Cut first, the override would take one of the 120 places and leave 119 a's.
    const r = await zalo(mix(0x202e, "a".repeat(120), 0x202c, "b"));
    expect(r.display_name).toBe("a".repeat(120));
  });
  it.each([0x20, 0x3000])(
    "L29-W2 P3: the 120 cut leaves a trailing Zs (code point %d): known residual, pinned as current behaviour (member-name-rule-residual-precision (f))",
    async (cp) => {
      const r = await zalo(mix("a".repeat(119), cp, "b"));
      const stored = Array.from(r.display_name ?? "", (c) => c.codePointAt(0));
      expect([stored.length, stored[stored.length - 1]]).toEqual([120, cp]);
    },
  );

  // L29-I1: every Cc, Cf, Zl and Zp scalar SQL text can hold (no U+0000; a superset of section 4's
  // R), alone and among visible text, then section 11's hostile names: each call completes, the P3
  // user resolves (created) and the P4 subject signs in (login_success), and nothing stores ''.
  it.each(["P3", "P4"])(
    "L29-I1 %s never raises on a hostile name",
    async (id) => {
      const control = /^[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]$/u;
      const every: number[] = [];
      for (let cp = 1; cp <= 0x10ffff; cp++) {
        if ((cp < 0xd800 || cp > 0xdfff) && control.test(String.fromCodePoint(cp))) every.push(cp);
      }
      const hostile = [
        mix("Lan", ...every, "Nguyen"),
        mix(...every),
        mix(0x202e, "Lan Nguyen", 0x202c),
        mix("Lan", 0x2028, "Nguyen"),
        mix(...ZS_BLANKS, 0x2800),
        mix(0x200b, 0x3164, 0xe0001),
      ];
      const w = W2.find((x) => x.id === id)!;
      for (const input of hostile) {
        expect(await w.stored(input)).not.toBe("");
      }
    },
    30_000,
  );

  // L29-I2: the identity is decided by the provider ids alone, so a hostile name, first or second,
  // gives what two clean names give: the same person (and account) and the same created or outcome pair.
  const HOSTILE = mix(0x202e, "Lan", 0x2028, "Nguyen", 0x01);
  it("L29-I2 P3: a hostile and a clean name resolve the same person, in either order", async () => {
    const pair = async (first: string, second: string) => {
      const userHash = `user-${randomUUID()}`;
      const a = await zalo(first, userHash);
      const b = await zalo(second, userHash);
      return { created: [a.created, b.created], same: a.person_id === b.person_id };
    };
    const clean = await pair("Lan Nguyen", "Lan Nguyen");
    expect(clean).toEqual({ created: [true, false], same: true });
    expect(await pair(HOSTILE, "Lan Nguyen")).toEqual(clean);
    expect(await pair("Lan Nguyen", HOSTILE)).toEqual(clean);
  });
  it("L29-I2 P4: a hostile and a clean name sign in to the same account and person, in either order", async () => {
    const pair = async (first: string, second: string) => {
      const subject = `gsub-${randomBytes(16).toString("hex")}`;
      const email = `glk-${randomBytes(10).toString("hex")}`;
      const a = await google(first, subject, email);
      const b = await google(second, subject, email);
      return {
        outcomes: [a.outcome, b.outcome],
        same: a.account_id === b.account_id && a.person_id === b.person_id,
      };
    };
    const clean = await pair("Lan Nguyen", "Lan Nguyen");
    expect(clean.same).toBe(true);
    expect(await pair(HOSTILE, "Lan Nguyen")).toEqual(clean);
    expect(await pair("Lan Nguyen", HOSTILE)).toEqual(clean);
  });

  // L29-I3: a NULL display name stays NULL (P3 and P4 ingress, M2's NULL source).
  it.each(W2)("L29-I3 $id: a NULL display name stays NULL", async ({ stored }) => {
    expect(await stored(null)).toBeNull();
  });
});

// L29-RC part two (unit U3, section 11): the ingress and copy definers 0070 re-creates, mode true.
// P3, P4 and M2 keep their owner, prosecdef, proconfig and ACL (the RC-ACL pattern above), and every
// call of the rule is the ingress one on the writer's own argument (M2: the copied source column).
describe("L29-RC P3, P4 and M2 keep their attributes and call member_name_apply_rule with mode true", () => {
  const RULE_SIG = "public.member_name_apply_rule(text, boolean)";
  const RC = [
    { fn: "zalo_identity_resolve", arg: "p_display_name" },
    { fn: "auth_login_google", arg: "p_display_name" },
    { fn: "create_guest_membership", arg: "p.display_name" },
  ].map((r) => ({ ...r, w: RECREATED.find((w) => fnName(w) === r.fn)! }));
  it.each(RC)("L29-RC $fn", async ({ arg, w }) => {
    const { rows } = await ctx.owner.query<Record<string, unknown>>(
      `SELECT p.prosecdef AS security_definer, p.proconfig AS config,
              p.proowner = h.proowner AS helper_owner, p.proowner = r.proowner AS rule_owner,
              p.proowner = anchor.proowner AS anchor_owner,
              ARRAY(SELECT a.privilege_type
                      FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                     WHERE a.grantee = p.proowner) AS owner_privileges,
              ARRAY(SELECT CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END
                           || ':' || a.privilege_type
                      FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                     WHERE a.grantee <> p.proowner ORDER BY 1) AS grants,
              p.prosrc AS src
         FROM pg_proc p, pg_proc h, pg_proc r, pg_proc anchor
        WHERE p.oid = $1::regprocedure AND h.oid = $2::regprocedure AND r.oid = $3::regprocedure
          AND anchor.oid = 'public.tenant_public_alias_set(uuid, uuid, text)'::regprocedure`,
      [w.sig, HELPER_SIG, RULE_SIG],
    );
    const { src, ...attrs } = rows[0]!;
    expect(attrs).toEqual({
      security_definer: true,
      config: [`search_path=${w.searchPath}`],
      helper_owner: true,
      rule_owner: true,
      anchor_owner: true,
      owner_privileges: ["EXECUTE"],
      grants: ["app:EXECUTE"],
    });
    // One call of the rule, the ingress one on the writer's own argument, and the L27 strip call it
    // replaced is gone (one definition of the rule, threat 6).
    const body = String(src);
    expect({
      calls: body.split("member_name_apply_rule(").length - 1,
      ingress: body.split(`public.member_name_apply_rule(${arg}, true)`).length - 1,
      strip: body.includes("public_name_strip_invisible("),
    }).toEqual({ calls: 1, ingress: 1, strip: false });
  });
});

// L29-C (unit U4a, readiness sections 8 and 11, D4): the exact text of the 0070 L29-CLEANUP block,
// replayed as MG replays 0069's: fixture rows seeded through the privileged path, transactions that
// are always rolled back, and a first run that absorbs what the blocks above left behind (the tenant
// names that run keeps are re-reported by every later run: `carried`).

/** A block of file (default 0070, tag L29): the text between its two <tag>-<name> marker lines, each present once. */
function l29Block(
  name: "OWNER-CHECK" | "CLEANUP",
  file = "0070_member_name_control_chars.sql",
  tag = "L29",
): string {
  const text = migration(file);
  const begin = `\n-- ${tag}-${name}-BEGIN\n`;
  const end = `\n-- ${tag}-${name}-END`;
  const from = text.indexOf(begin);
  const to = text.indexOf(end);
  if (from < 0 || to < from || text.includes(begin, from + 1) || text.includes(end, to + 1)) {
    throw new Error(
      `${file.slice(0, 4)}: expected one ${tag}-${name}-BEGIN line, then one ${tag}-${name}-END line`,
    );
  }
  return text.slice(from + begin.length, to);
}

describe("L29-C the 0070 L29-CLEANUP block normalizes the four columns in mode true", () => {
  const CLEANUP = l29Block("CLEANUP");
  const COLS = [
    ["persons", "display_name", "person", "display name"],
    ["memberships", "display_name", "membership", "display name"],
    ["tenants", "name", "tenant", "name"],
    ["sessions", "venue_address", "session", "venue address"],
  ] as const;
  type Table = (typeof COLS)[number][0];
  const KINDS = ["mixed", "blank", "invisible", "clean"] as const;
  type Kind = (typeof KINDS)[number];
  // mixed: a Bidi_Control, U+2029 and a Cc inside the text; blank: blank-looking code points, none
  // of them default-ignorable; invisible: default-ignorable only, which the 0069 block keeps.
  const VALUE: Record<Kind, string> = {
    mixed: mix("L29", 0x202e, " Mai", 0x2029, 0x7),
    blank: mix(0xa0, 0x2800, 0x3000),
    invisible: mix(0x200b, 0x2060),
    clean: "L29 Lan",
  };
  // What the block leaves: the rule's value, NULL when nothing visible is left, except tenants.name,
  // which keeps such a value as stored (D4). A clean value is no candidate.
  // (g) a kept NULL-mapped tenants.name: known residual, pinned as current behaviour (member-name-rule-residual-precision).
  const stored = (table: Table, k: Kind) =>
    k === "mixed" ? "L29 Mai" : k === "clean" || table === "tenants" ? VALUE[k] : null;
  const changed = (noun: string, what: string, id: string) =>
    `0070 cleanup: ${noun} ${id} ${what} normalized${noun === "session" ? " and re-projected" : ""}`;
  const left = (id: string) =>
    `0070 cleanup: tenant ${id} name left unchanged (no visible character after the rule)`;
  const closing = (p: number, m: number, t: number, s: number, l: number) =>
    `0070 cleanup: ${p} person names, ${m} membership names, ${t} tenant names changed, ${s} sessions changed and re-projected, ${l} tenant names left unchanged`;

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

  /** One club (clean name, approved alias) hosts a row of each kind per column, plus a hidden mixed
   *  address (hide_exact_address ON); every session is projected (version 1). */
  async function seed(c: pg.PoolClient) {
    const carried = (await run(c)).filter((n) =>
      n.endsWith("(no visible character after the rule)"),
    );
    const insert = async (statement: string, params: unknown[]) =>
      (await c.query<{ id: string }>(`${statement} RETURNING id`, params)).rows[0]!.id;
    const slug = () => `l29-${randomUUID()}`;
    const club = await insert(
      `INSERT INTO tenants (name, slug, public_alias, public_alias_status) VALUES ($1, $2, 'L29 Alias', 'approved')`,
      [VALUE.clean, slug()],
    );
    const session = (address: string, hide: boolean) =>
      insert(
        `INSERT INTO sessions (tenant_id, sport_id, starts_at, ends_at, timezone, venue_name, venue_address, area,
           price_amount, slots_max, visibility, join_policy, status, hide_exact_address)
         VALUES ($1, $2, now() + interval '7 days', now() + interval '7 days 2 hours', 'Asia/Ho_Chi_Minh',
           'San L29', $3, 'Quan 1', 50000, 10, 'public', 'open', 'open', $4)`,
        [club, ctx.badmintonSportId, address, hide],
      );
    const ids = { persons: {}, memberships: {}, tenants: {}, sessions: {} } as Record<
      Table,
      Record<Kind, string>
    >;
    for (const k of KINDS) {
      ids.persons[k] = await insert(`INSERT INTO persons (display_name) VALUES ($1)`, [VALUE[k]]);
      ids.memberships[k] = await insert(
        `INSERT INTO memberships (tenant_id, person_id, display_name) VALUES ($1, $2, $3)`,
        [club, ids.persons[k], VALUE[k]],
      );
      ids.tenants[k] =
        k === "clean"
          ? club
          : await insert(`INSERT INTO tenants (name, slug) VALUES ($1, $2)`, [VALUE[k], slug()]);
      ids.sessions[k] = await session(VALUE[k], false);
    }
    const hidden = await session(VALUE.mixed, true);
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

  /** id -> [ctid, stored value] of each fixture row (an UPDATE moves the ctid) and "public <id>" ->
   *  [version, venue_address] of each session's public row. */
  async function state(c: pg.PoolClient, f: Fixture): Promise<Record<string, unknown[]>> {
    const out: Record<string, unknown[]> = {};
    const sessions = [...Object.values(f.ids.sessions), f.hidden];
    for (const [table, col] of COLS) {
      const { rows } = await c.query<{ id: string; ctid: string; v: string | null }>(
        `SELECT id, ctid::text AS ctid, ${col} AS v FROM ${table} WHERE id = ANY($1::uuid[])`,
        [table === "sessions" ? sessions : Object.values(f.ids[table])],
      );
      for (const r of rows) out[r.id] = [r.ctid, r.v];
    }
    const { rows } = await c.query<{ id: string; version: number; v: string | null }>(
      `SELECT id, public_projection_version::int AS version, venue_address AS v
         FROM public_sessions WHERE id = ANY($1::uuid[])`,
      [sessions],
    );
    for (const r of rows) out[`public ${r.id}`] = [r.version, r.v];
    return out;
  }

  it("L29-C3 a second run rewrites no row, bumps no version and re-reports only the tenant names it keeps", async () => {
    await rolledBack(async (c) => {
      const f = await seed(c);
      await run(c);
      const before = await state(c, f);
      const notices = await run(c);
      expect(await state(c, f)).toEqual(before);
      expect(notices.sort()).toEqual(
        [
          left(f.ids.tenants.blank),
          left(f.ids.tenants.invisible),
          ...f.carried,
          closing(0, 0, 0, 0, 2 + f.carried.length),
        ].sort(),
      );
    });
  });

  it("L29-C4 normalizes seeded values in all four columns (tenants.name per D4), re-projects each changed session, names rows by id only", async () => {
    await rolledBack(async (c) => {
      const f = await seed(c);
      const before = await state(c, f);
      const notices = await run(c);
      const after = await state(c, f);
      for (const [table] of COLS) {
        for (const k of KINDS) {
          const id = f.ids[table][k];
          const v = stored(table, k);
          const moved = after[id]![0] !== before[id]![0]; // every UPDATE moves the ctid
          expect({ table, k, v: after[id]![1], moved }).toEqual({
            table,
            k,
            v,
            moved: v !== VALUE[k],
          });
        }
      }
      // Each changed visible address bumps its public row; the hidden one stays masked.
      const pub = (id: string) => [before[`public ${id}`], after[`public ${id}`]];
      const s = f.ids.sessions;
      expect([pub(s.mixed), pub(s.blank), pub(s.invisible), pub(s.clean)]).toEqual([
        [
          [1, VALUE.mixed],
          [2, "L29 Mai"],
        ],
        [
          [1, VALUE.blank],
          [2, null],
        ],
        [
          [1, VALUE.invisible],
          [2, null],
        ],
        [
          [1, VALUE.clean],
          [1, VALUE.clean],
        ],
      ]);
      expect([after[f.hidden]![1], pub(f.hidden)]).toEqual([
        "L29 Mai",
        [
          [1, null],
          [1, null],
        ],
      ]);
      expect(notices.sort()).toEqual(
        [
          ...COLS.flatMap(([table, , noun, what]) =>
            KINDS.filter((k) => stored(table, k) !== VALUE[k]).map((k) =>
              changed(noun, what, f.ids[table][k]),
            ),
          ),
          changed("session", "venue address", f.hidden),
          left(f.ids.tenants.blank),
          left(f.ids.tenants.invisible),
          ...f.carried,
          closing(3, 3, 1, 4, 2 + f.carried.length),
        ].sort(),
      );
      // No NOTICE carries fixture text: none of its words, no code point outside printable ASCII.
      expect(notices.filter((n) => /L29|Mai|Lan|[^ -~]/.test(n))).toEqual([]);
    });
  });
});

// L29-C1 and L29-C2 (unit U4b2, readiness sections 8 and 11): the exact text of the 0070
// L29-OWNER-CHECK and L29-CLEANUP blocks, replayed as RC-OWNER and MG replay 0069's, in transactions
// that are always rolled back.

describe("L29-C1 an owner mismatch fails the migration", () => {
  const OWNER_CHECK = l29Block("OWNER-CHECK");
  // One row per function the block names: the rule, then P2, T1, T2, P3, P4 and M2.
  const CELLS = [
    { fn: "member_name_apply_rule", sig: `${L29_RULE}(text, boolean)` },
    ...[
      "create_host_added_person",
      "tenant_provision",
      "tenant_profile_update",
      "zalo_identity_resolve",
      "auth_login_google",
      "create_guest_membership",
    ].map((fn) => ({ fn, sig: RECREATED.find((w) => fnName(w) === fn)!.sig })),
  ];
  // ownership()'s read over the helper and these seven: what a rolled-back move leaves as it was.
  const OWNERS = `SELECT p.oid::regprocedure::text AS fn, p.proowner::regrole::text AS owner, p.proacl::text AS acl
       FROM pg_proc p WHERE p.oid = ANY($1::regprocedure[]) ORDER BY 1`;
  const SIGS = [HELPER_SIG, ...CELLS.map((x) => x.sig)];
  it.each(CELLS)(
    "L29-C1 $fn: a no-op as applied; 42501 once its owner moves to readonly; rolled back, nothing changed",
    async ({ fn, sig }) => {
      const before = (await ctx.owner.query(OWNERS, [SIGS])).rows;
      expect(before).toHaveLength(8);
      await rolledBack(async (c) => {
        await c.query(OWNER_CHECK);
        expect((await c.query(OWNERS, [SIGS])).rows).toEqual(before);
        await c.query(`ALTER FUNCTION ${sig} OWNER TO readonly`);
        const err = await c.query(OWNER_CHECK).catch((e: unknown) => e);
        expect(err).toMatchObject({ code: "42501" });
        // As RC-OWNER: the message ends with "<fn>(<arguments without ')'>) (owner readonly)", fn
        // taken literally; plain string checks, no RegExp built from data.
        const msg = (err as Error).message;
        const head = `${fn}(`;
        const tail = ") (owner readonly)";
        expect(msg.startsWith("0070: not owned by "), msg).toBe(true);
        expect(msg.endsWith(tail), msg).toBe(true);
        const body = msg.slice(0, -tail.length);
        const at = body.lastIndexOf(head);
        expect(at, msg).toBeGreaterThanOrEqual(0);
        expect(body.slice(at + head.length), msg).not.toContain(")");
      });
      expect((await ctx.owner.query(OWNERS, [SIGS])).rows).toEqual(before);
    },
  );
});

describe("L41-C1 an owner mismatch fails the 0072 migration", () => {
  const OWNER_CHECK = l29Block(
    "OWNER-CHECK",
    "0072_member_name_definers_qualify_builtins.sql",
    "L41",
  );
  // One row per function the block checks against the helper's owner: the rule, the seven, tenant_public_alias_set.
  const CELLS = [
    { fn: "member_name_apply_rule", sig: `${L29_RULE}(text, boolean)` },
    ...RECREATED.map((w) => ({ fn: fnName(w), sig: w.sig })),
    { fn: "tenant_public_alias_set", sig: "public.tenant_public_alias_set(uuid, uuid, text)" },
  ];
  // ownership()'s read over the helper and these nine: what a rolled-back move leaves as it was.
  const OWNERS = `SELECT p.oid::regprocedure::text AS fn, p.proowner::regrole::text AS owner, p.proacl::text AS acl
       FROM pg_proc p WHERE p.oid = ANY($1::regprocedure[]) ORDER BY 1`;
  const SIGS = [HELPER_SIG, ...CELLS.map((x) => x.sig)];
  it("L41-C1 the block names exactly the ten by regprocedure: the helper's anchor and the nine in its array", () => {
    // Every quoted 'public.<name>(<arguments>)' literal in the block, by a static regex literal.
    const named = [...OWNER_CHECK.matchAll(/'(public\.\w+\([^')]*\))'/g)].map((m) => m[1] ?? "");
    expect(named.sort()).toEqual([...SIGS].sort());
  });
  it.each(CELLS)(
    "L41-C1 $fn: a no-op as applied; 42501 once its owner moves to readonly; rolled back, nothing changed",
    async ({ fn, sig }) => {
      const before = (await ctx.owner.query(OWNERS, [SIGS])).rows;
      expect(before).toHaveLength(10);
      await rolledBack(async (c) => {
        await c.query(OWNER_CHECK);
        expect((await c.query(OWNERS, [SIGS])).rows).toEqual(before);
        await c.query(`ALTER FUNCTION ${sig} OWNER TO readonly`);
        const err = await c.query(OWNER_CHECK).catch((e: unknown) => e);
        expect(err).toMatchObject({ code: "42501" });
        // As L29-C1: the message ends with "<fn>(<arguments without ')'>) (owner readonly)", fn
        // taken literally; plain string checks, no RegExp built from data.
        const msg = (err as Error).message;
        const head = `${fn}(`;
        const tail = ") (owner readonly)";
        expect(msg.startsWith("0072: not owned by "), msg).toBe(true);
        expect(msg.endsWith(tail), msg).toBe(true);
        const body = msg.slice(0, -tail.length);
        const at = body.lastIndexOf(head);
        expect(at, msg).toBeGreaterThanOrEqual(0);
        expect(body.slice(at + head.length), msg).not.toContain(")");
      });
      expect((await ctx.owner.query(OWNERS, [SIGS])).rows).toEqual(before);
    },
  );
});

describe("L29-C2 the cleanup fails closed and names ids and counts only", () => {
  const CLEANUP = l29Block("CLEANUP");

  it("L29-C2a guards each of the four tables with its own row_security_active clause, before the first loop", () => {
    const loop = CLEANUP.indexOf("FOR r IN");
    const clause = (t: string) =>
      `row_security_active('public.${t}') AND pg_relation_size('public.${t}') > 0`;
    expect(loop).toBeGreaterThan(0);
    expect(CLEANUP.split("row_security_active('").length - 1).toBe(4);
    for (const t of ["persons", "memberships", "tenants", "sessions"]) {
      expect(CLEANUP.slice(0, loop).split(clause(t)).length - 1, t).toBe(1);
    }
  });

  it("L29-C2b as app (NOSUPERUSER NOBYPASSRLS) over a non-empty table it fails closed with 42501 and changes nothing", async () => {
    await rolledBack(async (c) => {
      // A club and a session the block would rewrite (a Bidi_Control, U+2029 and a Cc in each), seeded
      // as L29-C seeds them, so sessions is non-empty here.
      const mixed = mix("L29", 0x202e, " Mai", 0x2029, 0x7);
      const club = (
        await c.query<{ id: string }>(
          `INSERT INTO tenants (name, slug, public_alias, public_alias_status) VALUES ($1, $2, 'L29 Alias', 'approved') RETURNING id`,
          [mixed, `l29-${randomUUID()}`],
        )
      ).rows[0]!.id;
      await c.query(
        `INSERT INTO sessions (tenant_id, sport_id, starts_at, ends_at, timezone, venue_name, venue_address, area,
           price_amount, slots_max, visibility, join_policy, status, hide_exact_address)
         VALUES ($1, $2, now() + interval '7 days', now() + interval '7 days 2 hours', 'Asia/Ho_Chi_Minh',
           'San L29', $3, 'Quan 1', 50000, 10, 'public', 'open', 'open', false)`,
        [club, ctx.badmintonSportId, mixed],
      );
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
      const notices: string[] = [];
      const onNotice = (n: { message?: string | undefined }) => notices.push(n.message ?? "");
      c.on("notice", onNotice);
      try {
        // The message pins the guard: the rule's owner-only EXECUTE would also be 42501.
        await expect(c.query(CLEANUP)).rejects.toMatchObject({
          code: "42501",
          message:
            "0070 cleanup: row security applies to app and persons, memberships, tenants or sessions holds rows it may not see; apply 0070 as the superuser migration role",
        });
      } finally {
        c.off("notice", onNotice);
      }
      // No NOTICE: it raised before its first loop reached a row, and a failed DO block keeps nothing.
      expect(notices).toEqual([]);
    });
  });

  it("L29-C2c every RAISE NOTICE passes only r.id or an n_ counter, one per placeholder", () => {
    const ALLOWED = ["r.id", "n_persons", "n_memberships", "n_tenants", "n_sessions", "n_left"];
    // Six NOTICEs and the guard's EXCEPTION: no other RAISE level reports anything.
    expect(CLEANUP.split("RAISE ").length - 1).toBe(7);
    // RAISE NOTICE '<format>', <arguments>; the format holds no quote, so the next quote closes it.
    const notices = CLEANUP.split("RAISE NOTICE ")
      .slice(1)
      .map((s) => {
        const close = s.indexOf("'", 1);
        const [lead, ...args] = s
          .slice(close + 1, s.indexOf(";", close))
          .split(",")
          .map((a) => a.trim());
        return { open: s.slice(0, 1), format: s.slice(1, close), lead, args };
      });
    expect(notices).toHaveLength(6);
    for (const n of notices) {
      const other = n.args.filter((a) => !ALLOWED.includes(a));
      expect({ open: n.open, lead: n.lead, arity: n.args.length, other }, n.format).toEqual({
        open: "'",
        lead: "",
        arity: n.format.split("%").length - 1,
        other: [],
      });
    }
  });
});

// L29-AG1 (unit U5c): public.member_name_apply_rule and its TypeScript twins agree on every Unicode
// scalar value in both modes (mode false = checkTypedName, mode true = normalizeExternalName, NULL =
// null), each scalar alone, at the end edge, inside visible text and, since lane L41 (readiness
// section 6 (h)), at the start edge: one linear scan on each side, no RegExp built from data (C11b).
// Excluded by name: U+0000, which PostgreSQL text cannot hold (D1e), and the surrogates
// U+D800..U+DFFF, which are not scalar values. The transfer is shrunk as C11a says: PostgreSQL
// returns each case's row count and only the rows where either result differs from the input, so a
// row it leaves out has both results equal to the input. Sharded as C12 says (an every-scalar test
// runs in at most about 3 s locally; CI runs it about 3x slower): each position scans 8 contiguous
// ranges of 0x22000 code points, one case per range with its own 30 s budget, and one cheap test
// proves the 8 ranges cover U+0001..U+10FFFF with no gap. EXECUTE is owner-only, so the query runs
// as the superuser, as L29-F's calls do.
describe("L29-AG1 member_name_apply_rule equals the TS rule over every scalar", () => {
  /** Every Unicode scalar value: 0x110000 code points minus the 0x800 surrogates, 1,112,064. */
  const SCALARS = 0x110000 - 0x800;
  /** The four values of each scalar c; the SQL CASE builds the same ones as p = 1, 2, 3, 4. */
  const POSITIONS = [
    { at: "alone", wrap: (c: string) => c },
    { at: "edge", wrap: (c: string) => `a${c}` },
    { at: "inside", wrap: (c: string) => `a${c}b` },
    { at: "start", wrap: (c: string) => `${c}a` },
  ] as const;
  /**
   * C12: shard k + 1 of 8 (k = 0..7) scans [k * 0x22000, (k + 1) * 0x22000 - 1], shard 1 from U+0001
   * (no U+0000, D1e). want is its scalar count, from the bounds alone: its code points minus the
   * surrogates U+D800..U+DFFF inside it.
   */
  const SHARDS = Array.from({ length: 8 }, (_, k) => {
    const lo = k === 0 ? 1 : k * 0x22000;
    const hi = (k + 1) * 0x22000 - 1;
    const want = hi - lo + 1 - Math.max(0, Math.min(hi, 0xdfff) - Math.max(lo, 0xd800) + 1);
    return { shard: k + 1, lo, hi, want };
  });
  type Pair = readonly [modeFalse: string | null, modeTrue: string | null];
  type Row = {
    total: number;
    diffs: [n: number, modeFalse: string | null, modeTrue: string | null][];
  };
  const show = (s: string | null) => JSON.stringify(cps(s));

  it("L29-AG1 the 8 shards cover U+0001..U+10FFFF with no gap: every scalar but U+0000, once", () => {
    // Shard k + 1 must start right after shard k ends; a gap would leave scalars unscanned.
    const gaps = SHARDS.slice(1)
      .filter((s, k) => s.lo !== SHARDS[k]!.hi + 1)
      .map((s) => s.shard);
    expect({
      shards: SHARDS.length,
      first: SHARDS[0]!.lo,
      last: SHARDS[SHARDS.length - 1]!.hi,
      gaps,
      sum: SHARDS.reduce((sum, s) => sum + s.want, 0),
    }).toEqual({ shards: 8, first: 1, last: 0x10ffff, gaps: [], sum: SCALARS - 1 });
  });

  it.each(POSITIONS.flatMap((pos, i) => SHARDS.map((s) => ({ ...pos, p: i + 1, ...s }))))(
    "L29-AG1 every scalar but U+0000 $at shard $shard of 8: mode false equals checkTypedName, mode true equals normalizeExternalName",
    async ({ at, wrap, p, lo, hi, want }) => {
      const client = await ctx.superuserDb.pool.connect();
      // Sent here, before the TypeScript scan below, so PostgreSQL and Node scan at the same time.
      const pending = client
        .query<Row>(
          `SELECT count(*)::int AS total,
                  coalesce(json_agg(json_build_array(n, r0, r1))
                             FILTER (WHERE r0 IS DISTINCT FROM v OR r1 IS DISTINCT FROM v), '[]') AS diffs
             FROM (SELECT n, x.v,
                          public.member_name_apply_rule(x.v, false) AS r0,
                          public.member_name_apply_rule(x.v, true) AS r1
                     FROM generate_series($2::int, $3::int) AS n -- the shard's [lo, hi]: no U+0000 (D1e)
                    CROSS JOIN LATERAL (VALUES (CASE $1::int WHEN 1 THEN chr(n) WHEN 2 THEN 'a' || chr(n)
                                                WHEN 4 THEN chr(n) || 'a'
                                                ELSE 'a' || chr(n) || 'b' END)) AS x(v)
                    WHERE n NOT BETWEEN 55296 AND 57343) AS s -- no surrogates U+D800..U+DFFF`,
          [p, lo, hi],
        )
        .finally(() => client.release());
      const mine = new Map<number, Pair>();
      let tsRows = 0;
      // The shard's [lo, hi], the surrogates skipped: the same scalars as the SQL scan.
      for (let n = lo; n <= hi; n += 1) {
        if (n >= 0xd800 && n <= 0xdfff) continue;
        const v = wrap(String.fromCodePoint(n));
        const pair: Pair = [checkTypedName(v), normalizeExternalName(v)];
        tsRows += 1;
        if (pair[0] !== v || pair[1] !== v) mine.set(n, pair);
      }
      const theirs = (await pending).rows[0]!;
      const theirDiffs = new Map<number, Pair>();
      for (const [n, r0, r1] of theirs.diffs) theirDiffs.set(n, [r0, r1]);
      let modeFalse = 0;
      let modeTrue = 0;
      const first: string[] = [];
      for (const n of new Set([...mine.keys(), ...theirDiffs.keys()])) {
        const v = wrap(String.fromCodePoint(n));
        const [want0, want1] = mine.get(n) ?? [v, v];
        const [got0, got1] = theirDiffs.get(n) ?? [v, v];
        if (got0 !== want0) modeFalse += 1;
        if (got1 !== want1) modeTrue += 1;
        if ((got0 !== want0 || got1 !== want1) && first.length < 20) {
          first.push(
            `${at} U+${hex(n)}: sql ${show(got0)} ${show(got1)}, ts ${show(want0)} ${show(want1)}`,
          );
        }
      }
      expect({ sqlRows: theirs.total, tsRows, modeFalse, modeTrue, first }).toEqual({
        sqlRows: want,
        tsRows: want,
        modeFalse: 0,
        modeTrue: 0,
        first: [],
      });
    },
    30_000,
  );
});

describe("L29-TW P2/M1 addMemberToSession refuses with checkTypedName (roster-service.ts)", () => {
  const fx = fixtures(() => ctx);
  const world = { tenantId: "", actorPersonId: "", sessionId: "", source: "host_add" as const };
  beforeAll(async () => {
    world.tenantId = await fx.seedTenant();
    world.actorPersonId = await fx.seedAdmin(world.tenantId, "owner");
    world.sessionId = await fx.seedSession(world.tenantId, {});
  }, 30_000);
  const add = (member: { displayName: string }) =>
    addMemberToSession(ctx.appDb.db, { ...world, commandId: nextCommandId(), member });
  const seen = () =>
    fx.row("SELECT (SELECT count(*) FROM persons) p, (SELECT count(*) FROM memberships) m");
  it.each<[string, string, string | null]>([
    ["Cc U+0001 inside", mix("Mi", 1, "nh"), null],
    ["Bidi_Control U+202E inside", mix("Mi", 0x202e, "nh"), null],
    ["U+2028 inside", mix("Mi", 0x2028, "nh"), null],
    ["U+00A0 only", mix(0xa0), null],
    ["U+3000 only", mix(0x3000), null],
    ["U+2800 only", mix(0x2800), null],
    ["U+200B only", mix(0x200b), null],
    ["U+0000 inside", mix("Mi", 0, "nh"), null],
    ["ordinary Minh Anh", "Minh Anh", "Minh Anh"],
    ["edge U+0009 before and U+2028 after", mix(9, "Minh", 0x2028), "Minh"],
  ])("host add %s", async (_label, sent, stored) => {
    const before = await seen();
    const out = await add({ displayName: sent }).catch((e: unknown) => e);
    if (stored === null) {
      expect(out, "expected the host add to reject").toBeInstanceOf(RosterMoneyError);
      expect((out as RosterMoneyError).code).toBe("INVALID_INPUT");
      expect(await seen()).toEqual(before);
      return;
    }
    const m = await fx.row(
      `SELECT m.display_name, p.display_name AS person_name
       FROM memberships m JOIN persons p ON p.id = m.person_id WHERE m.id = $1`,
      [(out as { membershipId: string }).membershipId],
    );
    expect(m).toMatchObject({ display_name: stored, person_name: stored });
  });
});

describe("L29-TW T2 validatePatch refuses with checkTypedName (club-config-validation.ts)", () => {
  const run = (name: string) => {
    try {
      return validatePatch({ name }).name;
    } catch (e) {
      return e instanceof ClubConfigError ? e.code : e;
    }
  };
  it.each([
    ["Cc U+0001 inside", mix("WA", 1, "O"), "INVALID_INPUT"],
    ["Bidi_Control U+202E inside", mix("WA", 0x202e, "O"), "INVALID_INPUT"],
    ["U+2028 inside (was accepted)", mix("WA", 0x2028, "O"), "INVALID_INPUT"],
    ["U+00A0 only", mix(0xa0), "INVALID_INPUT"],
    ["U+2800 only (was accepted)", mix(0x2800), "INVALID_INPUT"],
    ["U+200B only", mix(0x200b), "INVALID_INPUT"],
    ["U+0000 inside", mix("WA", 0, "O"), "INVALID_INPUT"],
    ["ordinary WAO Club", "WAO Club", "WAO Club"],
    ["edge U+0009 before and U+2028 after", mix(9, "WAO", 0x2028), "WAO"],
    ["121 characters", "a".repeat(121), "INVALID_INPUT"],
  ])("T2 %s", (_label, sent, want) => expect(run(sent)).toBe(want));
});

// L29-TW (unit U7d, N2): P3's TS entry point; the shared normalizer runs before the SQL call.
describe("L29-TW P3 resolveZaloIdentity normalizes the Zalo name and never raises (zalo-ingress.ts)", () => {
  const resolve = (userHash: string, displayName: string | null) =>
    withTenant(ctx.appDb.db, ctx.tenantA, (tx) =>
      resolveZaloIdentity(tx, {
        tenantId: ctx.tenantA,
        botId: bot,
        scopeHash: "scope-mn",
        userHash,
        userIdEnc: Buffer.from("enc", "utf8"),
        displayName,
      }),
    );
  it.each([
    ["U+0000 inside (the bind cell, was 22021)", mix("Mi", 0, "nh"), "Minh"],
    ["Cc U+0001 inside", mix("Mi", 1, "nh"), "Minh"],
    ["Bidi_Control U+202E inside", mix("Mi", 0x202e, "nh"), "Minh"],
    ["U+2028 inside", mix("Mi", 0x2028, "nh"), "Minh"],
    ["U+00A0 only", mix(0xa0), null],
    ["U+2800 only", mix(0x2800), null],
    ["U+200B only", mix(0x200b), null],
    ["ordinary Minh Anh", "Minh Anh", "Minh Anh"],
    ["edge U+0009 before and U+2028 after", mix(9, "Minh", 0x2028), "Minh"],
  ])("P3 %s", async (_label, sent, want) => {
    const u = `user-${randomUUID()}`;
    const { personId, channelIdentityId } = await resolve(u, want); // clean first resolve
    expect(await resolve(u, sent)).toMatchObject({ personId, channelIdentityId, created: false });
    const r = await resolve(`user-${randomUUID()}`, sent); // creation stores the normalized name
    expect(r.created).toBe(true);
    expect(cps(r.displayName)).toEqual(cps(want));
    expect(cps(await nameOf(r.personId))).toEqual(cps(want));
  });
});

describe("L29-TW T1 provisionTenant refuses with checkTypedName (auth.ts)", () => {
  it.each([
    ["Cc U+0001 inside", mix("WAO", 1, " Club"), null],
    ["Bidi_Control U+202E inside", mix("WAO", 0x202e, " Club"), null],
    ["U+2028 inside", mix("WAO", 0x2028, " Club"), null],
    ["U+00A0 only", mix(0xa0), null],
    ["U+2800 only", mix(0x2800), null],
    ["U+200B only", mix(0x200b), null],
    ["U+0000 inside (the bind cell, was 22021)", mix("WAO", 0, " Club"), null],
    ["ordinary WAO Club", "WAO Club", "WAO Club"],
    ["edge U+0009 before and U+2028 after", mix(9, "WAO", 0x2028), "WAO"],
  ])("T1 %s", async (_label, sent, want) => {
    const slug = `l29-tw-t1-${randomBytes(4).toString("hex")}`;
    const { personId } = await seedPersonAccount(ctx.owner, slug);
    const made = provisionTenant(ctx.appPool, { slug, name: sent, personId });
    await (want === null ? expect(made).rejects.toMatchObject({ code: "22023" }) : made);
    const { rows } = await ctx.owner.query(`SELECT name FROM tenants WHERE slug = $1`, [slug]);
    const stored = rows.map((r: { name: string }) => cps(r.name));
    expect(stored).toEqual(want === null ? [] : [cps(want)]);
  });
});

describe("L29-TW V1/V2 createSession and updateSession store venue_address by the shared check (session-service.ts)", () => {
  const day = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const createV = (venueAddress: string | null) =>
    createSession(ctx.appDb.db, {
      tenantId: ctx.tenantA,
      commandId: randomUUID(),
      input: {
        sportId: ctx.badmintonSportId,
        startsAt: new Date(day),
        endsAt: new Date(day + 2 * 60 * 60 * 1000),
        timezone: "Asia/Ho_Chi_Minh",
        priceAmount: 120000,
        venueAddress,
      },
    });
  const countSessions = async () =>
    ((await ctx.owner.query(`SELECT count(*)::int AS n FROM sessions`)).rows[0] as { n: number }).n;
  const storedAddress = async (id: string) =>
    (
      (await ctx.owner.query(`SELECT venue_address FROM sessions WHERE id = $1`, [id])).rows[0] as {
        venue_address: string | null;
      }
    ).venue_address;
  // [label, sent, error code or null, stored value when no error]
  it.each<[string, string, string | null, string | null]>([
    ["Cc U+0001 inside", mix("12 Nguyen", 1, "Trai"), "INVALID_TEXT_FIELD", null],
    ["Bidi_Control U+202E inside", mix("12 Nguyen", 0x202e, "Trai"), "INVALID_TEXT_FIELD", null],
    ["U+2028 inside", mix("12 Nguyen", 0x2028, "Trai"), "INVALID_TEXT_FIELD", null],
    ["U+2800 only", mix(0x2800), "INVALID_TEXT_FIELD", null],
    ["U+00A0 only", mix(0xa0), null, null],
    ["U+3000 only", mix(0x3000), null, null],
    ["U+200B only", mix(0x200b), null, null],
    ["empty string", "", null, null],
    ["ordinary with outer spaces", " 12 Nguyen Trai ", null, "12 Nguyen Trai"],
    [
      "edge U+0009 before and U+2028 after",
      mix(9, "12 Nguyen Trai", 0x2028),
      null,
      "12 Nguyen Trai",
    ],
  ])("V1 createSession %s", async (_label, sent, code, want) => {
    const before = await countSessions();
    const out = await createV(sent).catch((e: unknown) => e);
    if (code !== null) {
      expect((out as { code?: unknown }).code, "expected createSession to reject").toBe(code);
      expect(await countSessions()).toBe(before);
      return;
    }
    expect(await storedAddress((out as { sessionId: string }).sessionId)).toBe(want);
  });
  it("V2 updateSession stores a U+00A0-only venue_address as NULL", async () => {
    const made = await createV("12 Nguyen Trai");
    await updateSession(ctx.appDb.db, {
      tenantId: ctx.tenantA,
      commandId: randomUUID(),
      input: { sessionId: made.sessionId, expectedVersion: made.version, venueAddress: mix(0xa0) },
    });
    expect(await storedAddress(made.sessionId)).toBeNull();
  });
});

describe("L41-PT: a pg_temp.text domain planted by the caller does not reach the name rule", () => {
  // Class: a caller-planted pg_temp type shadowing pg_catalog.text inside the name rule (RO-L41-1 item 1).
  // With search_path=pg_catalog alone the session's temp schema is searched first for type names, so the
  // rule's DECLARE block raised 23514, also under a definer; 0072 lists pg_temp last. Every phase runs on a
  // NEW backend: PL/pgSQL keeps one compiled body per backend, and a reused one replays an earlier compile.
  const INPUT = "Lan Nguyen";
  const PLANT = `CREATE DOMAIN pg_temp.text AS pg_catalog.text CHECK (VALUE IS NULL)`;
  const RULE = "public.member_name_apply_rule(pg_catalog.text, boolean)";
  const APPLY = `SELECT public.member_name_apply_rule($1, false) AS r_false,
                        public.member_name_apply_rule($1, true) AS r_true`;
  /** A new backend from `config` (never a pool's idle one), pushed to `open` for the caller's finally. */
  const freshBackend = async (config: pg.ClientConfig, open: pg.Client[]) => {
    const { default: pgRuntime } = await import("pg");
    const client = new pgRuntime.Client(config);
    open.push(client);
    await client.connect();
    const { rows } = await client.query<{ pid: number }>(`SELECT pg_backend_pid() AS pid`);
    return { client, pid: rows[0]!.pid };
  };
  /** create_host_added_person as app on `client`, scoped the way withTenant scopes it; the stored name. */
  const hostAdds = async (client: pg.Client): Promise<string | null> => {
    await client.query("BEGIN");
    let id: string;
    try {
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [ctx.tenantA]);
      const { rows } = await client.query<{ id: string }>(
        `SELECT create_host_added_person($1::uuid, $2::uuid, $3) AS id`,
        [ctx.tenantA, host, INPUT],
      );
      id = rows[0]!.id;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    await client.query("COMMIT");
    return nameOf(id);
  };

  it("L41-PT A-C under the plant the writer and the rule return the unplanted result, each on a new backend", async () => {
    const open: pg.Client[] = [];
    try {
      // A: a new app backend, no plant.
      const a = await freshBackend(ctx.appPool.options, open);
      const storedA = await hostAdds(a.client);
      expect(storedA).toBe(INPUT);
      // B: a new app backend plants the domain, then the same writer with the same input.
      const b = await freshBackend(ctx.appPool.options, open);
      await b.client.query(PLANT);
      expect(await hostAdds(b.client)).toBe(storedA);
      // C: a new superuser backend plants the domain and calls the owner-only rule directly.
      const unplanted = await ctx.owner.query(APPLY, [INPUT]);
      const c = await freshBackend(ctx.superuserDb.pool.options, open);
      await c.client.query(PLANT);
      expect((await c.client.query(APPLY, [INPUT])).rows).toEqual(unplanted.rows);
      expect(new Set([a.pid, b.pid, c.pid]).size).toBe(3);
    } finally {
      await Promise.all(open.map((client) => client.end()));
    }
  }, 30_000);

  it("L41-PT D with the base attribute (search_path=pg_catalog) the planted writer call raises 23514", async () => {
    const open: pg.Client[] = [];
    await ctx.owner.query(`ALTER FUNCTION ${RULE} SET search_path = pg_catalog`);
    try {
      const d = await freshBackend(ctx.appPool.options, open);
      await d.client.query(PLANT);
      expect(await hostAdds(d.client).then(() => "stored", sqlstate)).toBe("23514");
    } finally {
      await ctx.owner.query(`ALTER FUNCTION ${RULE} SET search_path = pg_catalog, pg_temp`);
      await Promise.all(open.map((client) => client.end()));
      const { rows } = await ctx.owner.query<{ config: string[] }>(
        `SELECT proconfig AS config FROM pg_proc WHERE oid = $1::regprocedure`,
        [RULE],
      );
      expect(rows).toEqual([{ config: ["search_path=pg_catalog, pg_temp"] }]);
    }
  }, 30_000);
});

// L41-UV (RO-L41-1 item 4): prints the runner's Node, Unicode and ICU versions to the CI log. Only a
// Unicode version older than 17.0 fails here: TX-ALL and L29-AG1 stay the per-code-point check.
it("L41-UV the runner reports its Unicode version, 17.0 or newer", () => {
  const { node, unicode, icu } = process.versions;
  console.info(`L41-UV runner node=${node} unicode=${unicode} icu=${icu}`);
  // Major then minor as numbers, no RegExp; a missing or unparsable value fails (0 or NaN).
  const [major = NaN, minor = 0] = (unicode ?? "").split(".").map(Number);
  expect(major > 17 || (major === 17 && minor >= 0), `unicode=${unicode} is older than 17.0`).toBe(
    true,
  );
  if (major > 17 || minor > 0) {
    console.warn(
      `L41-UV unicode=${unicode} is newer than 17.0; TX-ALL and L29-AG1 stay the per-code-point check`,
    );
  }
});

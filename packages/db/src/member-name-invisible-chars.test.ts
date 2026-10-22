/**
 * L27 (owner decision item 6, 2026-10-22): the SQL layer of migration 0069 for the member-facing names
 * (docs/sessions/web-mvp-phase3-readiness-p3-strip-invisible-member-names.md, sections 6, 7 and 11).
 *   MN  rows R1-R5 of the section 6 decision table for the four persons.display_name definers that
 *       0069 re-creates (P1 person_profile_update, P2 create_host_added_person, P3
 *       zalo_identity_resolve, P4 auth_login_google), each called the way its TypeScript caller calls
 *       it, as role `app`; ctx.owner seeds the fixtures and reads the stored value back.
 * Inputs are built from code points (String.fromCodePoint), never pasted.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
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

async function insertPerson(name: string): Promise<string> {
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

// End of the MN block. Units U2b (RC-BODY, RC-ACL, RC-OWNER) and U2c (MG) append their describe
// blocks below this line, reusing ctx and the helpers above.

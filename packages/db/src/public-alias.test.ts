import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "./client.js";
import { ClubConfigError } from "./club-config.js";
import { getPublicAlias, setPublicAlias, validatePublicAlias } from "./public-alias.js";
import { setupRlsTestContext, type RlsTestContext } from "./test-harness.js";

// 0060 (tenant public alias) as the real roles app / app_worker / readonly and the trusted owner
// path (ctx.owner = the migration owner). Real PG; DATABASE_URL_TEST required.
let ctx: RlsTestContext;
const ROLES = ["app", "app_worker", "readonly"] as const;
type Role = (typeof ROLES)[number];
type Row = Record<string, unknown>;
// Names that must never appear in any value the alias functions return (A-26).
const TENANT_NAME = "Secret Tenant Name";
const PERSON_NAME = "Secret Person Name";
const ch = (cp: number) => String.fromCodePoint(cp);
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const EMOJI = ch(0x1f600);

// One shared sample set (A-4, A-12): [label, input, stored], stored = the stripped, trimmed value
// both layers store, or null = refused. Strip first (L23, R D3): U+200B, U+3164 and U+00AD are
// STRIP code points, so embedded they are removed (once refused); alone they leave an empty alias.
const REFUSED_CPS = [0x202e, 0x0007, 0x2028, 0x2800];
const STRIPPED_CPS = [0x200b, 0x3164, 0x00ad];
const SAMPLES: [string, string, string | null][] = [
  ["empty", "", null],
  ["spaces only", "   ", null],
  ["61 code points", "x".repeat(61), null],
  ["61 emoji", EMOJI.repeat(61), null],
  ["U+FE0F alone", ch(0xfe0f), null],
  ...REFUSED_CPS.flatMap((cp): [string, string, string | null][] => [
    [`U+${cp.toString(16)} alone`, ch(cp), null],
    [`U+${cp.toString(16)} embedded`, `CLB${ch(cp)}Q7`, null],
  ]),
  ...STRIPPED_CPS.flatMap((cp): [string, string, string | null][] => [
    [`U+${cp.toString(16)} alone`, ch(cp), null],
    [`U+${cp.toString(16)} embedded`, `CLB${ch(cp)}Q7`, "CLBQ7"],
  ]),
  ["60 code points", "y".repeat(60), "y".repeat(60)],
  ["60 emoji", EMOJI.repeat(60), EMOJI.repeat(60)],
  ["vietnamese", "CLB Cầu Lông Quận 7", "CLB Cầu Lông Quận 7"],
  ["emoji", `Smash ${EMOJI}`, `Smash ${EMOJI}`],
  ["combining mark", `Cafe${ch(0x301)} Club`, `Cafe${ch(0x301)} Club`],
  // The owner rule's consequence (R D11): U+FE0F is stripped, the heart renders as text.
  ["emoji + U+FE0F", `${ch(0x2764)}${ch(0xfe0f)} Club`, `${ch(0x2764)} Club`],
];

// The L23 decision table for the alias (R section 6, rows R1-R5): [input, stored | null].
const ZWJ = ch(0x200d);
const ALIAS_TABLE: [string, [string, string | null][]][] = [
  [
    "R1 no STRIP or REFUSE code point: unchanged (trimmed as today)",
    [
      ["  CLB Cầu Lông Q7  ", "CLB Cầu Lông Q7"],
      [`Smash ${EMOJI}`, `Smash ${EMOJI}`],
    ],
  ],
  [
    "R2 STRIP code points among visible text: stored without them, stripped before the trim",
    [
      ...[0x200b, 0x00ad, 0x3164, 0xfe00, 0xe0001, 0x2065].map((cp): [string, string] => [
        `CLB${ch(cp)} Q7`,
        "CLB Q7",
      ]),
      [`${ch(0x200b)} CLB Q7`, "CLB Q7"],
    ],
  ],
  [
    "R3 only STRIP code points, or them plus spaces: refused like an empty alias",
    [
      [ch(0x200b), null],
      [`${ch(0x200b)}${ch(0xfe0f)}${ch(0xe0001)}`, null],
      [` ${ch(0x3164)} ${ch(0x00ad)} `, null],
      ["", null],
    ],
  ],
  [
    "R4 U+FE0F and U+200D inside emoji sequences: stripped (the owner rule, R D11)",
    [
      [`${ch(0x2764)}${ch(0xfe0f)} Club`, `${ch(0x2764)} Club`],
      [
        `${ch(0x1f468)}${ZWJ}${ch(0x1f469)}${ZWJ}${ch(0x1f467)} Club`,
        `${ch(0x1f468)}${ch(0x1f469)}${ch(0x1f467)} Club`,
      ],
    ],
  ],
  [
    "R5 control, bidi, line separator or braille blank: refused as today, a strip launders none",
    [
      ...[0x0007, 0x202e, 0x2028, 0x2800].map((cp): [string, null] => [`CLB${ch(cp)}Q7`, null]),
      [`CLB${ch(0x200b)}${ch(0x202e)}Q7`, null],
    ],
  ],
];
/** Code points in hex, so a failing comparison shows the invisible ones. */
const cps = (s: string | null) =>
  s === null ? null : [...s].map((c) => c.codePointAt(0)!.toString(16));

const pool = (r: Role): pg.Pool =>
  r === "app" ? ctx.appPool : r === "app_worker" ? ctx.workerPool : ctx.readonlyPool;
const sqlState = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: unknown) => String((e as { code?: string }).code),
  );

async function person(name = PERSON_NAME): Promise<string> {
  const { rows } = await ctx.owner.query<{ id: string }>(
    `INSERT INTO persons (display_name) VALUES ($1) RETURNING id`,
    [name],
  );
  return rows[0]!.id;
}
async function admin(tenantId: string, role: string, active = true): Promise<string> {
  const id = await person();
  await ctx.owner.query(
    `INSERT INTO tenant_admins (tenant_id, platform, platform_user_lookup_hash, role, active)
     VALUES ($1, 'web', $2, $3, $4)`,
    [tenantId, id, role, active],
  );
  return id;
}
/** A person with an ACTIVE membership (a player) in the tenant and no tenant_admins row. */
async function member(tenantId: string): Promise<string> {
  const id = await person();
  await ctx.owner.query(
    `INSERT INTO memberships (tenant_id, person_id, status) VALUES ($1, $2, 'active')`,
    [tenantId, id],
  );
  return id;
}
async function club(): Promise<{ tenantId: string; ownerId: string }> {
  const { rows } = await ctx.owner.query<{ id: string }>(
    `INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id`,
    [`${TENANT_NAME} ${randomUUID()}`, `pa-${randomUUID()}`],
  );
  const tenantId = rows[0]!.id;
  return { tenantId, ownerId: await admin(tenantId, "owner") };
}
/** One statement as `role` in its own transaction, with app.tenant_id = guc when given. */
async function asRole(role: Role, guc: string | null, sql: string, params: unknown[] = []) {
  const c = await pool(role).connect();
  try {
    await c.query("BEGIN");
    if (guc) await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [guc]);
    const { rows } = await c.query<Row>(sql, params);
    await c.query("COMMIT");
    return rows;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
const setAlias = (tenantId: string, actor: string, alias: string, guc: string | null = tenantId) =>
  asRole("app", guc, `SELECT * FROM tenant_public_alias_set($1, $2, $3)`, [tenantId, actor, alias]);
const decide = async (tenantId: string, decision: string, digest: string, by = "owner-cli") =>
  (
    await ctx.owner.query<Row>(`SELECT * FROM tenant_public_alias_decide($1, $2, $3, $4)`, [
      tenantId,
      decision,
      digest,
      by,
    ])
  ).rows;
const snapshot = async (tenantId: string) =>
  (
    await ctx.owner.query<Row>(
      `SELECT t.public_alias, t.public_alias_status,
              (SELECT count(*)::int FROM tenant_public_alias_audit a WHERE a.tenant_id = t.id) AS audits,
              (SELECT count(*)::int FROM outbox_events o WHERE o.aggregate_id = t.id) AS events
         FROM tenants t WHERE t.id = $1`,
      [tenantId],
    )
  ).rows[0]!;
const events = async (tenantId: string) =>
  (
    await ctx.owner.query<{ sequence: number; type: string; payload: unknown }>(
      `SELECT sequence, type, payload FROM outbox_events
        WHERE aggregate_type = 'tenant' AND aggregate_id = $1 ORDER BY sequence`,
      [tenantId],
    )
  ).rows;
const audits = async (tenantId: string) =>
  (
    await ctx.owner.query<Row>(
      `SELECT decision, alias, decided_by FROM tenant_public_alias_audit
        WHERE tenant_id = $1 ORDER BY decided_at`,
      [tenantId],
    )
  ).rows;
/** Wait until backend `pid` blocks on a lock (polled from a connection outside any transaction). */
async function blocked(pid: number) {
  for (let i = 0; i < 200; i++) {
    const { rows } = await ctx.owner.query<{ w: string | null }>(
      `SELECT wait_event_type AS w FROM pg_stat_activity WHERE pid = $1`,
      [pid],
    );
    if (rows[0]?.w === "Lock") return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`backend ${pid} never waited on a lock`);
}

beforeAll(async () => {
  ctx = await setupRlsTestContext("plexco_public_alias");
}, 120_000);
afterAll(async () => {
  await ctx?.teardown();
});

describe("0060 set definer as app (A-1..A-5, A-22)", () => {
  it("A-1: a content.manage caller stores the trimmed alias as pending with exactly one event", async () => {
    const { tenantId, ownerId } = await club();
    expect(await setAlias(tenantId, ownerId, "  CLB Cầu Lông Q7  ")).toEqual([
      { public_alias: "CLB Cầu Lông Q7", public_alias_status: "pending", changed: true },
    ]);
    expect(await snapshot(tenantId)).toEqual({
      public_alias: "CLB Cầu Lông Q7",
      public_alias_status: "pending",
      audits: 0,
      events: 1,
    });
    expect(await events(tenantId)).toEqual([
      { sequence: 1, type: "tenant.public_alias_set", payload: { status: "pending" } },
    ]);
  });

  it("A-2: an edit after approval is pending again; events set, approved, set are sequences 1, 2, 3", async () => {
    const { tenantId, ownerId } = await club();
    await setAlias(tenantId, ownerId, "Alias A");
    await decide(tenantId, "approved", sha("Alias A"));
    expect(await setAlias(tenantId, ownerId, "Alias B")).toEqual([
      { public_alias: "Alias B", public_alias_status: "pending", changed: true },
    ]);
    expect((await events(tenantId)).map((e) => [e.sequence, e.type])).toEqual([
      [1, "tenant.public_alias_set"],
      [2, "tenant.public_alias_approved"],
      [3, "tenant.public_alias_set"],
    ]);
  });

  it("A-3: from rejected, the same trimmed text is a no-op and a different text is pending", async () => {
    const { tenantId, ownerId } = await club();
    await setAlias(tenantId, ownerId, "Alias A");
    await decide(tenantId, "rejected", sha("Alias A"));
    const before = await snapshot(tenantId);
    expect(await setAlias(tenantId, ownerId, " Alias A ")).toEqual([
      { public_alias: "Alias A", public_alias_status: "rejected", changed: false },
    ]);
    expect(await snapshot(tenantId)).toEqual(before);
    expect(await setAlias(tenantId, ownerId, "Alias C")).toEqual([
      { public_alias: "Alias C", public_alias_status: "pending", changed: true },
    ]);
    expect((await snapshot(tenantId)).events).toBe((before.events as number) + 1);
  });

  it("A-4: every refused sample raises 22023 with zero writes; accepted samples are stored stripped", async () => {
    const { tenantId, ownerId } = await club();
    for (const [label, input, stored] of SAMPLES) {
      const before = await snapshot(tenantId);
      expect(await sqlState(setAlias(tenantId, ownerId, input)), label).toBe(
        stored === null ? "22023" : "ok",
      );
      if (stored === null) expect(await snapshot(tenantId), label).toEqual(before);
      else
        expect(cps((await snapshot(tenantId)).public_alias as string), label).toEqual(cps(stored));
    }
    expect(await sqlState(setAlias(tenantId, ownerId, null as unknown as string))).toBe("22023");
  });

  it("A-5: every deny reason is 42501 with zero writes", async () => {
    const a = await club();
    const b = await club();
    await setAlias(a.tenantId, a.ownerId, "Alias A");
    const before = await snapshot(a.tenantId);
    const cases: [string, string, string | null][] = [
      ["inactive admin", await admin(a.tenantId, "admin", false), a.tenantId],
      ["no admin row", await person(), a.tenantId],
      ["active member, no admin row", await member(a.tenantId), a.tenantId],
      ["owner of another tenant", b.ownerId, a.tenantId],
      ["GUC of another tenant", a.ownerId, b.tenantId],
      ["GUC unset", a.ownerId, null],
    ];
    for (const [label, actor, guc] of cases) {
      expect(await sqlState(setAlias(a.tenantId, actor, "Alias Z", guc)), label).toBe("42501");
    }
    expect(await snapshot(a.tenantId)).toEqual(before);
  });

  it("A-5: authorization runs before the text checks: a denied actor with refused or NULL text is 42501", async () => {
    const a = await club();
    await setAlias(a.tenantId, a.ownerId, "Alias A");
    const before = await snapshot(a.tenantId);
    const actors = { "no admin row": await person(), "active member": await member(a.tenantId) };
    for (const [label, actor] of Object.entries(actors)) {
      // NULL pins the separate NULL check (0060 set definer) behind authorization too.
      for (const text of ["", "x".repeat(61), null]) {
        const state = await sqlState(setAlias(a.tenantId, actor, text as string));
        expect(state, `${label}: ${text === null ? "NULL" : text.length}`).toBe("42501");
      }
    }
    expect(await snapshot(a.tenantId)).toEqual(before);
  });

  it("A-22: a club edit or an owner reject takes an approved alias out of approved at once", async () => {
    const a = await club();
    await setAlias(a.tenantId, a.ownerId, "Alias A");
    await decide(a.tenantId, "approved", sha("Alias A"));
    await setAlias(a.tenantId, a.ownerId, "Alias A2");
    expect(await snapshot(a.tenantId)).toMatchObject({
      public_alias: "Alias A2",
      public_alias_status: "pending",
    });
    const b = await club();
    await setAlias(b.tenantId, b.ownerId, "Alias B");
    await decide(b.tenantId, "approved", sha("Alias B"));
    expect(await decide(b.tenantId, "rejected", sha("Alias B"))).toEqual([
      { tenant_id: b.tenantId, public_alias_status: "rejected" },
    ]);
  });
});

describe("0060 privileges (A-6, A-7, A-8, A-11, A-16)", () => {
  it("A-6: R-1 catalog assertions for app, app_worker and readonly", async () => {
    for (const role of ROLES) {
      const { rows } = await ctx.owner.query<Row>(
        `SELECT has_function_privilege($1, 'public.tenant_public_alias_set(uuid, uuid, text)', 'EXECUTE') AS set_fn,
                has_function_privilege($1, 'public.tenant_public_alias_read(uuid)', 'EXECUTE') AS read_fn,
                has_function_privilege($1, 'public.tenant_public_alias_decide(uuid, text, text, text)', 'EXECUTE') AS decide_fn,
                has_function_privilege($1, 'public.tenant_public_alias_pending()', 'EXECUTE') AS pending_fn,
                has_table_privilege($1, 'public.tenant_public_alias_audit', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE') AS audit_any,
                has_table_privilege($1, 'public.tenants', 'INSERT, UPDATE') AS tenants_write,
                has_column_privilege($1, 'public.tenants', 'public_alias', 'INSERT, UPDATE') AS alias_col,
                has_column_privilege($1, 'public.tenants', 'public_alias_status', 'INSERT, UPDATE') AS status_col,
                has_table_privilege($1, 'public.tenants', 'SELECT') AS tenants_select,
                has_column_privilege($1, 'public.tenants', 'public_alias', 'SELECT') AS alias_select,
                has_column_privilege($1, 'public.tenants', 'public_alias_status', 'SELECT') AS status_select`,
        [role],
      );
      // The read half: pending or rejected text reaches no role except through the read definer.
      expect(rows[0], role).toEqual({
        set_fn: role === "app",
        read_fn: role === "app",
        decide_fn: false,
        pending_fn: false,
        audit_any: false,
        tenants_write: false,
        alias_col: false,
        status_col: false,
        tenants_select: false,
        alias_select: false,
        status_select: false,
      });
    }
  });

  it("A-7: no role writes the alias columns directly", async () => {
    const { tenantId, ownerId } = await club();
    await setAlias(tenantId, ownerId, "Alias A");
    const before = await snapshot(tenantId);
    for (const role of ROLES) {
      const update = `UPDATE tenants SET public_alias_status = 'approved' WHERE id = $1`;
      expect(await sqlState(asRole(role, tenantId, update, [tenantId])), role).toBe("42501");
      const insert = `INSERT INTO tenants (name, slug, public_alias, public_alias_status)
                      VALUES ('x', $1, 'x', 'approved')`;
      expect(await sqlState(asRole(role, tenantId, insert, [`pa-${randomUUID()}`])), role).toBe(
        "42501",
      );
    }
    expect(await snapshot(tenantId)).toEqual(before);
  });

  it("A-8: no role calls decide or pending; the owner path does", async () => {
    const { tenantId, ownerId } = await club();
    await setAlias(tenantId, ownerId, "Alias A");
    const before = await snapshot(tenantId);
    for (const role of ROLES) {
      for (const d of ["approved", "rejected"]) {
        const call = `SELECT * FROM tenant_public_alias_decide($1, $2, $3, 'owner-cli')`;
        expect(
          await sqlState(asRole(role, tenantId, call, [tenantId, d, sha("Alias A")])),
          `${role} ${d}`,
        ).toBe("42501");
      }
      const list = `SELECT * FROM tenant_public_alias_pending()`;
      expect(await sqlState(asRole(role, tenantId, list)), role).toBe("42501");
    }
    expect(await snapshot(tenantId)).toEqual(before);
    const pending = (await ctx.owner.query<Row>(`SELECT * FROM tenant_public_alias_pending()`))
      .rows;
    expect(pending).toContainEqual({
      tenant_id: tenantId,
      public_alias: "Alias A",
      alias_sha256: sha("Alias A"),
    });
    expect(await decide(tenantId, "approved", sha("Alias A"))).toEqual([
      { tenant_id: tenantId, public_alias_status: "approved" },
    ]);
  });

  it("A-11: audit rows are append-only for the owner and unreachable for every role", async () => {
    const { tenantId, ownerId } = await club();
    await setAlias(tenantId, ownerId, "Alias A");
    await decide(tenantId, "approved", sha("Alias A"));
    const own = (sql: string) => sqlState(ctx.owner.query(sql, [tenantId]));
    expect(
      await own(`UPDATE tenant_public_alias_audit SET decided_by = 'x' WHERE tenant_id = $1`),
    ).toBe("23001");
    expect(await own(`DELETE FROM tenant_public_alias_audit WHERE tenant_id = $1`)).toBe("23001");
    for (const role of ROLES) {
      for (const sql of [
        `SELECT * FROM tenant_public_alias_audit`,
        `UPDATE tenant_public_alias_audit SET decided_by = 'x'`,
        `DELETE FROM tenant_public_alias_audit`,
      ]) {
        expect(await sqlState(asRole(role, tenantId, sql)), `${role}: ${sql}`).toBe("42501");
      }
    }
    const { rows } = await ctx.owner.query<Row>(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class
        WHERE oid = 'public.tenant_public_alias_audit'::regclass`,
    );
    expect(rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    expect((await snapshot(tenantId)).audits).toBe(1);
  });

  it("A-16: the four definers are SECURITY DEFINER, search_path pinned, ACL per R-1, no PUBLIC entry", async () => {
    const expected: Record<string, string[]> = {
      "public.tenant_public_alias_set(uuid,uuid,text)": ["app"],
      "public.tenant_public_alias_read(uuid)": ["app"],
      "public.tenant_public_alias_decide(uuid,text,text,text)": [],
      "public.tenant_public_alias_pending()": [],
    };
    for (const [fn, grantees] of Object.entries(expected)) {
      const { rows } = await ctx.owner.query<Row>(
        `SELECT p.prosecdef, p.proconfig, p.proacl::text[] AS acl, pg_get_userbyid(p.proowner) AS owner
           FROM pg_proc p WHERE p.oid = $1::regprocedure`,
        [fn],
      );
      const r = rows[0]!;
      expect(r.prosecdef, fn).toBe(true);
      expect(r.proconfig, fn).toEqual(["search_path=pg_catalog, public, pg_temp"]);
      const acl = r.acl as string[];
      expect(
        acl.some((e) => e.startsWith("=")),
        fn,
      ).toBe(false);
      const others = acl
        .map((e) => e.split("=")[0]!.replace(/"/g, ""))
        .filter((g) => g !== r.owner);
      expect(others.sort(), fn).toEqual(grantees);
    }
  });
});

describe("0060 owner decisions (A-9, A-10, A-12, A-14, A-15, A-18, A-21, A-26)", () => {
  it("A-9: one audit row and one event per decision; a repeated decision is 55000; bad args refused", async () => {
    const a = await club();
    await setAlias(a.tenantId, a.ownerId, "Alias A");
    await decide(a.tenantId, "approved", sha("Alias A"));
    expect(await sqlState(decide(a.tenantId, "approved", sha("Alias A")))).toBe("55000");
    await decide(a.tenantId, "rejected", sha("Alias A"));
    expect(await sqlState(decide(a.tenantId, "rejected", sha("Alias A")))).toBe("55000");
    const b = await club();
    await setAlias(b.tenantId, b.ownerId, "Alias B");
    await decide(b.tenantId, "rejected", sha("Alias B"));
    expect(await audits(a.tenantId)).toEqual([
      { decision: "approved", alias: "Alias A", decided_by: "owner-cli" },
      { decision: "rejected", alias: "Alias A", decided_by: "owner-cli" },
    ]);
    expect(await audits(b.tenantId)).toEqual([
      { decision: "rejected", alias: "Alias B", decided_by: "owner-cli" },
    ]);
    expect((await events(a.tenantId)).map((e) => e.type)).toEqual([
      "tenant.public_alias_set",
      "tenant.public_alias_approved",
      "tenant.public_alias_rejected",
    ]);
    expect(await snapshot(b.tenantId)).toMatchObject({
      public_alias_status: "rejected",
      audits: 1,
      events: 2,
    });
    const before = await snapshot(a.tenantId);
    for (const [label, args] of [
      ["decision", ["approve", sha("Alias A"), "owner-cli"]],
      ["digest", ["approved", sha("Alias A").toUpperCase(), "owner-cli"]],
      ["decided_by", ["approved", sha("Alias A"), "Owner CLI"]],
    ] as [string, [string, string, string]][]) {
      expect(await sqlState(decide(a.tenantId, ...args)), label).toBe("22023");
    }
    expect(await sqlState(decide(randomUUID(), "approved", sha("Alias A")))).toBe("P0002");
    expect(await snapshot(a.tenantId)).toEqual(before);
  });

  it("A-10: a failing event insert rolls back the status and the audit row", async () => {
    const { tenantId, ownerId } = await club();
    await setAlias(tenantId, ownerId, "Alias A");
    const before = await snapshot(tenantId);
    await ctx.owner.query(`
      CREATE FUNCTION test_a10_fail() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.type = 'tenant.public_alias_approved' THEN RAISE EXCEPTION 'a10 injected'; END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER test_a10_fail BEFORE INSERT ON outbox_events
        FOR EACH ROW EXECUTE FUNCTION test_a10_fail();`);
    try {
      expect(await sqlState(decide(tenantId, "approved", sha("Alias A")))).toBe("P0001");
    } finally {
      await ctx.owner.query(
        `DROP TRIGGER test_a10_fail ON outbox_events; DROP FUNCTION test_a10_fail();`,
      );
    }
    expect(await snapshot(tenantId)).toEqual(before);
  });

  it("A-12: the character constants of set are byte-equal to person_profile_update (0055)", async () => {
    const block = async (fn: string) => {
      const { rows } = await ctx.owner.query<{ prosrc: string }>(
        `SELECT prosrc FROM pg_proc WHERE oid = $1::regprocedure`,
        [fn],
      );
      const src = rows[0]!.prosrc;
      const start = src.indexOf("  c_ws     CONSTANT");
      const visible = src.indexOf("c_visible CONSTANT", start);
      const end = src.indexOf("|| ']';", visible);
      expect(start >= 0 && visible > start && end > visible, fn).toBe(true);
      return src.slice(start, end);
    };
    expect(await block("public.tenant_public_alias_set(uuid,uuid,text)")).toBe(
      await block("public.person_profile_update(uuid,text)"),
    );
  });

  it("A-14: a decision bound to the digest of an older text fails with zero writes", async () => {
    const { tenantId, ownerId } = await club();
    await setAlias(tenantId, ownerId, "Alias A");
    const { rows } = await ctx.owner.query<{ alias_sha256: string }>(
      `SELECT alias_sha256 FROM tenant_public_alias_pending() WHERE tenant_id = $1`,
      [tenantId],
    );
    await setAlias(tenantId, ownerId, "Alias B");
    const before = await snapshot(tenantId);
    expect(await sqlState(decide(tenantId, "approved", rows[0]!.alias_sha256))).toBe("55000");
    expect(await snapshot(tenantId)).toEqual(before);
    expect(before).toMatchObject({ public_alias: "Alias B", public_alias_status: "pending" });
  });

  it("A-15/A-21: only public_session_share_v (0061) reads the new columns; seeded and undecided tenants are never approved", async () => {
    const { rows: views } = await ctx.owner.query(
      `SELECT view_name FROM information_schema.view_column_usage
        WHERE table_name = 'tenants' AND column_name IN ('public_alias', 'public_alias_status')`,
    );
    expect(views).toEqual([
      { view_name: "public_session_share_v" },
      { view_name: "public_session_share_v" },
    ]);
    const { rows: seeded } = await ctx.owner.query<Row>(
      `SELECT public_alias, public_alias_status FROM tenants WHERE id = ANY($1::uuid[])`,
      [[ctx.tenantA, ctx.tenantB]],
    );
    expect(seeded).toEqual([
      { public_alias: null, public_alias_status: null },
      { public_alias: null, public_alias_status: null },
    ]);
    const [none, pend, rej] = [await club(), await club(), await club()];
    await setAlias(pend.tenantId, pend.ownerId, "Pending Alias");
    await setAlias(rej.tenantId, rej.ownerId, "Rejected Alias");
    await decide(rej.tenantId, "rejected", sha("Rejected Alias"));
    const { rows } = await ctx.owner.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM tenants
        WHERE id = ANY($1::uuid[]) AND public_alias_status = 'approved'`,
      [[none.tenantId, pend.tenantId, rej.tenantId]],
    );
    expect(rows[0]!.n).toBe(0);
  });

  it("A-18: parallel sets, and a set parallel to a decide, serialize without 40P01", async () => {
    const { tenantId, ownerId } = await club();
    const begin = async (c: pg.PoolClient) => {
      await c.query("BEGIN");
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      return (await c.query<{ pid: number }>(`SELECT pg_backend_pid() AS pid`)).rows[0]!.pid;
    };
    const setSql = `SELECT * FROM tenant_public_alias_set($1, $2, $3)`;
    const c1 = await ctx.appPool.connect();
    const c2 = await ctx.appPool.connect();
    try {
      await begin(c1);
      const pid2 = await begin(c2);
      await c1.query(setSql, [tenantId, ownerId, "Alias 1"]);
      const second = c2.query(setSql, [tenantId, ownerId, "Alias 2"]);
      await blocked(pid2);
      await c1.query("COMMIT");
      await second;
      await c2.query("COMMIT");
    } finally {
      c1.release();
      c2.release();
    }
    const d = await ctx.superuserDb.pool.connect();
    const c3 = await ctx.appPool.connect();
    try {
      await d.query("BEGIN");
      await d.query(`SELECT * FROM tenant_public_alias_decide($1, 'approved', $2, 'owner-cli')`, [
        tenantId,
        sha("Alias 2"),
      ]);
      const pid3 = await begin(c3);
      const third = c3.query(setSql, [tenantId, ownerId, "Alias 3"]);
      await blocked(pid3);
      await d.query("COMMIT");
      await third;
      await c3.query("COMMIT");
    } finally {
      d.release();
      c3.release();
    }
    expect((await events(tenantId)).map((e) => [e.sequence, e.type])).toEqual([
      [1, "tenant.public_alias_set"],
      [2, "tenant.public_alias_set"],
      [3, "tenant.public_alias_approved"],
      [4, "tenant.public_alias_set"],
    ]);
    expect(await snapshot(tenantId)).toMatchObject({
      public_alias: "Alias 3",
      public_alias_status: "pending",
    });
  });

  it("A-18: an owner decide on the reviewed digest that waits behind a club edit is 55000", async () => {
    const { tenantId, ownerId } = await club();
    await setAlias(tenantId, ownerId, "Alias Reviewed");
    const c1 = await ctx.appPool.connect();
    const d = await ctx.superuserDb.pool.connect();
    let decision: Promise<string> = Promise.resolve("not started");
    try {
      // The club edit holds the club-config advisory key and the tenants row lock until COMMIT.
      await c1.query("BEGIN");
      await c1.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      await c1.query("SELECT tenant_public_alias_set($1, $2, $3)", [tenantId, ownerId, "Alias X"]);
      const pid = (await d.query<{ pid: number }>(`SELECT pg_backend_pid() AS pid`)).rows[0]!.pid;
      decision = sqlState(
        d.query(`SELECT * FROM tenant_public_alias_decide($1, 'approved', $2, 'owner-cli')`, [
          tenantId,
          sha("Alias Reviewed"),
        ]),
      );
      await blocked(pid);
      await c1.query("COMMIT");
      expect(await decision).toBe("55000");
    } finally {
      await c1.query("ROLLBACK"); // no-op after COMMIT; on an early failure it frees the decide
      c1.release();
      await decision;
      d.release();
    }
    expect(await snapshot(tenantId)).toEqual({
      public_alias: "Alias X",
      public_alias_status: "pending",
      audits: 0,
      events: 2,
    });
    const types = (await events(tenantId)).map((e) => e.type);
    expect(types).toEqual(["tenant.public_alias_set", "tenant.public_alias_set"]);
  });

  it("A-26: results carry only their pinned keys, no name, and every payload is exactly {status}", async () => {
    const { tenantId, ownerId } = await club();
    const set = await setAlias(tenantId, ownerId, "Alias K");
    expect(Object.keys(set[0]!).sort()).toEqual(["changed", "public_alias", "public_alias_status"]);
    const readSql = `SELECT * FROM tenant_public_alias_read($1)`;
    const read = await asRole("app", tenantId, readSql, [tenantId]);
    expect(read).toEqual([{ public_alias: "Alias K", public_alias_status: "pending" }]);
    expect(await sqlState(asRole("app", ctx.tenantB, readSql, [tenantId]))).toBe("42501");
    expect(await sqlState(asRole("app", null, readSql, [tenantId]))).toBe("42501");
    const pending = (await ctx.owner.query<Row>(`SELECT * FROM tenant_public_alias_pending()`))
      .rows;
    for (const r of pending)
      expect(Object.keys(r).sort()).toEqual(["alias_sha256", "public_alias", "tenant_id"]);
    const decided = await decide(tenantId, "approved", sha("Alias K"));
    expect(Object.keys(decided[0]!).sort()).toEqual(["public_alias_status", "tenant_id"]);
    const text = JSON.stringify([set, read, pending, decided]);
    expect(text).not.toContain(TENANT_NAME);
    expect(text).not.toContain(PERSON_NAME);
    const { rows } = await ctx.owner.query<{ payload: object }>(
      `SELECT payload FROM outbox_events WHERE aggregate_type = 'tenant'`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const { payload } of rows) expect(Object.keys(payload)).toEqual(["status"]);
  });
});

// ---- the TS module as role app (ctx.appDb) and the owner CLI ----
const NO_DB = {} as Db; // any DB use throws a TypeError, so INVALID_INPUT on it proves none happened
const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: unknown) => (e instanceof ClubConfigError ? e.code : String(e)),
  );
/** The TS verdict: the value validatePublicAlias returns (the one sent to the definer), or null. */
function tsStored(v: string): string | null {
  try {
    return validatePublicAlias(v);
  } catch (e) {
    if (e instanceof ClubConfigError && e.code === "INVALID_INPUT") return null;
    throw e;
  }
}
const setTs = (tenantId: string, actor: string, publicAlias: unknown, commandId = randomUUID()) =>
  setPublicAlias(ctx.appDb.db, { tenantId, actorPersonId: actor, commandId, publicAlias });
const commands = async (tenantId: string) =>
  (
    await ctx.owner.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM processed_commands WHERE tenant_id = $1`,
      [tenantId],
    )
  ).rows[0]!.n;
/** A club that passes the tenant-status axis (authorizeTenantAction fails closed without a row). */
async function activeClub(status = "active") {
  const c = await club();
  await ctx.owner.query(`UPDATE tenants SET status = $2 WHERE id = $1`, [c.tenantId, status]);
  await ctx.owner.query(
    `INSERT INTO subscriptions (tenant_id, plan_key, plan_version, status, period_start, period_end)
     VALUES ($1, 'free', 1, $2, now(), 'infinity')`,
    [c.tenantId, status],
  );
  return c;
}
/** The set definer's stored alias as app with the GUC, rolled back: the value, or null = 22023. */
async function sqlStored(tenantId: string, actor: string, input: string): Promise<string | null> {
  const c = await ctx.appPool.connect();
  try {
    await c.query("BEGIN");
    await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    const { rows } = await c.query<Row>(`SELECT * FROM tenant_public_alias_set($1, $2, $3)`, [
      tenantId,
      actor,
      input,
    ]);
    return rows[0]!.public_alias as string;
  } catch (e) {
    if ((e as { code?: string }).code !== "22023") throw e;
    return null;
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
}

describe("setPublicAlias / getPublicAlias as app (A-1, A-4, A-5, A-12, A-19, A-20, A-26)", () => {
  it("A-1/A-26: trims, stores pending with one event; results carry exactly their keys", async () => {
    const { tenantId, ownerId } = await activeClub();
    const set = await setTs(tenantId, ownerId, "  CLB Cầu Lông Q7  ");
    const state = { publicAlias: "CLB Cầu Lông Q7", publicAliasStatus: "pending" };
    expect(set).toStrictEqual({ ...state, changed: true, replayed: false });
    const read = await getPublicAlias(ctx.appDb.db, { tenantId });
    expect(read).toStrictEqual(state);
    expect((await events(tenantId)).map((e) => e.type)).toEqual(["tenant.public_alias_set"]);
    expect(JSON.stringify([set, read])).not.toMatch(/Secret/);
  });

  it("A-4/A-12: TS refuses before any DB call and agrees with the SQL definer per sample", async () => {
    const { tenantId, ownerId } = await activeClub();
    for (const bad of [null, 42, ...SAMPLES.filter((s) => s[2] === null).map((s) => s[1])]) {
      const p = setPublicAlias(NO_DB, {
        tenantId,
        actorPersonId: ownerId,
        commandId: randomUUID(),
        publicAlias: bad,
      });
      expect(await codeOf(p), JSON.stringify(bad)).toBe("INVALID_INPUT");
    }
    // Strip first at both layers (L23, R D3): the two agree on the verdict AND the stored value.
    for (const [label, input, stored] of SAMPLES) {
      const sqlValue = await sqlStored(tenantId, ownerId, input);
      expect(cps(sqlValue), label).toEqual(cps(stored));
      expect(cps(tsStored(input)), label).toEqual(cps(sqlValue));
    }
    expect(await snapshot(tenantId)).toMatchObject({ public_alias: null, events: 0 });
  });

  it("A-5: no content.manage, an active member, a non-member or another club's owner is FORBIDDEN, zero writes", async () => {
    const { tenantId } = await activeClub();
    const other = await activeClub();
    for (const actor of [
      await admin(tenantId, "admin", false),
      await person(),
      await member(tenantId),
      other.ownerId,
    ]) {
      expect(await codeOf(setTs(tenantId, actor, "Alias A"))).toBe("FORBIDDEN");
    }
    expect(await snapshot(tenantId)).toMatchObject({ public_alias: null, events: 0 });
    expect(await commands(tenantId)).toBe(0);
  });

  it("A-19: a replay after approval writes nothing; same text is no change; a foreign id conflicts", async () => {
    const { tenantId, ownerId } = await activeClub();
    const cmd = randomUUID();
    await setTs(tenantId, ownerId, "Alias A", cmd);
    await decide(tenantId, "approved", sha("Alias A"));
    const before = [await snapshot(tenantId), await commands(tenantId)];
    expect(await setTs(tenantId, ownerId, "Alias B", cmd)).toStrictEqual({
      publicAlias: "Alias A",
      publicAliasStatus: "approved",
      changed: false,
      replayed: true,
    });
    expect([await snapshot(tenantId), await commands(tenantId)]).toEqual(before);
    expect(await setTs(tenantId, ownerId, " Alias A ")).toMatchObject({
      publicAliasStatus: "approved",
      changed: false,
      replayed: false,
    });
    const foreign = randomUUID();
    await ctx.owner.query(
      `INSERT INTO processed_commands (tenant_id, command_id, command_type) VALUES ($1, $2, 'UpdateClubConfig')`,
      [tenantId, foreign],
    );
    expect(await codeOf(setTs(tenantId, ownerId, "Alias B", foreign))).toBe("COMMAND_ID_CONFLICT");
    expect(await snapshot(tenantId)).toMatchObject({ public_alias_status: "approved", events: 2 });
  });

  it("A-20: a suspended tenant is TENANT_SUSPENDED with zero writes", async () => {
    const { tenantId, ownerId } = await activeClub("suspended");
    expect(await codeOf(setTs(tenantId, ownerId, "Alias A"))).toBe("TENANT_SUSPENDED");
    expect(await snapshot(tenantId)).toMatchObject({ public_alias: null, events: 0 });
    expect(await commands(tenantId)).toBe(0);
  });
});

// L23 decision table (R section 6), alias rows R1-R5: one test per row per layer.
describe("L23 alias decision table, TS layer: validatePublicAlias strips first (R D3)", () => {
  for (const [row, cases] of ALIAS_TABLE) {
    it(row, () => {
      for (const [input, stored] of cases) {
        expect(cps(tsStored(input)), JSON.stringify(cps(input))).toEqual(cps(stored));
      }
    });
  }
});

describe("L23 alias decision table, SQL layer: tenant_public_alias_set as app (0068)", () => {
  for (const [row, cases] of ALIAS_TABLE) {
    it(row, async () => {
      const { tenantId, ownerId } = await club();
      for (const [input, stored] of cases) {
        const label = JSON.stringify(cps(input));
        const before = await snapshot(tenantId);
        if (stored === null) {
          expect(await sqlState(setAlias(tenantId, ownerId, input)), label).toBe("22023");
          expect(await snapshot(tenantId), label).toEqual(before);
        } else {
          const [set] = await setAlias(tenantId, ownerId, input);
          expect(cps(set!.public_alias as string), label).toEqual(cps(stored));
          expect(cps((await snapshot(tenantId)).public_alias as string), label).toEqual(
            cps(stored),
          );
        }
      }
      // R2 inputs all strip to one value: only the first set is a change (one event, M-5).
      if (row.startsWith("R2")) expect((await snapshot(tenantId)).events).toBe(1);
    });
  }
});

describe("owner CLI scripts/public-alias-moderate.mjs (A-13)", () => {
  const script = fileURLToPath(
    new URL("../../../scripts/public-alias-moderate.mjs", import.meta.url),
  );
  const ownerUrl = new URL(process.env.DATABASE_URL_TEST ?? "postgres://unset");
  ownerUrl.pathname = "/plexco_public_alias";
  const outputs: string[] = [];
  const cli = (args: string[], url: string | null = ownerUrl.toString()) => {
    const env: Record<string, string> = { PATH: process.env.PATH ?? "" };
    if (url !== null) env.DATABASE_URL_MIGRATION = url;
    const r = spawnSync(process.execPath, [script, ...args], { env, encoding: "utf8" });
    outputs.push(r.stdout, r.stderr);
    return { code: r.status, out: r.stdout, err: r.stderr };
  };

  it("A-13: list, approve, reject, wrong digest, bad args, env unset; no name or secret printed", async () => {
    const { tenantId, ownerId } = await club();
    await setAlias(tenantId, ownerId, "Alias A");
    const list = cli(["list"]);
    expect(list.code).toBe(0);
    const lines = list.out
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as Row);
    for (const l of lines)
      expect(Object.keys(l)).toEqual(["tenantId", "publicAlias", "aliasSha256"]);
    expect(lines).toContainEqual({ tenantId, publicAlias: "Alias A", aliasSha256: sha("Alias A") });
    const decision = (cmd: string, digest = sha("Alias A")) =>
      cli([cmd, "--tenant", tenantId, "--sha256", digest]);
    const wrong = decision("approve", sha("Alias Z"));
    expect(wrong).toMatchObject({ code: 2, err: expect.stringMatching(/^refused: /) });
    for (const [cmd, status] of [
      ["approve", "approved"],
      ["reject", "rejected"],
    ] as const) {
      const r = decision(cmd);
      expect(r.code, r.err).toBe(0);
      expect(JSON.parse(r.out)).toStrictEqual({ tenantId, status });
    }
    expect(decision("reject").code).toBe(2); // same-status decision: 55000
    const d = sha("x");
    for (const bad of [
      [],
      ["list", "extra"],
      ["toString"],
      ["approve"],
      ["approve", "--tenant", "nope", "--sha256", d],
      ["reject", "--tenant", tenantId, "--sha256", d.toUpperCase()],
      ["approve", "--tenant", tenantId, "--sha256", d, "--tenant", tenantId],
      ["approve", "--tenant", tenantId, "--sha256", d, "--force", "1"],
    ]) {
      expect(cli(bad).code, bad.join(" ")).toBe(2);
    }
    expect(cli(["list"], null)).toMatchObject({
      code: 1,
      err: expect.stringMatching(/DATABASE_URL_MIGRATION is not set/),
    });
    const secret = "pw-never-printed-0060";
    expect(cli(["list"], `postgres://nobody:${secret}@127.0.0.1:1/x`).code).toBe(1);
    // A malformed owner URL (fake marker password) fails inside the CLI's try: its own error line.
    const malformed = cli(["list"], "postgres://u:NOTASECRETMARK@[bad-host");
    expect(malformed).toMatchObject({ code: 1, err: expect.stringMatching(/^error: /m) });
    expect(malformed.err).not.toMatch(/^\s+at /m);
    expect(malformed.out + malformed.err).not.toContain("NOTASECRETMARK");
    expect((await audits(tenantId)).map((a) => a.decided_by)).toEqual(["owner-cli", "owner-cli"]);
    const all = outputs.join("\n");
    for (const s of [TENANT_NAME, PERSON_NAME, ownerUrl.toString(), secret, ownerUrl.password]) {
      if (s) expect(all).not.toContain(s);
    }
  });
});

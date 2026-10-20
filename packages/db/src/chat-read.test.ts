import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupRlsTestContext, type RlsTestContext } from "./test-harness.js";

// 0063 read functions chat_list_messages / chat_get_message (readiness 4.1 V-4, V-7, V-12, V-19, V-22; 4.2 list/get
// pipeline; 4.7 leg 5): DT-21, DT-32, the read legs of DT-1 and DT-17, the command legs of DT-33, DT-35 and keyset
// paging on the real DB. Members come from the W2 trigger, person messages from send_chat_message, tombstones from the
// W3 delete/moderate functions; every call runs as the app role with app.tenant_id / app.person_id set per transaction.
// Pins the authority left open (W4b implements them as tested): page order follows the direction ('before' = (created_at,
// id) DESC from the newest, 'after' = ASC from the oldest), the cursor row is excluded and a page's last row is the next
// cursor; both cursor halves or neither and a direction outside before|after -> INVALID_BODY; NULL direction / limit ->
// the defaults; the gate is the caller's chat_members row of an active membership in the channel's tenant, which must be
// app.tenant_id; an unknown channel lists as CHAT_FORBIDDEN (as send, DT-1); get answers every denial with zero rows.
const TEST_DB_NAME = "plexco_chat_read";
const HIDDEN = "sentinel-7c2d-chat-read-tombstoned"; // body of every tombstoned or dm message; no read may return it
const COLS = [
  "id",
  "channel_id",
  "author_type",
  "author_person_id",
  "body",
  "reply_to_message_id",
  "edited_at",
  "edit_count",
  "tombstone",
  "created_at",
];
const LIST = "SELECT * FROM chat_list_messages($1, $2, $3, $4, $5)";
// created_at as text: a JS Date drops the microseconds, so a Date cursor would re-read the cursor row
const PAGE =
  "SELECT id, created_at::text AS ts FROM chat_list_messages($1, $2::timestamptz, $3, $4, $5)";
const GET = "SELECT * FROM chat_get_message($1)";
const SEND = "SELECT id FROM send_chat_message($1, $2, $3)";
const MARK = "SELECT mark_read($1, $2)";

type Gucs = { tenant?: string; person?: string };
type Row = { id: string; body: string | null; tombstone: string | null; ts: string };
type Club = { t: string; c: string; mod: string; a: string; b: string };

let ctx: RlsTestContext;
let f: Club; // the denial fixtures' club; f.a posted msg
let g: Club; // the foreign tenant
let msg: string;
let outsider: string; // no membership anywhere
let dual: string; // active in f and in g
let bare: string; // active in f, its chat_members row removed

beforeAll(async () => {
  ctx = await setupRlsTestContext(TEST_DB_NAME);
  [f, g] = [await club(), await club()];
  msg = await send(f, f.a, "visible-body");
  [outsider, dual, bare] = [await person(), await person(), await person()];
  await join(f.t, dual);
  await join(g.t, dual);
  await join(f.t, bare);
  await q(`DELETE FROM chat_members WHERE channel_id = $1 AND person_id = $2`, [f.c, bare]);
}, 180_000);

afterAll(async () => {
  await ctx?.teardown();
});

async function q(text: string, values: unknown[] = []): Promise<Record<string, unknown>[]> {
  return (await ctx.owner.query(text, values)).rows as Record<string, unknown>[];
}
const id = async (text: string, values: unknown[] = []): Promise<string> =>
  (await q(text, values))[0]!.id as string;
const person = () => id(`INSERT INTO persons (display_name) VALUES ('chat-read') RETURNING id`);
const join = (t: string, p: string, status = "active") =>
  id(`INSERT INTO memberships (tenant_id, person_id, status) VALUES ($1, $2, $3) RETURNING id`, [
    t,
    p,
    status,
  ]);
/** A club with an owner-admin moderator and two plain members; the trigger provisions the default channel. */
async function club(): Promise<Club> {
  const t = await id(
    `INSERT INTO tenants (name, slug, status) VALUES ('chat-read', $1, 'active') RETURNING id`,
    [`read-${randomUUID().slice(0, 8)}`],
  );
  const [mod, a, b] = [await person(), await person(), await person()];
  for (const p of [mod, a, b]) await join(t, p);
  await q(
    `INSERT INTO tenant_admins (tenant_id, platform, platform_user_lookup_hash, role, active)
       VALUES ($1, 'web', $2, 'owner', true)`,
    [t, mod],
  );
  const c = await id(`SELECT id FROM chat_channels WHERE tenant_id = $1 AND is_default`, [t]);
  return { t, c, mod, a, b };
}
const as = (c: Club, p: string): Gucs => ({ tenant: c.t, person: p });

/** One app-role transaction with the given GUCs: committed, or rolled back and rethrown. */
async function asApp(gucs: Gucs, text: string, values: unknown[]): Promise<pg.QueryResult> {
  const client = await ctx.appPool.connect();
  try {
    await client.query("BEGIN");
    if (gucs.tenant)
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [gucs.tenant]);
    if (gucs.person)
      await client.query("SELECT set_config('app.person_id', $1, true)", [gucs.person]);
    const res = await client.query(text, values);
    await client.query("COMMIT");
    return res;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
const read = async (gucs: Gucs, text: string, values: unknown[]): Promise<Row[]> =>
  (await asApp(gucs, text, values)).rows as Row[];
/** The rejection message (a V-19 code), or "OK". */
const code = (gucs: Gucs, text: string, values: unknown[]): Promise<string> =>
  asApp(gucs, text, values).then(
    () => "OK",
    (e: Error) => e.message,
  );
const send = async (c: Club, p: string, body: string): Promise<string> =>
  (await read(as(c, p), SEND, [c.c, randomUUID(), body]))[0]!.id;
const moderate = (c: Club, m: string, action: "hide" | "restore") =>
  read(as(c, c.mod), "SELECT message_id FROM moderate_chat_message($1, $2, $3, $4, $5, $6)", [
    c.c,
    m,
    randomUUID(),
    action,
    action === "hide" ? "spam" : "off_topic",
    null,
  ]);
const del = (c: Club, m: string) =>
  read(as(c, c.a), "SELECT id FROM delete_chat_message($1, $2)", [c.c, m]);
const chatRow = (c: Club, p: string) =>
  q(
    `SELECT membership_id, last_read_created_at, last_read_message_id FROM chat_members
      WHERE channel_id = $1 AND person_id = $2`,
    [c.c, p],
  );
/** A dm of two club members (channel and members commit together) plus one owner-seeded dm message. */
async function seedDm(pa: string, pb: string): Promise<[string, string]> {
  await ctx.owner.query("BEGIN");
  let dm: string;
  try {
    dm = await id(`INSERT INTO chat_channels (kind, dm_key) VALUES ('dm', $1) RETURNING id`, [
      [pa, pb].sort().join(":"),
    ]);
    await q(`INSERT INTO chat_members (channel_id, person_id) VALUES ($1, $2), ($1, $3)`, [
      dm,
      pa,
      pb,
    ]);
    await ctx.owner.query("COMMIT");
  } catch (e) {
    await ctx.owner.query("ROLLBACK");
    throw e;
  }
  const m = await id(
    `INSERT INTO chat_messages (channel_id, author_person_id, body, client_msg_id)
       VALUES ($1, $2, $3, $4) RETURNING id`,
    [dm, pa, HIDDEN, randomUUID()],
  );
  return [dm, m];
}

// [name, GUCs, [list channel, get message]]: each must list as CHAT_FORBIDDEN and get as zero rows
const DENIED: [string, () => Gucs, () => [string, string]][] = [
  ["DT-1 non-member", () => ({ tenant: f.t, person: outsider }), () => [f.c, msg]],
  ["DT-1 active member without a chat_members row", () => as(f, bare), () => [f.c, msg]],
  ["DT-1 unknown channel and message", () => as(f, f.a), () => [randomUUID(), randomUUID()]],
  ["DT-32 cross-tenant caller (a member of another club only)", () => as(g, g.a), () => [f.c, msg]],
  [
    "DT-32 member of both clubs under the foreign app.tenant_id",
    () => as(g, dual),
    () => [f.c, msg],
  ],
  ["DT-1/DT-32 app.person_id unset", () => ({ tenant: f.t }), () => [f.c, msg]],
  ["DT-32 app.tenant_id unset", () => ({ person: f.a }), () => [f.c, msg]],
  [
    "DT-32 malformed app.person_id",
    () => ({ tenant: f.t, person: "not-a-uuid" }),
    () => [f.c, msg],
  ],
  [
    "DT-32 malformed app.tenant_id",
    () => ({ tenant: "not-a-uuid", person: f.a }),
    () => [f.c, msg],
  ],
];

describe("0063 chat read functions (V-12, V-22)", () => {
  it("DT-21 tombstone read through the read functions: body NULL + tombstone for the author, the moderator and a member; author_deleted wins; restore re-exposes", async () => {
    const d = await club();
    const ok = await send(d, d.a, "kept-body");
    const [hidden, deleted, both] = [
      await send(d, d.a, HIDDEN),
      await send(d, d.a, HIDDEN),
      await send(d, d.a, HIDDEN),
    ];
    const back = await send(d, d.a, "restored-body");
    await moderate(d, hidden, "hide");
    await del(d, deleted);
    await moderate(d, both, "hide");
    await del(d, both);
    await moderate(d, back, "hide");
    await moderate(d, back, "restore");
    const want: Record<string, [string | null, string | null]> = {
      [ok]: ["kept-body", null],
      [hidden]: [null, "moderation_hidden"],
      [deleted]: [null, "author_deleted"],
      [both]: [null, "author_deleted"],
      [back]: ["restored-body", null],
    };
    for (const p of [d.a, d.mod, d.b]) {
      const page = await asApp(as(d, p), LIST, [d.c, null, null, "after", 100]);
      expect(page.fields.map((x) => x.name)).toEqual([...COLS, "author_label"]); // no moderation, actor, reason or revision column
      expect(page.rows).toHaveLength(5);
      const shape = (page.rows as Row[]).map((r) => [r.id, [r.body, r.tombstone]]);
      expect(Object.fromEntries(shape)).toEqual(want);
      expect(JSON.stringify(page.rows)).not.toContain(HIDDEN);
      for (const [m, w] of Object.entries(want)) {
        const one = await asApp(as(d, p), GET, [m]);
        expect(one.fields.map((x) => x.name)).toEqual(COLS);
        expect((one.rows as Row[]).map((r) => [r.body, r.tombstone])).toEqual([w]);
      }
    }
  });

  it.each(DENIED)("%s: list CHAT_FORBIDDEN, get zero rows", async (_name, gucs, target) => {
    const [ch, m] = target();
    expect(await code(gucs(), LIST, [ch, null, null, "before", 50])).toBe("CHAT_FORBIDDEN");
    expect(await read(gucs(), GET, [m])).toEqual([]);
  });

  it("control for the denials: the member of both clubs reads f under f's tenant", async () => {
    const listed = await read(as(f, dual), LIST, [f.c, null, null, "before", 50]);
    expect(listed.map((r) => [r.id, r.body])).toContainEqual([msg, "visible-body"]);
    expect((await read(as(f, dual), GET, [msg])).map((r) => r.body)).toEqual(["visible-body"]);
  });

  it("DT-17 read legs: list on a dm is CHAT_SAFETY_BLOCKED and get of a dm message zero rows, flags off and all four on", async () => {
    const [dm, dmMsg] = await seedDm(f.a, f.b);
    const flags = (on: boolean) =>
      q(
        `UPDATE chat_dm_safety_config SET block_enabled = $1, report_enabled = $1, rate_limit_enabled = $1,
           audit_enabled = $1`,
        [on],
      );
    try {
      for (const on of [false, true]) {
        await flags(on);
        for (const p of [f.a, f.b]) {
          const res = await code(as(f, p), LIST, [dm, null, null, "before", 50]);
          expect(res, String(on)).toBe("CHAT_SAFETY_BLOCKED");
          expect(await read(as(f, p), GET, [dmMsg]), String(on)).toEqual([]);
        }
      }
    } finally {
      await flags(false);
    }
  });

  it("DT-33 command legs: after a re-join, send and list work again on the SAME chat_members row (cursor kept)", async () => {
    const p = await person();
    const left = await join(f.t, p);
    const first = await send(f, p, "before-left");
    await read(as(f, p), MARK, [f.c, first]);
    const prior = await chatRow(f, p);
    expect(prior).toMatchObject([{ membership_id: left, last_read_message_id: first }]);
    await q(`UPDATE memberships SET status = 'left' WHERE id = $1`, [left]);
    expect(await code(as(f, p), SEND, [f.c, randomUUID(), "while-left"])).toBe("CHAT_FORBIDDEN");
    expect(await code(as(f, p), LIST, [f.c, null, null, "before", 50])).toBe("CHAT_FORBIDDEN");
    expect(await read(as(f, p), GET, [first])).toEqual([]);
    const rejoined = await join(f.t, p);
    expect(await chatRow(f, p)).toEqual([{ ...prior[0], membership_id: rejoined }]);
    const second = await send(f, p, "after-rejoin");
    const ids = (await read(as(f, p), LIST, [f.c, null, null, "before", 100])).map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining([first, second]));
    expect((await read(as(f, p), GET, [first])).map((r) => r.id)).toEqual([first]);
  });

  it("DT-35 a person whose only membership is left: not provisioned; send, list and mark read CHAT_FORBIDDEN, get zero rows", async () => {
    const p = await person();
    await join(f.t, p, "left");
    expect(await chatRow(f, p)).toEqual([]);
    const gucs = as(f, p);
    expect(await code(gucs, SEND, [f.c, randomUUID(), "left-only"])).toBe("CHAT_FORBIDDEN");
    expect(await code(gucs, LIST, [f.c, null, null, "before", 50])).toBe("CHAT_FORBIDDEN");
    expect(await code(gucs, MARK, [f.c, msg])).toBe("CHAT_FORBIDDEN");
    expect(await read(gucs, GET, [msg])).toEqual([]);
  });

  it("keyset paging by (created_at, id): both directions without gap or duplicate; defaults, clamp and input checks", async () => {
    const k = await club();
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) ids.push(await send(k, i % 2 ? k.a : k.b, `page-${i}`));
    const newest = [...ids].reverse();
    const walk = async (dir: string): Promise<string[]> => {
      const seen: string[] = [];
      let cur: Row | undefined;
      for (let n = 0; n < 10; n++) {
        const page = await read(as(k, k.b), PAGE, [k.c, cur?.ts ?? null, cur?.id ?? null, dir, 2]);
        if (page.length === 0) break;
        expect(page.length).toBeLessThanOrEqual(2);
        seen.push(...page.map((r) => r.id));
        cur = page[page.length - 1];
      }
      return seen;
    };
    expect(await walk("before")).toEqual(newest);
    expect(await walk("after")).toEqual(ids);
    const idsOf = async (text: string, values: unknown[]) =>
      (await read(as(k, k.b), text, values)).map((r) => r.id);
    expect(await idsOf("SELECT * FROM chat_list_messages($1)", [k.c])).toEqual(newest); // before, 50
    expect(await idsOf(LIST, [k.c, null, null, null, null])).toEqual(newest); // NULL = the defaults
    expect(await idsOf(LIST, [k.c, null, null, "before", 0])).toEqual(newest.slice(0, 1)); // clamp to 1
    const [mid] = (await read(as(k, k.b), PAGE, [k.c, null, null, "after", 4])).slice(-1);
    expect(await idsOf(PAGE, [k.c, mid!.ts, mid!.id, "before", 50])).toEqual(newest.slice(4)); // DESC
    expect(await idsOf(PAGE, [k.c, mid!.ts, mid!.id, "after", 50])).toEqual(ids.slice(4));
    for (const bad of [
      [k.c, mid!.ts, null, "before", 50],
      [k.c, null, mid!.id, "before", 50],
      [k.c, null, null, "sideways", 50],
    ]) {
      expect(await code(as(k, k.b), PAGE, bad)).toBe("INVALID_BODY");
    }
    // clamp to 100: 101 more rows by one owner INSERT (as seedDm does), so the send rate limit is not involved
    await q(
      `INSERT INTO chat_messages (channel_id, author_person_id, membership_id, body, client_msg_id)
       SELECT $1, $2, (SELECT id FROM memberships WHERE tenant_id = $3 AND person_id = $2 AND status = 'active'),
              'x', gen_random_uuid()
         FROM generate_series(1, 101)`,
      [k.c, k.a, k.t],
    );
    expect(await idsOf(LIST, [k.c, null, null, "after", 1000])).toHaveLength(100);
  });
});

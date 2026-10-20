import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupRlsTestContext, withDefinerReadLock, type RlsTestContext } from "./test-harness.js";

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

// 0065 author_label (L15a readiness 6 L-1..L-4, 7 T1-T9) on the real DB, as the app role, inside the definer reader
// lock. Names are set by the owner pool AFTER the sends, so a named case also pins L-1 (the CURRENT club name, not a
// send-time snapshot); every NULL case has a named control row, so an always-NULL label fails; rows are counted, so a
// join fan-out fails. A club person message always has a membership row in its tenant (0031 membership fk +
// membership_required_chk + chat_bind_tenant), so T3's "none" is no ACTIVE membership in the channel's tenant.
// T10 (ACL, owner, attributes after the DROP) is chat-catalog.test.ts "0063 function catalog"; T11 (the display_name
// column grant) is chat-schema-invariants.test.ts; T12 (the wire DTO) belongs to the apps/web chat route tests.
describe("0065 chat_list_messages author_label (L15a decision table)", () => {
  const BASE = process.env.DATABASE_URL_TEST!;
  type Labelled = Row & { author_label: string | null };
  /** Sets the display_name of p's active (or guest) membership in t: exactly one row, so no case is vacuous. */
  const named = async (t: string, p: string, v: string | null) => {
    const res = await ctx.owner.query(
      `UPDATE memberships SET display_name = $3
        WHERE tenant_id = $1 AND person_id = $2 AND status IN ('active', 'guest')`,
      [t, p, v],
    );
    expect(res.rowCount).toBe(1);
  };
  /** p's read of the channel's whole history (oldest first) and its id -> author_label map. */
  const page = async (c: Club, p: string) => {
    const rows = (await read(as(c, p), LIST, [c.c, null, null, "after", 100])) as Labelled[];
    return { rows, label: Object.fromEntries(rows.map((r) => [r.id, r.author_label])) };
  };

  it("T1 an active author with a non-blank club name: the btrim'd name, then its first 120 characters", async () => {
    await withDefinerReadLock(BASE, async () => {
      const d = await club();
      const [trimmed, cut] = [await send(d, d.a, "t1-trimmed"), await send(d, d.b, "t1-cut")];
      await named(d.t, d.a, "  Minh  ");
      await named(d.t, d.b, `  ${"a".repeat(120)}${"b".repeat(10)}`); // cut-then-trim keeps 118
      for (const p of [d.a, d.b, d.mod]) {
        const { rows, label } = await page(d, p);
        expect(rows).toHaveLength(2);
        expect(label).toEqual({ [trimmed]: "Minh", [cut]: "a".repeat(120) });
      }
    });
  });

  it("T2 a NULL or spaces-only club name: NULL; a named control row keeps its name", async () => {
    await withDefinerReadLock(BASE, async () => {
      const d = await club();
      const [nul, blank] = [await send(d, d.a, "t2-null"), await send(d, d.b, "t2-blank")];
      const ctl = await send(d, d.mod, "t2-control");
      await named(d.t, d.a, null);
      await named(d.t, d.b, "   ");
      await named(d.t, d.mod, "Mod-name");
      const { rows, label } = await page(d, d.b);
      expect(rows).toHaveLength(3);
      expect(label).toEqual({ [nul]: null, [blank]: null, [ctl]: "Mod-name" });
    });
  });

  it("T3 an author left, merged or guest in the channel's tenant, or left there while active and named in another club: NULL; the list still answers", async () => {
    await withDefinerReadLock(BASE, async () => {
      const [d, e] = [await club(), await club()];
      const sent: string[] = [];
      let elsewhere = "";
      for (const [status, name] of [
        ["left", "Left-name"],
        ["merged", "Merged-name"],
        ["guest", "Guest-name"],
        ["left", "Gone-name"],
      ] as const) {
        const p = await person();
        const m = await join(d.t, p);
        sent.push(await send(d, p, `t3-${status}`));
        await named(d.t, p, name);
        await q(`UPDATE memberships SET status = $2 WHERE id = $1`, [m, status]);
        elsewhere = p;
      }
      // the last author: left in d (no active membership there), active and named in e
      await join(e.t, elsewhere);
      await named(e.t, elsewhere, "Elsewhere-name");
      const ctl = await send(d, d.a, "t3-control");
      await named(d.t, d.a, "Control-name");
      const { rows, label } = await page(d, d.b);
      expect(rows).toHaveLength(5);
      expect(label).toEqual({
        ...Object.fromEntries(sent.map((m) => [m, null])),
        [ctl]: "Control-name",
      });
      for (const name of ["Left-name", "Merged-name", "Guest-name", "Gone-name", "Elsewhere-name"])
        expect(JSON.stringify(rows)).not.toContain(name);
    });
  });

  it("T4 a system or assistant author: NULL, with the reader and every member named", async () => {
    await withDefinerReadLock(BASE, async () => {
      const d = await club();
      const ctl = await send(d, d.a, "t4-control");
      const npc = (type: string) =>
        id(
          `INSERT INTO chat_messages (channel_id, author_type, body, client_msg_id)
             VALUES ($1, $2, $3, $4) RETURNING id`,
          [d.c, type, `t4-${type}`, randomUUID()],
        );
      const [sys, bot] = [await npc("system"), await npc("assistant")];
      await named(d.t, d.a, "A-name");
      await named(d.t, d.b, "B-name");
      await named(d.t, d.mod, "Mod-name");
      const { rows, label } = await page(d, d.b);
      expect(rows).toHaveLength(3);
      // a label keyed by the caller instead of the author would put B-name on both
      expect(label).toEqual({ [ctl]: "A-name", [sys]: null, [bot]: null });
    });
  });

  it("T5 an author_deleted or moderation_hidden row: NULL label and NULL body for the author, a member and the moderator; a restored row is labelled again", async () => {
    await withDefinerReadLock(BASE, async () => {
      const d = await club();
      const [ok, gone, hidden, back] = [
        await send(d, d.a, "t5-visible"),
        await send(d, d.a, HIDDEN),
        await send(d, d.a, HIDDEN),
        await send(d, d.a, "t5-restored"),
      ];
      await del(d, gone);
      await moderate(d, hidden, "hide");
      await moderate(d, back, "hide");
      await moderate(d, back, "restore");
      await named(d.t, d.a, "Author-name");
      for (const p of [d.a, d.b, d.mod]) {
        const { rows } = await page(d, p);
        expect(rows).toHaveLength(4);
        const shape = rows.map((r) => [r.id, [r.author_label, r.body, r.tombstone]]);
        expect(Object.fromEntries(shape)).toEqual({
          [ok]: ["Author-name", "t5-visible", null],
          [gone]: [null, null, "author_deleted"],
          [hidden]: [null, null, "moderation_hidden"],
          [back]: ["Author-name", "t5-restored", null],
        });
      }
    });
  });

  // fails if the join loses `am.tenant_id = v_ch.tenant_id`: both memberships match, both names appear
  it("T6 one person active in two clubs under a different name in each: a club's reader sees only that club's name, the other is absent from every column", async () => {
    await withDefinerReadLock(BASE, async () => {
      const [a, b] = [await club(), await club()];
      const p = await person();
      await join(a.t, p);
      await join(b.t, p);
      const [inA, inB] = [await send(a, p, "t6-in-a"), await send(b, p, "t6-in-b")];
      await named(a.t, p, "Alpha-name");
      await named(b.t, p, "Bravo-name");
      const cases: [Club, string, string, string][] = [
        [a, inA, "Alpha-name", "Bravo-name"],
        [b, inB, "Bravo-name", "Alpha-name"],
      ];
      for (const [c, m, mine, other] of cases) {
        for (const reader of [c.b, p]) {
          const { rows, label } = await page(c, reader);
          expect(rows).toHaveLength(1);
          expect(label).toEqual({ [m]: mine });
          expect(JSON.stringify(rows)).not.toContain(other);
        }
      }
    });
  });

  it("T7 the ten 0063 columns then author_label text, nothing else; one function, its argument list and four defaults unchanged; chat_get_message keeps the ten", async () => {
    await withDefinerReadLock(BASE, async () => {
      const d = await club();
      await send(d, d.a, "t7-first");
      await send(d, d.a, "t7-second");
      const res = await asApp(as(d, d.b), LIST, [d.c, null, null, "before", 50]);
      expect(res.rows).toHaveLength(2);
      expect(res.fields.map((x) => x.name)).toEqual([...COLS, "author_label"]);
      expect(res.fields[COLS.length]!.dataTypeID).toBe(25); // text
      const defaulted = await asApp(as(d, d.b), "SELECT * FROM chat_list_messages($1)", [d.c]);
      expect(defaulted.rows).toEqual(res.rows); // the defaults: no cursor, 'before', 50
      const one = await asApp(as(d, d.b), GET, [res.rows[0].id]);
      expect(one.fields.map((x) => x.name)).toEqual(COLS);
      const fns = await q(
        `SELECT pronargs, pronargdefaults, pg_get_function_identity_arguments(oid) AS args
           FROM pg_proc WHERE proname = 'chat_list_messages'`,
      );
      expect(fns).toEqual([
        {
          pronargs: 5,
          pronargdefaults: 4,
          args: "p_channel uuid, p_cursor_created_at timestamp with time zone, p_cursor_id uuid, p_direction text, p_limit integer",
        },
      ]);
    });
  });

  // fails if the label follows chat_messages.membership_id (the left row): NULL or Old-name instead of New-name
  it("T8 re-join: the author left (the old message keeps the left membership_id) and joined again under a new name: both messages show the current name, the old name never", async () => {
    await withDefinerReadLock(BASE, async () => {
      const d = await club();
      const p = await person();
      const first = await join(d.t, p);
      const old = await send(d, p, "t8-before-leave");
      await named(d.t, p, "Old-name");
      await q(`UPDATE memberships SET status = 'left' WHERE id = $1`, [first]);
      expect((await page(d, d.b)).label).toEqual({ [old]: null });
      const second = await join(d.t, p);
      await named(d.t, p, "New-name");
      const fresh = await send(d, p, "t8-after-rejoin");
      const bound = await q(
        `SELECT id, membership_id FROM chat_messages WHERE id = ANY($1) ORDER BY created_at`,
        [[old, fresh]],
      );
      expect(bound).toEqual([
        { id: old, membership_id: first },
        { id: fresh, membership_id: second },
      ]);
      for (const reader of [d.b, p]) {
        const { rows, label } = await page(d, reader);
        expect(rows).toHaveLength(2);
        expect(label).toEqual({ [old]: "New-name", [fresh]: "New-name" });
        expect(JSON.stringify(rows)).not.toContain("Old-name");
      }
    });
  });

  it("T9 authorization unchanged: a non-member, a left-only person and another club's member get CHAT_FORBIDDEN from list (no name in it) and zero rows from get", async () => {
    await withDefinerReadLock(BASE, async () => {
      const d = await club();
      const m = await send(d, d.a, "t9");
      await named(d.t, d.a, "Labelled-name");
      const [outside, leftOnly] = [await person(), await person()];
      await join(d.t, leftOnly, "left");
      const denied: Gucs[] = [
        { tenant: d.t, person: outside },
        as(d, leftOnly),
        as(g, g.a),
        { tenant: d.t, person: g.a },
      ];
      for (const gucs of denied) {
        expect(await code(gucs, LIST, [d.c, null, null, "before", 50])).toBe("CHAT_FORBIDDEN");
        expect(await read(gucs, GET, [m])).toEqual([]);
      }
      expect((await page(d, d.b)).label).toEqual({ [m]: "Labelled-name" }); // the control
    });
  });
});

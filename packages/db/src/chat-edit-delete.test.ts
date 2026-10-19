import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupRlsTestContext, type RlsTestContext } from "./test-harness.js";

// 0063 edit_chat_message, delete_chat_message and mark_read (readiness 4.1 V-1, V-4, V-6..V-10, V-19, V-21, V-24;
// 4.2 edit, delete and mark_read pipelines; 4.5 NOTIFY contract): the edit, delete and mark-read legs of DT-1, DT-5,
// DT-8..DT-12, DT-17, DT-19, DT-20 and DT-24 on the real DB. Members come from the W2 trigger and messages from
// send_chat_message; every call runs as the app role with app.tenant_id / app.person_id set through set_config
// inside the test transaction.
const TEST_DB_NAME = "plexco_chat_edit_delete";
const SENTINEL = "sentinel-e7d2-chat-edit";
const EDIT = "SELECT id, edit_count, edited_at, changed FROM edit_chat_message($1, $2, $3, $4)";
const DELETE = "SELECT id, author_deleted_at, changed FROM delete_chat_message($1, $2)";
const MARK = "SELECT mark_read($1, $2)";
const SEND = "SELECT id FROM send_chat_message($1, $2, $3)";
const SHUTTLE = String.fromCodePoint(0x1f3f8); // one code point: two UTF-16 units, four UTF-8 bytes

type Gucs = { tenant?: string; person?: string };
type Edited = { id: string; edit_count: number; edited_at: Date | null; changed: boolean };
type Deleted = { id: string; author_deleted_at: Date | null; changed: boolean };
type DbError = Error & { code?: string; detail?: string; hint?: string };

let ctx: RlsTestContext;
let listener: PoolClient;
const heard: string[] = []; // every chat_realtime payload, in arrival (= commit) order

beforeAll(async () => {
  ctx = await setupRlsTestContext(TEST_DB_NAME);
  listener = await ctx.appPool.connect();
  listener.on("notification", (n) => {
    if (n.channel === "chat_realtime") heard.push(n.payload ?? "");
  });
  await listener.query("LISTEN chat_realtime");
}, 180_000);

afterAll(async () => {
  listener?.release(true);
  await ctx?.teardown();
});

const body = (tag: string | number): string => `${SENTINEL} ${tag}`;
async function rows<T = Record<string, unknown>>(
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  return (await ctx.owner.query(text, values)).rows as T[];
}
const id = async (text: string, values: unknown[] = []): Promise<string> =>
  ((await rows(text, values))[0] as { id: string }).id;
const as = (tenant: string, person: string): Gucs => ({ tenant, person });
async function member(t: string): Promise<string> {
  const p = await id(`INSERT INTO persons (display_name) VALUES ('chat-edit') RETURNING id`);
  await rows(`INSERT INTO memberships (tenant_id, person_id, status) VALUES ($1, $2, 'active')`, [
    t,
    p,
  ]);
  return p;
}
/** A club with three members; the trigger provisions the default channel and their chat_members rows. */
async function club() {
  const t = await id(
    `INSERT INTO tenants (name, slug, status) VALUES ('chat-edit', $1, 'active') RETURNING id`,
    [`edit-${randomUUID().slice(0, 8)}`],
  );
  const [a, b, d] = [await member(t), await member(t), await member(t)];
  const c = await id(`SELECT id FROM chat_channels WHERE tenant_id = $1 AND is_default`, [t]);
  return { t, c, a, b, d };
}
/** Channel and both members commit in one transaction (the deferred trg_chat_dm_two_* triggers). */
async function seedDm(pa: string, pb: string): Promise<string> {
  await ctx.owner.query("BEGIN");
  try {
    const dm = await id(`INSERT INTO chat_channels (kind, dm_key) VALUES ('dm', $1) RETURNING id`, [
      [pa, pb].sort().join(":"),
    ]);
    await rows(`INSERT INTO chat_members (channel_id, person_id) VALUES ($1, $2), ($1, $3)`, [
      dm,
      pa,
      pb,
    ]);
    await ctx.owner.query("COMMIT");
    return dm;
  } catch (e) {
    await ctx.owner.query("ROLLBACK");
    throw e;
  }
}
// Owner-side seeds for states the three functions never produce themselves.
const bot = (c: string, t: string, type: "system" | "assistant"): Promise<string> =>
  id(
    `INSERT INTO chat_messages (channel_id, tenant_id, author_type, body, client_msg_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [c, t, type, body(type), randomUUID()],
  );
const hide = (m: string, actor: string) =>
  rows(
    `UPDATE chat_messages SET moderation_state = 'hidden', moderation_updated_at = now(),
       moderation_actor_person_id = $2, moderation_reason_code = 'spam' WHERE id = $1`,
    [m, actor],
  );
const backdate = (m: string, by: string) =>
  rows(`UPDATE chat_messages SET created_at = created_at - $2::interval WHERE id = $1`, [m, by]);
const tombstone = (m: string) =>
  rows(`UPDATE chat_messages SET author_deleted_at = now() WHERE id = $1`, [m]);
/** Everything a rejected call must leave untouched on one message, its revision count included. */
const snap = async (m: string) =>
  (
    await rows(
      `SELECT body, edit_count, edited_at, author_deleted_at, moderation_state,
         (SELECT count(*)::int FROM chat_message_revisions r WHERE r.message_id = $1) AS revisions
         FROM chat_messages WHERE id = $1`,
      [m],
    )
  )[0];
const cursors = (ch: string) =>
  rows(
    `SELECT person_id, last_read_created_at, last_read_message_id FROM chat_members
      WHERE channel_id = $1 ORDER BY person_id`,
    [ch],
  );
/** The id the member's cursor points at (null when unset); its created_at half must match that message. */
async function cursor(ch: string, p: string): Promise<string | null> {
  const [r] = await rows<{ id: string | null; ok: boolean }>(
    `SELECT cm.last_read_message_id AS id, cm.last_read_created_at IS NOT DISTINCT FROM m.created_at AS ok
       FROM chat_members cm LEFT JOIN chat_messages m ON m.id = cm.last_read_message_id
      WHERE cm.channel_id = $1 AND cm.person_id = $2`,
    [ch, p],
  );
  expect(r?.ok).toBe(true);
  return r?.id ?? null;
}

async function asApp<T>(g: Gucs, fn: (c: PoolClient) => Promise<T>, end = "COMMIT"): Promise<T> {
  const c = await ctx.appPool.connect();
  try {
    await c.query("BEGIN");
    await c.query(
      "SELECT set_config('app.tenant_id', $1, true), set_config('app.person_id', $2, true)",
      [g.tenant ?? "", g.person ?? ""],
    );
    const out = await fn(c);
    await c.query(end);
    return out;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
const one = <T>(g: Gucs, sql: string, args: unknown[], end?: string): Promise<T> =>
  asApp(g, async (c) => (await c.query(sql, args)).rows[0] as T, end);
const post = async (g: Gucs, ch: string, tag: string | number = "m"): Promise<string> =>
  (await one<{ id: string }>(g, SEND, [ch, randomUUID(), body(tag)])).id;
const edit = (g: Gucs, ch: string, m: string, b: string | null, n: number, end?: string) =>
  one<Edited>(g, EDIT, [ch, m, b, n], end);
const del = (g: Gucs, ch: string, m: string, end?: string) =>
  one<Deleted>(g, DELETE, [ch, m], end);
const markRead = (g: Gucs, ch: string, through: string) => one(g, MARK, [ch, through]);

/** V-19: the error is exactly the code (P0001), no DETAIL or HINT, and never carries a body. */
async function rejects(p: Promise<unknown>, code: string): Promise<void> {
  const e = (await p.then(
    () => undefined,
    (err: unknown) => err,
  )) as DbError | undefined;
  expect(e?.message).toBe(code);
  expect([e?.code, e?.detail, e?.hint]).toEqual(["P0001", undefined, undefined]);
  expect(JSON.stringify(e)).not.toContain(SENTINEL);
}
/** The SQLSTATE a call fails with (undefined when it succeeds). */
const sqlstate = (p: Promise<unknown>): Promise<string | undefined> =>
  p.then(
    () => undefined,
    (err: DbError) => err.code,
  );
/** Commit an owner pg_notify marker and wait (at most 2 s) until it is heard; returns its index in `heard`. */
async function fence(): Promise<number> {
  const marker = `fence:${randomUUID()}`;
  await rows(`SELECT pg_notify('chat_realtime', $1)`, [marker]);
  await listener.query("SELECT 1");
  for (let i = 0; i < 100 && !heard.includes(marker); i++) {
    await new Promise((r) => setTimeout(r, 20));
  }
  expect(heard).toContain(marker);
  return heard.indexOf(marker);
}
/** Payloads heard since the fence at `from`: delivery follows commit order, so a new fence flushes them all. */
async function heardSince(from: number): Promise<string[]> {
  const to = await fence();
  return heard.slice(from + 1, to);
}

describe("0063 chat edit, delete and mark read", () => {
  it("DT-1 a non-member, a foreign tenant, an unknown channel or a missing actor cannot edit, delete or mark read", async () => {
    const { t, c, a } = await club();
    const other = await club();
    const m = await post(as(t, a), c);
    const foreign = await post(as(other.t, other.a), other.c);
    // created after the activations, so nobody holds a chat_members row in it
    const bare = await id(
      `INSERT INTO chat_channels (tenant_id, kind, title, is_default, sort_order, creation_origin, post_policy,
         assistant_enabled) VALUES ($1, 'club', 'extra', false, 1, 'system_bootstrap', 'all_members', false)
         RETURNING id`,
      [t],
    );
    const before = [await snap(m), await snap(foreign), await cursors(c)];
    const cases: [string, Gucs, string][] = [
      ["non-member", as(t, other.a), c],
      ["no chat_members row", as(t, a), bare],
      ["foreign tenant GUC", as(other.t, a), c],
      ["unknown channel", as(t, a), randomUUID()],
      ["missing person", { tenant: t }, c],
      ["malformed person", as(t, "not-a-uuid"), c],
      ["missing tenant", { person: a }, c],
    ];
    for (const [label, g, ch] of cases) {
      await rejects(edit(g, ch, m, body(label), 0), "CHAT_FORBIDDEN");
      await rejects(del(g, ch, m), "CHAT_FORBIDDEN");
      await rejects(markRead(g, ch, m), "CHAT_FORBIDDEN"); // membership precedes the through-message
    }
    // a member cannot reach a missing message, or one of another channel, through edit or delete
    for (const target of [randomUUID(), foreign]) {
      await rejects(edit(as(t, a), c, target, body("target"), 0), "CHAT_FORBIDDEN");
      await rejects(del(as(t, a), c, target), "CHAT_FORBIDDEN");
    }
    expect([await snap(m), await snap(foreign), await cursors(c)]).toEqual(before);
  });

  it("DT-5 an edit over 4000 code points is CHAT_MESSAGE_TOO_LARGE and a blank one INVALID_BODY; 4000 emoji pass", async () => {
    const { t, c, a } = await club();
    const g = as(t, a);
    const m = await post(g, c);
    const cases: [string | null, string][] = [
      [SENTINEL.padEnd(4001, "x"), "CHAT_MESSAGE_TOO_LARGE"],
      [SENTINEL + SHUTTLE.repeat(4001 - SENTINEL.length), "CHAT_MESSAGE_TOO_LARGE"],
      [null, "INVALID_BODY"],
      ["", "INVALID_BODY"],
      [String.fromCharCode(32, 9, 10, 32), "INVALID_BODY"], // space, tab, newline, space
    ];
    for (const [b, code] of cases) await rejects(edit(g, c, m, b, 0), code);
    expect(await snap(m)).toMatchObject({ edit_count: 0, revisions: 0 });
    expect((await edit(g, c, m, SHUTTLE.repeat(4000), 0)).changed).toBe(true);
    const [r] = await rows(`SELECT char_length(body)::int AS n FROM chat_messages WHERE id = $1`, [m]);
    expect(r).toEqual({ n: 4000 });
  });

  it("DT-8 edit by a non-author, of a system or assistant message, at 15 minutes, a sixth time, or of an own deleted or hidden message is CHAT_EDIT_WINDOW_CLOSED", async () => {
    const { t, c, a, b } = await club();
    const g = as(t, a);
    const [own, late, inside, fifth, gone, hidden] = [
      await post(g, c, 1),
      await post(g, c, 2),
      await post(g, c, 3),
      await post(g, c, 4),
      await post(g, c, 5),
      await post(g, c, 6),
    ];
    const [sys, assistant] = [await bot(c, t, "system"), await bot(c, t, "assistant")];
    await backdate(late, "15 minutes");
    await backdate(inside, "14 minutes");
    await tombstone(gone);
    await hide(hidden, b);
    for (let k = 0; k < 5; k++) await edit(g, c, fifth, body(`v${k}`), k);
    const cases: [string, string, string, number][] = [
      ["non-author", b, own, 0],
      ["system", a, sys, 0],
      ["assistant", a, assistant, 0],
      ["15 minutes", a, late, 0],
      ["sixth edit", a, fifth, 5],
      ["own deleted", a, gone, 0],
      ["own hidden", a, hidden, 0],
    ];
    for (const [label, who, m, n] of cases) {
      const before = await snap(m);
      await rejects(edit(as(t, who), c, m, body(label), n), "CHAT_EDIT_WINDOW_CLOSED");
      expect(await snap(m), label).toEqual(before);
    }
    expect((await edit(g, c, inside, body("inside"), 0)).changed).toBe(true); // 14 minutes: still open
  });

  it("DT-9 a stale expectedEditCount is CHAT_EDIT_CONFLICT before any write", async () => {
    const { t, c, a } = await club();
    const g = as(t, a);
    const m = await post(g, c);
    await rejects(edit(g, c, m, body(1), 1), "CHAT_EDIT_CONFLICT");
    await rejects(edit(g, c, m, "", 1), "CHAT_EDIT_CONFLICT"); // 4.2: the count is checked before the body
    expect(await snap(m)).toMatchObject({ edit_count: 0, revisions: 0 });
    await edit(g, c, m, body(1), 0);
    const before = await snap(m);
    await rejects(edit(g, c, m, body(2), 0), "CHAT_EDIT_CONFLICT");
    expect(await snap(m)).toEqual(before);
    expect(before).toMatchObject({ edit_count: 1, revisions: 1 });
  });

  it("DT-10 an accepted edit appends one revision holding the old body; an identical body is a no-op", async () => {
    const { t, c, a } = await club();
    const g = as(t, a);
    const m = await post(g, c, 0);
    const first = await edit(g, c, m, body(1), 0);
    expect(first).toMatchObject({ id: m, edit_count: 1, changed: true });
    expect(first.edited_at).toBeInstanceOf(Date);
    // identical body: the stored row comes back untouched; no revision, no count
    expect(await edit(g, c, m, body(1), 1)).toEqual({ ...first, changed: false });
    await edit(g, c, m, body(2), 1);
    const revisions = await rows(
      `SELECT revision_no, previous_body, edited_by_person_id FROM chat_message_revisions
        WHERE message_id = $1 ORDER BY revision_no`,
      [m],
    );
    expect(revisions).toEqual([
      { revision_no: 1, previous_body: body(0), edited_by_person_id: a },
      { revision_no: 2, previous_body: body(1), edited_by_person_id: a },
    ]);
    expect(await snap(m)).toMatchObject({ body: body(2), edit_count: 2, revisions: 2 });
  });

  it("DT-11 an author soft-delete stamps author_deleted_at once, a repeat is a no-op, and app cannot delete or restore", async () => {
    const { t, c, a, b } = await club();
    const g = as(t, a);
    const [m, h] = [await post(g, c, 0), await post(g, c, 1)];
    await hide(h, b);
    const first = await one<Deleted & { at_statement: boolean }>(
      g,
      `SELECT d.*, d.author_deleted_at = statement_timestamp() AS at_statement
         FROM delete_chat_message($1, $2) d`,
      [c, m],
    );
    expect(first).toMatchObject({ id: m, changed: true, at_statement: true }); // V-24
    expect(await del(g, c, m)).toEqual({
      id: m,
      author_deleted_at: first.author_deleted_at,
      changed: false,
    });
    for (const sql of [
      `DELETE FROM chat_messages WHERE id = $1`,
      `UPDATE chat_messages SET author_deleted_at = NULL WHERE id = $1`,
    ]) {
      expect(await sqlstate(asApp(g, (cl) => cl.query(sql, [m])))).toBe("42501");
    }
    // the row and its body stay; nothing restores it
    expect(await snap(m)).toMatchObject({ body: body(0), author_deleted_at: first.author_deleted_at });
    expect((await del(g, c, h)).changed).toBe(true); // V-10: allowed on a hidden message
  });

  it("DT-12 delete by a non-author, of a non-person message or by a former member is CHAT_FORBIDDEN", async () => {
    const { t, c, a, b } = await club();
    const left = await member(t);
    const [mine, theirs] = [await post(as(t, a), c), await post(as(t, left), c)];
    const [sys, assistant] = [await bot(c, t, "system"), await bot(c, t, "assistant")];
    await rows(`UPDATE memberships SET status = 'left' WHERE tenant_id = $1 AND person_id = $2`, [
      t,
      left,
    ]);
    const cases: [string, string][] = [
      [b, mine],
      [a, sys],
      [a, assistant],
      [left, theirs],
    ];
    for (const [who, m] of cases) await rejects(del(as(t, who), c, m), "CHAT_FORBIDDEN");
    // a former member keeps its chat_members row but may not edit or move the cursor either
    await rejects(edit(as(t, left), c, theirs, body("left"), 0), "CHAT_FORBIDDEN");
    await rejects(markRead(as(t, left), c, theirs), "CHAT_FORBIDDEN");
    for (const m of [mine, sys, assistant, theirs]) {
      expect(await snap(m)).toMatchObject({ author_deleted_at: null, edit_count: 0 });
    }
  });

  it("DT-17 edit, delete and mark read on a dm channel are CHAT_SAFETY_BLOCKED, flags off and flipped on", async () => {
    const { t, c, a, b, d } = await club();
    const m = await post(as(t, a), c);
    const dm = await seedDm(a, b);
    const flags = (on: boolean) =>
      rows(
        `UPDATE chat_dm_safety_config SET block_enabled = $1, report_enabled = $1, rate_limit_enabled = $1,
           audit_enabled = $1`,
        [on],
      );
    const before = [await snap(m), await cursors(dm)];
    try {
      for (const on of [false, true]) {
        await flags(on);
        // a participant and an outsider, with a club message id: the kind precedes membership and message
        for (const who of [a, d]) {
          await rejects(edit(as(t, who), dm, m, body("dm"), 0), "CHAT_SAFETY_BLOCKED");
          await rejects(del(as(t, who), dm, m), "CHAT_SAFETY_BLOCKED");
          await rejects(markRead(as(t, who), dm, m), "CHAT_SAFETY_BLOCKED");
        }
      }
    } finally {
      await flags(false);
    }
    expect([await snap(m), await cursors(dm)]).toEqual(before);
  });

  it("DT-19 the 31st accepted edit or delete in a minute is CHAT_RATE_LIMITED; no-ops never count", async () => {
    const { t, c, a } = await club();
    const g = as(t, a);
    const [m1, m2, m3] = [await post(g, c, 1), await post(g, c, 2), await post(g, c, 3)];
    const bucket = `chat_edit_1m:${a}:${c}`; // V-8: one bucket for edit and delete, uuids only
    const send10 = `chat_send_10s:${a}:${c}`;
    const send1m = `chat_send_1m:${a}:${c}`;
    // every bucket keyed by this person, with its hit count
    const hits = async (): Promise<Record<string, number>> =>
      Object.fromEntries(
        (
          await rows<{ bucket: string; n: number }>(
            `SELECT bucket, count(*)::int AS n FROM rate_limit_hits WHERE strpos(bucket, $1) > 0
              GROUP BY bucket`,
            [a],
          )
        ).map((r) => [r.bucket, r.n]),
      );
    await rows(`INSERT INTO rate_limit_hits (bucket) SELECT $1 FROM generate_series(1, 27)`, [
      bucket,
    ]);
    expect(await hits()).toEqual({ [bucket]: 27, [send10]: 3, [send1m]: 3 });
    await edit(g, c, m1, body(11), 0); // 28
    expect((await edit(g, c, m1, body(11), 1)).changed).toBe(false); // identical: no token
    await del(g, c, m2); // 29
    expect((await del(g, c, m2)).changed).toBe(false); // already deleted: no token
    expect((await edit(g, c, m1, body(12), 1)).changed).toBe(true); // 30: still admitted
    expect(await hits()).toEqual({ [bucket]: 30, [send10]: 3, [send1m]: 3 });
    await rejects(del(g, c, m3), "CHAT_RATE_LIMITED"); // the 31st
    await rejects(edit(g, c, m3, body(13), 0), "CHAT_RATE_LIMITED");
    expect((await del(g, c, m2)).changed).toBe(false); // a no-op is not rate-checked
    await rejects(edit(g, c, m3, body(13), 1), "CHAT_EDIT_CONFLICT"); // the rate is the last check
    expect(await snap(m3)).toMatchObject({ body: body(3), edit_count: 0, author_deleted_at: null });
  });

  it("DT-20 mark read moves only the caller's own cursor, forward only, and never notifies", async () => {
    const { t, c, a, b, d } = await club();
    const g = as(t, a);
    const [m1, m2, m3, m4] = [
      await post(g, c, 1),
      await post(g, c, 2),
      await post(g, c, 3),
      await post(g, c, 4),
    ];
    const other = await club();
    const foreign = await post(as(other.t, other.a), other.c);
    await tombstone(m4);
    expect(await cursor(c, b)).toBeNull();
    const from = await fence();
    await markRead(as(t, b), c, m2);
    expect(await cursor(c, b)).toBe(m2);
    await markRead(as(t, b), c, m1); // backward: unchanged
    expect(await cursor(c, b)).toBe(m2);
    await markRead(as(t, b), c, m4); // forward past m3, onto a tombstoned message
    expect(await cursor(c, b)).toBe(m4);
    await rejects(markRead(as(t, other.a), c, m3), "CHAT_FORBIDDEN");
    for (const through of [foreign, randomUUID()]) {
      await rejects(markRead(as(t, b), c, through), "NOT_FOUND");
    }
    expect([await cursor(c, b), await cursor(c, a), await cursor(c, d)]).toEqual([m4, null, null]);
    expect(await heardSince(from)).toEqual([]);
  });

  it("DT-24 a committed edit or delete notifies its id once; no-ops, rollbacks and rejections notify nothing", async () => {
    const { t, c, a, b } = await club();
    const g = as(t, a);
    const m = await post(g, c, 0);
    const from = await fence();
    await edit(g, c, m, body(1), 0); // 1
    await edit(g, c, m, body(1), 1); // identical: 0
    await rejects(edit(g, c, m, body(2), 0), "CHAT_EDIT_CONFLICT"); // 0
    await rejects(edit(as(t, b), c, m, body(2), 1), "CHAT_EDIT_WINDOW_CLOSED"); // 0
    expect((await edit(g, c, m, body(2), 1, "ROLLBACK")).changed).toBe(true); // rolled back: 0
    expect((await del(g, c, m, "ROLLBACK")).changed).toBe(true); // rolled back: 0
    await del(g, c, m); // 1
    await del(g, c, m); // already deleted: 0
    // the payload is the message id text and nothing else
    expect(await heardSince(from)).toEqual([m, m]);
  });

  it("V-6 edit, delete and mark read queue on the channel row lock", async () => {
    const { t, c, a } = await club();
    const m = await post(as(t, a), c);
    const calls: [string, unknown[]][] = [
      [EDIT, [c, m, body(1), 0]],
      [DELETE, [c, m]],
      [MARK, [c, m]],
    ];
    await ctx.owner.query("BEGIN");
    try {
      await ctx.owner.query(`SELECT id FROM chat_channels WHERE id = $1 FOR NO KEY UPDATE`, [c]);
      for (const [sql, args] of calls) {
        const blocked = asApp(as(t, a), async (cl) => {
          await cl.query("SET LOCAL lock_timeout = '200ms'");
          return cl.query(sql, args);
        });
        expect(await sqlstate(blocked)).toBe("55P03");
      }
    } finally {
      await ctx.owner.query("ROLLBACK");
    }
    expect(await snap(m)).toMatchObject({ edit_count: 0, author_deleted_at: null });
  });

  it("V-24 the edit window is measured at statement_timestamp(), not at the transaction start", async () => {
    const { t, c, a } = await club();
    const m = await post(as(t, a), c);
    // created_at + 15 minutes lands 1 s from now: still open at the BEGIN below, closed when the edit runs
    await rows(
      `UPDATE chat_messages SET created_at = clock_timestamp() - interval '15 minutes' + interval '1 second'
        WHERE id = $1`,
      [m],
    );
    const late = asApp(as(t, a), async (cl) => {
      await cl.query("SELECT pg_sleep(1.5)");
      return cl.query(EDIT, [c, m, body(1), 0]);
    });
    await rejects(late, "CHAT_EDIT_WINDOW_CLOSED");
  });
});

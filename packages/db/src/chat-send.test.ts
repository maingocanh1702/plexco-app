import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupRlsTestContext, type RlsTestContext } from "./test-harness.js";

// 0063 SECTION 2 send_chat_message (readiness 4.1 V-1..V-8, V-19, V-20; 4.2 send pipeline; 4.5 NOTIFY contract): the
// send legs of DT-1..DT-7, DT-17, DT-18, DT-24 and DT-25 on the real DB. Members come from the W2 trigger; every call
// runs as the app role with app.tenant_id / app.person_id set through set_config inside the test transaction.
const TEST_DB_NAME = "plexco_chat_send";
const SENTINEL = "sentinel-c41b-chat-body";
const UUID = /^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$/;

type Gucs = { tenant?: string; person?: string };
type Sent = { id: string; created_at: Date; duplicate: boolean };
type DbError = Error & { code?: string; detail?: string; hint?: string };

let ctx: RlsTestContext;
let listener: PoolClient;
const heard: string[] = []; // every chat_realtime payload, in arrival order
const committed: string[] = []; // every new message id whose send committed
let s9Misses = 0; // S-9: flushes where one SELECT 1 on the listener did not deliver what was committed

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

async function rows<T = Record<string, unknown>>(
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  return (await ctx.owner.query(text, values)).rows as T[];
}
const id = async (text: string, values: unknown[] = []): Promise<string> =>
  ((await rows(text, values))[0] as { id: string }).id;
const cmid = (): string => randomUUID();
const as = (tenant: string, person: string): Gucs => ({ tenant, person });
const count = async (channel: string): Promise<number> =>
  (
    (
      await rows(`SELECT count(*)::int AS n FROM chat_messages WHERE channel_id = $1`, [channel])
    )[0] as { n: number }
  ).n;
const tenant = (): Promise<string> =>
  id(`INSERT INTO tenants (name, slug, status) VALUES ('chat-send', $1, 'active') RETURNING id`, [
    `send-${randomUUID().slice(0, 8)}`,
  ]);
const person = (): Promise<string> =>
  id(`INSERT INTO persons (display_name) VALUES ('chat-send') RETURNING id`);
async function member(t: string): Promise<string> {
  const p = await person();
  await rows(`INSERT INTO memberships (tenant_id, person_id, status) VALUES ($1, $2, 'active')`, [
    t,
    p,
  ]);
  return p;
}
const channel = (t: string, policy = "all_members"): Promise<string> =>
  id(
    `INSERT INTO chat_channels (tenant_id, kind, title, is_default, sort_order, creation_origin, post_policy,
       assistant_enabled) VALUES ($1, 'club', 'extra', false, 1, 'system_bootstrap', $2, false) RETURNING id`,
    [t, policy],
  );
/** A club with three members; a policy channel is created first so the trigger provisions its rows too. */
async function club(policy?: string) {
  const t = await tenant();
  const extra = policy ? await channel(t, policy) : undefined;
  const [a, b, d] = [await member(t), await member(t), await member(t)];
  const c =
    extra ?? (await id(`SELECT id FROM chat_channels WHERE tenant_id = $1 AND is_default`, [t]));
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
async function send(
  g: Gucs,
  ch: string,
  key: string | null,
  body: string | null,
  reply: string | null = null,
  end = "COMMIT",
): Promise<Sent> {
  const sql = "SELECT id, created_at, duplicate FROM send_chat_message($1, $2, $3, $4)";
  const r = await asApp(
    g,
    async (c) => (await c.query(sql, [ch, key, body, reply])).rows[0] as Sent,
    end,
  );
  if (end === "COMMIT" && !r.duplicate) committed.push(r.id);
  return r;
}
/** V-19: the error is exactly the code (P0001), no DETAIL or HINT, and never carries the body. */
async function rejects(p: Promise<unknown>, code: string): Promise<void> {
  const e = (await p.then(
    () => undefined,
    (err: unknown) => err,
  )) as DbError | undefined;
  expect(e?.message).toBe(code);
  expect([e?.code, e?.detail, e?.hint]).toEqual(["P0001", undefined, undefined]);
  expect(JSON.stringify(e)).not.toContain(SENTINEL);
}
/** S-9: one SELECT 1 on the listener should deliver every committed notification; else poll at most 2 s. */
async function flush(done: () => boolean): Promise<void> {
  await listener.query("SELECT 1");
  if (done()) return;
  s9Misses += 1;
  const until = Date.now() + 2_000;
  while (!done() && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 25));
    await listener.query("SELECT 1");
  }
}
/** Waits for the last expected payload (commit order), then asserts that nothing else arrived since mark. */
async function hear(mark: number, expected: string[]): Promise<void> {
  const last = expected[expected.length - 1] ?? "";
  await flush(() => heard.slice(mark).includes(last));
  expect(heard.slice(mark)).toEqual(expected);
}

describe("send_chat_message (0063 SECTION 2)", () => {
  it("an active member sends: one person row on the own membership; a slash-leading body is accepted (V-20)", async () => {
    const { t, c, a } = await club();
    const r = await send(as(t, a), c, cmid(), "/help");
    expect(r.duplicate).toBe(false);
    expect(
      await rows(
        `SELECT author_type, author_person_id, body, tenant_id,
                membership_id = (SELECT id FROM memberships WHERE person_id = $2) AS own
           FROM chat_messages WHERE id = $1`,
        [r.id, a],
      ),
    ).toEqual([
      { author_type: "person", author_person_id: a, body: "/help", tenant_id: t, own: true },
    ]);
  });

  it("DT-1 non-member, no chat_members row, wrong tenant, unknown channel, missing person -> CHAT_FORBIDDEN", async () => {
    const { t, c, a } = await club();
    const other = await club();
    const late = await channel(t); // created after the memberships: nobody has a chat_members row in it
    const cases: [Gucs, string][] = [
      [as(t, await person()), c],
      [as(t, a), late],
      [as(other.t, a), c],
      [as(other.t, other.a), c],
      [as(t, a), randomUUID()],
      [{ tenant: t }, c],
      [{ tenant: t, person: "not-a-uuid" }, c],
      [{ person: a }, c],
    ];
    for (const [g, ch] of cases) await rejects(send(g, ch, cmid(), SENTINEL), "CHAT_FORBIDDEN");
    expect([await count(c), await count(late)]).toEqual([0, 0]);
  });

  it("DT-2 admins_only needs chat.channel.post_restricted; a denied authorize fails closed", async () => {
    const { t, c, a, b, d } = await club("admins_only");
    const admin = (p: string, role: string, active: boolean) =>
      rows(
        `INSERT INTO tenant_admins (tenant_id, platform, platform_user_lookup_hash, role, active)
         VALUES ($1, 'web', $2, $3, $4)`,
        [t, p, role, active],
      );
    await admin(b, "owner", true);
    await admin(d, "admin", false);
    await rejects(send(as(t, a), c, cmid(), SENTINEL), "CHAT_CAPABILITY_REQUIRED");
    await rejects(send(as(t, d), c, cmid(), SENTINEL), "CHAT_CAPABILITY_REQUIRED");
    expect(await count(c)).toBe(0);
    expect((await send(as(t, b), c, cmid(), "owner post")).duplicate).toBe(false);
  });

  it("DT-3 the same author's client_msg_id returns the original: duplicate, one row, body not compared", async () => {
    const { t, c, a } = await club();
    const key = cmid();
    const first = await send(as(t, a), c, key, "original");
    expect(await send(as(t, a), c, key, SENTINEL)).toEqual({ ...first, duplicate: true });
    expect(await rows(`SELECT body FROM chat_messages WHERE channel_id = $1`, [c])).toEqual([
      { body: "original" },
    ]);
  });

  it("DT-4 another author's or a system message's client_msg_id is CHAT_IDEMPOTENCY_MISMATCH", async () => {
    const { t, c, a, b } = await club();
    const key = cmid();
    await send(as(t, a), c, key, "original");
    await rejects(send(as(t, b), c, key, SENTINEL), "CHAT_IDEMPOTENCY_MISMATCH");
    const sys = cmid();
    await rows(
      `INSERT INTO chat_messages (channel_id, author_type, body, client_msg_id) VALUES ($1, 'system', 'notice', $2)`,
      [c, sys],
    );
    await rejects(send(as(t, a), c, sys, SENTINEL), "CHAT_IDEMPOTENCY_MISMATCH");
    expect(
      await rows(`SELECT author_person_id, body FROM chat_messages WHERE client_msg_id = $1`, [
        key,
      ]),
    ).toEqual([{ author_person_id: a, body: "original" }]);
  });

  it("DT-5 the body cap is 4000 code points: 4000 with emoji is accepted, 4001 is CHAT_MESSAGE_TOO_LARGE", async () => {
    const { t, c, a } = await club();
    const body = "\u{1F600}".repeat(10) + "a".repeat(3990);
    expect([...body]).toHaveLength(4000);
    await send(as(t, a), c, cmid(), body);
    await rejects(send(as(t, a), c, cmid(), SENTINEL.padEnd(4001, "a")), "CHAT_MESSAGE_TOO_LARGE");
    expect(await count(c)).toBe(1);
  });

  it("DT-6 an empty body and a bad client_msg_id are INVALID_BODY", async () => {
    const { t, c, a } = await club();
    for (const body of [null, "", " \n\t "])
      await rejects(send(as(t, a), c, cmid(), body), "INVALID_BODY");
    for (const key of [null, "", "k".repeat(65)])
      await rejects(send(as(t, a), c, key, SENTINEL), "INVALID_BODY");
    await send(as(t, a), c, "k".repeat(64), "boundary");
    expect(await count(c)).toBe(1);
  });

  it("DT-7 a missing, cross-channel, hidden or author-deleted reply target is CHAT_REPLY_INVALID", async () => {
    const { t, c, a } = await club();
    const foreign = await id(
      `INSERT INTO chat_messages (channel_id, author_type, body, client_msg_id)
       VALUES ($1, 'system', 'notice', $2) RETURNING id`,
      [await channel(t), cmid()],
    );
    const [target, hidden, deleted] = [
      (await send(as(t, a), c, cmid(), "target")).id,
      (await send(as(t, a), c, cmid(), "to hide")).id,
      (await send(as(t, a), c, cmid(), "to delete")).id,
    ];
    await rows(
      `UPDATE chat_messages SET moderation_state = 'hidden', moderation_updated_at = now(),
         moderation_actor_person_id = $2, moderation_reason_code = 'spam' WHERE id = $1`,
      [hidden, a],
    );
    await rows(`UPDATE chat_messages SET author_deleted_at = now() WHERE id = $1`, [deleted]);
    for (const bad of [randomUUID(), foreign, hidden, deleted])
      await rejects(send(as(t, a), c, cmid(), SENTINEL, bad), "CHAT_REPLY_INVALID");
    expect(await count(c)).toBe(3);
    const ok = await send(as(t, a), c, cmid(), "reply", target);
    expect(
      await rows(`SELECT reply_to_message_id FROM chat_messages WHERE id = $1`, [ok.id]),
    ).toEqual([{ reply_to_message_id: target }]);
  });

  it("DT-17 a dm channel is CHAT_SAFETY_BLOCKED before any other check, flags off and flipped on", async () => {
    const [pa, pb] = [await person(), await person()];
    const dm = await seedDm(pa, pb);
    const t = await tenant();
    const flags = (on: boolean) =>
      rows(
        `UPDATE chat_dm_safety_config SET block_enabled = $1, report_enabled = $1, rate_limit_enabled = $1,
           audit_enabled = $1`,
        [on],
      );
    try {
      for (const on of [false, true]) {
        await flags(on);
        await rejects(send(as(t, pa), dm, cmid(), SENTINEL), "CHAT_SAFETY_BLOCKED");
        await rejects(send({}, dm, null, null), "CHAT_SAFETY_BLOCKED");
      }
    } finally {
      await flags(false);
    }
    expect(await count(dm)).toBe(0);
  });

  it("DT-18 the 21st send in 10 s and the 301st in a minute are CHAT_RATE_LIMITED; replays never count", async () => {
    const { t, c, a, b } = await club();
    const key = cmid();
    await send(as(t, a), c, key, "first");
    for (let i = 0; i < 5; i++)
      expect((await send(as(t, a), c, key, SENTINEL)).duplicate).toBe(true);
    for (let i = 1; i < 20; i++) await send(as(t, a), c, cmid(), "burst");
    await rejects(send(as(t, a), c, cmid(), SENTINEL), "CHAT_RATE_LIMITED");
    expect((await send(as(t, a), c, key, "at the limit")).duplicate).toBe(true);
    expect(await count(c)).toBe(20);
    // the minute bucket: 299 live hits seeded for b; its next send is the 300th, the one after is the 301st
    await rows(`INSERT INTO rate_limit_hits (bucket) SELECT $1 FROM generate_series(1, 299)`, [
      `chat_send_1m:${b}:${c}`,
    ]);
    await send(as(t, b), c, cmid(), "300th");
    await rejects(send(as(t, b), c, cmid(), SENTINEL), "CHAT_RATE_LIMITED");
    expect(await count(c)).toBe(21);
  }, 30_000);

  it("DT-24 one id-only payload per committed send; none for a rollback, a replay or a rejected send", async () => {
    const { t, c, a } = await club();
    await flush(() => heard.length >= committed.length);
    const mark = heard.length;
    const key = cmid();
    const r = await send(as(t, a), c, key, SENTINEL);
    await hear(mark, [r.id]);
    const mark2 = heard.length;
    await send(as(t, a), c, cmid(), SENTINEL, null, "ROLLBACK");
    expect((await send(as(t, a), c, key, SENTINEL)).duplicate).toBe(true);
    await rejects(send(as(t, a), c, cmid(), SENTINEL.padEnd(4001, "a")), "CHAT_MESSAGE_TOO_LARGE");
    await rejects(send(as(t, a), c, cmid(), SENTINEL, randomUUID()), "CHAT_REPLY_INVALID");
    await rejects(send(as(t, await person()), c, cmid(), SENTINEL), "CHAT_FORBIDDEN");
    const barrier = await send(as(t, a), c, cmid(), "barrier");
    await hear(mark2, [barrier.id]);
  });

  it("DT-25 three concurrent senders keep a (created_at, id) total order without gap or duplicate", async () => {
    const { t, c, a, b, d } = await club();
    const sent = await Promise.all(
      [a, b, d].map(async (p) => {
        const ids: string[] = [];
        for (let i = 0; i < 10; i++) ids.push((await send(as(t, p), c, cmid(), "concurrent")).id);
        return ids;
      }),
    );
    const order = await rows<{ id: string }>(
      `SELECT id FROM chat_messages WHERE channel_id = $1 ORDER BY created_at, id`,
      [c],
    );
    expect(order.map((r) => r.id).sort()).toEqual(sent.flat().sort());
    expect(
      await rows(
        `SELECT count(*)::int AS total, count(DISTINCT id)::int AS ids, count(DISTINCT created_at)::int AS stamps
           FROM chat_messages WHERE channel_id = $1`,
        [c],
      ),
    ).toEqual([{ total: 30, ids: 30, stamps: 30 }]);
    const pos = new Map(order.map((r, i) => [r.id, i] as const));
    for (const ids of sent) {
      const at = ids.map((x) => pos.get(x) ?? -1);
      expect(at).toEqual([...at].sort((p, q) => p - q));
    }
  }, 30_000);

  it("DT-24 file-wide and S-9: every committed new message was announced exactly once, ids only", async () => {
    await flush(() => heard.length >= committed.length);
    expect([...heard].sort()).toEqual([...committed].sort());
    expect(heard.every((p) => UUID.test(p))).toBe(true);
    expect(s9Misses).toBe(0);
  });
});

import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupRlsTestContext, type RlsTestContext } from "./test-harness.js";

// 0063 moderate_chat_message with its command receipts and moderation audit (readiness 4.1 V-4, V-6, V-7, V-8, V-11,
// V-19, V-26; 4.2 moderate pipeline; 4.3 chat_moderation_audit + chat_command_receipts; 4.5 NOTIFY contract): DT-13..DT-16,
// the moderation leg of DT-17, the hide/restore legs of DT-24, DT-28..DT-30 and DT-38 on the real DB. Members come from
// the W2 trigger, person messages from send_chat_message; every call runs as the app role with app.tenant_id /
// app.person_id set through set_config inside the test transaction.
const TEST_DB_NAME = "plexco_chat_moderation";
const SENTINEL = "sentinel-5b1e-chat-mod-note"; // every reason note starts with it; only the audit row may hold it
const MODERATE =
  "SELECT message_id, moderation_state, changed FROM moderate_chat_message($1, $2, $3, $4, $5, $6)";
const SEND = "SELECT id FROM send_chat_message($1, $2, $3)";
const DELETE = "SELECT id FROM delete_chat_message($1, $2)";
const E_ACUTE = String.fromCodePoint(0xe9); // one code point, two UTF-8 bytes

type Gucs = { tenant?: string; person?: string };
type Cmd = {
  ch: string;
  m: string;
  cmd: string | null;
  action: string | null;
  reason: string | null;
  note?: string | null;
};
type Moderated = { message_id: string; moderation_state: string; changed: boolean };
type DbError = Error & { code?: string; detail?: string; hint?: string };
type Club = { t: string; c: string; mod: string; a: string; b: string };

let ctx: RlsTestContext;
let listener: PoolClient;
const heard: string[] = []; // every chat_realtime payload, in arrival (= commit) order
const errors: string[] = []; // every rejection message, for the sentinel sweep

beforeAll(async () => {
  ctx = await setupRlsTestContext(TEST_DB_NAME);
  listener = await ctx.appPool.connect();
  listener.on("notification", (n) => {
    if (n.channel === "chat_realtime") heard.push(n.payload ?? "");
  });
  await listener.query("LISTEN chat_realtime");
  // Seed preconditions, so a red run can only fail on the missing function: the owner admin holds the
  // capability, a plain member does not, and a freshly sent message is 'visible'.
  const f = await club();
  expect(await allowed(f.t, f.mod)).toBe(true);
  expect(await allowed(f.t, f.a)).not.toBe(true);
  expect((await state(await send(f, f.a, "precondition"))).moderation_state).toBe("visible");
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
const as = (tenant: string, person: string): Gucs => ({ tenant, person });
async function member(t: string): Promise<string> {
  const p = await id(`INSERT INTO persons (display_name) VALUES ('chat-mod') RETURNING id`);
  await rows(`INSERT INTO memberships (tenant_id, person_id, status) VALUES ($1, $2, 'active')`, [
    t,
    p,
  ]);
  return p;
}
/** A club with an owner-admin moderator and two plain members; the trigger provisions the default channel. */
async function club(): Promise<Club> {
  const t = await id(
    `INSERT INTO tenants (name, slug, status) VALUES ('chat-mod', $1, 'active') RETURNING id`,
    [`mod-${randomUUID().slice(0, 8)}`],
  );
  const [mod, a, b] = [await member(t), await member(t), await member(t)];
  // tenant_capability_authorize resolves a web admin by its person id (the tenant-capability-authority seed)
  await rows(
    `INSERT INTO tenant_admins (tenant_id, platform, platform_user_lookup_hash, role, active)
       VALUES ($1, 'web', $2, 'owner', true)`,
    [t, mod],
  );
  const c = await id(`SELECT id FROM chat_channels WHERE tenant_id = $1 AND is_default`, [t]);
  return { t, c, mod, a, b };
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
// Owner-side seeds for states the command functions never produce themselves.
const bot = (f: Club, type: "system" | "assistant"): Promise<string> =>
  id(
    `INSERT INTO chat_messages (channel_id, tenant_id, author_type, body, client_msg_id)
       VALUES ($1, $2, $3, 'chat-mod bot', $4) RETURNING id`,
    [f.c, f.t, type, randomUUID()],
  );
const seedHidden = (m: string, actor: string) =>
  rows(
    `UPDATE chat_messages SET moderation_state = 'hidden', moderation_updated_at = now(),
       moderation_actor_person_id = $2, moderation_reason_code = 'spam' WHERE id = $1`,
    [m, actor],
  );
/** State, the moderation trio and the author tombstone of one message (owner read: app cannot select them all). */
const state = async (m: string) =>
  (
    await rows(
      `SELECT moderation_state, moderation_updated_at, moderation_actor_person_id, moderation_reason_code,
         author_deleted_at FROM chat_messages WHERE id = $1`,
      [m],
    )
  )[0] as Record<string, unknown>;
const counts = async (...tenants: string[]) =>
  (
    await rows(
      `SELECT (SELECT count(*) FROM chat_moderation_audit WHERE tenant_id = ANY($1::uuid[]))::int AS audit,
         (SELECT count(*) FROM chat_command_receipts WHERE tenant_id = ANY($1::uuid[]))::int AS receipts`,
      [tenants],
    )
  )[0];
const audits = (m: string) =>
  rows(
    `SELECT tenant_id, channel_id, actor_person_id, action, reason_code, reason_note
       FROM chat_moderation_audit WHERE message_id = $1 ORDER BY created_at, id`,
    [m],
  );
/** The capability as moderate sees it: as app, inside the GUC transaction (tenant_admins is read under RLS). */
const allowed = (t: string, p: string): Promise<boolean | null | undefined> =>
  asApp(as(t, p), async (c) => {
    const q = `SELECT allowed FROM tenant_capability_authorize($1, 'chat.message.moderate', $2)`;
    return ((await c.query(q, [t, p])).rows[0] as { allowed: boolean | null } | undefined)?.allowed;
  });
/** V-26 canonical fingerprint, computed by the database exactly as pinned. */
const fingerprint = async (x: Cmd): Promise<string> =>
  (
    (
      await rows(
        `SELECT encode(sha256(convert_to(jsonb_build_array($1::text, $2::uuid::text, $3::text, $4::text)::text,
           'UTF8')), 'hex') AS f`,
        [x.action, x.m, x.reason, x.note ?? null],
      )
    )[0] as { f: string }
  ).f;
/** One receipt per (tenant, actor, command id): the hash and ids/action/state only, never note or message text. */
async function expectReceipt(f: Club, x: Cmd, result: Moderated): Promise<void> {
  const r = await rows(
    `SELECT tenant_id, action, canonical_fingerprint, result_json FROM chat_command_receipts
      WHERE actor_person_id = $1 AND command_id = $2`,
    [f.mod, x.cmd],
  );
  expect(r).toEqual([
    {
      tenant_id: f.t,
      action: `message.${x.action}`,
      canonical_fingerprint: await fingerprint(x),
      result_json: { ...result, action: x.action },
    },
  ]);
  expect(JSON.stringify(r)).not.toContain(SENTINEL);
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
const moderate = (g: Gucs, x: Cmd, end = "COMMIT"): Promise<Moderated> =>
  asApp(
    g,
    async (c) =>
      (await c.query(MODERATE, [x.ch, x.m, x.cmd, x.action, x.reason, x.note ?? null]))
        .rows[0] as Moderated,
    end,
  );
const send = (f: Club, p: string, tag: string): Promise<string> =>
  asApp(
    as(f.t, p),
    async (c) =>
      ((await c.query(SEND, [f.c, randomUUID(), `chat-mod body ${tag}`])).rows[0] as { id: string })
        .id,
  );
const cmd = (
  f: Club,
  m: string,
  action: string,
  reason = "spam",
  note: string | null = null,
): Cmd => ({
  ch: f.c,
  m,
  cmd: randomUUID(),
  action,
  reason,
  note,
});
/** A sentinel note of exactly `bytes` UTF-8 bytes but fewer characters, so only octet_length measures it right. */
const note = (bytes: number): string => {
  const pad = bytes - SENTINEL.length;
  return SENTINEL + E_ACUTE.repeat(Math.floor(pad / 2)) + "x".repeat(pad % 2);
};
/** A generic rejection: the message is the bare code (P0001), no detail or hint, so no id, body or note leaks. */
async function rejects(p: Promise<unknown>, code: string, label = code): Promise<void> {
  const e = await p.then(
    () => undefined,
    (err: DbError) => err,
  );
  errors.push(e?.message ?? "");
  expect(e?.message, label).toBe(code);
  expect([e?.code, e?.detail, e?.hint], label).toEqual(["P0001", undefined, undefined]);
}
/** Commits a fence NOTIFY and waits for it; payloads arrive in commit order, so everything before it is in. */
async function fence(): Promise<number> {
  const token = `fence:${randomUUID()}`;
  await ctx.owner.query("SELECT pg_notify('chat_realtime', $1)", [token]);
  for (let i = 0; i < 300 && !heard.includes(token); i++)
    await new Promise((r) => setTimeout(r, 10));
  expect(heard, "fence NOTIFY never arrived").toContain(token);
  return heard.indexOf(token);
}
const mark = async (): Promise<number> => (await fence()) + 1;
/** Payloads committed between mark() and now. */
const since = async (from: number): Promise<string[]> => heard.slice(from, await fence());
// ponytail: dodges a clock-aligned minute edge so 31 commands share one window; harmless for a sliding bucket.
async function awayFromMinuteEdge(): Promise<void> {
  const s = (
    (await rows(`SELECT extract(second FROM clock_timestamp())::float8 AS s`))[0] as { s: number }
  ).s;
  if (s > 50) await new Promise((r) => setTimeout(r, (61 - s) * 1000));
}

describe("moderate_chat_message (0063)", () => {
  it("DT-13 moderation forbidden is generic", async () => {
    const [f, f2] = [await club(), await club()];
    const m = await send(f, f.a, "target");
    const hidden = await send(f, f.a, "hidden");
    await seedHidden(hidden, f.mod);
    const foreign = await send(f2, f2.a, "foreign");
    const [asst, sys, dm] = [
      await bot(f, "assistant"),
      await bot(f, "system"),
      await seedDm(f.mod, f.a),
    ];
    const before = [await state(m), await state(hidden)];
    const from = await mark();
    const plain = as(f.t, f.a);
    const gm = as(f.t, f.mod);
    const cases: [string, Gucs, Partial<Cmd>, string?][] = [
      ["member without the capability, real id", plain, {}],
      ["member without the capability, random id", plain, { m: randomUUID() }],
      ["member without the capability, restore", plain, { m: hidden, action: "restore" }],
      [
        "member without the capability, bad reason: capability before input",
        plain,
        { reason: "nope" },
      ],
      ["non-member, real id", as(f.t, f2.a), {}],
      ["non-member, random id", as(f.t, f2.a), { m: randomUUID() }],
      ["moderator under a foreign tenant context", as(f2.t, f.mod), {}],
      ["moderator on another club's channel", gm, { ch: f2.c, m: foreign }],
      ["moderator, message of another channel", gm, { m: foreign }],
      ["moderator, random message id", gm, { m: randomUUID() }],
      ["moderator, assistant message", gm, { m: asst }],
      ["moderator, system message", gm, { m: sys }],
      ["moderator, DM channel", gm, { ch: dm }],
      ["DM channel is checked before the actor context", {}, { ch: dm }],
      ["moderator, random channel id", gm, { ch: randomUUID() }],
      ["no actor context on a club channel (V-7)", {}, {}, "CHAT_FORBIDDEN"],
    ];
    for (const [label, g, v, code = "CHAT_MODERATION_FORBIDDEN"] of cases)
      await rejects(moderate(g, { ...cmd(f, m, "hide"), ...v }), code, label);
    expect([await state(m), await state(hidden)]).toEqual(before);
    expect(await counts(f.t, f2.t)).toEqual({ audit: 0, receipts: 0 });
    expect(await since(from)).toEqual([]);
  });

  it("DT-14 reason and command validation", async () => {
    const f = await club();
    const m = await send(f, f.a, "validate");
    const before = await state(m);
    const from = await mark();
    const gm = as(f.t, f.mod);
    const invalid: [string, Partial<Cmd>, string][] = [
      ["unknown reason", { reason: "abuse" }, "CHAT_REASON_INVALID"],
      ["reason outside the exact-case set", { reason: "SPAM" }, "CHAT_REASON_INVALID"],
      ["no reason on hide", { reason: null }, "CHAT_REASON_INVALID"],
      ["no reason on restore", { action: "restore", reason: null }, "CHAT_REASON_INVALID"],
      ["other without a note", { reason: "other" }, "CHAT_REASON_INVALID"],
      ["other with a 0-byte note", { reason: "other", note: "" }, "CHAT_REASON_INVALID"],
      [
        "other with a 501-byte note of fewer characters",
        { reason: "other", note: note(501) },
        "CHAT_REASON_INVALID",
      ],
      ["a note with a non-other reason", { reason: "spam", note: note(40) }, "CHAT_REASON_INVALID"],
      ["NULL command id", { cmd: null }, "INVALID_BODY"],
      ["NULL action", { action: null }, "INVALID_BODY"],
      ["action outside hide|restore", { action: "delete" }, "INVALID_BODY"],
      ["action outside the exact-case set", { action: "Hide" }, "INVALID_BODY"],
    ];
    for (const [label, v, code] of invalid)
      await rejects(moderate(gm, { ...cmd(f, m, "hide"), ...v }), code, label);
    expect(await state(m)).toEqual(before);
    expect(await counts(f.t)).toEqual({ audit: 0, receipts: 0 });
    expect(await since(from)).toEqual([]);
    // the bound is octet_length: a 500-byte note of fewer characters is accepted and lands in the audit row only
    const ok = cmd(f, m, "hide", "other", note(500));
    expect(await moderate(gm, ok)).toEqual({
      message_id: m,
      moderation_state: "hidden",
      changed: true,
    });
    expect((await audits(m)).map((a) => a.reason_note)).toEqual([ok.note]);
    await expectReceipt(f, ok, { message_id: m, moderation_state: "hidden", changed: true });
  });

  it("DT-15 a same-state command with a new id: changed = false, its receipt, no audit row, no NOTIFY", async () => {
    const f = await club();
    const [shown, hidden] = [await send(f, f.a, "shown"), await send(f, f.a, "hidden")];
    await seedHidden(hidden, f.b);
    const before = [await state(shown), await state(hidden)];
    const from = await mark();
    const gm = as(f.t, f.mod);
    const restore = cmd(f, shown, "restore");
    const hide = cmd(f, hidden, "hide", "harassment");
    const shownResult = { message_id: shown, moderation_state: "visible", changed: false };
    const hiddenResult = { message_id: hidden, moderation_state: "hidden", changed: false };
    expect(await moderate(gm, restore)).toEqual(shownResult);
    expect(await moderate(gm, hide)).toEqual(hiddenResult);
    expect([await state(shown), await state(hidden)]).toEqual(before); // the seeded trio is not overwritten
    await expectReceipt(f, restore, shownResult);
    await expectReceipt(f, hide, hiddenResult);
    expect(await counts(f.t)).toEqual({ audit: 0, receipts: 2 });
    expect(await since(from)).toEqual([]);
  });

  it("DT-16 effective hide and restore: trio set then NULLed, one audit row, receipt and NOTIFY each", async () => {
    const f = await club();
    const m = await send(f, f.a, "effective");
    const gm = as(f.t, f.mod);
    let from = await mark();
    const hide = cmd(f, m, "hide", "other", note(48));
    expect(await moderate(gm, hide)).toEqual({
      message_id: m,
      moderation_state: "hidden",
      changed: true,
    });
    const hidden = await state(m);
    expect(hidden).toMatchObject({
      moderation_state: "hidden",
      moderation_actor_person_id: f.mod,
      moderation_reason_code: "other",
      author_deleted_at: null,
    });
    expect(hidden.moderation_updated_at).toBeInstanceOf(Date);
    const restore = cmd(f, m, "restore", "off_topic");
    expect(await moderate(gm, restore)).toEqual({
      message_id: m,
      moderation_state: "visible",
      changed: true,
    });
    expect(await state(m)).toEqual({
      moderation_state: "visible",
      moderation_updated_at: null,
      moderation_actor_person_id: null,
      moderation_reason_code: null,
      author_deleted_at: null,
    });
    const row = { tenant_id: f.t, channel_id: f.c, actor_person_id: f.mod };
    expect(await audits(m)).toEqual([
      { ...row, action: "hide", reason_code: "other", reason_note: hide.note },
      { ...row, action: "restore", reason_code: "off_topic", reason_note: null },
    ]);
    await expectReceipt(f, hide, { message_id: m, moderation_state: "hidden", changed: true });
    await expectReceipt(f, restore, { message_id: m, moderation_state: "visible", changed: true });
    expect(await since(from)).toEqual([m, m]);
    // delete + hide + restore: moderation never touches the author tombstone
    const d = await send(f, f.a, "deleted");
    await asApp(as(f.t, f.a), (c) => c.query(DELETE, [f.c, d]));
    const stamp = (await state(d)).author_deleted_at;
    expect(stamp).toBeInstanceOf(Date);
    from = await mark();
    expect((await moderate(gm, cmd(f, d, "hide"))).changed).toBe(true);
    expect((await moderate(gm, cmd(f, d, "restore"))).changed).toBe(true);
    expect((await state(d)).author_deleted_at).toEqual(stamp);
    expect(await counts(f.t)).toEqual({ audit: 4, receipts: 4 });
    expect(await since(from)).toEqual([d, d]);
  });

  it("DT-17 moderation leg: a DM is CHAT_MODERATION_FORBIDDEN, safety flags off and all four on", async () => {
    const f = await club();
    const dm = await seedDm(f.mod, f.a);
    const from = await mark();
    const flags = (on: boolean) =>
      rows(
        `UPDATE chat_dm_safety_config SET block_enabled = $1, report_enabled = $1, rate_limit_enabled = $1,
           audit_enabled = $1`,
        [on],
      );
    try {
      for (const on of [false, true]) {
        await flags(on);
        for (const action of ["hide", "restore"])
          await rejects(
            moderate(as(f.t, f.mod), { ...cmd(f, randomUUID(), action), ch: dm }),
            "CHAT_MODERATION_FORBIDDEN",
            `${action}, flags ${on}`,
          );
      }
    } finally {
      await flags(false);
    }
    expect(await counts(f.t)).toEqual({ audit: 0, receipts: 0 });
    expect(await since(from)).toEqual([]);
  });

  it("DT-24 hide and restore legs: one id-only payload per committed change, none for rollback or no-op", async () => {
    const f = await club();
    const m = await send(f, f.a, "notify");
    const gm = as(f.t, f.mod);
    const from = await mark();
    await moderate(gm, cmd(f, m, "hide"), "ROLLBACK"); // rolled back: no payload, no state
    expect((await state(m)).moderation_state).toBe("visible");
    const hide = cmd(f, m, "hide");
    await moderate(gm, hide); // hide 1
    await moderate(gm, cmd(f, m, "hide")); // re-hide 0
    await moderate(gm, hide); // receipt replay 0
    await rejects(moderate(gm, { ...hide, action: "restore" }), "CHAT_IDEMPOTENCY_MISMATCH"); // mismatch 0
    await moderate(gm, cmd(f, m, "restore")); // restore 1
    await moderate(gm, cmd(f, m, "restore")); // re-restore 0
    expect(await since(from)).toEqual([m, m]);
  });

  it("DT-28 an exact replay returns the stored result: no mutation, second audit row, receipt or NOTIFY", async () => {
    const f = await club();
    const [m, m2] = [await send(f, f.a, "replay"), await send(f, f.a, "later")];
    const gm = as(f.t, f.mod);
    const hide = cmd(f, m, "hide", "other", note(64));
    const first = await moderate(gm, hide);
    expect(first).toEqual({ message_id: m, moderation_state: "hidden", changed: true });
    const before = await state(m);
    const from = await mark();
    expect(await moderate(gm, hide)).toEqual(first);
    await moderate(gm, cmd(f, m2, "hide")); // a later command of the same actor
    expect(await moderate(gm, hide)).toEqual(first);
    expect(await state(m)).toEqual(before);
    expect(await audits(m)).toHaveLength(1);
    expect(await counts(f.t)).toEqual({ audit: 2, receipts: 2 });
    expect(await since(from)).toEqual([m2]);
    // the capability is checked before the receipt: a replay by an actor who lost it is denied (V-26)
    await rows(
      `UPDATE tenant_admins SET active = false WHERE tenant_id = $1 AND platform_user_lookup_hash = $2`,
      [f.t, f.mod],
    );
    expect(await allowed(f.t, f.mod)).not.toBe(true);
    await rejects(moderate(gm, hide), "CHAT_MODERATION_FORBIDDEN");
  });

  it("DT-29 the same command id with another action, message, reason or note: CHAT_IDEMPOTENCY_MISMATCH", async () => {
    const f = await club();
    const [m, m2] = [await send(f, f.a, "base"), await send(f, f.a, "other")];
    const gm = as(f.t, f.mod);
    const base = cmd(f, m, "hide", "other", note(32));
    await moderate(gm, base);
    const before = [await state(m), await state(m2)];
    const from = await mark();
    const variants: [string, Partial<Cmd>][] = [
      ["action", { action: "restore" }],
      ["message", { m: m2 }],
      ["reason code", { reason: "spam", note: null }],
      ["note", { note: note(33) }],
    ];
    for (const [label, v] of variants)
      await rejects(moderate(gm, { ...base, ...v }), "CHAT_IDEMPOTENCY_MISMATCH", label);
    expect([await state(m), await state(m2)]).toEqual(before);
    expect(await counts(f.t)).toEqual({ audit: 1, receipts: 1 });
    await expectReceipt(f, base, { message_id: m, moderation_state: "hidden", changed: true });
    expect(await since(from)).toEqual([]);
  });

  it("DT-30 a stale replay does not re-apply", async () => {
    const f = await club();
    const x = await send(f, f.a, "stale");
    const gm = as(f.t, f.mod);
    const c1 = cmd(f, x, "hide");
    const r1 = await moderate(gm, c1);
    expect(r1).toEqual({ message_id: x, moderation_state: "hidden", changed: true });
    await moderate(gm, cmd(f, x, "restore"));
    let from = await mark();
    expect(await moderate(gm, c1)).toEqual(r1);
    expect((await state(x)).moderation_state).toBe("visible");
    expect(await counts(f.t)).toEqual({ audit: 2, receipts: 2 });
    expect(await since(from)).toEqual([]);
    // same with a same-state command: c3 hides while hidden, a restore follows, then c3 replays
    await moderate(gm, cmd(f, x, "hide"));
    const c3 = cmd(f, x, "hide");
    const r3 = await moderate(gm, c3);
    expect(r3).toEqual({ message_id: x, moderation_state: "hidden", changed: false });
    await moderate(gm, cmd(f, x, "restore"));
    from = await mark();
    expect(await moderate(gm, c3)).toEqual(r3);
    expect((await state(x)).moderation_state).toBe("visible");
    expect(await counts(f.t)).toEqual({ audit: 4, receipts: 5 });
    expect(await since(from)).toEqual([]);
  });

  it("DT-38 the 31st newly accepted moderation command in a minute is CHAT_RATE_LIMITED; replays never count", async () => {
    await awayFromMinuteEdge();
    const f = await club();
    const m = await send(f, f.a, "rate");
    const gm = as(f.t, f.mod);
    const first = cmd(f, m, "hide");
    const stored = await moderate(gm, first);
    // 29 more accepted commands, effective (odd i) and same-state (even i) in turn; each is followed by an exact
    // replay and every 10th by a rejected command, and neither of those may consume a token
    for (let i = 1; i < 30; i++) {
      await moderate(gm, cmd(f, m, ["hide", "restore", "restore", "hide"][i % 4] as string));
      expect(await moderate(gm, first)).toEqual(stored);
      if (i % 10 === 0)
        await rejects(moderate(gm, cmd(f, m, "hide", "nope")), "CHAT_REASON_INVALID");
    }
    const from = await mark();
    const over = cmd(f, m, "hide");
    await rejects(moderate(gm, over), "CHAT_RATE_LIMITED");
    expect((await state(m)).moderation_state).toBe("visible");
    expect(await moderate(gm, first)).toEqual(stored); // a replay still answers from its receipt
    expect(await counts(f.t)).toEqual({ audit: 16, receipts: 30 });
    expect(
      await rows(`SELECT 1 FROM chat_command_receipts WHERE command_id = $1`, [over.cmd]),
    ).toEqual([]);
    expect(await since(from)).toEqual([]);
  }, 60_000);

  it("the sentinel note reaches no error message, receipt or NOTIFY payload (only the audit row)", async () => {
    const [r] = await rows<{ n: number; leaks: number }>(
      `SELECT count(*)::int AS n, (count(*) FILTER (WHERE strpos(row_to_json(r)::text, $1) > 0))::int AS leaks
         FROM chat_command_receipts r`,
      [SENTINEL],
    );
    const [a] = await rows<{ n: number }>(
      `SELECT count(*)::int AS n FROM chat_moderation_audit WHERE strpos(reason_note, $1) = 1`,
      [SENTINEL],
    );
    expect(a?.n).toBeGreaterThan(0); // the note did reach the function
    expect(r?.n).toBeGreaterThan(0);
    expect(r?.leaks).toBe(0);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.filter((e) => e.includes(SENTINEL))).toEqual([]);
    expect(heard.filter((p) => p.includes(SENTINEL))).toEqual([]);
  });
});

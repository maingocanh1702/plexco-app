import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { inspect } from "node:util";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  ChatCommandError,
  deleteChatMessage,
  editChatMessage,
  getChatMessage,
  listChatMessages,
  markChatRead,
  moderateChatMessage,
  sendChatMessage,
  withChatActor,
  type ChatTx,
} from "./chat-service.js";
import { setupRlsTestContext, type RlsTestContext } from "./test-harness.js";

// chat-service.ts over the 0063 definers (readiness 4.8, V-7, V-19, V-23; API pinned in the W5a1 hand-off): the seven
// wrappers round-trip as the real app role through withChatActor; the V-19 allowlist maps each P0001 code to
// ChatCommandError(code, status) and any other database error to a new Error carrying only its SQLSTATE (DT-36, DT-37);
// a suspended tenant's chat is frozen before any definer call (DT-39); no sentinel body or note reaches a console spy,
// a thrown error or a NOTIFY payload during the whole file (DT-26). Members come from the W2 trigger; the moderator is
// the club's owner-admin (it holds chat.message.moderate).
const TEST_DB_NAME = "plexco_chat_service";
const SENT = "sentinel-5f1e-chat-service-body";
const NOTE = "sentinel-5f1e-chat-service-note";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Club = { t: string; c: string; mod: string; a: string; b: string };
type Thrown = Error & Record<string, unknown>;

let ctx: RlsTestContext;
let r: Club; // the round-trip club
let outsider: string; // no membership anywhere
const msgs: string[] = []; // r's person messages, oldest first
const payloads: string[] = []; // every chat_realtime NOTIFY payload of the file
const thrown: unknown[] = []; // every rejection of the file
let spies: { mock: { calls: unknown[][] } }[] = [];

beforeAll(async () => {
  spies = (["log", "info", "warn", "error", "debug"] as const).map((k) => vi.spyOn(console, k));
  ctx = await setupRlsTestContext(TEST_DB_NAME);
  ctx.owner.on("notification", (n) => {
    if (n.channel === "chat_realtime") payloads.push(n.payload ?? "");
  });
  await q("LISTEN chat_realtime");
  r = await club();
  outsider = await person();
}, 180_000);

afterAll(async () => {
  vi.restoreAllMocks();
  await ctx?.teardown();
});

async function q(text: string, values: unknown[] = []): Promise<Record<string, unknown>[]> {
  return (await ctx.owner.query(text, values)).rows as Record<string, unknown>[];
}
const id = async (text: string, values: unknown[] = []): Promise<string> =>
  (await q(text, values))[0]!.id as string;
const person = () => id(`INSERT INTO persons (display_name) VALUES ('chat-service') RETURNING id`);
const join = (t: string, p: string) =>
  id(
    `INSERT INTO memberships (tenant_id, person_id, status) VALUES ($1, $2, 'active') RETURNING id`,
    [t, p],
  );
/** An active club with an active subscription (the V-23 gate allows it), an owner-admin moderator and two members. */
async function club(): Promise<Club> {
  const t = await id(
    `INSERT INTO tenants (name, slug, status) VALUES ('chat-service', $1, 'active') RETURNING id`,
    [`svc-${randomUUID().slice(0, 8)}`],
  );
  await q(
    `INSERT INTO subscriptions (tenant_id, plan_key, plan_version, status, period_start, period_end)
       VALUES ($1, 'free', 1, 'active', now(), now() + interval '30 days')`,
    [t],
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
const count = async (channel: string) =>
  Number(
    (await q(`SELECT count(*) AS n FROM chat_messages WHERE channel_id = $1`, [channel]))[0]!.n,
  );
/** Lets every NOTIFY of an already-committed transaction reach the listener. */
async function flush() {
  await q("SELECT pg_sleep(0.05)");
  await q("SELECT 1");
}

const run = <T>(t: string, p: string, fn: (tx: ChatTx) => Promise<T>) =>
  withChatActor(ctx.appDb.db, { tenantId: t, personId: p }, fn);
const send = (c: Club, p: string, body: string, replyTo?: string) =>
  run(c.t, p, (tx) =>
    sendChatMessage(tx, {
      channelId: c.c,
      clientMsgId: randomUUID(),
      body,
      replyToMessageId: replyTo ?? null,
    }),
  );
const hide = (
  c: Club,
  p: string,
  messageId: string,
  reasonCode: string,
  commandId = randomUUID(),
) =>
  run(c.t, p, (tx) =>
    moderateChatMessage(tx, {
      channelId: c.c,
      messageId,
      commandId,
      action: "hide",
      reasonCode,
      reasonNote: NOTE,
    }),
  );
const get = (c: Club, p: string, messageId: string) =>
  run(c.t, p, (tx) => getChatMessage(tx, { messageId }));

/** The rejection of `p`, recorded for the DT-26 scan; fails the test when `p` resolves. */
async function fail(p: Promise<unknown>): Promise<Thrown> {
  const e: unknown = await p.then(
    () => {
      throw new Error("expected a rejection");
    },
    (err: unknown) => err,
  );
  thrown.push(e);
  return e as Thrown;
}
const dump = (e: unknown) =>
  `${inspect(e, { depth: 10, showHidden: true })} ${String((e as { stack?: unknown }).stack)}`;
function expectCode(e: Thrown, code: string, status: number) {
  expect(e, code).toBeInstanceOf(ChatCommandError);
  expect({ code: e.code, status: e.status, message: e.message, cause: e.cause }, code).toEqual({
    code,
    status,
    message: code,
    cause: undefined,
  });
}
/** DT-36 / DT-37: provoke a constraint violation on the send path whose driver DETAIL would hold the body. */
async function provoke(setup: string[], undo: string, sqlstate: string) {
  const z = await club();
  const body = `${SENT}-${sqlstate}`;
  await send(z, z.a, body);
  for (const ddl of setup) await q(ddl);
  try {
    const e = await fail(send(z, z.a, body));
    expect(e).toBeInstanceOf(Error);
    expect(e).not.toBeInstanceOf(ChatCommandError);
    expect(e.message).toBe(`CHAT_DB_ERROR:${sqlstate}`);
    for (const k of ["detail", "hint", "where", "cause"]) expect(e[k], k).toBeUndefined();
    expect(dump(e)).not.toContain(SENT);
  } finally {
    await q(undo);
  }
}

describe("chat-service wrappers through withChatActor (0063, readiness 4.8)", () => {
  it("send, duplicate replay (CHAT_DUP_MESSAGE is a result), edit, get and the idempotent author delete round-trip", async () => {
    const clientMsgId = randomUUID();
    const once = () =>
      run(r.t, r.a, (tx) =>
        sendChatMessage(tx, { channelId: r.c, clientMsgId, body: `${SENT}-1` }),
      );
    const first = await once();
    expect(first).toEqual({
      id: expect.stringMatching(UUID),
      createdAt: expect.any(String),
      duplicate: false,
    });
    const n = await count(r.c);
    expect(await once()).toEqual({ ...first, duplicate: true });
    expect(await count(r.c)).toBe(n);
    const edited = await run(r.t, r.a, (tx) =>
      editChatMessage(tx, {
        channelId: r.c,
        messageId: first.id,
        body: `${SENT}-1e`,
        expectedEditCount: 0,
      }),
    );
    expect(edited).toEqual({
      id: first.id,
      editCount: 1,
      editedAt: expect.any(String),
      changed: true,
    });
    expect(await get(r, r.b, first.id)).toMatchObject({
      id: first.id,
      channelId: r.c,
      authorPersonId: r.a,
      body: `${SENT}-1e`,
      replyToMessageId: null,
      editCount: 1,
      tombstone: null,
      createdAt: first.createdAt,
    });
    const del = () =>
      run(r.t, r.a, (tx) => deleteChatMessage(tx, { channelId: r.c, messageId: first.id }));
    const gone = await del();
    expect(gone).toEqual({ id: first.id, authorDeletedAt: expect.any(String), changed: true });
    expect(await del()).toEqual({ ...gone, changed: false });
    expect(await get(r, r.b, first.id)).toMatchObject({
      id: first.id,
      body: null,
      tombstone: expect.any(String),
    });
    expect(await get(r, r.b, randomUUID())).toBeNull();
    msgs.push(first.id);
  });

  it("moderate hide, exact replay (the stored receipt), restore and markRead; a hidden message is a tombstone to others", async () => {
    const m = (await send(r, r.a, `${SENT}-2`)).id;
    const commandId = randomUUID();
    const hidden = await hide(r, r.mod, m, "other", commandId);
    expect(hidden).toEqual({ messageId: m, moderationState: expect.any(String), changed: true });
    expect(await hide(r, r.mod, m, "other", commandId)).toEqual(hidden);
    expect(await get(r, r.b, m)).toMatchObject({
      id: m,
      body: null,
      tombstone: expect.any(String),
    });
    const restored = await run(r.t, r.mod, (tx) =>
      moderateChatMessage(tx, {
        channelId: r.c,
        messageId: m,
        commandId: randomUUID(),
        action: "restore",
        reasonCode: "off_topic",
      }),
    );
    expect(restored).toEqual({ messageId: m, moderationState: expect.any(String), changed: true });
    expect(restored.moderationState).not.toBe(hidden.moderationState);
    expect(await get(r, r.b, m)).toMatchObject({ id: m, body: `${SENT}-2`, tombstone: null });
    await expect(
      run(r.t, r.b, (tx) => markChatRead(tx, { channelId: r.c, throughMessageId: m })),
    ).resolves.toBeUndefined();
    msgs.push(m);
  });

  it("listChatMessages pages carry createdAt as a string (W4a pin 8): an 'after' walk never re-reads its cursor row", async () => {
    msgs.push((await send(r, r.a, `${SENT}-3`)).id);
    const walk: string[] = [];
    let cur: { createdAt: string; id: string } | null = null;
    for (let i = 0; i < 20; i += 1) {
      const at: string | null = cur?.createdAt ?? null;
      const cid: string | null = cur?.id ?? null;
      const page: { createdAt: string; id: string }[] = await run(r.t, r.b, (tx) =>
        listChatMessages(tx, {
          channelId: r.c,
          cursorCreatedAt: at,
          cursorId: cid,
          direction: "after",
          limit: 1,
        }),
      );
      if (page.length === 0) break;
      expect(typeof page[0]!.createdAt).toBe("string");
      expect(walk).not.toContain(page[0]!.id); // a Date cursor drops the microseconds and re-reads this row
      walk.push(page[0]!.id);
      cur = page[0]!;
    }
    expect(walk.filter((x) => msgs.includes(x))).toEqual(msgs);
    const newest = await run(r.t, r.b, (tx) => listChatMessages(tx, { channelId: r.c }));
    expect(newest.map((x) => x.id)).toEqual([...walk].reverse());
    // L15a: the list row carries 0065's label, read by r.b: the AUTHOR's club name on a live row,
    // null on a tombstone and for every other author; persons.display_name ('chat-service') never.
    expect(newest.map((x) => x.authorLabel)).toEqual(newest.map(() => null));
    const name = "sentinel-5f1e-club-name-a";
    const setName = (v: string | null) =>
      q(`UPDATE memberships SET display_name = $3 WHERE tenant_id = $1 AND person_id = $2`, [
        r.t,
        r.a,
        v,
      ]);
    await setName(name);
    try {
      const named = await run(r.t, r.b, (tx) => listChatMessages(tx, { channelId: r.c }));
      expect(named.some((x) => x.authorLabel === name)).toBe(true);
      for (const x of named) {
        const live = x.tombstone === null && x.authorPersonId === r.a;
        expect(x.authorLabel).toBe(live ? name : null);
      }
    } finally {
      await setName(null);
    }
  });

  it("V-19 maps each allowlisted P0001 code to a ChatCommandError carrying only the code and its HTTP status", async () => {
    const m = (await send(r, r.a, `${SENT}-4`)).id;
    const cases: [() => Promise<unknown>, string, number][] = [
      [() => send(r, outsider, SENT), "CHAT_FORBIDDEN", 403],
      [() => send(r, r.a, ""), "INVALID_BODY", 400],
      [() => send(r, r.a, SENT + "x".repeat(4001)), "CHAT_MESSAGE_TOO_LARGE", 413],
      [() => send(r, r.a, SENT, randomUUID()), "CHAT_REPLY_INVALID", 409],
      [
        () =>
          run(r.t, r.b, (tx) =>
            editChatMessage(tx, { channelId: r.c, messageId: m, body: SENT, expectedEditCount: 0 }),
          ),
        "CHAT_EDIT_WINDOW_CLOSED",
        409,
      ],
      [
        () =>
          run(r.t, r.a, (tx) =>
            editChatMessage(tx, { channelId: r.c, messageId: m, body: SENT, expectedEditCount: 3 }),
          ),
        "CHAT_EDIT_CONFLICT",
        409,
      ],
      [() => hide(r, r.b, m, "spam"), "CHAT_MODERATION_FORBIDDEN", 403],
      [() => hide(r, r.mod, m, "bogus"), "CHAT_REASON_INVALID", 422],
      [
        () =>
          run(r.t, r.a, (tx) =>
            listChatMessages(tx, { channelId: r.c, cursorCreatedAt: "2026-10-19 00:00:00+00" }),
          ),
        "INVALID_BODY",
        400,
      ],
      [
        () => run(r.t, outsider, (tx) => markChatRead(tx, { channelId: r.c, throughMessageId: m })),
        "CHAT_FORBIDDEN",
        403,
      ],
    ];
    for (const [op, code, status] of cases) expectCode(await fail(op()), code, status);
  });

  it("CHAT_RATE_LIMITED 429: the 21st send within 10 s by one person in one channel", async () => {
    const p = await person();
    await join(r.t, p);
    const outcomes: string[] = [];
    for (let i = 0; i < 21; i += 1)
      outcomes.push(
        await fail(send(r, p, `rate-${i}`)).then(
          (e) => `${String(e.code)}:${String(e.status)}`,
          () => "OK",
        ),
      );
    expect(outcomes).toEqual([...Array<string>(20).fill("OK"), "CHAT_RATE_LIMITED:429"]);
  }, 30_000);

  it("V-7 a malformed personId -> CHAT_FORBIDDEN before any query; fn never runs", async () => {
    let ran = false;
    const e = await fail(
      withChatActor(ctx.appDb.db, { tenantId: r.t, personId: "not-a-uuid" }, () => {
        ran = true;
        return Promise.resolve();
      }),
    );
    expectCode(e, "CHAT_FORBIDDEN", 403);
    expect(ran).toBe(false);
  });

  it("DT-36 a unique violation on send leaks no body: a new Error carrying only SQLSTATE 23505", async () => {
    await provoke(
      ["CREATE UNIQUE INDEX chat_service_dt36 ON chat_messages (channel_id, body)"],
      "DROP INDEX chat_service_dt36",
      "23505",
    );
  }, 30_000);

  it("DT-37 a NOT NULL violation on send leaks no body: a new Error carrying only SQLSTATE 23502", async () => {
    await provoke(
      [
        "ALTER TABLE chat_messages ADD COLUMN chat_service_dt37 text NOT NULL DEFAULT 'x'",
        "ALTER TABLE chat_messages ALTER COLUMN chat_service_dt37 DROP DEFAULT",
      ],
      "ALTER TABLE chat_messages DROP COLUMN chat_service_dt37",
      "23502",
    );
  }, 30_000);

  it("DT-39 a suspended tenant's chat is frozen: every write and read -> TENANT_SUSPENDED, 0 writes, 0 NOTIFY; active passes", async () => {
    const s = await club();
    const m = (await send(s, s.a, `${SENT}-dt39`)).id;
    await q(`UPDATE tenants SET status = 'suspended' WHERE id = $1`, [s.t]);
    await flush();
    const [n0, p0] = [await count(s.c), payloads.length];
    const ops: (() => Promise<unknown>)[] = [
      () => send(s, s.a, `${SENT}-dt39-x`),
      () => send(s, s.a, ""), // INVALID_BODY past the gate: TENANT_SUSPENDED proves the gate runs before the definer
      () =>
        run(s.t, s.a, (tx) =>
          editChatMessage(tx, {
            channelId: s.c,
            messageId: m,
            body: `${SENT}-dt39-e`,
            expectedEditCount: 0,
          }),
        ),
      () => run(s.t, s.a, (tx) => deleteChatMessage(tx, { channelId: s.c, messageId: m })),
      () => hide(s, s.mod, m, "spam"),
      () => run(s.t, s.b, (tx) => markChatRead(tx, { channelId: s.c, throughMessageId: m })),
      () => run(s.t, s.b, (tx) => listChatMessages(tx, { channelId: s.c })),
      () => get(s, s.b, m),
    ];
    for (const op of ops) expectCode(await fail(op()), "TENANT_SUSPENDED", 403);
    await flush();
    expect([await count(s.c), payloads.length]).toEqual([n0, p0]);
    await q(`UPDATE tenants SET status = 'active' WHERE id = $1`, [s.t]);
    expect(await get(s, s.b, m)).toMatchObject({
      id: m,
      body: `${SENT}-dt39`,
      editCount: 0,
      tombstone: null,
    });
    const ok = (await send(s, s.a, `${SENT}-dt39-ok`)).id;
    await flush();
    expect(payloads.slice(p0)).toEqual([ok]);
  }, 30_000);

  it("one() fails closed: a chat command that returns no row throws CHAT_DB_ERROR:UNKNOWN, not undefined", async () => {
    const empty = { execute: () => Promise.resolve({ rows: [] }) } as unknown as ChatTx;
    await expect(
      sendChatMessage(empty, { channelId: randomUUID(), clientMsgId: randomUUID(), body: "x" }),
    ).rejects.toThrow(/^CHAT_DB_ERROR:UNKNOWN$/);
  });

  it("DT-26 static: every 0063 pg_notify is pg_catalog.pg_notify('chat_realtime', <v_id|p_message>::text); no RAISE or rate key carries text; chat-service.ts logs no text", () => {
    const sql = readFileSync(
      new URL("../migrations/0063_chat_message_commands.sql", import.meta.url),
      "utf8",
    ).replace(/--.*$/gm, "");
    const notify = /pg_catalog\.pg_notify\('chat_realtime', (v_id|p_message)::text\)/g;
    expect((sql.match(notify) ?? []).length).toBeGreaterThanOrEqual(4);
    expect((sql.match(/pg_notify/g) ?? []).length).toBe((sql.match(notify) ?? []).length);
    // No NOTIFY statement form at all (bare, or built for EXECUTE format): every word NOTIFY left
    // after comment stripping must be the tail of pg_notify. The samples pin the pattern itself.
    const notifyStmt = /(?<![a-z_.])notify\b/i;
    expect("NOTIFY chat_realtime, 'x'").toMatch(notifyStmt);
    expect("EXECUTE format('NOTIFY %I, %L', c, v)").toMatch(notifyStmt);
    expect("PERFORM pg_catalog.pg_notify('chat_realtime', v_id::text)").not.toMatch(notifyStmt);
    expect(sql).not.toMatch(notifyStmt);
    expect(sql).not.toMatch(/pg_notify\([^)]*(body|note)/i);
    for (const raise of sql.match(/\bRAISE\b[^;]*;/g) ?? [])
      expect(raise).not.toMatch(/p_body|p_reason_note|\.body\b/);
    for (const [, key] of sql.matchAll(/rate_limit_check\(([^,]*),/g))
      expect(key).not.toMatch(/body|note/);
    const ts = readFileSync(new URL("./chat-service.ts", import.meta.url), "utf8");
    expect(ts).not.toMatch(/console\.\w+\(\s*[^'"\s)]/); // a console call's first argument is a constant string
    for (const [, tag, tpl] of ts.matchAll(/(\w*)\s*`([^`]*)`/g))
      if (tag !== "sql") expect(tpl).not.toMatch(/\$\{[^}]*(body|note|Body|Note)/);
  });

  it("DT-26 runtime: no sentinel body or note in any console spy, thrown error or NOTIFY payload; payloads are message ids", async () => {
    // self-contained (round 1, area D): its own commit and rejections, then the scan of all the file produced
    await flush();
    const [p0, t0] = [payloads.length, thrown.length];
    const c = await club();
    const ok = (await send(c, c.a, `${SENT}-dt26`)).id;
    await fail(send(c, c.a, `${SENT}-dt26`.padEnd(4001, "x"))); // CHAT_MESSAGE_TOO_LARGE
    await fail(send(c, c.a, `${SENT}-dt26-reply`, randomUUID())); // CHAT_REPLY_INVALID
    await fail(hide(c, c.a, ok, "not-a-reason")); // carries NOTE
    await flush();
    expect(payloads.slice(p0)).toEqual([ok]);
    expect(thrown.length - t0).toBe(3);
    for (const p of payloads) expect(p).toMatch(UUID);
    const seen = `${thrown.map(dump).join("\n")}\n${inspect(
      spies.map((s) => s.mock.calls),
      { depth: 10 },
    )}`;
    expect(seen).not.toContain(SENT);
    expect(seen).not.toContain(NOTE);
  });
});

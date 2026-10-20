/**
 * GET /api/chat/subscribe against the real DB as the app role (lane L15, readiness section 7): the
 * real chatGate, one real LISTEN client on chat_realtime, the NOTIFY of a committed send and the
 * real per-event re-read under each subscriber's tenant and chat membership. The harness copies
 * chat-routes-db.test.ts and realtime-listener-db.test.ts; it imports nothing from a test file.
 */
import { randomUUID } from "node:crypto";
import { inspect } from "node:util";
import { createWebSession, revokeWebSession, sendChatMessage, withChatActor } from "@plexco/db";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  seedPersonAccount,
  setupRlsTestContext,
  type RlsTestContext,
} from "../../../packages/db/src/test-harness.js";
import { POST as moderate } from "../app/api/chat/channels/[id]/messages/[messageId]/moderation/route";
import {
  DELETE as deleteMessage,
  PATCH as patchMessage,
} from "../app/api/chat/channels/[id]/messages/[messageId]/route";
import { GET as history, POST as postMessage } from "../app/api/chat/channels/[id]/messages/route";
import { POST as postRead } from "../app/api/chat/channels/[id]/read/route";
import { GET as listChannels } from "../app/api/chat/channels/route";
import { GET as subscribe } from "../app/api/chat/subscribe/route";
import { CHAT_SUBSCRIBE_LIMIT, chatForbidden } from "./chat-route";
import { log } from "./log";
import {
  chatRealtimeListener,
  HEARTBEAT_MS,
  MAX_STREAMS_PER_ACCOUNT,
  openRealtimeStream,
  realtimeListener,
} from "./realtime-listener";
import { appDb, hashToken, rateLimited, resetDbRoleViolationForTests } from "./session-cookies";

const cookieJar = vi.hoisted(() => ({ token: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (cookieJar.token ? { value: cookieJar.token } : undefined),
  }),
}));

let ctx: RlsTestContext;
let runtime: ReturnType<typeof appDb> | undefined;
type Club = { t: string; c: string };
type Actor = { accountId: string; personId: string; membershipId: string; token: string };
type Body = { error: { code: string } | null; meta?: { requestId?: unknown } };
type Reader = ReadableStreamDefaultReader<Uint8Array>;
const readers: Reader[] = [];

beforeAll(async () => {
  ctx = await setupRlsTestContext(`plexco_chat_stream_db_${process.pid}`);
  const url = ctx.appPool.options.connectionString;
  if (typeof url !== "string") throw new Error("Missing isolated app connection string");
  vi.stubEnv("DATABASE_URL", url);
  vi.stubEnv("DB_EXPECTED_ROLE", "app");
  resetDbRoleViolationForTests();
  runtime = appDb();
}, 120_000);

// Every case ends with its readers cancelled and the chat listener fully released.
afterEach(async () => {
  await Promise.all(readers.splice(0).map((r) => r.cancel()));
  expect(chatRealtimeListener().stats()).toEqual({
    subscribers: 0,
    accounts: 0,
    listening: false,
    pending: 0,
  });
});

afterAll(async () => {
  try {
    await runtime?.close();
  } finally {
    resetDbRoleViolationForTests();
    try {
      await ctx?.teardown();
    } finally {
      vi.unstubAllEnvs();
    }
  }
}, 120_000);

/** A subscribed club tenant and its default channel, made before any member (0063 trigger). */
async function club(): Promise<Club> {
  const { rows } = await ctx.owner.query<{ id: string }>(
    `INSERT INTO tenants (name, slug, status) VALUES ('chat-stream', $1, 'active') RETURNING id`,
    [`stream-${randomUUID().slice(0, 8)}`],
  );
  const t = rows[0]!.id;
  await ctx.owner.query(
    `INSERT INTO subscriptions (tenant_id, plan_key, plan_version, status, period_start, period_end)
     VALUES ($1, 'free', 1, 'active', now(), now() + interval '30 days')`,
    [t],
  );
  const ch = await ctx.owner.query<{ id: string }>(
    `INSERT INTO chat_channels (tenant_id, kind, title, is_default, sort_order, creation_origin,
       post_policy, assistant_enabled)
     VALUES ($1, 'club', 'general', true, 0, 'system_bootstrap', 'all_members', false) RETURNING id`,
    [t],
  );
  return { t, c: ch.rows[0]!.id };
}

/** A second club channel made after `members` joined, so they are its only chat members. */
async function secondChannel(t: string, members: Actor[]): Promise<string> {
  const ch = await ctx.owner.query<{ id: string }>(
    `INSERT INTO chat_channels (tenant_id, kind, title, is_default, sort_order, creation_origin,
       post_policy, assistant_enabled)
     VALUES ($1, 'club', 'second', false, 1, 'system_bootstrap', 'all_members', false) RETURNING id`,
    [t],
  );
  const c = ch.rows[0]!.id;
  for (const m of members) {
    await ctx.owner.query(
      `INSERT INTO chat_members (channel_id, tenant_id, person_id, membership_id)
       VALUES ($1, $2, $3, $4)`,
      [c, t, m.personId, m.membershipId],
    );
  }
  return c;
}

/** A signed-in person with a real web session (the real recheck resolves it); no membership. */
async function signedIn(): Promise<Actor> {
  const p = await seedPersonAccount(ctx.owner, randomUUID());
  const token = randomUUID();
  await createWebSession(runtime!.pool, {
    accountId: p.accountId,
    tokenHash: hashToken(token),
    csrfSecret: randomUUID(),
    ttlSeconds: 3600,
  });
  return { ...p, membershipId: "", token };
}

/** A member of `t`; the 0063 trigger makes an active one a member of every club channel. */
async function actor(t: string, status: "active" | "guest" = "active"): Promise<Actor> {
  const a = await signedIn();
  const { rows } = await ctx.owner.query<{ id: string }>(
    `INSERT INTO memberships (tenant_id, person_id, status) VALUES ($1, $2, $3) RETURNING id`,
    [t, a.personId, status],
  );
  return { ...a, membershipId: rows[0]!.id };
}

/** A committed send as `a`; its NOTIFY (the message id only) fires on commit. */
async function send(t: string, channelId: string, a: Actor, body: string): Promise<string> {
  const sent = await withChatActor(runtime!.db, { tenantId: t, personId: a.personId }, (tx) =>
    sendChatMessage(tx, { channelId, clientMsgId: randomUUID(), body }),
  );
  return sent.id;
}

// D2 S-3: a 10 s budget for every positive wait; a pass costs nothing (the race resolves on the read).
// D2 S-1: one pending read per reader; a timed-out read is reused by the next call, never orphaned.
const inFlight = new WeakMap<Reader, ReturnType<Reader["read"]>>();
const next = async (reader: Reader, ms = 10_000) => {
  const read = inFlight.get(reader) ?? reader.read();
  inFlight.set(reader, read);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), ms);
  });
  const got = await Promise.race([read, timeout]).finally(() => clearTimeout(timer));
  if (got === "timeout") return got;
  inFlight.delete(reader);
  return got.done ? "done" : new TextDecoder().decode(got.value);
};

const get = (a: Actor | null, tenant: string) => {
  cookieJar.token = a?.token;
  return subscribe(new Request(`https://plexco.app/api/chat/subscribe?tenant=${tenant}`));
};

/** A refused GET: an enveloped error that is no-store like every chat response (N1). */
async function refused(a: Actor | null, tenant: string) {
  const res = await get(a, tenant);
  if (res.status === 200) await res.body?.cancel(); // never leave a wrongly admitted stream open
  expect(res.headers.get("cache-control")).toBe("no-store");
  const body = (await res.json()) as Body;
  return { status: res.status, code: body.error?.code, body };
}

/** An admitted GET: 200 with exactly L5's three SSE headers (N1), read up to the first ": hb". */
async function stream(a: Actor, tenant: string): Promise<Reader> {
  const res = await get(a, tenant);
  expect(res.status).toBe(200);
  expect(Object.fromEntries(res.headers.entries())).toEqual({
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store, no-transform",
    "x-accel-buffering": "no",
  });
  const reader = res.body!.getReader();
  readers.push(reader);
  expect(await next(reader)).toBe(": hb\n\n"); // the LISTEN is active
  return reader;
}

/** The envelope as text minus meta.requestId: "the one CHAT_FORBIDDEN body" is byte-equal. */
function canon(body: Body): string {
  delete body.meta?.requestId;
  return JSON.stringify(body);
}

describe("GET /api/chat/subscribe (live stream)", () => {
  it("T1 no session -> 401 AUTH_REQUIRED", async () => {
    const c = await club();
    expect(await refused(null, c.t)).toMatchObject({ status: 401, code: "AUTH_REQUIRED" });
  });

  it("T22 a non-uuid ?tenant= -> 400 INVALID_BODY, never a 500", async () => {
    const c = await club();
    const a = await actor(c.t);
    expect(await refused(a, "not-a-uuid")).toMatchObject({ status: 400, code: "INVALID_BODY" });
  });

  it("R1 (i)/(ii) a non-member, a cross-tenant ?tenant= and a guest with no readable club channel (D-23) -> the one CHAT_FORBIDDEN body", async () => {
    const [a, b] = [await club(), await club()];
    const one = canon((await chatForbidden().json()) as Body);
    for (const who of [await signedIn(), await actor(b.t), await actor(a.t, "guest")]) {
      const r = await refused(who, a.t);
      expect(r).toMatchObject({ status: 403, code: "CHAT_FORBIDDEN" });
      expect(canon(r.body)).toBe(one);
    }
  });

  it("D-5 the per-account subscribe bucket -> 429 CHAT_RATE_LIMITED (pre-filled, no stream opened)", async () => {
    const c = await club();
    const a = await actor(c.t);
    const { bucket, limit, windowSeconds } = CHAT_SUBSCRIBE_LIMIT;
    for (let i = 0; i < limit; i += 1) {
      await rateLimited(`${bucket}:${a.accountId}`, limit, windowSeconds);
    }
    expect(await refused(a, c.t)).toMatchObject({ status: 429, code: "CHAT_RATE_LIMITED" });
  });

  it("N1 an admitted member gets 200, exactly the three SSE headers and a first heartbeat", async () => {
    const c = await club();
    await stream(await actor(c.t), c.t);
  }, 30_000);

  it("S1 DONE WHEN: A's committed send reaches channel member B as ONE id-only frame, B's GET history has the body, C gets nothing", async () => {
    const c = await club();
    const [a, b, other] = [await actor(c.t), await actor(c.t), await actor(c.t)];
    const ch = await secondChannel(c.t, [a, b]); // `other` is a chat member of c.c only
    const [readerB, readerC] = [await stream(b, c.t), await stream(other, c.t)];
    const text = `s1 body ${randomUUID()}`;
    const messageId = await send(c.t, ch, a, text);

    const frame = await next(readerB);
    expect(frame).toMatch(/^data: \{.*\}\n\n$/);
    expect(frame).not.toContain(text);
    const pushed = JSON.parse(String(frame).slice(6)) as Record<string, unknown>;
    const keys = Object.keys(pushed).sort();
    expect(keys).toEqual(["channelId", "messageId", "type"]);
    expect(pushed).toMatchObject({ channelId: ch, messageId, type: expect.any(String) });
    const [againB, toC] = await Promise.all([next(readerB, 600), next(readerC, 600)]);
    expect(againB).toBe("timeout");
    expect(toC).toBe("timeout");

    cookieJar.token = b.token;
    const url = `https://plexco.app/api/chat/channels/${ch}/messages?tenant=${c.t}`;
    const res = await history(new Request(url), { params: Promise.resolve({ id: ch }) });
    expect(res.status).toBe(200);
    const historyHasBody = JSON.stringify(await res.json()).includes(text);
    expect(historyHasBody).toBe(true);
    console.log("S1 outcome", JSON.stringify({ keys, againB, historyHasBody, toC }));
  }, 30_000);

  it("S2 cross-tenant leak: tenant A's message never reaches a tenant B member; B's subscribe?tenant=A is the one CHAT_FORBIDDEN", async () => {
    const [ta, tb] = [await club(), await club()];
    const [sender, watcher, memberB] = [await actor(ta.t), await actor(ta.t), await actor(tb.t)];
    const [readerA, readerB] = [await stream(watcher, ta.t), await stream(memberB, tb.t)];
    await send(ta.t, ta.c, sender, `s2 body ${randomUUID()}`);

    expect(await next(readerA)).toMatch(/^data: \{.*\}\n\n$/); // control: tenant A got it
    const toB = await next(readerB, 600);
    expect(toB).toBe("timeout");
    const cross = await refused(memberB, ta.t);
    expect(cross).toMatchObject({ status: 403, code: "CHAT_FORBIDDEN" });
    expect(canon(cross.body)).toBe(canon((await chatForbidden().json()) as Body));
    const outcome = { toA: "frame", toB, cross: [cross.status, cross.code] };
    console.log("S2 outcome", JSON.stringify(outcome));
  }, 30_000);

  // S3-S6 (readiness section 7): revocation, per-event drops, heartbeat and the stream cap.
  const notify = (payload: string) =>
    ctx.workerPool.query("SELECT pg_notify('chat_realtime', $1)", [payload]);
  /** The message id of the next frame, else what next() gave instead ("timeout" | "done"). */
  const pushedId = async (reader: Reader) => {
    const frame = String(await next(reader));
    if (!frame.startsWith("data: ")) return frame;
    return (JSON.parse(frame.slice(6)) as { messageId?: unknown }).messageId;
  };

  it("S3 revoke mid-stream: no frame after B's membership ends; the next recheck closes the stream", async () => {
    const c = await club();
    const [a, b] = [await actor(c.t), await actor(c.t)];
    vi.useFakeTimers({ toFake: ["setInterval"] }); // only the heartbeat; pg and next() stay real
    try {
      // A (the sender, still a member) is the witness: the same event plans A's and B's frames.
      const [readerB, readerA] = [await stream(b, c.t), await stream(a, c.t)];
      const before = await send(c.t, c.c, a, `s3 before ${randomUUID()}`);
      expect(await pushedId(readerB)).toBe(before); // control: B reads while a member
      expect(await pushedId(readerA)).toBe(before);
      await ctx.owner.query(
        `UPDATE memberships SET status = 'left' WHERE tenant_id = $1 AND person_id = $2`,
        [c.t, b.personId],
      );
      const after = await send(c.t, c.c, a, `s3 after ${randomUUID()}`);
      expect(await pushedId(readerA)).toBe(after); // the event was planned and sent
      // a planned B frame would already be queued (one synchronous send loop, realtime-listener.ts:119)
      expect(await next(readerB, 600)).toBe("timeout"); // the per-event read fails: dropped
      vi.advanceTimersByTime(HEARTBEAT_MS);
      expect(await next(readerB)).toBe("done");
    } finally {
      vi.useRealTimers();
    }
  }, 30_000);

  it("S4 per-event drop: a forged uuid, a non-uuid payload, a non-member channel's message and a read error give B no frame; the stream stays open", async () => {
    const c = await club();
    const [a, b] = [await actor(c.t), await actor(c.t)];
    const hidden = await secondChannel(c.t, [a]); // B is not a chat member of it
    const c2 = await club(); // the witness's club: c's suspension does not block its sends
    const w = await actor(c2.t);
    vi.useFakeTimers({ toFake: ["setInterval"] }); // only the heartbeat; pg and next() stay real
    try {
      const [readerB, readerW] = [await stream(b, c.t), await stream(w, c2.t)];
      /** Nothing reached B from the last stimulus: the FIFO drain plans it before this send. */
      const nextIsLegit = async () => {
        const id = await send(c.t, c.c, a, `s4 legit ${randomUUID()}`);
        expect(await pushedId(readerB)).toBe(id);
        return id;
      };
      const tenantStatus = (status: "active" | "suspended") =>
        ctx.owner.query(`UPDATE tenants SET status = $2 WHERE id = $1`, [c.t, status]);

      await notify(randomUUID()); // forged: no such message
      await nextIsLegit();
      await notify("not-a-uuid"); // dropped before any read
      await nextIsLegit();
      await send(c.t, hidden, a, `s4 hidden ${randomUUID()}`); // B cannot read it
      const readable = await nextIsLegit();
      await tenantStatus("suspended"); // B's per-event read now throws TENANT_SUSPENDED
      await notify(readable);
      const bar = await send(c2.t, c2.c, w, `s4 barrier ${randomUUID()}`); // FIFO drain: planned after `readable`
      expect(await pushedId(readerW)).toBe(bar);
      await tenantStatus("active");
      await notify(readable); // readable again: delivered, so the drop was the read error
      expect(await pushedId(readerB)).toBe(readable);
      await nextIsLegit();
      expect(await next(readerB, 600)).toBe("timeout");
    } finally {
      vi.useRealTimers();
    }
  }, 30_000);

  it("S5 heartbeat: exactly one ': hb' per HEARTBEAT_MS (<= 30 s); after B's web session is revoked the next recheck closes the stream", async () => {
    expect(HEARTBEAT_MS).toBeLessThanOrEqual(30_000);
    const c = await club();
    const b = await actor(c.t);
    vi.useFakeTimers({ toFake: ["setInterval"] }); // only the heartbeat; pg and next() stay real
    try {
      const readerB = await stream(b, c.t);
      vi.advanceTimersByTime(HEARTBEAT_MS);
      expect(await next(readerB)).toBe(": hb\n\n");
      expect(await next(readerB, 600)).toBe("timeout"); // exactly one per interval
      expect(await revokeWebSession(runtime!.pool, hashToken(b.token))).toBe(true);
      vi.advanceTimersByTime(HEARTBEAT_MS);
      expect(await next(readerB)).toBe("done");
    } finally {
      vi.useRealTimers();
    }
  }, 30_000);

  it("S6 stream cap: one account holds 5 L5 and 5 chat streams; the 6th chat GET -> 429 CHAT_RATE_LIMITED and L5's listener is unchanged", async () => {
    const c = await club();
    const a = await actor(c.t);
    // The per-account subscribe bucket admits a 6th GET, so the stream cap is what refuses it.
    expect(CHAT_SUBSCRIBE_LIMIT.limit).toBeGreaterThan(MAX_STREAMS_PER_ACCOUNT);
    const audience = {
      tenantId: c.t,
      accountId: a.accountId,
      personId: a.personId,
      tokenHash: hashToken(a.token),
    };
    const allow = { recheck: async () => true };
    for (let i = 0; i < MAX_STREAMS_PER_ACCOUNT; i += 1) {
      const reader = openRealtimeStream(realtimeListener(), audience, allow)!.getReader();
      readers.push(reader);
      expect(await next(reader)).toBe(": hb\n\n");
    }
    const l5 = realtimeListener().stats();
    expect(l5).toMatchObject({ subscribers: MAX_STREAMS_PER_ACCOUNT, accounts: 1 });
    for (let i = 0; i < MAX_STREAMS_PER_ACCOUNT; i += 1) await stream(a, c.t);
    expect(chatRealtimeListener().stats()).toMatchObject({
      subscribers: MAX_STREAMS_PER_ACCOUNT,
      accounts: 1,
    });
    expect(await refused(a, c.t)).toMatchObject({ status: 429, code: "CHAT_RATE_LIMITED" });
    expect(realtimeListener().stats()).toEqual(l5);
    await Promise.all(readers.splice(0).map((r) => r.cancel()));
    expect(realtimeListener().stats()).toEqual({
      subscribers: 0,
      accounts: 0,
      listening: false,
      pending: 0,
    });
  }, 30_000);
});

// G1/G2 sweep (readiness section 7): one sentinel body through every chat handler, success and
// error path; G1 = the text only in a history 200 body, G2 = no person uuid on any wire.
type Member = Actor & { csrf: string };
type Spy = { mock: { calls: unknown[][] }; mockRestore: () => void };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** actor() with its CSRF secret kept: the five mutations send x-csrf-token. */
async function member(t: string): Promise<Member> {
  const p = await seedPersonAccount(ctx.owner, randomUUID());
  const { rows } = await ctx.owner.query<{ id: string }>(
    `INSERT INTO memberships (tenant_id, person_id, status) VALUES ($1, $2, 'active') RETURNING id`,
    [t, p.personId],
  );
  const token = randomUUID();
  const csrf = randomUUID();
  await createWebSession(runtime!.pool, {
    accountId: p.accountId,
    tokenHash: hashToken(token),
    csrfSecret: csrf,
    ttlSeconds: 3600,
  });
  return { ...p, membershipId: rows[0]!.id, token, csrf };
}

describe("G1/G2 sweep", () => {
  it("G1 message text only in a history 200 body; G2 no person uuid or authorPersonId anywhere", async () => {
    const S = `sweep${randomUUID().replace(/-/g, "")}`;
    const c = await club();
    const author = await member(c.t);
    const reader = await member(c.t);
    const mod = await member(c.t);
    await ctx.owner.query(
      `INSERT INTO tenant_admins (tenant_id, platform, platform_user_lookup_hash, role, active)
       VALUES ($1, 'web', $2, 'owner', true)`,
      [c.t, mod.personId],
    );
    const req = (
      a: Member | null,
      path: string,
      method = "GET",
      payload?: unknown,
      csrf = a?.csrf,
    ) => {
      cookieJar.token = a?.token;
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (csrf) headers["x-csrf-token"] = csrf;
      const url = `https://plexco.app/api/chat/${path}${path.includes("?") ? "&" : "?"}tenant=${c.t}`;
      const body = payload === undefined ? undefined : JSON.stringify(payload);
      return new Request(url, { method, headers, body });
    };
    const ch = (id = c.c) => ({ params: Promise.resolve({ id }) });
    const at = (messageId: string) => ({ params: Promise.resolve({ id: c.c, messageId }) });
    const hide = (extra: Record<string, unknown> = {}) => ({
      action: "hide",
      reasonCode: "spam",
      commandId: randomUUID(),
      ...extra,
    });
    const msgs = `channels/${c.c}/messages`;
    const listen = await ctx.workerPool.connect();
    const payloads: string[] = [];
    const spies: Spy[] = [];
    try {
      listen.on("notification", (n) => payloads.push(n.payload ?? ""));
      await listen.query("LISTEN chat_realtime");
      for (const m of ["log", "info", "warn", "error"] as const) spies.push(vi.spyOn(console, m));
      const sinks = log as unknown as Record<string, () => unknown>;
      for (const k of Object.keys(sinks)) {
        if (typeof sinks[k] === "function") spies.push(vi.spyOn(sinks, k));
      }
      const r = await stream(reader, c.t); // the SSE 200, headers asserted in stream() (N1)
      const m1 = await send(c.t, c.c, author, S);
      const m2 = await send(c.t, c.c, author, S);
      const m3 = await send(c.t, c.c, author, S);
      const sendS = (extra: Record<string, unknown> = {}) => ({
        clientMsgId: randomUUID(),
        body: S,
        ...extra,
      });
      const table: [string, number, () => Promise<Response> | Response][] = [
        ["send 200", 200, () => postMessage(req(author, msgs, "POST", sendS()), ch())],
        [
          "send 413 oversized",
          413,
          () => postMessage(req(author, msgs, "POST", sendS({ body: S + "x".repeat(4001) })), ch()),
        ],
        [
          "send 409 reply target",
          409,
          () =>
            postMessage(req(author, msgs, "POST", sendS({ replyToMessageId: randomUUID() })), ch()),
        ],
        [
          "send 400 channel id",
          400,
          () =>
            postMessage(
              req(author, "channels/not-a-uuid/messages", "POST", sendS()),
              ch("not-a-uuid"),
            ),
        ],
        [
          "send 403 csrf",
          403,
          () => postMessage(req(author, msgs, "POST", sendS(), "wrong"), ch()),
        ],
        ["history 200", 200, () => history(req(reader, msgs), ch())],
        ["history 400 cursor", 400, () => history(req(reader, `${msgs}?cursor=${S}`), ch())],
        [
          "edit 200",
          200,
          () =>
            patchMessage(
              req(author, `${msgs}/${m1}`, "PATCH", { body: `${S}edited`, expectedEditCount: 0 }),
              at(m1),
            ),
        ],
        [
          // a non-author PATCH ends in L14's edit outcome, 409 (measured), unlike DELETE's 403
          "edit 409 not author",
          409,
          () =>
            patchMessage(
              req(reader, `${msgs}/${m1}`, "PATCH", { body: S, expectedEditCount: 1 }),
              at(m1),
            ),
        ],
        [
          "edit 403 csrf",
          403,
          () =>
            patchMessage(
              req(author, `${msgs}/${m1}`, "PATCH", { body: S, expectedEditCount: 1 }, "wrong"),
              at(m1),
            ),
        ],
        [
          "delete 403 not author",
          403,
          () => deleteMessage(req(reader, `${msgs}/${m1}`, "DELETE"), at(m1)),
        ],
        ["delete 200", 200, () => deleteMessage(req(author, `${msgs}/${m1}`, "DELETE"), at(m1))],
        [
          "hide 403 no capability",
          403,
          () => moderate(req(reader, `${msgs}/${m2}/moderation`, "POST", hide()), at(m2)),
        ],
        [
          "hide 422 reason",
          422,
          () =>
            moderate(req(mod, `${msgs}/${m2}/moderation`, "POST", hide({ reasonCode: S })), at(m2)),
        ],
        [
          "hide 200",
          200,
          () => moderate(req(mod, `${msgs}/${m2}/moderation`, "POST", hide()), at(m2)),
        ],
        [
          "read 200",
          200,
          () =>
            postRead(req(reader, `channels/${c.c}/read`, "POST", { throughMessageId: m3 }), ch()),
        ],
        [
          "read 400 message id",
          400,
          () =>
            postRead(req(reader, `channels/${c.c}/read`, "POST", { throughMessageId: S }), ch()),
        ],
        ["channels 200", 200, () => listChannels(req(reader, "channels"))],
        ["channels 401", 401, () => listChannels(req(null, "channels"))],
        ["subscribe 401", 401, () => get(null, c.t)],
      ];
      const seen: { where: string; status: number; cache: string | null; text: string }[] = [];
      for (const [where, , run] of table) {
        const res = await run();
        const sse = res.headers.get("content-type")?.startsWith("text/event-stream");
        const text = sse ? (await res.body?.cancel(), "<stream>") : await res.text(); // never hang
        seen.push({ where, status: res.status, cache: res.headers.get("cache-control"), text });
      }
      // Drain up to a barrier sent after the last request, keeping every frame read on the way:
      // the listener plans events one at a time in commit order (realtime-listener.ts drain), so
      // the barrier's frame follows every earlier event's frame and no fixed idle ends the drain.
      const bar = await send(c.t, c.c, author, "barrier");
      const frames: string[] = [];
      while (!frames.some((f) => f.includes(bar))) {
        const got = await next(r); // a frame, else "timeout" (10 s budget) or "done"
        expect(["timeout", "done"], "the drain reaches the barrier frame").not.toContain(got);
        frames.push(got);
      }
      const opts = { depth: 8, maxStringLength: null, maxArrayLength: null, breakLength: Infinity };
      const logged = spies.flatMap((s) => s.mock.calls.map((args) => inspect(args, opts)));
      const texts: [string, string][] = [
        ...seen.map((s): [string, string] => [s.where, s.text]),
        ...frames.map((f, i): [string, string] => [`frame ${i}`, f]),
      ];
      expect(Object.fromEntries(seen.map((s) => [s.where, s.status]))).toEqual(
        Object.fromEntries(table.map(([where, status]) => [where, status])),
      );
      expect(seen.filter((s) => !s.cache?.includes("no-store")).map((s) => s.where)).toEqual([]);
      // G1, with positive controls so the sweep cannot pass vacuously.
      expect(seen.find((s) => s.where === "history 200")?.text).toContain(S);
      expect(frames.some((f) => f.includes(m1))).toBe(true);
      expect(payloads.length).toBeGreaterThanOrEqual(3);
      expect(
        texts.filter(([w, t]) => w !== "history 200" && t.includes(S)).map(([w]) => w),
      ).toEqual([]);
      // D2 S-4: every NOTIFY payload is exactly one of the message ids this sweep created.
      const sendText = seen.find((s) => s.where === "send 200")?.text ?? "{}";
      const sent = (JSON.parse(sendText) as { data?: { id?: string } }).data?.id;
      expect(sent, sendText).toMatch(UUID);
      const created = [m1, m2, m3, sent, bar];
      expect(payloads.filter((p) => !created.includes(p))).toEqual([]);
      expect(logged.filter((l) => l.includes(S))).toEqual([]);
      // G2 (RO-L15-3 g): no seeded person uuid and no authorPersonId in any body, error or frame.
      const ids = [author, reader, mod].map((a) => a.personId.toLowerCase());
      const named = texts.filter(
        ([, t]) => t.includes("authorPersonId") || ids.some((id) => t.toLowerCase().includes(id)),
      );
      expect(named.map(([w]) => w)).toEqual([]);
    } finally {
      for (const s of spies) s.mockRestore();
      listen.release(true);
    }
  }, 60_000);
});

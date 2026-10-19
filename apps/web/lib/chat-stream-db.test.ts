/**
 * GET /api/chat/subscribe against the real DB as the app role (lane L15, readiness section 7): the
 * real chatGate, one real LISTEN client on chat_realtime, the NOTIFY of a committed send and the
 * real per-event re-read under each subscriber's tenant and chat membership. The harness copies
 * chat-routes-db.test.ts and realtime-listener-db.test.ts; it imports nothing from a test file.
 */
import { randomUUID } from "node:crypto";
import { createWebSession, sendChatMessage, withChatActor } from "@plexco/db";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  seedPersonAccount,
  setupRlsTestContext,
  type RlsTestContext,
} from "../../../packages/db/src/test-harness.js";
import { GET as history } from "../app/api/chat/channels/[id]/messages/route";
import { GET as subscribe } from "../app/api/chat/subscribe/route";
import { CHAT_SUBSCRIBE_LIMIT, chatForbidden } from "./chat-route";
import { chatRealtimeListener } from "./realtime-listener";
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

const next = async (reader: Reader, ms = 2_000) => {
  const timeout = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), ms));
  const read = reader
    .read()
    .then(({ done, value }) => (done ? "done" : new TextDecoder().decode(value)));
  return Promise.race([read, timeout]);
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
  });

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
  });

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
  });
});

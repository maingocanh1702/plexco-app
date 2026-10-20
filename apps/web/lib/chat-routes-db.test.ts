/**
 * M10 chat REST routes against the real DB as the app role (readiness section 7). One describe per
 * route file; later route writers add their cases and reuse the helpers below.
 */
import { randomUUID } from "node:crypto";
import {
  authorize,
  createWebSession,
  deleteChatMessage,
  editChatMessage,
  moderateChatMessage,
  rateLimitCheck,
  sendChatMessage,
  withChatActor,
  type ChatTx,
} from "@plexco/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
import { decodeChatCursor, encodeChatCursor } from "./chat-route";
import { actorThrottled } from "./session-command-route";
import { appDb, hashToken, resetDbRoleViolationForTests } from "./session-cookies";

const cookieJar = vi.hoisted(() => ({ token: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (cookieJar.token ? { value: cookieJar.token } : undefined),
  }),
}));
// D8 seam: authorize stays the real primitive (the web vitest config sets no mockReset, clearMocks
// or restoreMocks); only R1d (stubs) and R7 (a rejection) arm it, each resetting it in finally.
vi.mock("@plexco/db", async (importOriginal) => {
  const m = await importOriginal<typeof import("@plexco/db")>();
  return { ...m, authorize: vi.fn(m.authorize) };
});

let ctx: RlsTestContext;
let runtime: ReturnType<typeof appDb> | undefined;
type Club = { t: string; c: string };
type Actor = {
  accountId: string;
  personId: string;
  membershipId: string;
  token: string;
  csrf: string;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the wire shape is asserted per case
type Envelope = { data: any; error: { code: string; message: string } | null };

beforeAll(async () => {
  ctx = await setupRlsTestContext(`plexco_chat_routes_${process.pid}`);
  const url = ctx.appPool.options.connectionString;
  if (typeof url !== "string") throw new Error("Missing isolated app connection string");
  vi.stubEnv("DATABASE_URL", url);
  vi.stubEnv("DB_EXPECTED_ROLE", "app");
  resetDbRoleViolationForTests();
  runtime = appDb();
  const { rows } = await runtime.pool.query(
    `SELECT current_user, session_user, rolsuper, rolbypassrls,
            nullif(current_setting('app.tenant_id', true), '') AS tenant
     FROM pg_roles WHERE rolname = current_user`,
  );
  expect(rows).toEqual([
    {
      current_user: "app",
      session_user: "app",
      rolsuper: false,
      rolbypassrls: false,
      tenant: null,
    },
  ]);
}, 120_000);

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

/** A club tenant and its default channel, made before any member so the 0063 membership trigger
 *  (ON CONFLICT DO NOTHING) provisions every member into it; unsubscribed => TENANT_SUSPENDED. */
async function club(subscribed = true): Promise<Club> {
  const { rows } = await ctx.owner.query<{ id: string }>(
    `INSERT INTO tenants (name, slug, status) VALUES ('chat-routes', $1, 'active') RETURNING id`,
    [`routes-${randomUUID().slice(0, 8)}`],
  );
  const t = rows[0]!.id;
  if (subscribed) {
    await ctx.owner.query(
      `INSERT INTO subscriptions (tenant_id, plan_key, plan_version, status, period_start, period_end)
       VALUES ($1, 'free', 1, 'active', now(), now() + interval '30 days')`,
      [t],
    );
  }
  const ch = await ctx.owner.query<{ id: string }>(
    `INSERT INTO chat_channels (tenant_id, kind, title, is_default, sort_order, creation_origin,
       post_policy, assistant_enabled)
     VALUES ($1, 'club', 'general', true, 0, 'system_bootstrap', 'all_members', false) RETURNING id`,
    [t],
  );
  return { t, c: ch.rows[0]!.id };
}

/** A signed-in person with a membership (the trigger makes an active one a chat member). */
async function actor(t: string, status: "active" | "guest" = "active"): Promise<Actor> {
  const p = await seedPersonAccount(ctx.owner, randomUUID());
  const { rows } = await ctx.owner.query<{ id: string }>(
    `INSERT INTO memberships (tenant_id, person_id, status) VALUES ($1, $2, $3) RETURNING id`,
    [t, p.personId, status],
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

/** Owner-seeded rows at exact timestamptz texts (K2 microseconds); returns nothing on purpose. */
async function seed(c: Club, a: Actor, at: string[]): Promise<void> {
  await ctx.owner.query(
    `INSERT INTO chat_messages (channel_id, tenant_id, author_person_id, membership_id, body,
                                client_msg_id, created_at)
     SELECT $1, $2, $3, $4, 'seed body', gen_random_uuid()::text, ts FROM unnest($5::timestamptz[]) ts`,
    [c.c, c.t, a.personId, a.membershipId, at],
  );
}

/** The channel's ids in K1 order (created_at, id) descending, read as owner. */
async function order(c: Club): Promise<string[]> {
  const { rows } = await ctx.owner.query<{ id: string }>(
    `SELECT id FROM chat_messages WHERE channel_id = $1 ORDER BY created_at DESC, id DESC`,
    [c.c],
  );
  return rows.map((r) => r.id);
}

const asActor = <T>(c: Club, a: Actor, fn: (tx: ChatTx) => Promise<T>) =>
  withChatActor(runtime!.db, { tenantId: c.t, personId: a.personId }, fn);
const send = (c: Club, a: Actor, body: string) =>
  asActor(c, a, (tx) => sendChatMessage(tx, { channelId: c.c, clientMsgId: randomUUID(), body }));

/** S1: a second club channel of c's tenant (T18's pattern) holding `own`, a live message `a` sent
 *  as a member before leaving its chat_members; `b` stays in. `a` is still an active tenant member,
 *  so only L14's chat_members check can deny them (a guest also fails its status half). */
async function outsideChannel(c: Club, a: Actor, b: Actor): Promise<{ c2: Club; own: string }> {
  const ch = await ctx.owner.query<{ id: string }>(
    `INSERT INTO chat_channels (tenant_id, kind, title, is_default, sort_order, creation_origin,
       post_policy, assistant_enabled)
     VALUES ($1, 'club', 'second', false, 1, 'system_bootstrap', 'all_members', false) RETURNING id`,
    [c.t],
  );
  const c2: Club = { t: c.t, c: ch.rows[0]!.id };
  await ctx.owner.query(
    `INSERT INTO chat_members (channel_id, tenant_id, person_id, membership_id)
     VALUES ($1, $2, $3, $4), ($1, $2, $5, $6)`,
    [c2.c, c.t, a.personId, a.membershipId, b.personId, b.membershipId],
  );
  const own = (await send(c2, a, "outside text")).id;
  await ctx.owner.query(`DELETE FROM chat_members WHERE channel_id = $1 AND person_id = $2`, [
    c2.c,
    a.personId,
  ]);
  return { c2, own };
}

/** S6: a DM between x and y (one transaction for the deferred trg_chat_dm_two_* triggers) and one
 *  owner-seeded message by x in it (no tenant, no membership: the schema-invariants seed). */
async function dmWith(x: Actor, y: Actor): Promise<{ dmId: string; dmMsg: string }> {
  await ctx.owner.query("BEGIN");
  const dm = await ctx.owner.query<{ id: string }>(
    `INSERT INTO chat_channels (kind, dm_key) VALUES ('dm', $1) RETURNING id`,
    [[x.personId, y.personId].sort().join(":")],
  );
  const dmId = dm.rows[0]!.id;
  await ctx.owner.query(
    `INSERT INTO chat_members (channel_id, person_id) VALUES ($1, $2), ($1, $3)`,
    [dmId, x.personId, y.personId],
  );
  await ctx.owner.query("COMMIT");
  const { rows } = await ctx.owner.query<{ id: string }>(
    `INSERT INTO chat_messages (channel_id, author_person_id, body, client_msg_id)
     VALUES ($1, $2, 'dm text', gen_random_uuid()::text) RETURNING id`,
    [dmId, x.personId],
  );
  return { dmId, dmMsg: rows[0]!.id };
}

/** GET history; every chat response, 2xx or 4xx, must be no-store (N1). */
async function get(a: Actor | null, tenant: string, channel: string, query = "") {
  cookieJar.token = a?.token;
  const url = `https://plexco.app/api/chat/channels/${channel}/messages?tenant=${tenant}${query}`;
  const res = await history(new Request(url), { params: Promise.resolve({ id: channel }) });
  expect(res.headers.get("cache-control")).toBe("no-store");
  const body = (await res.json()) as Envelope;
  return { status: res.status, body, code: body.error?.code };
}
const ts = (n: number, frac = "") => `2026-10-19 10:00:${String(n).padStart(2, "0")}${frac}+00`;

describe("GET /api/chat/channels/:id/messages (history)", () => {
  it("T1 no session -> 401 AUTH_REQUIRED", async () => {
    const c = await club();
    expect(await get(null, c.t, c.c)).toMatchObject({ status: 401, code: "AUTH_REQUIRED" });
  });

  it("T22 a non-uuid tenant or channel id -> 400 INVALID_BODY, never a 500", async () => {
    const c = await club();
    const a = await actor(c.t);
    expect(await get(a, "not-a-uuid", c.c)).toMatchObject({ status: 400, code: "INVALID_BODY" });
    expect(await get(a, c.t, "not-a-uuid")).toMatchObject({ status: 400, code: "INVALID_BODY" });
  });

  it("T2 foreign tenant, guest, unknown, other-tenant and DM channel -> the one 403 body", async () => {
    const [c, other] = [await club(), await club()];
    const [a, b, guest, stranger] = [
      await actor(c.t),
      await actor(c.t),
      await actor(c.t, "guest"),
      await actor(other.t),
    ];
    await ctx.owner.query("BEGIN");
    const dm = await ctx.owner.query<{ id: string }>(
      `INSERT INTO chat_channels (kind, dm_key) VALUES ('dm', $1) RETURNING id`,
      [[a.personId, b.personId].sort().join(":")],
    );
    const dmId = dm.rows[0]!.id;
    await ctx.owner.query(
      `INSERT INTO chat_members (channel_id, person_id) VALUES ($1, $2), ($1, $3)`,
      [dmId, a.personId, b.personId],
    );
    await ctx.owner.query("COMMIT");
    const { c2 } = await outsideChannel(c, a, b);
    const cases = [
      await get(stranger, c.t, c.c),
      await get(guest, c.t, c.c),
      await get(a, c.t, randomUUID()),
      await get(a, c.t, other.c),
      await get(a, c.t, dmId),
      await get(a, c.t, c2.c),
    ];
    const one = (r: (typeof cases)[number]) =>
      JSON.stringify([r.status, r.body.data, r.body.error]);
    expect(cases[0]).toMatchObject({ status: 403, code: "CHAT_FORBIDDEN" });
    for (const r of cases) expect(one(r)).toBe(one(cases[0]!));
  });

  it("TENANT_SUSPENDED for a member of an unsubscribed club; 429 from the D-5 read bucket", async () => {
    const off = await club(false);
    const m = await actor(off.t);
    expect(await get(m, off.t, off.c)).toMatchObject({ status: 403, code: "TENANT_SUSPENDED" });
    const c = await club();
    const a = await actor(c.t);
    for (let i = 0; i < 60; i++) {
      expect(await rateLimitCheck(runtime!.pool, `chat-read:${a.personId}`, 60, 60)).toBe(true);
    }
    expect(await get(a, c.t, c.c)).toMatchObject({ status: 429, code: "CHAT_RATE_LIMITED" });
  });

  it("RO-L15-4 chat-actor (120/60 s) and session-actor are separate budgets, each way", async () => {
    const c = await club();
    const [a, b] = [await actor(c.t), await actor(c.t)];
    for (let i = 0; i < 120; i++) {
      const bucket = `chat-actor:${a.accountId}`;
      expect(await rateLimitCheck(runtime!.pool, bucket, 120, 60)).toBe(true);
    }
    expect(await get(a, c.t, c.c)).toMatchObject({ status: 429, code: "CHAT_RATE_LIMITED" });
    expect(await actorThrottled(a.accountId)).toBe(false);
    for (let i = 0; i < 60; i++) {
      const bucket = `session-actor:${b.accountId}`;
      expect(await rateLimitCheck(runtime!.pool, bucket, 60, 60)).toBe(true);
    }
    expect(await actorThrottled(b.accountId)).toBe(true);
    expect(await get(b, c.t, c.c)).toMatchObject({ status: 200 });
  });

  it("T19 hidden and author-deleted rows are four-key tombstones; live rows carry mine + ISO", async () => {
    const c = await club();
    const [a, b, mod] = [await actor(c.t), await actor(c.t), await actor(c.t)];
    await ctx.owner.query(
      `INSERT INTO tenant_admins (tenant_id, platform, platform_user_lookup_hash, role, active)
       VALUES ($1, 'web', $2, 'owner', true)`,
      [c.t, mod.personId],
    );
    const live = await send(c, a, "kept text");
    const gone = await send(c, a, "deleted text");
    const hidden = await send(c, b, "hidden text");
    // S4: each tombstone has a revision behind it, so a leaked editedAt or editCount would show.
    for (const [who, msg] of [
      [a, gone],
      [b, hidden],
    ] as const) {
      const e = await asActor(c, who, (tx) =>
        editChatMessage(tx, {
          channelId: c.c,
          messageId: msg.id,
          body: "edited text",
          expectedEditCount: 0,
        }),
      );
      expect(e).toMatchObject({ editCount: 1, changed: true });
    }
    await asActor(c, a, (tx) => deleteChatMessage(tx, { channelId: c.c, messageId: gone.id }));
    await asActor(c, mod, (tx) =>
      moderateChatMessage(tx, {
        channelId: c.c,
        messageId: hidden.id,
        commandId: randomUUID(),
        action: "hide",
        reasonCode: "spam",
      }),
    );
    const r = await get(b, c.t, c.c);
    expect(r.status).toBe(200);
    const byId = new Map(r.body.data.messages.map((m: { id: string }) => [m.id, m]));
    for (const [id, kind] of [
      [gone.id, "author_deleted"],
      [hidden.id, "moderation_hidden"],
    ] as const) {
      const m = byId.get(id) as Record<string, unknown>;
      expect(Object.keys(m).sort()).toEqual(["channelId", "createdAt", "id", "tombstone"]);
      expect(m.tombstone).toBe(kind);
    }
    expect(byId.get(live.id)).toMatchObject({ body: "kept text", mine: false, tombstone: null });
    expect(JSON.stringify(r.body)).not.toMatch(
      /deleted text|hidden text|edited text|authorPersonId/,
    );
    const mine = (await get(a, c.t, c.c)).body.data.messages[0];
    expect(mine).toMatchObject({ id: hidden.id }); // newest first
    const first = (await get(a, c.t, c.c, "&limit=3")).body.data.messages[2];
    expect(first).toMatchObject({ id: live.id, mine: true, authorType: "person", editedAt: null });
    expect(new Date(first.createdAt).toISOString()).toBe(first.createdAt);
  });

  it("T19b (L15a) a live row carries its author's club label or null (key present); no person id on the wire", async () => {
    const c = await club();
    const [a, b] = [await actor(c.t), await actor(c.t)];
    const name = "Lan Anh";
    await ctx.owner.query(`UPDATE memberships SET display_name = $1 WHERE id = $2`, [
      name,
      a.membershipId,
    ]);
    const named = await send(c, a, "named text");
    const plain = await send(c, b, "plain text");
    const gone = await send(c, a, "gone text");
    await asActor(c, a, (tx) => deleteChatMessage(tx, { channelId: c.c, messageId: gone.id }));
    const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const ids = new Set(["id", "channelId", "replyToMessageId"]);
    for (const reader of [a, b]) {
      const r = await get(reader, c.t, c.c);
      expect(r.status).toBe(200);
      const items = r.body.data.messages as Record<string, unknown>[];
      expect(items.map((m) => m.id)).toEqual([gone.id, plain.id, named.id]); // newest first
      expect(items[2]).toMatchObject({
        authorLabel: name,
        authorType: "person",
        mine: reader === a,
      });
      expect(items[1]).toHaveProperty("authorLabel", null); // a NULL label keeps its key
      // the tombstone stays four keys: no authorLabel, although its author has a club name
      expect(Object.keys(items[0]!).sort()).toEqual(["channelId", "createdAt", "id", "tombstone"]);
      for (const m of items) {
        expect(m).not.toHaveProperty("authorPersonId");
        const rest = Object.entries(m).filter(([k]) => !ids.has(k));
        expect(JSON.stringify(rest)).not.toMatch(uuid);
      }
      for (const secret of [a.personId, b.personId, a.membershipId, b.membershipId]) {
        expect(JSON.stringify(r.body)).not.toContain(secret);
      }
    }
  });

  it("T20 limit absent -> 50, 1 and 100 accepted; 0, 101, abc, 1.5 -> 400", async () => {
    const c = await club();
    const a = await actor(c.t);
    await seed(
      c,
      a,
      Array.from({ length: 60 }, (_, i) => ts(i)),
    );
    const ids = await order(c);
    const page = await get(a, c.t, c.c);
    expect(page.body.data.messages.map((m: { id: string }) => m.id)).toEqual(ids.slice(0, 50));
    expect(page.body.data.nextCursor).toEqual(expect.any(String));
    expect((await get(a, c.t, c.c, "&limit=1")).body.data.messages).toHaveLength(1);
    const all = await get(a, c.t, c.c, "&limit=100");
    expect(all.body.data).toMatchObject({ nextCursor: null });
    expect(all.body.data.messages).toHaveLength(60);
    for (const bad of ["0", "101", "abc", "1.5"]) {
      expect(await get(a, c.t, c.c, `&limit=${bad}`)).toMatchObject({
        status: 400,
        code: "INVALID_BODY",
      });
    }
  });

  it("T21 a malformed cursor -> 400 before any membership read (a non-member gets 400, not 403)", async () => {
    const [c, other] = [await club(), await club()];
    const stranger = await actor(other.t);
    for (const cursor of [
      "v2.abc",
      "v1.@@@",
      `v1.${"A".repeat(300)}`,
      encodeChatCursor({ createdAt: "not-a-date", id: randomUUID() }),
      encodeChatCursor({ createdAt: ts(1), id: "not-a-uuid" }),
    ]) {
      const r = await get(stranger, c.t, c.c, `&cursor=${encodeURIComponent(cursor)}`);
      expect(r).toMatchObject({ status: 400, code: "INVALID_BODY" });
    }
  });

  it("K2 rows 1 microsecond apart and equal created_at: none skipped or repeated", async () => {
    const c = await club();
    const a = await actor(c.t);
    await seed(c, a, [ts(1, ".000001"), ts(1, ".000002"), ts(1, ".000003"), ts(2), ts(2), ts(2)]);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const q: string = cursor ? `&limit=2&cursor=${cursor}` : "&limit=2";
      const r = await get(a, c.t, c.c, q);
      const msgs = r.body.data.messages as { id: string }[];
      seen.push(...msgs.map((m) => m.id));
      cursor = r.body.data.nextCursor;
      if (cursor) {
        const raw = await ctx.owner.query<{ t: string }>(
          `SELECT created_at::text AS t FROM chat_messages WHERE id = $1`,
          [msgs.at(-1)!.id],
        );
        expect(decodeChatCursor(cursor)?.createdAt).toBe(raw.rows[0]!.t); // L14's text verbatim
      }
    } while (cursor);
    expect(seen).toEqual(await order(c));
  });

  it("K1 paging while another member inserts: no duplicate, no gap, descending", async () => {
    const c = await club();
    const [a, b] = [await actor(c.t), await actor(c.t)];
    await seed(
      c,
      a,
      [1, 2, 3, 4, 5, 6].map((n) => ts(n)),
    );
    const before = await order(c);
    const p1 = await get(a, c.t, c.c, "&limit=3");
    await send(c, b, "newer one");
    await send(c, b, "newer two");
    const p2 = await get(a, c.t, c.c, `&limit=3&cursor=${p1.body.data.nextCursor}`);
    const ids = [...p1.body.data.messages, ...p2.body.data.messages].map(
      (m: { id: string }) => m.id,
    );
    expect(ids).toEqual(before);
  });
});

/** POST a message; csrf defaults to the actor's token, null sends none. Every response is no-store. */
async function post(
  a: Actor | null,
  tenant: string,
  channel: string,
  payload: unknown,
  csrf: string | null | undefined = a?.csrf,
) {
  cookieJar.token = a?.token;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (csrf) headers["x-csrf-token"] = csrf;
  const url = `https://plexco.app/api/chat/channels/${channel}/messages?tenant=${tenant}`;
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  const req = new Request(url, { method: "POST", headers, body });
  const res = await postMessage(req, { params: Promise.resolve({ id: channel }) });
  expect(res.headers.get("cache-control")).toBe("no-store");
  const env = (await res.json()) as Envelope;
  return { status: res.status, body: env, code: env.error?.code };
}
const msg = (body = "hi") => ({ clientMsgId: randomUUID(), body });

describe("POST /api/chat/channels/:id/messages (send)", () => {
  it("T1 no session -> 401; C1 missing or wrong x-csrf-token -> 403 CSRF_INVALID, no row", async () => {
    const c = await club();
    const a = await actor(c.t);
    expect(await post(null, c.t, c.c, msg())).toMatchObject({ status: 401, code: "AUTH_REQUIRED" });
    for (const csrf of [null, "wrong"]) {
      const r = await post(a, c.t, c.c, msg(), csrf);
      expect(r).toMatchObject({ status: 403, code: "CSRF_INVALID" });
    }
    expect(await order(c)).toEqual([]);
  });

  it("T3 a member's message, leading '/' included -> 200 exactly {id, createdAt ISO, duplicate}", async () => {
    const c = await club();
    const a = await actor(c.t);
    const first = await post(a, c.t, c.c, msg("/start secret-text"));
    expect(first.status).toBe(200);
    expect(Object.keys(first.body.data).sort()).toEqual(["createdAt", "duplicate", "id"]);
    expect(first.body.data.duplicate).toBe(false);
    expect(first.body.data.createdAt).toBe(new Date(first.body.data.createdAt).toISOString());
    expect(JSON.stringify(first.body)).not.toContain("secret-text");
    const { rows } = await ctx.owner.query<{ body: string }>(
      `SELECT body FROM chat_messages WHERE id = $1`,
      [first.body.data.id],
    );
    expect(rows[0]!.body).toBe("/start secret-text"); // D-11: stored as text, no slash command
  });

  it("T4 the same author repeats a clientMsgId -> 200 the original, duplicate: true, one row", async () => {
    const c = await club();
    const a = await actor(c.t);
    const payload = msg();
    const first = await post(a, c.t, c.c, payload);
    const again = await post(a, c.t, c.c, { ...payload, body: "changed" });
    expect(again.status).toBe(200);
    expect(again.body.data).toEqual({ ...first.body.data, duplicate: true });
    expect(await order(c)).toEqual([first.body.data.id]);
  });

  it("T5 member B reuses member A's clientMsgId -> 409 CHAT_IDEMPOTENCY_MISMATCH, no data", async () => {
    const c = await club();
    const [a, b] = [await actor(c.t), await actor(c.t)];
    const payload = msg("from a");
    const first = await post(a, c.t, c.c, payload);
    const r = await post(b, c.t, c.c, { ...payload, body: "from b" });
    expect(r).toMatchObject({ status: 409, code: "CHAT_IDEMPOTENCY_MISMATCH" });
    expect(r.body.data ?? null).toBeNull();
    expect(JSON.stringify(r.body)).not.toContain(first.body.data.id);
    expect(await order(c)).toEqual([first.body.data.id]);
  });

  it("T22 non-uuid tenant, channel, clientMsgId or reply id, a bad body or JSON -> 400", async () => {
    const c = await club();
    const a = await actor(c.t);
    const cases: [string, string, unknown][] = [
      ["not-a-uuid", c.c, msg()],
      [c.t, "not-a-uuid", msg()],
      [c.t, c.c, { ...msg(), clientMsgId: "not-a-uuid" }],
      [c.t, c.c, { body: "hi" }],
      [c.t, c.c, { ...msg(), replyToMessageId: "not-a-uuid" }],
      [c.t, c.c, { ...msg(), body: 42 }],
      [c.t, c.c, msg("   ")],
      [c.t, c.c, "{not-a-uuid"],
      [c.t, c.c, "[]"],
    ];
    for (const [tenant, channel, payload] of cases) {
      const r = await post(a, tenant, channel, payload);
      expect(r).toMatchObject({ status: 400, code: "INVALID_BODY" });
      expect(JSON.stringify(r.body)).not.toContain("not-a-uuid");
    }
    expect(await order(c)).toEqual([]);
  });

  it("T2 foreign tenant, guest, unknown, other-tenant and DM channel -> the one 403 body", async () => {
    const [c, other, off] = [await club(), await club(), await club(false)];
    const [a, b, guest, stranger, m] = [
      await actor(c.t),
      await actor(c.t),
      await actor(c.t, "guest"),
      await actor(other.t),
      await actor(off.t),
    ];
    await ctx.owner.query("BEGIN");
    const dm = await ctx.owner.query<{ id: string }>(
      `INSERT INTO chat_channels (kind, dm_key) VALUES ('dm', $1) RETURNING id`,
      [[a.personId, b.personId].sort().join(":")],
    );
    const dmId = dm.rows[0]!.id;
    await ctx.owner.query(
      `INSERT INTO chat_members (channel_id, person_id) VALUES ($1, $2), ($1, $3)`,
      [dmId, a.personId, b.personId],
    );
    await ctx.owner.query("COMMIT");
    const { c2, own } = await outsideChannel(c, a, b);
    const cases = [
      await post(stranger, c.t, c.c, msg()),
      await post(guest, c.t, c.c, msg()),
      await post(a, c.t, randomUUID(), msg()),
      await post(a, c.t, other.c, msg()),
      await post(a, c.t, dmId, msg()),
      await post(a, c.t, c2.c, msg()),
    ];
    const one = (r: (typeof cases)[number]) =>
      JSON.stringify([r.status, r.body.data, r.body.error]);
    expect(cases[0]).toMatchObject({ status: 403, code: "CHAT_FORBIDDEN" });
    for (const r of cases) expect(one(r)).toBe(one(cases[0]!));
    for (const ch of [c, other, { t: c.t, c: dmId }]) expect(await order(ch)).toEqual([]);
    expect(await order(c2)).toEqual([own]);
    expect(await post(m, off.t, off.c, msg())).toMatchObject({
      status: 403,
      code: "TENANT_SUSPENDED",
    });
  });

  it("T6 a body over L14's 4000 characters or a request over the 64 KiB cap -> 413, no row", async () => {
    const c = await club();
    const a = await actor(c.t);
    // The pad keeps the body under 4000 characters, so only the route's byte cap answers;
    // unlisted fields are ignored, so without the cap this request is a 200.
    for (const payload of [msg("x".repeat(4001)), { ...msg(), pad: "x".repeat(70_000) }]) {
      const r = await post(a, c.t, c.c, payload);
      expect(r).toMatchObject({ status: 413, code: "CHAT_MESSAGE_TOO_LARGE" });
    }
    expect(await order(c)).toEqual([]);
  });

  it("T7 admins_only channel, member without the capability -> 403 CHAT_CAPABILITY_REQUIRED", async () => {
    const c = await club();
    const a = await actor(c.t);
    await ctx.owner.query(`UPDATE chat_channels SET post_policy = 'admins_only' WHERE id = $1`, [
      c.c,
    ]);
    const r = await post(a, c.t, c.c, msg());
    expect(r).toMatchObject({ status: 403, code: "CHAT_CAPABILITY_REQUIRED" });
    expect(await order(c)).toEqual([]);
  });

  it("T8 the 21st send in 10 s and an exhausted chat-actor budget -> 429 CHAT_RATE_LIMITED", async () => {
    const c = await club();
    const [a, b] = [await actor(c.t), await actor(c.t)];
    for (let i = 0; i < 20; i++) await send(c, a, "burst");
    expect(await post(a, c.t, c.c, msg())).toMatchObject({
      status: 429,
      code: "CHAT_RATE_LIMITED",
    });
    for (let i = 0; i < 120; i++) {
      const bucket = `chat-actor:${b.accountId}`;
      expect(await rateLimitCheck(runtime!.pool, bucket, 120, 60)).toBe(true);
    }
    expect(await post(b, c.t, c.c, msg())).toMatchObject({
      status: 429,
      code: "CHAT_RATE_LIMITED",
    });
    expect(await order(c)).toHaveLength(20);
  });

  it("T9 a reply to an unknown or another channel's message -> 409 CHAT_REPLY_INVALID", async () => {
    const [c, other] = [await club(), await club()];
    const [a, b, o] = [await actor(c.t), await actor(c.t), await actor(other.t)];
    const parent = await send(c, a, "parent");
    const elsewhere = await send(other, o, "elsewhere");
    // `a` stays a chat member of c2, so RLS shows `own` and only the channel match can refuse it.
    const { c2, own } = await outsideChannel(c, b, a);
    for (const replyToMessageId of [randomUUID(), elsewhere.id, own]) {
      const r = await post(a, c.t, c.c, { ...msg(), replyToMessageId });
      expect(r).toMatchObject({ status: 409, code: "CHAT_REPLY_INVALID" });
    }
    expect(await order(c)).toEqual([parent.id]);
    expect(await order(c2)).toEqual([own]);
    const r = await post(a, c.t, c.c, { ...msg(), replyToMessageId: parent.id.toUpperCase() });
    expect(r.status).toBe(200);
  });
});

/** PATCH or DELETE one message; csrf defaults to the actor's token, null sends none (N1 asserted). */
async function mutate(
  method: "PATCH" | "DELETE" | "POST",
  a: Actor | null,
  c: Club,
  messageId: string,
  payload?: unknown,
  csrf: string | null | undefined = a?.csrf,
) {
  cookieJar.token = a?.token;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (csrf) headers["x-csrf-token"] = csrf;
  const path = `${c.c}/messages/${messageId}${method === "POST" ? "/moderation" : ""}`;
  const url = `https://plexco.app/api/chat/channels/${path}?tenant=${c.t}`;
  const body =
    typeof payload === "string" || payload === undefined ? payload : JSON.stringify(payload);
  const handler = { PATCH: patchMessage, DELETE: deleteMessage, POST: moderate }[method];
  const res = await handler(new Request(url, { method, headers, body }), {
    params: Promise.resolve({ id: c.c, messageId }),
  });
  expect(res.headers.get("cache-control")).toBe("no-store");
  const env = (await res.json()) as Envelope;
  return { status: res.status, body: env, code: env.error?.code };
}

/** The stored row, read as owner: a refused mutation changes none of these columns. */
async function row(id: string) {
  const { rows } = await ctx.owner.query(
    `SELECT body, edit_count, author_deleted_at FROM chat_messages WHERE id = $1`,
    [id],
  );
  return rows[0] as { body: string; edit_count: number; author_deleted_at: Date | null };
}
const edit = (body: string, expectedEditCount: number) => ({ body, expectedEditCount });
const OLD = "2026-01-01 00:00:00+00"; // far past L14's 15-minute edit window

describe("PATCH and DELETE /api/chat/channels/:id/messages/:messageId (edit, delete)", () => {
  it("T1 no session -> 401; C1 missing or wrong x-csrf-token -> 403 CSRF_INVALID, no change", async () => {
    const c = await club();
    const a = await actor(c.t);
    const m = await send(c, a, "original");
    for (const method of ["PATCH", "DELETE"] as const) {
      const r = await mutate(method, null, c, m.id, edit("changed", 0));
      expect(r).toMatchObject({ status: 401, code: "AUTH_REQUIRED" });
      for (const csrf of [null, "wrong"]) {
        const bad = await mutate(method, a, c, m.id, edit("changed", 0), csrf);
        expect(bad).toMatchObject({ status: 403, code: "CSRF_INVALID" });
      }
    }
    expect(await row(m.id)).toEqual({ body: "original", edit_count: 0, author_deleted_at: null });
  });

  it("T3 the author's PATCH -> 200 exactly {id, editCount, editedAt ISO, changed}; no body", async () => {
    const c = await club();
    const a = await actor(c.t);
    const m = await send(c, a, "first text");
    const r = await mutate("PATCH", a, c, m.id, edit("second secret-text", 0));
    expect(r.status).toBe(200);
    expect(Object.keys(r.body.data).sort()).toEqual(["changed", "editCount", "editedAt", "id"]);
    expect(r.body.data).toMatchObject({ id: m.id, editCount: 1, changed: true });
    expect(r.body.data.editedAt).toBe(new Date(r.body.data.editedAt).toISOString());
    expect(JSON.stringify(r.body)).not.toMatch(/secret-text|first text/);
    const same = await mutate("PATCH", a, c, m.id, edit("second secret-text", 1));
    expect(same).toMatchObject({ status: 200, body: { data: { ...r.body.data, changed: false } } });
    // an identical body on a never-edited message: editedAt null, not a 500 from the ISO mapper
    const fresh = await send(c, a, "untouched");
    const noop = await mutate("PATCH", a, c, fresh.id, edit("untouched", 0));
    expect(noop.body.data).toEqual({ id: fresh.id, editCount: 0, editedAt: null, changed: false });
    expect(await row(m.id)).toMatchObject({ body: "second secret-text", edit_count: 1 });
  });

  it("T10 past 15 min or 5 edits, or a non-author -> 409 WINDOW_CLOSED; stale count -> 409 CONFLICT", async () => {
    const c = await club();
    const [a, b] = [await actor(c.t), await actor(c.t)];
    await seed(c, a, [OLD]);
    const [old] = await order(c);
    const late = await mutate("PATCH", a, c, old!, edit("late", 0));
    expect(late).toMatchObject({ status: 409, code: "CHAT_EDIT_WINDOW_CLOSED" });
    const m = await send(c, a, "v0");
    const stale = await mutate("PATCH", a, c, m.id, edit("stale", 1));
    expect(stale).toMatchObject({ status: 409, code: "CHAT_EDIT_CONFLICT" });
    const other = await mutate("PATCH", b, c, m.id, edit("not mine", 0)); // L14 V-9: author only
    expect(other).toMatchObject({ status: 409, code: "CHAT_EDIT_WINDOW_CLOSED" });
    for (let n = 0; n < 5; n++) {
      expect((await mutate("PATCH", a, c, m.id, edit(`v${n + 1}`, n))).status).toBe(200);
    }
    const sixth = await mutate("PATCH", a, c, m.id, edit("v6", 5));
    expect(sixth).toMatchObject({ status: 409, code: "CHAT_EDIT_WINDOW_CLOSED" });
    expect(await row(m.id)).toMatchObject({ body: "v5", edit_count: 5 });
    expect(await row(old!)).toMatchObject({ body: "seed body", edit_count: 0 });
  });

  it("T11 note 32 order: admins_only without the capability beats the closed window (403)", async () => {
    const c = await club();
    const a = await actor(c.t);
    await seed(c, a, [OLD]);
    const [old] = await order(c);
    await ctx.owner.query(`UPDATE chat_channels SET post_policy = 'admins_only' WHERE id = $1`, [
      c.c,
    ]);
    const r = await mutate("PATCH", a, c, old!, edit("x", 0));
    expect(r).toMatchObject({ status: 403, code: "CHAT_CAPABILITY_REQUIRED" });
    expect(await row(old!)).toMatchObject({ body: "seed body", edit_count: 0 });
  });

  it("T11 note 32 order: a non-member of an admins_only channel -> the one 403 body first", async () => {
    const [c, other] = [await club(), await club()];
    const [a, b, stranger] = [await actor(c.t), await actor(c.t), await actor(other.t)];
    const { c2, own } = await outsideChannel(c, a, b);
    await ctx.owner.query(`UPDATE chat_channels SET post_policy = 'admins_only' WHERE id = $1`, [
      c2.c,
    ]);
    const [r, ref] = [
      await mutate("PATCH", a, c2, own, edit("x", 0)),
      await mutate("PATCH", stranger, c2, own, edit("x", 0)),
    ];
    const one = (x: typeof r) => JSON.stringify([x.status, x.body.data, x.body.error]);
    expect(r).toMatchObject({ status: 403, code: "CHAT_FORBIDDEN" });
    expect(one(r)).toBe(one(ref));
    expect(await row(own)).toEqual({
      body: "outside text",
      edit_count: 0,
      author_deleted_at: null,
    });
  });

  it("T12 the author deletes twice -> 200 changed true then false; history keeps a tombstone", async () => {
    const c = await club();
    const a = await actor(c.t);
    const m = await send(c, a, "to delete");
    const first = await mutate("DELETE", a, c, m.id);
    expect(first.status).toBe(200);
    expect(Object.keys(first.body.data).sort()).toEqual(["authorDeletedAt", "changed", "id"]);
    expect(first.body.data).toMatchObject({ id: m.id, changed: true });
    const at = first.body.data.authorDeletedAt;
    expect(at).toBe(new Date(at).toISOString());
    const again = await mutate("DELETE", a, c, m.id);
    expect(again.body.data).toEqual({ ...first.body.data, changed: false });
    const [tomb] = (await get(a, c.t, c.c)).body.data.messages;
    expect(tomb).toEqual({
      id: m.id,
      channelId: c.c,
      createdAt: tomb.createdAt,
      tombstone: "author_deleted",
    });
    expect(JSON.stringify([first.body, again.body])).not.toContain("to delete");
    const revive = await mutate("PATCH", a, c, m.id, edit("back", 0));
    expect(revive).toMatchObject({ status: 409, code: "CHAT_EDIT_WINDOW_CLOSED" });
  });

  it("T13 another member or a moderator deletes -> the one 403 body; no change", async () => {
    const c = await club();
    const [a, b, mod] = [await actor(c.t), await actor(c.t), await actor(c.t)];
    await ctx.owner.query(
      `INSERT INTO tenant_admins (tenant_id, platform, platform_user_lookup_hash, role, active)
       VALUES ($1, 'web', $2, 'owner', true)`,
      [c.t, mod.personId],
    );
    const m = await send(c, a, "kept");
    const [byMember, byMod, unknown] = [
      await mutate("DELETE", b, c, m.id),
      await mutate("DELETE", mod, c, m.id),
      await mutate("DELETE", b, c, randomUUID()),
    ];
    // S2: byte-equal with T2's unknown-message deny, so a non-author gets no per-reason body.
    const one = (r: typeof byMember) => JSON.stringify([r.status, r.body.data, r.body.error]);
    expect(byMember).toMatchObject({ status: 403, code: "CHAT_FORBIDDEN" });
    for (const r of [byMember, byMod]) expect(one(r)).toBe(one(unknown));
    expect(await row(m.id)).toEqual({ body: "kept", edit_count: 0, author_deleted_at: null });
  });

  it("T2 foreign tenant, guest, unknown or foreign message, other-tenant and DM channel -> one 403", async () => {
    const [c, other, off] = [await club(), await club(), await club(false)];
    const [a, b, guest, stranger, o, m] = [
      await actor(c.t),
      await actor(c.t),
      await actor(c.t, "guest"),
      await actor(other.t),
      await actor(other.t),
      await actor(off.t),
    ];
    const { dmId, dmMsg } = await dmWith(a, b);
    const mine = await send(c, a, "mine");
    const theirs = await send(other, o, "theirs");
    const { c2, own } = await outsideChannel(c, a, b);
    const cases: Awaited<ReturnType<typeof mutate>>[] = [];
    for (const method of ["PATCH", "DELETE"] as const) {
      const p = edit("x", 0);
      cases.push(
        await mutate(method, stranger, c, mine.id, p),
        await mutate(method, guest, c, mine.id, p),
        await mutate(method, a, c, randomUUID(), p),
        await mutate(method, a, c, theirs.id, p),
        await mutate(method, a, { t: c.t, c: other.c }, theirs.id, p),
        await mutate(method, a, c2, own, p),
        await mutate(method, a, { t: c.t, c: dmId }, dmMsg, p),
      );
      const r = await mutate(method, m, off, randomUUID(), p);
      expect(r).toMatchObject({ status: 403, code: "TENANT_SUSPENDED" });
    }
    const one = (r: (typeof cases)[number]) =>
      JSON.stringify([r.status, r.body.data, r.body.error]);
    expect(cases[0]).toMatchObject({ status: 403, code: "CHAT_FORBIDDEN" });
    for (const r of cases) expect(one(r)).toBe(one(cases[0]!));
    expect(await row(mine.id)).toEqual({ body: "mine", edit_count: 0, author_deleted_at: null });
    expect(await row(theirs.id)).toEqual({
      body: "theirs",
      edit_count: 0,
      author_deleted_at: null,
    });
    expect(await row(own)).toEqual({
      body: "outside text",
      edit_count: 0,
      author_deleted_at: null,
    });
    expect(await row(dmMsg)).toEqual({ body: "dm text", edit_count: 0, author_deleted_at: null });
  });

  it("T22 non-uuid tenant, channel or message id, a bad edit body or JSON -> 400, never 500", async () => {
    const c = await club();
    const a = await actor(c.t);
    const m = await send(c, a, "orig");
    const bad = "not-a-uuid";
    const cases: ["PATCH" | "DELETE", Club, string, unknown][] = [];
    for (const method of ["PATCH", "DELETE"] as const) {
      const p = method === "PATCH" ? edit("x", 0) : undefined;
      cases.push([method, { t: bad, c: c.c }, m.id, p], [method, { t: c.t, c: bad }, m.id, p]);
      cases.push([method, c, bad, p]);
    }
    for (const p of [
      { body: 42, expectedEditCount: 0 },
      { body: "x" },
      ...[-1, 1.5, "0", null, 2 ** 31].map((n) => ({ body: "x", expectedEditCount: n })),
      edit("   ", 0),
      `{${bad}`,
      "[]",
    ]) {
      cases.push(["PATCH", c, m.id, p]);
    }
    for (const [method, where, id, payload] of cases) {
      const r = await mutate(method, a, where, id, payload);
      expect(r).toMatchObject({ status: 400, code: "INVALID_BODY" });
      expect(JSON.stringify(r.body)).not.toContain(bad);
    }
    expect(await row(m.id)).toEqual({ body: "orig", edit_count: 0, author_deleted_at: null });
  });

  it("413 over 4000 characters or 64 KiB; 429 from chat_edit_1m (shared) and chat-actor", async () => {
    const c = await club();
    const [a, b] = [await actor(c.t), await actor(c.t)];
    const m = await send(c, a, "orig");
    for (const p of [edit("x".repeat(4001), 0), { ...edit("hi", 0), pad: "x".repeat(70_000) }]) {
      const r = await mutate("PATCH", a, c, m.id, p);
      expect(r).toMatchObject({ status: 413, code: "CHAT_MESSAGE_TOO_LARGE" });
    }
    for (let i = 0; i < 30; i++) {
      const bucket = `chat_edit_1m:${a.personId}:${c.c}`;
      expect(await rateLimitCheck(runtime!.pool, bucket, 30, 60)).toBe(true);
    }
    for (const method of ["PATCH", "DELETE"] as const) {
      const r = await mutate(method, a, c, m.id, edit("new", 0));
      expect(r).toMatchObject({ status: 429, code: "CHAT_RATE_LIMITED" });
    }
    const theirs = await send(c, b, "b text");
    for (let i = 0; i < 120; i++) {
      const bucket = `chat-actor:${b.accountId}`;
      expect(await rateLimitCheck(runtime!.pool, bucket, 120, 60)).toBe(true);
    }
    const r = await mutate("DELETE", b, c, theirs.id);
    expect(r).toMatchObject({ status: 429, code: "CHAT_RATE_LIMITED" });
    expect(await row(m.id)).toEqual({ body: "orig", edit_count: 0, author_deleted_at: null });
    expect(await row(theirs.id)).toMatchObject({ author_deleted_at: null });
  });
});

/** A member with a tenant_admins row, by default an active owner, which tenant_capability_authorize
 *  grants chat.message.moderate (T19's fixture); the L15b viewer rows vary the row's kind and state. */
async function moderator(
  t: string,
  role: "owner" | "admin" | "co_admin" = "owner",
  active = true,
): Promise<Actor> {
  const mod = await actor(t);
  await ctx.owner.query(
    `INSERT INTO tenant_admins (tenant_id, platform, platform_user_lookup_hash, role, active)
     VALUES ($1, 'web', $2, $3, $4)`,
    [t, mod.personId, role, active],
  );
  return mod;
}

/** Moderation state and audit-row count of one message, read as owner. */
async function modRow(id: string) {
  const { rows } = await ctx.owner.query(
    `SELECT m.moderation_state AS state,
            (SELECT count(*)::int FROM chat_moderation_audit a WHERE a.message_id = m.id) AS audits
       FROM chat_messages m WHERE m.id = $1`,
    [id],
  );
  return rows[0] as { state: string; audits: number };
}
const hide = (extra: Record<string, unknown> = {}) => ({
  action: "hide",
  reasonCode: "spam",
  commandId: randomUUID(),
  ...extra,
});

describe("POST /api/chat/channels/:id/messages/:messageId/moderation (hide, restore)", () => {
  it("T1 no session -> 401; C1 missing or wrong x-csrf-token -> 403 CSRF_INVALID, no change", async () => {
    const c = await club();
    const [a, mod] = [await actor(c.t), await moderator(c.t)];
    const m = await send(c, a, "flagged text");
    const before = await modRow(m.id);
    const anon = await mutate("POST", null, c, m.id, hide());
    expect(anon).toMatchObject({ status: 401, code: "AUTH_REQUIRED" });
    for (const csrf of [null, "wrong"]) {
      const r = await mutate("POST", mod, c, m.id, hide(), csrf);
      expect(r).toMatchObject({ status: 403, code: "CSRF_INVALID" });
    }
    expect(await modRow(m.id)).toEqual(before);
  });

  it("T16 hide then restore -> 200 exactly {messageId, moderationState, changed}; no body or actor", async () => {
    const c = await club();
    const [a, mod] = [await actor(c.t), await moderator(c.t)];
    const m = await send(c, a, "flagged text");
    const hid = await mutate("POST", mod, c, m.id, hide());
    expect(hid.status).toBe(200);
    expect(hid.body.data).toEqual({ messageId: m.id, moderationState: "hidden", changed: true });
    const back = await mutate("POST", mod, c, m.id, hide({ action: "restore" }));
    expect(back.body.data).toEqual({ messageId: m.id, moderationState: "visible", changed: true });
    const noop = await mutate("POST", mod, c, m.id, hide({ action: "restore" }));
    expect(noop.body.data).toEqual({ messageId: m.id, moderationState: "visible", changed: false });
    for (const r of [hid, back, noop]) {
      expect(JSON.stringify(r.body)).not.toContain("flagged text");
      expect(JSON.stringify(r.body)).not.toContain(mod.personId);
    }
    expect(await modRow(m.id)).toEqual({ state: "visible", audits: 2 });
  });

  it("T17 a replayed commandId -> 200 the stored result, one audit; a new fingerprint -> 409", async () => {
    const c = await club();
    const [a, mod] = [await actor(c.t), await moderator(c.t)];
    const m = await send(c, a, "flagged text");
    const cmd = hide();
    const first = await mutate("POST", mod, c, m.id, cmd);
    const replay = await mutate("POST", mod, c, m.id, cmd);
    expect(replay.status).toBe(200);
    expect(replay.body.data).toEqual(first.body.data);
    for (const p of [
      { ...cmd, reasonCode: "harassment" },
      { ...cmd, action: "restore" },
    ]) {
      const r = await mutate("POST", mod, c, m.id, p);
      expect(r).toMatchObject({ status: 409, code: "CHAT_IDEMPOTENCY_MISMATCH" });
      expect(r.body.data ?? null).toBeNull();
    }
    expect(await modRow(m.id)).toEqual({ state: "hidden", audits: 1 });
  });

  it("T14 a member without chat.message.moderate -> 403 CHAT_MODERATION_FORBIDDEN; no change", async () => {
    const c = await club();
    const [a, b, mod] = [await actor(c.t), await actor(c.t), await moderator(c.t)];
    const m = await send(c, a, "flagged text");
    const before = await modRow(m.id);
    const one = (r: Awaited<ReturnType<typeof mutate>>) =>
      JSON.stringify([r.status, r.body.data, r.body.error]);
    // S3: the one body of moderation T2 (a moderator on an unknown target), for an existing and an
    // unknown target alike, so the missing capability is no enumeration oracle.
    const ref = one(await mutate("POST", mod, c, randomUUID(), hide()));
    for (const who of [a, b]) {
      for (const target of [m.id, randomUUID()]) {
        const r = await mutate("POST", who, c, target, hide());
        expect(r).toMatchObject({ status: 403, code: "CHAT_MODERATION_FORBIDDEN" });
        expect(one(r)).toBe(ref);
        expect(JSON.stringify(r.body)).not.toContain("flagged text");
      }
    }
    expect(await modRow(m.id)).toEqual(before);
  });

  it("T15 an unknown reasonCode, other without a note, spam with a note -> 422; no change", async () => {
    const c = await club();
    const [a, mod] = [await actor(c.t), await moderator(c.t)];
    const m = await send(c, a, "flagged text");
    const before = await modRow(m.id);
    const bad = [
      { reasonCode: "rude" },
      { reasonCode: "other" },
      { reasonNote: "why" },
      { reasonCode: "other", reasonNote: "x".repeat(501) },
    ];
    for (const p of bad) {
      const r = await mutate("POST", mod, c, m.id, hide(p));
      expect(r).toMatchObject({ status: 422, code: "CHAT_REASON_INVALID" });
    }
    expect(await modRow(m.id)).toEqual(before);
    const good = await mutate(
      "POST",
      mod,
      c,
      m.id,
      hide({ reasonCode: "other", reasonNote: "why" }),
    );
    expect(good.body.data).toMatchObject({ moderationState: "hidden", changed: true });
  });

  it("T22 non-uuid ids, an action outside hide | restore, bad reason types or JSON -> 400; 413", async () => {
    const c = await club();
    const [a, mod] = [await actor(c.t), await moderator(c.t)];
    const m = await send(c, a, "flagged text");
    const before = await modRow(m.id);
    const fields = [
      { commandId: "x" },
      { commandId: undefined },
      { action: "delete" },
      { action: "HIDE" },
      { reasonCode: 1 },
      { reasonNote: 7 },
    ];
    const bad: [Club, string, unknown][] = [
      [{ t: "x", c: c.c }, m.id, hide()],
      [{ t: c.t, c: "x" }, m.id, hide()],
      [c, "x", hide()],
      [c, m.id, "{"],
      [c, m.id, "[]"],
      ...fields.map((f): [Club, string, unknown] => [c, m.id, hide(f)]),
    ];
    for (const [where, id, p] of bad) {
      const r = await mutate("POST", mod, where, id, p);
      expect(r).toMatchObject({ status: 400, code: "INVALID_BODY" });
    }
    const big = await mutate("POST", mod, c, m.id, hide({ reasonNote: "x".repeat(64 * 1024) }));
    expect(big).toMatchObject({ status: 413, code: "CHAT_MESSAGE_TOO_LARGE" });
    expect(await modRow(m.id)).toEqual(before);
  });

  it("T2 a foreign tenant -> the one CHAT_FORBIDDEN body; unknown, foreign or DM targets -> one 403", async () => {
    const [c, other] = [await club(), await club()];
    const [a, mod, stranger, o] = [
      await actor(c.t),
      await moderator(c.t),
      await moderator(other.t),
      await actor(other.t),
    ];
    const mine = await send(c, a, "flagged text");
    const theirs = await send(other, o, "their text");
    // a's message in c2, a same-tenant channel that `mod` still belongs to.
    const { own: elsewhere } = await outsideChannel(c, a, mod);
    // a's DM with mod: mod is a member, but moderation is club-only (0063 checks the kind first).
    const { dmId, dmMsg } = await dmWith(a, mod);
    const foreign = await mutate("POST", stranger, c, mine.id, hide());
    expect(foreign).toMatchObject({ status: 403, code: "CHAT_FORBIDDEN" });
    const denied = [
      await mutate("POST", mod, c, randomUUID(), hide()),
      await mutate("POST", mod, c, theirs.id, hide()),
      await mutate("POST", mod, { t: c.t, c: other.c }, theirs.id, hide()),
      await mutate("POST", mod, c, elsewhere, hide()),
      await mutate("POST", mod, { t: c.t, c: dmId }, dmMsg, hide()),
      await mutate("POST", mod, { t: c.t, c: dmId }, dmMsg, hide({ action: "restore" })),
    ];
    const one = (r: (typeof denied)[number]) => JSON.stringify([r.status, r.body.error]);
    expect(denied[0]).toMatchObject({ status: 403, code: "CHAT_MODERATION_FORBIDDEN" });
    for (const r of denied) expect(one(r)).toBe(one(denied[0]!));
    expect(
      (await modRow(mine.id)).audits +
        (await modRow(theirs.id)).audits +
        (await modRow(elsewhere)).audits,
    ).toBe(0);
    expect(await modRow(dmMsg)).toEqual({ state: "visible", audits: 0 });
  });

  it("429 CHAT_RATE_LIMITED from chat_mod_1m (30 per minute per person and tenant); no change, no audit", async () => {
    const c = await club();
    const [a, mod] = [await actor(c.t), await moderator(c.t)];
    const m = await send(c, a, "flagged text");
    for (let i = 0; i < 30; i++) {
      const bucket = `chat_mod_1m:${mod.personId}:${c.t}`;
      expect(await rateLimitCheck(runtime!.pool, bucket, 30, 60)).toBe(true);
    }
    const r = await mutate("POST", mod, c, m.id, hide());
    expect(r).toMatchObject({ status: 429, code: "CHAT_RATE_LIMITED" });
    expect(await modRow(m.id)).toEqual({ state: "visible", audits: 0 });
  });

  it("T18 one commandId on two channels at once: one 200, the loser 409 or a fail-closed 500", async () => {
    const c = await club();
    const [a, mod] = [await actor(c.t), await moderator(c.t)];
    const ch = await ctx.owner.query<{ id: string }>(
      `INSERT INTO chat_channels (tenant_id, kind, title, is_default, sort_order, creation_origin,
         post_policy, assistant_enabled)
       VALUES ($1, 'club', 'second', false, 1, 'system_bootstrap', 'all_members', false) RETURNING id`,
      [c.t],
    );
    const c2: Club = { t: c.t, c: ch.rows[0]!.id };
    await ctx.owner.query(
      `INSERT INTO chat_members (channel_id, tenant_id, person_id, membership_id)
       VALUES ($1, $2, $3, $4), ($1, $2, $5, $6)`,
      [c2.c, c.t, a.personId, a.membershipId, mod.personId, mod.membershipId],
    );
    await seed(c2, a, [ts(1)]);
    const m2 = (await order(c2))[0]!;
    const m1 = (await send(c, a, "flagged text")).id;
    const spies = [vi.spyOn(console, "error"), vi.spyOn(console, "warn"), vi.spyOn(console, "log")];
    const cmd = hide();
    const runs = await Promise.allSettled([
      mutate("POST", mod, c, m1, cmd),
      mutate("POST", mod, c2, m2, cmd),
    ]);
    const won = runs.findIndex((r) => r.status === "fulfilled" && r.value.status === 200);
    expect(won).toBeGreaterThanOrEqual(0);
    const lost = runs[1 - won]!;
    if (lost.status === "rejected") expect(String(lost.reason)).toBe("Error: CHAT_DB_ERROR:23505");
    else expect(lost.value).toMatchObject({ status: 409, code: "CHAT_IDEMPOTENCY_MISMATCH" });
    const [lc, lm, wm] = won === 0 ? [c2, m2, m1] : [c, m1, m2];
    const retry = await mutate("POST", mod, lc, lm, cmd);
    expect(retry).toMatchObject({ status: 409, code: "CHAT_IDEMPOTENCY_MISMATCH" });
    expect((await modRow(lm)).audits).toBe(0);
    expect(await modRow(wm)).toEqual({ state: "hidden", audits: 1 });
    const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls));
    for (const s of spies) s.mockRestore();
    expect(logged).not.toContain("flagged text");
    expect(logged).not.toContain("seed body");
  });
});

/** GET channels; every chat response is no-store (N1). */
async function channels(a: Actor | null, tenant: string) {
  cookieJar.token = a?.token;
  const res = await listChannels(
    new Request(`https://plexco.app/api/chat/channels?tenant=${tenant}`),
  );
  expect(res.headers.get("cache-control")).toBe("no-store");
  const body = (await res.json()) as Envelope;
  return { status: res.status, body, code: body.error?.code };
}

/** A denial's bytes for a byte-equal compare: status, data and error (meta carries the request id). */
const one = (r: { status: number; body: Envelope }) =>
  JSON.stringify([r.status, r.body.data, r.body.error]);

/** The actor's read cursor in the channel, read as owner (null = never marked). */
async function cursor(c: Club, a: Actor): Promise<string | null> {
  const { rows } = await ctx.owner.query<{ id: string | null }>(
    `SELECT last_read_message_id AS id FROM chat_members WHERE channel_id = $1 AND person_id = $2`,
    [c.c, a.personId],
  );
  return rows[0]!.id;
}

describe("A N-1 a NUL (U+0000) in chat text -> 400 INVALID_BODY at the route, never the DB's 22021 500", () => {
  const NUL = "a\u0000b"; // an escape, never a raw byte (Semgrep)

  it("POST send with a NUL body -> 400, no message", async () => {
    const c = await club();
    const a = await actor(c.t);
    expect(await post(a, c.t, c.c, msg(NUL))).toMatchObject({ status: 400, code: "INVALID_BODY" });
    expect(await order(c)).toEqual([]);
  });

  it("PATCH with a NUL body -> 400, the row unchanged", async () => {
    const c = await club();
    const a = await actor(c.t);
    const m = await send(c, a, "original");
    const r = await mutate("PATCH", a, c, m.id, edit(NUL, 0));
    expect(r).toMatchObject({ status: 400, code: "INVALID_BODY" });
    expect(await row(m.id)).toEqual({ body: "original", edit_count: 0, author_deleted_at: null });
    expect(await order(c)).toEqual([m.id]);
  });

  it("hide with a NUL reasonCode or reasonNote -> 400, no state change and no audit", async () => {
    const c = await club();
    const [a, mod] = [await actor(c.t), await moderator(c.t)];
    const m = await send(c, a, "flagged text");
    const before = await modRow(m.id);
    for (const field of ["reasonCode", "reasonNote"]) {
      const r = await mutate("POST", mod, c, m.id, hide({ [field]: NUL }));
      expect(r).toMatchObject({ status: 400, code: "INVALID_BODY" });
    }
    expect(await modRow(m.id)).toEqual(before);
    expect(await order(c)).toEqual([m.id]);
  });
});

describe("GET /api/chat/channels (list)", () => {
  it("T1 no session -> 401; T22 an empty or non-uuid tenant -> 400, never echoed", async () => {
    const c = await club();
    expect(await channels(null, c.t)).toMatchObject({ status: 401, code: "AUTH_REQUIRED" });
    const a = await actor(c.t);
    for (const t of ["", "not-a-uuid"]) {
      const r = await channels(a, t);
      expect(r).toMatchObject({ status: 400, code: "INVALID_BODY" });
      expect(JSON.stringify(r.body)).not.toContain("not-a-uuid");
    }
  });

  it("T25 a member of two clubs -> 200 exactly ChatChannelDto for ?tenant= only; own rows not unread; R2 plain member: viewer flags false", async () => {
    const [c, other] = [await club(), await club()];
    const [a, b] = [await actor(c.t), await actor(c.t)];
    await ctx.owner.query(
      `INSERT INTO memberships (tenant_id, person_id, status) VALUES ($1, $2, 'active')`,
      [other.t, a.personId],
    );
    await seed(c, b, [ts(1), ts(2), ts(3)]);
    await seed(c, a, [ts(4)]);
    const r = await channels(a, c.t);
    expect(r.status).toBe(200);
    const general = { id: c.c, title: "general", sortOrder: 0, isDefault: true };
    expect(r.body).toEqual({
      data: {
        channels: [{ ...general, postPolicy: "all_members", unreadCount: 3 }],
        viewer: { canModerate: false, canPostRestricted: false },
      },
      error: null,
      meta: expect.anything(),
    });
    expect(JSON.stringify(r.body)).not.toContain("seed body");
    expect((await channels(a, other.t)).body.data.channels).toMatchObject([{ id: other.c }]);
  });

  it("T2 cross-tenant, guest, a member with no readable channel (D-23) -> the one 403 body", async () => {
    const [c, other, bare] = [await club(), await club(), await club()];
    const stranger = await actor(other.t);
    const [guest, member] = [await actor(c.t, "guest"), await actor(bare.t)];
    await ctx.owner.query(`UPDATE chat_channels SET archived_at = now() WHERE id = $1`, [bare.c]);
    const cases = [
      await channels(stranger, c.t),
      await channels(guest, c.t),
      await channels(member, bare.t),
      await get(stranger, c.t, c.c),
    ];
    expect(cases[0]).toMatchObject({ status: 403, code: "CHAT_FORBIDDEN" });
    for (const r of cases) expect(one(r)).toBe(one(cases[0]!));
  });

  it("T23 a suspended club: its member -> TENANT_SUSPENDED, a non-member -> the one body; R5c an owner-member: the history GET's TENANT_SUSPENDED body, no viewer key", async () => {
    const off = await club(false);
    const [m, stranger] = [await actor(off.t), await actor((await club()).t)];
    expect(await channels(m, off.t)).toMatchObject({ status: 403, code: "TENANT_SUSPENDED" });
    expect(await channels(stranger, off.t)).toMatchObject({ status: 403, code: "CHAT_FORBIDDEN" });
    const boss = await moderator(off.t);
    const hist = await get(boss, off.t, off.c);
    expect(hist).toMatchObject({ status: 403, code: "TENANT_SUSPENDED" });
    for (const r of [await channels(m, off.t), await channels(boss, off.t)]) {
      expect(one(r)).toBe(one(hist));
      expect(JSON.stringify(r.body)).not.toContain('"viewer"');
    }
  });
});

describe("GET /api/chat/channels viewer flags (L15b decision table: authorize()'s answer, booleans only)", () => {
  const ALL = { canModerate: true, canPostRestricted: true };
  const NONE = { canModerate: false, canPostRestricted: false };

  for (const [row, kind] of [
    ["R1a", "owner"],
    ["R1b", "admin"],
    ["R1c", "co_admin"],
  ] as const) {
    it(`${row} ${kind}: viewer flags true`, async () => {
      const c = await club();
      const r = await channels(await moderator(c.t, kind), c.t);
      expect(r.status).toBe(200);
      expect(r.body.data.viewer).toStrictEqual(ALL); // the primitive's preset answer, not re-derived
    });
  }

  it("R1d independent flags: each flag is authorize()'s answer for its own action (the D8 seam)", async () => {
    // Both keys are preset (0047:85-86), so no real fixture allows exactly one of them; the D8
    // stub answers per action instead and writes no shared database state.
    const keys = ["chat.message.moderate", "chat.channel.post_restricted"] as const;
    const c = await club();
    const viewer = await actor(c.t); // a plain member: the real answer is false for both
    const mock = vi.mocked(authorize);
    const byAction = (a: { action: string }, b: { action: string }) =>
      a.action.localeCompare(b.action);
    try {
      for (const [only, expected] of [
        [keys[0], { canModerate: true, canPostRestricted: false }],
        [keys[1], { canModerate: false, canPostRestricted: true }],
      ] as const) {
        const calls: Parameters<typeof authorize>[1][] = [];
        // answers every call of this GET itself: nothing delegates to the real authorize
        mock.mockImplementation(async (_tx, p) => {
          calls.push(p);
          return p.action === only
            ? { allowed: true, role: "admin" }
            : { allowed: false, reason: "not_a_member" };
        });
        const r = await channels(viewer, c.t);
        expect(r.status).toBe(200);
        expect(r.body.data.viewer).toStrictEqual(expected);
        // exactly two calls, one per action, for the proved ?tenant= and the session person
        expect([...calls].sort(byAction)).toStrictEqual(
          keys
            .map((action) => ({ tenantId: c.t, action, actorPersonId: viewer.personId }))
            .sort(byAction),
        );
      }
    } finally {
      mock.mockReset(); // vitest 4: back to the real authorize, the once queue cleared
    }
  });

  it("R3 inactive admin: viewer flags false", async () => {
    const c = await club();
    const r = await channels(await moderator(c.t, "admin", false), c.t);
    expect(r.status).toBe(200);
    expect(r.body.data.viewer).toStrictEqual(NONE);
  });

  it("R4 an admin of another club only, a plain member here: viewer flags false", async () => {
    const [c, other] = [await club(), await club()];
    const mod = await moderator(other.t);
    await ctx.owner.query(
      `INSERT INTO memberships (tenant_id, person_id, status) VALUES ($1, $2, 'active')`,
      [c.t, mod.personId],
    );
    const r = await channels(mod, c.t);
    expect(r.status).toBe(200);
    expect(r.body.data.viewer).toStrictEqual(NONE);
    // positive control: the same person's row is live in the club that granted it
    expect((await channels(mod, other.t)).body.data.viewer).toStrictEqual(ALL);
  });

  it("R5b an owner row here without a membership, and another club's owner: the one CHAT_FORBIDDEN body, no viewer key", async () => {
    const [c, other] = [await club(), await club()];
    const ghost = await actor(other.t); // signed in, a member of other only
    await ctx.owner.query(
      `INSERT INTO tenant_admins (tenant_id, platform, platform_user_lookup_hash, role, active)
       VALUES ($1, 'web', $2, 'owner', true)`,
      [c.t, ghost.personId],
    );
    const cases = [
      await channels(await actor(other.t), c.t), // T2's cross-tenant stranger: the reference body
      await channels(ghost, c.t),
      await channels(await moderator(other.t), c.t),
    ];
    expect(cases[0]).toMatchObject({ status: 403, code: "CHAT_FORBIDDEN" });
    for (const r of cases) {
      expect(one(r)).toBe(one(cases[0]!));
      expect(JSON.stringify(r.body)).not.toContain('"viewer"');
    }
  });

  it("R6 a demoted admin, no cache: true, then false after active = false, then false once the row is gone (R3r)", async () => {
    const c = await club();
    const mod = await moderator(c.t, "admin");
    const flags = async () => {
      const r = await channels(mod, c.t);
      expect(r.status).toBe(200);
      return r.body.data.viewer;
    };
    expect(await flags()).toStrictEqual(ALL);
    await ctx.owner.query(
      `UPDATE tenant_admins SET active = false
        WHERE tenant_id = $1 AND platform = 'web' AND platform_user_lookup_hash = $2`,
      [c.t, mod.personId],
    );
    expect(await flags()).toStrictEqual(NONE);
    await ctx.owner.query(
      `DELETE FROM tenant_admins
        WHERE tenant_id = $1 AND platform = 'web' AND platform_user_lookup_hash = $2`,
      [c.t, mod.personId],
    );
    expect(await flags()).toStrictEqual(NONE); // R3r: a removed admin is the plain-member path
  });

  it("R7 authorize infrastructure error: 500 fail-closed, never a quiet false", async () => {
    const c = await club();
    const mod = await moderator(c.t);
    const mock = vi.mocked(authorize);
    const real = mock.getMockImplementation()!;
    // pg-shaped: a SQLSTATE plus a detail the sanitizer must drop
    const fault = Object.assign(new Error("canceling statement due to statement timeout"), {
      severity: "ERROR",
      code: "57014",
      detail: "R7 leak marker",
    });
    const spies = (["error", "warn", "log", "info", "debug"] as const).map((k) =>
      vi.spyOn(console, k),
    );
    try {
      // at 0 the moderate call rejects; at 1 the post_restricted call (the first one runs for real)
      for (const at of [0, 1]) {
        if (at === 1) mock.mockImplementationOnce(real);
        mock.mockRejectedValueOnce(fault);
        // a rejected GET has no Response, so no body; a resolved one yields null and fails below
        const reason = await channels(mod, c.t).then(
          () => null,
          (e: unknown) => e,
        );
        expect(String(reason)).toBe("Error: CHAT_DB_ERROR:57014");
        const r = await channels(mod, c.t);
        expect(r.status).toBe(200);
        expect(r.body.data.viewer).toStrictEqual(ALL); // the real flags, no Once left queued
      }
      expect(spies.flatMap((s) => s.mock.calls)).toEqual([]);
    } finally {
      for (const s of spies) s.mockRestore();
      mock.mockReset(); // vitest 4: back to the real authorize, the once queue cleared
    }
  });

  it("R8 wire shape (owner viewer): channels and viewer only, two booleans, no role, reason, grant or stray id", async () => {
    const c = await club();
    const mod = await moderator(c.t);
    const r = await channels(mod, c.t);
    expect(r.status).toBe(200);
    expect(Object.keys(r.body.data).sort()).toEqual(["channels", "viewer"]);
    expect(r.body.data.viewer).toStrictEqual(ALL);
    expect(r.body.data.channels).toMatchObject([{ id: c.c }]);
    const text = JSON.stringify(r.body);
    expect(text).not.toMatch(/"[^"]*(?:role|reason|grant)[^"]*":/i);
    for (const literal of ['"owner"', '"admin"', '"co_admin"']) {
      expect(text).not.toContain(literal);
    }
    for (const id of [mod.personId, mod.membershipId, mod.accountId, c.t]) {
      expect(text).not.toContain(id);
    }
    // every uuid on the wire is the channel id or the envelope's req_<uuid> request id
    const uuids =
      text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? [];
    expect(uuids.filter((u) => u !== c.c && !text.includes(`"req_${u}"`))).toEqual([]);
  });
});

async function markRead(
  a: Actor | null,
  tenant: string,
  channel: string,
  payload: unknown,
  csrf: string | null | undefined = a?.csrf,
) {
  cookieJar.token = a?.token;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (csrf) headers["x-csrf-token"] = csrf;
  const url = `https://plexco.app/api/chat/channels/${channel}/read?tenant=${tenant}`;
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  const res = await postRead(new Request(url, { method: "POST", headers, body }), {
    params: Promise.resolve({ id: channel }),
  });
  expect(res.headers.get("cache-control")).toBe("no-store");
  const env = (await res.json()) as Envelope;
  return { status: res.status, body: env, code: env.error?.code };
}

describe("POST /api/chat/channels/:id/read (read cursor)", () => {
  it("T1 no session -> 401; C1 missing or wrong x-csrf-token -> 403 CSRF_INVALID, no cursor", async () => {
    const c = await club();
    const [a, b] = [await actor(c.t), await actor(c.t)];
    const through = { throughMessageId: (await send(c, b, "hello")).id };
    const anon = await markRead(null, c.t, c.c, through);
    expect(anon).toMatchObject({ status: 401, code: "AUTH_REQUIRED" });
    for (const csrf of [null, "wrong"]) {
      const r = await markRead(a, c.t, c.c, through, csrf);
      expect(r).toMatchObject({ status: 403, code: "CSRF_INVALID" });
    }
    expect(await cursor(c, a)).toBeNull();
  });

  it("T24 forward then backward -> 200 {}, never moves back; off-channel or unknown -> 404", async () => {
    const [c, other] = [await club(), await club()];
    const [a, b] = [await actor(c.t), await actor(c.t)];
    await seed(c, b, [ts(1), ts(2)]);
    await seed(other, await actor(other.t), [ts(3)]);
    const [m2, m1] = await order(c);
    const [foreign] = await order(other);
    expect((await channels(a, c.t)).body.data.channels[0].unreadCount).toBe(2);
    for (const throughMessageId of [m2!, m1!]) {
      const r = await markRead(a, c.t, c.c, { throughMessageId });
      expect([r.status, r.body.data, r.body.error]).toEqual([200, {}, null]);
      expect(await cursor(c, a)).toBe(m2);
    }
    expect((await channels(a, c.t)).body.data.channels[0].unreadCount).toBe(0);
    // Made after the last channels() read so channels[0] stays c; `a` stays a member of c2.
    const { c2, own } = await outsideChannel(c, b, a);
    for (const throughMessageId of [foreign!, own, randomUUID()]) {
      const r = await markRead(a, c.t, c.c, { throughMessageId });
      expect(r).toMatchObject({ status: 404, code: "NOT_FOUND" });
    }
    expect(await cursor(c, a)).toBe(m2);
    expect(await cursor(c2, a)).toBeNull();
  });

  it("T2 cross-tenant, guest, unknown, other-tenant and DM channel -> the one 403 body", async () => {
    const [c, other] = [await club(), await club()];
    const [a, b] = [await actor(c.t), await actor(c.t)];
    const [guest, stranger] = [await actor(c.t, "guest"), await actor(other.t)];
    const through = { throughMessageId: (await send(c, b, "hello")).id };
    await ctx.owner.query("BEGIN");
    const dm = await ctx.owner.query<{ id: string }>(
      `INSERT INTO chat_channels (kind, dm_key) VALUES ('dm', $1) RETURNING id`,
      [[a.personId, b.personId].sort().join(":")],
    );
    const dmId = dm.rows[0]!.id;
    await ctx.owner.query(
      `INSERT INTO chat_members (channel_id, person_id) VALUES ($1, $2), ($1, $3)`,
      [dmId, a.personId, b.personId],
    );
    await ctx.owner.query("COMMIT");
    const { c2, own } = await outsideChannel(c, a, b);
    const cases = [
      await markRead(stranger, c.t, c.c, through),
      await markRead(guest, c.t, c.c, through),
      await markRead(a, c.t, randomUUID(), through),
      await markRead(a, c.t, other.c, through),
      await markRead(a, c.t, dmId, through),
      await markRead(a, c.t, c2.c, { throughMessageId: own }),
    ];
    const one = (r: (typeof cases)[number]) =>
      JSON.stringify([r.status, r.body.data, r.body.error]);
    expect(cases[0]).toMatchObject({ status: 403, code: "CHAT_FORBIDDEN" });
    for (const r of cases) expect(one(r)).toBe(one(cases[0]!));
    expect(await cursor(c, a)).toBeNull();
    const left = await ctx.owner.query(
      `SELECT 1 FROM chat_members WHERE channel_id = $1 AND person_id = $2`,
      [c2.c, a.personId],
    );
    expect(left.rowCount).toBe(0); // the refused read never re-enrolls the outsider
  });

  it("T22 non-uuid tenant, channel or throughMessageId, bad JSON or a non-object -> 400", async () => {
    const c = await club();
    const a = await actor(c.t);
    const bad = "not-a-uuid";
    const ok = { throughMessageId: randomUUID() };
    const cases = [
      await markRead(a, bad, c.c, ok),
      await markRead(a, c.t, bad, ok),
      await markRead(a, c.t, c.c, { throughMessageId: bad }),
      await markRead(a, c.t, c.c, { throughMessageId: 5 }),
      await markRead(a, c.t, c.c, {}),
      await markRead(a, c.t, c.c, "{"),
      await markRead(a, c.t, c.c, "[]"),
      await markRead(a, c.t, c.c, "null"),
    ];
    for (const r of cases) {
      expect(r).toMatchObject({ status: 400, code: "INVALID_BODY" });
      expect(JSON.stringify(r.body)).not.toContain(bad);
    }
  });

  it("T23 suspended member -> TENANT_SUSPENDED, non-member the one body; D-5 shared 429", async () => {
    const off = await club(false);
    const [m, stranger] = [await actor(off.t), await actor((await club()).t)];
    const through = { throughMessageId: randomUUID() };
    const suspended = await markRead(m, off.t, off.c, through);
    expect(suspended).toMatchObject({ status: 403, code: "TENANT_SUSPENDED" });
    const outsider = await markRead(stranger, off.t, off.c, through);
    expect(outsider).toMatchObject({ status: 403, code: "CHAT_FORBIDDEN" });
    const c = await club();
    const a = await actor(c.t);
    for (let i = 0; i < 60; i++) {
      expect(await rateLimitCheck(runtime!.pool, `chat-read:${a.personId}`, 60, 60)).toBe(true);
    }
    const limited = await markRead(a, c.t, c.c, through);
    expect(limited).toMatchObject({ status: 429, code: "CHAT_RATE_LIMITED" });
    expect(await channels(a, c.t)).toMatchObject({ status: 429, code: "CHAT_RATE_LIMITED" });
  });
});

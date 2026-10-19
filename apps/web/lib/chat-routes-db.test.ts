/**
 * M10 chat REST routes against the real DB as the app role (readiness section 7). One describe per
 * route file; later route writers add their cases and reuse the helpers below.
 */
import { randomUUID } from "node:crypto";
import {
  createWebSession,
  deleteChatMessage,
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
import { GET as history } from "../app/api/chat/channels/[id]/messages/route";
import { decodeChatCursor, encodeChatCursor } from "./chat-route";
import { appDb, hashToken, resetDbRoleViolationForTests } from "./session-cookies";

const cookieJar = vi.hoisted(() => ({ token: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (cookieJar.token ? { value: cookieJar.token } : undefined),
  }),
}));

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
    const cases = [
      await get(stranger, c.t, c.c),
      await get(guest, c.t, c.c),
      await get(a, c.t, randomUUID()),
      await get(a, c.t, other.c),
      await get(a, c.t, dmId),
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
    expect(JSON.stringify(r.body)).not.toMatch(/deleted text|hidden text|authorPersonId/);
    const mine = (await get(a, c.t, c.c)).body.data.messages[0];
    expect(mine).toMatchObject({ id: hidden.id }); // newest first
    const first = (await get(a, c.t, c.c, "&limit=3")).body.data.messages[2];
    expect(first).toMatchObject({ id: live.id, mine: true, authorType: "person", editedAt: null });
    expect(new Date(first.createdAt).toISOString()).toBe(first.createdAt);
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
      expect(await get(a, c.t, c.c, `&limit=${bad}`)).toMatchObject({ status: 400 });
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

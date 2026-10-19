import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listChatChannels, type ChatChannelRow } from "./chat-channel-reads.js";
import { ChatCommandError, markChatRead, withChatActor } from "./chat-service.js";
import { hasLiveMembership } from "./session-join-service.js";
import { withTenant } from "./tenant.js";
import { setupRlsTestContext, type RlsTestContext } from "./test-harness.js";

// RO-L15-2 addition 2, readiness 7 R1-R4: listChatChannels as the real app role through withChatActor, beside the
// D-19 hasLiveMembership pre-gate. Members come from the provisioning trigger (default channel) or owner rows (extra
// channels); messages and tombstones are owner rows with explicit created_at, so their order is fixed; no definer
// role is named, so no definer lock (test-harness.ts:701-703).
const TEST_DB_NAME = "plexco_chat_channel_reads";

type Club = { t: string; c: string; c2: string; arch: string; a: string; b: string };
let ctx: RlsTestContext;
let f: Club; // the club under test
let g: Club; // a foreign tenant
let outsider: string; // no membership anywhere
let guest: string; // a guest membership in f (provisions no chat row)
let dm: string; // a dm of f.a and f.b
let sys: string; // f.c2's system row (second oldest)
let last: string; // f.c2's newest row (f.b)

const q = async (text: string, values: unknown[] = []): Promise<Record<string, unknown>[]> =>
  (await ctx.owner.query(text, values)).rows as Record<string, unknown>[];
const id = async (text: string, values: unknown[] = []): Promise<string> =>
  (await q(text, values))[0]!.id as string;
const person = () =>
  id(`INSERT INTO persons (display_name) VALUES ('chat-channel-reads') RETURNING id`);
const join = (t: string, p: string, status = "active") =>
  id(`INSERT INTO memberships (tenant_id, person_id, status) VALUES ($1, $2, $3) RETURNING id`, [
    t,
    p,
    status,
  ]);
const channel = (t: string, sort: number) =>
  id(
    `INSERT INTO chat_channels (tenant_id, kind, title, is_default, sort_order, creation_origin, post_policy,
       assistant_enabled) VALUES ($1, 'club', 'extra', false, $2, 'system_bootstrap', 'all_members', false)
     RETURNING id`,
    [t, sort],
  );
/** Members first (the trigger provisions the default channel), then two extra channels with owner rows; arch archived. */
async function club(): Promise<Club> {
  const t = await id(
    `INSERT INTO tenants (name, slug, status) VALUES ('chat-channel-reads', $1, 'active') RETURNING id`,
    [`ccr-${randomUUID().slice(0, 8)}`],
  );
  // withChatActor's authorizeTenantAction needs an active subscription (chat-service.test.ts fixture)
  await q(
    `INSERT INTO subscriptions (tenant_id, plan_key, plan_version, status, period_start, period_end)
       VALUES ($1, 'free', 1, 'active', now(), now() + interval '30 days')`,
    [t],
  );
  const [a, b] = [await person(), await person()];
  for (const p of [a, b]) await join(t, p);
  const c = await id(`SELECT id FROM chat_channels WHERE tenant_id = $1 AND is_default`, [t]);
  const [c2, arch] = [await channel(t, 10), await channel(t, 20)];
  for (const ch of [c2, arch])
    for (const p of [a, b])
      await q(
        `INSERT INTO chat_members (channel_id, person_id, membership_id)
         SELECT $1::uuid, $2::uuid, id FROM memberships WHERE tenant_id = $3 AND person_id = $2::uuid`,
        [ch, p, t],
      );
  await q(`UPDATE chat_channels SET archived_at = now() WHERE id = $1`, [arch]);
  return { t, c, c2, arch, a, b };
}
/** One owner row at base + n seconds; p null = a system row. */
const post = (ch: string, p: string | null, n: number) =>
  id(
    `INSERT INTO chat_messages (channel_id, author_type, author_person_id, membership_id, body, client_msg_id,
       created_at)
     SELECT $1::uuid, CASE WHEN $2::uuid IS NULL THEN 'system' ELSE 'person' END, $2::uuid,
       (SELECT m.id FROM memberships m JOIN chat_channels c ON c.tenant_id = m.tenant_id
         WHERE c.id = $1::uuid AND m.person_id = $2::uuid),
       'x', gen_random_uuid()::text, timestamptz '2026-01-01 00:00:00+00' + $3::int * interval '1 second'
     RETURNING id`,
    [ch, p, n],
  );

beforeAll(async () => {
  ctx = await setupRlsTestContext(TEST_DB_NAME);
  [f, g] = [await club(), await club()];
  [outsider, guest] = [await person(), await person()];
  await join(f.t, guest, "guest");
  await ctx.owner.query("BEGIN"); // a dm's channel and members commit together (chat-read.test.ts seedDm)
  dm = await id(`INSERT INTO chat_channels (kind, dm_key) VALUES ('dm', $1) RETURNING id`, [
    [f.a, f.b].sort().join(":"),
  ]);
  await q(`INSERT INTO chat_members (channel_id, person_id) VALUES ($1, $2), ($1, $3)`, [
    dm,
    f.a,
    f.b,
  ]);
  await ctx.owner.query("COMMIT");
  await post(f.c2, f.a, 1); // the caller's own row: never in f.a's count
  sys = await post(f.c2, null, 2);
  const del = await post(f.c2, f.b, 3);
  const hid = await post(f.c2, f.b, 4);
  last = await post(f.c2, f.b, 5);
  await q(`UPDATE chat_messages SET author_deleted_at = now() WHERE id = $1`, [del]);
  await q(
    `UPDATE chat_messages SET moderation_state = 'hidden', moderation_updated_at = now(),
       moderation_actor_person_id = $2, moderation_reason_code = 'spam' WHERE id = $1`,
    [hid, f.a],
  );
  // 101 rows of f.b in the default channel by one owner INSERT: f.a's count caps at 100
  await q(
    `INSERT INTO chat_messages (channel_id, author_person_id, membership_id, body, client_msg_id)
     SELECT $1::uuid, $2::uuid, (SELECT id FROM memberships WHERE tenant_id = $3 AND person_id = $2::uuid),
            'x', gen_random_uuid()::text
       FROM generate_series(1, 101)`,
    [f.c, f.b, f.t],
  );
}, 180_000);

afterAll(async () => {
  await ctx?.teardown();
});

const list = (t: string, p: string): Promise<ChatChannelRow[]> =>
  withChatActor(ctx.appDb.db, { tenantId: t, personId: p }, listChatChannels);
const counts = async (t: string, p: string): Promise<Record<string, number>> =>
  Object.fromEntries((await list(t, p)).map((r) => [r.id, r.unreadCount]));
const mark = (p: string, throughMessageId: string) =>
  withChatActor(ctx.appDb.db, { tenantId: f.t, personId: p }, (tx) =>
    markChatRead(tx, { channelId: f.c2, throughMessageId }),
  );

describe("listChatChannels (RO-L15-2 addition 2, readiness 7 R1-R4)", () => {
  // measured: the D-19 pre-gate passes a guest (a live membership), so for a guest the reader's D-23 zero rows deny
  it("R1 a non-member, a guest and a cross-tenant ?tenant= are denied by the reader with the one CHAT_FORBIDDEN", async () => {
    const denials: unknown[] = [];
    for (const [t, p, preGate] of [
      [f.t, outsider, false],
      [f.t, guest, true],
      [g.t, f.a, false],
    ] as const) {
      expect(await withTenant(ctx.appDb.db, t, (tx) => hasLiveMembership(tx, t, p))).toBe(preGate);
      denials.push(
        await list(t, p).then(
          () => "OK",
          (e: ChatCommandError) => [e.name, e.code, e.status, e.message],
        ),
      );
    }
    expect(denials).toEqual(
      Array(3).fill(["ChatCommandError", "CHAT_FORBIDDEN", 403, "CHAT_FORBIDDEN"]),
    );
  });

  it("R2 only the tenant's club, non-archived channels, in (sortOrder, id) order, with exactly the allowlisted keys", async () => {
    const rows = await list(f.t, f.a);
    expect(new Set(rows.map((r) => r.id))).toEqual(new Set([f.c, f.c2]));
    expect(rows.map((r) => r.id)).toEqual(
      [...rows]
        .sort((x, y) => x.sortOrder - y.sortOrder || (x.id < y.id ? -1 : 1))
        .map((r) => r.id),
    );
    for (const r of rows)
      expect(Object.keys(r).sort()).toEqual([
        "id",
        "isDefault",
        "postPolicy",
        "sortOrder",
        "title",
        "unreadCount",
      ]);
    // the archived channel is readable under RLS, so the reader's own filter drops it; the dm is listed by neither
    const visible = await withChatActor(
      ctx.appDb.db,
      { tenantId: f.t, personId: f.a },
      async (tx) =>
        (
          await tx.execute(sql`SELECT id FROM chat_channels WHERE id IN (${f.arch}, ${dm})`)
        ).rows.map((r) => r.id),
    );
    expect(visible).toEqual([f.arch]);
  });

  it("R3 unread: own rows excluded, system rows and tombstones counted, a NULL cursor counts from the start, capped at 100", async () => {
    expect(
      await q(
        `SELECT last_read_created_at, last_read_message_id FROM chat_members
          WHERE channel_id = $1 AND person_id = $2`,
        [f.c2, f.a],
      ),
    ).toEqual([{ last_read_created_at: null, last_read_message_id: null }]);
    expect(await counts(f.t, f.a)).toEqual({ [f.c]: 100, [f.c2]: 4 });
    expect((await counts(f.t, f.b))[f.c2]).toBe(2); // f.a's row + the system row; f.b's three rows are its own
  });

  it("R4 another member's read cursor never changes the caller's count; only the caller's own mark_read lowers it", async () => {
    await mark(f.b, last);
    expect((await counts(f.t, f.b))[f.c2]).toBe(0);
    expect((await counts(f.t, f.a))[f.c2]).toBe(4);
    await mark(f.a, sys);
    expect((await counts(f.t, f.a))[f.c2]).toBe(3); // the two tombstones and the newest row
    expect((await counts(f.t, f.b))[f.c2]).toBe(0);
  });

  // SEC-2 NIT-2: a leave leaves chat_members untouched and a guest re-entry is a NEW row (0058:68-80) that the
  // activation-only trigger (0063:629-632) never re-points, so x's rows still name the 'left' membership; RLS
  // (chat_current_is_member, 0031:280-292: an active membership only) hides them, so the reader's zero rows deny
  it("R5 a former member who left and came back as a guest is denied with the one CHAT_FORBIDDEN", async () => {
    const x = await person(); // posts nothing, so R2-R4 counts are untouched
    const m1 = await join(f.t, x);
    await q(`UPDATE memberships SET status = 'left' WHERE id = $1`, [m1]);
    await join(f.t, x, "guest");
    expect(
      await q(`SELECT membership_id FROM chat_members WHERE channel_id = $1 AND person_id = $2`, [
        f.c,
        x,
      ]),
    ).toEqual([{ membership_id: m1 }]);
    expect(await withTenant(ctx.appDb.db, f.t, (tx) => hasLiveMembership(tx, f.t, x))).toBe(true);
    expect(
      await list(f.t, x).then(
        () => "OK",
        (e: ChatCommandError) => [e.name, e.code, e.status, e.message],
      ),
    ).toEqual(["ChatCommandError", "CHAT_FORBIDDEN", 403, "CHAT_FORBIDDEN"]);
  });
});

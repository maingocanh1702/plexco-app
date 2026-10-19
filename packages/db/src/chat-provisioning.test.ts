import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupRlsTestContext, type RlsTestContext } from "./test-harness.js";

// 0063 provisioning (readiness 4.1 V-14..V-17): DT-22, DT-23, DT-34 and the re-point half of DT-33 on the real DB.
// Each case commits where it asserts persistence: the deferred trg_chat_dm_two_* triggers fire at commit.
const TEST_DB_NAME = "plexco_chat_provisioning";
const DEFAULT_CHANNEL = {
  kind: "club",
  title: "Kênh chung",
  is_default: true,
  sort_order: 0,
  post_policy: "all_members",
  creation_origin: "system_bootstrap",
  assistant_enabled: false,
  created_by_membership_id: null,
  created_by_person_id: null,
  archived_at: null,
};

let ctx: RlsTestContext;

beforeAll(async () => {
  ctx = await setupRlsTestContext(TEST_DB_NAME);
}, 180_000);

afterAll(async () => {
  await ctx?.teardown();
});

async function rows<T = Record<string, unknown>>(
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  return (await ctx.owner.query(text, values)).rows as T[];
}
const id = async (text: string, values: unknown[]): Promise<string> =>
  ((await rows(text, values))[0] as { id: string }).id;
const tenant = (): Promise<string> =>
  id(
    `INSERT INTO tenants (name, slug, status) VALUES ('provisioning', $1, 'active') RETURNING id`,
    [`prov-${randomUUID().slice(0, 8)}`],
  );
const person = (): Promise<string> =>
  id(`INSERT INTO persons (display_name) VALUES ('provisioning') RETURNING id`, []);
const membership = (tenantId: string, personId: string, status = "active"): Promise<string> =>
  id(`INSERT INTO memberships (tenant_id, person_id, status) VALUES ($1, $2, $3) RETURNING id`, [
    tenantId,
    personId,
    status,
  ]);
const channels = (tenantId: string) =>
  rows<{ id: string }>(
    `SELECT id, kind, title, is_default, sort_order, post_policy, creation_origin, assistant_enabled,
            created_by_membership_id, created_by_person_id, archived_at
       FROM chat_channels WHERE tenant_id = $1 ORDER BY created_at, id`,
    [tenantId],
  );
const chatRows = (personId: string) =>
  rows(
    `SELECT channel_id, membership_id, role, joined_at, last_read_created_at, last_read_message_id
       FROM chat_members WHERE person_id = $1 ORDER BY channel_id`,
    [personId],
  );
// The channel count and every chat_members row version: equal snapshots mean nothing was written.
const snapshot = async () =>
  (
    await rows(
      `SELECT (SELECT count(*)::int FROM chat_channels) AS channels,
              (SELECT json_agg(json_build_array(channel_id, person_id, membership_id, xmin::text)
                        ORDER BY channel_id, person_id) FROM chat_members) AS members`,
    )
  )[0];

// chat_current_is_member as the real app role, with the GUCs withChatActor sets (V-7).
async function isMember(tenantId: string, personId: string, channelId: string): Promise<boolean> {
  const client = await ctx.appPool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT set_config('app.tenant_id', $1, true), set_config('app.person_id', $2, true)`,
      [tenantId, personId],
    );
    const result = await client.query(`SELECT chat_current_is_member($1) AS m`, [channelId]);
    return (result.rows[0] as { m: boolean }).m;
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

describe("0063 chat provisioning on membership activation", () => {
  it("DT-22 an active membership provisions one default channel and one row; a second member adds one row; a guest and a rolled-back activation provision nothing", async () => {
    const t = await tenant();
    const p1 = await person();
    const m1 = await membership(t, p1);
    const [channel, ...extra] = await channels(t);
    expect(channel).toEqual({ id: expect.any(String), ...DEFAULT_CHANNEL });
    expect(extra).toEqual([]);
    expect(await chatRows(p1)).toMatchObject([
      { channel_id: channel?.id, membership_id: m1, role: "member" },
    ]);

    const p2 = await person();
    const m2 = await membership(t, p2);
    expect(await channels(t)).toHaveLength(1);
    expect(await chatRows(p2)).toMatchObject([{ channel_id: channel?.id, membership_id: m2 }]);

    const guest = await person();
    await membership(t, guest, "guest");
    expect(await chatRows(guest)).toEqual([]);

    const t2 = await tenant();
    const p3 = await person();
    await ctx.owner.query("BEGIN");
    try {
      await membership(t2, p3);
      expect(await chatRows(p3)).toHaveLength(1); // provisioned inside the activation's transaction
    } finally {
      await ctx.owner.query("ROLLBACK");
    }
    expect(await channels(t2)).toEqual([]);
    expect(await chatRows(p3)).toEqual([]);
  });

  it("DT-23 the backfill provisions pre-0063 active memberships once, none for guests, and a second run writes nothing", async () => {
    const t = await tenant();
    const guestOnly = await tenant();
    const [pa, pb, pg1, pg2] = [await person(), await person(), await person(), await person()];
    const seeded: string[] = [];
    await ctx.owner.query("BEGIN");
    try {
      // the state 0063 finds: memberships without any chat row
      await ctx.owner.query(
        `ALTER TABLE memberships DISABLE TRIGGER trg_memberships_chat_provision`,
      );
      seeded.push(await membership(t, pa), await membership(t, pb));
      await membership(t, pg1, "guest");
      await membership(guestOnly, pg2, "guest");
      await ctx.owner.query(
        `ALTER TABLE memberships ENABLE TRIGGER trg_memberships_chat_provision`,
      );
      await ctx.owner.query("COMMIT");
    } catch (error) {
      await ctx.owner.query("ROLLBACK");
      throw error;
    }
    expect(await channels(t)).toEqual([]);

    const [{ n: active }] = (await rows(
      `SELECT count(*)::int AS n FROM memberships WHERE status = 'active'`,
    )) as [{ n: number }];
    const backfill = async () =>
      ((await rows(`SELECT chat_backfill_default_channels() AS n`))[0] as { n: number }).n;
    expect(await backfill()).toBe(active);
    const [channel, ...extra] = await channels(t);
    expect(channel).toEqual({ id: expect.any(String), ...DEFAULT_CHANNEL });
    expect(extra).toEqual([]);
    expect(await channels(guestOnly)).toEqual([]);
    expect(await chatRows(pa)).toMatchObject([
      { channel_id: channel?.id, membership_id: seeded[0] },
    ]);
    expect(await chatRows(pb)).toMatchObject([
      { channel_id: channel?.id, membership_id: seeded[1] },
    ]);
    expect([...(await chatRows(pg1)), ...(await chatRows(pg2))]).toEqual([]);

    const before = await snapshot();
    expect(await backfill()).toBe(active);
    expect(await snapshot()).toEqual(before);
  });

  it("DT-34 an UPDATE OF status that leaves a membership active and a re-run of the core write nothing", async () => {
    const t = await tenant();
    const p = await person();
    const m = await membership(t, p);
    const before = await snapshot();
    await ctx.owner.query(`UPDATE memberships SET status = 'active' WHERE id = $1`, [m]);
    await ctx.owner.query(`SELECT chat_provision_member($1, $2, $3)`, [t, p, m]);
    expect(await snapshot()).toEqual(before);
  });

  it("DT-33 a re-join re-points the same chat_members row and keeps its cursor; the left membership grants nothing", async () => {
    const t = await tenant();
    const p = await person();
    const left = await membership(t, p);
    const channelId = (await channels(t))[0]?.id as string;
    const message = await id(
      `INSERT INTO chat_messages (channel_id, author_person_id, membership_id, body, client_msg_id)
       VALUES ($1, $2, $3, 'x', $4) RETURNING id`,
      [channelId, p, left, randomUUID()],
    );
    await ctx.owner.query(
      `UPDATE chat_members cm SET last_read_created_at = m.created_at, last_read_message_id = m.id
         FROM chat_messages m WHERE m.id = $1 AND cm.channel_id = m.channel_id AND cm.person_id = $2`,
      [message, p],
    );
    const [before] = await chatRows(p);
    expect(before).toMatchObject({ membership_id: left, last_read_message_id: message });

    await ctx.owner.query(`UPDATE memberships SET status = 'left' WHERE id = $1`, [left]);
    expect(await isMember(t, p, channelId)).toBe(false);

    const rejoined = await membership(t, p);
    expect(await chatRows(p)).toEqual([{ ...before, membership_id: rejoined }]);
    expect(await rows(`SELECT 1 FROM chat_members WHERE membership_id = $1`, [left])).toEqual([]);
    expect(await isMember(t, p, channelId)).toBe(true);
  });
});

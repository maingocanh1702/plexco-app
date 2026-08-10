import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chatChannels, chatMembers, chatMessages } from "../schema.js";
import type { Db } from "./client.js";
import {
  expectErrorChainToMatch,
  setupRlsTestContext,
  type RlsTestContext,
} from "./test-harness.js";

/**
 * dd38-dd86-chat-schema-core (migration 0031) invariants: chat_channels /
 * chat_members / chat_messages final shape, DM exactly-2-members guards, the
 * pure DM read adapter (dm_current_read_allowed) and RLS isolation —
 * cross-tenant, cross-channel and cross-person (DM). Full acceptance matrix:
 * docs/autopilot/contracts/autopilot-dd38-dd86-chat-schema-core.md SS8.
 *
 * app.person_id is the FIRST person-scoped RLS GUC in this codebase (every
 * prior policy is tenant-scoped only via app.tenant_id, 0009). There is no
 * shared `withPerson` helper (tenant.ts) — the local withChatPerson below
 * sets it inline, mirroring withTenant's own set_config idiom exactly, per
 * this slice's own budget exception (migration + schema mirror + this one
 * focused test file, no 4th module).
 */

const TEST_DB_NAME = "plexco_chat_schema_check";

let ctx: RlsTestContext;

beforeAll(async () => {
  ctx = await setupRlsTestContext(TEST_DB_NAME);
  // dm_safety_enabled() is the AND of four independent toggles, seeded all-false
  // (chat-dm-safety-authority-core's own enablement-gate design) — DM reads would
  // be denied by default. Enable for the suite; the "safety gate" describe block
  // below disables/restores one toggle in isolation to prove the fail-closed path.
  await ctx.owner.query(
    `UPDATE chat_dm_safety_config SET
       block_enabled = true, report_enabled = true, rate_limit_enabled = true, audit_enabled = true`,
  );
}, 120_000);

afterAll(async () => {
  await ctx?.teardown();
});

// ---------------------------------------------------------------------------
// Fixture helpers — direct SQL via the superuser/owner connection (bypasses
// RLS), exactly like chat-dm-safety-invariants.test.ts's own sibling helpers:
// this slice owns no write RPC yet, so seeding is unavoidably direct.
// ---------------------------------------------------------------------------

async function seedPerson(name: string): Promise<string> {
  const { rows } = await ctx.owner.query(
    `INSERT INTO persons (display_name) VALUES ($1) RETURNING id`,
    [name],
  );
  return (rows[0] as { id: string }).id;
}

async function seedMembership(tenantId: string, personId: string): Promise<string> {
  const { rows } = await ctx.owner.query(
    `INSERT INTO memberships (tenant_id, person_id, status) VALUES ($1, $2, 'active') RETURNING id`,
    [tenantId, personId],
  );
  return (rows[0] as { id: string }).id;
}

async function seedClubChannel(
  tenantId: string,
  opts: { isDefault?: boolean; sortOrder?: number; title?: string } = {},
): Promise<string> {
  const { rows } = await ctx.owner.query(
    `INSERT INTO chat_channels
       (tenant_id, kind, title, is_default, sort_order, creation_origin, post_policy, assistant_enabled)
     VALUES ($1, 'club', $2, $3, $4, 'system_bootstrap', 'all_members', false)
     RETURNING id`,
    [tenantId, opts.title ?? "General", opts.isDefault ?? true, opts.sortOrder ?? 0],
  );
  return (rows[0] as { id: string }).id;
}

async function addClubMember(
  channelId: string,
  personId: string,
  membershipId: string,
  role: "member" | "admin" = "member",
): Promise<void> {
  await ctx.owner.query(
    `INSERT INTO chat_members (channel_id, person_id, membership_id, role) VALUES ($1, $2, $3, $4)`,
    [channelId, personId, membershipId, role],
  );
}

/** dm_key must equal the two person ids sorted ascending, matching chat_assert_dm_two's
 *  own `string_agg(person_id::text, ':' ORDER BY person_id)` — canonical lowercase
 *  hex-with-dashes uuid text compares in the same order Postgres sorts the uuid type. */
function dmKeyFor(personA: string, personB: string): string {
  const [a, b] = [personA, personB].sort();
  return `${a}:${b}`;
}

/** Channel + both members MUST commit in one transaction: chat_assert_dm_two's deferred constraint
 *  triggers (trg_chat_dm_two_channel/trg_chat_dm_two_members) re-check "exactly 2 members" at COMMIT
 *  of whichever transaction touched the channel or its members — a dm channel can never durably rest
 *  at 0 or 1 member between separate autocommit statements. */
async function seedDmChannel(
  personA: string,
  personB: string,
): Promise<{ channelId: string; dmKey: string }> {
  const dmKey = dmKeyFor(personA, personB);
  await ctx.owner.query("BEGIN");
  try {
    const { rows } = await ctx.owner.query(
      `INSERT INTO chat_channels (kind, dm_key) VALUES ('dm', $1) RETURNING id`,
      [dmKey],
    );
    const channelId = (rows[0] as { id: string }).id;
    await ctx.owner.query(
      `INSERT INTO chat_members (channel_id, person_id) VALUES ($1, $2), ($1, $3)`,
      [channelId, personA, personB],
    );
    await ctx.owner.query("COMMIT");
    return { channelId, dmKey };
  } catch (error) {
    await ctx.owner.query("ROLLBACK");
    throw error;
  }
}

async function seedClubMessage(
  channelId: string,
  authorPersonId: string,
  membershipId: string,
  body: string,
): Promise<string> {
  const { rows } = await ctx.owner.query(
    `INSERT INTO chat_messages (channel_id, author_person_id, membership_id, body, client_msg_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [channelId, authorPersonId, membershipId, body, `seed-${randomUUID()}`],
  );
  return (rows[0] as { id: string }).id;
}

async function seedDmMessage(
  channelId: string,
  authorPersonId: string,
  body: string,
): Promise<string> {
  const { rows } = await ctx.owner.query(
    `INSERT INTO chat_messages (channel_id, author_person_id, body, client_msg_id)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [channelId, authorPersonId, body, `seed-${randomUUID()}`],
  );
  return (rows[0] as { id: string }).id;
}

/** Local app.person_id (+ optional app.tenant_id) setter, mirroring withTenant's
 *  own set_config('app.tenant_id', ..., true) idiom exactly (tenant.ts) — deliberately
 *  NOT exported/added there, see this file's own header comment. */
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

async function withChatPerson<T>(
  db: Db,
  personId: string | null,
  tenantId: string | null,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    if (personId) {
      await tx.execute(sql`SELECT set_config('app.person_id', ${personId}, true)`);
    }
    if (tenantId) {
      await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    }
    return fn(tx);
  });
}

// ---------------------------------------------------------------------------
// Shared fixtures, created once (read-only tests below all reuse these).
// ---------------------------------------------------------------------------

let personA1: string; // member of channelClubA (tenant A default club channel)
let membershipA1: string;
let personA2: string; // member of channelClubA2 (tenant A second, non-default channel) only
let membershipA2: string;
let personA3: string; // has a tenant A membership, but never added to any chat_members row
let personB1: string; // member of channelClubB (tenant B's channel)
let membershipB1: string;
let personDm1: string;
let personDm2: string;
let personDm3: string; // not part of the DM

let channelClubA: string;
let channelClubA2: string;
let channelEmptyA: string;
let channelClubB: string;
let channelDm: string;

let messageClubA1: string;
let messageDm1: string;

beforeAll(async () => {
  personA1 = await seedPerson("Chat Schema A1");
  membershipA1 = await seedMembership(ctx.tenantA, personA1);
  personA2 = await seedPerson("Chat Schema A2");
  membershipA2 = await seedMembership(ctx.tenantA, personA2);
  personA3 = await seedPerson("Chat Schema A3 (no chat membership)");
  await seedMembership(ctx.tenantA, personA3);
  personB1 = await seedPerson("Chat Schema B1");
  membershipB1 = await seedMembership(ctx.tenantB, personB1);
  personDm1 = await seedPerson("Chat Schema DM1");
  personDm2 = await seedPerson("Chat Schema DM2");
  personDm3 = await seedPerson("Chat Schema DM3 (not in the dm)");

  channelClubA = await seedClubChannel(ctx.tenantA, {
    isDefault: true,
    sortOrder: 0,
    title: "General A",
  });
  await addClubMember(channelClubA, personA1, membershipA1);
  channelClubA2 = await seedClubChannel(ctx.tenantA, {
    isDefault: false,
    sortOrder: 1,
    title: "Second A",
  });
  await addClubMember(channelClubA2, personA2, membershipA2);
  channelEmptyA = await seedClubChannel(ctx.tenantA, {
    isDefault: false,
    sortOrder: 2,
    title: "Empty A",
  });
  await addClubMember(channelEmptyA, personA1, membershipA1);
  channelClubB = await seedClubChannel(ctx.tenantB, {
    isDefault: true,
    sortOrder: 0,
    title: "General B",
  });
  await addClubMember(channelClubB, personB1, membershipB1);

  ({ channelId: channelDm } = await seedDmChannel(personDm1, personDm2));

  messageClubA1 = await seedClubMessage(channelClubA, personA1, membershipA1, "hello club A");
  messageDm1 = await seedDmMessage(channelDm, personDm1, "hello dm");
}, 60_000);

// ---------------------------------------------------------------------------

describe("happy path", () => {
  it("club member reads own tenant's channel and messages", async () => {
    const channels = await withChatPerson(ctx.appDb.db, personA1, ctx.tenantA, (tx) =>
      tx.select().from(chatChannels).where(eq(chatChannels.id, channelClubA)),
    );
    expect(channels.map((c) => c.id)).toEqual([channelClubA]);

    const messages = await withChatPerson(ctx.appDb.db, personA1, ctx.tenantA, (tx) =>
      tx.select().from(chatMessages).where(eq(chatMessages.channelId, channelClubA)),
    );
    expect(messages.map((m) => m.id)).toEqual([messageClubA1]);
  });

  it("DM participant reads own DM channel and messages", async () => {
    const channels = await withChatPerson(ctx.appDb.db, personDm1, null, (tx) =>
      tx.select().from(chatChannels).where(eq(chatChannels.id, channelDm)),
    );
    expect(channels.map((c) => c.id)).toEqual([channelDm]);

    const messages = await withChatPerson(ctx.appDb.db, personDm2, null, (tx) =>
      tx.select().from(chatMessages).where(eq(chatMessages.channelId, channelDm)),
    );
    expect(messages.map((m) => m.id)).toEqual([messageDm1]);
  });
});

describe("boundary rows", () => {
  it("empty channel with no messages returns an empty result, no error", async () => {
    const messages = await withChatPerson(ctx.appDb.db, personA1, ctx.tenantA, (tx) =>
      tx.select().from(chatMessages).where(eq(chatMessages.channelId, channelEmptyA)),
    );
    expect(messages).toEqual([]);
  });

  it("a dm channel with every club-only field NULL succeeds (shape CHECK's dm branch)", async () => {
    const personX = await seedPerson("Boundary DM X");
    const personY = await seedPerson("Boundary DM Y");
    // Both members must land in the same transaction as the channel — see seedDmChannel's own
    // comment: the deferred exactly-2-members trigger re-checks at COMMIT, so a channel-only insert
    // would fail for an unrelated reason (0 members) before this shape assertion is even reached.
    const { channelId } = await seedDmChannel(personX, personY);
    const { rows } = await ctx.owner.query(
      `SELECT tenant_id, title, is_default, sort_order, created_by_membership_id,
              created_by_person_id, creation_origin, post_policy, assistant_enabled
       FROM chat_channels WHERE id = $1`,
      [channelId],
    );
    expect(rows[0]).toEqual({
      tenant_id: null,
      title: null,
      is_default: null,
      sort_order: null,
      created_by_membership_id: null,
      created_by_person_id: null,
      creation_origin: null,
      post_policy: null,
      assistant_enabled: null,
    });
  });

  it("a club channel with title NULL is rejected by the shape CHECK", async () => {
    await expect(
      ctx.owner.query(
        `INSERT INTO chat_channels
           (tenant_id, kind, title, is_default, sort_order, creation_origin, post_policy, assistant_enabled)
         VALUES ($1, 'club', NULL, true, 99, 'system_bootstrap', 'all_members', false)`,
        [ctx.tenantA],
      ),
    ).rejects.toThrow(/violates check constraint "chat_channels_shape_chk"/);
  });

  it("a club channel with creation_origin NULL is rejected by the shape CHECK (codex round-01 P2: a plain IN (...) passes on NULL/UNKNOWN unless explicitly guarded)", async () => {
    await expect(
      ctx.owner.query(
        `INSERT INTO chat_channels
           (tenant_id, kind, title, is_default, sort_order, creation_origin, post_policy, assistant_enabled)
         VALUES ($1, 'club', 'Regression Null Origin', true, 100, NULL, 'all_members', false)`,
        [ctx.tenantA],
      ),
    ).rejects.toThrow(/violates check constraint "chat_channels_shape_chk"/);
  });

  it("a club channel with post_policy NULL is rejected by the shape CHECK", async () => {
    await expect(
      ctx.owner.query(
        `INSERT INTO chat_channels
           (tenant_id, kind, title, is_default, sort_order, creation_origin, post_policy, assistant_enabled)
         VALUES ($1, 'club', 'Regression Null Policy', true, 101, 'system_bootstrap', NULL, false)`,
        [ctx.tenantA],
      ),
    ).rejects.toThrow(/violates check constraint "chat_channels_shape_chk"/);
  });
});

describe("authorization — club channels", () => {
  it("a person with no chat_members row in their own tenant sees zero rows", async () => {
    const channels = await withChatPerson(ctx.appDb.db, personA3, ctx.tenantA, (tx) =>
      tx.select().from(chatChannels).where(eq(chatChannels.id, channelClubA)),
    );
    expect(channels).toEqual([]);
  });

  it("member of channel X (same tenant) sees zero rows for channel Y they do not belong to", async () => {
    const channels = await withChatPerson(ctx.appDb.db, personA2, ctx.tenantA, (tx) =>
      tx.select().from(chatChannels).where(eq(chatChannels.id, channelClubA)),
    );
    expect(channels).toEqual([]);
    const members = await withChatPerson(ctx.appDb.db, personA2, ctx.tenantA, (tx) =>
      tx.select().from(chatMembers).where(eq(chatMembers.channelId, channelClubA)),
    );
    expect(members).toEqual([]);
  });

  it("cross-tenant: app.tenant_id=B against tenant A's channel/members/messages is zero rows even for a person who IS a legitimate member of the target channel (round-06 P1: personB1 was never a channelClubA member, so the original test would pass even with the tenant_id check removed — personA1 isolates the tenant boundary specifically from the membership check)", async () => {
    const channels = await withChatPerson(ctx.appDb.db, personA1, ctx.tenantB, (tx) =>
      tx.select().from(chatChannels).where(eq(chatChannels.id, channelClubA)),
    );
    expect(channels).toEqual([]);
    const members = await withChatPerson(ctx.appDb.db, personA1, ctx.tenantB, (tx) =>
      tx.select().from(chatMembers).where(eq(chatMembers.channelId, channelClubA)),
    );
    expect(members).toEqual([]);
    const messages = await withChatPerson(ctx.appDb.db, personA1, ctx.tenantB, (tx) =>
      tx.select().from(chatMessages).where(eq(chatMessages.id, messageClubA1)),
    );
    expect(messages).toEqual([]);
  });
});

describe("authorization — dm channels", () => {
  it("a third person (not one of the 2 dm participants) reads zero rows for the dm channel/members/messages", async () => {
    const channels = await withChatPerson(ctx.appDb.db, personDm3, null, (tx) =>
      tx.select().from(chatChannels).where(eq(chatChannels.id, channelDm)),
    );
    expect(channels).toEqual([]);
    const members = await withChatPerson(ctx.appDb.db, personDm3, null, (tx) =>
      tx.select().from(chatMembers).where(eq(chatMembers.channelId, channelDm)),
    );
    expect(members).toEqual([]);
    const messages = await withChatPerson(ctx.appDb.db, personDm3, null, (tx) =>
      tx.select().from(chatMessages).where(eq(chatMessages.id, messageDm1)),
    );
    expect(messages).toEqual([]);
  });
});

describe("write boundary — app is read-only", () => {
  it("app-role direct INSERT/UPDATE/DELETE on any of the three tables is rejected — permission denied (REVOKE)", async () => {
    await expect(
      ctx.appPool.query(`INSERT INTO chat_channels (kind, dm_key) VALUES ('dm', $1)`, [
        dmKeyFor(randomUUID(), randomUUID()),
      ]),
    ).rejects.toThrow(/permission denied for table chat_channels/);
    await expect(
      ctx.appPool.query(`UPDATE chat_members SET role = 'admin' WHERE channel_id = $1`, [
        channelClubA,
      ]),
    ).rejects.toThrow(/permission denied for table chat_members/);
    await expect(
      ctx.appPool.query(`DELETE FROM chat_messages WHERE id = $1`, [messageClubA1]),
    ).rejects.toThrow(/permission denied for table chat_messages/);
  });

  it("app-role INSERT with author_person_id != current app.person_id is rejected by WITH CHECK, isolated from the coarser REVOKE", async () => {
    // app currently has zero INSERT grant on these tables (mutation has no owner yet — see negative
    // scope), so an ordinary app-role INSERT always fails at the ACL layer before RLS is even
    // evaluated. To prove the WITH CHECK impersonation guard itself (a DIFFERENT mechanism from the
    // REVOKE proven above), temporarily grant INSERT for the duration of this one test only, then
    // revoke it back — this throwaway per-file database is recreated from scratch on every run
    // regardless, so a failed revoke cannot leak into any other suite.
    await ctx.owner.query(`GRANT INSERT ON chat_channels, chat_members, chat_messages TO app`);
    try {
      await expectErrorChainToMatch(
        withChatPerson(ctx.appDb.db, personA1, ctx.tenantA, (tx) =>
          tx.insert(chatMessages).values({
            channelId: channelClubA,
            authorPersonId: personA2, // impersonation attempt: != current_setting('app.person_id')
            membershipId: membershipA1,
            body: "impersonation attempt",
            clientMsgId: `wc-${randomUUID()}`,
          }),
        ),
        /row-level security/i,
      );
    } finally {
      await ctx.owner.query(`REVOKE INSERT ON chat_channels, chat_members, chat_messages FROM app`);
    }
  });
});

describe("dm safety gate", () => {
  it("dm_safety_enabled()=false denies the DM read (dm_current_read_allowed=false), no error, no bypass", async () => {
    await ctx.owner.query(`UPDATE chat_dm_safety_config SET rate_limit_enabled = false`);
    try {
      const { rows } = await ctx.owner.query(`SELECT dm_safety_enabled() AS v`);
      expect((rows[0] as { v: boolean }).v).toBe(false);

      const channels = await withChatPerson(ctx.appDb.db, personDm1, null, (tx) =>
        tx.select().from(chatChannels).where(eq(chatChannels.id, channelDm)),
      );
      expect(channels).toEqual([]);
    } finally {
      await ctx.owner.query(`UPDATE chat_dm_safety_config SET rate_limit_enabled = true`);
    }
  });
});

describe("fail-closed without GUC context (mirrors BL-TEN-1 for the person axis)", () => {
  it("app-role reads OUTSIDE any transaction (no GUC set) return 0 rows, not an error", async () => {
    const { rows: channelRows } = await ctx.appPool.query(`SELECT id FROM chat_channels`);
    expect(channelRows).toEqual([]);
    const { rows: memberRows } = await ctx.appPool.query(`SELECT channel_id FROM chat_members`);
    expect(memberRows).toEqual([]);
    const { rows: messageRows } = await ctx.appPool.query(`SELECT id FROM chat_messages`);
    expect(messageRows).toEqual([]);
  });

  it("app.tenant_id set but app.person_id unset sees zero rows for a club channel", async () => {
    const channels = await withChatPerson(ctx.appDb.db, null, ctx.tenantA, (tx) =>
      tx.select().from(chatChannels).where(eq(chatChannels.id, channelClubA)),
    );
    expect(channels).toEqual([]);
  });
});

describe("concurrency", () => {
  it("two concurrent attempts to create the SAME new dm channel: exactly one wins, the other is rejected", async () => {
    // The deferred exactly-2-members trigger (see seedDmChannel's own comment) means a dm channel can
    // never durably rest at 1 member between transactions -- so "1 committed member, race the 2nd" is
    // not a constructible state. The real, achievable concurrency guarantee this schema provides is
    // atomic creation: two concurrent transactions each attempting the full
    // "insert channel + both members" sequence for the SAME dm_key (a realistic double-submit/retry)
    // race on chat_channels_dm_key_uq -- exactly one commits, the other is rejected and never leaves a
    // partial (0- or 1-member) row behind, proven by the final count assertion below.
    const raceA = await seedPerson("Race A");
    const raceB = await seedPerson("Race B");
    const dmKey = dmKeyFor(raceA, raceB);

    const [c1, c2] = await Promise.all([
      ctx.superuserDb.pool.connect(),
      ctx.superuserDb.pool.connect(),
    ]);
    try {
      await c1.query("BEGIN");
      await c2.query("BEGIN");
      // codex round-09 [P2]: the bare `catch {}` this replaced converted ANY exception -- a
      // trigger firing, a permission error, an unrelated bug -- into "rejected", so the test could
      // pass without the dm_key uniqueness race ever being exercised. Capturing the error and
      // asserting its exact SQLSTATE (23505 unique_violation) and constraint name
      // (chat_channels_dm_key_uq) ties the assertion to the specific mechanism this test exists to
      // prove, not just "one of the two attempts failed for some reason".
      const runOne = async (
        client: pg.PoolClient,
      ): Promise<{ outcome: "fulfilled" | "rejected"; code?: string; constraint?: string }> => {
        try {
          const { rows } = await client.query(
            `INSERT INTO chat_channels (kind, dm_key) VALUES ('dm', $1) RETURNING id`,
            [dmKey],
          );
          const channelId = (rows[0] as { id: string }).id;
          await client.query(
            `INSERT INTO chat_members (channel_id, person_id) VALUES ($1, $2), ($1, $3)`,
            [channelId, raceA, raceB],
          );
          await client.query("COMMIT");
          return { outcome: "fulfilled" };
        } catch (error) {
          await client.query("ROLLBACK").catch(() => {});
          const pgError = error as { code?: string; constraint?: string };
          return { outcome: "rejected", code: pgError.code, constraint: pgError.constraint };
        }
      };
      const outcomes = await Promise.all([runOne(c1), runOne(c2)]);
      expect(outcomes.filter((o) => o.outcome === "fulfilled")).toHaveLength(1);
      const rejected = outcomes.filter((o) => o.outcome === "rejected");
      expect(rejected).toHaveLength(1);
      expect(rejected[0]?.code).toBe("23505");
      expect(rejected[0]?.constraint).toBe("chat_channels_dm_key_uq");
    } finally {
      c1.release();
      c2.release();
    }

    const { rows } = await ctx.owner.query(
      `SELECT count(*)::int AS n FROM chat_channels WHERE dm_key = $1`,
      [dmKey],
    );
    expect((rows[0] as { n: number }).n).toBe(1);
    const { rows: memberRows } = await ctx.owner.query(
      `SELECT count(*)::int AS n FROM chat_members cm JOIN chat_channels c ON c.id = cm.channel_id WHERE c.dm_key = $1`,
      [dmKey],
    );
    expect((memberRows[0] as { n: number }).n).toBe(2);
  });

  it("a transaction that inserts a dm channel with only 1 member is rejected at COMMIT by the deferred constraint trigger", async () => {
    const soloA = await seedPerson("Solo A");
    const soloB = await seedPerson("Solo B");
    const client = await ctx.superuserDb.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        `INSERT INTO chat_channels (kind, dm_key) VALUES ('dm', $1) RETURNING id`,
        [dmKeyFor(soloA, soloB)],
      );
      const channelId = (rows[0] as { id: string }).id;
      await client.query(`INSERT INTO chat_members (channel_id, person_id) VALUES ($1, $2)`, [
        channelId,
        soloA,
      ]);
      await expect(client.query("COMMIT")).rejects.toThrow(/must have exactly 2 members/);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });
});

describe("regression — chat_members identity immutability (round-01 P1)", () => {
  it("UPDATE of channel_id on a DM chat_members row is rejected, closing the exactly-two-members bypass an UPDATE would otherwise open", async () => {
    await expect(
      ctx.owner.query(
        `UPDATE chat_members SET channel_id = $1 WHERE channel_id = $2 AND person_id = $3`,
        [channelClubA, channelDm, personDm1],
      ),
    ).rejects.toThrow(/immutable/);
  });

  it("UPDATE of person_id on a chat_members row is rejected", async () => {
    const personSpare = await seedPerson("Regression Spare");
    await expect(
      ctx.owner.query(
        `UPDATE chat_members SET person_id = $1 WHERE channel_id = $2 AND person_id = $3`,
        [personSpare, channelDm, personDm2],
      ),
    ).rejects.toThrow(/immutable/);
  });
});

describe("regression — chat_channels identity immutability (round-02 P1)", () => {
  it("UPDATE of kind (dm -> club) is rejected, closing the bypass that would silently disarm the exactly-two-members and no-delete guards", async () => {
    await expect(
      ctx.owner.query(
        `UPDATE chat_channels SET kind = 'club', tenant_id = $1, title = 'Hijacked', is_default = false,
           sort_order = 999, creation_origin = 'system_bootstrap', post_policy = 'all_members',
           assistant_enabled = false, dm_key = NULL
         WHERE id = $2`,
        [ctx.tenantA, channelDm],
      ),
    ).rejects.toThrow(/immutable/);
  });
});

describe("regression — dm_current_read_allowed restricted to dm channels (round-02 P2)", () => {
  it("direct invocation for a club channel with 2 members returns false, not true (round-06 P2: must set app.person_id to a real member first — the un-set-GUC path already returns false for an unrelated reason, so it would pass even with the kind='dm' guard removed)", async () => {
    const person1 = await seedPerson("Round02 Club Member 1");
    const membership1 = await seedMembership(ctx.tenantA, person1);
    const person2 = await seedPerson("Round02 Club Member 2");
    const membership2 = await seedMembership(ctx.tenantA, person2);
    const twoMemberClub = await seedClubChannel(ctx.tenantA, {
      isDefault: false,
      sortOrder: 200,
      title: "Round02 Two Member Club",
    });
    await addClubMember(twoMemberClub, person1, membership1);
    await addClubMember(twoMemberClub, person2, membership2);

    await ctx.owner.query(`SELECT set_config('app.person_id', $1, false)`, [person1]);
    try {
      const { rows } = await ctx.owner.query(`SELECT dm_current_read_allowed($1) AS v`, [
        twoMemberClub,
      ]);
      expect((rows[0] as { v: boolean }).v).toBe(false);
    } finally {
      await ctx.owner.query(`SELECT set_config('app.person_id', '', false)`);
    }
  });
});

describe("regression — live revocation and hard-DM security paths (round-02 P2)", () => {
  it("a club member whose membership status changes to 'left' immediately loses read access", async () => {
    const personLeaving = await seedPerson("Round02 Leaving Member");
    const membershipLeaving = await seedMembership(ctx.tenantA, personLeaving);
    const dedicatedChannel = await seedClubChannel(ctx.tenantA, {
      isDefault: false,
      sortOrder: 201,
      title: "Round02 Revocation Channel",
    });
    await addClubMember(dedicatedChannel, personLeaving, membershipLeaving);

    const beforeLeave = await withChatPerson(ctx.appDb.db, personLeaving, ctx.tenantA, (tx) =>
      tx.select().from(chatChannels).where(eq(chatChannels.id, dedicatedChannel)),
    );
    expect(beforeLeave.map((c) => c.id)).toEqual([dedicatedChannel]);

    await ctx.owner.query(`UPDATE memberships SET status = 'left' WHERE id = $1`, [
      membershipLeaving,
    ]);

    const afterLeave = await withChatPerson(ctx.appDb.db, personLeaving, ctx.tenantA, (tx) =>
      tx.select().from(chatChannels).where(eq(chatChannels.id, dedicatedChannel)),
    );
    expect(afterLeave).toEqual([]);
  });

  it("a chat_blocks row denies DM read even when dm_safety_enabled() is true, direction-agnostically", async () => {
    await ctx.owner.query(
      `INSERT INTO chat_blocks (blocker_person_id, blocked_person_id) VALUES ($1, $2)`,
      [personDm2, personDm1],
    );
    try {
      const asBlocked = await withChatPerson(ctx.appDb.db, personDm1, null, (tx) =>
        tx.select().from(chatChannels).where(eq(chatChannels.id, channelDm)),
      );
      expect(asBlocked).toEqual([]);

      const asBlocker = await withChatPerson(ctx.appDb.db, personDm2, null, (tx) =>
        tx.select().from(chatChannels).where(eq(chatChannels.id, channelDm)),
      );
      expect(asBlocker).toEqual([]);
    } finally {
      await ctx.owner.query(
        `DELETE FROM chat_blocks WHERE blocker_person_id = $1 AND blocked_person_id = $2`,
        [personDm2, personDm1],
      );
    }
  });

  it("DELETE of a DM member is rejected — DM membership is immutable except via archived_at", async () => {
    await expect(
      ctx.owner.query(`DELETE FROM chat_members WHERE channel_id = $1 AND person_id = $2`, [
        channelDm,
        personDm1,
      ]),
    ).rejects.toThrow(/soft-close channel via archived_at/);
  });

  it("direct INSERT attempting a 3rd member row into an already-2-member DM channel is rejected by the count>=2 guard, not just the dm_key mismatch guard", async () => {
    await expect(
      ctx.owner.query(`INSERT INTO chat_members (channel_id, person_id) VALUES ($1, $2)`, [
        channelDm,
        personDm1,
      ]),
    ).rejects.toThrow(/DM channel already has 2 members/);
  });
});

describe("migration shape", () => {
  it("adds exactly one new migration file for this slice", () => {
    const thisSlice = ctx.migrateResult.applied.filter((f) => f.includes("chat_schema_core"));
    expect(thisSlice).toEqual(["0031_chat_schema_core.sql"]);
  });

  it("the only change to a pre-existing baseline table is an additive UNIQUE constraint on memberships", async () => {
    const { rows } = await ctx.owner.query(
      `SELECT conname FROM pg_constraint WHERE conrelid = 'memberships'::regclass AND conname = 'memberships_id_person_tenant_uq'`,
    );
    expect(rows).toHaveLength(1);
  });
});

describe("security / privacy", () => {
  it("FORCE ROW LEVEL SECURITY is set on all three tables", async () => {
    const { rows } = await ctx.owner.query(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
       WHERE relname IN ('chat_channels', 'chat_members', 'chat_messages') ORDER BY relname`,
    );
    expect(rows).toEqual([
      { relname: "chat_channels", relrowsecurity: true, relforcerowsecurity: true },
      { relname: "chat_members", relrowsecurity: true, relforcerowsecurity: true },
      { relname: "chat_messages", relrowsecurity: true, relforcerowsecurity: true },
    ]);
  });

  it("chat_current_is_member and dm_current_read_allowed return boolean only (no PII side channel)", async () => {
    const { rows } = await ctx.owner.query(
      `SELECT proname, pg_get_function_result(oid) AS ret FROM pg_proc
       WHERE proname IN ('chat_current_is_member', 'dm_current_read_allowed') ORDER BY proname`,
    );
    expect(rows).toEqual([
      { proname: "chat_current_is_member", ret: "boolean" },
      { proname: "dm_current_read_allowed", ret: "boolean" },
    ]);
  });
});

// codex round-03 [P1]: proves the `SET search_path = public, pg_temp` fix (not `pg_catalog, public`,
// which this migration originally shipped, matching the source spec's own DDL text) actually closes
// the temp-table shadowing hole -- without an explicit pg_temp entry, Postgres searches pg_temp FIRST
// regardless, so an ordinary app-role session's own same-named temp table would silently substitute
// for the real chat_members/chat_channels/memberships inside every unqualified reference in these
// SECURITY DEFINER (BYPASSRLS-owner) function bodies. Mirrors chat-dm-safety-invariants.test.ts's own
// "resist temp-table shadowing" tests for 0030's three functions.
describe("regression — SECURITY DEFINER functions resist temp-table shadowing (round-03 P1)", () => {
  it("chat_current_is_member ignores a same-session temp table shadowing chat_members", async () => {
    await ctx.owner.query(`SELECT set_config('app.person_id', $1, false)`, [personA1]);
    try {
      const before = await ctx.owner.query(`SELECT chat_current_is_member($1) AS v`, [
        channelClubA,
      ]);
      expect((before.rows[0] as { v: boolean }).v).toBe(true);
      await ctx.owner.query(
        `CREATE TEMP TABLE chat_members (channel_id uuid, tenant_id uuid, person_id uuid, membership_id uuid)`,
      );
      // Shadow is empty: if consulted, the EXISTS subquery finds nothing and this flips to false.
      const shadowed = await ctx.owner.query(`SELECT chat_current_is_member($1) AS v`, [
        channelClubA,
      ]);
      expect((shadowed.rows[0] as { v: boolean }).v).toBe(true);
    } finally {
      await ctx.owner.query(`DROP TABLE IF EXISTS pg_temp.chat_members`);
      await ctx.owner.query(`SELECT set_config('app.person_id', '', false)`);
    }
  });

  it("chat_current_is_member ignores a same-session temp table shadowing memberships (club-path status check)", async () => {
    await ctx.owner.query(`SELECT set_config('app.person_id', $1, false)`, [personA1]);
    try {
      await ctx.owner.query(
        `CREATE TEMP TABLE memberships (id uuid, person_id uuid, tenant_id uuid, status text)`,
      );
      // Shadow is empty: if consulted, the LEFT JOIN's m.status is NULL, breaking the club-path
      // check (`c.kind = 'club' AND m.status = 'active'`) and flipping this to false.
      const shadowed = await ctx.owner.query(`SELECT chat_current_is_member($1) AS v`, [
        channelClubA,
      ]);
      expect((shadowed.rows[0] as { v: boolean }).v).toBe(true);
    } finally {
      await ctx.owner.query(`DROP TABLE IF EXISTS pg_temp.memberships`);
      await ctx.owner.query(`SELECT set_config('app.person_id', '', false)`);
    }
  });

  it("dm_current_read_allowed ignores a same-session temp table shadowing chat_channels", async () => {
    await ctx.owner.query(`SELECT set_config('app.person_id', $1, false)`, [personDm1]);
    try {
      const before = await ctx.owner.query(`SELECT dm_current_read_allowed($1) AS v`, [channelDm]);
      expect((before.rows[0] as { v: boolean }).v).toBe(true);

      await ctx.owner.query(`CREATE TEMP TABLE chat_channels (id uuid, kind text)`);
      // Shadow is empty: if consulted, the `JOIN chat_channels c ON ... c.kind = 'dm'` finds
      // nothing and this flips to false.
      const shadowed = await ctx.owner.query(`SELECT dm_current_read_allowed($1) AS v`, [
        channelDm,
      ]);
      expect((shadowed.rows[0] as { v: boolean }).v).toBe(true);
    } finally {
      await ctx.owner.query(`DROP TABLE IF EXISTS pg_temp.chat_channels`);
      await ctx.owner.query(`SELECT set_config('app.person_id', '', false)`);
    }
  });
});

// codex round-04 [P2]: the security-definer privilege boundary (owner, EXECUTE grants, schema
// CREATE) had no catalog-level regression coverage -- existing tests sample DML/return-type
// behavior but would not catch an incorrect function owner, a lingering PUBLIC/runtime-role
// EXECUTE grant, or a retained CREATE on schema public for chat_definer.
describe("regression — SECURITY DEFINER ownership/grant matrix (round-04 P2)", () => {
  it("both read helpers are owned by chat_definer, not the migration role", async () => {
    const { rows } = await ctx.owner.query(
      `SELECT p.proname, pg_get_userbyid(p.proowner) AS owner FROM pg_proc p
       WHERE p.proname IN ('chat_current_is_member', 'dm_current_read_allowed') ORDER BY p.proname`,
    );
    expect(rows).toEqual([
      { proname: "chat_current_is_member", owner: "chat_definer" },
      { proname: "dm_current_read_allowed", owner: "chat_definer" },
    ]);
  });

  it("the complete grantee list for both helpers is exactly app+EXECUTE, not-grantable — no PUBLIC, app_worker, readonly, or grant options (round-05 P2: the exact allowlist, not a sampled subset)", async () => {
    // information_schema.routine_privileges enumerates every EXPLICIT grant row for every
    // grantee -- unlike checking has_function_privilege() one role at a time, this catches ANY
    // unintended grantee (app_worker, readonly, PUBLIC, ...) automatically, not just the ones
    // this test happened to think to ask about. chat_definer is excluded: as OWNER it has
    // implicit full privileges that may or may not surface as an explicit row here depending on
    // how ownership vs. grants are represented -- that's covered by the separate owner test
    // above, not this allowlist.
    const { rows } = await ctx.owner.query(
      `SELECT grantee, routine_name, privilege_type, is_grantable
       FROM information_schema.routine_privileges
       WHERE routine_name IN ('chat_current_is_member', 'dm_current_read_allowed')
         AND grantee <> 'chat_definer'
       ORDER BY routine_name, grantee, privilege_type`,
    );
    expect(rows).toEqual([
      {
        grantee: "app",
        routine_name: "chat_current_is_member",
        privilege_type: "EXECUTE",
        is_grantable: "NO",
      },
      {
        grantee: "app",
        routine_name: "dm_current_read_allowed",
        privilege_type: "EXECUTE",
        is_grantable: "NO",
      },
    ]);
  });

  it("chat_definer's CREATE grant on schema public is revoked after ownership transfer, not left lingering", async () => {
    const { rows } = await ctx.owner.query(
      `SELECT has_schema_privilege('chat_definer', 'public', 'CREATE') AS has_create`,
    );
    expect((rows[0] as { has_create: boolean }).has_create).toBe(false);
  });

  it("chat_definer's own table access is read-only (SELECT), matching the least-privilege the two helpers actually need", async () => {
    const { rows } = await ctx.owner.query(
      `SELECT
         has_table_privilege('chat_definer', 'chat_channels', 'SELECT') AS select_channels,
         has_table_privilege('chat_definer', 'chat_channels', 'INSERT') AS insert_channels,
         has_table_privilege('chat_definer', 'chat_members', 'SELECT') AS select_members,
         has_table_privilege('chat_definer', 'chat_members', 'INSERT') AS insert_members`,
    );
    expect(rows).toEqual([
      {
        select_channels: true,
        insert_channels: false,
        select_members: true,
        insert_members: false,
      },
    ]);
  });

  it("the complete table x role x privilege matrix for all three chat tables has no unintended DML grants (round-08 P2: a denylist excluding only the owner, not an allowlist of expected grantees)", async () => {
    // Supersedes sampling one DML op per table (write-boundary describe block) and INSERT-only for
    // chat_definer (above). round-07's first attempt at this used
    // `grantee IN ('app', 'chat_definer', 'app_worker', 'readonly')` -- an ALLOWLIST that fails
    // OPEN: a future `GRANT ... TO PUBLIC` or any role not in that literal list would be silently
    // discarded before the assertion ever saw it, leaving the test green despite unintended access.
    //
    // A denylist excluding only the OWNER fails CLOSED instead -- but unlike the function-level
    // test above (round-05), the owner here is NOT chat_definer: chat_channels/chat_members/
    // chat_messages are owned by whichever role ran the migration (measured live: `plexco`, not
    // chat_definer), which is why a plain `grantee <> 'chat_definer'` first cut of this fix
    // returned 24 rows instead of 3 -- the actual table owner's implicit full privilege set (all
    // 7 standard table privileges x 3 tables = 21 rows) is NOT excluded by that filter, because
    // chat_definer's own chat_channels/chat_members access here is a genuine explicit GRANT, not
    // ownership -- the exact opposite relationship from the function case, where chat_definer IS
    // the owner. Excluding the actual owner dynamically (via pg_tables.tableowner, rather than
    // hardcoding a second literal role name) keeps this correct regardless of which role happens
    // to run migrations in a given environment. chat_definer's own explicit grants correctly
    // remain in the expected result below -- that is the real, intended state, not a gap; the
    // separate owner-privilege test above additionally pins chat_definer's exact privilege shape.
    const { rows } = await ctx.owner.query(
      `SELECT tp.grantee, tp.table_name, tp.privilege_type, tp.is_grantable
       FROM information_schema.table_privileges tp
       JOIN pg_tables pt ON pt.tablename = tp.table_name AND pt.schemaname = 'public'
       WHERE tp.table_name IN ('chat_channels', 'chat_members', 'chat_messages')
         AND tp.grantee <> pt.tableowner
       ORDER BY tp.table_name, tp.grantee, tp.privilege_type`,
    );
    expect(rows).toEqual([
      { grantee: "app", table_name: "chat_channels", privilege_type: "SELECT", is_grantable: "NO" },
      {
        grantee: "chat_definer",
        table_name: "chat_channels",
        privilege_type: "SELECT",
        is_grantable: "NO",
      },
      { grantee: "app", table_name: "chat_members", privilege_type: "SELECT", is_grantable: "NO" },
      {
        grantee: "chat_definer",
        table_name: "chat_members",
        privilege_type: "SELECT",
        is_grantable: "NO",
      },
      { grantee: "app", table_name: "chat_messages", privilege_type: "SELECT", is_grantable: "NO" },
    ]);
  });

  it("chat_definer's memberships grant is column-scoped to exactly id/person_id/tenant_id/status, not the whole table", async () => {
    const { rows } = await ctx.owner.query(
      `SELECT column_name, privilege_type, is_grantable
       FROM information_schema.column_privileges
       WHERE table_name = 'memberships' AND grantee = 'chat_definer'
       ORDER BY column_name`,
    );
    expect(rows.map((r) => (r as { column_name: string }).column_name)).toEqual([
      "id",
      "person_id",
      "status",
      "tenant_id",
    ]);
    expect(
      rows.every(
        (r) =>
          (r as { privilege_type: string }).privilege_type === "SELECT" &&
          (r as { is_grantable: string }).is_grantable === "NO",
      ),
    ).toBe(true);
  });

  it("chat_definer has no grant of any kind on chat_messages — neither helper reads it", async () => {
    const { rows } = await ctx.owner.query(
      `SELECT count(*)::int AS n FROM information_schema.table_privileges
       WHERE table_name = 'chat_messages' AND grantee = 'chat_definer'`,
    );
    expect((rows[0] as { n: number }).n).toBe(0);
  });
});

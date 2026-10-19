import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTenant } from "./auth.js";
import { approveJoinRequest } from "./join-request-service.js";
import { addMemberToSession } from "./roster-service.js";
import { fixtures, nextCommandId } from "./roster-money-fixtures.js";
import { __resetAuthSecretCacheForTest } from "./secret-key-root.js";
import { joinSession } from "./session-join-service.js";
import { seedPersonAccount, setupRlsTestContext, type RlsTestContext } from "./test-harness.js";

// Readiness section 6 (DT-22): chat provisioning on every membership activation path, one test
// per row. Each case commits where it asserts persistence: the deferred trg_chat_dm_two_* triggers
// fire at commit as the outer role (F-5, K-1).
const TEST_DB_NAME = "plexco_chat_activation_paths";
const GENDER_ENV = ["ENCRYPTION_KEY", "KMS_PROVIDER", "KMS_KEY_ID"];

let ctx: RlsTestContext;
const fx = fixtures(() => ctx);

beforeAll(async () => {
  ctx = await setupRlsTestContext(TEST_DB_NAME);
}, 180_000);

afterAll(async () => {
  await ctx?.teardown();
});

type Row = Record<string, unknown>;
const q = async (text: string, values: unknown[] = []): Promise<Row[]> =>
  (await ctx.owner.query(text, values)).rows as Row[];
const codeOf = (run: Promise<unknown>): Promise<string> =>
  run.then(
    () => "ok",
    (e: unknown) => String((e as { code?: unknown }).code ?? "no-code"),
  );
const member = async (tenantId: string, personId: string, status: string): Promise<string> =>
  (
    await q(
      `INSERT INTO memberships (tenant_id, person_id, display_name, status)
       VALUES ($1, $2, 'Path member', $3) RETURNING id`,
      [tenantId, personId, status],
    )
  )[0]!.id as string;
const statusOf = (tenantId: string, personId: string) =>
  q(`SELECT status FROM memberships WHERE tenant_id = $1 AND person_id = $2`, [tenantId, personId]);
const chatRows = (personId: string) =>
  q(`SELECT channel_id, membership_id FROM chat_members WHERE person_id = $1 ORDER BY channel_id`, [
    personId,
  ]);
const clubChannels = (tenantId: string) =>
  q(
    `SELECT id, is_default FROM chat_channels
      WHERE tenant_id = $1 AND kind = 'club' AND archived_at IS NULL ORDER BY sort_order, id`,
    [tenantId],
  );
// The tenant's channel count and every chat_members row version: equal snapshots mean no write.
const snapshot = async (tenantId: string) =>
  (
    await q(
      `SELECT (SELECT count(*)::int FROM chat_channels WHERE tenant_id = $1) AS channels,
              (SELECT coalesce(json_agg(json_build_array(cm.channel_id, cm.person_id,
                        cm.membership_id, cm.xmin::text) ORDER BY cm.channel_id, cm.person_id), '[]')
                 FROM chat_members cm JOIN chat_channels c ON c.id = cm.channel_id
                WHERE c.tenant_id = $1) AS members`,
      [tenantId],
    )
  )[0];

async function world() {
  const tenantId = await fx.seedTenant();
  const actor = await fx.seedAdmin(tenantId, "owner");
  const sessionId = await fx.seedSession(tenantId);
  return { tenantId, actor, sessionId };
}
type World = Awaited<ReturnType<typeof world>>;
const addByName = (w: World, displayName: string, commandId = nextCommandId()) =>
  addMemberToSession(ctx.appDb.db, {
    tenantId: w.tenantId,
    actorPersonId: w.actor,
    commandId,
    sessionId: w.sessionId,
    member: { displayName },
    source: "host_add",
  });
const selfJoin = (w: World, personId: string) =>
  joinSession(ctx.appDb.db, {
    tenantId: w.tenantId,
    personId,
    sessionId: w.sessionId,
    commandId: nextCommandId(),
    allowGuestMembership: true,
  });

// Polls until a backend of this database waits on a lock (the second activation's ON CONFLICT).
async function waitForLockWaiter(): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const [r] = await q(
      `SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'`,
    );
    if ((r!.n as number) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("the second activation never waited on the first");
}

describe("chat provisioning per membership activation path (readiness section 6)", () => {
  it("(a) club creation: provisionTenant via the app pool commits one default channel and one chat row for the owner; a same-owner re-submit adds none", async () => {
    const uid = String(100000 + Math.floor(Math.random() * 900000));
    const { personId } = await seedPersonAccount(ctx.owner, uid);
    const input = { slug: `w2b-${randomUUID().slice(0, 8)}`, name: "Path A", personId };
    const tenantId = await provisionTenant(ctx.appPool, input);
    const channels = await clubChannels(tenantId);
    expect(channels).toEqual([{ id: expect.any(String), is_default: true }]);
    expect(await chatRows(personId)).toEqual([
      { channel_id: channels[0]!.id, membership_id: expect.any(String) },
    ]);
    const before = await snapshot(tenantId);
    expect(await provisionTenant(ctx.appPool, input)).toBe(tenantId);
    expect(await snapshot(tenantId)).toEqual(before);
  });

  it("(b) host-add by name as the app role commits one chat row for the new active member; the same commandId replay adds none", async () => {
    const w = await world();
    const name = `Added ${randomUUID().slice(0, 8)}`;
    const commandId = nextCommandId();
    await addByName(w, name, commandId);
    const [m] = await q(
      `SELECT id, person_id, status FROM memberships WHERE tenant_id = $1 AND display_name = $2`,
      [w.tenantId, name],
    );
    expect(m?.status).toBe("active");
    expect(await chatRows(m!.person_id as string)).toEqual([
      { channel_id: expect.any(String), membership_id: m!.id },
    ]);
    const before = await snapshot(w.tenantId);
    await addByName(w, name, commandId);
    expect(await snapshot(w.tenantId)).toEqual(before);
    expect(await q(`SELECT 1 FROM memberships WHERE tenant_id = $1`, [w.tenantId])).toHaveLength(1);
  });

  it("(b) a seatPlayer charge-derivation failure rolls back: zero membership and zero chat rows for that person", async () => {
    const w = await world();
    await q(`UPDATE sessions SET price_male = 120000, price_female = 80000 WHERE id = $1`, [
      w.sessionId,
    ]);
    // A by-name person is minted with no gender, so its derivation cannot fail on its own at the
    // base: this file-local trigger seals an unopenable gender onto the minted person in the same
    // transaction, so deriveChargeAmount (roster-service.ts:256-271) fails after the INSERT. The
    // function and trigger are created inside the try, so the finally drops whatever exists even
    // if the second CREATE fails.
    const saved = GENDER_ENV.map((k) => [k, process.env[k]] as const);
    try {
      await q(`CREATE FUNCTION w2b_seal_unopenable_gender() RETURNS trigger LANGUAGE plpgsql
               SECURITY DEFINER SET search_path = public, pg_temp AS $$
               BEGIN
                 UPDATE persons SET gender_enc = decode(repeat('ab', 48), 'hex'),
                        gender_key_version = 'retired-key', gender_pricing_consent = true
                  WHERE id = NEW.person_id;
                 RETURN NULL;
               END $$`);
      await q(`CREATE TRIGGER w2b_seal_unopenable_gender AFTER INSERT ON memberships FOR EACH ROW
               WHEN (NEW.display_name LIKE 'Unpriceable %')
               EXECUTE FUNCTION w2b_seal_unopenable_gender()`);
      process.env.ENCRYPTION_KEY = Buffer.from("c".repeat(32)).toString("base64");
      for (const k of GENDER_ENV.slice(1)) delete process.env[k];
      __resetAuthSecretCacheForTest();
      const name = `Unpriceable ${randomUUID().slice(0, 8)}`;
      const before = await snapshot(w.tenantId);
      expect(before).toEqual({ channels: 0, members: [] });
      expect(await codeOf(addByName(w, name))).toBe("CHARGE_DERIVATION_UNAVAILABLE");
      expect(await q(`SELECT 1 FROM memberships WHERE display_name = $1`, [name])).toEqual([]);
      expect(await q(`SELECT 1 FROM persons WHERE display_name = $1`, [name])).toEqual([]);
      expect(await snapshot(w.tenantId)).toEqual(before);
    } finally {
      for (const [k, v] of saved) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      __resetAuthSecretCacheForTest();
      await q(`DROP TRIGGER IF EXISTS w2b_seal_unopenable_gender ON memberships`);
      await q(`DROP FUNCTION IF EXISTS w2b_seal_unopenable_gender()`);
    }
  });

  it("(c) self-join: joinSession mints a guest membership and no chat row", async () => {
    const w = await world();
    await fx.seedMembership(w.tenantId);
    await q(`UPDATE sessions SET visibility = 'public' WHERE id = $1`, [w.sessionId]);
    const visitor = await fx.seedPerson();
    const before = await snapshot(w.tenantId);
    await selfJoin(w, visitor);
    expect(await statusOf(w.tenantId, visitor)).toEqual([{ status: "guest" }]);
    expect(await chatRows(visitor)).toEqual([]);
    expect(await snapshot(w.tenantId)).toEqual(before);
  });

  it("(e) approved join request: the approved visitor holds a guest membership and no chat row", async () => {
    const w = await world();
    await fx.seedMembership(w.tenantId);
    await q(`UPDATE sessions SET visibility = 'public', join_policy = 'approval' WHERE id = $1`, [
      w.sessionId,
    ]);
    const visitor = await fx.seedPerson();
    const before = await snapshot(w.tenantId);
    const r = await selfJoin(w, visitor);
    expect(r.outcome).toBe("requested");
    await approveJoinRequest(ctx.appDb.db, {
      tenantId: w.tenantId,
      actorPersonId: w.actor,
      requestId: r.requestId!,
      commandId: nextCommandId(),
    });
    expect(await statusOf(w.tenantId, visitor)).toEqual([{ status: "guest" }]);
    expect(await chatRows(visitor)).toEqual([]);
    expect(await snapshot(w.tenantId)).toEqual(before);
  });

  it("(g) owner flips of a guest and a left membership to active provision one row per club channel; a re-join re-points them", async () => {
    const tenantId = await fx.seedTenant();
    await fx.seedMembership(tenantId);
    await q(
      `INSERT INTO chat_channels (tenant_id, kind, title, is_default, sort_order, post_policy,
                                  creation_origin, assistant_enabled)
       VALUES ($1, 'club', 'Second', false, 1, 'all_members', 'system_bootstrap', false)`,
      [tenantId],
    );
    const ids = (await clubChannels(tenantId)).map((c) => c.id as string).sort();
    expect(ids).toHaveLength(2);
    const flip = (id: string, status = "active") =>
      q(`UPDATE memberships SET status = $2 WHERE id = $1`, [id, status]);
    const expectRows = async (personId: string, membershipId: string) =>
      expect(await chatRows(personId)).toEqual(
        ids.map((channel_id) => ({ channel_id, membership_id: membershipId })),
      );
    for (const status of ["guest", "left"]) {
      const p = await fx.seedPerson();
      const m = await member(tenantId, p, status);
      expect(await chatRows(p)).toEqual([]);
      await flip(m);
      await expectRows(p, m);
    }
    const p = await fx.seedPerson();
    const first = await member(tenantId, p, "active");
    await expectRows(p, first);
    await flip(first, "left");
    const second = await member(tenantId, p, "guest");
    await flip(second);
    await expectRows(p, second);
  });

  it("(g) a rolled-back flip leaves zero rows; an active-to-active update writes nothing", async () => {
    const tenantId = await fx.seedTenant();
    const active = await fx.seedMembership(tenantId);
    const p = await fx.seedPerson();
    const guest = await member(tenantId, p, "guest");
    await ctx.owner.query("BEGIN");
    try {
      await q(`UPDATE memberships SET status = 'active' WHERE id = $1`, [guest]);
      expect(await chatRows(p)).toHaveLength(1);
    } finally {
      await ctx.owner.query("ROLLBACK");
    }
    expect(await chatRows(p)).toEqual([]);
    const before = await snapshot(tenantId);
    await q(`UPDATE memberships SET status = 'active' WHERE id = $1`, [active]);
    expect(await snapshot(tenantId)).toEqual(before);
  });

  it("(generic) an active INSERT's chat row is visible in its transaction and gone after ROLLBACK; the committed twin has one channel and one row", async () => {
    const tenantId = await fx.seedTenant();
    const p = await fx.seedPerson();
    await ctx.owner.query("BEGIN");
    try {
      await member(tenantId, p, "active");
      expect(await chatRows(p)).toHaveLength(1);
    } finally {
      await ctx.owner.query("ROLLBACK");
    }
    expect(await snapshot(tenantId)).toEqual({ channels: 0, members: [] });
    const m = await member(tenantId, p, "active");
    expect(await clubChannels(tenantId)).toHaveLength(1);
    expect(await chatRows(p)).toEqual([{ channel_id: expect.any(String), membership_id: m }]);
  });

  it("(generic) two concurrent first activations in one tenant give exactly one default channel and two rows", async () => {
    const tenantId = await fx.seedTenant();
    const people = [await fx.seedPerson(), await fx.seedPerson()];
    const clients: PoolClient[] = [];
    const activate = async (personId: string) => {
      const c = await ctx.appPool.connect();
      clients.push(c);
      await c.query("BEGIN");
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      await c.query(
        `INSERT INTO memberships (tenant_id, person_id, display_name, status)
         VALUES ($1, $2, 'Concurrent', 'active')`,
        [tenantId, personId],
      );
      return c;
    };
    try {
      const first = await activate(people[0]!);
      const second = activate(people[1]!); // waits on the first's uncommitted default channel
      await waitForLockWaiter();
      await first.query("COMMIT");
      await (await second).query("COMMIT");
    } finally {
      for (const c of clients) c.release(true);
    }
    expect(await clubChannels(tenantId)).toEqual([{ id: expect.any(String), is_default: true }]);
    for (const p of people) expect(await chatRows(p)).toHaveLength(1);
  });
});

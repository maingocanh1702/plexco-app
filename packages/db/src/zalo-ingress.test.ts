import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "./client.js";
import { fixtures } from "./roster-money-fixtures.js";
import { withTenant } from "./tenant.js";
import {
  appendSecretDecryptAudit,
  beginZaloConnect,
  claimZaloReplyContext,
  createZaloReplyContext,
  finishInboundEvent,
  finishZaloConnect,
  markBotVerifiedActive,
  getZaloOnboardingState,
  readLatestZaloReplyContext,
  readZaloPayContext,
  resolveZaloBotByToken,
  resolveZaloIdentity,
  resolveZaloLinkGate,
  storeInboundEvent,
  ZaloConnectError,
} from "./zalo-ingress.js";
import {
  expectErrorChainToMatch,
  setupRlsTestContext,
  type RlsTestContext,
} from "./test-harness.js";

// Real-PG tests as role `app` (DATABASE_URL_TEST required; CI only). Covers migration 0053: shape,
// RLS on channel_inbound_events, definer ACLs, identity idempotency/never-merge, authorize-inside
// bot upsert, token lookup, status machine and the decrypt-audit sink.
let ctx: RlsTestContext;
let ownerA: string;
let outsider: string;
let botA: string;
const WH_A = `wh-${randomUUID()}`;
let seq = 0;
const bytes = (s: string) => Buffer.from(s, "utf8");

async function person(): Promise<string> {
  const { rows } = await ctx.owner.query<{ id: string }>(
    `INSERT INTO persons (display_name) VALUES ($1) RETURNING id`,
    [`p-${randomUUID()}`],
  );
  return rows[0]!.id;
}
async function admin(tenantId: string, role: string): Promise<string> {
  const id = await person();
  await ctx.owner.query(
    `INSERT INTO tenant_admins (tenant_id, platform, platform_user_lookup_hash, role, active)
     VALUES ($1, 'web', $2, $3, true)`,
    [tenantId, id, role],
  );
  return id;
}
const upsert = (tenantId: string, actor: string, botId: string, token = WH_A) =>
  withTenant(ctx.appDb.db, tenantId, (tx) =>
    tx.execute(
      sql`SELECT bot_id, webhook_token, status FROM zalo_bot_upsert_for_tenant(
            ${tenantId}::uuid, ${actor}::uuid, ${botId}::uuid, 'enc-token', ${token},
            ${bytes("secret-enc")}, 'local', 'connecting')`,
    ),
  );
const ident = (tenantId: string, bot: string, user: string, scope = "scope-a") =>
  withTenant(ctx.appDb.db, tenantId, (tx) =>
    resolveZaloIdentity(tx, {
      tenantId,
      botId: bot,
      scopeHash: scope,
      userHash: user,
      userIdEnc: bytes("enc"),
      displayName: "An",
    }),
  );

beforeAll(async () => {
  ctx = await setupRlsTestContext("plexco_zalo_ingress");
  ownerA = await admin(ctx.tenantA, "owner");
  outsider = await person();
  botA = randomUUID();
  await upsert(ctx.tenantA, ownerA, botA);
  // A registered bot on tenant B so cross-tenant checks have something to miss.
  const ownerB = await admin(ctx.tenantB, "owner");
  await upsert(ctx.tenantB, ownerB, randomUUID(), `wh-${randomUUID()}`);
}, 120_000);
afterAll(async () => {
  await ctx?.teardown();
});

describe("0053 shape", () => {
  it("drops the plaintext secret column and adds the ciphertext columns", async () => {
    const { rows } = await ctx.owner.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'zalo_bots'`,
    );
    const cols = rows.map((r) => r.column_name);
    expect(cols).not.toContain("secret");
    expect(cols).toEqual(expect.arrayContaining(["webhook_secret_enc", "key_version"]));
  });

  it("zalo_bots_secret_shape_chk: registered/active/drift need a ciphertext", async () => {
    for (const status of ["registered", "active", "drift"]) {
      await expect(
        ctx.owner.query(
          `INSERT INTO zalo_bots (tenant_id, bot_token_enc, webhook_token, status) VALUES ($1, 'x', $2, $3)
           ON CONFLICT (tenant_id) DO UPDATE SET status = $3`,
          [ctx.tenantA, `wh-${randomUUID()}`, status],
        ),
      ).rejects.toThrow(/zalo_bots_secret_shape_chk/);
    }
  });

  it("channel_identities gained the scoped key + zalo_bot_id; legacy unique kept", async () => {
    const { rows } = await ctx.owner.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'channel_identities'`,
    );
    expect(rows.map((r) => r.indexname)).toContain("channel_identities_scoped_uq");
    expect(rows.length).toBeGreaterThanOrEqual(3);
  });
});

describe("definer ACLs", () => {
  const fns = [
    "zalo_bot_resolve_by_webhook_token(text)",
    "zalo_identity_resolve(uuid, uuid, text, text, bytea, text)",
    "zalo_bot_upsert_for_tenant(uuid, uuid, uuid, text, text, bytea, text, text)",
    "zalo_bot_set_status(uuid, uuid, text, boolean, boolean, text[])",
    "routing_audit_append(text, uuid, uuid, jsonb)",
  ];
  it("EXECUTE for app only; not app_worker, readonly or PUBLIC", async () => {
    for (const f of fns) {
      const { rows } = await ctx.owner.query(
        `SELECT has_function_privilege('app', $1, 'EXECUTE') AS app,
                has_function_privilege('app_worker', $1, 'EXECUTE') AS worker,
                has_function_privilege('readonly', $1, 'EXECUTE') AS ro`,
        [f],
      );
      expect(rows[0], f).toEqual({ app: true, worker: false, ro: false });
    }
  });
});

describe("definer hardening (0048 lesson)", () => {
  it("all five are SECURITY DEFINER with search_path = pg_catalog, public, pg_temp", async () => {
    for (const f of [
      "zalo_bot_resolve_by_webhook_token(text)",
      "zalo_identity_resolve(uuid, uuid, text, text, bytea, text)",
      "zalo_bot_upsert_for_tenant(uuid, uuid, uuid, text, text, bytea, text, text)",
      "zalo_bot_set_status(uuid, uuid, text, boolean, boolean, text[])",
      "routing_audit_append(text, uuid, uuid, jsonb)",
    ]) {
      const { rows } = await ctx.owner.query(
        `SELECT p.prosecdef, p.proconfig FROM pg_proc p WHERE p.oid = $1::regprocedure`,
        [f],
      );
      expect(rows[0].prosecdef, f).toBe(true);
      expect(rows[0].proconfig, f).toContain("search_path=pg_catalog, public, pg_temp");
    }
  });
});

describe("channel_inbound_events RLS + idempotency", () => {
  it("stores once per (bot, event id); a duplicate reports duplicate and adds no row", async () => {
    const id = `evt-${seq++}`;
    const first = await withTenant(ctx.appDb.db, ctx.tenantA, (tx) =>
      storeInboundEvent(tx, {
        tenantId: ctx.tenantA,
        botId: botA,
        externalEventId: id,
        rawPayloadEnc: bytes("x"),
        keyVersion: "local",
      }),
    );
    const again = await withTenant(ctx.appDb.db, ctx.tenantA, (tx) =>
      storeInboundEvent(tx, {
        tenantId: ctx.tenantA,
        botId: botA,
        externalEventId: id,
        rawPayloadEnc: bytes("y"),
        keyVersion: "local",
      }),
    );
    expect(first.duplicate).toBe(false);
    expect(again).toEqual({ id: null, duplicate: true });
    const { rows } = await ctx.owner.query(
      `SELECT 1 FROM channel_inbound_events WHERE external_event_id = $1`,
      [id],
    );
    expect(rows).toHaveLength(1);
    await withTenant(ctx.appDb.db, ctx.tenantA, (tx) =>
      finishInboundEvent(tx, {
        tenantId: ctx.tenantA,
        id: first.id!,
        status: "failed",
        errorCode: "X",
      }),
    );
    const r = await ctx.owner.query(
      `SELECT status, error_code, processed_at FROM channel_inbound_events WHERE id = $1`,
      [first.id],
    );
    expect(r.rows[0]).toMatchObject({ status: "failed", error_code: "X" });
    expect(r.rows[0].processed_at).not.toBeNull();
  });

  it("retry-driven recovery: a redelivery re-claims a failed row or one stuck in 'received' past 5 min, one winner only", async () => {
    const store = (externalEventId: string) =>
      withTenant(ctx.appDb.db, ctx.tenantA, (tx) =>
        storeInboundEvent(tx, {
          tenantId: ctx.tenantA,
          botId: botA,
          externalEventId,
          rawPayloadEnc: bytes("x"),
          keyVersion: "local",
        }),
      );
    const finish = (id: string, status: "processed" | "failed" | "ignored") =>
      withTenant(ctx.appDb.db, ctx.tenantA, (tx) =>
        finishInboundEvent(tx, {
          tenantId: ctx.tenantA,
          id,
          status,
          errorCode: status === "failed" ? "X" : undefined,
        }),
      );
    const age = (id: string, minutes: number) =>
      ctx.owner.query(
        `UPDATE channel_inbound_events SET received_at = clock_timestamp() - make_interval(mins => $2)
          WHERE id = $1`,
        [id, minutes],
      );
    const key = `evt-${seq++}`;
    const id = (await store(key)).id!;
    // In flight ('received', younger than the window): a plain duplicate, ack only.
    expect(await store(key)).toEqual({ id: null, duplicate: true });
    await age(id, 4);
    expect(await store(key)).toEqual({ id: null, duplicate: true });
    // Stuck past the window (crash between store and finish): re-claimed once, then in flight again.
    await age(id, 6);
    expect(await store(key)).toEqual({ id, duplicate: false });
    expect(await store(key)).toEqual({ id: null, duplicate: true });
    // Failed: two concurrent redeliveries, exactly one re-claims; the row is reset for processing.
    await finish(id, "failed");
    const both = await Promise.all([store(key), store(key)]);
    expect(both.filter((r) => !r.duplicate)).toEqual([{ id, duplicate: false }]);
    const row = await ctx.owner.query(
      `SELECT status, error_code, processed_at FROM channel_inbound_events WHERE id = $1`,
      [id],
    );
    expect(row.rows[0]).toEqual({ status: "received", error_code: null, processed_at: null });
    // processed / ignored are final, however old.
    for (const s of ["processed", "ignored"] as const) {
      await finish(id, s);
      await age(id, 60);
      expect(await store(key)).toEqual({ id: null, duplicate: true });
    }
  });

  it("tenant B cannot see or write tenant A's events; no GUC sees nothing", async () => {
    const seen = await withTenant(ctx.appDb.db, ctx.tenantB, (tx) =>
      tx.execute(
        sql`SELECT count(*)::int AS n FROM channel_inbound_events WHERE tenant_id = ${ctx.tenantA}::uuid`,
      ),
    );
    expect((seen.rows[0] as { n: number }).n).toBe(0);
    await expectErrorChainToMatch(
      withTenant(ctx.appDb.db, ctx.tenantB, (tx) =>
        storeInboundEvent(tx, {
          tenantId: ctx.tenantA,
          botId: botA,
          externalEventId: "x",
          rawPayloadEnc: bytes("x"),
          keyVersion: "local",
        }),
      ),
      /row-level security|violates/,
    );
    await ctx.appPool.query(`SELECT set_config('app.tenant_id', '', false)`);
    const { rows } = await ctx.appPool.query(
      `SELECT count(*)::int AS n FROM channel_inbound_events`,
    );
    expect(rows[0].n).toBe(0);
  });

  it("a bot of tenant B cannot be referenced by tenant A (composite FK)", async () => {
    const { rows } = await ctx.owner.query<{ id: string }>(
      `SELECT id FROM zalo_bots WHERE tenant_id = $1`,
      [ctx.tenantB],
    );
    await expect(
      ctx.owner.query(
        `INSERT INTO channel_inbound_events (tenant_id, platform, bot_id, external_event_id, raw_payload_enc, key_version)
         VALUES ($1, 'zalo', $2, 'cross', 'x', 'local')`,
        [ctx.tenantA, rows[0]!.id],
      ),
    ).rejects.toThrow(/channel_inbound_events_tenant_bot_fk/);
  });
});

describe("zalo_bot_upsert_for_tenant / token lookup / status", () => {
  it("authorizes INSIDE the definer: a non-member is refused even calling it directly", async () => {
    await expectErrorChainToMatch(upsert(ctx.tenantA, outsider, botA), /not permitted/);
  });

  it("one bot per tenant: same id rotates in place; a different id is refused", async () => {
    const rotated = await upsert(ctx.tenantA, ownerA, botA, `wh-${randomUUID()}`);
    expect((rotated.rows[0] as { status: string }).status).toBe("connecting");
    await expectErrorChainToMatch(
      upsert(ctx.tenantA, ownerA, randomUUID()),
      /concurrent bot change/,
    );
  });

  it("resolve_by_webhook_token: unknown -> null (never raises); known -> the row without any GUC", async () => {
    expect(await resolveZaloBotByToken(ctx.appDb.db, "no-such-token-xxxxxxxxxxxx")).toBeNull();
    const t = `wh-${randomUUID()}`;
    await upsert(ctx.tenantA, ownerA, botA, t);
    const bot = await resolveZaloBotByToken(ctx.appDb.db, t);
    expect(bot).toMatchObject({ botId: botA, tenantId: ctx.tenantA, status: "connecting" });
    expect(bot!.webhookSecretEnc).toBeInstanceOf(Buffer);
    expect(bot!.locale).toMatch(/^(vi|en)$/);
    // The lookup GUC is restored: a bare read afterwards sees nothing.
    const { rows } = await ctx.appPool.query(`SELECT count(*)::int AS n FROM zalo_bots`);
    expect(rows[0].n).toBe(0);
  });

  it("connect lifecycle: begin -> finish(registered) records the step once; replay does not re-register", async () => {
    await ctx.owner.query(`INSERT INTO onboarding_runs (tenant_id) VALUES ($1)`, [ctx.tenantA]);
    const commandId = `zc-${seq++}`;
    const begun = await beginZaloConnect(ctx.appDb.db, {
      tenantId: ctx.tenantA,
      actorPersonId: ownerA,
      commandId,
      newBotId: randomUUID(),
      prepare: async () => ({
        botTokenEnc: "enc",
        webhookToken: `wh-${randomUUID()}`,
        webhookSecretEnc: bytes("s"),
        keyVersion: "local",
      }),
    });
    expect(begun.replayed).toBe(false);
    if (begun.replayed) return;
    expect(begun.botId).toBe(botA);
    const { state, superseded } = await finishZaloConnect(ctx.appDb.db, {
      tenantId: ctx.tenantA,
      botId: botA,
      commandId,
      webhookToken: begun.webhookToken,
      outcome: "registered",
    });
    expect(superseded).toBe(false);
    expect(state.status).toBe("registered");
    expect(state.lastSetwebhookAt).not.toBeNull();
    const replay = await beginZaloConnect(ctx.appDb.db, {
      tenantId: ctx.tenantA,
      actorPersonId: ownerA,
      commandId,
      newBotId: randomUUID(),
      prepare: async () => {
        throw new Error("must not run on replay");
      },
    });
    expect(replay.replayed).toBe(true);
    await expect(
      beginZaloConnect(ctx.appDb.db, {
        tenantId: ctx.tenantA,
        actorPersonId: outsider,
        commandId: `zc-${seq++}`,
        newBotId: randomUUID(),
        prepare: async () => ({
          botTokenEnc: "e",
          webhookToken: `wh-${randomUUID()}`,
          webhookSecretEnc: bytes("s"),
          keyVersion: "local",
        }),
      }),
    ).rejects.toBeInstanceOf(ZaloConnectError);
    expect((await getZaloOnboardingState(ctx.appDb.db, { tenantId: ctx.tenantA })).status).toBe(
      "registered",
    );
  });

  it("a connect superseded by a newer one records step error SUPERSEDED, keeps the status and does not mark the command processed", async () => {
    const mk = (commandId: string) =>
      beginZaloConnect(ctx.appDb.db, {
        tenantId: ctx.tenantA,
        actorPersonId: ownerA,
        commandId,
        newBotId: randomUUID(),
        prepare: async () => ({
          botTokenEnc: "enc",
          webhookToken: `wh-${randomUUID()}`,
          webhookSecretEnc: bytes("s"),
          keyVersion: "local",
        }),
      });
    const loserCmd = `zc-${seq++}`;
    const loser = await mk(loserCmd);
    const winner = await mk(`zc-${seq++}`);
    if (loser.replayed || winner.replayed) throw new Error("unexpected replay");
    const res = await finishZaloConnect(ctx.appDb.db, {
      tenantId: ctx.tenantA,
      botId: botA,
      commandId: loserCmd,
      webhookToken: loser.webhookToken,
      outcome: "registered",
    });
    expect(res.superseded).toBe(true);
    expect(res.state.webhookToken).toBe(winner.webhookToken);
    const step = await ctx.owner.query(
      `SELECT s.status, s.error_code FROM onboarding_steps s JOIN onboarding_runs r ON r.id = s.run_id
        WHERE r.tenant_id = $1 AND s.step = 'zalo_connect' AND s.idempotency_key = $2`,
      [ctx.tenantA, loserCmd],
    );
    expect(step.rows[0]).toEqual({ status: "error", error_code: "SUPERSEDED" });
    const done = await ctx.owner.query(
      `SELECT 1 FROM processed_commands WHERE tenant_id = $1 AND command_id = $2`,
      [ctx.tenantA, loserCmd],
    );
    expect(done.rows).toHaveLength(0);
  });

  it("race: a newer connect committing between an older finish's token check and its write never receives the older outcome", async () => {
    const connect = (commandId: string) =>
      beginZaloConnect(ctx.appDb.db, {
        tenantId: ctx.tenantA,
        actorPersonId: ownerA,
        commandId,
        newBotId: randomUUID(),
        prepare: async () => ({
          botTokenEnc: "enc",
          webhookToken: `wh-${randomUUID()}`,
          webhookSecretEnc: bytes("s"),
          keyVersion: "local",
        }),
      });
    // Backends of this database waiting on a lock (pg_locks is live; pid/datname are visible to all).
    const blocked = async () =>
      (
        await ctx.owner.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
            WHERE NOT l.granted AND a.datname = current_database()`,
        )
      ).rows[0]!.n;
    const untilBlocked = async (n: number) => {
      for (let i = 0; i < 400 && (await blocked()) < n; i++) {
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(await blocked()).toBeGreaterThanOrEqual(n);
    };
    const rowOf = async () =>
      (
        await ctx.owner.query(
          `SELECT status, webhook_token, last_setwebhook_at FROM zalo_bots WHERE id = $1`,
          [botA],
        )
      ).rows[0];

    const loserCmd = `zc-${seq++}`;
    const winnerCmd = `zc-${seq++}`;
    const loser = await connect(loserCmd);
    if (loser.replayed) throw new Error("unexpected replay");
    const before = await rowOf();
    // Deterministic interleaving: park the bot row, queue the newer connect's upsert FIRST, then the
    // older attempt's finish (its setWebhook failed: outcome error). Releasing the row lets the newer
    // connect commit before the older finish proceeds, i.e. between its token check and its write.
    const holder = await ctx.appPool.connect();
    let winnerP: ReturnType<typeof connect> | undefined;
    let loserP: ReturnType<typeof finishZaloConnect> | undefined;
    try {
      await holder.query("BEGIN");
      await holder.query(`SELECT set_config('app.tenant_id', $1, true)`, [ctx.tenantA]);
      await holder.query(`SELECT 1 FROM zalo_bots WHERE id = $1 FOR UPDATE`, [botA]);
      winnerP = connect(winnerCmd);
      await untilBlocked(1);
      loserP = finishZaloConnect(ctx.appDb.db, {
        tenantId: ctx.tenantA,
        botId: botA,
        commandId: loserCmd,
        webhookToken: loser.webhookToken,
        outcome: "error",
        reason: "ZALO_SETWEBHOOK_FAILED",
      });
      await untilBlocked(2);
    } finally {
      await holder.query("COMMIT");
      holder.release();
    }
    const winner = await winnerP!;
    const lost = await loserP!;
    if (winner.replayed) throw new Error("unexpected replay");
    expect(lost.superseded).toBe(true);
    // The newer connect's row is exactly as its own upsert left it: the older outcome wrote nothing.
    expect(await rowOf()).toEqual({
      status: "connecting",
      webhook_token: winner.webhookToken,
      last_setwebhook_at: before.last_setwebhook_at,
    });
    const won = await finishZaloConnect(ctx.appDb.db, {
      tenantId: ctx.tenantA,
      botId: botA,
      commandId: winnerCmd,
      webhookToken: winner.webhookToken,
      outcome: "registered",
    });
    expect(won.superseded).toBe(false);
    expect(won.state.status).toBe("registered");
  });

  it("set_status CAS skip still stamps last_setwebhook_at when a real setWebhook happened", async () => {
    await ctx.owner.query(
      `UPDATE zalo_bots SET status = 'active', last_setwebhook_at = NULL WHERE id = $1`,
      [botA],
    );
    const r = await withTenant(ctx.appDb.db, ctx.tenantA, (tx) =>
      tx.execute(
        sql`SELECT status, last_setwebhook_at FROM zalo_bot_set_status(${ctx.tenantA}::uuid, ${botA}::uuid, 'registered', false, true, ARRAY['connecting','registered']::text[])`,
      ),
    );
    const row = r.rows[0] as { status: string; last_setwebhook_at: string | null };
    expect(row.status).toBe("active");
    expect(row.last_setwebhook_at).not.toBeNull();
  });

  it("set_status: verified_at stamped once; revoked is terminal", async () => {
    // drizzle expands a bound JS array into ($1, $2) (a record, not text[]): build an ARRAY[...] literal.
    const set = (status: string, verified: boolean, onlyFrom: string[] | null = null) => {
      const arr = onlyFrom
        ? sql`ARRAY[${sql.join(
            onlyFrom.map((x) => sql`${x}`),
            sql`, `,
          )}]::text[]`
        : sql`NULL::text[]`;
      return withTenant(ctx.appDb.db, ctx.tenantA, (tx) =>
        tx.execute(
          sql`SELECT status, verified_at FROM zalo_bot_set_status(${ctx.tenantA}::uuid, ${botA}::uuid, ${status}, ${verified}, false, ${arr})`,
        ),
      );
    };
    // db.execute returns timestamptz as text: compare instants, not Date methods.
    const at = (r: { rows: unknown[] }) =>
      new Date((r.rows[0] as { verified_at: string }).verified_at).getTime();
    const a = at(await set("active", true));
    const b = at(await set("active", true));
    expect(a).toBe(b);
    // CAS: a late connect finish (only_from connecting/registered) must NOT demote an active bot.
    const cas = await set("registered", false, ["connecting", "registered"]);
    expect(cas.rows).toHaveLength(0);
    expect(((await set("active", false)).rows[0] as { status: string }).status).toBe("active");
    await expectErrorChainToMatch(
      withTenant(ctx.appDb.db, ctx.tenantB, (tx) =>
        tx.execute(
          sql`SELECT * FROM zalo_bot_set_status(${ctx.tenantA}::uuid, ${botA}::uuid, 'active', false, false, NULL::text[])`,
        ),
      ),
      /tenant context mismatch/,
    );
    await set("revoked", false);
    await expectErrorChainToMatch(set("active", true), /revoked/);
    // A revoked row is never resurrected by a re-connect.
    await expectErrorChainToMatch(
      upsert(ctx.tenantA, ownerA, botA, `wh-${randomUUID()}`),
      /bot is revoked/,
    );
  });
});

describe("markBotVerifiedActive (token-bound activation)", () => {
  const stateOf = async () => {
    const { rows } = await ctx.owner.query<{ status: string; verified_at: Date | null }>(
      `SELECT status, verified_at FROM zalo_bots WHERE id = $1`,
      [botA],
    );
    return rows[0]!;
  };
  const activate = (token: string) =>
    withTenant(ctx.appDb.db, ctx.tenantA, (tx) =>
      markBotVerifiedActive(tx, ctx.tenantA, botA, token),
    );
  const force = (status: string) =>
    ctx.owner.query(`UPDATE zalo_bots SET status = $2, verified_at = NULL WHERE id = $1`, [
      botA,
      status,
    ]);
  const currentToken = async () =>
    (
      await ctx.owner.query<{ webhook_token: string }>(
        `SELECT webhook_token FROM zalo_bots WHERE id = $1`,
        [botA],
      )
    ).rows[0]!.webhook_token;

  // The status describe above leaves botA revoked; later suites expect that, so restore it.
  afterAll(async () => {
    await force("revoked");
  });

  it("happy path: registered -> active with verified_at", async () => {
    await force("registered");
    expect(await activate(await currentToken())).toBe("activated");
    const s = await stateOf();
    expect(s.status).toBe("active");
    expect(s.verified_at).not.toBeNull();
  });

  it("upsert-rotate between resolve and activate: stays connecting, verified_at NULL", async () => {
    await force("registered");
    const stale = await currentToken();
    await upsert(ctx.tenantA, ownerA, botA, `wh-${randomUUID()}`); // owner reconnect: new token
    expect(await activate(stale)).toBe("token_rotated");
    const s = await stateOf();
    expect(s.status).toBe("connecting");
    expect(s.verified_at).toBeNull();
  });

  it("a drift row is not cleared by a verified event, and the outcome says so (unchanged)", async () => {
    await force("drift");
    expect(await activate(await currentToken())).toBe("unchanged");
    expect((await stateOf()).status).toBe("drift");
  });
});

describe("zalo_identity_resolve", () => {
  let bot: string;
  beforeAll(async () => {
    bot = randomUUID();
    await ctx.owner.query(`DELETE FROM zalo_bots WHERE tenant_id = $1`, [ctx.tenantB]);
    const ownerB = await admin(ctx.tenantB, "owner");
    await upsert(ctx.tenantB, ownerB, bot, `wh-${randomUUID()}`);
  });

  it("creates one Person + identity, then is idempotent; a different Zalo user is a different Person (never merges)", async () => {
    const u1 = `u-${randomUUID()}`;
    const first = await ident(ctx.tenantB, bot, u1);
    const second = await ident(ctx.tenantB, bot, u1);
    expect(first.created).toBe(true);
    expect(second).toMatchObject({
      created: false,
      personId: first.personId,
      channelIdentityId: first.channelIdentityId,
    });
    expect(second.hasAccount).toBe(false);
    const other = await ident(ctx.tenantB, bot, `u-${randomUUID()}`);
    expect(other.personId).not.toBe(first.personId);
    const { rows } = await ctx.owner.query(
      `SELECT count(*)::int AS n FROM channel_identities WHERE zalo_bot_id = $1`,
      [bot],
    );
    expect(rows[0].n).toBe(2);
  });

  it("refuses a bot outside the tenant and a GUC that differs from p_tenant_id", async () => {
    await expectErrorChainToMatch(ident(ctx.tenantA, bot, "u-x"), /bot not in tenant/);
    await expectErrorChainToMatch(
      withTenant(ctx.appDb.db, ctx.tenantA, (tx) =>
        resolveZaloIdentity(tx, {
          tenantId: ctx.tenantB,
          botId: bot,
          scopeHash: "s",
          userHash: "u",
          userIdEnc: bytes("e"),
          displayName: null,
        }),
      ),
      /tenant context mismatch/,
    );
  });

  it("the SAME Zalo user under a second bot scope is a DISTINCT person + identity (3-part key)", async () => {
    const u = `u-${randomUUID()}`;
    const a = await ident(ctx.tenantB, bot, u, "scope-1");
    const b = await ident(ctx.tenantB, bot, u, "scope-2");
    expect(b.created).toBe(true);
    expect(b.personId).not.toBe(a.personId);
    expect(b.channelIdentityId).not.toBe(a.channelIdentityId);
  });

  it("legacy unscoped rows keep the 2-part unique; scoped rows are exempt (partial index)", async () => {
    const hash = `legacy-${randomUUID()}`;
    const p1 = await person();
    const p2 = await person();
    const ins = (pid: string, scope: string | null) =>
      ctx.owner.query(
        `INSERT INTO channel_identities (person_id, platform, platform_user_id_enc, platform_user_lookup_hash, provider_scope_lookup_hash)
         VALUES ($1, 'zalo', '\\x00'::bytea, $2, $3)`,
        [pid, hash, scope],
      );
    await ins(p1, null);
    await expect(ins(p2, null)).rejects.toThrow(/channel_identities_platform_uid_uq/);
    await ins(p2, "some-scope");
  });

  it("an inactive identity with the 3-part key is reactivated, not a permanent lockout", async () => {
    const u = `u-${randomUUID()}`;
    const first = await ident(ctx.tenantB, bot, u);
    await ctx.owner.query(`UPDATE channel_identities SET status = 'inactive' WHERE id = $1`, [
      first.channelIdentityId,
    ]);
    const again = await ident(ctx.tenantB, bot, u);
    expect(again).toMatchObject({ created: false, channelIdentityId: first.channelIdentityId });
    const { rows } = await ctx.owner.query(`SELECT status FROM channel_identities WHERE id = $1`, [
      first.channelIdentityId,
    ]);
    expect(rows[0].status).toBe("active");
  });

  it("refuses an identity whose Person is not active (tombstoning never relies on channel_identities.status)", async () => {
    const u = `u-${randomUUID()}`;
    const first = await ident(ctx.tenantB, bot, u);
    await ctx.owner.query(`UPDATE persons SET status = 'deleted' WHERE id = $1`, [first.personId]);
    await expectErrorChainToMatch(ident(ctx.tenantB, bot, u), /person is not active/);
  });

  it("has_account is true once the person has an accounts row", async () => {
    const u = `u-${randomUUID()}`;
    const first = await ident(ctx.tenantB, bot, u);
    expect(first.hasAccount).toBe(false);
    await ctx.owner.query(`INSERT INTO accounts (person_id) VALUES ($1)`, [first.personId]);
    expect((await ident(ctx.tenantB, bot, u)).hasAccount).toBe(true);
  });

  it("app has no direct privilege on persons / channel_identities / routing_audit", async () => {
    for (const t of ["persons", "channel_identities", "routing_audit"]) {
      await expect(ctx.appPool.query(`SELECT 1 FROM ${t} LIMIT 1`)).rejects.toThrow(
        /permission denied/,
      );
    }
  });
});

describe("routing_audit_append", () => {
  it("writes one row for zalo.secret_decrypt with no secret material; refuses other actions and a foreign tenant", async () => {
    await withTenant(ctx.appDb.db, ctx.tenantA, (tx) =>
      appendSecretDecryptAudit(tx, {
        tenantId: ctx.tenantA,
        botId: botA,
        purpose: "webhook_secret",
      }),
    );
    const { rows } = await ctx.owner.query(
      `SELECT detail FROM routing_audit WHERE action = 'zalo.secret_decrypt' AND tenant_id = $1`,
      [ctx.tenantA],
    );
    expect(rows.at(-1)!.detail).toEqual({ botId: botA, purpose: "webhook_secret" });
    await expectErrorChainToMatch(
      withTenant(ctx.appDb.db, ctx.tenantA, (tx) =>
        tx.execute(
          sql`SELECT routing_audit_append('anything.else', NULL, ${ctx.tenantA}::uuid, '{}'::jsonb)`,
        ),
      ),
      /action not allowed/,
    );
    await expectErrorChainToMatch(
      withTenant(ctx.appDb.db, ctx.tenantB, (tx) =>
        appendSecretDecryptAudit(tx, { tenantId: ctx.tenantA, botId: botA, purpose: "x" }),
      ),
      /tenant context mismatch/,
    );
  });
});

// T-22 seeds (owner role): the INSERT shapes of channel-identity-link-gate.test.ts LG-3g, LG-2b and
// LG-2a, whose helpers are file-local there.
async function channelIdentity(personId: string): Promise<string> {
  const id = randomUUID();
  await ctx.owner.query(
    `INSERT INTO channel_identities
       (id, person_id, platform, platform_user_id_enc, platform_user_lookup_hash, status)
       VALUES ($1, $2, 'zalo', $3, $4, 'active')`,
    [id, personId, bytes(`enc-${id}`), `chan-hash-${id}`],
  );
  return id;
}
async function account(personId: string): Promise<string> {
  const id = randomUUID();
  await ctx.owner.query(`INSERT INTO accounts (id, person_id) VALUES ($1, $2)`, [id, personId]);
  return id;
}
/** Verified = verified_at set; pending = verified_at NULL with pending_expires_at (lifecycle CHECK). */
async function email(accountId: string, verified: boolean): Promise<void> {
  const id = randomUUID();
  await ctx.owner.query(
    `INSERT INTO account_emails
       (id, account_id, email_lookup_hash, email_enc, kms_key_version, verified_at, pending_expires_at)
       VALUES ($1, $2, $3, $4, 'v1',
               CASE WHEN $5::boolean THEN now() END,
               CASE WHEN $5::boolean THEN NULL ELSE now() + interval '1 day' END)`,
    [id, accountId, `email-${id}`, bytes(`enc-${id}`), verified],
  );
}

describe("resolveZaloLinkGate (T-22, R1: the merged wrapper, role app)", () => {
  const NOT_LINKED = { linked: false, accountRef: null };

  it("half-linked: an account with only a pending email -> not linked", async () => {
    const p = await person();
    await email(await account(p), false);
    expect(await resolveZaloLinkGate(ctx.appPool, await channelIdentity(p))).toEqual(NOT_LINKED);
  });

  it("half-linked: a legacy-only account (account_identities row, no email) -> not linked", async () => {
    const p = await person();
    await ctx.owner.query(
      `INSERT INTO account_identities (id, account_id, platform, platform_user_hash, verified_at)
         VALUES ($1, $2, 'telegram', $3, now())`,
      [randomUUID(), await account(p), `tg-hash-${randomUUID()}`],
    );
    expect(await resolveZaloLinkGate(ctx.appPool, await channelIdentity(p))).toEqual(NOT_LINKED);
  });

  it("linked: a verified account -> linked with that account id", async () => {
    const p = await person();
    const ci = await channelIdentity(p);
    const acc = await account(p);
    await email(acc, true);
    expect(await resolveZaloLinkGate(ctx.appPool, ci)).toEqual({ linked: true, accountRef: acc });
  });

  it("readonly has no EXECUTE on the wrapper -> rejects 42501 (the call site maps it to not linked)", async () => {
    const p = await person();
    await expect(
      resolveZaloLinkGate(ctx.readonlyPool, await channelIdentity(p)),
    ).rejects.toMatchObject({ code: "42501" });
  });
});

describe("readZaloPayContext (/pay DB legs of T-13, T-15, T-17, role app)", () => {
  const fx = fixtures(() => ctx);
  const HCM = "Asia/Ho_Chi_Minh"; // the timezone seedSession writes; its area is 'Quan 1'
  const slugOf = async (tenantId: string): Promise<string> =>
    (
      (await ctx.owner.query(`SELECT slug FROM tenants WHERE id = $1`, [tenantId])).rows[0] as {
        slug: string;
      }
    ).slug;

  it("T-13: the bot tenant's slug and only its sessions; a tenantB id in sessionIds is absent", async () => {
    const a1 = await fx.seedSession(ctx.tenantA);
    const a2 = await fx.seedSession(ctx.tenantA);
    await ctx.owner.query(`UPDATE sessions SET area = NULL WHERE id = $1`, [a2]);
    const b1 = await fx.seedSession(ctx.tenantB);
    expect(
      await readZaloPayContext(ctx.appDb.db, { tenantId: ctx.tenantA, sessionIds: [a1, a2, b1] }),
    ).toEqual({
      slug: await slugOf(ctx.tenantA),
      sessions: new Map([
        [a1, { timezone: HCM, area: "Quan 1" }],
        [a2, { timezone: HCM, area: null }],
      ]),
    });
  });

  it("T-17: a matched item whose session lives in another tenant is never found (web: R-17)", async () => {
    const b1 = await fx.seedSession(ctx.tenantB);
    expect(
      await readZaloPayContext(ctx.appDb.db, { tenantId: ctx.tenantA, sessionIds: [b1] }),
    ).toEqual({ slug: await slugOf(ctx.tenantA), sessions: new Map() });
  });

  it("T-15: sessionIds [] -> the slug only; an unknown tenant -> slug null and no sessions", async () => {
    expect(
      await readZaloPayContext(ctx.appDb.db, { tenantId: ctx.tenantA, sessionIds: [] }),
    ).toEqual({ slug: await slugOf(ctx.tenantA), sessions: new Map() });
    const a1 = await fx.seedSession(ctx.tenantA);
    expect(
      await readZaloPayContext(ctx.appDb.db, { tenantId: randomUUID(), sessionIds: [a1] }),
    ).toEqual({ slug: null, sessions: new Map() });
  });

  it("T-15: a non-UUID id or more than 200 ids throws a fixed message before any DB call", async () => {
    const noDb = {} as Db; // any DB access would throw a TypeError, not the fixed message
    const ids200 = Array.from({ length: 200 }, () => randomUUID());
    for (const sessionIds of [["x' OR 1=1 --"], [randomUUID(), ""], [...ids200, randomUUID()]]) {
      await expect(readZaloPayContext(noDb, { tenantId: ctx.tenantA, sessionIds })).rejects.toThrow(
        /^readZaloPayContext: sessionIds must be at most 200 UUIDs$/,
      );
    }
    // Exactly OPEN_CHARGES_CAP ids is allowed: it reaches the DB and finds none of them.
    const got = await readZaloPayContext(ctx.appDb.db, {
      tenantId: ctx.tenantA,
      sessionIds: ids200,
    });
    expect(got.sessions.size).toBe(0);
  });
});

describe("reply-context store P-7..P-9 (DB legs of T-6, T-7, role app)", () => {
  const db = () => ctx.appDb.db;
  // One fresh person per key, so each case starts at version 1.
  const key = async () => ({ tenantId: ctx.tenantA, botId: botA, personId: await person() });
  const create = (
    k: { tenantId: string; botId: string; personId: string },
    contextType: "join_list" | "leave_list",
    itemIds = [randomUUID()],
  ) => createZaloReplyContext(db(), { ...k, contextType, itemIds });
  const row = async (id: string) =>
    (
      await ctx.owner.query(
        `SELECT context_type, item_ids, version, consumed_at::text AS consumed,
                expires_at - created_at = interval '10 minutes' AS ttl10
           FROM zalo_reply_contexts WHERE id = $1`,
        [id],
      )
    ).rows[0] as Record<string, unknown> | undefined;

  it("T-6: /join stores a 'join_list' context with a 10-minute expiry; the latest is live and claims once", async () => {
    const k = await key();
    const ids = [randomUUID(), randomUUID()];
    const c = await create(k, "join_list", ids);
    expect(c.version).toBe(1);
    expect(await row(c.id)).toEqual({
      context_type: "join_list",
      item_ids: ids,
      version: 1,
      consumed: null,
      ttl10: true,
    });
    expect(await readLatestZaloReplyContext(db(), k)).toEqual({
      id: c.id,
      version: 1,
      contextType: "join_list",
      itemCount: 2,
      live: true,
    });
    expect(await claimZaloReplyContext(db(), { ...k, id: c.id, version: 1 })).toEqual({
      contextType: "join_list",
      itemIds: ids,
    });
    expect((await row(c.id))?.consumed).not.toBeNull();
    expect((await readLatestZaloReplyContext(db(), k))?.live).toBe(false);
  });

  it("P-8: the version is monotonic per tenant+bot+person across both types; the latest wins, consumed or not", async () => {
    const k = await key();
    const j = await create(k, "join_list");
    const l = await create(k, "leave_list", [randomUUID(), randomUUID(), randomUUID()]);
    expect([j.version, l.version]).toEqual([1, 2]);
    expect(await readLatestZaloReplyContext(db(), k)).toEqual({
      id: l.id,
      version: 2,
      contextType: "leave_list",
      itemCount: 3,
      live: true,
    });
    expect(await claimZaloReplyContext(db(), { ...k, id: l.id, version: 2 })).not.toBeNull();
    // The older live row stays superseded: the latest is the consumed one, never j.
    expect(await readLatestZaloReplyContext(db(), k)).toMatchObject({ id: l.id, live: false });
    const other = await key();
    expect(await readLatestZaloReplyContext(db(), other)).toBeNull();
    expect((await create(other, "leave_list")).version).toBe(1);
  });

  it("T-7: an expired, consumed or version-mismatched context is not claimable and stays unchanged", async () => {
    const k1 = await key();
    const e = await create(k1, "join_list");
    await ctx.owner.query(
      `UPDATE zalo_reply_contexts SET expires_at = now() - interval '1 second' WHERE id = $1`,
      [e.id],
    );
    const expired = await row(e.id);
    expect((await readLatestZaloReplyContext(db(), k1))?.live).toBe(false);
    expect(await claimZaloReplyContext(db(), { ...k1, id: e.id, version: e.version })).toBeNull();
    expect(await row(e.id)).toEqual(expired);

    const k2 = await key();
    const c = await create(k2, "join_list");
    expect(
      await claimZaloReplyContext(db(), { ...k2, id: c.id, version: c.version }),
    ).not.toBeNull();
    const consumed = await row(c.id);
    expect(await claimZaloReplyContext(db(), { ...k2, id: c.id, version: c.version })).toBeNull();
    expect(await row(c.id)).toEqual(consumed);

    const k3 = await key();
    const v = await create(k3, "leave_list");
    const fresh = await row(v.id);
    expect(fresh?.consumed).toBeNull();
    expect(
      await claimZaloReplyContext(db(), { ...k3, id: v.id, version: v.version + 1 }),
    ).toBeNull();
    expect(await row(v.id)).toEqual(fresh);
  });

  it("T-7: two concurrent claims of one live context consume it once", async () => {
    const k = await key();
    const c = await create(k, "join_list");
    const got = await Promise.all(
      [1, 2].map(() => claimZaloReplyContext(db(), { ...k, id: c.id, version: c.version })),
    );
    expect(got.filter((g) => g !== null)).toHaveLength(1);
  });

  it("HR1: another tenant, bot or person never reads or claims the context", async () => {
    const k = await key();
    const c = await create(k, "join_list");
    const fresh = await row(c.id);
    for (const other of [
      { ...k, tenantId: ctx.tenantB },
      { ...k, botId: randomUUID() },
      { ...k, personId: await person() },
    ]) {
      expect(await readLatestZaloReplyContext(db(), other)).toBeNull();
      expect(
        await claimZaloReplyContext(db(), { ...other, id: c.id, version: c.version }),
      ).toBeNull();
    }
    expect(await row(c.id)).toEqual(fresh);
  });
});

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "./tenant.js";
import {
  appendSecretDecryptAudit,
  beginZaloConnect,
  finishInboundEvent,
  finishZaloConnect,
  getZaloOnboardingState,
  resolveZaloBotByToken,
  resolveZaloIdentity,
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
    const state = await finishZaloConnect(ctx.appDb.db, {
      tenantId: ctx.tenantA,
      botId: botA,
      commandId,
      outcome: "registered",
    });
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

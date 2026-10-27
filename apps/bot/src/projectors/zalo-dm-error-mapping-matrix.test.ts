// The projector leg of DD-138 Z-6: per Zalo reply class, the REAL createZaloDmDeliver against the
// real 0057 definers (as app_worker) retries or dead-letters with no recipient recorded, or records
// that one recipient terminal and delivers. The stub (127.0.0.1) never sees a real token.
import { randomUUID } from "node:crypto";
import pg from "pg";
import { migrate } from "@plexco/db";
import {
  __resetAuthSecretCacheForTest,
  blobToText,
  connectorKeyVersion,
  encryptConnectorSecret,
} from "@plexco/db/connector-crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ClaimedDeliveryJob, DeliveryOutcome } from "../dispatcher.js";
import {
  ROLE_PW,
  bootstrapJobDefiner,
  setAppWorkerPasswordRaceSafe,
  testUrl,
  withJobDefinerLock,
  type TestRolePasswordLease,
} from "../test-db.js";
import { startZaloStub, type StubReply, type ZaloStub } from "../test-zalo-stub.js";
import { createZaloDmDeliver } from "./zalo-dm.js";

// Fixture copied from zalo-dm.test.ts :28-61, :177-251 and :253-328, trimmed to these rows.
const KEY = Buffer.alloc(32, "k").toString("base64");
const TOKEN = "654321:FIXTURE-worker-token";
const CLAIM_BATCH = "SELECT * FROM claim_projector_delivery_batch('zalo_dm', 100)";
const DISPOSITIONS =
  "SELECT channel_identity_id AS ci, outcome, error_code FROM zalo_dm_recipient_deliveries WHERE event_id = $1";
type Row = Record<string, unknown>;
const logged: string[] = [];
let stub: ZaloStub;

beforeAll(async () => {
  for (const level of ["log", "info", "warn", "error", "debug"] as const)
    vi.spyOn(console, level).mockImplementation((...a: unknown[]) => {
      logged.push(a.map(String).join(" "));
    });
  stub = await startZaloStub();
  Object.assign(process.env, { ENCRYPTION_KEY: KEY, APP_BASE_URL: "https://app.test" });
  process.env.ZALO_BOT_API_BASE = stub.base;
  delete process.env.KMS_PROVIDER;
  delete process.env.KMS_KEY_ID;
  __resetAuthSecretCacheForTest();
});
afterAll(async () => {
  await stub?.close();
  vi.restoreAllMocks();
});

interface Ctx {
  worker: pg.Pool;
  workerUrl: string;
  verify: pg.Client;
  teardown: () => Promise<void>;
}
async function setupZaloDmContext(dbName: string): Promise<Ctx> {
  const base = process.env.DATABASE_URL_TEST;
  if (!base) throw new Error("DATABASE_URL_TEST is required");
  const admin = new pg.Client({ connectionString: base });
  const migrationUrl = testUrl(base, { db: dbName });
  const workerUrl = testUrl(base, { db: dbName, user: "app_worker", password: ROLE_PW.app_worker });
  let created = false;
  let verify: pg.Client | undefined;
  let worker: pg.Pool | undefined;
  let passwords: TestRolePasswordLease | undefined;
  const teardown = async () => {
    const closed = await Promise.allSettled([worker?.end(), verify?.end()]);
    const released = await Promise.allSettled([passwords?.release()]); // after app_worker closed
    const errors = [...closed, ...released]
      .filter((r) => r.status === "rejected")
      .map((r) => r.reason);
    if (errors.length) throw new AggregateError(errors, "Failed to close fixture connections");
    if (!created) return;
    const cleanup = new pg.Client({ connectionString: base });
    try {
      await cleanup.connect();
      await cleanup.query(`DROP DATABASE IF EXISTS ${dbName}`);
      created = false;
    } finally {
      await cleanup.end();
    }
  };
  const errors: unknown[] = [];
  try {
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
    await admin.query(`CREATE DATABASE ${dbName}`);
    created = true;
    await withJobDefinerLock(base, async () => {
      await bootstrapJobDefiner(admin);
      await migrate(migrationUrl);
    });
    passwords = await setAppWorkerPasswordRaceSafe(base);
    verify = new pg.Client({ connectionString: migrationUrl });
    await verify.connect();
    worker = new pg.Pool({ connectionString: workerUrl });
  } catch (error) {
    errors.push(error);
  } finally {
    await admin.end().catch((error: unknown) => errors.push(error));
  }
  if (errors.length) {
    await teardown().catch((error: unknown) => errors.push(error));
    throw errors.length === 1 ? errors[0] : new AggregateError(errors, "Fixture setup failed");
  }
  return { worker: worker!, workerUrl, verify: verify!, teardown };
}

// One row per Z-6 class, the SHIPPED mapping: [acceptance ID, stub reply, verdict, code].
const ROWS: [string, StubReply, "retry" | "dlq" | "terminal", string][] = [
  ["A-8", { status: 401 }, "dlq", "zalo_unauthorized"],
  ["A-9", { status: 429 }, "retry", "zalo_rate_limited"],
  ["A-10", { status: 503 }, "retry", "zalo_server_error"],
  ["A-11", { status: 404 }, "terminal", "zalo_rejected"],
  ["A-12", { okFalse: 401 }, "dlq", "zalo_unauthorized"],
  ["A-13", { okFalse: 429 }, "retry", "zalo_rate_limited"],
  ["A-14", { okFalse: 500 }, "retry", "zalo_server_error"],
  ["A-15", { okFalse: 403 }, "terminal", "zalo_rejected"],
  ["A-16", { okFalse: null }, "terminal", "zalo_rejected"],
  ["A-17", "no_ok", "terminal", "zalo_bad_response"],
  ["A-18", "malformed", "terminal", "zalo_bad_response"],
  ["A-19", "oversize", "terminal", "zalo_bad_response"],
  ["A-20", "cut", "terminal", "zalo_bad_response"],
  ["A-21", "slow", "retry", "zalo_timeout"],
  ["A-22", "reset", "retry", "zalo_network"],
];

describe("zalo_dm DD-138 Z-6 error mapping (0057 definers, Zalo stub, as app_worker)", () => {
  let ctx: Ctx;
  let deliver: ReturnType<typeof createZaloDmDeliver>;
  const q = async (sql: string, p: unknown[] = []) =>
    (await ctx.verify.query(sql, p)).rows as Row[];
  const one = async (sql: string, p: unknown[] = []) => (await q(sql, p))[0]!;
  beforeAll(async () => {
    ctx = await setupZaloDmContext("plexco_bot_zalo_dm_matrix");
    await q("SELECT outbox_projector_set_enabled('zalo_dm', $1)", [true]);
    deliver = createZaloDmDeliver({ db: ctx.worker, sendTimeoutMs: 300 }); // "slow" waits 1 s
  });
  afterAll(async () => ctx?.teardown());

  type Club = Record<"tenant" | "bot" | "session", string>;
  async function club() {
    const t = await one(
      "INSERT INTO tenants (name, slug, status, locale) VALUES ($1, $1, 'active', $2) RETURNING id",
      [`zdmw-${randomUUID()}`, "vi"],
    );
    const b = await one(
      `INSERT INTO zalo_bots (tenant_id, bot_token_enc, webhook_token, status, webhook_secret_enc, key_version)
       VALUES ($1, 'unset', $2, $3, '\\x01', $4) RETURNING id`,
      [t.id, randomUUID(), "active", connectorKeyVersion()],
    );
    const binding = { tenantId: String(t.id), botId: String(b.id), purpose: "bot_token" as const };
    const { enc } = await encryptConnectorSecret(TOKEN, binding);
    await q("UPDATE zalo_bots SET bot_token_enc = $2 WHERE id = $1", [b.id, blobToText(enc)]);
    const s = await one(
      `INSERT INTO sessions (tenant_id, sport_id, starts_at, ends_at, timezone, status, venue_name, price_amount)
       SELECT $1, id, now() + interval '1 day', now() + interval '1 day 2 hours', 'Asia/Ho_Chi_Minh', $2,
              'Private Hall', 120000
         FROM sports WHERE key = 'badminton' RETURNING id`,
      [t.id, "open"],
    );
    return { tenant: t.id, bot: b.id, session: s.id } as Club;
  }
  /** A linked active member (a Zalo identity on the club bot, an active roster row); returns its ci. */
  async function player(c: Club, chat: string) {
    const p = await one("INSERT INTO persons (display_name) VALUES ('Zdm Worker') RETURNING id");
    const m = await one(
      "INSERT INTO memberships (tenant_id, person_id, status) VALUES ($1, $2, 'active') RETURNING id",
      [c.tenant, p.id],
    );
    const binding = { tenantId: c.tenant, botId: c.bot, purpose: "channel_user" as const };
    const { enc } = await encryptConnectorSecret(chat, binding);
    const r = await one(
      `INSERT INTO channel_identities (person_id, platform, platform_user_id_enc, platform_user_lookup_hash, status, zalo_bot_id)
       VALUES ($1, 'zalo', $2, $3, 'active', $4) RETURNING id`,
      [p.id, enc, randomUUID(), c.bot],
    );
    await q(
      `INSERT INTO players (tenant_id, session_id, membership_id, status, waitlist_position, joined_at)
       VALUES ($1, $2, $3, $4, $5, now() - interval '1 hour') RETURNING id`,
      [c.tenant, c.session, m.id, "active", null],
    );
    return r.id as string;
  }
  const insertEvent = async (c: Club, type: string, payload: Row) =>
    one(
      `INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, sequence, type, payload)
       VALUES ($1, 'session', $2, (SELECT coalesce(max(sequence), 0) + 1 FROM outbox_events WHERE aggregate_id = $2), $3, $4)
       RETURNING id, sequence, created_at`,
      [c.tenant, c.session, type, { session_id: c.session, ...payload }],
    );
  async function claim(c: Club, type: string, payload: Row = {}): Promise<ClaimedDeliveryJob> {
    const ev = await insertEvent(c, type, payload);
    await ctx.worker.query("SELECT job_prepare_projector_delivery($1, 'zalo_dm')", [ev.id]);
    const { rows } = await ctx.worker.query(CLAIM_BATCH);
    const claimToken = (rows as Row[]).find((r) => r.event_id === ev.id)?.claim_token as string;
    const ids = { eventId: String(ev.id), tenantId: c.tenant, projector: "zalo_dm", claimToken };
    const event = { eventType: type, aggregateType: "session", aggregateId: c.session };
    const rest = { sequence: Number(ev.sequence), tenantId: c.tenant, createdAt: new Date() };
    const body = { session_id: c.session, ...payload };
    return { ...ids, attempts: 0, event: { ...event, ...rest, payload: body } };
  }

  it.each(ROWS)("%s: stub reply %j -> %s %s (L47)", async (_id, reply, verdict, code) => {
    const c = await club();
    const chat = `chat-${randomUUID()}`;
    const ci = await player(c, chat);
    stub.script.set(chat, reply);
    const j = await claim(c, "session.updated", { changed_fields: ["starts_at"] });
    const terminal = verdict === "terminal";
    const want: DeliveryOutcome = terminal
      ? { result: "delivered", providerRef: "sent" }
      : { result: verdict, errorCode: code };
    expect(await deliver(j)).toEqual(want);
    const recorded = terminal ? [{ ci, outcome: "terminal", error_code: code }] : [];
    expect(await q(DISPOSITIONS, [j.eventId])).toEqual(recorded);
    expect(stub.calls.filter((call) => call.chatId === chat)).toHaveLength(1); // never resent
  });

  it("A-8..A-22: no captured console line carries the fixture bot token (L47)", () => {
    expect(logged.filter((line) => line.includes(TOKEN))).toEqual([]);
  });
});

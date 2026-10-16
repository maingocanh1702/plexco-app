import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { migrate } from "@plexco/db";
import {
  __resetAuthSecretCacheForTest,
  blobToText,
  connectorKeyVersion,
  encryptConnectorSecret,
  openConnectorSecret,
} from "@plexco/db/connector-crypto";
import { sendMessage } from "@plexco/db/zalo-bot-api";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runDispatchCycle, type ClaimedDeliveryJob, type DeliveryOutcome } from "../dispatcher.js";
import type { Queryable } from "../projector-registry.js";
import {
  ROLE_PW,
  bootstrapJobDefiner,
  setAppWorkerPasswordRaceSafe,
  testUrl,
  withJobDefinerLock,
  type TestRolePasswordLease,
} from "../test-db.js";
import { startZaloStub, type StubReply, type ZaloStub } from "../test-zalo-stub.js";
import { renderZaloDm } from "./zalo-dm-templates.js";
import { __endZaloDmPoolForTest, createZaloDmDeliver, deliverZaloDm } from "./zalo-dm.js";

// Fixture secrets only: the web tests' "k" x 32 key and a token that only the stub ever sees.
const KEY = Buffer.alloc(32, "k").toString("base64");
const TOKEN = "654321:FIXTURE-worker-token";
const APP = "https://app.test";
const CLAIM_BATCH = "SELECT * FROM claim_projector_delivery_batch('zalo_dm', 100)";
const DISPOSITIONS =
  "SELECT channel_identity_id AS ci, outcome, error_code FROM zalo_dm_recipient_deliveries WHERE event_id = $1";
const AUDITS =
  "SELECT detail FROM routing_audit WHERE tenant_id = $1 AND action = 'zalo.secret_decrypt'";
const delivered = (providerRef: string): DeliveryOutcome => ({ result: "delivered", providerRef });
const retry = (errorCode: string): DeliveryOutcome => ({ result: "retry", errorCode });
const dlq = (errorCode: string): DeliveryOutcome => ({ result: "dlq", errorCode });
type Row = Record<string, unknown>;
type Job = ClaimedDeliveryJob;
const logged: string[] = [];
let stub: ZaloStub;
const chats = (from = 0) => stub.calls.slice(from).map((call) => call.chatId);

beforeAll(async () => {
  for (const level of ["log", "info", "warn", "error", "debug"] as const)
    vi.spyOn(console, level).mockImplementation((...a: unknown[]) => {
      logged.push(a.map(String).join(" "));
    });
  stub = await startZaloStub();
  Object.assign(process.env, { ENCRYPTION_KEY: KEY, APP_BASE_URL: APP });
  process.env.ZALO_BOT_API_BASE = stub.base;
  delete process.env.KMS_PROVIDER;
  delete process.env.KMS_KEY_ID;
  __resetAuthSecretCacheForTest();
});
afterAll(async () => {
  await stub?.close();
  vi.restoreAllMocks();
});

const job = (eventType: string, payload: unknown): Job => {
  const ids = { eventId: randomUUID(), tenantId: randomUUID(), claimToken: randomUUID() };
  const event = { eventType, aggregateType: "session", aggregateId: randomUUID(), sequence: 1 };
  const rest = { tenantId: randomUUID(), payload, createdAt: new Date() };
  return { ...ids, projector: "zalo_dm", attempts: 0, event: { ...event, ...rest } };
};

describe("zalo_dm projector before any DB call (Z-4, Z-10, Z-12)", () => {
  const noDb = { query: vi.fn().mockRejectedValue(new Error("injected definer error")) };
  const deliver = createZaloDmDeliver({ db: noDb as unknown as Queryable });
  const go = (eventType: string, payload: unknown) => deliver(job(eventType, payload));
  it.each([
    ["A2 other fields only", ["notes", "capacity"], delivered("noop_irrelevant_fields")],
    ["A32 changed_fields not an array", "starts_at", dlq("malformed_payload")],
    ["A32 a non-string entry", ["starts_at", 1], dlq("malformed_payload")],
  ])("%s", async (_name, fields, expected) => {
    noDb.query.mockClear();
    await expect(go("session.updated", { changed_fields: fields })).resolves.toEqual(expected);
    expect(noDb.query).not.toHaveBeenCalled();
  });

  it("A6: an announcement without a uuid requested_by_person_id; an unknown event type", async () => {
    noDb.query.mockClear();
    const announce = (payload: unknown) => go("session.announcement_requested", payload);
    for (const payload of [{ channel: "zalo" }, { requested_by_person_id: "host" }, null])
      await expect(announce(payload)).resolves.toEqual(dlq("no_requester"));
    const promoted = go("player.promoted", { player_id: randomUUID() });
    await expect(promoted).resolves.toEqual(dlq("unexpected_event_type"));
    expect(noDb.query).not.toHaveBeenCalled();
    expect(stub.calls).toHaveLength(0);
  });

  it("Z-13: an Invalid Date start time renders without throwing", () => {
    const v = { startsAt: new Date(Number.NaN), timeZone: "UTC", fields: [], link: "/l" };
    expect(() => renderZaloDm("cancelled", v)).not.toThrow();
  });

  it("A26/Z-4: bad key material, APP_BASE_URL or ZALO_BOT_API_BASE fail closed before any DB call", async () => {
    noDb.query.mockClear();
    const saved = { ...process.env };
    type EnvCase = [Record<string, string | undefined>, string];
    const host = "bot-api.zaloplatforms.com";
    const bases = ["http://example.com", "ftp://127.0.0.1", "https://zalo.test", `http://${host}`];
    const more = [`https://u:p@${host}`, `https://${host}/x`, `https://${host}/?q=1`];
    const cases: EnvCase[] = [
      [{ ENCRYPTION_KEY: undefined }, "bot_unavailable"],
      [{ ENCRYPTION_KEY: Buffer.alloc(8, "k").toString("base64") }, "bot_unavailable"],
      [{ APP_BASE_URL: undefined }, "config_missing"],
      [{ APP_BASE_URL: "ftp://app.test" }, "config_missing"],
      ...[...bases, ...more].map((b): EnvCase => [{ ZALO_BOT_API_BASE: b }, "config_missing"]),
    ];
    const startsAt = { changed_fields: ["starts_at"] };
    for (const [patch, code] of cases) {
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      __resetAuthSecretCacheForTest();
      await expect(go("session.updated", startsAt)).resolves.toEqual(dlq(code));
      Object.assign(process.env, saved);
    }
    __resetAuthSecretCacheForTest();
    expect(noDb.query).not.toHaveBeenCalled();
  });

  it("A31: an injected definer error is a retry, never a throw", async () => {
    await expect(go("session.cancelled", {})).resolves.toEqual(retry("targets_read_failed"));
  });
});

// --- DB fixture: a copy of setupDispatcherContext (dispatcher.test.ts), the #62 harness as is.
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

describe("zalo_dm projector against the 0057 definers and the stub (as app_worker)", () => {
  let ctx: Ctx;
  let deliver: ReturnType<typeof createZaloDmDeliver>;
  const q = async (sql: string, p: unknown[] = []) =>
    (await ctx.verify.query(sql, p)).rows as Row[];
  const one = async (sql: string, p: unknown[] = []) => (await q(sql, p))[0]!;
  const setEnabled = (on: boolean) => q("SELECT outbox_projector_set_enabled('zalo_dm', $1)", [on]);
  /** Deliver `j` through `d` (by default the shared deliver with a 300 ms send timeout). */
  const expectOutcome = async (j: Job | Promise<Job>, want: DeliveryOutcome, d = deliver) =>
    expect(await d(await j)).toEqual(want);
  beforeAll(async () => {
    ctx = await setupZaloDmContext("plexco_bot_zalo_dm");
    await setEnabled(true);
    deliver = createZaloDmDeliver({ db: ctx.worker, sendTimeoutMs: 300 });
  });
  afterAll(async () => ctx?.teardown());

  type Club = Record<"tenant" | "bot" | "session", string>;
  async function club(o: { locale?: string; status?: string; bot?: string; kv?: string } = {}) {
    const t = await one(
      "INSERT INTO tenants (name, slug, status, locale) VALUES ($1, $1, 'active', $2) RETURNING id",
      [`zdmw-${randomUUID()}`, o.locale ?? "vi"],
    );
    const b = await one(
      `INSERT INTO zalo_bots (tenant_id, bot_token_enc, webhook_token, status, webhook_secret_enc, key_version)
       VALUES ($1, 'unset', $2, $3, '\\x01', $4) RETURNING id`,
      [t.id, randomUUID(), o.bot ?? "active", o.kv ?? connectorKeyVersion()],
    );
    const binding = { tenantId: String(t.id), botId: String(b.id), purpose: "bot_token" as const };
    const { enc } = await encryptConnectorSecret(TOKEN, binding);
    await q("UPDATE zalo_bots SET bot_token_enc = $2 WHERE id = $1", [b.id, blobToText(enc)]);
    const s = await one(
      `INSERT INTO sessions (tenant_id, sport_id, starts_at, ends_at, timezone, status, venue_name, price_amount)
       SELECT $1, id, now() + interval '1 day', now() + interval '1 day 2 hours', 'Asia/Ho_Chi_Minh', $2,
              'Private Hall', 120000
         FROM sports WHERE key = 'badminton' RETURNING id`,
      [t.id, o.status ?? "open"],
    );
    return { tenant: t.id, bot: b.id, session: s.id } as Club;
  }
  /** A member with (chat) or without (null) a Zalo identity on the club bot; status "none" = no roster row. */
  async function player(c: Club, chat: string | null, status = "active") {
    const p = await one("INSERT INTO persons (display_name) VALUES ('Zdm Worker') RETURNING id");
    const m = await one(
      "INSERT INTO memberships (tenant_id, person_id, status) VALUES ($1, $2, 'active') RETURNING id",
      [c.tenant, p.id],
    );
    let ci: string | null = null;
    if (chat) {
      const binding = { tenantId: c.tenant, botId: c.bot, purpose: "channel_user" as const };
      const { enc } = await encryptConnectorSecret(chat, binding);
      const r = await one(
        `INSERT INTO channel_identities (person_id, platform, platform_user_id_enc, platform_user_lookup_hash, status, zalo_bot_id)
         VALUES ($1, 'zalo', $2, $3, 'active', $4) RETURNING id`,
        [p.id, enc, randomUUID(), c.bot],
      );
      ci = r.id as string;
    }
    if (status !== "none")
      await q(
        `INSERT INTO players (tenant_id, session_id, membership_id, status, waitlist_position, joined_at)
         VALUES ($1, $2, $3, $4, $5, now() - interval '1 hour')`,
        [c.tenant, c.session, m.id, status, status === "waitlisted" ? 1 : null],
      );
    return { person: p.id as string, ci, chat };
  }
  type Member = Awaited<ReturnType<typeof player>>;
  const byIdentity = (l: Member, r: Member) => (l.ci! < r.ci! ? -1 : 1); // the definer's ORDER BY
  const roster = async (c: Club, n: number) => {
    const members: Member[] = [];
    for (let i = 0; i < n; i++) members.push(await player(c, `chat-${randomUUID()}`));
    return members.sort(byIdentity);
  };
  const insertEvent = async (c: Club, type: string, payload: Row) =>
    one(
      `INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, sequence, type, payload)
       VALUES ($1, 'session', $2, (SELECT coalesce(max(sequence), 0) + 1 FROM outbox_events WHERE aggregate_id = $2), $3, $4)
       RETURNING id, sequence, created_at`,
      [c.tenant, c.session, type, { session_id: c.session, ...payload }],
    );
  async function claim(c: Club, type: string, payload: Row = {}): Promise<Job> {
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
  const updated = (c: Club, field = "starts_at") =>
    claim(c, "session.updated", { changed_fields: [field] });
  const dispositions = (j: Job) => q(DISPOSITIONS, [j.eventId]);
  const audits = (c: Club) => q(AUDITS, [c.tenant]);

  it("A1/A19/A28 through the dispatcher: one Vietnamese DM per active linked roster player", async () => {
    const c = await club();
    await roster(c, 2);
    for (const status of ["waitlisted", "left"]) await player(c, `chat-${status}`, status);
    await player(c, null);
    const ev = await insertEvent(c, "session.updated", {
      changed_fields: ["starts_at", "venue_name", "price_amount", "notes"],
    });
    await runDispatchCycle(ctx.worker, { projectors: new Map([["zalo_dm", deliver]]) });
    expect(
      await q("SELECT status, provider_ref FROM projector_deliveries WHERE event_id = $1", [ev.id]),
    ).toEqual([{ status: "delivered", provider_ref: "sent" }]);
    expect(stub.calls).toHaveLength(2);
    const viText = /^Buổi chơi lúc .+ đã thay đổi giờ, địa điểm, giá\. Xem chi tiết: /;
    for (const call of stub.calls) {
      expect(call.token).toBe(TOKEN);
      expect(call.text).toMatch(viText);
      expect(call.text.endsWith(`${APP}/c/${c.tenant}/sessions/${c.session}`)).toBe(true);
    }
    const purposes = (await audits(c)).map((r) => (r.detail as Row).purpose);
    expect(purposes.sort()).toEqual(["bot_token", "channel_user"]);
  });

  it("A3/A19: session.cancelled reaches the roster in English for an 'en' club", async () => {
    const c = await club({ locale: "en", status: "cancelled" });
    await player(c, "chat-en");
    const from = stub.calls.length;
    const j = claim(c, "session.cancelled", { cancel_reason: "host" });
    await expectOutcome(j, delivered("sent"));
    expect(chats(from)).toEqual(["chat-en"]);
    const enText = /^The session at .+ was cancelled\. See: https:\/\/app\.test\/c\//;
    expect(stub.calls[from]!.text).toMatch(enText);
  });

  it("A4: nobody active and linked -> noop_no_recipients, no audit, no send, never retry or dlq", async () => {
    const c = await club();
    await player(c, null);
    await player(c, "chat-a4-wait", "waitlisted");
    const from = stub.calls.length;
    await expectOutcome(updated(c, "ends_at"), delivered("noop_no_recipients"));
    expect(stub.calls.length).toBe(from);
    expect(await audits(c)).toEqual([]);
  });

  it("A5/A7: an announcement goes to the requesting host only; an unlinked requester dead-letters", async () => {
    const c = await club();
    const host = await player(c, "chat-host", "none");
    await player(c, "chat-a5");
    const from = stub.calls.length;
    const announce = (by: string) =>
      claim(c, "session.announcement_requested", { channel: "zalo", requested_by_person_id: by });
    await expectOutcome(announce(host.person), delivered("sent"));
    expect(chats(from)).toEqual(["chat-host"]);
    const text = stub.calls[from]!.text;
    expect(text).toMatch(
      /^Tin mời để chuyển tiếp:\nMời tham gia buổi chơi lúc .+: https:\/\/app\.test\/c\//,
    );
    expect(text).not.toMatch(/Private Hall|120[.,]?000/);
    const unlinked = await player(c, null, "none");
    await expectOutcome(announce(unlinked.person), dlq("requester_unlinked"));
    expect(stub.calls.length).toBe(from + 1);
  });

  it("A9: other event types need no zalo_dm delivery while zalo_dm is enabled", async () => {
    const c = await club();
    const cases = [
      ["session.published", []],
      ["payment.settled", []],
      ["session.updated", ["zalo_dm"]],
    ];
    for (const [type, expected] of cases) {
      const ev = await insertEvent(c, type as string, {});
      const r = await ctx.worker.query("SELECT outbox_required_projectors($1) AS p", [ev.id]);
      expect(r.rows[0].p).toEqual(expected);
    }
  });

  it("A10: an unusable bot dead-letters bot_unavailable with no send; a tampered token is audited first", async () => {
    const from = stub.calls.length;
    for (const o of [{ bot: "connecting" }, { bot: "revoked" }, { kv: "other-key-version" }]) {
      const c = await club(o);
      await player(c, "chat-a10");
      await expectOutcome(updated(c), dlq("bot_unavailable"));
      expect(await audits(c)).toEqual([]);
    }
    const c = await club();
    await player(c, "chat-a10-tampered");
    const junk = blobToText(randomBytes(48));
    await q("UPDATE zalo_bots SET bot_token_enc = $2 WHERE id = $1", [c.bot, junk]);
    await expectOutcome(updated(c), dlq("bot_unavailable"));
    expect(await audits(c)).toHaveLength(2);
    expect(stub.calls.length).toBe(from);
  });

  it("A11: an audit insert failure means no ciphertext, no decrypt and no send", async () => {
    const c = await club();
    await player(c, "chat-a11");
    const open = vi.fn(openConnectorSecret);
    await q(
      "CREATE FUNCTION zdmw_block_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'audit blocked'; END$$",
    );
    await q(
      "CREATE TRIGGER zdmw_block_audit BEFORE INSERT ON routing_audit FOR EACH ROW EXECUTE FUNCTION zdmw_block_audit()",
    );
    const from = stub.calls.length;
    try {
      const audited = createZaloDmDeliver({ db: ctx.worker, open });
      await expectOutcome(updated(c), retry("targets_read_failed"), audited);
    } finally {
      await q("DROP TRIGGER zdmw_block_audit ON routing_audit");
      await q("DROP FUNCTION zdmw_block_audit()");
    }
    expect(open).not.toHaveBeenCalled();
    expect(stub.calls.length).toBe(from);
  });

  it("A12/A31: 500, 429, a slow reply and a reset connection retry; nothing is recorded", async () => {
    const c = await club();
    await player(c, "chat-a12");
    const replies: [StubReply, string][] = [
      [{ status: 500 }, "zalo_server_error"],
      [{ status: 429 }, "zalo_rate_limited"],
      ["slow", "zalo_timeout"],
      ["reset", "zalo_network"],
    ];
    for (const [reply, code] of replies) {
      stub.script.set("chat-a12", reply);
      const j = await updated(c);
      await expectOutcome(j, retry(code));
      expect(await dispositions(j)).toEqual([]);
    }
  });

  it("A13/A17: per-recipient terminal replies are recorded, the others still sent, nothing resent", async () => {
    const c = await club();
    const script: [string, StubReply, string | null][] = [
      ["chat-ok", "ok", null],
      ["chat-403", { status: 403 }, "zalo_rejected"],
      ["chat-env-403", { okFalse: 403 }, "zalo_rejected"],
      ["chat-no-code", { okFalse: null }, "zalo_rejected"],
      ["chat-no-ok", "no_ok", "zalo_bad_response"],
      ["chat-bad-json", "malformed", "zalo_bad_response"],
      ["chat-oversize", "oversize", "zalo_bad_response"],
      ["chat-cut-after-200", "cut", "zalo_bad_response"],
    ];
    const chatOf = new Map<unknown, string>();
    for (const [chat, reply] of script) {
      stub.script.set(chat, reply);
      chatOf.set((await player(c, chat)).ci, chat);
    }
    const j = await updated(c, "venue_address");
    const from = stub.calls.length;
    await expectOutcome(j, delivered("sent"));
    const rows = await dispositions(j);
    expect(Object.fromEntries(rows.map((r) => [chatOf.get(r.ci), r.error_code]))).toEqual(
      Object.fromEntries(script.map(([chat, , code]) => [chat, code])),
    );
    expect(rows.every((r) => (r.outcome === "sent") === (r.error_code === null))).toBe(true);
    await expectOutcome(j, delivered("noop_all_recorded"));
    expect(stub.calls.length).toBe(from + script.length);
  });

  it("A14/A15: a 401 dead-letters and a 500 retries mid-roster; the next attempt sends only the unrecorded", async () => {
    const cases: [StubReply, DeliveryOutcome][] = [
      [{ status: 401 }, dlq("zalo_unauthorized")],
      [{ status: 500 }, retry("zalo_server_error")],
    ];
    for (const [reply, outcome] of cases) {
      const c = await club();
      const [x, y, z] = await roster(c, 3);
      stub.script.set(y!.chat!, reply);
      const j = await updated(c);
      let from = stub.calls.length;
      await expectOutcome(j, outcome);
      expect(chats(from)).toEqual([x!.chat, y!.chat]);
      stub.script.delete(y!.chat!);
      from = stub.calls.length;
      await expectOutcome(j, delivered("sent"));
      expect(chats(from)).toEqual([y!.chat, z!.chat]);
    }
  });

  it("A16: a record failure after a send retries; the next attempt resends exactly that one DM", async () => {
    const c = await club();
    const [x, y] = await roster(c, 2);
    let failed = false;
    const flaky = {
      query: (sql: string, params?: unknown[]) => {
        if (failed || !sql.includes("zalo_dm_record_recipient"))
          return ctx.worker.query(sql, params);
        failed = true;
        return Promise.reject(new Error("record down"));
      },
    } as unknown as Queryable;
    const j = await updated(c, "timezone");
    const from = stub.calls.length;
    await expectOutcome(j, retry("record_failed"), createZaloDmDeliver({ db: flaky }));
    await expectOutcome(j, delivered("sent"));
    expect(chats(from)).toEqual([x!.chat, x!.chat, y!.chat]);
  });

  it("A21: disabling zalo_dm between two sends stops the attempt", async () => {
    const c = await club();
    const [x] = await roster(c, 2);
    const send: typeof sendMessage = async (...args) => {
      await sendMessage(...args);
      await setEnabled(false);
    };
    const j = await updated(c);
    const from = stub.calls.length;
    const stopping = createZaloDmDeliver({ db: ctx.worker, send });
    try {
      await expectOutcome(j, retry("projector_disabled"), stopping);
    } finally {
      await setEnabled(true);
    }
    expect(chats(from)).toEqual([x!.chat]);
  });

  it("A25/Z-12: a stale event is a no-op with no audit and no send", async () => {
    const c = await club({ status: "cancelled" });
    await player(c, "chat-a25");
    const from = stub.calls.length;
    await expectOutcome(updated(c), delivered("noop_stale"));
    expect(stub.calls.length).toBe(from);
    expect(await audits(c)).toEqual([]);
  });

  it("A27: the 120 s attempt budget stops the remainder", async () => {
    const c = await club();
    const [x] = await roster(c, 2);
    let clock = 0;
    const send: typeof sendMessage = async (...args) => {
      await sendMessage(...args);
      clock = 120_001;
    };
    const j = await updated(c);
    const from = stub.calls.length;
    const budgeted = createZaloDmDeliver({ db: ctx.worker, send, now: () => clock });
    await expectOutcome(j, retry("send_budget_exhausted"), budgeted);
    expect(chats(from)).toEqual([x!.chat]);
  });

  it("A31/Z-7: a lost claim retries; an undecryptable recipient is terminal and the rest are sent", async () => {
    const c = await club();
    await player(c, "chat-a31");
    const bad = await player(c, "chat-a31-bad");
    const scramble = "UPDATE channel_identities SET platform_user_id_enc = $2 WHERE id = $1";
    await q(scramble, [bad.ci, randomBytes(40)]);
    const j = await updated(c, "price_amount");
    await expectOutcome({ ...j, claimToken: randomUUID() }, retry("claim_lost"));
    const from = stub.calls.length;
    await expectOutcome(j, delivered("sent"));
    expect(chats(from)).toEqual(["chat-a31"]);
    const row = (await dispositions(j)).find((r) => r.ci === bad.ci);
    expect(row).toMatchObject({ outcome: "terminal", error_code: "recipient_undecryptable" });
  });

  it("Z-15: the registry entry needs DATABASE_URL_DIRECT, then delivers through its own pool", async () => {
    const c = await club();
    await player(c, "chat-z15");
    const j = await updated(c);
    const saved = process.env.DATABASE_URL_DIRECT;
    const from = stub.calls.length;
    try {
      delete process.env.DATABASE_URL_DIRECT;
      await expectOutcome(j, dlq("config_missing"), deliverZaloDm);
      process.env.DATABASE_URL_DIRECT = ctx.workerUrl;
      await expectOutcome(j, delivered("sent"), deliverZaloDm);
    } finally {
      await __endZaloDmPoolForTest();
      if (saved === undefined) delete process.env.DATABASE_URL_DIRECT;
      else process.env.DATABASE_URL_DIRECT = saved;
    }
    expect(chats(from)).toEqual(["chat-z15"]);
  });

  it("A18: the bot token and chat ids never reach logs, audit details or stored codes", async () => {
    const stored = JSON.stringify([
      await q("SELECT error_code, provider_ref FROM projector_deliveries"),
      await q("SELECT error_code FROM zalo_dm_recipient_deliveries"),
      await q("SELECT detail FROM routing_audit"),
    ]);
    for (const secret of [TOKEN, ...new Set(chats())]) {
      expect(logged.join("\n")).not.toContain(secret);
      expect(stored).not.toContain(secret);
    }
    const keys = await q(
      "SELECT DISTINCT jsonb_object_keys(detail) AS k FROM routing_audit WHERE action = 'zalo.secret_decrypt'",
    );
    expect(keys.map((r) => r.k).sort()).toEqual(["botId", "purpose"]);
  });
});

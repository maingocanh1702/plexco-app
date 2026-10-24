import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import pg from "pg";
import { migrate } from "@plexco/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
// @ts-expect-error -- the owner enable CLI is an untyped .mjs; DA-10 reads its two bound exports
import * as enableCli from "../../../scripts/outbox-projector-enable.mjs";
import {
  MAX_DELIVERY_ATTEMPTS,
  RETRY_BASE_MS,
  ZALO_DM_MAX_AGE_MINUTES,
  runDispatchCycle,
  type ClaimedDeliveryJob,
  type DeliverFn,
} from "./dispatcher.js";
import { PROJECTORS } from "./projectors/index.js";
import { deliverPublicSessions } from "./projectors/public-sessions.js";
import {
  ROLE_PW,
  bootstrapJobDefiner,
  setAppWorkerPasswordRaceSafe,
  testUrl,
  withJobDefinerLock,
  type TestRolePasswordLease,
} from "./test-db.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const delivered: DeliverFn = async () => ({ result: "delivered" });
const CLI = path.join(HERE, "..", "..", "..", "scripts", "outbox-dlq-replay.mjs");

/** Runs the owner CLI (D-10) as a real process; DATABASE_URL_MIGRATION is its only credential. */
async function runCli(args: string[], url: string) {
  const env = { ...process.env, DATABASE_URL_MIGRATION: url };
  try {
    const { stdout, stderr } = await promisify(execFile)(process.execPath, [CLI, ...args], { env });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? -1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

describe("scripts/outbox-dlq-replay.mjs (D-10)", () => {
  it("refuses bad arguments with exit 2 before connecting, and never prints the credential", async () => {
    const url = "postgres://plexco:cli_secret_pw@127.0.0.1:9/none";
    const refused = [
      [],
      ["drop"],
      ["replay", "--event", "not-a-uuid", "--projector", "web_realtime"],
      ["replay", "--event", randomUUID()],
      ["list", "--limit", "501"],
      ["list", "--projector", "Bad-Name"],
    ];
    for (const args of refused) {
      const result = await runCli(args, url);
      expect(result.code, args.join(" ")).toBe(2);
      expect(result.stderr).toContain("invalid_argument");
    }
    const down = await runCli(["list"], url);
    expect(down.code).toBe(1);
    expect(down.stdout + down.stderr).not.toContain("cli_secret_pw");
  });
});

describe("projector modules (D-5, D-8, A24)", () => {
  it("maps exactly the three registry names to the real projectors; public_sessions dead-letters config_missing with no I/O when unconfigured", async () => {
    const clientQuery = vi.spyOn(pg.Client.prototype, "query");
    const poolQuery = vi.spyOn(pg.Pool.prototype, "query");
    vi.stubEnv("DATABASE_URL_DIRECT", "");
    try {
      expect([...PROJECTORS.keys()]).toEqual(["public_sessions", "web_realtime", "zalo_dm"]);
      // All three are real projectors, each tested in its own file: web_realtime (P3-S3 L5),
      // zalo_dm (P3-S3 L4) and public_sessions (P3-S7 L10, projectors/public-sessions.test.ts).
      expect(PROJECTORS.get("public_sessions")).toBe(deliverPublicSessions);
      const job = { eventId: "e", projector: "p", attempts: 0 } as unknown as ClaimedDeliveryJob;
      await expect(deliverPublicSessions(job)).resolves.toEqual({
        result: "dlq",
        errorCode: "config_missing",
      });
      expect(clientQuery).not.toHaveBeenCalled();
      expect(poolQuery).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
    }
  });

  it("ships no stub required set: no stub_projector, REQUIRED_PROJECTORS or STUB_PROJECTOR outside tests", () => {
    const shipped = readdirSync(HERE, { recursive: true })
      .map(String)
      .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
      .filter((file) => !["test-db.ts", "test-harness.ts"].includes(file));
    expect(shipped).toContain(path.join("projectors", "index.ts"));
    for (const file of shipped) {
      const source = readFileSync(path.join(HERE, file), "utf8");
      expect(source, file).not.toMatch(/stub_projector|REQUIRED_PROJECTORS|STUB_PROJECTOR/);
    }
  });
});

describe("registry-driven dispatch against a real database (A4, A5, A9, A24)", () => {
  const dbName = "plexco_bot_projector_registry";
  const base = process.env.DATABASE_URL_TEST ?? "";
  let verify: pg.Client;
  let workerPool: pg.Pool;
  let passwords: TestRolePasswordLease | undefined;
  let tenantId = "";

  beforeAll(async () => {
    if (!base) throw new Error("DATABASE_URL_TEST is required");
    const admin = new pg.Client({ connectionString: base });
    await admin.connect();
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
      await admin.query(`CREATE DATABASE ${dbName}`);
      await withJobDefinerLock(base, async () => {
        await bootstrapJobDefiner(admin);
        await migrate(testUrl(base, { db: dbName }));
      });
    } finally {
      await admin.end();
    }
    passwords = await setAppWorkerPasswordRaceSafe(base);
    verify = new pg.Client({ connectionString: testUrl(base, { db: dbName }) });
    await verify.connect();
    workerPool = new pg.Pool({
      connectionString: testUrl(base, {
        db: dbName,
        user: "app_worker",
        password: ROLE_PW.app_worker,
      }),
    });
    await verify.query("INSERT INTO outbox_projectors (name, enabled) VALUES ('reg_probe', true)");
    await verify.query(
      "INSERT INTO outbox_projector_routes (projector, aggregate_type, event_type) VALUES ('reg_probe', 'reg_test_aggregate', 'reg.test.event')",
    );
    const tenant = await verify.query<{ id: string }>(
      "INSERT INTO tenants (name, slug) VALUES ('Registry Test Tenant', 'registry-test') RETURNING id",
    );
    tenantId = tenant.rows[0]!.id;
  });

  afterAll(async () => {
    const closed = await Promise.allSettled([workerPool?.end(), verify?.end()]);
    await passwords?.release(); // after app_worker closed
    const cleanup = new pg.Client({ connectionString: base });
    await cleanup.connect();
    await cleanup.query(`DROP DATABASE IF EXISTS ${dbName}`).finally(() => cleanup.end());
    const failed = closed.filter((result) => result.status === "rejected");
    if (failed.length) throw new AggregateError(failed, "Failed to close fixture connections");
  });

  async function insertEvent(aggregateType: string, type: string): Promise<string> {
    const result = await verify.query<{ id: string }>(
      `INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, sequence, type, payload)
       VALUES ($1, $2, gen_random_uuid(), 1, $3, '{}'::jsonb) RETURNING id`,
      [tenantId, aggregateType, type],
    );
    return result.rows[0]!.id;
  }

  async function deliveries(eventId: string) {
    const result = await verify.query(
      "SELECT projector, status, attempts, error_code FROM projector_deliveries WHERE event_id = $1 ORDER BY projector",
      [eventId],
    );
    return result.rows;
  }

  /** The owner path the CLI and the runbook use: superuser seat + SET ROLE job_definer (D-9, D-22). */
  async function asOwner(sql: string, params: unknown[]) {
    return withJobDefinerLock(base, async () => {
      await verify.query("SET ROLE job_definer");
      try {
        return await verify.query(sql, params);
      } finally {
        await verify.query("RESET ROLE");
      }
    });
  }

  const cycle = (projectors: ReadonlyMap<string, DeliverFn>) =>
    runDispatchCycle(workerPool, { projectors });

  it("an enabled name without a map entry is never claimed (one warning); a disabled one is never delivered; both rows wait", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const spy = vi.fn(delivered);
    try {
      const eventId = await insertEvent("reg_test_aggregate", "reg.test.event");
      await cycle(new Map([["other", delivered]]));
      expect(await deliveries(eventId)).toMatchObject([
        { projector: "reg_probe", status: "pending" },
      ]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]![0])).toContain(
        "projector reg_probe is required by the registry",
      );

      await asOwner("SELECT outbox_projector_set_enabled('reg_probe', false)", []);
      await cycle(new Map([["reg_probe", spy]]));
      expect(spy).not.toHaveBeenCalled();
      expect(await deliveries(eventId)).toMatchObject([{ status: "pending", attempts: 0 }]);

      await asOwner("SELECT outbox_projector_set_enabled('reg_probe', true)", []);
      await cycle(new Map([["reg_probe", spy]]));
      expect(spy).toHaveBeenCalledTimes(1);
      expect(await deliveries(eventId)).toMatchObject([{ status: "delivered" }]);
    } finally {
      warn.mockRestore();
    }
  });

  it("routes a session event to web_realtime only once enabled; an event acked with '{}' never gains a delivery (A4, A5)", async () => {
    // The real projector NOTIFYs through this test's app_worker pool (the worker's role), never a
    // lazily created pool on an unset DATABASE_URL_DIRECT that the suite would leave open.
    const webRealtime = await import("./projectors/web-realtime.js");
    await webRealtime.setWebRealtimeDbForTests(workerPool);
    try {
      const before = await insertEvent("session", "session.updated");
      await cycle(PROJECTORS);
      expect(await deliveries(before)).toEqual([]);

      await asOwner("SELECT outbox_projector_set_enabled('web_realtime', true)", []);
      const after = await insertEvent("session", "session.updated");
      await cycle(PROJECTORS);
      expect(await deliveries(after)).toEqual([
        { projector: "web_realtime", status: "delivered", attempts: 1, error_code: null },
      ]);
      expect(await deliveries(before)).toEqual([]);
    } finally {
      await webRealtime.setWebRealtimeDbForTests(null);
      await asOwner("SELECT outbox_projector_set_enabled('web_realtime', false)", []);
    }
  });

  it("after an owner replay of a dlq row the next cycle redelivers it with attempts 0 (A9)", async () => {
    const eventId = await insertEvent("reg_test_aggregate", "reg.test.event");
    await cycle(
      new Map([["reg_probe", async () => ({ result: "dlq", errorCode: "boom_terminal" })]]),
    );
    expect(await deliveries(eventId)).toMatchObject([
      { status: "dlq", error_code: "boom_terminal" },
    ]);

    await asOwner("SELECT outbox_dlq_replay($1, 'reg_probe')", [eventId]);
    const attempts: number[] = [];
    await cycle(
      new Map([
        [
          "reg_probe",
          async (job: ClaimedDeliveryJob) => {
            attempts.push(job.attempts);
            return { result: "delivered" as const };
          },
        ],
      ]),
    );
    expect(attempts).toEqual([0]);
    expect(await deliveries(eventId)).toMatchObject([{ status: "delivered", error_code: null }]);
  });

  it("the owner CLI lists a dlq row without its payload and replays it once; a second replay or an unknown pair exits 2 (D-10, A9-A11)", async () => {
    const eventId = await insertEvent("reg_test_aggregate", "reg.test.event");
    await cycle(
      new Map([["reg_probe", async () => ({ result: "dlq", errorCode: "cli_terminal" })]]),
    );
    const url = testUrl(base, { db: dbName });
    const replay = (event: string) =>
      runCli(["replay", "--event", event, "--projector", "reg_probe"], url);
    await withJobDefinerLock(base, async () => {
      const list = await runCli(["list", "--projector", "reg_probe"], url);
      expect(list.code).toBe(0);
      const rows = list.stdout
        .trim()
        .split("\n")
        .slice(0, -1)
        .map((line) => JSON.parse(line));
      expect(rows).toContainEqual(
        expect.objectContaining({
          event_id: eventId,
          projector: "reg_probe",
          error_code: "cli_terminal",
        }),
      );
      expect(rows.some((row) => "payload" in row)).toBe(false);
      expect((await replay(eventId)).code).toBe(0);
      const again = await replay(eventId);
      expect(again.code).toBe(2);
      expect(again.stderr).toContain("delivery_not_in_dlq: the delivery is pending");
      const missing = await replay(randomUUID());
      expect(missing.code).toBe(2);
      expect(missing.stderr).toContain("delivery_not_found");
    });
    expect(await deliveries(eventId)).toMatchObject([{ status: "pending", attempts: 0 }]);
    const audit = await verify.query(
      "SELECT actor, reason FROM job_audit_events WHERE job_id = $1 AND actor = 'owner'",
      [eventId],
    );
    expect(audit.rows).toEqual([{ actor: "owner", reason: "projector_delivery_replayed" }]);
    await cycle(new Map([["reg_probe", delivered]]));
    expect(await deliveries(eventId)).toMatchObject([{ status: "delivered" }]);
  });

  describe("boot sequence: flags default true, projectors off, then the owner CLI enables", () => {
    // L24 U3 (readiness 6.3, BS-1..BS-7): the committed default "true", every real projector seeded
    // disabled (0056), events acked with '{}', then `scripts/outbox-projector-enable.mjs enable`.
    const REPO = path.join(HERE, "..", "..", "..");
    const EXPIRED = "projector_delivery_expired";
    const ALL_OFF = [
      { name: "public_sessions", enabled: false },
      { name: "web_realtime", enabled: false },
      { name: "zalo_dm", enabled: false },
    ];
    const realProjectors = async () =>
      (
        await verify.query(
          "SELECT name, enabled FROM outbox_projectors WHERE name = ANY($1::text[]) ORDER BY name",
          [[...PROJECTORS.keys()]],
        )
      ).rows;

    /**
     * `node scripts/outbox-projector-enable.mjs <args>` as the runbook runs it (the pattern of
     * packages/db/src/outbox-projector-enable.test.ts, copied): cwd = the repo root, the owner credential
     * only in the child's DATABASE_URL_MIGRATION, under the reader lock.
     */
    const runEnableCli = (args: string[]) =>
      withJobDefinerLock(base, async () => {
        const env = { ...process.env, DATABASE_URL_MIGRATION: testUrl(base, { db: dbName }) };
        const script = ["scripts/outbox-projector-enable.mjs", ...args];
        try {
          const { stdout, stderr } = await promisify(execFile)(process.execPath, script, {
            cwd: REPO,
            env,
            timeout: 30_000,
          });
          return { code: 0, stdout, stderr };
        } catch (error) {
          const e = error as { code?: number; stdout?: string; stderr?: string };
          return { code: e.code ?? -1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
        }
      });

    /** The CLI enables `projector` (exit 0); the test disables it again in its finally. */
    async function enable(projector: string) {
      const run = await runEnableCli(["enable", "--projector", projector]);
      expect(run.code, run.stderr).toBe(0);
    }

    /** The expiry records the CLI wrote for `ids` (job_audit_events), any projector. */
    const expiries = async (ids: string[]) =>
      (
        await verify.query(
          "SELECT job_id, reason FROM job_audit_events WHERE starts_with(reason, $1) AND job_id = ANY($2::uuid[]) ORDER BY job_id, reason",
          [`${EXPIRED}:`, ids],
        )
      ).rows;

    /** Owner back-dating on the DB clock by `minutes` (default 40, past the 30-minute bound). */
    const backdate = (ids: string[], minutes = 40) =>
      verify.query(
        "UPDATE outbox_events SET created_at = now() - make_interval(mins => $2::int) WHERE id = ANY($1::uuid[])",
        [ids, minutes],
      );

    /** First boot step: every real projector off, so one cycle acks `ids` with '{}': no row, no record. */
    async function ackedWhileOff(ids: string[], projectors: ReadonlyMap<string, DeliverFn>) {
      expect(await realProjectors()).toEqual(ALL_OFF);
      await cycle(projectors);
      const acked = await verify.query(
        "SELECT id FROM outbox_events WHERE id = ANY($1::uuid[]) AND acked_at IS NOT NULL",
        [ids],
      );
      expect(acked.rowCount).toBe(ids.length);
      for (const id of ids) expect(await deliveries(id)).toEqual([]);
      expect(await expiries(ids)).toEqual([]);
    }

    /**
     * zalo_dm through its real deliverer and the stub (the zalo-dm.test.ts fixture: the web tests'
     * "k" x 32 key, a token only the stub sees, a club with an active bot and an open session).
     * `promote()` adds an active player with a Zalo identity and its player.promoted event.
     */
    async function zaloBoot() {
      const secrets = await import("@plexco/db/connector-crypto");
      const { createZaloDmDeliver } = await import("./projectors/zalo-dm.js");
      const { startZaloStub } = await import("./test-zalo-stub.js");
      const stub = await startZaloStub();
      const kms = { KMS_PROVIDER: process.env.KMS_PROVIDER, KMS_KEY_ID: process.env.KMS_KEY_ID };
      vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, "k").toString("base64"));
      vi.stubEnv("APP_BASE_URL", "https://app.test");
      vi.stubEnv("ZALO_BOT_API_BASE", stub.base);
      delete process.env.KMS_PROVIDER;
      delete process.env.KMS_KEY_ID;
      secrets.__resetAuthSecretCacheForTest();
      const close = async () => {
        await stub.close();
        vi.unstubAllEnvs();
        for (const [key, value] of Object.entries(kms))
          if (value !== undefined) process.env[key] = value;
        secrets.__resetAuthSecretCacheForTest();
      };
      const token = "654321:FIXTURE-worker-token";
      const one = async (sql: string, params: unknown[]) =>
        (await verify.query(sql, params)).rows[0]!;
      try {
        const tenant = await one(
          "INSERT INTO tenants (name, slug, status, locale) VALUES ($1, $1, 'active', 'vi') RETURNING id",
          [`boot-${randomUUID()}`],
        );
        const bot = await one(
          `INSERT INTO zalo_bots (tenant_id, bot_token_enc, webhook_token, status, webhook_secret_enc, key_version)
           VALUES ($1, 'unset', $2, 'active', '\\x01', $3) RETURNING id`,
          [tenant.id, randomUUID(), secrets.connectorKeyVersion()],
        );
        const binding = { tenantId: String(tenant.id), botId: String(bot.id) };
        const sealed = await secrets.encryptConnectorSecret(token, {
          ...binding,
          purpose: "bot_token" as const,
        });
        await verify.query("UPDATE zalo_bots SET bot_token_enc = $2 WHERE id = $1", [
          bot.id,
          secrets.blobToText(sealed.enc),
        ]);
        const session = await one(
          `INSERT INTO sessions (tenant_id, sport_id, starts_at, ends_at, timezone, status, venue_name, price_amount)
           SELECT $1, id, now() + interval '1 day', now() + interval '1 day 2 hours', 'Asia/Ho_Chi_Minh', 'open',
                  'Private Hall', 120000
             FROM sports WHERE key = 'badminton' RETURNING id`,
          [tenant.id],
        );
        const promote = async () => {
          const chat = `chat-${randomUUID()}`;
          const person = await one(
            "INSERT INTO persons (display_name) VALUES ('Boot Sequence') RETURNING id",
            [],
          );
          const membership = await one(
            "INSERT INTO memberships (tenant_id, person_id, status) VALUES ($1, $2, 'active') RETURNING id",
            [tenant.id, person.id],
          );
          const { enc } = await secrets.encryptConnectorSecret(chat, {
            ...binding,
            purpose: "channel_user" as const,
          });
          await verify.query(
            `INSERT INTO channel_identities (person_id, platform, platform_user_id_enc, platform_user_lookup_hash, status, zalo_bot_id)
             VALUES ($1, 'zalo', $2, $3, 'active', $4)`,
            [person.id, enc, randomUUID(), bot.id],
          );
          const player = await one(
            `INSERT INTO players (tenant_id, session_id, membership_id, status, waitlist_position, joined_at)
             VALUES ($1, $2, $3, 'active', NULL, now() - interval '1 hour') RETURNING id`,
            [tenant.id, session.id, membership.id],
          );
          const event = await one(
            `INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, sequence, type, payload)
             VALUES ($1, 'session', $2, (SELECT coalesce(max(sequence), 0) + 1 FROM outbox_events WHERE aggregate_id = $2),
                     'player.promoted', $3)
             RETURNING id`,
            [
              tenant.id,
              session.id,
              { session_id: session.id, player_id: player.id, amount_due: 95_000 },
            ],
          );
          return { chat, event: String(event.id) };
        };
        const projectors = new Map<string, DeliverFn>([
          ...PROJECTORS,
          ["zalo_dm", createZaloDmDeliver({ db: workerPool })],
        ]);
        return { stub, token, projectors, promote, close };
      } catch (error) {
        await close();
        throw error;
      }
    }

    it('BS-1: the committed OUTBOX_DISPATCH_SCHEDULE_ENABLED is exactly "true" and the worker resolver turns dispatch on with every projector disabled', async () => {
      const lines = readFileSync(path.join(REPO, ".env.example"), "utf8")
        .split("\n")
        .filter((line) => line.startsWith("OUTBOX_DISPATCH_SCHEDULE_ENABLED="));
      expect(lines).toEqual(["OUTBOX_DISPATCH_SCHEDULE_ENABLED=true"]); // .env.example:91
      const committed = lines[0]!.slice(lines[0]!.indexOf("=") + 1);
      expect(committed).toBe("true");
      const { resolveWorkerDispatchEnablement } = await import("./worker.js");
      const { probeOutboxRegistry } = await import("./projector-registry.js");
      await expect(
        resolveWorkerDispatchEnablement(committed, PROJECTORS, () =>
          probeOutboxRegistry(workerPool),
        ),
      ).resolves.toMatchObject({ enabled: true });
      expect(await realProjectors()).toEqual(ALL_OFF);
    });

    it("BS-2 web_realtime: events acked '{}' while off are delivered after the CLI enables; a back-dated one is never delivered and gets one age record", async () => {
      const webRealtime = await import("./projectors/web-realtime.js");
      await webRealtime.setWebRealtimeDbForTests(workerPool);
      try {
        const ids: string[] = [];
        for (let i = 0; i < 3; i++) ids.push(await insertEvent("session", "session.updated"));
        const inBound = ids.slice(0, 2);
        const aged = ids[2]!;
        await ackedWhileOff(ids, PROJECTORS);
        await backdate([aged]);
        await enable("web_realtime");
        await cycle(PROJECTORS);
        for (const id of inBound)
          expect(await deliveries(id)).toEqual([
            { projector: "web_realtime", status: "delivered", attempts: 1, error_code: null },
          ]);
        expect(await deliveries(aged)).toEqual([]);
        expect(await expiries(ids)).toEqual([
          { job_id: aged, reason: `${EXPIRED}:web_realtime:age` },
        ]);
      } finally {
        await webRealtime.setWebRealtimeDbForTests(null);
        await asOwner("SELECT outbox_projector_set_enabled('web_realtime', false)", []);
      }
    }, 30_000);

    it("BS-3 zalo_dm: promotion DMs acked '{}' while off reach the stub once each after the CLI enables; a back-dated one is never sent and gets one age record", async () => {
      const zalo = await zaloBoot();
      try {
        const promoted = [await zalo.promote(), await zalo.promote(), await zalo.promote()];
        const ids = promoted.map((p) => p.event);
        const inBound = promoted.slice(0, 2);
        const aged = promoted[2]!;
        await ackedWhileOff(ids, zalo.projectors);
        expect(zalo.stub.calls).toEqual([]);
        await backdate([aged.event], ZALO_DM_MAX_AGE_MINUTES + 1);
        await enable("zalo_dm");
        await cycle(zalo.projectors);
        await cycle(zalo.projectors); // a delivered row is never claimed again
        expect(zalo.stub.calls.map((call) => call.chatId).sort()).toEqual(
          inBound.map((p) => p.chat).sort(),
        );
        expect(zalo.stub.calls.every((call) => call.token === zalo.token)).toBe(true);
        for (const p of inBound)
          expect(await deliveries(p.event)).toEqual([
            { projector: "zalo_dm", status: "delivered", attempts: 1, error_code: null },
          ]);
        expect(await deliveries(aged.event)).toEqual([]);
        expect(await expiries(ids)).toEqual([
          { job_id: aged.event, reason: `${EXPIRED}:zalo_dm:age` },
        ]);
      } finally {
        await asOwner("SELECT outbox_projector_set_enabled('zalo_dm', false)", []);
        await zalo.close();
      }
    }, 30_000);

    it("DA-3 zalo_dm: an event back-dated 45 minutes and acked '{}' while off is prepared by the CLI (the shared bound, not L24's 30 minutes) and reaches the stub once", async () => {
      const zalo = await zaloBoot();
      try {
        const p = await zalo.promote();
        await ackedWhileOff([p.event], zalo.projectors);
        // 45 minutes: past L24's 30-minute bound (it expired then), inside the shared bound
        await backdate([p.event], 45);
        await enable("zalo_dm");
        expect(await deliveries(p.event)).toMatchObject([{ projector: "zalo_dm", attempts: 0 }]);
        expect(zalo.stub.calls).toEqual([]);
        await cycle(zalo.projectors);
        expect(zalo.stub.calls).toMatchObject([{ chatId: p.chat, token: zalo.token }]);
        expect(await deliveries(p.event)).toEqual([
          { projector: "zalo_dm", status: "delivered", attempts: 1, error_code: null },
        ]);
        expect(await expiries([p.event])).toEqual([]);
      } finally {
        await asOwner("SELECT outbox_projector_set_enabled('zalo_dm', false)", []);
        await zalo.close();
      }
    }, 30_000);

    it("DA-10: the enable CLI's zalo_dm bound is the dispatcher's constant, its default bound stays 30, and the bound exceeds the DD-134 live-path worst case", () => {
      expect(enableCli).toMatchObject({ ZALO_DM_MAX_AGE_MINUTES, BACKFILL_MAX_AGE_MINUTES: 30 });
      // The live-path worst case of step 0 (Q2): MAX_DELIVERY_ATTEMPTS x 60 s, plus
      // (MAX_DELIVERY_ATTEMPTS - 1) x 120 s, plus the DD-134 backoff (RETRY_BASE_MS x 2^(n-1)).
      let backoffS = 0;
      for (let n = 1; n <= MAX_DELIVERY_ATTEMPTS - 1; n++)
        backoffS += (RETRY_BASE_MS / 1000) * 2 ** (n - 1);
      const worstS = MAX_DELIVERY_ATTEMPTS * 60 + (MAX_DELIVERY_ATTEMPTS - 1) * 120 + backoffS;
      expect(worstS).toBe(3225); // a change of DD-134's values must revisit the bound
      expect(ZALO_DM_MAX_AGE_MINUTES * 60).toBeGreaterThan(worstS);
    });

    // U3b (BS-4, the cap, BS-7 and BS-5 per projector). A cycle claims 25 rows (DEFAULT_BATCH_LIMIT)
    // and earlier tests' CLI runs may have prepared rows too, so a drain is a bounded loop.
    const NAMES = ["web_realtime", "zalo_dm", "public_sessions"];
    const CAP = 200; // BACKFILL_MAX_ROWS (D3), checked against the script in the cap case
    const UNACKED = "SELECT 1 FROM outbox_events WHERE id = ANY($1::uuid[]) AND acked_at IS NULL";
    const ROWS = "SELECT 1 FROM projector_deliveries WHERE event_id = ANY($1::uuid[])";
    const DELIVERED = `${ROWS} AND status = 'delivered'`;
    const rowCount = async (sql: string, ids: string[]) =>
      (await verify.query(sql, [ids])).rowCount ?? 0;
    const disable = (projector: string) =>
      asOwner("SELECT outbox_projector_set_enabled($1, false)", [projector]);
    /** One (aggregate_type, event_type) the projector routes; a wildcard route gets a probe type. */
    const routeOf = async (projector: string) =>
      (
        await verify.query<{ aggregate_type: string; event_type: string }>(
          `SELECT aggregate_type, coalesce(event_type, 'boot.probe') AS event_type
             FROM outbox_projector_routes WHERE projector = $1 ORDER BY aggregate_type, event_type LIMIT 1`,
          [projector],
        )
      ).rows[0]!;
    async function cycleUntil(
      projectors: ReadonlyMap<string, DeliverFn>,
      done: () => Promise<boolean>,
    ) {
      for (let i = 0; i < 20 && !(await done()); i++) await cycle(projectors);
      expect(await done()).toBe(true);
    }

    it("BS-4 public_sessions: a session published while off is public after the CLI (rebuild); its in-bound events are delivered through the seam; a back-dated one is never delivered and gets one age record", async () => {
      const { createPublicSessionsDeliver } = await import("./projectors/public-sessions.js");
      const seam = new Map<string, DeliverFn>([
        ["public_sessions", createPublicSessionsDeliver({ db: workerPool })],
      ]);
      const idOf = async (sql: string, params: unknown[]) =>
        String((await verify.query(sql, params)).rows[0]!.id);
      const club = await idOf(
        `INSERT INTO tenants (name, slug, public_alias, public_alias_status)
         VALUES ('BS4 Club', 'bs4-club', 'CLB BS4', 'approved') RETURNING id`,
        [],
      );
      // EN-9's open public session (packages/db/src/outbox-projector-enable.test.ts), minimum columns
      const session = await idOf(
        `INSERT INTO sessions (tenant_id, sport_id, starts_at, ends_at, timezone, venue_name, venue_address,
           area, price_amount, slots_max, visibility, join_policy, status)
         SELECT $1, id, now() + interval '1 day', now() + interval '26 hours', 'Asia/Ho_Chi_Minh',
           'BS4 Venue', '1 Public Street', 'Quan 7', 50000, 10, 'public', 'open', 'open'
           FROM sports WHERE key = 'badminton' RETURNING id`,
        [club],
      );
      const route = await routeOf("public_sessions");
      expect(route.aggregate_type).toBe("session");
      const ids = (
        await verify.query<{ id: string }>(
          `INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, sequence, type, payload)
           SELECT $1, 'session', $2, g, $3, '{}'::jsonb FROM generate_series(1, 3) AS g RETURNING id`,
          [club, session, route.event_type],
        )
      ).rows.map((row) => row.id);
      const inBound = ids.slice(0, 2);
      const aged = ids[2]!;
      const isPublic = async () =>
        (await rowCount("SELECT 1 FROM public_sessions WHERE id = ANY($1::uuid[])", [session])) ===
        1;
      try {
        await ackedWhileOff(ids, seam);
        await backdate([aged]);
        expect(await isPublic()).toBe(false);
        await enable("public_sessions");
        expect(await isPublic()).toBe(true); // the CLI's rebuild, before any delivery
        await cycleUntil(seam, async () => (await rowCount(DELIVERED, inBound)) === 2);
        for (const event of inBound)
          expect(await deliveries(event)).toEqual([
            { projector: "public_sessions", status: "delivered", attempts: 1, error_code: null },
          ]);
        expect(await deliveries(aged)).toEqual([]);
        expect(await expiries(ids)).toEqual([
          { job_id: aged, reason: `${EXPIRED}:public_sessions:age` },
        ]);
      } finally {
        await disable("public_sessions");
      }
    }, 30_000);

    it("cap: more than BACKFILL_MAX_ROWS acked in-window web_realtime events -> the newest are delivered, each older one gets exactly one cap record and is never delivered", async () => {
      const script = readFileSync(
        path.join(REPO, "scripts", "outbox-projector-enable.mjs"),
        "utf8",
      );
      expect(script).toContain(`BACKFILL_MAX_ROWS = ${CAP};`);
      const type = "session.boot_cap"; // routed by web_realtime's ('session', NULL) wildcard
      // one owner insert, 1 microsecond apart and newer than every earlier event (newest first, D3)
      await verify.query(
        `INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, sequence, type, payload, created_at)
         SELECT $1, 'session', gen_random_uuid(), 1, $2, '{}'::jsonb, now() - g * interval '1 microsecond'
           FROM generate_series(1, $3::int) AS g`,
        [tenantId, type, CAP + 5],
      );
      const ids = (
        await verify.query<{ id: string }>(
          "SELECT id FROM outbox_events WHERE type = $1 ORDER BY created_at DESC, id DESC",
          [type],
        )
      ).rows.map((row) => row.id);
      const newest = ids.slice(0, CAP);
      const rest = ids.slice(CAP);
      try {
        expect(await realProjectors()).toEqual(ALL_OFF);
        await cycleUntil(PROJECTORS, async () => (await rowCount(UNACKED, ids)) === 0);
        expect(await rowCount(ROWS, ids)).toBe(0);
        expect(await expiries(ids)).toEqual([]);
        await enable("web_realtime");
        const only = new Map<string, DeliverFn>([["web_realtime", delivered]]);
        await cycleUntil(only, async () => (await rowCount(DELIVERED, newest)) === CAP);
        const rows = (
          await verify.query(
            "SELECT event_id, projector, status FROM projector_deliveries WHERE event_id = ANY($1::uuid[])",
            [ids],
          )
        ).rows;
        expect(rows.map((row) => row.event_id).sort()).toEqual([...newest].sort());
        expect(
          rows.every((row) => row.projector === "web_realtime" && row.status === "delivered"),
        ).toBe(true);
        const records = await expiries(ids);
        expect(records.map((row) => row.job_id).sort()).toEqual([...rest].sort());
        expect(records.every((row) => row.reason === `${EXPIRED}:web_realtime:cap`)).toBe(true);
      } finally {
        await disable("web_realtime");
      }
    }, 60_000);

    it.each(NAMES)(
      "BS-7 %s: an unacked routed event older than the bound -> the CLI exits 2 unacked_backlog and changes nothing; after a cycle acks it the CLI succeeds and records one age",
      async (projector) => {
        const route = await routeOf(projector);
        const id = await insertEvent(route.aggregate_type, route.event_type);
        await backdate([id], projector === "zalo_dm" ? ZALO_DM_MAX_AGE_MINUTES + 1 : 40);
        try {
          const refused = await runEnableCli(["enable", "--projector", projector]);
          expect(refused.code).toBe(2);
          expect(refused.stderr).toContain("unacked_backlog");
          expect(await realProjectors()).toEqual(ALL_OFF);
          expect(await deliveries(id)).toEqual([]);
          expect(await expiries([id])).toEqual([]);
          await ackedWhileOff([id], PROJECTORS);
          await enable(projector);
          expect(await deliveries(id)).toEqual([]);
          expect(await expiries([id])).toEqual([
            { job_id: id, reason: `${EXPIRED}:${projector}:age` },
          ]);
        } finally {
          await disable(projector);
        }
      },
      30_000,
    );

    it.each(NAMES)(
      "BS-5 %s: a disable keeps the pending rows and a CLI re-enable resumes them (DD-134 unchanged), adding no row and no record for their events",
      async (projector) => {
        const route = await routeOf(projector);
        const ids = [
          await insertEvent(route.aggregate_type, route.event_type),
          await insertEvent(route.aggregate_type, route.event_type),
        ];
        const spy = vi.fn(delivered);
        const only = new Map<string, DeliverFn>([[projector, spy]]);
        const pending = { projector, status: "pending", attempts: 0, error_code: null };
        const audits = () =>
          rowCount("SELECT 1 FROM job_audit_events WHERE job_id = ANY($1::uuid[])", ids);
        try {
          await ackedWhileOff(ids, only);
          await enable(projector);
          await disable(projector);
          await cycle(only);
          expect(spy).not.toHaveBeenCalled();
          for (const id of ids) expect(await deliveries(id)).toEqual([pending]);
          const before = await audits();
          await enable(projector);
          for (const id of ids) expect(await deliveries(id)).toEqual([pending]);
          expect(await audits()).toBe(before);
          expect(await expiries(ids)).toEqual([]);
          await cycleUntil(only, async () => (await rowCount(DELIVERED, ids)) === ids.length);
          for (const id of ids)
            expect(await deliveries(id)).toEqual([
              { ...pending, status: "delivered", attempts: 1 },
            ]);
        } finally {
          await disable(projector);
        }
      },
      30_000,
    );
  });
});

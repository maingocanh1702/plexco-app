import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import pg from "pg";
import { migrate } from "@plexco/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runDispatchCycle, type ClaimedDeliveryJob, type DeliverFn } from "./dispatcher.js";
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
});

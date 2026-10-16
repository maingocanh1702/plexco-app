import pg from "pg";
import { migrate } from "@plexco/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runDispatchCycle, type DeliverFn, type DispatchCycleSummary } from "./dispatcher.js";
import { outboxCronHandler, runDraftExpiry } from "./draft-expiry-job.js";
import { WAKE_APPLICATION_NAME, createDispatchRunner, startOutboxWake } from "./outbox-wake.js";
import {
  ROLE_PW,
  bootstrapJobDefiner,
  setAppWorkerPasswordRaceSafe,
  testUrl,
  withJobDefinerLock,
  type TestRolePasswordLease,
} from "./test-db.js";

const SUMMARY: DispatchCycleSummary = {
  claimedEvents: 0,
  ackedEvents: 0,
  staleTokenSkips: 0,
  processedDeliveries: 0,
  staleCompletionSkips: 0,
  leaseLostSkips: 0,
  fullBatch: false,
};
const noop = () => {};
const LISTENING = "[worker] outbox wake listening";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function deferred() {
  let resolve: () => void = noop;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error("timed out waiting for condition");
    await sleep(25);
  }
}

describe("createDispatchRunner (D-11)", () => {
  it("queues exactly one follow-up however many requests arrive during a cycle", async () => {
    const gates = [deferred(), deferred()];
    let calls = 0;
    const runner = createDispatchRunner(
      async () => {
        await gates[calls++]!.promise;
        return SUMMARY;
      },
      { log: noop },
    );
    const requests = [runner.request(), runner.request(), runner.request(), runner.request()];
    gates[0]!.resolve();
    gates[1]!.resolve();
    await Promise.all(requests);
    expect(calls).toBe(2);
  });

  it("drains while cycles come back full, at most 20 in a row", async () => {
    let calls = 0;
    const logs: string[] = [];
    const runner = createDispatchRunner(
      async () => {
        calls += 1;
        return { ...SUMMARY, fullBatch: true };
      },
      { log: (line) => logs.push(line) },
    );
    await runner.request();
    expect(calls).toBe(20);
    expect(logs.at(-1)).toMatch(/drain paused after 20 full cycles/);
  });

  it("contains a failing cycle and runs again on the next request", async () => {
    let calls = 0;
    const logs: string[] = [];
    const runner = createDispatchRunner(
      async () => {
        if (calls++ === 0) throw Object.assign(new Error("terminating"), { code: "57P01" });
        return SUMMARY;
      },
      { log: (line) => logs.push(line) },
    );
    await expect(runner.request()).resolves.toBeUndefined();
    expect(logs).toEqual(["[worker] dispatch cycle failed: 57P01 terminating"]);
    await runner.request();
    expect(calls).toBe(2);
  });

  it("close() drops the queued follow-up; idle() waits for the cycle in flight", async () => {
    const gate = deferred();
    let calls = 0;
    let finished = false;
    const runner = createDispatchRunner(
      async () => {
        calls += 1;
        await gate.promise;
        finished = true;
        return SUMMARY;
      },
      { log: noop },
    );
    void runner.request();
    const followUp = runner.request();
    runner.close();
    const idle = runner.idle();
    gate.resolve();
    await idle;
    await followUp;
    await runner.request();
    expect({ finished, calls }).toEqual({ finished: true, calls: 1 });
  });
});

describe("outbox wake against a real database (A26, A28)", () => {
  const dbName = "plexco_bot_outbox_wake";
  const base = process.env.DATABASE_URL_TEST ?? "";
  let workerUrl = "";
  let verify: pg.Client;
  let workerPool: pg.Pool;
  let passwords: TestRolePasswordLease | undefined;
  let tenantId = "";

  beforeAll(async () => {
    if (!base) throw new Error("DATABASE_URL_TEST is required");
    workerUrl = testUrl(base, { db: dbName, user: "app_worker", password: ROLE_PW.app_worker });
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
    workerPool = new pg.Pool({ connectionString: workerUrl });
    await verify.query("INSERT INTO outbox_projectors (name, enabled) VALUES ('wake_probe', true)");
    await verify.query(
      "INSERT INTO outbox_projector_routes (projector, aggregate_type, event_type) VALUES ('wake_probe', 'wake_test_aggregate', 'wake.test.event')",
    );
    const tenant = await verify.query<{ id: string }>(
      "INSERT INTO tenants (name, slug) VALUES ('Wake Test Tenant', 'wake-test') RETURNING id",
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

  async function insertEvent(client: pg.ClientBase = verify): Promise<string> {
    const result = await client.query<{ id: string }>(
      `INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, sequence, type, payload)
       VALUES ($1, 'wake_test_aggregate', gen_random_uuid(), 1, 'wake.test.event', '{}'::jsonb)
       RETURNING id`,
      [tenantId],
    );
    return result.rows[0]!.id;
  }

  /** A runner + LISTEN loop delivering wake_probe rows; `delivered` records each event id. */
  function startProbe(options: { debounceMs?: number; reconnectMinMs?: number } = {}) {
    const delivered: string[] = [];
    const cycles: DispatchCycleSummary[] = [];
    const logs: string[] = [];
    const deliver: DeliverFn = async (job) => {
      delivered.push(job.eventId);
      return { result: "delivered" };
    };
    const projectors = new Map([["wake_probe", deliver]]);
    const runner = createDispatchRunner(
      async () => {
        const summary = await runDispatchCycle(workerPool, { projectors });
        cycles.push(summary);
        return summary;
      },
      { log: noop },
    );
    const wake = startOutboxWake({
      connectionString: workerUrl,
      runner,
      log: (line) => logs.push(line),
      ...options,
    });
    const stop = async () => {
      await wake.stop();
      runner.close();
      await runner.idle();
    };
    const listening = async (count = 1) => {
      await waitFor(() => logs.filter((line) => line === LISTENING).length >= count);
      await runner.idle(); // the catch-up drain that follows every (re)connect
    };
    return { delivered, cycles, logs, runner, stop, listening };
  }

  it("a burst of K = 10 committed INSERTs inside the debounce window runs ONE cycle that claims all K", async () => {
    const probe = startProbe({ debounceMs: 250 });
    try {
      await probe.listening();
      probe.cycles.length = 0;
      const ids: string[] = [];
      for (let i = 0; i < 10; i++) ids.push(await insertEvent());
      await waitFor(() => probe.delivered.length === 10);
      await sleep(400);
      expect(probe.cycles).toHaveLength(1);
      expect(probe.cycles[0]).toMatchObject({ claimedEvents: 10, processedDeliveries: 10 });
      expect([...probe.delivered].sort()).toEqual([...ids].sort());
    } finally {
      await probe.stop();
    }
  });

  it("two runners on one database deliver each (event, projector) exactly once", async () => {
    const seen: string[] = [];
    const deliver: DeliverFn = async (job) => {
      seen.push(job.eventId);
      return { result: "delivered" };
    };
    const projectors = new Map([["wake_probe", deliver]]);
    const secondPool = new pg.Pool({ connectionString: workerUrl });
    try {
      const ids: string[] = [];
      for (let i = 0; i < 30; i++) ids.push(await insertEvent());
      const runners = [workerPool, secondPool].map((pool) =>
        createDispatchRunner(() => runDispatchCycle(pool, { projectors, limit: 5 }), { log: noop }),
      );
      await Promise.all(runners.flatMap((runner) => [runner.request(), runner.request()]));
      expect(seen).toHaveLength(new Set(seen).size);
      expect([...seen].sort()).toEqual([...ids].sort());
      const rows = await verify.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM projector_deliveries WHERE event_id = ANY($1) AND status = 'delivered'",
        [ids],
      );
      expect(rows.rows[0]!.n).toBe(30);
    } finally {
      await secondPool.end();
    }
  });

  it("a killed LISTEN connection reconnects and its catch-up cycle delivers what was inserted meanwhile", async () => {
    const probe = startProbe({ reconnectMinMs: 500 });
    try {
      await probe.listening();
      await verify.query(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = $1 AND datname = current_database()",
        [WAKE_APPLICATION_NAME],
      );
      await waitFor(() => probe.logs.some((line) => line.includes("outbox wake listener lost")));
      const id = await insertEvent(); // nobody listens: this NOTIFY is lost
      await probe.listening(2);
      await waitFor(() => probe.delivered.includes(id));
      expect(probe.logs.filter((line) => line.includes("reconnecting in 500 ms"))).toHaveLength(1);
    } finally {
      await probe.stop();
    }
  });

  it("a NOTIFY wake never expires a stale draft; the cron handler does, logging counts only (A28)", async () => {
    const draft = await verify.query<{ id: string }>(
      `INSERT INTO sessions (tenant_id, sport_id, starts_at, ends_at, timezone, status)
       SELECT $1, id, now() - interval '2 hours', now() - interval '1 hour', 'Asia/Ho_Chi_Minh', 'draft'
       FROM sports WHERE key = 'badminton' RETURNING id`,
      [tenantId],
    );
    const status = async () =>
      (await verify.query("SELECT status FROM sessions WHERE id = $1", [draft.rows[0]!.id])).rows[0]
        .status;
    const probe = startProbe();
    try {
      await probe.listening();
      const id = await insertEvent();
      await waitFor(() => probe.delivered.includes(id));
      await probe.runner.idle();
      expect(await status()).toBe("draft");
      const lines: string[] = [];
      const tick = outboxCronHandler({
        drain: () => probe.runner.request(),
        expire: () => runDraftExpiry(workerPool, (line) => lines.push(line)),
      });
      await tick();
      expect(await status()).toBe("cancelled");
      expect(lines).toEqual(["[worker] draft expiry: cancelled=1 anomalies=0"]);
    } finally {
      await probe.stop();
    }
  });

  /**
   * Readiness section 6 (D-19, A29): local only, never in CI. Drives the real wake loop and runner
   * in-process; OUTBOX_DISPATCH_SCHEDULE_ENABLED is never set. Lag = delivered_at - created_at,
   * both from the one DB clock. Reports the numbers; asserts only that every event was delivered.
   */
  describe.skipIf(process.env.OUTBOX_SYNC_LAG_MEASURE !== "1")("sync lag", () => {
    async function measure(label: string, batches: number, perBatch: number, everyMs: number) {
      const probe = startProbe();
      const inserter = new pg.Client({ connectionString: testUrl(base, { db: dbName }) });
      await inserter.connect();
      try {
        await probe.listening();
        probe.cycles.length = 0;
        const ids: string[] = [];
        const start = Date.now();
        for (let b = 0; b < batches; b++) {
          await sleep(Math.max(0, start + b * everyMs - Date.now()));
          if (perBatch > 1) await inserter.query("BEGIN");
          for (let i = 0; i < perBatch; i++) ids.push(await insertEvent(inserter));
          if (perBatch > 1) await inserter.query("COMMIT");
        }
        await waitFor(() => probe.delivered.length >= ids.length, 60_000);
        const lag = await verify.query<{ ms: number }>(
          `SELECT (extract(epoch FROM d.delivered_at - e.created_at) * 1000)::float8 AS ms
           FROM projector_deliveries d JOIN outbox_events e ON e.id = d.event_id
           WHERE d.projector = 'wake_probe' AND d.status = 'delivered' AND e.id = ANY($1)
           ORDER BY ms`,
          [ids],
        );
        const ms = lag.rows.map((row) => row.ms);
        const pct = (p: number) =>
          Math.round(ms[Math.min(ms.length - 1, Math.ceil(p * ms.length) - 1)]!);
        const report = {
          label,
          load: `${batches} x ${perBatch} event(s) every ${everyMs} ms`,
          n: ms.length,
          p50: pct(0.5),
          p95: pct(0.95),
          p99: pct(0.99),
          max: Math.round(ms.at(-1)!),
          cycles: probe.cycles.length,
        };
        console.log(`SYNC_LAG ${JSON.stringify(report)}`);
        expect(report.n).toBe(batches * perBatch);
      } finally {
        await inserter.end();
        await probe.stop();
      }
    }

    it("steady: 10 events/s for 60 s, one committed INSERT each (N = 600)", async () => {
      await measure("steady-10ps", 600, 1, 100);
    }, 120_000);

    it("bursts: 50 events in one transaction every 5 s (N = 600)", async () => {
      await measure("burst-50-every-5s", 12, 50, 5_000);
    }, 120_000);
  });
});

import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  setupRlsTestContext,
  withJobDefinerLock,
  type RlsTestContext,
} from "../../../../packages/db/src/test-harness.js";
import { ERROR_CODE_RE, runDispatchCycle, type ClaimedDeliveryJob } from "../dispatcher.js";
import {
  NOTIFY_TIMEOUT_MS,
  WEB_REALTIME_CHANNEL,
  deliverWebRealtime,
  setWebRealtimeDbForTests,
} from "./web-realtime.js";

/**
 * web_realtime projector (lane L5, readiness R-2, R-3, A10, A25): one id-only NOTIFY per session
 * event, bounded by a timeout, never the payload body.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function job(aggregateType = "session"): ClaimedDeliveryJob {
  const tenantId = randomUUID();
  return {
    eventId: randomUUID(),
    tenantId,
    projector: "web_realtime",
    claimToken: randomUUID(),
    attempts: 0,
    event: {
      eventType: "session.updated",
      aggregateType,
      aggregateId: randomUUID(),
      sequence: 3,
      tenantId,
      payload: { price_amount: 120000, changed_fields: ["venue_name"] },
      createdAt: new Date(),
    },
  } as unknown as ClaimedDeliveryJob;
}

describe("deliverWebRealtime outcomes (A25)", () => {
  afterAll(() => setWebRealtimeDbForTests(null));

  it("sends exactly one pg_notify on web_realtime carrying only the event id, then delivered", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    setWebRealtimeDbForTests({ query } as never);
    const claimed = job();
    await expect(deliverWebRealtime(claimed)).resolves.toEqual({ result: "delivered" });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith("SELECT pg_notify('web_realtime', $1)", [claimed.eventId]);
    expect(WEB_REALTIME_CHANNEL).toBe("web_realtime");
  });

  it("maps a NOTIFY error to retry notify_failed and a hung NOTIFY to retry notify_timeout", async () => {
    setWebRealtimeDbForTests({ query: vi.fn(async () => Promise.reject(new Error("down"))) } as never);
    const failed = await deliverWebRealtime(job());
    expect(failed).toEqual({ result: "retry", errorCode: "notify_failed" });

    vi.useFakeTimers();
    try {
      setWebRealtimeDbForTests({ query: vi.fn(() => new Promise(() => undefined)) } as never);
      const pending = deliverWebRealtime(job());
      await vi.advanceTimersByTimeAsync(NOTIFY_TIMEOUT_MS);
      const hung = await pending;
      expect(hung).toEqual({ result: "retry", errorCode: "notify_timeout" });
      expect(NOTIFY_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
      for (const outcome of [failed, hung]) {
        expect("errorCode" in outcome && ERROR_CODE_RE.test(outcome.errorCode)).toBe(true);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("dead-letters a non-session aggregate as unsupported_aggregate with no I/O", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    setWebRealtimeDbForTests({ query } as never);
    const outcome = await deliverWebRealtime(job("payment"));
    expect(outcome).toEqual({ result: "dlq", errorCode: "unsupported_aggregate" });
    expect(ERROR_CODE_RE.test("unsupported_aggregate")).toBe(true);
    expect(query).not.toHaveBeenCalled();
  });
});

describe("web_realtime through a real dispatch cycle (A10)", () => {
  const BASE = process.env.DATABASE_URL_TEST ?? "";
  let ctx: RlsTestContext;
  let listen: pg.PoolClient | undefined;
  const heard: { channel: string; payload: string | undefined }[] = [];

  /** The owner path (runbook section 2 step 4): superuser seat + SET LOCAL ROLE job_definer. */
  const setEnabled = (enabled: boolean) =>
    withJobDefinerLock(BASE, async () => {
      await ctx.owner.query("BEGIN");
      try {
        await ctx.owner.query("SET LOCAL ROLE job_definer");
        await ctx.owner.query("SELECT outbox_projector_set_enabled('web_realtime', $1)", [enabled]);
        await ctx.owner.query("COMMIT");
      } catch (error) {
        await ctx.owner.query("ROLLBACK");
        throw error;
      }
    });

  async function seedSessionEvent(): Promise<string> {
    const { rows } = await ctx.owner.query<{ id: string }>(
      `INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, sequence, type, payload)
       VALUES ($1, 'session', gen_random_uuid(), 1, 'session.updated',
               '{"price_amount":120000,"venue_name":"secret"}'::jsonb) RETURNING id`,
      [ctx.tenantA],
    );
    return rows[0]!.id;
  }

  async function settle(until: () => boolean, ms = 3_000): Promise<void> {
    const deadline = Date.now() + ms;
    while (!until() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
  }

  beforeAll(async () => {
    ctx = await setupRlsTestContext(`plexco_web_realtime_${process.pid}`);
    listen = await ctx.appPool.connect();
    listen.on("notification", (n) => heard.push({ channel: n.channel, payload: n.payload }));
    await listen.query(`LISTEN ${WEB_REALTIME_CHANNEL}`);
    // The worker's own seat (app_worker) sends the NOTIFY, as DATABASE_URL_DIRECT does in production.
    setWebRealtimeDbForTests(ctx.workerPool);
  }, 120_000);

  afterAll(async () => {
    setWebRealtimeDbForTests(null);
    listen?.release(true);
    await ctx?.teardown();
  }, 120_000);

  it("sends nothing while disabled, and only event ids once enabled through the owner path", async () => {
    const projectors = new Map([["web_realtime", deliverWebRealtime]]);
    const whileDisabled = await seedSessionEvent();
    await runDispatchCycle(ctx.workerPool, { projectors });
    await settle(() => heard.length > 0, 500);
    expect(heard).toEqual([]);

    await setEnabled(true);
    try {
      const whileEnabled = await seedSessionEvent();
      await runDispatchCycle(ctx.workerPool, { projectors });
      await settle(() => heard.some((h) => h.payload === whileEnabled));
      expect(heard.map((h) => h.payload)).toContain(whileEnabled);
      for (const h of heard) {
        expect(h.channel).toBe("web_realtime");
        expect(h.payload).toMatch(UUID_RE);
        expect([whileDisabled, whileEnabled]).toContain(h.payload);
      }
    } finally {
      await setEnabled(false);
    }
  });
});

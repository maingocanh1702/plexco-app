import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Tx } from "./client.js";
import { readSessionRealtimeEvent } from "./realtime-event-read.js";
import { withTenant } from "./tenant.js";
import { setupRlsTestContext, type RlsTestContext } from "./test-harness.js";

/**
 * Web live sync (lane L5, readiness R-1, A20): the event id -> {type, sessionId, version} read the
 * web realtime listener re-authorizes every NOTIFY with. Runs as the runtime `app` role, so the
 * tenant filter proven here is RLS itself (0009 tenant_isolation), not a WHERE the caller could drop.
 */
let ctx: RlsTestContext;
beforeAll(async () => {
  ctx = await setupRlsTestContext("plexco_realtime_event_read");
}, 120_000);
afterAll(async () => {
  await ctx?.teardown();
});

/** A committed outbox row; the payload carries fields that must never leave through this read. */
async function seedEvent(tenantId: string, aggregateType = "session", type = "session.updated") {
  const aggregateId = randomUUID();
  const { rows } = await ctx.owner.query<{ id: string }>(
    `INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, sequence, type, payload)
     VALUES ($1, $2, $3, 7, $4,
             '{"changed_fields":["price_amount"],"price_amount":120000,"tenant_id":"x"}'::jsonb)
     RETURNING id`,
    [tenantId, aggregateType, aggregateId, type],
  );
  return { id: rows[0]!.id, aggregateId };
}

const readAs = (tenantId: string, eventId: string) =>
  withTenant(ctx.appDb.db, tenantId, (tx) => readSessionRealtimeEvent(tx, eventId));

describe("readSessionRealtimeEvent (R-1, A20)", () => {
  it("returns exactly {type, sessionId, version} for an event of the caller's own tenant", async () => {
    const event = await seedEvent(ctx.tenantA);
    const read = await readAs(ctx.tenantA, event.id);
    expect(read).toEqual({ type: "session.updated", sessionId: event.aggregateId, version: 7 });
    expect(Object.keys(read!).sort()).toEqual(["sessionId", "type", "version"]);
  });

  it("T-22: the DD-39 waitlist.charge_derivation_failed event reads as exactly {type, sessionId, version}", async () => {
    const event = await seedEvent(ctx.tenantA, "session", "waitlist.charge_derivation_failed");
    expect(await readAs(ctx.tenantA, event.id)).toStrictEqual({
      type: "waitlist.charge_derivation_failed",
      sessionId: event.aggregateId,
      version: 7,
    });
  });

  it("returns null for another tenant's event: RLS hides the row from the app role", async () => {
    const event = await seedEvent(ctx.tenantA);
    expect(await readAs(ctx.tenantB, event.id)).toBeNull();
  });

  it("returns null for a non-session aggregate and for an unknown id", async () => {
    const payment = await seedEvent(ctx.tenantA, "payment", "payment.settled");
    expect(await readAs(ctx.tenantA, payment.id)).toBeNull();
    expect(await readAs(ctx.tenantA, randomUUID())).toBeNull();
  });

  it("returns null with no query for a malformed id (uppercase, padded, foreign text)", async () => {
    const select = vi.fn(() => {
      throw new Error("must not query");
    });
    const tx = { select } as unknown as Tx;
    const valid = randomUUID();
    for (const bad of ["", "nope", valid.toUpperCase(), ` ${valid}`, `${valid}x`, "1; select 1"]) {
      expect(await readSessionRealtimeEvent(tx, bad)).toBeNull();
    }
    expect(await readSessionRealtimeEvent(tx, 42 as unknown as string)).toBeNull();
    expect(select).not.toHaveBeenCalled();
  });
});

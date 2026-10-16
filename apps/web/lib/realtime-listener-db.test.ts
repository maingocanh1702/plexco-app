import { randomUUID } from "node:crypto";
import { updateSession } from "@plexco/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  seedPersonAccount,
  setupRlsTestContext,
  type RlsTestContext,
} from "../../../packages/db/src/test-harness.js";
import { openRealtimeStream, realtimeListener } from "./realtime-listener";
import { appDb, hashToken, resetDbRoleViolationForTests } from "./session-cookies";

/**
 * The web realtime listener against a REAL database as the `app` role (lane L5, A7, A8): a real
 * LISTEN client, the real RLS event read and the real authorize() gate. The NOTIFY is the exact
 * statement the web_realtime projector sends (event id only).
 */
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

let ctx: RlsTestContext;
let runtime: ReturnType<typeof appDb> | undefined;

beforeAll(async () => {
  ctx = await setupRlsTestContext(`plexco_realtime_listener_db_${process.pid}`);
  const url = ctx.appPool.options.connectionString;
  if (typeof url !== "string") throw new Error("Missing isolated app connection string");
  vi.stubEnv("DATABASE_URL", url);
  vi.stubEnv("DB_EXPECTED_ROLE", "app");
  resetDbRoleViolationForTests();
  runtime = appDb();
}, 120_000);

afterAll(async () => {
  try {
    await runtime?.close();
  } finally {
    resetDbRoleViolationForTests();
    try {
      await ctx?.teardown();
    } finally {
      vi.unstubAllEnvs();
    }
  }
}, 120_000);

async function seedTenant(): Promise<string> {
  const unique = randomUUID();
  const { rows } = await ctx.owner.query<{ id: string }>(
    `INSERT INTO tenants (name, slug, status, locale) VALUES ($1, $2, 'active', 'vi') RETURNING id`,
    [`Realtime ${unique}`, `realtime-${unique}`],
  );
  await ctx.owner.query(
    `INSERT INTO subscriptions (tenant_id, plan_key, plan_version, status, period_start, period_end)
     VALUES ($1, 'free', 1, 'active', now(), now() + interval '30 days')`,
    [rows[0]!.id],
  );
  return rows[0]!.id;
}

/** An active web admin of `tenantId`, shaped as a stream audience. */
async function seedAdmin(tenantId: string) {
  const actor = await seedPersonAccount(ctx.owner, randomUUID());
  await ctx.owner.query(
    `INSERT INTO tenant_admins (tenant_id, platform, platform_user_lookup_hash, role, active)
     VALUES ($1, 'web', $2, 'admin', true)`,
    [tenantId, actor.personId],
  );
  return {
    tenantId,
    accountId: actor.accountId,
    personId: actor.personId,
    tokenHash: hashToken(randomUUID()),
  };
}

async function seedSession(tenantId: string) {
  const { rows } = await ctx.owner.query<{ id: string; version: number }>(
    `INSERT INTO sessions (tenant_id, sport_id, starts_at, ends_at, timezone, slots_max,
                           visibility, price_amount, status)
     VALUES ($1, $2, now() + interval '1 day', now() + interval '1 day 2 hours',
             'Asia/Ho_Chi_Minh', 8, 'private', 120000, 'open') RETURNING id, version`,
    [tenantId, ctx.badmintonSportId],
  );
  return rows[0]!;
}

/** A real host edit, then the projector's NOTIFY for the event it wrote. */
async function editAndNotify(
  tenantId: string,
  session: { id: string; version: number },
  venue: string,
) {
  await updateSession(ctx.appDb.db, {
    tenantId,
    commandId: randomUUID(),
    input: { sessionId: session.id, expectedVersion: session.version, venueName: venue },
  });
  session.version += 1;
  const { rows } = await ctx.owner.query<{ id: string }>(
    `SELECT id FROM outbox_events WHERE aggregate_id = $1 ORDER BY sequence DESC LIMIT 1`,
    [session.id],
  );
  await ctx.workerPool.query("SELECT pg_notify('web_realtime', $1)", [rows[0]!.id]);
}

const next = async (reader: ReadableStreamDefaultReader<Uint8Array>, ms = 2_000) => {
  const timeout = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), ms));
  const read = reader
    .read()
    .then(({ done, value }) => (done ? "done" : new TextDecoder().decode(value)));
  return Promise.race([read, timeout]);
};

describe("realtime listener against a real database", () => {
  it("A7 + A8: tenant A's real event reaches A only, and nothing after A's admin row is revoked", async () => {
    const [tenantA, tenantB] = [await seedTenant(), await seedTenant()];
    const [adminA, adminB] = [await seedAdmin(tenantA), await seedAdmin(tenantB)];
    const allow = { recheck: async () => true };
    const readerA = openRealtimeStream(realtimeListener(), adminA, allow)!.getReader();
    const readerB = openRealtimeStream(realtimeListener(), adminB, allow)!.getReader();
    try {
      expect(await next(readerA)).toBe(": hb\n\n");
      expect(await next(readerB)).toBe(": hb\n\n");
      const session = await seedSession(tenantA);

      await editAndNotify(tenantA, session, "Court 2");
      const frame = await next(readerA);
      expect(frame).toMatch(/^data: \{.*\}\n\n$/);
      const pushed = JSON.parse(String(frame).slice(6)) as Record<string, unknown>;
      expect(Object.keys(pushed).sort()).toEqual(["sessionId", "type", "version"]);
      expect(pushed).toMatchObject({ sessionId: session.id, type: expect.any(String) });
      expect(Number.isInteger(pushed.version)).toBe(true);
      expect(await next(readerB, 600)).toBe("timeout");

      await ctx.owner.query(
        `UPDATE tenant_admins SET active = false WHERE tenant_id = $1 AND platform_user_lookup_hash = $2`,
        [tenantA, adminA.personId],
      );
      await editAndNotify(tenantA, session, "Court 3");
      expect(await next(readerA, 600)).toBe("timeout");
    } finally {
      await readerA.cancel();
      await readerB.cancel();
    }
    expect(realtimeListener().stats()).toEqual({
      subscribers: 0,
      accounts: 0,
      listening: false,
      pending: 0,
    });
  });
});

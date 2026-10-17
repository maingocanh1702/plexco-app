import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  setupRlsTestContext,
  type RlsTestContext,
} from "../../../../packages/db/src/test-harness.js";
import { runDispatchCycle, type ClaimedDeliveryJob, type DeliveryOutcome } from "../dispatcher.js";
import type { Queryable } from "../projector-registry.js";
import { createPublicSessionsDeliver, deliverPublicSessions } from "./public-sessions.js";

// The public_sessions projector (readiness 4.7, PSB-1..PSB-6) against the real 0061 / 0033
// definers on the app_worker seat. The registry row is enabled only in this suite's own DB, as the
// owner; committed state keeps it disabled. Real PG; DATABASE_URL_TEST required.
const HOUR = 3_600_000;
const SECRET = "Secret"; // every person, guest, tenant name and venue fixture carries it

function job(over: Partial<ClaimedDeliveryJob["event"]> = {}): ClaimedDeliveryJob {
  return {
    eventId: randomUUID(),
    tenantId: randomUUID(),
    projector: "public_sessions",
    claimToken: randomUUID(),
    attempts: 0,
    event: {
      eventType: "session.updated",
      aggregateType: "session",
      aggregateId: randomUUID(),
      sequence: 1,
      tenantId: randomUUID(),
      payload: {},
      createdAt: new Date(),
      ...over,
    },
  };
}
/** A Queryable that answers every statement with `answer` (a value, or a thrown error). */
const fakeDb = (answer: () => Promise<unknown>) =>
  ({ query: vi.fn(answer) }) as unknown as Queryable & { query: ReturnType<typeof vi.fn> };
const pgError = (code: string) => Object.assign(new Error(`failure ${code}`), { code });

describe("public_sessions projector before any SQL, and the outcome mapping (P-13)", () => {
  it("dead-letters an unknown aggregate type and a non-UUID aggregate id without any statement", async () => {
    const db = fakeDb(async () => ({ rows: [] }));
    const deliver = createPublicSessionsDeliver({ db });
    const cases: [Partial<ClaimedDeliveryJob["event"]>, string][] = [
      [{ aggregateType: "booking" }, "unsupported_event"],
      [{ aggregateType: "membership", eventType: "session.updated" }, "unsupported_event"],
      [{ aggregateId: "not-a-uuid" }, "malformed_event"],
      [
        { aggregateType: "tenant", aggregateId: "1; DROP TABLE public_sessions" },
        "malformed_event",
      ],
    ];
    for (const [over, errorCode] of cases) {
      expect(await deliver(job(over))).toEqual({ result: "dlq", errorCode });
    }
    expect(db.query).not.toHaveBeenCalled();
  });

  it("dead-letters config_missing without DATABASE_URL_DIRECT and opens no connection", async () => {
    const poolQuery = vi.spyOn(pg.Pool.prototype, "query");
    vi.stubEnv("DATABASE_URL_DIRECT", "");
    try {
      expect(await deliverPublicSessions(job())).toEqual({
        result: "dlq",
        errorCode: "config_missing",
      });
      expect(poolQuery).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
    }
  });

  it("maps every DB failure to a retry the dispatcher bounds, and never throws", async () => {
    const cases: [unknown, string][] = [
      [pgError("40001"), "serialization_failure"],
      [pgError("40P01"), "deadlock_detected"],
      [pgError("ECONNRESET"), "connection_error"],
      [pgError("08006"), "connection_error"],
      [pgError("57P01"), "connection_error"],
      [pgError("42501"), "db_error"],
      [new Error("Connection terminated unexpectedly"), "db_error"],
      ["not an Error", "db_error"],
    ];
    for (const [error, errorCode] of cases) {
      const deliver = createPublicSessionsDeliver({ db: fakeDb(() => Promise.reject(error)) });
      for (const aggregateType of ["session", "tenant"]) {
        await expect(deliver(job({ aggregateType }))).resolves.toEqual({
          result: "retry",
          errorCode,
        });
      }
    }
  });
});

describe("public_sessions projector against the 0061 definers (as app_worker)", () => {
  let ctx: RlsTestContext;
  let deliver: ReturnType<typeof createPublicSessionsDeliver>;
  type Row = Record<string, unknown>;
  const owner = async (sql: string, params: unknown[] = []) =>
    (await ctx.owner.query(sql, params)).rows as Row[];

  beforeAll(async () => {
    ctx = await setupRlsTestContext("plexco_bot_public_sessions");
    await owner("SELECT outbox_projector_set_enabled('public_sessions', true)");
    deliver = createPublicSessionsDeliver({ db: ctx.workerPool });
  }, 120_000);
  afterAll(async () => ctx?.teardown(), 120_000);

  async function club(): Promise<string> {
    const [t] = await owner(
      `INSERT INTO tenants (name, slug, public_alias, public_alias_status)
       VALUES ($1, $2, 'CLB Q7', 'approved') RETURNING id`,
      [`${SECRET} Tenant ${randomUUID()}`, `psb-${randomUUID()}`],
    );
    return t!.id as string;
  }
  async function session(tenantId: string, slotsMax = 10, visibility = "public"): Promise<string> {
    const [r] = await owner(
      `INSERT INTO sessions (tenant_id, sport_id, starts_at, ends_at, timezone, venue_name, venue_address, area,
         price_amount, slots_max, visibility, join_policy, status)
       VALUES ($1, $2, $3, $3::timestamptz + interval '2 hours', 'Asia/Ho_Chi_Minh', $4, $4, 'Quan 7', 50000,
         $5, $6, 'open', 'open')
       RETURNING id`,
      [
        tenantId,
        ctx.badmintonSportId,
        new Date(Date.now() + 24 * HOUR),
        `${SECRET} Venue`,
        slotsMax,
        visibility,
      ],
    );
    return r!.id as string;
  }
  let rank = 0;
  async function seat(tenantId: string, sessionId: string, status: string): Promise<void> {
    const [p] = await owner(`INSERT INTO persons (display_name) VALUES ($1) RETURNING id`, [
      `${SECRET} Person`,
    ]);
    const [m] = await owner(
      `INSERT INTO memberships (tenant_id, person_id, status) VALUES ($1, $2, 'active') RETURNING id`,
      [tenantId, p!.id],
    );
    await owner(
      `INSERT INTO players (tenant_id, session_id, membership_id, status, waitlist_position)
       VALUES ($1, $2, $3, $4, $5)`,
      [tenantId, sessionId, m!.id, status, status === "waitlisted" ? ++rank : null],
    );
  }
  async function guest(tenantId: string, sessionId: string): Promise<void> {
    const [p] = await owner(`INSERT INTO persons (display_name) VALUES ($1) RETURNING id`, [
      `${SECRET} Host`,
    ]);
    await owner(
      `INSERT INTO session_guest_notes (tenant_id, session_id, created_by_person_id, guest_name)
       VALUES ($1, $2, $3, $4)`,
      [tenantId, sessionId, p!.id, `${SECRET} Guest`],
    );
  }
  /** An outbox event as the domain writes it; the dispatcher routes it (0061 routes). */
  async function emit(tenantId: string, aggregateType: string, aggregateId: string, type: string) {
    const [e] = await owner(
      `INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, sequence, type, payload)
       VALUES ($1, $2, $3, (SELECT coalesce(max(sequence), 0) + 1 FROM outbox_events WHERE aggregate_id = $3),
         $4, '{"slots_open": 99, "host_display_name": "Secret Host"}'::jsonb)
       RETURNING id`,
      [tenantId, aggregateType, aggregateId, type],
    );
    return e!.id as string;
  }
  const cycle = (d = deliver) =>
    runDispatchCycle(ctx.workerPool, { projectors: new Map([["public_sessions", d]]) });
  const delivery = async (eventId: string) =>
    (
      await owner(
        `SELECT status, attempts, error_code FROM projector_deliveries
          WHERE event_id = $1 AND projector = 'public_sessions'`,
        [eventId],
      )
    )[0];
  const baseRow = async (sid: string) =>
    (await owner("SELECT * FROM public_sessions WHERE id = $1", [sid]))[0];
  const viewRow = async (sid: string) =>
    (
      await ctx.readonlyPool.query(
        "SELECT * FROM public_session_share_v WHERE public_listing_id = $1",
        [(await baseRow(sid))!.public_listing_id],
      )
    ).rows[0] as Row | undefined;
  const fenceToken = async (sid: string) =>
    (await ctx.workerPool.query("SELECT current_public_session_fence_token($1) AS t", [sid]))
      .rows[0].t as string | null;
  /** The host's command path: raise the DD-12 fence in a tenant-scoped app transaction. */
  async function raise(tenantId: string, sid: string, reason: string): Promise<void> {
    const c = await ctx.appPool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      await c.query("SELECT raise_public_session_fence($1, $2)", [sid, reason]);
      await c.query("COMMIT");
    } finally {
      c.release();
    }
  }
  const delivered = (providerRef: string): DeliveryOutcome => ({
    result: "delivered",
    providerRef,
  });
  const sessionJob = (sid: string, eventType = "session.updated", payload: unknown = {}) =>
    job({ aggregateId: sid, eventType, payload });

  it("PSB-1: one dispatch cycle projects an eligible session; the view serves it with canonical slots_open (A-2, P-15)", async () => {
    const t = await club();
    const sid = await session(t, 6);
    await seat(t, sid, "active");
    await seat(t, sid, "active");
    await seat(t, sid, "waitlisted");
    await seat(t, sid, "left");
    await guest(t, sid);
    const eventId = await emit(t, "session", sid, "session.published");
    expect(await baseRow(sid)).toBeUndefined();
    await cycle();
    expect(await delivery(eventId)).toMatchObject({ status: "delivered", error_code: null });
    const row = await viewRow(sid);
    expect(row).toMatchObject({ slots_open: 3, club_display_name: "CLB Q7", area: "Quan 7" });
    expect(JSON.stringify(row)).not.toContain(SECRET);
  });

  it("PSB-2: a poison delivery that retries leaves its sibling delivered in the same cycle (A-11)", async () => {
    const t = await club();
    const poison = await session(t);
    const sibling = await session(t);
    const faulty = {
      query: (text: string, params?: unknown[]) =>
        text.includes("public_sessions_project_session") && params?.[0] === poison
          ? Promise.reject(pgError("40P01"))
          : ctx.workerPool.query(text, params),
    } as unknown as Queryable;
    const bad = await emit(t, "session", poison, "session.updated");
    const good = await emit(t, "session", sibling, "player.added");
    await cycle(createPublicSessionsDeliver({ db: faulty }));
    expect(await delivery(good)).toMatchObject({ status: "delivered" });
    expect(await delivery(bad)).toMatchObject({ attempts: 1, error_code: "deadlock_detected" });
    expect((await delivery(bad))!.status).not.toBe("delivered");
    expect(await viewRow(sibling)).toBeDefined();
    expect(await baseRow(poison)).toBeUndefined();
  });

  it("PSB-3: a tenant alias event deletes, then re-projects, every candidate session of that tenant only (A-6)", async () => {
    const t = await club();
    const mine = [await session(t), await session(t)];
    const other = await session(await club());
    for (const sid of [...mine, other])
      expect(await deliver(sessionJob(sid))).toEqual(delivered("upserted"));
    await owner("UPDATE tenants SET public_alias_status = 'rejected' WHERE id = $1", [t]);
    const rejected = await emit(t, "tenant", t, "tenant.public_alias_rejected");
    await cycle();
    expect(await delivery(rejected)).toMatchObject({ status: "delivered" });
    for (const sid of mine) expect(await baseRow(sid)).toBeUndefined();
    expect(await baseRow(other)).toBeDefined();
    await owner("UPDATE tenants SET public_alias_status = 'approved' WHERE id = $1", [t]);
    await emit(t, "tenant", t, "tenant.public_alias_approved");
    await cycle();
    for (const sid of mine)
      expect(await viewRow(sid)).toMatchObject({ club_display_name: "CLB Q7" });
  });

  it("PSB-4: private, cancel and close delete the row; the fence is CAS-cleared only while its token is the observed one (A-8)", async () => {
    const t = await club();
    const flips: [string, string][] = [
      ["visibility_private", "UPDATE sessions SET visibility = 'private' WHERE id = $1"],
      ["cancelled", "UPDATE sessions SET status = 'cancelled' WHERE id = $1"],
      ["closed", "UPDATE sessions SET status = 'closed' WHERE id = $1"],
    ];
    for (const [reason, flip] of flips) {
      const sid = await session(t);
      expect(await deliver(sessionJob(sid))).toEqual(delivered("upserted"));
      await raise(t, sid, reason);
      await owner(flip, [sid]);
      expect(await deliver(sessionJob(sid, "session.visibility_changed"))).toEqual(
        delivered("deleted"),
      );
      expect(await baseRow(sid)).toBeUndefined();
      expect(await fenceToken(sid)).toBeNull();
    }
    // A newer raise between the observe and the clear survives: the CAS clear is a no-op.
    const sid = await session(t);
    expect(await deliver(sessionJob(sid))).toEqual(delivered("upserted"));
    await raise(t, sid, "visibility_private");
    const observed = await fenceToken(sid);
    await owner("UPDATE sessions SET visibility = 'private' WHERE id = $1", [sid]);
    const racing = {
      query: async (text: string, params?: unknown[]) => {
        const result = await ctx.workerPool.query(text, params);
        if (text.includes("public_sessions_project_session"))
          await raise(t, sid, "visibility_private");
        return result;
      },
    } as unknown as Queryable;
    expect(await createPublicSessionsDeliver({ db: racing })(sessionJob(sid))).toEqual(
      delivered("deleted"),
    );
    const survivor = await fenceToken(sid);
    expect(survivor).not.toBeNull();
    expect(survivor).not.toBe(observed);
    expect(await deliver(sessionJob(sid))).toEqual(delivered("absent"));
    expect(await fenceToken(sid)).toBeNull();
  });

  it("PSB-5: every permutation of occupancy and roster events converges to the same row and slots_open (A-9)", async () => {
    const types = [
      "player.added",
      "player.waitlisted",
      "player.removed",
      "guest_note.created",
      "join_request.approved",
    ];
    const orders = [
      types,
      [...types].reverse(),
      [types[2]!, types[4]!, types[0]!, types[3]!, types[1]!],
    ];
    const finals: Row[] = [];
    for (const order of orders) {
      const t = await club();
      const sid = await session(t, 8);
      const changes = [
        () => seat(t, sid, "active"),
        () => seat(t, sid, "waitlisted"),
        () => seat(t, sid, "active"),
        () => guest(t, sid),
      ];
      // Each event is delivered after a canonical change it does not describe; the last one after all.
      for (const [i, eventType] of order.entries()) {
        await changes[i]?.();
        expect((await deliver(sessionJob(sid, eventType))).result).toBe("delivered");
      }
      const row = (await baseRow(sid))!;
      finals.push({ slots_open: row.slots_open, version: String(row.public_projection_version) });
    }
    expect(finals).toEqual([finals[0], finals[0], finals[0]]);
    expect(finals[0]).toEqual({ slots_open: 5, version: "3" }); // 8 - (2 active + 1 guest)
  });

  it("PSB-6: a forged payload or aggregate id causes at most a recompute from canonical rows (A-10)", async () => {
    const t = await club();
    const sid = await session(t, 4);
    await seat(t, sid, "active");
    const forged = {
      slots_open: 99,
      slots_max: 99,
      title: "Forged",
      price_amount: 1,
      host_display_name: `${SECRET} Host`,
      tenant_id: ctx.tenantB,
      visibility: "public",
    };
    expect(await deliver(sessionJob(sid, "session.updated", forged))).toEqual(
      delivered("upserted"),
    );
    const row = (await baseRow(sid))!;
    expect(row).toMatchObject({ slots_open: 3, title: null, tenant_id: t });
    expect(String(row.price_amount)).toBe("50000");
    expect(await deliver(sessionJob(sid, "session.published", forged))).toEqual(
      delivered("unchanged"),
    );
    expect((await baseRow(sid))!.public_projection_version).toBe(row.public_projection_version);
    const privateSid = await session(t, 4, "private");
    expect(await deliver(sessionJob(privateSid, "session.published", forged))).toEqual(
      delivered("absent"),
    );
    expect(await deliver(sessionJob(randomUUID(), "session.published", forged))).toEqual(
      delivered("absent"),
    );
    expect(await baseRow(privateSid)).toBeUndefined();
    const tenantEvent = job({
      aggregateType: "tenant",
      aggregateId: await club(),
      payload: forged,
    });
    expect(await deliver(tenantEvent)).toEqual(delivered("tenant_0"));
    expect(JSON.stringify(await owner("SELECT * FROM public_sessions"))).not.toContain(SECRET);
  });
});

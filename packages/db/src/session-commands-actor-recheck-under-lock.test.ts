// L48 (p4-session-commands-authz-recheck): real-PG proof of the invariant
// `actor-recheck-under-lock`. Each of the six host session commands (create, publish, announce,
// update, close, cancel) re-checks `session.manage` for its actor as the FIRST statement of its
// transaction (session-service.ts actorRecheckUnderLock), before the commandId ledger read. So a
// revoked actor (its tenant_admins row deactivated and committed) is refused with
// SessionActorNotAuthorizedError (code FORBIDDEN) and the command writes nothing; and a revoked
// actor replaying a commandId it committed while authorized gets the same refusal, never the
// stored result.
//
// Ids against section 7 (acceptance matrix) of the lane's readiness file
// docs/sessions/web-mvp-phase4-readiness-p4-session-commands-authz-recheck.md:
//   RF (a)        = L48-a-<command>: revoked before the command -> FORBIDDEN, nothing written
//   RF (a) replay = L48-c-<command>: an authorized replay returns the stored result and writes
//                   nothing; after the revoke the same replay is refused, nothing written
//   RF (d)        = L48-d-<command> (authorized smoke) plus the existing suites
//   RF (f)        = L48-f: the announce payload's requested_by_person_id is the actor
//   RF (b)        = L48-b1: a revoke committed while publish waits on the actor's row lock (seen
//                   through pg_blocking_pids) -> the same refusal, nothing written
//   RF (c)        = L48-b2: publish parked after its recheck (the CONC2 barrier) holds the row: a
//                   revoke under lock_timeout fails 55P03; released, publish commits normally
//   RF (g)        = L48-g: source guard, each command's transaction callback opens with the
//                   recheck; planted copies (the call cut, a tx. call before it) are reported
//
// Runs as the `app` role via the RLS harness on its own database (DATABASE_URL_TEST required).
// The helpers are copied from session-service.test.ts (SST), not imported: they are module-local.

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  announceSession,
  cancelSession,
  closeSession,
  createSession,
  publishSession,
  updateSession,
  SessionActorNotAuthorizedError,
  type AnnounceChannel,
} from "./session-service.js";
import { setupRlsTestContext, withJobDefinerLock, type RlsTestContext } from "./test-harness.js";

let ctx: RlsTestContext;
let seq = 0;
const cmdId = () => `cmd-${seq++}`;
const ACTOR: string = randomUUID(); // an active web owner-admin of every tenant this file seeds
const CH: AnnounceChannel = "zalo";
const future = () => new Date(Date.now() + 24 * 3600 * 1000);
const plus2h = (d: Date) => new Date(d.getTime() + 2 * 3600 * 1000);

// owner (superuser) reads: bypass RLS to see the tenant's rows.
const rows = async (text: string, params: unknown[] = []) =>
  (await ctx.owner.query(text, params)).rows as Record<string, unknown>[];

// A fresh active tenant with an active subscription where ACTOR is an active web owner admin
// (SST seedTenant("active", "active"), whose makeActorAdmin row is inlined here).
async function seedTenant(): Promise<string> {
  const unique = randomUUID();
  const t = await ctx.owner.query(
    `INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'active') RETURNING id`,
    [`Actor Recheck ${unique}`, `actor-recheck-${unique}`],
  );
  const tenantId = (t.rows[0] as { id: string }).id;
  await ctx.owner.query(
    `INSERT INTO tenant_admins (tenant_id, platform, platform_user_lookup_hash, role, active)
     VALUES ($1, 'web', $2, 'owner', true)`,
    [tenantId, ACTOR],
  );
  await ctx.owner.query(
    `INSERT INTO subscriptions (tenant_id, plan_key, plan_version, status, period_start, period_end)
     VALUES ($1, 'free', 1, 'active', now(), now() + interval '30 days')`,
    [tenantId],
  );
  return tenantId;
}

// A private future session at `status` (the SST close/cancel seedSession shape).
async function seedSession(
  tenantId: string,
  status: "draft" | "open",
): Promise<{ sessionId: string; version: number }> {
  const startsAt = future();
  const s = await ctx.owner.query(
    `INSERT INTO sessions (tenant_id, sport_id, starts_at, ends_at, timezone, area, slots_max, visibility, price_amount, status)
     VALUES ($1, $2, $3, $4, 'Asia/Ho_Chi_Minh', 'Quận 1', 8, 'private', 120000, $5)
     RETURNING id, version`,
    [tenantId, ctx.badmintonSportId, startsAt, plus2h(startsAt), status],
  );
  const r = s.rows[0] as { id: string; version: number };
  return { sessionId: r.id, version: r.version };
}

// Revoke ACTOR's admin row, committed through ctx.owner: the only revoke shape
// (tenant-capability-authority.test.ts, `UPDATE tenant_admins SET active = false`).
async function revoke(tenantId: string): Promise<void> {
  const r = await ctx.owner.query(
    `UPDATE tenant_admins SET active = false
      WHERE tenant_id = $1 AND platform_user_lookup_hash = $2`,
    [tenantId, ACTOR],
  );
  expect(r.rowCount).toBe(1);
}

// Every row a host command can write for the tenant (cancel's audit event is an outbox row):
// "writes nothing" = toEqual the snapshot taken before the call.
async function snapshot(tenantId: string) {
  const q = (sql: string) => rows(sql, [tenantId]);
  return {
    sessions: await q(`SELECT * FROM sessions WHERE tenant_id = $1 ORDER BY id`),
    processedCommands: await q(
      `SELECT * FROM processed_commands WHERE tenant_id = $1 ORDER BY command_id`,
    ),
    outbox: await q(
      `SELECT * FROM outbox_events WHERE tenant_id = $1 ORDER BY aggregate_id, sequence`,
    ),
    players: await q(`SELECT * FROM players WHERE tenant_id = $1 ORDER BY id`),
  };
}

// The refusal: an instance of SessionActorNotAuthorizedError, code FORBIDDEN, nothing written.
async function expectRefused(tenantId: string, run: () => Promise<unknown>): Promise<void> {
  const before = await snapshot(tenantId);
  const err = await run().catch((e: unknown) => e);
  expect(err).toBeInstanceOf(SessionActorNotAuthorizedError);
  expect((err as SessionActorNotAuthorizedError).code).toBe("FORBIDDEN");
  expect(await snapshot(tenantId)).toEqual(before);
}

// Announce delivery readiness (the SST announce block): the zalo_dm projector enabled through the
// owner path as job_definer, and a fresh schedule_enabled heartbeat through the app_worker seat.
const setZaloDm = (on: boolean) =>
  withJobDefinerLock(process.env.DATABASE_URL_TEST!, async () => {
    await ctx.owner.query("BEGIN");
    try {
      await ctx.owner.query("SET LOCAL ROLE job_definer");
      await ctx.owner.query("SELECT outbox_projector_set_enabled('zalo_dm', $1)", [on]);
      await ctx.owner.query("COMMIT");
    } catch (error) {
      await ctx.owner.query("ROLLBACK");
      throw error;
    }
  });
const heartbeat = () =>
  ctx.workerPool.query("SELECT job_worker_heartbeat($1, 'h', 1, $2::boolean)", [
    `announce-${randomUUID()}`,
    true,
  ]);
const clearHeartbeats = () => ctx.owner.query("DELETE FROM job_worker_heartbeats");

interface Prepared {
  /** The command as ACTOR with the given commandId. */
  run: (commandId: string) => Promise<{ replayed: boolean }>;
  /** The fresh-success fields the mirrored SST test asserts. */
  expected: Record<string, unknown>;
}

interface HostCommand {
  name: string;
  /** The one outbox event a fresh success writes. */
  event: string;
  /** Seeds the state the command needs to succeed for an authorized actor. */
  prepare: (tenantId: string) => Promise<Prepared>;
}

const COMMANDS: HostCommand[] = [
  {
    // mirrors SST A1 (CreateSession)
    name: "create",
    event: "session.created",
    prepare: async (tenantId) => {
      const startsAt = future();
      return {
        run: (commandId) =>
          createSession(ctx.appDb.db, {
            tenantId,
            actorPersonId: ACTOR,
            commandId,
            input: {
              sportId: ctx.badmintonSportId,
              startsAt,
              endsAt: plus2h(startsAt),
              timezone: "Asia/Ho_Chi_Minh",
              priceAmount: 120000,
            },
          }),
        expected: { status: "draft", version: 1, visibility: "private" },
      };
    },
  },
  {
    // mirrors SST A1 (PublishSession)
    name: "publish",
    event: "session.published",
    prepare: async (tenantId) => {
      const { sessionId, version } = await seedSession(tenantId, "draft");
      return {
        run: (commandId) =>
          publishSession(ctx.appDb.db, {
            tenantId,
            actorPersonId: ACTOR,
            commandId,
            input: { sessionId },
          }),
        expected: { sessionId, status: "open", visibility: "private", version: version + 1 },
      };
    },
  },
  {
    // mirrors SST AN1
    name: "announce",
    event: "session.announcement_requested",
    prepare: async (tenantId) => {
      await clearHeartbeats();
      await heartbeat();
      const { sessionId } = await seedSession(tenantId, "open");
      return {
        run: (commandId) =>
          announceSession(ctx.appDb.db, {
            tenantId,
            commandId,
            requestedByPersonId: ACTOR,
            input: { sessionId, channel: CH },
          }),
        expected: { sessionId, channel: CH },
      };
    },
  },
  {
    // mirrors SST U1
    name: "update",
    event: "session.updated",
    prepare: async (tenantId) => {
      const { sessionId, version } = await seedSession(tenantId, "open");
      return {
        run: (commandId) =>
          updateSession(ctx.appDb.db, {
            tenantId,
            actorPersonId: ACTOR,
            commandId,
            input: { sessionId, expectedVersion: version, area: "Quận 3", priceAmount: 90000 },
          }),
        expected: { sessionId, status: "open", version: version + 1 },
      };
    },
  },
  {
    // mirrors SST C1
    name: "close",
    event: "session.closed",
    prepare: async (tenantId) => {
      const { sessionId, version } = await seedSession(tenantId, "open");
      return {
        run: (commandId) =>
          closeSession(ctx.appDb.db, {
            tenantId,
            actorPersonId: ACTOR,
            commandId,
            input: { sessionId, expectedVersion: version },
          }),
        expected: { sessionId, status: "closed", version: version + 1 },
      };
    },
  },
  {
    // mirrors SST XC1
    name: "cancel",
    event: "session.cancelled",
    prepare: async (tenantId) => {
      const { sessionId, version } = await seedSession(tenantId, "open");
      return {
        run: (commandId) =>
          cancelSession(ctx.appDb.db, {
            tenantId,
            actorPersonId: ACTOR,
            commandId,
            input: { sessionId, expectedVersion: version },
          }),
        expected: { sessionId, status: "cancelled", version: version + 1 },
      };
    },
  },
];

beforeAll(async () => {
  ctx = await setupRlsTestContext("plexco_session_actor_recheck_check");
  await ctx.owner.query(`INSERT INTO persons (id, display_name) VALUES ($1, $2)`, [
    ACTOR,
    `p-actor-${randomUUID()}`,
  ]);
  await setZaloDm(true);
}, 120_000);

afterAll(async () => {
  try {
    await setZaloDm(false);
    await clearHeartbeats();
  } finally {
    await ctx?.teardown();
  }
});

describe("L48-a: a revoked actor is refused before the command writes anything", () => {
  for (const c of COMMANDS) {
    it(`L48-a-${c.name}: the actor's admin row revoked first -> SessionActorNotAuthorizedError (FORBIDDEN), nothing written`, async () => {
      const tenantId = await seedTenant();
      const { run } = await c.prepare(tenantId);
      await revoke(tenantId);
      await expectRefused(tenantId, () => run(cmdId()));
    }, 30_000);
  }
});

describe("L48-c: a revoked actor's replay of a committed commandId is refused, never the stored result", () => {
  for (const c of COMMANDS) {
    it(`L48-c-${c.name}: authorized replay returns the stored result; after the revoke the same replay is refused, nothing written`, async () => {
      const tenantId = await seedTenant();
      const { run } = await c.prepare(tenantId);
      const commandId = cmdId();
      const first = await run(commandId);
      expect(first.replayed).toBe(false);
      // authorized replay: the stored result and no write (mirrors SST CC1/OBS1)
      const before = await snapshot(tenantId);
      expect(await run(commandId)).toEqual({ ...first, replayed: true });
      expect(await snapshot(tenantId)).toEqual(before);
      await revoke(tenantId);
      await expectRefused(tenantId, () => run(commandId));
    }, 30_000);
  }
});

describe("L48-d: an authorized actor's command succeeds (smoke)", () => {
  for (const c of COMMANDS) {
    it(`L48-d-${c.name}: the authorized actor's ${c.name} succeeds with the SST result shape, one ${c.event} event, one ledger row`, async () => {
      const tenantId = await seedTenant();
      const { run, expected } = await c.prepare(tenantId);
      expect(await run(cmdId())).toMatchObject({ ...expected, replayed: false });
      const after = await snapshot(tenantId);
      expect(after.outbox.filter((e) => e.type === c.event)).toHaveLength(1);
      expect(after.processedCommands).toHaveLength(1);
    }, 30_000);
  }
});

describe("L48-f: announce records the authorized actor as the requester", () => {
  it("L48-f: an authorized announce writes exactly one outbox row whose requested_by_person_id is the actor (lowercase)", async () => {
    const announce = COMMANDS.find((c) => c.name === "announce");
    if (!announce) throw new Error("COMMANDS has no announce entry");
    const tenantId = await seedTenant();
    const { run, expected } = await announce.prepare(tenantId);
    await run(cmdId());
    const events = await rows(`SELECT type, payload FROM outbox_events WHERE aggregate_id = $1`, [
      expected.sessionId,
    ]);
    expect(events).toEqual([
      {
        type: "session.announcement_requested",
        payload: {
          session_id: expected.sessionId,
          channel: CH,
          requested_by_person_id: ACTOR.toLowerCase(),
        },
      },
    ]);
  }, 30_000);
});

// revoke()'s statement, run on a dedicated connection that the test commits (or not) itself.
const REVOKE = `UPDATE tenant_admins SET active = false
  WHERE tenant_id = $1 AND platform_user_lookup_hash = $2`;

// A dedicated superuser connection (SST CONC2: superuserDb.pool hands out fresh connections, and
// superuser may LOCK TABLE), and its backend pid.
const connect = () => ctx.superuserDb.pool.connect();
type Conn = Awaited<ReturnType<typeof connect>>;
const pidOf = async (c: Conn) =>
  ((await c.query("SELECT pg_backend_pid() AS pid")).rows[0] as { pid: number }).pid;

// SST waitUntilSomeoneBlockedByHolder, returning the blocked backend's pid: a lock wait is seen
// through pg_blocking_pids, never assumed after a fixed sleep.
async function waitBlockedBy(holderPid: number): Promise<number> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const [hit] = await rows(
      `SELECT pid FROM pg_stat_activity
         WHERE wait_event_type = 'Lock' AND $1 = ANY(pg_blocking_pids(pid))`,
      [holderPid],
    );
    if (hit) return hit.pid as number;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error(`no backend became blocked by holder ${holderPid} within 5s`);
}

// COMMANDS' publish entry (it seeds a draft), the command both lock tests drive: its recheck is
// its first statement and its outbox insert comes after it, which the L48-b2 barrier relies on.
async function preparePublish(tenantId: string): Promise<Prepared> {
  const publish = COMMANDS.find((c) => c.name === "publish");
  if (!publish) throw new Error("COMMANDS has no publish entry");
  return publish.prepare(tenantId);
}

describe("L48-b1: a revoke committed while the command waits on the actor's row is refused", () => {
  it("L48-b1: the revoke holds the actor's row first, publish waits on it at its recheck, the revoke commits -> SessionActorNotAuthorizedError (FORBIDDEN), nothing written", async () => {
    const tenantId = await seedTenant();
    const { run } = await preparePublish(tenantId);
    const holder = await connect(); // R
    let pending: Promise<unknown> | undefined;
    try {
      await holder.query("BEGIN");
      expect((await holder.query(REVOKE, [tenantId, ACTOR])).rowCount).toBe(1); // not committed
      const holderPid = await pidOf(holder);
      const before = await snapshot(tenantId);
      pending = run(cmdId()).then(
        (r) => r,
        (e: unknown) => e,
      );
      await waitBlockedBy(holderPid); // publish waits on the row lock R holds
      await holder.query("COMMIT"); // the revoke lands while publish waits
      const err = await pending;
      pending = undefined;
      // after the wait the definer re-reads ta.active and denies
      expect(err).toBeInstanceOf(SessionActorNotAuthorizedError);
      expect((err as SessionActorNotAuthorizedError).code).toBe("FORBIDDEN");
      expect(await snapshot(tenantId)).toEqual(before);
    } finally {
      await holder.query("ROLLBACK").catch(() => undefined);
      await pending;
      holder.release();
    }
  }, 30_000);
});

describe("L48-b2: the command holds the actor's row from its recheck until it commits", () => {
  it("L48-b2: publish parked after its recheck (CONC2 barrier) holds the row: a lock_timeout revoke fails 55P03, a plain revoke waits on publish; the barrier released, publish commits normally, then the revoke lands", async () => {
    const tenantId = await seedTenant();
    const { run, expected } = await preparePublish(tenantId);
    const barrier = await connect(); // B
    let r2: Conn | undefined;
    let pending: Promise<unknown> | undefined;
    let revoking: Promise<unknown> | undefined;
    try {
      await barrier.query("BEGIN");
      await barrier.query("LOCK TABLE outbox_events IN ACCESS EXCLUSIVE MODE");
      pending = run(cmdId()).then(
        (r) => r,
        (e: unknown) => e,
      );
      // parked at its outbox insert, past its recheck: it holds the actor's row FOR SHARE
      const cmdPid = await waitBlockedBy(await pidOf(barrier));

      // (i) a revoke under lock_timeout cannot take the row
      const r1 = await connect();
      try {
        await r1.query("BEGIN");
        await r1.query("SET LOCAL lock_timeout = '300ms'");
        const timedOut = await r1.query(REVOKE, [tenantId, ACTOR]).catch((e: unknown) => e);
        expect((timedOut as { code?: unknown }).code).toBe("55P03");
      } finally {
        await r1.query("ROLLBACK").catch(() => undefined);
        r1.release();
      }

      // (ii) a plain revoke waits on the command's backend
      r2 = await connect();
      await r2.query("BEGIN");
      const r2Pid = await pidOf(r2);
      revoking = r2.query(REVOKE, [tenantId, ACTOR]).then(
        (r) => r,
        (e: unknown) => e,
      );
      expect(await waitBlockedBy(cmdPid)).toBe(r2Pid); // pg_blocking_pids(r2Pid) holds cmdPid

      // (iii) the barrier released: publish commits normally, only then the revoke lands
      await barrier.query("COMMIT");
      expect(await pending).toMatchObject({ status: "open", replayed: false });
      pending = undefined;
      expect(((await revoking) as { rowCount?: unknown }).rowCount).toBe(1);
      revoking = undefined;
      await r2.query("COMMIT");
    } finally {
      // the barrier first: it frees publish, which frees the revoke, so nothing below waits forever
      await barrier.query("ROLLBACK").catch(() => undefined);
      await pending;
      await revoking;
      await r2?.query("ROLLBACK").catch(() => undefined);
      r2?.release();
      barrier.release();
    }
    expect(
      await rows(
        `SELECT active FROM tenant_admins WHERE tenant_id = $1 AND platform_user_lookup_hash = $2`,
        [tenantId, ACTOR],
      ),
    ).toEqual([{ active: false }]);
    expect(
      await rows(`SELECT type FROM outbox_events WHERE aggregate_id = $1 AND type = $2`, [
        expected.sessionId,
        "session.published",
      ]),
    ).toHaveLength(1);
  }, 30_000);
});

// L48-g checker: null when fn's transaction callback opens with the recheck, else the reason.
// The body runs from fn's declaration to the next top-level export; the callback is the first
// `async (tx` in it and its block opens at the first `=> {` after that. String scanning only
// (indexOf, slice, split, trim), no RegExp.
const RECHECK = "await actorRecheckUnderLock(tx, {";
function recheckIsFirst(source: string, fn: string): string | null {
  const start = source.indexOf(`export async function ${fn}(`);
  if (start < 0) return `${fn}: not found`;
  const end = source.indexOf("\nexport ", start);
  const body = source.slice(start, end < 0 ? source.length : end);
  const opener = body.indexOf("async (tx");
  const open = opener < 0 ? -1 : body.indexOf("=> {", opener);
  if (open < 0) return `${fn}: no transaction callback`;
  let at = open + "=> {".length; // the offset in body of the line read next
  for (const line of body.slice(at).split("\n")) {
    const code = line.trim();
    if (code !== "" && code.indexOf("//") !== 0) {
      if (code.indexOf(RECHECK) !== 0)
        return `${fn}: the callback's first statement is not the recheck`;
      return body.slice(opener, at).indexOf("tx.") < 0
        ? null
        : `${fn}: a tx. call precedes the recheck`;
    }
    at += line.length + 1;
  }
  return `${fn}: the callback has no statement`;
}

// The [start, end) offsets of the line holding fn's first recheck call, for the planted copies.
function recheckLine(source: string, fn: string): [number, number] {
  const decl = source.indexOf(`export async function ${fn}(`);
  const at = decl < 0 ? -1 : source.indexOf(RECHECK, decl);
  if (at < 0) throw new Error(`${fn}: no recheck call to plant around`);
  return [source.lastIndexOf("\n", at) + 1, source.indexOf("\n", at) + 1];
}

const HOST_COMMANDS = [
  "createSession",
  "publishSession",
  "announceSession",
  "updateSession",
  "closeSession",
  "cancelSession",
];

describe("L48-g: each host command's transaction callback opens with the recheck (source guard)", () => {
  it("L48-g: session-service.ts passes for all six; a copy without cancel's recheck and a copy with a tx. call before publish's recheck are each reported, the other five still passing", () => {
    const ss = readFileSync(new URL("./session-service.ts", import.meta.url), "utf8");
    for (const fn of HOST_COMMANDS) expect(recheckIsFirst(ss, fn)).toBeNull();
    const [cutFrom, cutTo] = recheckLine(ss, "cancelSession");
    const [publishAt] = recheckLine(ss, "publishSession");
    const planted: [string, string][] = [
      ["cancelSession", ss.slice(0, cutFrom) + ss.slice(cutTo)], // the recheck line cut out
      [
        "publishSession", // a tx. statement inserted before the recheck line
        ss.slice(0, publishAt) + "    await tx.execute(sql`select 1`);\n" + ss.slice(publishAt),
      ],
    ];
    for (const [fn, copy] of planted) {
      expect(recheckIsFirst(copy, fn)).toBe(
        `${fn}: the callback's first statement is not the recheck`,
      );
      for (const other of HOST_COMMANDS)
        if (other !== fn) expect(recheckIsFirst(copy, other)).toBeNull();
    }
  }, 30_000);
});

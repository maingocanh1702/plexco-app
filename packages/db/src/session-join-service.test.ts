import { sql, type SQL } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encryptPersonGender, type Gender } from "./gender-crypto.js";
import { markPaid } from "./payment-manual.js";
import { fixtures, nextCommandId } from "./roster-money-fixtures.js";
import { RosterMoneyError } from "./roster-money-shared.js";
import { addMemberToSession } from "./roster-service.js";
import { __resetAuthSecretCacheForTest } from "./secret-key-root.js";
import { hasLiveMembership, joinSession, leaveSession } from "./session-join-service.js";
import { getSessionOccupancy, slotsOpen } from "./session-occupancy.js";
import { withTenant } from "./tenant.js";
import { setupRlsTestContext, type RlsTestContext } from "./test-harness.js";

// Real-PG tests for player self-join, self-leave and FIFO waitlist promotion (L8, readiness section
// 7). Every command AND every assertion read runs as the real `app` role through withTenant on
// ctx.appDb.db (RLS + FORCE RLS, no BYPASSRLS). The owner connection only seeds fixtures, forges
// the states no L8 writer can produce, and installs the A-5 test trigger.
let ctx: RlsTestContext;
const fx = fixtures(() => ctx);

beforeAll(async () => {
  ctx = await setupRlsTestContext("plexco_session_join_service");
}, 120_000);
afterAll(async () => {
  await ctx?.teardown();
});

/** Rows read AS THE APP ROLE under the tenant's GUC: the assertion path of every test. */
const appRows = (tenantId: string, query: SQL) =>
  withTenant(
    ctx.appDb.db,
    tenantId,
    async (tx) => (await tx.execute(query)).rows as Record<string, unknown>[],
  );
const appRow = async (tenantId: string, query: SQL) => (await appRows(tenantId, query))[0]!;

/** Tenant-wide write counters (app role, RLS-scoped): a refusal must leave every one unchanged. */
const state = (tenantId: string) =>
  appRow(
    tenantId,
    sql`SELECT (SELECT count(*)::int FROM players) players,
               (SELECT count(*)::int FROM charges) charges,
               (SELECT count(*)::int FROM payment_allocations) allocations,
               (SELECT count(*)::int FROM outbox_events) events,
               (SELECT count(*)::int FROM processed_commands) commands,
               (SELECT count(*)::int FROM memberships) memberships`,
  );
const events = (tenantId: string, sessionId: string) =>
  appRows(
    tenantId,
    sql`SELECT type, payload FROM outbox_events WHERE aggregate_id = ${sessionId} ORDER BY sequence`,
  );
const playerRow = (tenantId: string, playerId: string | null) =>
  appRow(
    tenantId,
    sql`SELECT status, waitlist_position, joined_at::text AS joined_at FROM players WHERE id = ${playerId}`,
  );
const chargesOf = (tenantId: string, playerId: string | null) =>
  appRows(
    tenantId,
    sql`SELECT id, amount_due, status FROM charges WHERE player_id = ${playerId} ORDER BY id`,
  );

/** A person with a membership of the given status in the tenant (owner seed). */
async function seedMember(tenantId: string, status: "active" | "guest" | "left" = "active") {
  const name = `Member ${nextCommandId()}`;
  const personId = await fx.seedPerson(name);
  const m = await fx.row(
    `INSERT INTO memberships (tenant_id, person_id, display_name, status)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [tenantId, personId, name, status],
  );
  return { personId, membershipId: (m as { id: string }).id };
}

async function world(
  over: {
    slotsMax?: number | null;
    priceAmount?: number;
    status?: string;
    visibility?: "public";
  } = {},
) {
  const tenantId = await fx.seedTenant();
  const host = await fx.seedAdmin(tenantId, "owner");
  const sessionId = await fx.seedSession(tenantId, over);
  if (over.visibility === "public") await makePublic(sessionId);
  return { tenantId, host, sessionId };
}
const makePublic = (sessionId: string) =>
  ctx.owner.query(`UPDATE sessions SET visibility = 'public' WHERE id = $1`, [sessionId]);
const makeStarted = (sessionId: string) =>
  ctx.owner.query(
    `UPDATE sessions SET starts_at = now() - interval '1 minute', ends_at = now() + interval '1 hour'
      WHERE id = $1`,
    [sessionId],
  );
const makeClosed = (sessionId: string) =>
  ctx.owner.query(`UPDATE sessions SET status = 'closed' WHERE id = $1`, [sessionId]);

const join = (
  tenantId: string,
  personId: string,
  sessionId: string,
  opts: { commandId?: string; allowGuestMembership?: boolean } = {},
) =>
  joinSession(ctx.appDb.db, {
    tenantId,
    personId,
    sessionId,
    commandId: opts.commandId ?? nextCommandId(),
    allowGuestMembership: opts.allowGuestMembership ?? false,
  });
const leave = (
  tenantId: string,
  personId: string,
  sessionId: string,
  commandId = nextCommandId(),
) => leaveSession(ctx.appDb.db, { tenantId, personId, sessionId, commandId });

const pay = (tenantId: string, host: string, sessionId: string, playerId: string, amount: number) =>
  markPaid(ctx.appDb.db, {
    tenantId,
    actorPersonId: host,
    commandId: nextCommandId(),
    sessionId,
    method: "cash",
    items: [{ playerId, amount }],
    preview: false,
    expectedTotal: amount,
  });

async function codeOf(run: Promise<unknown>): Promise<string> {
  const err = await run.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err, "expected the command to reject").toBeInstanceOf(RosterMoneyError);
  return (err as RosterMoneyError).code;
}

describe("joinSession", () => {
  it("DT-5: open + free seat -> active with exactly one charge (amount_due = price_amount) and ONE player.added (source self_join); no money rows", async () => {
    const { tenantId, sessionId } = await world({ slotsMax: 4, priceAmount: 120000 });
    const m = await seedMember(tenantId);
    const r = await join(tenantId, m.personId, sessionId);
    expect(r).toEqual({
      outcome: "active",
      playerId: expect.any(String),
      waitlistPosition: null,
      requestId: null,
      replayed: false,
    });
    expect(await chargesOf(tenantId, r.playerId)).toEqual([
      { id: expect.any(String), amount_due: 120000, status: "open" },
    ]);
    expect(await events(tenantId, sessionId)).toEqual([
      {
        type: "player.added",
        payload: {
          session_id: sessionId,
          player_id: r.playerId,
          membership_id: m.membershipId,
          status: "active",
          waitlist_position: null,
          source: "self_join",
        },
      },
    ]);
    expect(await state(tenantId)).toMatchObject({ players: 1, charges: 1, allocations: 0 });
  });

  it("DT-6: open + full -> waitlisted at the FIFO tail with no charge and ONE player.waitlisted; the result carries no venue or amount (P-18)", async () => {
    const { tenantId, sessionId } = await world({ slotsMax: 1 });
    const [a, b, c] = [
      await seedMember(tenantId),
      await seedMember(tenantId),
      await seedMember(tenantId),
    ];
    await join(tenantId, a.personId, sessionId);
    const rb = await join(tenantId, b.personId, sessionId);
    const rc = await join(tenantId, c.personId, sessionId);
    expect(rb).toMatchObject({ outcome: "waitlisted", waitlistPosition: 1, requestId: null });
    expect(rc).toMatchObject({ outcome: "waitlisted", waitlistPosition: 2 });
    expect(Object.keys(rc).sort()).toEqual([
      "outcome",
      "playerId",
      "replayed",
      "requestId",
      "waitlistPosition",
    ]);
    expect(await chargesOf(tenantId, rb.playerId)).toEqual([]);
    expect(await chargesOf(tenantId, rc.playerId)).toEqual([]);
    const ev = await events(tenantId, sessionId);
    expect(ev.map((e) => e.type)).toEqual([
      "player.added",
      "player.waitlisted",
      "player.waitlisted",
    ]);
    expect(ev[2]!.payload).toEqual({
      session_id: sessionId,
      player_id: rc.playerId,
      membership_id: c.membershipId,
      status: "waitlisted",
      waitlist_position: 2,
      source: "self_join",
    });
  });

  it("A-1: 8 parallel joins by 8 members on slots_max = 1 (app role) -> exactly 1 active, 7 waitlisted at distinct positions, 1 charge, 8 events", async () => {
    const { tenantId, sessionId } = await world({ slotsMax: 1 });
    const members = await Promise.all(Array.from({ length: 8 }, () => seedMember(tenantId)));
    const results = await Promise.all(members.map((m) => join(tenantId, m.personId, sessionId)));
    expect(results.map((r) => r.outcome).sort()).toEqual([
      "active",
      ...Array<string>(7).fill("waitlisted"),
    ]);
    expect(
      results
        .filter((r) => r.outcome === "waitlisted")
        .map((r) => r.waitlistPosition!)
        .sort((x, y) => x - y),
    ).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(
      await appRow(
        tenantId,
        sql`SELECT count(*) FILTER (WHERE status = 'active')::int active,
                   count(*) FILTER (WHERE status = 'waitlisted')::int waitlisted,
                   count(DISTINCT waitlist_position)::int positions,
                   (SELECT count(*)::int FROM charges WHERE session_id = ${sessionId}) charges
              FROM players WHERE session_id = ${sessionId}`,
      ),
    ).toEqual({ active: 1, waitlisted: 7, positions: 7, charges: 1 });
    expect((await events(tenantId, sessionId)).map((e) => e.type).sort()).toEqual([
      "player.added",
      ...Array<string>(7).fill("player.waitlisted"),
    ]);
  });

  it("A-2: the same commandId twice, sequential and parallel -> one row, one charge, one event each; the second call is replayed", async () => {
    const { tenantId, sessionId } = await world();
    const seq = await seedMember(tenantId);
    const par = await seedMember(tenantId);
    const seqId = nextCommandId();
    const first = await join(tenantId, seq.personId, sessionId, { commandId: seqId });
    expect(await join(tenantId, seq.personId, sessionId, { commandId: seqId })).toEqual({
      ...first,
      replayed: true,
    });
    const parId = nextCommandId();
    const pair = await Promise.all([
      join(tenantId, par.personId, sessionId, { commandId: parId }),
      join(tenantId, par.personId, sessionId, { commandId: parId }),
    ]);
    expect(pair.map((r) => r.replayed).sort()).toEqual([false, true]);
    expect(pair[0]!.playerId).toBe(pair[1]!.playerId);
    expect(
      await appRow(
        tenantId,
        sql`SELECT (SELECT count(*)::int FROM players WHERE session_id = ${sessionId}) players,
                   (SELECT count(*)::int FROM charges WHERE session_id = ${sessionId}) charges,
                   (SELECT count(*)::int FROM outbox_events WHERE aggregate_id = ${sessionId}) events,
                   (SELECT count(*)::int FROM processed_commands
                     WHERE command_id IN (${seqId}, ${parId})) commands`,
      ),
    ).toEqual({ players: 2, charges: 2, events: 2, commands: 2 });
  });

  it("A-3: the join re-derives under the session lock: a seat taken after a read showed slotsOpen 1 -> waitlisted; a session closed after the read -> SESSION_NOT_JOINABLE", async () => {
    const { tenantId, sessionId } = await world({ slotsMax: 1 });
    const early = await seedMember(tenantId);
    const late = await seedMember(tenantId);
    const shown = await withTenant(ctx.appDb.db, tenantId, async (tx) =>
      slotsOpen(1, await getSessionOccupancy(tx, sessionId)),
    );
    expect(shown).toBe(1);
    await join(tenantId, early.personId, sessionId);
    expect(await join(tenantId, late.personId, sessionId)).toMatchObject({
      outcome: "waitlisted",
      waitlistPosition: 1,
    });

    const closing = await fx.seedSession(tenantId);
    expect(await appRow(tenantId, sql`SELECT status FROM sessions WHERE id = ${closing}`)).toEqual({
      status: "open",
    });
    await makeClosed(closing);
    const before = await state(tenantId);
    expect(await codeOf(join(tenantId, early.personId, closing))).toBe("SESSION_NOT_JOINABLE");
    expect(await state(tenantId)).toEqual(before);
  });

  it("DT-2: draft, closed, cancelled and started sessions and a private session for a guest member are SESSION_NOT_JOINABLE with zero writes; an active member joins a private session and a guest member a public one (P-1, P-2)", async () => {
    const { tenantId, sessionId } = await world();
    const member = await seedMember(tenantId);
    const guest = await seedMember(tenantId, "guest");
    const refused = [
      await fx.seedSession(tenantId, { status: "draft" }),
      await fx.seedSession(tenantId, { status: "closed" }),
      await fx.seedSession(tenantId, { status: "cancelled" }),
      await fx.seedSession(tenantId),
    ];
    await makeStarted(refused[3]!);
    const publicSession = await fx.seedSession(tenantId);
    await makePublic(publicSession);
    const before = await state(tenantId);
    for (const sid of refused) {
      expect(await codeOf(join(tenantId, member.personId, sid))).toBe("SESSION_NOT_JOINABLE");
    }
    expect(await codeOf(join(tenantId, guest.personId, sessionId))).toBe("SESSION_NOT_JOINABLE");
    expect(await state(tenantId)).toEqual(before);

    expect((await join(tenantId, member.personId, sessionId)).outcome).toBe("active");
    expect((await join(tenantId, guest.personId, publicSession)).outcome).toBe("active");
  });

  it("DT-3: an already active or waitlisted player joining again (new commandId) gets the current outcome; players, charges, events and processed_commands unchanged", async () => {
    const { tenantId, sessionId } = await world({ slotsMax: 1 });
    const a = await seedMember(tenantId);
    const w = await seedMember(tenantId);
    const ra = await join(tenantId, a.personId, sessionId);
    const rw = await join(tenantId, w.personId, sessionId);
    const before = await state(tenantId);
    expect(await join(tenantId, a.personId, sessionId)).toEqual(ra);
    expect(await join(tenantId, w.personId, sessionId)).toEqual(rw);
    expect(await state(tenantId)).toEqual(before);
  });

  it("DT-4: a left player with zero money rejoins on the same row with its one charge revived", async () => {
    const { tenantId, sessionId } = await world({ priceAmount: 70000 });
    const m = await seedMember(tenantId);
    const first = await join(tenantId, m.personId, sessionId);
    await leave(tenantId, m.personId, sessionId);
    expect(await chargesOf(tenantId, first.playerId)).toMatchObject([{ status: "void" }]);
    expect(await join(tenantId, m.personId, sessionId)).toEqual({ ...first, replayed: false });
    expect(await chargesOf(tenantId, first.playerId)).toEqual([
      { id: expect.any(String), amount_due: 70000, status: "open" },
    ]);
    expect((await events(tenantId, sessionId)).map((e) => e.type)).toEqual([
      "player.added",
      "player.removed",
      "player.added",
    ]);
  });

  it("DT-4/P-8: a left row with recorded money or a non-void charge -> REJOIN_REQUIRES_REVIEW with zero writes, for the active and the waitlisted outcome", async () => {
    const { tenantId, host, sessionId } = await world({ slotsMax: 1 });
    const paid = await seedMember(tenantId);
    const holder = await seedMember(tenantId);
    const rp = await join(tenantId, paid.personId, sessionId);
    await pay(tenantId, host, sessionId, rp.playerId!, 1000);
    // A `left` row with money that no L8 writer produces (leave refuses net money): forged.
    await ctx.owner.query(`UPDATE players SET status = 'left' WHERE id = $1`, [rp.playerId]);
    const before = await state(tenantId);
    expect(await codeOf(join(tenantId, paid.personId, sessionId))).toBe("REJOIN_REQUIRES_REVIEW");
    expect(await state(tenantId)).toEqual(before);

    await join(tenantId, holder.personId, sessionId); // the seat is taken: the waitlisted outcome
    const full = await state(tenantId);
    expect(await codeOf(join(tenantId, paid.personId, sessionId))).toBe("REJOIN_REQUIRES_REVIEW");
    expect(await state(tenantId)).toEqual(full);

    const other = await fx.seedSession(tenantId);
    const open = await seedMember(tenantId);
    const ro = await join(tenantId, open.personId, other);
    await ctx.owner.query(`UPDATE players SET status = 'left' WHERE id = $1`, [ro.playerId]);
    const forged = await state(tenantId);
    expect(await codeOf(join(tenantId, open.personId, other))).toBe("REJOIN_REQUIRES_REVIEW");
    expect(await state(tenantId)).toEqual(forged);
  });

  it("DT-12 (HARD RULE 4): a host-added person with the same display name is never reused; the join seats the account's own person only", async () => {
    const { tenantId, host, sessionId } = await world({ visibility: "public" });
    const hostAdded = await addMemberToSession(ctx.appDb.db, {
      tenantId,
      actorPersonId: host,
      commandId: nextCommandId(),
      sessionId,
      member: { displayName: "Alice" },
      source: "host_add",
    });
    const account = await fx.seedPerson("Alice");
    const before = await state(tenantId);
    expect(await codeOf(join(tenantId, account, sessionId))).toBe("FORBIDDEN");
    expect(await state(tenantId)).toEqual(before);

    const r = await join(tenantId, account, sessionId, { allowGuestMembership: true });
    expect(r.outcome).toBe("active");
    expect(r.playerId).not.toBe(hostAdded.playerId);
    expect(
      await appRow(
        tenantId,
        sql`SELECT m.person_id, m.status, m.id <> ${hostAdded.membershipId} AS fresh
              FROM players p JOIN memberships m ON m.id = p.membership_id WHERE p.id = ${r.playerId}`,
      ),
    ).toEqual({ person_id: account, status: "guest", fresh: true });
    expect(
      await appRow(
        tenantId,
        sql`SELECT membership_id, status FROM players WHERE id = ${hostAdded.playerId}`,
      ),
    ).toEqual({ membership_id: hostAdded.membershipId, status: "active" });
  });

  it("A-6: a member of A is FORBIDDEN under ?tenant=B and cannot reach B's session under A; A's GUC reads 0 rows of B's roster", async () => {
    const a = await world();
    const b = await world();
    const ma = await seedMember(a.tenantId);
    const mb = await seedMember(b.tenantId);
    await join(b.tenantId, mb.personId, b.sessionId);
    const beforeA = await state(a.tenantId);
    const beforeB = await state(b.tenantId);
    expect(await codeOf(join(b.tenantId, ma.personId, b.sessionId))).toBe("FORBIDDEN");
    expect(await codeOf(join(b.tenantId, ma.personId, a.sessionId))).toBe("FORBIDDEN");
    expect(await codeOf(join(a.tenantId, ma.personId, b.sessionId))).toBe("SESSION_NOT_FOUND");
    expect(await codeOf(leave(b.tenantId, ma.personId, b.sessionId))).toBe("PLAYER_NOT_FOUND");
    expect(await state(a.tenantId)).toEqual(beforeA);
    expect(await state(b.tenantId)).toEqual(beforeB);
    expect(
      await appRows(a.tenantId, sql`SELECT id FROM players WHERE session_id = ${b.sessionId}`),
    ).toEqual([]);
    expect(
      await appRows(a.tenantId, sql`SELECT id FROM sessions WHERE id = ${b.sessionId}`),
    ).toEqual([]);
  });

  it("A-7: parallel allowGuestMembership joins of one visitor into two public sessions -> ONE guest membership (UNIQUE live (tenant, person)) holding both seats; a private session mints none", async () => {
    const { tenantId, sessionId } = await world({ visibility: "public" });
    const second = await fx.seedSession(tenantId);
    await makePublic(second);
    const visitor = await fx.seedPerson();
    const results = await Promise.all(
      [sessionId, second].map((sid) =>
        join(tenantId, visitor, sid, { allowGuestMembership: true }),
      ),
    );
    expect(results.map((r) => r.outcome)).toEqual(["active", "active"]);
    const minted = await appRows(
      tenantId,
      sql`SELECT id, status FROM memberships WHERE person_id = ${visitor}`,
    );
    expect(minted).toEqual([{ id: expect.any(String), status: "guest" }]);
    expect(
      await appRows(
        tenantId,
        sql`SELECT DISTINCT p.membership_id FROM players p
              JOIN memberships m ON m.id = p.membership_id WHERE m.person_id = ${visitor}`,
      ),
    ).toEqual([{ membership_id: minted[0]!.id }]);

    const priv = await fx.seedSession(tenantId);
    const stranger = await fx.seedPerson();
    const before = await state(tenantId);
    expect(await codeOf(join(tenantId, stranger, priv, { allowGuestMembership: true }))).toBe(
      "SESSION_NOT_JOINABLE",
    );
    expect(await state(tenantId)).toEqual(before);
  });

  it("A-13 (L10b 4.6): the guest path on a private-again, closed, cancelled or started session -> SESSION_NOT_JOINABLE with zero writes; on a full open public session -> waitlisted", async () => {
    const { tenantId, sessionId } = await world({ slotsMax: 1, visibility: "public" });
    const refused = [
      await fx.seedSession(tenantId),
      await fx.seedSession(tenantId, { status: "closed" }),
      await fx.seedSession(tenantId, { status: "cancelled" }),
      await fx.seedSession(tenantId),
    ];
    for (const sid of refused) await makePublic(sid);
    // private-again: public once, then private (the public view row lags until the projector runs;
    // joinSession reads the canonical session).
    await ctx.owner.query(`UPDATE sessions SET visibility = 'private' WHERE id = $1`, [refused[0]]);
    await makeStarted(refused[3]!);
    const visitor = await fx.seedPerson();
    const before = await state(tenantId);
    for (const sid of refused) {
      expect(await codeOf(join(tenantId, visitor, sid, { allowGuestMembership: true }))).toBe(
        "SESSION_NOT_JOINABLE",
      );
    }
    expect(await state(tenantId)).toEqual(before);

    const seated = await seedMember(tenantId);
    expect((await join(tenantId, seated.personId, sessionId)).outcome).toBe("active");
    const guest = await join(tenantId, visitor, sessionId, { allowGuestMembership: true });
    expect(guest).toMatchObject({ outcome: "waitlisted", waitlistPosition: 1 });
  });

  it("A-14 (L10b RD-4): a person whose membership is left or merged while their players row in this session is still active or waitlisted -> ALREADY_JOINED on the guest path with zero writes (no second membership or seat)", async () => {
    const { tenantId, sessionId } = await world({ slotsMax: 1, visibility: "public" });
    const seated = await seedMember(tenantId);
    const queued = await seedMember(tenantId);
    const survivor = await seedMember(tenantId);
    expect((await join(tenantId, seated.personId, sessionId)).outcome).toBe("active");
    expect((await join(tenantId, queued.personId, sessionId)).outcome).toBe("waitlisted");
    // Owner-forged: each membership ends while its seat in this session stays live.
    await ctx.owner.query(`UPDATE memberships SET status = 'left' WHERE id = $1`, [
      seated.membershipId,
    ]);
    await ctx.owner.query(
      `UPDATE memberships SET status = 'merged', merged_into_membership_id = $2 WHERE id = $1`,
      [queued.membershipId, survivor.membershipId],
    );
    const before = await state(tenantId);
    for (const { personId } of [seated, queued]) {
      const run = join(tenantId, personId, sessionId, { allowGuestMembership: true });
      expect(await codeOf(run)).toBe("ALREADY_JOINED");
    }
    // players, charges, payment_allocations, outbox_events, processed_commands, memberships.
    expect(await state(tenantId)).toEqual(before);
  });

  /** RD-4 precondition (owner-forged): P's membership is left while its seat in S stays active. */
  const endedSeat = async () => {
    const { tenantId, sessionId } = await world({ visibility: "public" });
    const { personId, membershipId } = await seedMember(tenantId);
    expect((await join(tenantId, personId, sessionId)).outcome).toBe("active");
    await ctx.owner.query(`UPDATE memberships SET status = 'left' WHERE id = $1`, [membershipId]);
    return { tenantId, sessionId, personId };
  };

  it("A-14b (L10b R1-1, guest path): P first guest-joins ANOTHER public session of the club (minting a live guest membership), then guest-joins S where the left membership's seat is live -> ALREADY_JOINED with zero writes", async () => {
    const { tenantId, sessionId, personId } = await endedSeat();
    const elsewhere = await fx.seedSession(tenantId);
    await makePublic(elsewhere);
    const step1 = await join(tenantId, personId, elsewhere, { allowGuestMembership: true });
    expect(step1.outcome).toBe("active");
    const before = await state(tenantId);
    const run = join(tenantId, personId, sessionId, { allowGuestMembership: true });
    expect(await codeOf(run)).toBe("ALREADY_JOINED");
    expect(await state(tenantId)).toEqual(before);
  });

  it("A-14c (L10b R1-1, member path): P holding a live active membership again joins S without allowGuestMembership, where the left membership's seat is live -> ALREADY_JOINED with zero writes", async () => {
    const { tenantId, sessionId, personId } = await endedSeat();
    await ctx.owner.query(
      `INSERT INTO memberships (tenant_id, person_id, display_name, status)
       VALUES ($1, $2, 'Again', 'active')`,
      [tenantId, personId],
    );
    const before = await state(tenantId);
    expect(await codeOf(join(tenantId, personId, sessionId))).toBe("ALREADY_JOINED");
    expect(await state(tenantId)).toEqual(before);
  });

  it("A-14d (L10b R1-1): a live membership's own seat in S keeps L8's answer on both routes -> the current outcome (replayed false) with zero writes", async () => {
    const { tenantId, sessionId } = await endedSeat();
    const q = await seedMember(tenantId);
    const seated = await join(tenantId, q.personId, sessionId);
    const before = await state(tenantId);
    for (const allowGuestMembership of [false, true]) {
      expect(await join(tenantId, q.personId, sessionId, { allowGuestMembership })).toEqual(seated);
    }
    expect(await state(tenantId)).toEqual(before);
  });
});

describe("leaveSession and FIFO promotion", () => {
  it("DT-9/DT-10/DM-4: an active player's self-leave (net 0) -> left, charge void, and the lowest waitlist position promoted in the same tx with ONE charge; joined_at unchanged; payload amount_due = the charge's", async () => {
    const { tenantId, sessionId } = await world({ slotsMax: 1, priceAmount: 50000 });
    const [a, w1, w2] = [
      await seedMember(tenantId),
      await seedMember(tenantId),
      await seedMember(tenantId),
    ];
    const ra = await join(tenantId, a.personId, sessionId);
    const r1 = await join(tenantId, w1.personId, sessionId);
    const r2 = await join(tenantId, w2.personId, sessionId);
    const w1JoinedAt = (await playerRow(tenantId, r1.playerId)).joined_at;
    const seen = (await events(tenantId, sessionId)).length;

    expect(await leave(tenantId, a.personId, sessionId)).toEqual({
      playerId: ra.playerId,
      status: "left",
      replayed: false,
    });
    expect(await playerRow(tenantId, ra.playerId)).toMatchObject({
      status: "left",
      waitlist_position: null,
    });
    expect(await chargesOf(tenantId, ra.playerId)).toMatchObject([{ status: "void" }]);
    expect(await playerRow(tenantId, r1.playerId)).toEqual({
      status: "active",
      waitlist_position: null,
      joined_at: w1JoinedAt,
    });
    const promoted = await chargesOf(tenantId, r1.playerId);
    expect(promoted).toEqual([{ id: expect.any(String), amount_due: 50000, status: "open" }]);
    expect(await playerRow(tenantId, r2.playerId)).toMatchObject({
      status: "waitlisted",
      waitlist_position: 2,
    });
    expect(await chargesOf(tenantId, r2.playerId)).toEqual([]);
    expect((await events(tenantId, sessionId)).slice(seen)).toEqual([
      {
        type: "player.removed",
        payload: {
          session_id: sessionId,
          player_id: ra.playerId,
          previous_status: "active",
          source: "self_leave",
        },
      },
      {
        type: "player.promoted",
        payload: {
          session_id: sessionId,
          player_id: r1.playerId,
          membership_id: w1.membershipId,
          charge_id: promoted[0]!.id,
          amount_due: promoted[0]!.amount_due,
        },
      },
    ]);
    expect((await state(tenantId)).allocations).toBe(0);
  });

  it("P-5: a waitlisted player's self-leave -> left, position cleared, ONE player.removed, no promotion; the same commandId is replayed; a new one on a left row is the current outcome with zero writes", async () => {
    const { tenantId, sessionId } = await world({ slotsMax: 1 });
    const a = await seedMember(tenantId);
    const w = await seedMember(tenantId);
    await join(tenantId, a.personId, sessionId);
    const rw = await join(tenantId, w.personId, sessionId);
    const seen = (await events(tenantId, sessionId)).length;
    const commandId = nextCommandId();
    const left = { playerId: rw.playerId, status: "left" };
    expect(await leave(tenantId, w.personId, sessionId, commandId)).toEqual({
      ...left,
      replayed: false,
    });
    expect(await leave(tenantId, w.personId, sessionId, commandId)).toEqual({
      ...left,
      replayed: true,
    });
    expect((await events(tenantId, sessionId)).slice(seen)).toEqual([
      {
        type: "player.removed",
        payload: {
          session_id: sessionId,
          player_id: rw.playerId,
          previous_status: "waitlisted",
          source: "self_leave",
        },
      },
    ]);
    expect(await playerRow(tenantId, rw.playerId)).toMatchObject({
      status: "left",
      waitlist_position: null,
    });
    const before = await state(tenantId);
    expect(await leave(tenantId, w.personId, sessionId)).toEqual({ ...left, replayed: false });
    expect(await state(tenantId)).toEqual(before);
  });

  it("DT-9/P-4: net money != 0, after start, or a session not open -> LEAVE_REQUIRES_HOST with zero writes; no row or no membership -> PLAYER_NOT_FOUND", async () => {
    const { tenantId, host, sessionId } = await world();
    const paid = await seedMember(tenantId);
    const m = await seedMember(tenantId);
    const rp = await join(tenantId, paid.personId, sessionId);
    await pay(tenantId, host, sessionId, rp.playerId!, 1000);
    const started = await fx.seedSession(tenantId);
    const closed = await fx.seedSession(tenantId);
    await join(tenantId, m.personId, started);
    await join(tenantId, m.personId, closed);
    await makeStarted(started);
    await makeClosed(closed);
    const stranger = await fx.seedPerson();
    const before = await state(tenantId);
    expect(await codeOf(leave(tenantId, paid.personId, sessionId))).toBe("LEAVE_REQUIRES_HOST");
    expect(await codeOf(leave(tenantId, m.personId, started))).toBe("LEAVE_REQUIRES_HOST");
    expect(await codeOf(leave(tenantId, m.personId, closed))).toBe("LEAVE_REQUIRES_HOST");
    expect(await codeOf(leave(tenantId, m.personId, sessionId))).toBe("PLAYER_NOT_FOUND");
    expect(await codeOf(leave(tenantId, stranger, sessionId))).toBe("PLAYER_NOT_FOUND");
    expect(await state(tenantId)).toEqual(before);
  });

  it("A-5: leave and promotion are ONE transaction: a test trigger failing the player.promoted insert fails the whole leave (still active, charge open, no event)", async () => {
    const { tenantId, sessionId } = await world({ slotsMax: 1 });
    const a = await seedMember(tenantId);
    const w = await seedMember(tenantId);
    const ra = await join(tenantId, a.personId, sessionId);
    const rw = await join(tenantId, w.personId, sessionId);
    const before = await state(tenantId);
    await ctx.owner.query(
      `CREATE FUNCTION l8_fail_player_promoted() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN
         IF NEW.type = 'player.promoted' THEN
           RAISE EXCEPTION 'l8 test: player.promoted insert refused';
         END IF;
         RETURN NEW;
       END $$`,
    );
    await ctx.owner.query(
      `CREATE TRIGGER l8_fail_player_promoted BEFORE INSERT ON outbox_events
       FOR EACH ROW EXECUTE FUNCTION l8_fail_player_promoted()`,
    );
    const err = await leave(tenantId, a.personId, sessionId)
      .then(
        () => null,
        (e: unknown) => e as { message?: string; cause?: { message?: string } },
      )
      .finally(async () => {
        await ctx.owner.query(`DROP TRIGGER l8_fail_player_promoted ON outbox_events`);
        await ctx.owner.query(`DROP FUNCTION l8_fail_player_promoted()`);
      });
    expect(`${err?.message} ${err?.cause?.message}`).toMatch(/player\.promoted insert refused/);
    expect(await state(tenantId)).toEqual(before);
    expect(await playerRow(tenantId, ra.playerId)).toMatchObject({ status: "active" });
    expect(await chargesOf(tenantId, ra.playerId)).toMatchObject([{ status: "open" }]);
    expect(await playerRow(tenantId, rw.playerId)).toMatchObject({
      status: "waitlisted",
      waitlist_position: 1,
    });

    await leave(tenantId, a.personId, sessionId); // without the trigger the same leave promotes
    expect(await playerRow(tenantId, rw.playerId)).toMatchObject({
      status: "active",
      waitlist_position: null,
    });
  });

  it("P-6/P-8: promotion skips a waitlisted candidate whose old charge is unprovable (it stays waitlisted) and seats the next in FIFO order", async () => {
    const { tenantId, sessionId } = await world({ slotsMax: 2 });
    const [a, b, c, d] = [
      await seedMember(tenantId),
      await seedMember(tenantId),
      await seedMember(tenantId),
      await seedMember(tenantId),
    ];
    await join(tenantId, a.personId, sessionId);
    const rb = await join(tenantId, b.personId, sessionId);
    await leave(tenantId, b.personId, sessionId);
    await join(tenantId, c.personId, sessionId);
    expect(await join(tenantId, b.personId, sessionId)).toMatchObject({
      outcome: "waitlisted",
      playerId: rb.playerId,
      waitlistPosition: 1,
    });
    const rd = await join(tenantId, d.personId, sessionId);
    // b's old charge made unprovable (no L8 writer produces this): forged.
    await ctx.owner.query(`UPDATE charges SET status = 'open' WHERE player_id = $1`, [rb.playerId]);
    await leave(tenantId, a.personId, sessionId);
    expect(await playerRow(tenantId, rb.playerId)).toMatchObject({
      status: "waitlisted",
      waitlist_position: 1,
    });
    expect(await playerRow(tenantId, rd.playerId)).toMatchObject({
      status: "active",
      waitlist_position: null,
    });
    expect(await chargesOf(tenantId, rd.playerId)).toHaveLength(1);
  });

  it("DT-5/DT-10/DM-4: on a free session the active and the promoted player each get ONE 0 `paid` charge and the payload carries amount_due 0", async () => {
    const { tenantId, sessionId } = await world({ slotsMax: 1, priceAmount: 0 });
    const a = await seedMember(tenantId);
    const w = await seedMember(tenantId);
    const ra = await join(tenantId, a.personId, sessionId);
    const rw = await join(tenantId, w.personId, sessionId);
    expect(await chargesOf(tenantId, ra.playerId)).toMatchObject([
      { amount_due: 0, status: "paid" },
    ]);
    await leave(tenantId, a.personId, sessionId);
    const promoted = await chargesOf(tenantId, rw.playerId);
    expect(promoted).toMatchObject([{ amount_due: 0, status: "paid" }]);
    expect((await events(tenantId, sessionId)).slice(-1)).toEqual([
      {
        type: "player.promoted",
        payload: {
          session_id: sessionId,
          player_id: rw.playerId,
          membership_id: w.membershipId,
          charge_id: promoted[0]!.id,
          amount_due: 0,
        },
      },
    ]);
    expect((await state(tenantId)).allocations).toBe(0);
  });
});

describe("joinSession on a join_policy 'approval' session", () => {
  it("DT-7/P-1: the request opens only after every join check: a seated player gets the current outcome with zero writes; a visitor's request mints no membership; on a private session a guest member is SESSION_NOT_JOINABLE with no request and an active member gets `requested`", async () => {
    const { tenantId, sessionId } = await world({ slotsMax: 3, visibility: "public" });
    const a = await seedMember(tenantId);
    const seated = await join(tenantId, a.personId, sessionId);
    expect(seated).toMatchObject({ outcome: "active", requestId: null, replayed: false });
    await ctx.owner.query(`UPDATE sessions SET join_policy = 'approval' WHERE id = $1`, [
      sessionId,
    ]);
    const requests = async () =>
      Number((await appRow(tenantId, sql`SELECT count(*)::int AS n FROM join_requests`)).n);

    const s0 = await state(tenantId);
    expect(await join(tenantId, a.personId, sessionId)).toEqual(seated);
    expect(await state(tenantId)).toEqual(s0);
    expect(await requests()).toBe(0);

    const visitor = await fx.seedPerson("Visitor");
    const v = await join(tenantId, visitor, sessionId, { allowGuestMembership: true });
    expect(v).toEqual({
      outcome: "requested",
      playerId: null,
      waitlistPosition: null,
      requestId: expect.any(String),
      replayed: false,
    });
    const s1 = await state(tenantId);
    for (const k of ["memberships", "players", "charges", "allocations"] as const) {
      expect(Number(s1[k]), k).toBe(Number(s0[k]));
    }
    expect(Number(s1.events)).toBe(Number(s0.events) + 1);
    expect(Number(s1.commands)).toBe(Number(s0.commands) + 1);
    expect(await requests()).toBe(1);
    expect(
      await withTenant(ctx.appDb.db, tenantId, (tx) => getSessionOccupancy(tx, sessionId)),
    ).toBe(1);

    await ctx.owner.query(`UPDATE sessions SET visibility = 'private' WHERE id = $1`, [sessionId]);
    const g = await seedMember(tenantId, "guest");
    const s2 = await state(tenantId);
    expect(await codeOf(join(tenantId, g.personId, sessionId))).toBe("SESSION_NOT_JOINABLE");
    expect(await state(tenantId)).toEqual(s2);
    expect(await requests()).toBe(1);
    const b = await seedMember(tenantId);
    const rb = await join(tenantId, b.personId, sessionId);
    expect(rb).toMatchObject({ outcome: "requested", playerId: null, waitlistPosition: null });
    expect(rb.requestId).not.toBe(v.requestId);
    expect(await requests()).toBe(2);
  });
});

describe("hasLiveMembership (the route's P-3 audience gate, R1B-6)", () => {
  it("R1B-6: as the app role, an active and a guest member -> true; a left member, another club's member and an unknown person -> false", async () => {
    const { tenantId } = await world();
    const other = await world();
    const active = await seedMember(tenantId);
    const guest = await seedMember(tenantId, "guest");
    const left = await seedMember(tenantId, "left");
    const foreign = await seedMember(other.tenantId);
    const live = (bound: string, asked: string, personId: string) =>
      withTenant(ctx.appDb.db, bound, (tx) => hasLiveMembership(tx, asked, personId));
    expect(await live(tenantId, tenantId, active.personId)).toBe(true);
    expect(await live(tenantId, tenantId, guest.personId)).toBe(true);
    expect(await live(tenantId, tenantId, left.personId)).toBe(false);
    expect(await live(tenantId, tenantId, foreign.personId)).toBe(false);
    expect(await live(tenantId, tenantId, "00000000-0000-4000-8000-000000000000")).toBe(false);
    expect(await live(tenantId, tenantId, "not-a-uuid")).toBe(false);
    // The foreign member IS live in their own club (so the false above is the tenant scoping, not a
    // seed gap), and a transaction bound to this club cannot see it even when asked for that club.
    expect(await live(other.tenantId, other.tenantId, foreign.personId)).toBe(true);
    expect(await live(tenantId, other.tenantId, foreign.personId)).toBe(false);
  });
});

// L11 step 4 (readiness p3-m9-gender-pricing T-4, T-7 join, T-25): the self-join derives the charge
// from the joining person's stored gender; a stored gender that cannot be opened charges nobody.
const GENDER_ENV = ["ENCRYPTION_KEY", "KMS_PROVIDER", "KMS_KEY_ID"];
type GenderSeed = Gender | "corrupt" | "retired" | "foreign";

/** Owner seed of a consented gender on `personId`, or one of the three decrypt failures. */
async function storeGender(personId: string, how: GenderSeed) {
  const sealedFor = how === "foreign" ? await fx.seedPerson() : personId;
  const gender: Gender = how === "corrupt" || how === "retired" || how === "foreign" ? "male" : how;
  const { enc, keyVersion } = await encryptPersonGender(sealedFor, gender);
  if (how === "corrupt") enc.writeUInt8(enc.readUInt8(enc.length - 1) ^ 0xff, enc.length - 1);
  await ctx.owner.query(
    `UPDATE persons SET gender_enc = $2, gender_key_version = $3, gender_pricing_consent = true
      WHERE id = $1`,
    [personId, enc, how === "retired" ? "retired-key" : keyVersion],
  );
}
/** Prices a session by gender: male 120000, female 80000, base price_amount 100000. */
const priceByGender = (sessionId: string) =>
  ctx.owner.query(`UPDATE sessions SET price_male = 120000, price_female = 80000 WHERE id = $1`, [
    sessionId,
  ]);

describe("joinSession and promotion derive the charge (DD-39 self_join, promotion)", () => {
  const saved = new Map(GENDER_ENV.map((k) => [k, process.env[k]]));
  beforeAll(() => {
    process.env.ENCRYPTION_KEY = Buffer.from("c".repeat(32)).toString("base64");
    for (const k of GENDER_ENV.slice(1)) delete process.env[k];
    __resetAuthSecretCacheForTest();
  });
  afterAll(() => {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    __resetAuthSecretCacheForTest();
  });

  it("T-7 join: a female member is charged price_female", async () => {
    const { tenantId, sessionId } = await world();
    await priceByGender(sessionId);
    const m = await seedMember(tenantId);
    await storeGender(m.personId, "female");
    const r = await join(tenantId, m.personId, sessionId);
    expect(r.outcome).toBe("active");
    expect(await chargesOf(tenantId, r.playerId)).toEqual([
      expect.objectContaining({ amount_due: 80000 }),
    ]);
    // T-21: a gender was opened here, so a gender key or a per-gender price in the payload fails.
    expect((await events(tenantId, sessionId)).at(-1)).toEqual({
      type: "player.added",
      payload: {
        session_id: sessionId,
        player_id: r.playerId,
        membership_id: m.membershipId,
        status: "active",
        waitlist_position: null,
        source: "self_join",
      },
    });
  });

  it.each(["corrupt", "retired", "foreign"] as const)(
    "T-4 guest join, %s blob: CHARGE_DERIVATION_UNAVAILABLE, the guest membership rolled back",
    async (how) => {
      const { tenantId, sessionId } = await world({ visibility: "public" });
      await priceByGender(sessionId);
      const visitor = await fx.seedPerson();
      await storeGender(visitor, how);
      const before = await state(tenantId);
      const run = join(tenantId, visitor, sessionId, { allowGuestMembership: true });
      expect(await codeOf(run)).toBe("CHARGE_DERIVATION_UNAVAILABLE");
      expect(await state(tenantId)).toEqual(before);
    },
  );

  it("T-25: a gender change keeps the old amount_due; the next new charge uses the new gender", async () => {
    const { tenantId, sessionId } = await world();
    const second = await fx.seedSession(tenantId);
    await priceByGender(sessionId);
    await priceByGender(second);
    const m = await seedMember(tenantId);
    await storeGender(m.personId, "male");
    const first = await join(tenantId, m.personId, sessionId);
    await storeGender(m.personId, "female");
    const next = await join(tenantId, m.personId, second);
    expect((await chargesOf(tenantId, first.playerId))[0]).toMatchObject({ amount_due: 120000 });
    expect((await chargesOf(tenantId, next.playerId))[0]).toMatchObject({ amount_due: 80000 });
  });

  // L11 step 5 (T-6 leaveSession matrix, T-21 fee read-back): promotion derives too (RD-1, RD-15).
  it.each(["corrupt", "retired", "foreign"] as const)(
    "T-6/T-21 leave, %s head: the head stays waitlisted (no charge, no DM), ONE waitlist.charge_derivation_failed, the next is promoted at price_male with the fee read back",
    async (how) => {
      const { tenantId, sessionId } = await world({ slotsMax: 1 });
      await priceByGender(sessionId);
      const [a, head, male] = [
        await seedMember(tenantId),
        await seedMember(tenantId),
        await seedMember(tenantId),
      ];
      const ra = await join(tenantId, a.personId, sessionId);
      const rh = await join(tenantId, head.personId, sessionId);
      const rm = await join(tenantId, male.personId, sessionId);
      await storeGender(head.personId, how);
      await storeGender(male.personId, "male");
      const seen = (await events(tenantId, sessionId)).length;

      await leave(tenantId, a.personId, sessionId);

      expect(await playerRow(tenantId, ra.playerId)).toMatchObject({ status: "left" });
      expect(await playerRow(tenantId, rh.playerId)).toMatchObject({
        status: "waitlisted",
        waitlist_position: 1,
      });
      expect(await chargesOf(tenantId, rh.playerId)).toEqual([]);
      const promoted = await chargesOf(tenantId, rm.playerId);
      expect(promoted).toEqual([{ id: expect.any(String), amount_due: 120000, status: "open" }]);
      expect((await events(tenantId, sessionId)).slice(seen)).toEqual([
        expect.objectContaining({ type: "player.removed" }),
        {
          type: "waitlist.charge_derivation_failed",
          payload: {
            session_id: sessionId,
            player_id: rh.playerId,
            membership_id: head.membershipId,
            reason: "CHARGE_DERIVATION_UNAVAILABLE",
          },
        },
        {
          type: "player.promoted",
          payload: {
            session_id: sessionId,
            player_id: rm.playerId,
            membership_id: male.membershipId,
            charge_id: promoted[0]!.id,
            amount_due: 120000,
          },
        },
      ]);
    },
  );

  // R-R5-b SHOULD_FIX-1: the selector takes only a seat-holding (active|guest) membership, the set
  // the 0062 derivation definer accepts, so an ended one no longer rolls the opener back.
  it.each(["left", "merged"] as const)(
    "R-R5-b leave in gender mode, %s-membership head: the leave commits, that head stays waitlisted with no charge, the next is promoted at price_female",
    async (ended) => {
      const { tenantId, sessionId } = await world({ slotsMax: 1 });
      await priceByGender(sessionId);
      const [a, head, female] = [
        await seedMember(tenantId),
        await seedMember(tenantId),
        await seedMember(tenantId),
      ];
      const ra = await join(tenantId, a.personId, sessionId);
      const rh = await join(tenantId, head.personId, sessionId);
      const rf = await join(tenantId, female.personId, sessionId);
      await storeGender(head.personId, "male");
      await storeGender(female.personId, "female");
      // Owner-forged: latent today, no code writes 'left' or 'merged' on a waitlisted membership.
      const into = ended === "merged" ? (await seedMember(tenantId)).membershipId : null;
      await ctx.owner.query(
        `UPDATE memberships SET status = $2, merged_into_membership_id = $3 WHERE id = $1`,
        [head.membershipId, ended, into],
      );
      const seen = (await events(tenantId, sessionId)).length;

      await leave(tenantId, a.personId, sessionId);

      expect(await playerRow(tenantId, ra.playerId)).toMatchObject({ status: "left" });
      expect(await playerRow(tenantId, rh.playerId)).toMatchObject({
        status: "waitlisted",
        waitlist_position: 1,
      });
      expect(await chargesOf(tenantId, rh.playerId)).toEqual([]);
      const promoted = await chargesOf(tenantId, rf.playerId);
      expect(promoted).toEqual([{ id: expect.any(String), amount_due: 80000, status: "open" }]);
      expect((await events(tenantId, sessionId)).slice(seen).map((e) => e.type)).toEqual([
        "player.removed",
        "player.promoted",
      ]);
    },
  );
});

import { randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encryptPersonGender, type Gender } from "./gender-crypto.js";
import {
  approveJoinRequest,
  cancelJoinRequest,
  listPendingJoinRequests,
  rejectJoinRequest,
} from "./join-request-service.js";
import { fixtures, nextCommandId } from "./roster-money-fixtures.js";
import { RosterMoneyError } from "./roster-money-shared.js";
import { addMemberToSession, removePlayerFromSession } from "./roster-service.js";
import { __resetAuthSecretCacheForTest } from "./secret-key-root.js";
import { joinSession, leaveSession } from "./session-join-service.js";
import { getSessionOccupancy } from "./session-occupancy.js";
import { updateSession } from "./session-service.js";
import { withTenant } from "./tenant.js";
import { setupRlsTestContext, type RlsTestContext } from "./test-harness.js";

// Real-PG tests for join requests on approval sessions (L8 part B; readiness 4.3, 4.5, P-9..P-15,
// section 7 rows A-4, A-9, A-10, DT-7, DT-8). Every command AND every assertion read runs as the
// real `app` role through withTenant on ctx.appDb.db (RLS + FORCE RLS, no BYPASSRLS). The owner
// connection only seeds fixtures and forges what no command can produce: an elapsed 24 h window,
// a suspended tenant, a closed or re-scoped session.
let ctx: RlsTestContext;
const fx = fixtures(() => ctx);

beforeAll(async () => {
  ctx = await setupRlsTestContext("plexco_join_request_service");
}, 120_000);
afterAll(async () => {
  await ctx?.teardown();
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const appRows = (tenantId: string, query: SQL) =>
  withTenant(
    ctx.appDb.db,
    tenantId,
    async (tx) => (await tx.execute(query)).rows as Record<string, unknown>[],
  );
const appRow = async (tenantId: string, query: SQL) => (await appRows(tenantId, query))[0]!;

type Counters = Record<
  "players" | "charges" | "allocations" | "events" | "commands" | "memberships" | "requests",
  number
>;
/** Tenant-wide write counters (app role, RLS-scoped): a refusal must leave every one unchanged. */
const state = async (tenantId: string) =>
  (await appRow(
    tenantId,
    sql`SELECT (SELECT count(*)::int FROM players) players,
               (SELECT count(*)::int FROM charges) charges,
               (SELECT count(*)::int FROM payment_allocations) allocations,
               (SELECT count(*)::int FROM outbox_events) events,
               (SELECT count(*)::int FROM processed_commands) commands,
               (SELECT count(*)::int FROM memberships) memberships,
               (SELECT count(*)::int FROM join_requests) requests`,
  )) as Counters;
const events = (tenantId: string, sessionId: string) =>
  appRows(
    tenantId,
    sql`SELECT type, payload FROM outbox_events WHERE aggregate_id = ${sessionId} ORDER BY sequence`,
  );
const requestRow = (tenantId: string, requestId: string) =>
  appRow(
    tenantId,
    sql`SELECT status, person_id, decided_by, decided_at IS NOT NULL AS decided,
               command_id IS NOT NULL AS has_command, expires_at - created_at = interval '24 hours' AS ttl_24h
          FROM join_requests WHERE id = ${requestId}`,
  );
const playerOf = (tenantId: string, playerId: string) =>
  appRow(
    tenantId,
    sql`SELECT status, waitlist_position, membership_id FROM players WHERE id = ${playerId}`,
  );
const chargesOf = (tenantId: string, playerId: string) =>
  appRows(tenantId, sql`SELECT amount_due, status FROM charges WHERE player_id = ${playerId}`);
const occupancy = (tenantId: string, sessionId: string) =>
  withTenant(ctx.appDb.db, tenantId, (tx) => getSessionOccupancy(tx, sessionId));

/** A person with a membership of the given status in the tenant (owner seed). */
async function seedMember(tenantId: string, status: "active" | "guest" = "active") {
  const name = `Member ${nextCommandId()}`;
  const personId = await fx.seedPerson(name);
  const m = (await fx.row(
    `INSERT INTO memberships (tenant_id, person_id, display_name, status)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [tenantId, personId, name, status],
  )) as { id: string };
  return { personId, membershipId: m.id, name };
}

/** A tenant, its owner host and one OPEN future session with join_policy 'approval'. */
async function world(
  over: { slotsMax?: number | null; priceAmount?: number; visibility?: "public" } = {},
) {
  const tenantId = await fx.seedTenant();
  const host = await fx.seedAdmin(tenantId, "owner");
  const sessionId = await fx.seedSession(tenantId, over);
  await ctx.owner.query(`UPDATE sessions SET join_policy = 'approval' WHERE id = $1`, [sessionId]);
  if (over.visibility === "public") {
    await ctx.owner.query(`UPDATE sessions SET visibility = 'public' WHERE id = $1`, [sessionId]);
  }
  return { tenantId, host, sessionId };
}
/** Owner forge: the request's 24 h window has elapsed (no command can backdate it). */
const expire = (requestId: string) =>
  ctx.owner.query(
    `UPDATE join_requests SET created_at = now() - interval '25 hours',
            expires_at = now() - interval '1 hour' WHERE id = $1`,
    [requestId],
  );
const suspend = (tenantId: string) =>
  ctx.owner.query(`UPDATE tenants SET status = 'suspended' WHERE id = $1`, [tenantId]);

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
/** joinSession on an approval session: asserts the `requested` outcome, returns the request id. */
async function openRequest(
  tenantId: string,
  personId: string,
  sessionId: string,
  opts: { commandId?: string; allowGuestMembership?: boolean } = {},
): Promise<string> {
  const r = await join(tenantId, personId, sessionId, opts);
  expect(r).toMatchObject({ outcome: "requested", playerId: null, waitlistPosition: null });
  expect(r.requestId).toMatch(UUID);
  return r.requestId!;
}
const approve = (tenantId: string, actorPersonId: string, requestId: string, commandId?: string) =>
  approveJoinRequest(ctx.appDb.db, {
    tenantId,
    actorPersonId,
    requestId,
    commandId: commandId ?? nextCommandId(),
  });
const reject = (tenantId: string, actorPersonId: string, requestId: string, commandId?: string) =>
  rejectJoinRequest(ctx.appDb.db, {
    tenantId,
    actorPersonId,
    requestId,
    commandId: commandId ?? nextCommandId(),
  });
const cancel = (tenantId: string, personId: string, requestId: string, commandId?: string) =>
  cancelJoinRequest(ctx.appDb.db, {
    tenantId,
    personId,
    requestId,
    commandId: commandId ?? nextCommandId(),
  });
const pendingOf = (tenantId: string, actorPersonId: string, sessionId: string) =>
  listPendingJoinRequests(ctx.appDb.db, { tenantId, actorPersonId, sessionId });

async function codeOf(run: Promise<unknown>): Promise<string> {
  const err = await run.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err, "expected the command to reject").toBeInstanceOf(RosterMoneyError);
  return (err as RosterMoneyError).code;
}

describe("joinSession on an approval session (DT-7)", () => {
  it("DT-7: a join request only (no membership, player, charge or held seat), 24 h expiry, ONE join_request.created; a duplicate returns the same id with zero writes; the same commandId is replayed", async () => {
    const { tenantId, sessionId } = await world({ slotsMax: 2 });
    const m = await seedMember(tenantId);
    const before = await state(tenantId);
    const commandId = nextCommandId();
    const first = await join(tenantId, m.personId, sessionId, { commandId });
    expect(first).toEqual({
      outcome: "requested",
      playerId: null,
      waitlistPosition: null,
      requestId: expect.stringMatching(UUID),
      replayed: false,
    });
    const requestId = first.requestId!;
    const after = await state(tenantId);
    expect(after).toEqual({
      ...before,
      requests: before.requests + 1,
      events: before.events + 1,
      commands: before.commands + 1,
    });
    expect(await occupancy(tenantId, sessionId)).toBe(0);
    expect(await requestRow(tenantId, requestId)).toEqual({
      status: "pending",
      person_id: m.personId,
      decided_by: null,
      decided: false,
      has_command: true,
      ttl_24h: true,
    });
    expect((await events(tenantId, sessionId)).slice(-1)).toEqual([
      { type: "join_request.created", payload: { session_id: sessionId, request_id: requestId } },
    ]);
    expect(await join(tenantId, m.personId, sessionId)).toEqual(first);
    expect(await join(tenantId, m.personId, sessionId, { commandId })).toEqual({
      ...first,
      replayed: true,
    });
    expect(await state(tenantId)).toEqual(after);
  });

  it("DT-7/P-9: a visitor's allowGuestMembership request mints no membership; an expired pending row is marked expired and ONE new pending row opened with ONE join_request.created", async () => {
    const { tenantId, sessionId } = await world({ visibility: "public" });
    const visitor = await fx.seedPerson("Visitor");
    const before = await state(tenantId);
    const oldId = await openRequest(tenantId, visitor, sessionId, { allowGuestMembership: true });
    const mid = await state(tenantId);
    expect(mid).toEqual({
      ...before,
      requests: before.requests + 1,
      events: before.events + 1,
      commands: before.commands + 1,
    });
    await expire(oldId);
    const newId = await openRequest(tenantId, visitor, sessionId, { allowGuestMembership: true });
    expect(newId).not.toBe(oldId);
    expect((await requestRow(tenantId, oldId)).status).toBe("expired");
    expect(await requestRow(tenantId, newId)).toMatchObject({ status: "pending", ttl_24h: true });
    expect(await state(tenantId)).toEqual({
      ...mid,
      requests: mid.requests + 1,
      events: mid.events + 1,
      commands: mid.commands + 1,
    });
    expect((await events(tenantId, sessionId)).slice(-1)).toEqual([
      { type: "join_request.created", payload: { session_id: sessionId, request_id: newId } },
    ]);
  });
});

describe("approve and reject (DT-8)", () => {
  it("DT-8: approve into a free seat -> approved + active + exactly ONE charge at price_amount + ONE join_request.approved; the same commandId is replayed; a second approve or a reject is REQUEST_DECIDED with zero writes", async () => {
    const { tenantId, host, sessionId } = await world({ slotsMax: 2, priceAmount: 70_000 });
    const m = await seedMember(tenantId);
    const requestId = await openRequest(tenantId, m.personId, sessionId);
    const before = await state(tenantId);
    const commandId = nextCommandId();
    const r = await approve(tenantId, host, requestId, commandId);
    expect(r).toEqual({
      requestId,
      status: "approved",
      outcome: "active",
      playerId: expect.stringMatching(UUID),
      waitlistPosition: null,
      replayed: false,
    });
    expect(await playerOf(tenantId, r.playerId)).toEqual({
      status: "active",
      waitlist_position: null,
      membership_id: m.membershipId,
    });
    expect(await chargesOf(tenantId, r.playerId)).toEqual([{ amount_due: 70_000, status: "open" }]);
    expect(await requestRow(tenantId, requestId)).toMatchObject({
      status: "approved",
      decided_by: host,
      decided: true,
    });
    const after = await state(tenantId);
    expect(after).toEqual({
      ...before,
      players: before.players + 1,
      charges: before.charges + 1,
      events: before.events + 1,
      commands: before.commands + 1,
    });
    expect((await events(tenantId, sessionId)).slice(-1)).toEqual([
      {
        type: "join_request.approved",
        payload: {
          session_id: sessionId,
          request_id: requestId,
          player_id: r.playerId,
          membership_id: m.membershipId,
          status: "active",
          waitlist_position: null,
        },
      },
    ]);
    expect(await approve(tenantId, host, requestId, commandId)).toEqual({ ...r, replayed: true });
    expect(await codeOf(approve(tenantId, host, requestId))).toBe("REQUEST_DECIDED");
    expect(await codeOf(reject(tenantId, host, requestId))).toBe("REQUEST_DECIDED");
    expect(await state(tenantId)).toEqual(after);
  });

  it("DT-8: full -> approved + waitlisted at the tail with no charge; a visitor's request seats a guest membership minted at approve; an expired request is REQUEST_EXPIRED for approve, reject and cancel with zero writes", async () => {
    const { tenantId, host, sessionId } = await world({ slotsMax: 1, visibility: "public" });
    const visitor = await fx.seedPerson("Visitor");
    const m = await seedMember(tenantId);
    const visitorReq = await openRequest(tenantId, visitor, sessionId, {
      allowGuestMembership: true,
    });
    const memberReq = await openRequest(tenantId, m.personId, sessionId);
    const before = await state(tenantId);
    const seated = await approve(tenantId, host, visitorReq);
    expect(seated).toMatchObject({ status: "approved", outcome: "active", waitlistPosition: null });
    expect(
      await appRow(
        tenantId,
        sql`SELECT m.status, m.person_id FROM players p JOIN memberships m ON m.id = p.membership_id
             WHERE p.id = ${seated.playerId}`,
      ),
    ).toEqual({ status: "guest", person_id: visitor });
    const waitlisted = await approve(tenantId, host, memberReq);
    expect(waitlisted).toMatchObject({
      requestId: memberReq,
      status: "approved",
      outcome: "waitlisted",
      waitlistPosition: 1,
    });
    expect(await chargesOf(tenantId, waitlisted.playerId)).toEqual([]);
    expect(await occupancy(tenantId, sessionId)).toBe(1);
    expect(await state(tenantId)).toEqual({
      ...before,
      players: before.players + 2,
      charges: before.charges + 1,
      memberships: before.memberships + 1,
      events: before.events + 2,
      commands: before.commands + 2,
    });

    const late = await seedMember(tenantId);
    const lateReq = await openRequest(tenantId, late.personId, sessionId);
    await expire(lateReq);
    const frozen = await state(tenantId);
    expect(await codeOf(approve(tenantId, host, lateReq))).toBe("REQUEST_EXPIRED");
    expect(await codeOf(reject(tenantId, host, lateReq))).toBe("REQUEST_EXPIRED");
    expect(await codeOf(cancel(tenantId, late.personId, lateReq))).toBe("REQUEST_EXPIRED");
    expect((await requestRow(tenantId, lateReq)).status).toBe("pending");
    expect(await state(tenantId)).toEqual(frozen);
  });

  it("DT-8: a non-host is FORBIDDEN; P-20: a session made private refuses a guest member's or a visitor's request (SESSION_NOT_JOINABLE, no guest minted, still pending, still rejectable) and a closed one any request; reject -> rejected with ONE join_request.rejected; a suspended tenant is TENANT_SUSPENDED; every refusal writes nothing", async () => {
    const { tenantId, host, sessionId } = await world({ visibility: "public" });
    const m = await seedMember(tenantId);
    const g = await seedMember(tenantId, "guest");
    const visitor = await fx.seedPerson("Visitor");
    const mReq = await openRequest(tenantId, m.personId, sessionId);
    const gReq = await openRequest(tenantId, g.personId, sessionId);
    const vReq = await openRequest(tenantId, visitor, sessionId, { allowGuestMembership: true });
    const before = await state(tenantId);
    expect(await codeOf(approve(tenantId, m.personId, mReq))).toBe("FORBIDDEN");
    expect(await codeOf(reject(tenantId, g.personId, mReq))).toBe("FORBIDDEN");
    await ctx.owner.query(`UPDATE sessions SET visibility = 'private' WHERE id = $1`, [sessionId]);
    // P-20 (orchestrator ruling D2): approve re-applies P-1 at confirm time, before any mint.
    expect(await codeOf(approve(tenantId, host, gReq))).toBe("SESSION_NOT_JOINABLE");
    expect(await codeOf(approve(tenantId, host, vReq))).toBe("SESSION_NOT_JOINABLE");
    await ctx.owner.query(`UPDATE sessions SET status = 'closed' WHERE id = $1`, [sessionId]);
    expect(await codeOf(approve(tenantId, host, mReq))).toBe("SESSION_NOT_JOINABLE");
    expect(await state(tenantId)).toEqual(before);
    for (const id of [gReq, vReq, mReq]) {
      expect((await requestRow(tenantId, id)).status).toBe("pending");
    }

    expect(await reject(tenantId, host, mReq)).toEqual({
      requestId: mReq,
      status: "rejected",
      replayed: false,
    });
    expect(await requestRow(tenantId, mReq)).toMatchObject({
      status: "rejected",
      decided_by: host,
      decided: true,
    });
    expect(await state(tenantId)).toEqual({
      ...before,
      events: before.events + 1,
      commands: before.commands + 1,
    });
    expect((await events(tenantId, sessionId)).slice(-1)).toEqual([
      { type: "join_request.rejected", payload: { session_id: sessionId, request_id: mReq } },
    ]);
    // P-20: a request refused at approve stays pending, so the host can still reject it.
    expect((await reject(tenantId, host, vReq)).status).toBe("rejected");
    expect((await requestRow(tenantId, vReq)).status).toBe("rejected");

    await suspend(tenantId);
    const suspended = await state(tenantId);
    expect(await codeOf(approve(tenantId, host, gReq))).toBe("TENANT_SUSPENDED");
    expect(await codeOf(reject(tenantId, host, gReq))).toBe("TENANT_SUSPENDED");
    expect(await codeOf(cancel(tenantId, g.personId, gReq))).toBe("TENANT_SUSPENDED");
    expect(await state(tenantId)).toEqual(suspended);
  });
});

describe("cancel and the one not-found answer (P-10, P-11)", () => {
  it("P-10: the requester cancels (ONE join_request.cancelled; the same commandId replayed; then REQUEST_DECIDED); approving a requester already on the roster -> approved with zero roster writes", async () => {
    const { tenantId, host, sessionId } = await world({ slotsMax: 3 });
    const m = await seedMember(tenantId);
    const requestId = await openRequest(tenantId, m.personId, sessionId);
    const before = await state(tenantId);
    const commandId = nextCommandId();
    const cancelled = await cancel(tenantId, m.personId, requestId, commandId);
    expect(cancelled).toEqual({ requestId, status: "cancelled", replayed: false });
    expect(await requestRow(tenantId, requestId)).toMatchObject({
      status: "cancelled",
      decided: true,
    });
    expect((await events(tenantId, sessionId)).slice(-1)).toEqual([
      { type: "join_request.cancelled", payload: { session_id: sessionId, request_id: requestId } },
    ]);
    const after = await state(tenantId);
    expect(after).toEqual({ ...before, events: before.events + 1, commands: before.commands + 1 });
    expect(await cancel(tenantId, m.personId, requestId, commandId)).toEqual({
      ...cancelled,
      replayed: true,
    });
    expect(await codeOf(cancel(tenantId, m.personId, requestId))).toBe("REQUEST_DECIDED");
    expect(await codeOf(approve(tenantId, host, requestId))).toBe("REQUEST_DECIDED");
    expect(await state(tenantId)).toEqual(after);

    const other = await seedMember(tenantId);
    const otherReq = await openRequest(tenantId, other.personId, sessionId);
    const hostAdded = await addMemberToSession(ctx.appDb.db, {
      tenantId,
      actorPersonId: host,
      commandId: nextCommandId(),
      sessionId,
      member: { membershipId: other.membershipId },
      source: "host_add",
    });
    const seated = await state(tenantId);
    expect(await approve(tenantId, host, otherReq)).toEqual({
      requestId: otherReq,
      status: "approved",
      outcome: "active",
      playerId: hostAdded.playerId,
      waitlistPosition: null,
      replayed: false,
    });
    expect(await state(tenantId)).toEqual({
      ...seated,
      events: seated.events + 1,
      commands: seated.commands + 1,
    });
    expect(await chargesOf(tenantId, hostAdded.playerId)).toHaveLength(1);
  });

  it("P-11: an unknown, malformed, other-club or another person's request id -> JOIN_REQUEST_NOT_FOUND (one answer) with zero writes; another club's host is FORBIDDEN", async () => {
    const a = await world();
    const b = await world();
    const ma = await seedMember(a.tenantId);
    const mb = await seedMember(b.tenantId);
    const stranger = await seedMember(a.tenantId);
    const aReq = await openRequest(a.tenantId, ma.personId, a.sessionId);
    const bReq = await openRequest(b.tenantId, mb.personId, b.sessionId);
    const beforeA = await state(a.tenantId);
    const beforeB = await state(b.tenantId);
    for (const id of [randomUUID(), "not-a-uuid", bReq]) {
      expect(await codeOf(approve(a.tenantId, a.host, id))).toBe("JOIN_REQUEST_NOT_FOUND");
      expect(await codeOf(reject(a.tenantId, a.host, id))).toBe("JOIN_REQUEST_NOT_FOUND");
      expect(await codeOf(cancel(a.tenantId, ma.personId, id))).toBe("JOIN_REQUEST_NOT_FOUND");
    }
    expect(await codeOf(cancel(a.tenantId, stranger.personId, aReq))).toBe(
      "JOIN_REQUEST_NOT_FOUND",
    );
    expect(await codeOf(cancel(b.tenantId, ma.personId, aReq))).toBe("JOIN_REQUEST_NOT_FOUND");
    expect(await codeOf(approve(b.tenantId, a.host, bReq))).toBe("FORBIDDEN");
    expect(await state(a.tenantId)).toEqual(beforeA);
    expect(await state(b.tenantId)).toEqual(beforeB);
  });
});

describe("a roster exit closes the person's pending request (R1A-1)", () => {
  /** The member requested, then the host seated them directly (host-add leaves the request pending). */
  async function requestedThenHostAdded() {
    const w = await world({ slotsMax: 3 });
    const m = await seedMember(w.tenantId);
    const requestId = await openRequest(w.tenantId, m.personId, w.sessionId);
    const added = await addMemberToSession(ctx.appDb.db, {
      tenantId: w.tenantId,
      actorPersonId: w.host,
      commandId: nextCommandId(),
      sessionId: w.sessionId,
      member: { membershipId: m.membershipId },
      source: "host_add",
    });
    expect(await requestRow(w.tenantId, requestId)).toMatchObject({ status: "pending" });
    return { ...w, m, requestId, playerId: added.playerId };
  }
  /** Approving the stale request is REQUEST_DECIDED and changes no row: counters, player, charge. */
  async function staleApproveRefused(
    tenantId: string,
    host: string,
    requestId: string,
    playerId: string,
  ) {
    const before = await state(tenantId);
    expect(await codeOf(approve(tenantId, host, requestId))).toBe("REQUEST_DECIDED");
    expect(await state(tenantId)).toEqual(before);
    expect(await playerOf(tenantId, playerId)).toMatchObject({ status: "left" });
    expect((await chargesOf(tenantId, playerId)).map((c) => c.status)).toEqual(["void"]);
    expect(await requestRow(tenantId, requestId)).toMatchObject({ status: "cancelled" });
  }

  it("R1A-1: pending request -> host-add -> self-leave closes it as cancelled in the same tx with NO extra event; the host's approve of the stale request -> REQUEST_DECIDED with zero writes", async () => {
    const { tenantId, host, sessionId, m, requestId, playerId } = await requestedThenHostAdded();
    const before = await state(tenantId);
    const seen = (await events(tenantId, sessionId)).length;
    const left = await leaveSession(ctx.appDb.db, {
      tenantId,
      personId: m.personId,
      sessionId,
      commandId: nextCommandId(),
    });
    expect(left).toEqual({ playerId, status: "left", replayed: false });
    expect(await requestRow(tenantId, requestId)).toMatchObject({
      status: "cancelled",
      decided_by: m.personId,
      decided: true,
    });
    const added = (await events(tenantId, sessionId)).slice(seen).map((e) => e.type);
    expect(added).toEqual(["player.removed"]);
    expect(await state(tenantId)).toEqual({
      ...before,
      events: before.events + 1,
      commands: before.commands + 1,
    });
    await staleApproveRefused(tenantId, host, requestId, playerId);
  });

  it("R1A-1: the host-remove variant closes the removed person's pending request (decided_by the host, NO extra event) and leaves another person's pending request alone; approving the stale one -> REQUEST_DECIDED with zero writes", async () => {
    const { tenantId, host, sessionId, requestId, playerId } = await requestedThenHostAdded();
    const bystander = await seedMember(tenantId);
    const otherRequest = await openRequest(tenantId, bystander.personId, sessionId);
    const before = await state(tenantId);
    const seen = (await events(tenantId, sessionId)).length;
    await removePlayerFromSession(ctx.appDb.db, {
      tenantId,
      actorPersonId: host,
      commandId: nextCommandId(),
      sessionId,
      playerId,
    });
    expect(await requestRow(tenantId, requestId)).toMatchObject({
      status: "cancelled",
      decided_by: host,
      decided: true,
    });
    expect(await requestRow(tenantId, otherRequest)).toMatchObject({ status: "pending" });
    const added = (await events(tenantId, sessionId)).slice(seen).map((e) => e.type);
    expect(added).toEqual(["player.removed"]);
    expect(await state(tenantId)).toEqual({
      ...before,
      events: before.events + 1,
      commands: before.commands + 1,
    });
    await staleApproveRefused(tenantId, host, requestId, playerId);
    expect(await pendingOf(tenantId, host, sessionId)).toEqual([
      expect.objectContaining({ requestId: otherRequest }),
    ]);
  });
});

describe("host read of pending requests (A-10, service half)", () => {
  it("A-10: unexpired pending rows oldest first with exactly requestId, displayName, createdAt (the live membership's name, null for a visitor); a plain member and another club's host are FORBIDDEN; another club's session is SESSION_NOT_FOUND; no suspension gate (P-12)", async () => {
    const { tenantId, host, sessionId } = await world({ visibility: "public" });
    const m1 = await seedMember(tenantId);
    const m2 = await seedMember(tenantId);
    const m3 = await seedMember(tenantId);
    const visitor = await fx.seedPerson("Visitor");
    const r1 = await openRequest(tenantId, m1.personId, sessionId);
    const rv = await openRequest(tenantId, visitor, sessionId, { allowGuestMembership: true });
    const r2 = await openRequest(tenantId, m2.personId, sessionId);
    const r3 = await openRequest(tenantId, m3.personId, sessionId);
    await expire(r2);
    await cancel(tenantId, m3.personId, r3);
    const rows = await pendingOf(tenantId, host, sessionId);
    expect(rows.map((r) => r.requestId)).toEqual([r1, rv]);
    expect(rows.map((r) => r.displayName)).toEqual([m1.name, null]);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(["createdAt", "displayName", "requestId"]);
      expect(Number.isNaN(Date.parse(row.createdAt))).toBe(false);
    }
    expect(await codeOf(pendingOf(tenantId, m1.personId, sessionId))).toBe("FORBIDDEN");
    const other = await world();
    expect(await codeOf(pendingOf(tenantId, other.host, sessionId))).toBe("FORBIDDEN");
    expect(await codeOf(pendingOf(other.tenantId, other.host, sessionId))).toBe(
      "SESSION_NOT_FOUND",
    );
    await suspend(tenantId);
    expect((await pendingOf(tenantId, host, sessionId)).map((r) => r.requestId)).toEqual([r1, rv]);
  });
});

describe("join-request events and races (A-9, A-4)", () => {
  it("A-9: over a request lifecycle the session's outbox gains exactly one event per change, typed per P-15, and a duplicate or a refusal adds none", async () => {
    const { tenantId, host, sessionId } = await world({ slotsMax: 1 });
    const a = await seedMember(tenantId);
    const b = await seedMember(tenantId);
    const c = await seedMember(tenantId);
    const d = await seedMember(tenantId);
    const base = (await events(tenantId, sessionId)).length;
    const ra = await openRequest(tenantId, a.personId, sessionId);
    const rb = await openRequest(tenantId, b.personId, sessionId);
    const rc = await openRequest(tenantId, c.personId, sessionId);
    expect(await openRequest(tenantId, a.personId, sessionId)).toBe(ra);
    expect((await approve(tenantId, host, ra)).outcome).toBe("active");
    expect(await codeOf(approve(tenantId, host, ra))).toBe("REQUEST_DECIDED");
    expect((await approve(tenantId, host, rb)).outcome).toBe("waitlisted");
    expect(await codeOf(approve(tenantId, d.personId, rc))).toBe("FORBIDDEN");
    await reject(tenantId, host, rc);
    const rd = await openRequest(tenantId, d.personId, sessionId);
    expect(await codeOf(cancel(tenantId, a.personId, rd))).toBe("JOIN_REQUEST_NOT_FOUND");
    await cancel(tenantId, d.personId, rd);
    expect((await events(tenantId, sessionId)).slice(base).map((e) => e.type)).toEqual([
      "join_request.created",
      "join_request.created",
      "join_request.created",
      "join_request.approved",
      "join_request.approved",
      "join_request.rejected",
      "join_request.created",
      "join_request.cancelled",
    ]);
  });

  it("A-4: approve vs a parallel slots_max cut or raise (app role, both under the session row lock) ends in one serial order and occupancy never exceeds slots_max", async () => {
    const orders: string[] = [];
    for (const [from, to] of [
      [2, 1],
      [1, 2],
      [2, 1],
      [1, 2],
      [2, 1],
      [1, 2],
    ] as const) {
      const { tenantId, host, sessionId } = await world({ slotsMax: from });
      const first = await seedMember(tenantId);
      await approve(tenantId, host, await openRequest(tenantId, first.personId, sessionId));
      const m = await seedMember(tenantId);
      const requestId = await openRequest(tenantId, m.personId, sessionId);
      const base = (await events(tenantId, sessionId)).length;
      // updateSession's mutate branch requires the live version (optimistic lock, STALE_VERSION
      // otherwise); approve never bumps it, so a version read before the race holds in both orders.
      const v = await appRow(tenantId, sql`SELECT version FROM sessions WHERE id = ${sessionId}`);
      const [approved, updated] = await Promise.allSettled([
        approve(tenantId, host, requestId),
        updateSession(ctx.appDb.db, {
          tenantId,
          commandId: nextCommandId(),
          input: { sessionId, slotsMax: to, expectedVersion: Number(v.version) },
        }),
      ]);
      if (approved.status === "rejected") throw approved.reason;
      const r = approved.value;
      let approveFirst: boolean;
      if (updated.status === "rejected") {
        // Only a cut is ever refused, and only after the approve took the second (active) seat
        // first; updateSession checks the active roster (CAPACITY_BELOW_ROSTER) before occupancy.
        expect(["CAPACITY_BELOW_ROSTER", "CAPACITY_BELOW_OCCUPANCY"]).toContain(
          (updated.reason as { code?: unknown }).code,
        );
        approveFirst = true;
      } else {
        const types = (await events(tenantId, sessionId)).slice(base).map((e) => e.type);
        approveFirst = types.indexOf("join_request.approved") < types.indexOf("session.updated");
      }
      // One seat is taken before the race: the second is free iff the capacity in force at the
      // approve's serialization point is above 1.
      const capacityAtApprove = approveFirst ? from : to;
      expect(r.outcome).toBe(capacityAtApprove > 1 ? "active" : "waitlisted");
      const s = await appRow(tenantId, sql`SELECT slots_max FROM sessions WHERE id = ${sessionId}`);
      expect(s.slots_max).toBe(updated.status === "fulfilled" ? to : from);
      expect(await occupancy(tenantId, sessionId)).toBeLessThanOrEqual(s.slots_max as number);
      const final = await playerOf(tenantId, r.playerId);
      expect(await chargesOf(tenantId, r.playerId)).toHaveLength(final.status === "active" ? 1 : 0);
      orders.push(`${from}->${to}:${approveFirst ? "approve-first" : "update-first"}:${r.outcome}`);
    }
    console.info(`A-4 orders ${orders.join(" ")}`);
  });

  it("A-4: four parallel approves on the last seat (slots_max = 1, app role) -> exactly one active with ONE charge, three waitlisted at distinct positions; no oversell", async () => {
    const { tenantId, host, sessionId } = await world({ slotsMax: 1 });
    const ids: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const m = await seedMember(tenantId);
      ids.push(await openRequest(tenantId, m.personId, sessionId));
    }
    const results = await Promise.all(ids.map((id) => approve(tenantId, host, id)));
    expect(results.filter((r) => r.outcome === "active")).toHaveLength(1);
    const positions = results
      .filter((r) => r.outcome === "waitlisted")
      .map((r) => r.waitlistPosition ?? 0)
      .sort((x, y) => x - y);
    expect(positions).toEqual([1, 2, 3]);
    expect(await occupancy(tenantId, sessionId)).toBe(1);
    const n = await appRow(
      tenantId,
      sql`SELECT count(*)::int AS n FROM charges WHERE session_id = ${sessionId}`,
    );
    expect(n.n).toBe(1);
  });
});

// L11 step 4 (readiness p3-m9-gender-pricing T-5, T-7 approve): approve seats through seatPlayer as
// host_add with the approver as the actor; a stored gender that cannot be opened charges nobody.
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

describe("approveJoinRequest derives the charge (DD-39 host_add)", () => {
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

  /** A gendered approval session: male 120000, female 80000, base price_amount 100000. */
  async function gendered(over: { visibility?: "public" } = {}) {
    const w = await world({ slotsMax: 2, priceAmount: 100_000, ...over });
    await ctx.owner.query(
      `UPDATE sessions SET price_male = 120000, price_female = 80000 WHERE id = $1`,
      [w.sessionId],
    );
    return w;
  }

  it("T-7 approve: a male member's approved request is charged price_male", async () => {
    const { tenantId, host, sessionId } = await gendered();
    const m = await seedMember(tenantId);
    await storeGender(m.personId, "male");
    const requestId = await openRequest(tenantId, m.personId, sessionId);
    const r = await approve(tenantId, host, requestId);
    expect(r).toMatchObject({ status: "approved", outcome: "active" });
    expect(await chargesOf(tenantId, r.playerId)).toEqual([
      { amount_due: 120_000, status: "open" },
    ]);
    // T-21: approve emits join_request.approved (no player.added); a gender key or a per-gender
    // price in its payload fails.
    expect((await events(tenantId, sessionId)).at(-1)).toEqual({
      type: "join_request.approved",
      payload: {
        session_id: sessionId,
        request_id: requestId,
        player_id: r.playerId,
        membership_id: m.membershipId,
        status: "active",
        waitlist_position: null,
      },
    });
  });

  it.each(["corrupt", "retired", "foreign"] as const)(
    "T-5 approve, %s blob: CHARGE_DERIVATION_UNAVAILABLE, no player, charge, guest membership, event or command; the request stays pending",
    async (how) => {
      const { tenantId, host, sessionId } = await gendered({ visibility: "public" });
      const visitor = await fx.seedPerson("Visitor");
      await storeGender(visitor, how);
      const requestId = await openRequest(tenantId, visitor, sessionId, {
        allowGuestMembership: true,
      });
      const before = await state(tenantId);
      const code = await codeOf(approve(tenantId, host, requestId));
      expect(code).toBe("CHARGE_DERIVATION_UNAVAILABLE");
      expect(await state(tenantId)).toEqual(before);
      expect(await requestRow(tenantId, requestId)).toMatchObject({
        status: "pending",
        decided_by: null,
        decided: false,
      });
    },
  );
});

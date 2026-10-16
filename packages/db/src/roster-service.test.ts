import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { markPaid } from "./payment-manual.js";
import { fixtures, nextCommandId } from "./roster-money-fixtures.js";
import { RosterMoneyError } from "./roster-money-shared.js";
import { addMemberToSession, removePlayerFromSession } from "./roster-service.js";
import { setupRlsTestContext, type RlsTestContext } from "./test-harness.js";

// Real-PG tests for the host roster commands, run as the `app` role through the RLS harness
// (DATABASE_URL_TEST required; CI provides it).
let ctx: RlsTestContext;
const fx = fixtures(() => ctx);

beforeAll(async () => {
  ctx = await setupRlsTestContext("plexco_roster_service");
}, 120_000);
afterAll(async () => {
  await ctx?.teardown();
});

const add = (
  tenantId: string,
  actorPersonId: string,
  sessionId: string,
  member: { membershipId: string } | { displayName: string },
  commandId = nextCommandId(),
) =>
  addMemberToSession(ctx.appDb.db, {
    tenantId,
    actorPersonId,
    commandId,
    sessionId,
    member,
    source: "host_add",
  });
const remove = (
  tenantId: string,
  actorPersonId: string,
  sessionId: string,
  playerId: string,
  commandId = nextCommandId(),
) =>
  removePlayerFromSession(ctx.appDb.db, {
    tenantId,
    actorPersonId,
    commandId,
    sessionId,
    playerId,
  });

async function codeOf(run: Promise<unknown>): Promise<string> {
  const err = await run.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err, "expected the command to reject").toBeInstanceOf(RosterMoneyError);
  return (err as RosterMoneyError).code;
}

async function world(
  over: { slotsMax?: number | null; priceAmount?: number; status?: string } = {},
) {
  const tenantId = await fx.seedTenant();
  const actor = await fx.seedAdmin(tenantId, "owner");
  const sessionId = await fx.seedSession(tenantId, over);
  return { tenantId, actor, sessionId };
}

describe("addMemberToSession", () => {
  it("existing member: ACTIVE player + exactly ONE charge = price, one player.added event, one ledger row", async () => {
    const { tenantId, actor, sessionId } = await world({ priceAmount: 90000 });
    const membershipId = await fx.seedMembership(tenantId, "Lan");
    const r = await add(tenantId, actor, sessionId, { membershipId });
    expect(r).toMatchObject({
      status: "active",
      waitlistPosition: null,
      replayed: false,
      membershipId,
    });
    const charges = await fx.rows(`SELECT * FROM charges WHERE player_id = $1`, [r.playerId]);
    expect(charges).toHaveLength(1);
    expect(charges[0]).toMatchObject({
      amount_due: 90000,
      amount_allocated: 0,
      status: "open",
      membership_id: membershipId,
      tenant_id: tenantId,
    });
    expect(r.chargeId).toBe(charges[0].id);
    const ev = await fx.events(sessionId);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ type: "player.added", sequence: 1 });
    expect(ev[0].payload).toMatchObject({
      player_id: r.playerId,
      source: "host_add",
      status: "active",
    });
    expect(JSON.stringify(ev[0].payload)).not.toMatch(/Lan/); // no PII in the event
    expect((await fx.counts(tenantId)).commands).toBe(1);
  });

  it("new member by display name: Person + ACTIVE membership, pay_code NULL, trimmed name", async () => {
    const { tenantId, actor, sessionId } = await world();
    const r = await add(tenantId, actor, sessionId, { displayName: "  Minh Anh  " });
    const m = await fx.row(
      `SELECT m.status, m.pay_code, m.display_name, p.display_name AS person_name, p.status AS person_status
         FROM memberships m JOIN persons p ON p.id = m.person_id WHERE m.id = $1`,
      [r.membershipId],
    );
    expect(m).toMatchObject({
      status: "active",
      pay_code: null,
      display_name: "Minh Anh",
      person_name: "Minh Anh",
      person_status: "active",
    });
  });

  it("a name NEVER resolves to an existing member (DD-85): same name twice makes two members", async () => {
    const { tenantId, actor, sessionId } = await world();
    await fx.seedMembership(tenantId, "Lan");
    const a = await add(tenantId, actor, sessionId, { displayName: "Lan" });
    const b = await add(tenantId, actor, sessionId, { displayName: "Lan" });
    expect(a.membershipId).not.toBe(b.membershipId);
  });

  it("replay of the SAME command returns the stored result and mutates nothing", async () => {
    const { tenantId, actor, sessionId } = await world();
    const membershipId = await fx.seedMembership(tenantId);
    const commandId = nextCommandId();
    const first = await add(tenantId, actor, sessionId, { membershipId }, commandId);
    const before = await fx.counts(tenantId);
    const again = await add(tenantId, actor, sessionId, { membershipId }, commandId);
    expect(again).toMatchObject({
      playerId: first.playerId,
      chargeId: first.chargeId,
      replayed: true,
    });
    expect(await fx.counts(tenantId)).toEqual(before);
  });

  it("COMMAND_ID_CONFLICT: the key reused for another session, another actor, or another command", async () => {
    const { tenantId, actor, sessionId } = await world();
    const otherActor = await fx.seedAdmin(tenantId, "co_admin");
    const otherSession = await fx.seedSession(tenantId);
    const membershipId = await fx.seedMembership(tenantId);
    const commandId = nextCommandId();
    const first = await add(tenantId, actor, sessionId, { membershipId }, commandId);
    expect(await codeOf(add(tenantId, actor, otherSession, { membershipId }, commandId))).toBe(
      "COMMAND_ID_CONFLICT",
    );
    expect(await codeOf(add(tenantId, otherActor, sessionId, { membershipId }, commandId))).toBe(
      "COMMAND_ID_CONFLICT",
    );
    expect(await codeOf(remove(tenantId, actor, sessionId, first.playerId, commandId))).toBe(
      "COMMAND_ID_CONFLICT",
    );
  });

  it("a replayed key is bound to the requested member: same key + another membershipId is COMMAND_ID_CONFLICT", async () => {
    const { tenantId, actor, sessionId } = await world();
    const m1 = await fx.seedMembership(tenantId);
    const m2 = await fx.seedMembership(tenantId);
    const commandId = nextCommandId();
    await add(tenantId, actor, sessionId, { membershipId: m1 }, commandId);
    expect(await codeOf(add(tenantId, actor, sessionId, { membershipId: m2 }, commandId))).toBe(
      "COMMAND_ID_CONFLICT",
    );
    expect((await add(tenantId, actor, sessionId, { membershipId: m1 }, commandId)).replayed).toBe(
      true,
    );
  });

  it("a DIFFERENT command for an already-rostered member is ALREADY_JOINED (no second player/charge)", async () => {
    const { tenantId, actor, sessionId } = await world();
    const membershipId = await fx.seedMembership(tenantId);
    await add(tenantId, actor, sessionId, { membershipId });
    const before = await fx.counts(tenantId);
    expect(await codeOf(add(tenantId, actor, sessionId, { membershipId }))).toBe("ALREADY_JOINED");
    expect(await fx.counts(tenantId)).toEqual(before);
  });

  it("capacity: a full session waitlists at the TAIL (max+1) with NO charge; guest notes occupy slots", async () => {
    const { tenantId, actor, sessionId } = await world({ slotsMax: 2 });
    const p1 = await fx.seedPerson();
    await ctx.owner.query(
      `INSERT INTO session_guest_notes (tenant_id, session_id, created_by_person_id, guest_name) VALUES ($1,$2,$3,'G')`,
      [tenantId, sessionId, p1],
    );
    const a = await add(tenantId, actor, sessionId, { displayName: "A" });
    expect(a.status).toBe("active"); // 1 note + 1 player = 2 = full now
    const b = await add(tenantId, actor, sessionId, { displayName: "B" });
    const c = await add(tenantId, actor, sessionId, { displayName: "C" });
    expect([b.status, b.waitlistPosition, b.chargeId]).toEqual(["waitlisted", 1, null]);
    expect([c.status, c.waitlistPosition, c.chargeId]).toEqual(["waitlisted", 2, null]);
    expect(
      await fx.rows(`SELECT 1 FROM charges WHERE player_id = ANY($1)`, [[b.playerId, c.playerId]]),
    ).toHaveLength(0);
    const types = (await fx.events(sessionId)).map((e) => e.type);
    expect(types).toEqual(["player.added", "player.waitlisted", "player.waitlisted"]);
  });

  it("slots_max NULL is unbounded", async () => {
    const { tenantId, actor, sessionId } = await world({ slotsMax: null });
    for (let i = 0; i < 3; i += 1) {
      expect((await add(tenantId, actor, sessionId, { displayName: `U${i}` })).status).toBe(
        "active",
      );
    }
  });

  it("concurrent adds into the last slot: exactly one ACTIVE, the other waitlisted (session lock)", async () => {
    const { tenantId, actor, sessionId } = await world({ slotsMax: 1 });
    const results = await Promise.all([
      add(tenantId, actor, sessionId, { displayName: "R1" }),
      add(tenantId, actor, sessionId, { displayName: "R2" }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["active", "waitlisted"]);
    expect(
      (
        await fx.row(
          `SELECT count(*)::int n FROM players WHERE session_id = $1 AND status = 'active'`,
          [sessionId],
        )
      ).n,
    ).toBe(1);
  });

  it("session status: ONLY open accepts; draft (no players/charges invariant), closed and cancelled are SESSION_NOT_OPEN, nothing written", async () => {
    for (const [status, ok] of [
      ["draft", false],
      ["open", true],
      ["closed", false],
      ["cancelled", false],
    ] as const) {
      const { tenantId, actor, sessionId } = await world({ status });
      if (ok)
        expect((await add(tenantId, actor, sessionId, { displayName: "X" })).status).toBe("active");
      else {
        // Counted BEFORE the command starts: a command started first could reject (unhandled) while
        // this read is still pending, and could write before it.
        const before = await fx.counts(tenantId);
        expect(await codeOf(add(tenantId, actor, sessionId, { displayName: "X" }))).toBe(
          "SESSION_NOT_OPEN",
        );
        expect(await fx.counts(tenantId)).toEqual(before);
      }
    }
  });

  it("a zero-price session creates a charge that is already `paid` (amount_allocated 0 <= due 0)", async () => {
    const { tenantId, actor, sessionId } = await world({ priceAmount: 0 });
    const r = await add(tenantId, actor, sessionId, { displayName: "Free" });
    expect(
      await fx.row(`SELECT amount_due, amount_allocated, status FROM charges WHERE id = $1`, [
        r.chargeId,
      ]),
    ).toEqual({
      amount_due: 0,
      amount_allocated: 0,
      status: "paid",
    });
  });

  it("authorization: co_admin allowed; stranger, inactive admin and ANOTHER tenant's owner are FORBIDDEN", async () => {
    const { tenantId, sessionId } = await world();
    const co = await fx.seedAdmin(tenantId, "co_admin");
    const inactive = await fx.seedAdmin(tenantId, "owner", false);
    const stranger = await fx.seedPerson();
    const otherTenant = await fx.seedTenant();
    const foreignOwner = await fx.seedAdmin(otherTenant, "owner");
    expect((await add(tenantId, co, sessionId, { displayName: "ByCo" })).status).toBe("active");
    const before = await fx.counts(tenantId);
    for (const actor of [inactive, stranger, foreignOwner]) {
      expect(await codeOf(add(tenantId, actor, sessionId, { displayName: "Nope" }))).toBe(
        "FORBIDDEN",
      );
    }
    expect(await codeOf(add(tenantId, "not-a-uuid", sessionId, { displayName: "Nope" }))).toBe(
      "FORBIDDEN",
    );
    expect(await fx.counts(tenantId)).toEqual(before);
  });

  it("a SUSPENDED tenant is denied (manage_roster is not an obligation-termination class)", async () => {
    const tenantId = await fx.seedTenant("suspended", "active");
    const actor = await fx.seedAdmin(tenantId, "owner");
    const sessionId = await fx.seedSession(tenantId);
    expect(await codeOf(add(tenantId, actor, sessionId, { displayName: "X" }))).toBe(
      "TENANT_SUSPENDED",
    );
  });

  it("RLS: another tenant's session and membership are invisible (404-class), no person is leaked", async () => {
    const a = await world();
    const b = await world();
    const bMember = await fx.seedMembership(b.tenantId);
    expect(await codeOf(add(a.tenantId, a.actor, b.sessionId, { displayName: "X" }))).toBe(
      "SESSION_NOT_FOUND",
    );
    expect(await codeOf(add(a.tenantId, a.actor, a.sessionId, { membershipId: bMember }))).toBe(
      "PLAYER_NOT_FOUND",
    );
    expect(
      await codeOf(add(a.tenantId, a.actor, a.sessionId, { membershipId: randomUUID() })),
    ).toBe("PLAYER_NOT_FOUND");
  });

  it("input validation writes nothing: both/neither/blank/oversize name, unknown source", async () => {
    const { tenantId, actor, sessionId } = await world();
    const membershipId = await fx.seedMembership(tenantId);
    const before = await fx.counts(tenantId);
    const bad: unknown[] = [
      { membershipId, displayName: "X" },
      {},
      { displayName: "   " },
      { displayName: "" },
      { displayName: "x".repeat(101) },
      { displayName: "bad\u0000name" },
      null,
    ];
    for (const member of bad) {
      expect(await codeOf(add(tenantId, actor, sessionId, member as { displayName: string }))).toBe(
        "INVALID_INPUT",
      );
    }
    expect(
      await codeOf(
        addMemberToSession(ctx.appDb.db, {
          tenantId,
          actorPersonId: actor,
          commandId: nextCommandId(),
          sessionId,
          member: { membershipId },
          source: "invite" as never,
        }),
      ),
    ).toBe("INVALID_INPUT");
    expect(await fx.counts(tenantId)).toEqual(before);
  });

  it("a non-UUID session id fails closed as SESSION_NOT_FOUND (no raw 22P02)", async () => {
    const { tenantId, actor } = await world();
    expect(await codeOf(add(tenantId, actor, "nope", { displayName: "X" }))).toBe(
      "SESSION_NOT_FOUND",
    );
  });
});

describe("removePlayerFromSession", () => {
  it("unpaid active player: player left, charge void, one player.removed event", async () => {
    const { tenantId, actor, sessionId } = await world();
    const r = await add(tenantId, actor, sessionId, { displayName: "Del" });
    const out = await remove(tenantId, actor, sessionId, r.playerId);
    expect(out).toEqual({ playerId: r.playerId, replayed: false });
    expect(
      await fx.row(`SELECT status, waitlist_position FROM players WHERE id = $1`, [r.playerId]),
    ).toEqual({
      status: "left",
      waitlist_position: null,
    });
    expect((await fx.row(`SELECT status FROM charges WHERE id = $1`, [r.chargeId])).status).toBe(
      "void",
    );
    expect((await fx.events(sessionId)).map((e) => e.type)).toEqual([
      "player.added",
      "player.removed",
    ]);
  });

  it("replay returns the stored result; a different command for a left player is PLAYER_NOT_FOUND", async () => {
    const { tenantId, actor, sessionId } = await world();
    const r = await add(tenantId, actor, sessionId, { displayName: "Del" });
    const commandId = nextCommandId();
    await remove(tenantId, actor, sessionId, r.playerId, commandId);
    const before = await fx.counts(tenantId);
    expect(await remove(tenantId, actor, sessionId, r.playerId, commandId)).toMatchObject({
      replayed: true,
    });
    expect(await codeOf(remove(tenantId, actor, sessionId, r.playerId))).toBe("PLAYER_NOT_FOUND");
    expect(await fx.counts(tenantId)).toEqual(before);
  });

  it("waitlisted player: left, position cleared, no charge to void", async () => {
    const { tenantId, actor, sessionId } = await world({ slotsMax: 1 });
    await add(tenantId, actor, sessionId, { displayName: "A" });
    const w = await add(tenantId, actor, sessionId, { displayName: "W" });
    await remove(tenantId, actor, sessionId, w.playerId);
    expect(
      await fx.row(`SELECT status, waitlist_position FROM players WHERE id = $1`, [w.playerId]),
    ).toEqual({
      status: "left",
      waitlist_position: null,
    });
  });

  it("a player with an effective payment is REMOVE_REQUIRES_REVIEW, nothing changes", async () => {
    const { tenantId, actor, sessionId } = await world();
    const r = await add(tenantId, actor, sessionId, { displayName: "Paid" });
    await markPaid(ctx.appDb.db, {
      tenantId,
      actorPersonId: actor,
      commandId: nextCommandId(),
      sessionId,
      method: "cash",
      items: [{ playerId: r.playerId, amount: 1000 }],
      preview: false,
      expectedTotal: 1000,
    });
    const before = await fx.counts(tenantId);
    expect(await codeOf(remove(tenantId, actor, sessionId, r.playerId))).toBe(
      "REMOVE_REQUIRES_REVIEW",
    );
    expect(await fx.counts(tenantId)).toEqual(before);
    expect((await fx.row(`SELECT status FROM players WHERE id = $1`, [r.playerId])).status).toBe(
      "active",
    );
  });

  it("re-adding a removed member REUSES the player row and the single charge (never a second charge)", async () => {
    const { tenantId, actor, sessionId } = await world({ priceAmount: 70000 });
    const r = await add(tenantId, actor, sessionId, { displayName: "Back" });
    await remove(tenantId, actor, sessionId, r.playerId);
    const again = await add(tenantId, actor, sessionId, { membershipId: r.membershipId });
    expect(again).toMatchObject({ playerId: r.playerId, chargeId: r.chargeId, status: "active" });
    expect(
      await fx.rows(`SELECT status, amount_due FROM charges WHERE player_id = $1`, [r.playerId]),
    ).toEqual([{ status: "open", amount_due: 70000 }]);
  });

  it("frozen roster (closed session), cross-tenant, malformed ids and suspended tenant are refused", async () => {
    const { tenantId, actor, sessionId } = await world();
    const r = await add(tenantId, actor, sessionId, { displayName: "X" });
    const other = await world();
    expect(await codeOf(remove(other.tenantId, other.actor, sessionId, r.playerId))).toBe(
      "SESSION_NOT_FOUND",
    );
    expect(await codeOf(remove(other.tenantId, other.actor, other.sessionId, r.playerId))).toBe(
      "PLAYER_NOT_FOUND",
    );
    expect(await codeOf(remove(tenantId, actor, sessionId, "nope"))).toBe("PLAYER_NOT_FOUND");
    expect(await codeOf(remove(tenantId, await fx.seedPerson(), sessionId, r.playerId))).toBe(
      "FORBIDDEN",
    );
    await ctx.owner.query(`UPDATE sessions SET status = 'closed' WHERE id = $1`, [sessionId]);
    expect(await codeOf(remove(tenantId, actor, sessionId, r.playerId))).toBe("SESSION_NOT_OPEN");
    await ctx.owner.query(`UPDATE tenants SET status = 'suspended' WHERE id = $1`, [tenantId]);
    expect(await codeOf(remove(tenantId, actor, sessionId, r.playerId))).toBe("TENANT_SUSPENDED");
  });
});

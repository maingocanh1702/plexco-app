import { inspect } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chargeRemaining, chargeStatusFor, markPaid } from "./payment-manual.js";
import { reversePaymentAllocation } from "./payment-reversal.js";
import { fixtures, nextCommandId } from "./roster-money-fixtures.js";
import { RosterMoneyError } from "./roster-money-shared.js";
import { addMemberToSession, removePlayerFromSession } from "./roster-service.js";
import { getSessionDetail } from "./session-read.js";
import {
  cancelSession,
  closeSession,
  SessionCancelError,
  SessionCloseAuthorizationError,
  SessionCloseError,
} from "./session-service.js";
import { setupRlsTestContext, type RlsTestContext } from "./test-harness.js";

/**
 * DD-131 OD-1 / DD-132 (pending in PR #51): the close/cancel money policy, driven through the REAL
 * roster and money writers (add/remove player, mark-paid, reversal) as the `app` role. Close refuses
 * an open balance with CLOSE_BLOCKED_OPEN_DEBT naming who owes; cancel keeps owner gate #3 and
 * refuses only recorded money (net allocated > 0). The decision table these rows realize lives in
 * docs/features/BE/feature_session_management_tech.md §4 "Close / Cancel money policy".
 * States no writer can produce are forged with the owner connection and say so. AG-* pin what the
 * close guard and the host roster read model (getSessionDetail `remaining`) agree on: AG-1/AG-2 —
 * close refuses exactly the roster rows with remaining > 0 on states the writers produce (where the
 * stored charges.status/amount_allocated always equal the ledger-derived ones); AG-4 — on forged
 * STALE stored columns both still follow the ledger SUM (effectiveByCharge), so a guard or a roster
 * re-derived from the stored status/amount_allocated fails; AG-3 — chargeRemaining's values. That
 * both call the one helper (chargeRemaining) is a code property no test can pin.
 */
let ctx: RlsTestContext;
const fx = fixtures(() => ctx);

beforeAll(async () => {
  ctx = await setupRlsTestContext("plexco_close_cancel_money_policy");
}, 120_000);
afterAll(async () => {
  await ctx?.teardown();
});

interface World {
  tenantId: string;
  actor: string;
  sessionId: string;
}

/** Tenant + owner actor + open future session (price 100000 unless given). */
async function world(over: { priceAmount?: number; slotsMax?: number } = {}): Promise<World> {
  const tenantId = await fx.seedTenant();
  const actor = await fx.seedAdmin(tenantId, "owner");
  const sessionId = await fx.seedSession(tenantId, {
    priceAmount: over.priceAmount ?? 100000,
    slotsMax: over.slotsMax,
  });
  return { tenantId, actor, sessionId };
}

const join = async (w: World, displayName: string) => {
  const r = await addMemberToSession(ctx.appDb.db, {
    tenantId: w.tenantId,
    actorPersonId: w.actor,
    commandId: nextCommandId(),
    sessionId: w.sessionId,
    member: { displayName },
    source: "host_add",
  });
  return { playerId: r.playerId, chargeId: r.chargeId, status: r.status };
};
/** Confirmed cash payment of `amount` for one player; returns the allocation id. */
const pay = async (w: World, playerId: string, amount: number): Promise<string> => {
  const r = await markPaid(ctx.appDb.db, {
    tenantId: w.tenantId,
    actorPersonId: w.actor,
    commandId: nextCommandId(),
    sessionId: w.sessionId,
    method: "cash",
    items: [{ playerId, amount }],
    preview: false,
    expectedTotal: amount,
  });
  return r.lines[0]!.allocationId!;
};
const reverse = (w: World, allocationId: string) =>
  reversePaymentAllocation(ctx.appDb.db, {
    tenantId: w.tenantId,
    actorPersonId: w.actor,
    commandId: nextCommandId(),
    sessionId: w.sessionId,
    allocationId,
    reason: "recorded by mistake",
  });
const remove = (w: World, playerId: string) =>
  removePlayerFromSession(ctx.appDb.db, {
    tenantId: w.tenantId,
    actorPersonId: w.actor,
    commandId: nextCommandId(),
    sessionId: w.sessionId,
    playerId,
  });

const version = async (sessionId: string): Promise<number> =>
  Number((await fx.row(`SELECT version FROM sessions WHERE id = $1`, [sessionId])).version);
const status = async (sessionId: string): Promise<string> =>
  String((await fx.row(`SELECT status FROM sessions WHERE id = $1`, [sessionId])).status);
const close = (w: World, expectedVersion: number, commandId = nextCommandId()) =>
  closeSession(ctx.appDb.db, {
    tenantId: w.tenantId,
    commandId,
    input: { sessionId: w.sessionId, expectedVersion },
  });
const cancel = (w: World, expectedVersion: number, commandId = nextCommandId()) =>
  cancelSession(ctx.appDb.db, {
    tenantId: w.tenantId,
    commandId,
    input: { sessionId: w.sessionId, expectedVersion },
  });

/** Resolves to the rejection, or fails the test if the command succeeded. */
async function rejectionOf(run: Promise<unknown>): Promise<unknown> {
  return run.then(
    (value) => {
      throw new Error(`expected a rejection, got ${JSON.stringify(value)}`);
    },
    (error: unknown) => error,
  );
}
async function closeRefusal(run: Promise<unknown>): Promise<SessionCloseError> {
  const err = await rejectionOf(run);
  expect(err).toBeInstanceOf(SessionCloseError);
  return err as SessionCloseError;
}
async function cancelCode(run: Promise<unknown>): Promise<string> {
  const err = await rejectionOf(run);
  expect(err).toBeInstanceOf(SessionCancelError);
  return (err as SessionCancelError).code;
}
async function rosterMoneyCode(run: Promise<unknown>): Promise<string> {
  const err = await rejectionOf(run);
  expect(err).toBeInstanceOf(RosterMoneyError);
  return (err as RosterMoneyError).code;
}
const chargeOf = (chargeId: string) =>
  fx.row(`SELECT status, amount_due, amount_allocated FROM charges WHERE id = $1`, [chargeId]);
const commandRows = (tenantId: string, commandId: string) =>
  fx.rows(`SELECT command_type FROM processed_commands WHERE tenant_id = $1 AND command_id = $2`, [
    tenantId,
    commandId,
  ]);

describe("closeSession — open-debt guard (DD-131 OD-1)", () => {
  it("CM-1: closes when every charge is fully paid, a removed unpaid player's charge is void, and the paid roster is still ACTIVE (close has no roster gate)", async () => {
    const w = await world();
    const paid = await join(w, "An");
    const removed = await join(w, "Bình");
    await pay(w, paid.playerId, 100000);
    await remove(w, removed.playerId);
    expect(await chargeOf(removed.chargeId!)).toMatchObject({ status: "void" });
    const v = await version(w.sessionId);
    const r = await close(w, v);
    expect(r).toMatchObject({ status: "closed", version: v + 1, replayed: false });
    expect((await fx.events(w.sessionId)).map((e) => e.type)).toContain("session.closed");
  });

  it("CM-2: an UNPAID charge refuses with CLOSE_BLOCKED_OPEN_DEBT naming exactly that player (id + display name), zero mutation, never CANCEL_REQUIRES_REVIEW; the error never carries the name into a log", async () => {
    const w = await world();
    const owing = await join(w, "Lan");
    const v = await version(w.sessionId);
    const before = await fx.counts(w.tenantId);
    const commandId = nextCommandId();
    const err = await closeRefusal(close(w, v, commandId));
    expect(err.code).toBe("CLOSE_BLOCKED_OPEN_DEBT");
    expect(err.openBalancePlayers).toEqual([{ playerId: owing.playerId, displayName: "Lan" }]);
    // Zero mutation: same session row, same counts, and the refusal is NOT recorded under the key.
    expect(await status(w.sessionId)).toBe("open");
    expect(await version(w.sessionId)).toBe(v);
    expect(await fx.counts(w.tenantId)).toEqual(before);
    expect(await commandRows(w.tenantId, commandId)).toEqual([]);
    // The name lives in a #private field: not in the message, util.inspect or JSON of the error.
    expect(err.message).not.toMatch(/Lan|100000/);
    expect(inspect(err, { depth: 10 })).not.toContain("Lan");
    expect(JSON.stringify(err)).not.toContain("Lan");
  });

  it("CM-3: lists the partly paid and unpaid players only — not the fully paid, not the removed — in roster order (joined_at, id), each entry exactly {playerId, displayName}", async () => {
    const w = await world();
    const full = await join(w, "Một");
    const partial = await join(w, "Hai");
    const unpaid = await join(w, "Ba");
    const removed = await join(w, "Bốn");
    const unpaidLast = await join(w, "Năm");
    await pay(w, full.playerId, 100000);
    await pay(w, partial.playerId, 30000);
    await remove(w, removed.playerId);
    const err = await closeRefusal(close(w, await version(w.sessionId)));
    expect(err.code).toBe("CLOSE_BLOCKED_OPEN_DEBT");
    expect(err.openBalancePlayers).toEqual([
      { playerId: partial.playerId, displayName: "Hai" },
      { playerId: unpaid.playerId, displayName: "Ba" },
      { playerId: unpaidLast.playerId, displayName: "Năm" },
    ]);
    for (const entry of err.openBalancePlayers!) {
      expect(Object.keys(entry).sort()).toEqual(["displayName", "playerId"]);
    }
  });

  it("CM-4: a FREE session (price 0 — the 'exempt' case; charges_status_chk has no 'exempt') closes: its charge is `paid` with zero money", async () => {
    const w = await world({ priceAmount: 0 });
    const p = await join(w, "Miễn phí");
    expect(await chargeOf(p.chargeId!)).toMatchObject({ status: "paid", amount_due: 0 });
    const v = await version(w.sessionId);
    expect(await close(w, v)).toMatchObject({ status: "closed", version: v + 1 });
  });

  it("CM-5: a STALE close against open debt is STALE_VERSION — the version check precedes the money guard, so no list is ever computed", async () => {
    const w = await world();
    await join(w, "Lan");
    const err = await closeRefusal(close(w, (await version(w.sessionId)) + 9));
    expect(err.code).toBe("STALE_VERSION");
    expect(err.openBalancePlayers).toBeUndefined();
  });

  it("CM-6: a session whose ONLY charge is a removed player's void charge closes (the pre-OD-1 any-charge probe refused it)", async () => {
    const w = await world();
    const p = await join(w, "Rời");
    await remove(w, p.playerId);
    const v = await version(w.sessionId);
    expect(await close(w, v)).toMatchObject({ status: "closed", version: v + 1 });
  });

  it("CM-7: billing — a SUSPENDED subscription still closes (DD-110 D2) once nobody owes, but the open-debt guard still applies; a CANCELLED tenant is TENANT_SUSPENDED before any money read (no list)", async () => {
    const owing = await world();
    await join(owing, "Nợ");
    const settled = await world();
    const p = await join(settled, "Đủ");
    await pay(settled, p.playerId, 100000);
    for (const t of [owing.tenantId, settled.tenantId]) {
      await ctx.owner.query(`UPDATE subscriptions SET status = 'suspended' WHERE tenant_id = $1`, [
        t,
      ]);
    }
    const blocked = await closeRefusal(close(owing, await version(owing.sessionId)));
    expect(blocked.code).toBe("CLOSE_BLOCKED_OPEN_DEBT");
    const v = await version(settled.sessionId);
    expect(await close(settled, v)).toMatchObject({ status: "closed", version: v + 1 });

    await ctx.owner.query(`UPDATE tenants SET status = 'cancelled' WHERE id = $1`, [
      owing.tenantId,
    ]);
    const denied = await rejectionOf(close(owing, await version(owing.sessionId)));
    expect(denied).toBeInstanceOf(SessionCloseAuthorizationError);
    expect((denied as SessionCloseAuthorizationError).code).toBe("TENANT_SUSPENDED");
    expect(denied as object).not.toHaveProperty("openBalancePlayers");
  });

  it("CM-8: a refused close is not recorded, so the SAME commandId closes once the debt is paid; a further replay returns the stored success with zero writes", async () => {
    const w = await world();
    const p = await join(w, "Lan");
    const commandId = nextCommandId();
    const v = await version(w.sessionId);
    expect((await closeRefusal(close(w, v, commandId))).code).toBe("CLOSE_BLOCKED_OPEN_DEBT");
    await pay(w, p.playerId, 100000); // mark-paid takes the session lock but never bumps version
    expect(await close(w, v, commandId)).toMatchObject({
      status: "closed",
      version: v + 1,
      replayed: false,
    });
    const before = await fx.counts(w.tenantId);
    expect(await close(w, v, commandId)).toMatchObject({
      status: "closed",
      version: v + 1,
      replayed: true,
    });
    expect(await fx.counts(w.tenantId)).toEqual(before);
  });

  it("CM-9: on a CLOSED session a reversal is still allowed (OD-6: no session-status guard) and re-opens the charge; the session stays closed and the host can record the payment again", async () => {
    const w = await world();
    const p = await join(w, "Lan");
    const allocationId = await pay(w, p.playerId, 100000);
    await close(w, await version(w.sessionId));
    const reversed = await reverse(w, allocationId);
    expect(reversed.status).toBe("open");
    expect(await status(w.sessionId)).toBe("closed");
    await pay(w, p.playerId, 100000);
    expect(await chargeOf(p.chargeId!)).toMatchObject({ status: "paid", amount_allocated: 100000 });
  });
});

describe("cancelSession — recorded-money guard (DD-131 OD-1)", () => {
  it("CX-1: the void charge of a removed, UNPAID player does not block cancel (a waitlisted player left on the roster does not either)", async () => {
    const w = await world({ slotsMax: 1 });
    const active = await join(w, "A");
    const waiting = await join(w, "B");
    expect(waiting).toMatchObject({ status: "waitlisted", chargeId: null });
    await remove(w, active.playerId);
    expect(await chargeOf(active.chargeId!)).toMatchObject({ status: "void", amount_allocated: 0 });
    const v = await version(w.sessionId);
    expect(await cancel(w, v)).toMatchObject({ status: "cancelled", version: v + 1 });
    const cancelled = (await fx.events(w.sessionId)).find((e) => e.type === "session.cancelled");
    expect(cancelled?.payload).toMatchObject({ roster_count: 0, has_paid: false });
    expect(await chargeOf(active.chargeId!)).toMatchObject({ status: "void" });
  });

  it("CX-2: an ACTIVE roster still refuses (owner gate #3), unpaid or paid — zero mutation", async () => {
    const w = await world();
    await join(w, "Chưa trả");
    const paid = await join(w, "Đã trả");
    await pay(w, paid.playerId, 100000);
    const v = await version(w.sessionId);
    const before = await fx.counts(w.tenantId);
    expect(await cancelCode(cancel(w, v))).toBe("CANCEL_REQUIRES_REVIEW");
    expect(await status(w.sessionId)).toBe("open");
    expect(await fx.counts(w.tenantId)).toEqual(before);
  });

  it("CX-3: reversal then cancel — a paid player cannot be removed and blocks cancel; reverse -> remove -> cancel succeeds; afterwards nothing on the cancelled session can be reversed or paid (SESSION_NOT_OPEN, zero writes)", async () => {
    const w = await world();
    const p = await join(w, "Lan");
    const allocationId = await pay(w, p.playerId, 100000);
    expect(await rosterMoneyCode(remove(w, p.playerId))).toBe("REMOVE_REQUIRES_REVIEW");
    expect(await cancelCode(cancel(w, await version(w.sessionId)))).toBe("CANCEL_REQUIRES_REVIEW");
    await reverse(w, allocationId);
    await remove(w, p.playerId);
    const v = await version(w.sessionId);
    expect(await cancel(w, v)).toMatchObject({ status: "cancelled", version: v + 1 });
    const before = await fx.counts(w.tenantId);
    expect(await rosterMoneyCode(reverse(w, allocationId))).toBe("SESSION_NOT_OPEN");
    expect(await rosterMoneyCode(pay(w, p.playerId, 100000))).toBe("SESSION_NOT_OPEN");
    expect(await fx.counts(w.tenantId)).toEqual(before);
  });

  // Unreachable through the writers (remove requires effective 0 and voids; no writer pays a void
  // charge or a non-active player), so the owner connection forges it: the guard is fail-closed.
  it("CX-4: recorded money (net allocated > 0) on ANY charge refuses, void included; once fully reversed (net 0) cancel proceeds", async () => {
    const w = await world();
    const p = await join(w, "Lan");
    await remove(w, p.playerId);
    const alloc = await fx.row(
      `INSERT INTO payment_allocations (tenant_id, charge_id, amount, source, created_by)
       VALUES ($1, $2, 50000, 'cash', $3) RETURNING id`,
      [w.tenantId, p.chargeId, w.actor],
    );
    expect(await cancelCode(cancel(w, await version(w.sessionId)))).toBe("CANCEL_REQUIRES_REVIEW");
    await ctx.owner.query(
      `INSERT INTO payment_allocations (tenant_id, charge_id, amount, source, reverses_allocation_id, created_by)
       VALUES ($1, $2, -50000, 'reversal', $3, $4)`,
      [w.tenantId, p.chargeId, (alloc as { id: string }).id, w.actor],
    );
    const v = await version(w.sessionId);
    expect(await cancel(w, v)).toMatchObject({ status: "cancelled", version: v + 1 });
  });

  it("CX-5: a LIVE (non-void) charge with no active player refuses — unreachable via the writers (forged), fail-closed instead of orphaning a debt; covers an unpaid and a free (`paid`, zero money) charge", async () => {
    for (const priceAmount of [100000, 0]) {
      const w = await world({ priceAmount });
      const p = await join(w, "Lan");
      await ctx.owner.query(`UPDATE players SET status = 'left' WHERE id = $1`, [p.playerId]);
      expect(await chargeOf(p.chargeId!)).not.toMatchObject({ status: "void" });
      expect(await cancelCode(cancel(w, await version(w.sessionId)))).toBe(
        "CANCEL_REQUIRES_REVIEW",
      );
      expect(await status(w.sessionId)).toBe("open");
    }
  });
});

describe("concurrency — the money check runs under the session row lock", () => {
  /** Hold the session row FOR UPDATE on a separate app connection (a stand-in for an in-flight
   *  writer); `release()` commits it. Commands started meanwhile queue on that row in start order. */
  async function holdSession(w: World) {
    const holder = await ctx.appPool.connect();
    await holder.query("BEGIN");
    await holder.query(`SELECT set_config('app.tenant_id', $1, true)`, [w.tenantId]);
    await holder.query(`SELECT id FROM sessions WHERE id = $1 FOR UPDATE`, [w.sessionId]);
    const pid = ((await holder.query(`SELECT pg_backend_pid() AS pid`)).rows[0] as { pid: number })
      .pid;
    return {
      pid,
      release: async () => {
        await holder.query("COMMIT").catch(() => undefined);
        holder.release();
      },
    };
  }

  /** Wait until at least `min` backends sit (transitively) behind the holder's lock. */
  async function waitUntilBlocked(holderPid: number, min: number): Promise<void> {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const { rows } = await ctx.owner.query(
        `WITH RECURSIVE reach AS (
           SELECT pid FROM pg_stat_activity
             WHERE wait_event_type = 'Lock' AND $1 = ANY(pg_blocking_pids(pid))
           UNION
           SELECT a.pid FROM pg_stat_activity a
             JOIN reach r ON r.pid = ANY(pg_blocking_pids(a.pid))
             WHERE a.wait_event_type = 'Lock'
         )
         SELECT count(*)::int AS c FROM reach`,
        [holderPid],
      );
      if (Number((rows[0] as { c: number }).c) >= min) return;
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    throw new Error(`fewer than ${min} backend(s) blocked by holder ${holderPid} within 5s`);
  }

  type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };
  const settle = <T>(run: Promise<T>): Promise<Settled<T>> =>
    run.then(
      (value): Settled<T> => ({ ok: true, value }),
      (error: unknown): Settled<T> => ({ ok: false, error }),
    );

  /** Start `first`, wait until it queues on the held row, start `second`, then release. */
  async function race<A, B>(w: World, first: () => Promise<A>, second: () => Promise<B>) {
    const hold = await holdSession(w);
    let a: Promise<Settled<A>> | undefined;
    let b: Promise<Settled<B>> | undefined;
    try {
      a = settle(first());
      await waitUntilBlocked(hold.pid, 1);
      b = settle(second());
      await waitUntilBlocked(hold.pid, 2);
    } finally {
      await hold.release();
    }
    return { first: await a!, second: await b! };
  }

  it("CC-1: add-player queued BEFORE close — close re-reads after the add commits and refuses, naming the new player (never a closed session with an open debt)", async () => {
    const w = await world();
    const v = await version(w.sessionId);
    const { first, second } = await race(
      w,
      () => join(w, "Muộn"),
      () => close(w, v),
    );
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    const err = (second as { error: unknown }).error as SessionCloseError;
    expect(err).toBeInstanceOf(SessionCloseError);
    expect(err.code).toBe("CLOSE_BLOCKED_OPEN_DEBT");
    expect(err.openBalancePlayers).toEqual([
      {
        playerId: (first as { value: { playerId: string } }).value.playerId,
        displayName: "Muộn",
      },
    ]);
    expect(await status(w.sessionId)).toBe("open");
  });

  it("CC-2: close queued BEFORE add-player — the add sees 'closed' under its own session lock and writes nothing", async () => {
    const w = await world();
    const v = await version(w.sessionId);
    const before = await fx.counts(w.tenantId);
    const { first, second } = await race(
      w,
      () => close(w, v),
      () => join(w, "Muộn"),
    );
    expect(first).toMatchObject({ ok: true, value: { status: "closed" } });
    expect(second.ok).toBe(false);
    const err = (second as { error: unknown }).error;
    expect(err).toBeInstanceOf(RosterMoneyError);
    expect((err as RosterMoneyError).code).toBe("SESSION_NOT_OPEN");
    const after = (await fx.counts(w.tenantId)) as Record<string, number>;
    expect(after.players).toBe((before as Record<string, number>).players);
    expect(after.charges).toBe((before as Record<string, number>).charges);
  });

  it("CC-3: mark-paid queued BEFORE close — close re-reads the ledger after the payment commits and closes", async () => {
    const w = await world();
    const p = await join(w, "Lan");
    const v = await version(w.sessionId);
    const { first, second } = await race(
      w,
      () => pay(w, p.playerId, 100000),
      () => close(w, v),
    );
    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: true, value: { status: "closed", version: v + 1 } });
  });

  it("CC-4: remove queued BEFORE cancel — cancel re-reads after the void commits and cancels (the void charge does not block)", async () => {
    const w = await world();
    const p = await join(w, "Lan");
    const v = await version(w.sessionId);
    const { first, second } = await race(
      w,
      () => remove(w, p.playerId),
      () => cancel(w, v),
    );
    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: true, value: { status: "cancelled", version: v + 1 } });
  });

  it("CC-5: cancel queued BEFORE add-player — the add sees 'cancelled' and writes nothing", async () => {
    const w = await world();
    const v = await version(w.sessionId);
    const before = await fx.counts(w.tenantId);
    const { first, second } = await race(
      w,
      () => cancel(w, v),
      () => join(w, "Muộn"),
    );
    expect(first).toMatchObject({ ok: true, value: { status: "cancelled" } });
    expect(second.ok).toBe(false);
    expect(((second as { error: unknown }).error as RosterMoneyError).code).toBe(
      "SESSION_NOT_OPEN",
    );
    const after = (await fx.counts(w.tenantId)) as Record<string, number>;
    expect(after.players).toBe((before as Record<string, number>).players);
    expect(after.charges).toBe((before as Record<string, number>).charges);
  });
});

describe("close guard <=> host roster read model — the same remaining, derived from the ledger", () => {
  /** The host roster's `remaining` per player id (getSessionDetail): every row carrying a charge. */
  async function rosterRemaining(w: World): Promise<Map<string, number>> {
    const detail = await getSessionDetail(ctx.appDb.db, {
      tenantId: w.tenantId,
      sessionId: w.sessionId,
    });
    expect(detail).not.toBeNull();
    return new Map(
      detail!.players.flatMap((p) =>
        p.charge === null ? [] : [[p.id, p.charge.remaining] as const],
      ),
    );
  }

  /** Close on the SAME committed state: the player ids it refuses on, or [] once it closed. */
  async function closeGuardOwing(w: World): Promise<string[]> {
    try {
      expect(await close(w, await version(w.sessionId))).toMatchObject({ status: "closed" });
      return [];
    } catch (error) {
      if (error instanceof SessionCloseError && error.code === "CLOSE_BLOCKED_OPEN_DEBT") {
        return error.openBalancePlayers!.map((p) => p.playerId);
      }
      throw error;
    }
  }

  /** The pinned property: close refuses exactly the players the roster shows with remaining > 0. */
  async function expectAgreement(w: World): Promise<Map<string, number>> {
    const remaining = await rosterRemaining(w);
    const owing = await closeGuardOwing(w);
    const rosterOwing = [...remaining].filter(([, r]) => r > 0).map(([id]) => id);
    expect([...owing].sort()).toEqual([...rosterOwing].sort());
    return remaining;
  }

  /** AG-4, owner connection only: rewrite a charge's STORED status/amount_allocated; the ledger
   *  (payment_allocations) is left untouched. */
  const forgeStored = (chargeId: string, stored: "open" | "partial" | "paid", allocated: number) =>
    ctx.owner.query(`UPDATE charges SET status = $2, amount_allocated = $3 WHERE id = $1`, [
      chargeId,
      stored,
      allocated,
    ]);
  /** The ledger truth: SUM of payment_allocations (reversals negative), read by the owner. */
  const ledgerNet = async (chargeId: string): Promise<number> =>
    Number(
      (
        await fx.row(
          `SELECT COALESCE(SUM(amount), 0) AS net FROM payment_allocations WHERE charge_id = $1`,
          [chargeId],
        )
      ).net,
    );

  it("AG-1: void, unpaid, partly paid, fully paid, fully reversed and reversed-back-to-partial charges — close lists exactly the roster rows with remaining > 0", async () => {
    const w = await world();
    const voided = await join(w, "Rời");
    const unpaid = await join(w, "Chưa trả");
    const partial = await join(w, "Một phần");
    const full = await join(w, "Đủ");
    const reversed = await join(w, "Đảo hết");
    const reversedToPartial = await join(w, "Đảo một phần");
    await remove(w, voided.playerId);
    await pay(w, partial.playerId, 30000);
    await pay(w, full.playerId, 100000);
    await reverse(w, await pay(w, reversed.playerId, 100000));
    await pay(w, reversedToPartial.playerId, 40000);
    await reverse(w, await pay(w, reversedToPartial.playerId, 60000));
    expect(Object.fromEntries(await expectAgreement(w))).toEqual({
      [voided.playerId]: 0,
      [unpaid.playerId]: 100000,
      [partial.playerId]: 70000,
      [full.playerId]: 0,
      [reversed.playerId]: 100000,
      [reversedToPartial.playerId]: 60000,
    });
    expect(await status(w.sessionId)).toBe("open");
  });

  it("AG-2: a free price-0 charge, and a settled session (fully paid, void, reversed then paid again) — the roster shows remaining 0 on every row and close succeeds", async () => {
    const free = await world({ priceAmount: 0 });
    const freePlayer = await join(free, "Miễn phí");
    expect(Object.fromEntries(await expectAgreement(free))).toEqual({ [freePlayer.playerId]: 0 });
    expect(await status(free.sessionId)).toBe("closed");

    const settled = await world();
    const full = await join(settled, "Đủ");
    const voided = await join(settled, "Rời");
    const repaid = await join(settled, "Trả lại");
    await pay(settled, full.playerId, 100000);
    await remove(settled, voided.playerId);
    await reverse(settled, await pay(settled, repaid.playerId, 100000));
    await pay(settled, repaid.playerId, 100000);
    expect(Object.fromEntries(await expectAgreement(settled))).toEqual({
      [full.playerId]: 0,
      [voided.playerId]: 0,
      [repaid.playerId]: 0,
    });
    expect(await status(settled.sessionId)).toBe("closed");
  });

  it("AG-3: chargeRemaining itself — 0 for void (even with forged money), due - net otherwise; > 0 exactly when a non-void charge's derived status is not `paid` (INV-7)", () => {
    expect(chargeRemaining(100000, 0, "void")).toBe(0);
    expect(chargeRemaining(100000, 50000, "void")).toBe(0);
    expect(chargeRemaining(100000, 0, "open")).toBe(100000);
    expect(chargeRemaining(100000, 30000, "partial")).toBe(70000);
    expect(chargeRemaining(100000, 100000, "paid")).toBe(0);
    expect(chargeRemaining(0, 0, "paid")).toBe(0);
    for (const due of [0, 1, 100000]) {
      for (const net of [0, 1, 99999, 100000]) {
        if (net > due) continue; // applyEffective keeps net allocated within [0, amount_due]
        const derived = chargeStatusFor(due, net);
        expect(chargeRemaining(due, net, derived) > 0).toBe(derived !== "paid");
      }
    }
  });

  // Unreachable through the writers: applyEffective, the single writer of amount_allocated/status,
  // re-derives both from the ledger, so on AG-1/AG-2 states stored == derived and a guard or roster
  // reading the stored columns stays green. Here the owner connection forges the STORED columns out
  // of step with the ledger (in both directions), which only the ledger-following reads survive.
  it("AG-4: forged STALE stored charges — stored `paid` over an empty ledger still owes the full price, stored `open`/`partial` over a fully paid ledger owe nothing; close and the roster both follow the ledger, never the stored status/amount_allocated", async () => {
    const owes = await world();
    const stalePaid = await join(owes, "Lệch đã trả");
    await forgeStored(stalePaid.chargeId!, "paid", 100000);
    expect(await chargeOf(stalePaid.chargeId!)).toMatchObject({
      status: "paid",
      amount_allocated: 100000,
    });
    expect(await ledgerNet(stalePaid.chargeId!)).toBe(0);
    expect(Object.fromEntries(await expectAgreement(owes))).toEqual({
      [stalePaid.playerId]: 100000,
    });
    expect(await status(owes.sessionId)).toBe("open");

    const settled = await world();
    const staleOpen = await join(settled, "Lệch chưa trả");
    const stalePartial = await join(settled, "Lệch một phần");
    await pay(settled, staleOpen.playerId, 100000);
    await pay(settled, stalePartial.playerId, 100000);
    await forgeStored(staleOpen.chargeId!, "open", 0);
    await forgeStored(stalePartial.chargeId!, "partial", 30000);
    expect(await chargeOf(staleOpen.chargeId!)).toMatchObject({
      status: "open",
      amount_allocated: 0,
    });
    expect(await chargeOf(stalePartial.chargeId!)).toMatchObject({
      status: "partial",
      amount_allocated: 30000,
    });
    expect(await ledgerNet(staleOpen.chargeId!)).toBe(100000);
    expect(await ledgerNet(stalePartial.chargeId!)).toBe(100000);
    expect(Object.fromEntries(await expectAgreement(settled))).toEqual({
      [staleOpen.playerId]: 0,
      [stalePartial.playerId]: 0,
    });
    expect(await status(settled.sessionId)).toBe("closed");
  });
});

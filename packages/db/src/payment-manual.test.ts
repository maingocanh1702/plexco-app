import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyEffective, markPaid, type MarkPaidParams } from "./payment-manual.js";
import { reversePaymentAllocation } from "./payment-reversal.js";
import { fixtures, nextCommandId } from "./roster-money-fixtures.js";
import { RosterMoneyError } from "./roster-money-shared.js";
import { addMemberToSession, removePlayerFromSession } from "./roster-service.js";
import { withTenant } from "./tenant.js";
import { setupRlsTestContext, type RlsTestContext } from "./test-harness.js";

// Real-PG tests for manual mark-paid (DD-40) and reversal, run as the `app` role (DATABASE_URL_TEST).
let ctx: RlsTestContext;
const fx = fixtures(() => ctx);

beforeAll(async () => {
  ctx = await setupRlsTestContext("plexco_payment_manual");
}, 120_000);
afterAll(async () => {
  await ctx?.teardown();
});

async function codeOf(run: Promise<unknown>): Promise<string> {
  const err = await run.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err, "expected the command to reject").toBeInstanceOf(RosterMoneyError);
  return (err as RosterMoneyError).code;
}

interface World {
  tenantId: string;
  actor: string;
  sessionId: string;
  playerIds: string[];
  chargeIds: string[];
}
/** Tenant + owner + open session (price default 100000) + `players` ACTIVE players via the real add path. */
async function world(over: { priceAmount?: number; players?: number } = {}): Promise<World> {
  const tenantId = await fx.seedTenant();
  const actor = await fx.seedAdmin(tenantId, "owner");
  const sessionId = await fx.seedSession(tenantId, { priceAmount: over.priceAmount ?? 100000 });
  const playerIds: string[] = [];
  const chargeIds: string[] = [];
  for (let i = 0; i < (over.players ?? 2); i += 1) {
    const r = await addMemberToSession(ctx.appDb.db, {
      tenantId,
      actorPersonId: actor,
      commandId: nextCommandId(),
      sessionId,
      member: { displayName: `Player ${i}` },
      source: "host_add",
    });
    playerIds.push(r.playerId);
    chargeIds.push(r.chargeId as string);
  }
  return { tenantId, actor, sessionId, playerIds, chargeIds };
}

/** Confirm requires an explicit amount per item (S7); tests that mean "the whole price" get it filled
 *  here (every world uses price 100000). Pass `raw: true` to send items exactly as given. */
const pay = (w: World, over: Partial<MarkPaidParams> & { raw?: boolean }) => {
  const { raw, ...rest } = over;
  const items = rest.items ?? [{ playerId: w.playerIds[0]! }];
  const preview = rest.preview === true;
  return markPaid(ctx.appDb.db, {
    tenantId: w.tenantId,
    actorPersonId: w.actor,
    commandId: nextCommandId(),
    sessionId: w.sessionId,
    method: "cash",
    preview: false,
    ...rest,
    items: raw || preview ? items : items.map((i) => ({ amount: 100000, ...i })),
  });
};
const charge = (id: string) =>
  fx.row(`SELECT amount_due, amount_allocated, status FROM charges WHERE id = $1`, [id]);
const ledgerSum = async (chargeId: string) =>
  Number(
    (
      await fx.row(
        `SELECT coalesce(sum(amount),0)::int s FROM payment_allocations WHERE charge_id = $1`,
        [chargeId],
      )
    ).s,
  );

describe("markPaid preview", () => {
  it("returns server-computed remaining + total and writes NOTHING (no allocation, event, command key)", async () => {
    const w = await world();
    const before = await fx.counts(w.tenantId);
    const r = await pay(w, {
      preview: true,
      commandId: undefined,
      items: w.playerIds.map((playerId) => ({ playerId })),
    });
    expect(r).toMatchObject({ preview: true, replayed: false, method: "cash", total: 200000 });
    expect(r.lines.map((l) => [l.remaining, l.amount])).toEqual([
      [100000, 100000],
      [100000, 100000],
    ]);
    expect(await fx.counts(w.tenantId)).toEqual(before);
  });

  it("an explicit amount previews exactly that amount; > remaining is refused at preview too", async () => {
    const w = await world();
    const r = await pay(w, {
      preview: true,
      items: [{ playerId: w.playerIds[0]!, amount: 30000 }],
    });
    expect(r.total).toBe(30000);
    expect(
      await codeOf(
        pay(w, { preview: true, items: [{ playerId: w.playerIds[0]!, amount: 100001 }] }),
      ),
    ).toBe("ALLOCATION_EXCEEDS_FUNDS");
  });
});

describe("markPaid confirm", () => {
  it("cash, full balance: one ledger row (source cash, no bank txn, created_by host), charge paid, payment.settled", async () => {
    const w = await world();
    const r = await pay(w, { expectedTotal: 100000 });
    expect(r).toMatchObject({ preview: false, replayed: false, total: 100000 });
    const a = await fx.rows(`SELECT * FROM payment_allocations WHERE charge_id = $1`, [
      w.chargeIds[0],
    ]);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({
      source: "cash",
      amount: 100000,
      bank_transaction_id: null,
      created_by: w.actor,
      reason_code: null,
      reverses_allocation_id: null,
      tenant_id: w.tenantId,
    });
    expect(await charge(w.chargeIds[0]!)).toEqual({
      amount_due: 100000,
      amount_allocated: 100000,
      status: "paid",
    });
    const ev = (await fx.events(w.sessionId)).filter((e) => e.type === "payment.settled");
    expect(ev).toHaveLength(1);
    expect(ev[0].payload).toMatchObject({
      charge_id: w.chargeIds[0],
      allocation_id: a[0].id,
      amount: 100000,
      charge_status: "paid",
    });
  });

  it("host-attested transfer: source attested_transfer (NOT cash/manual), no bank_transaction, note kept", async () => {
    const w = await world();
    await pay(w, {
      method: "attested_transfer",
      note: "CK Vietcombank 12/10",
      expectedTotal: 100000,
    });
    expect(
      await fx.row(
        `SELECT source, bank_transaction_id, created_by, reason_code FROM payment_allocations WHERE charge_id = $1`,
        [w.chargeIds[0]],
      ),
    ).toEqual({
      source: "attested_transfer",
      bank_transaction_id: null,
      created_by: w.actor,
      reason_code: "CK Vietcombank 12/10",
    });
    expect(
      (
        await fx.row(`SELECT count(*)::int n FROM bank_transactions WHERE tenant_id = $1`, [
          w.tenantId,
        ])
      ).n,
    ).toBe(0);
  });

  it("partial then full: open -> partial -> paid, amount_allocated always equals the ledger sum", async () => {
    const w = await world();
    await pay(w, { items: [{ playerId: w.playerIds[0]!, amount: 40000 }], expectedTotal: 40000 });
    expect(await charge(w.chargeIds[0]!)).toMatchObject({
      amount_allocated: 40000,
      status: "partial",
    });
    const p = await pay(w, { preview: true });
    expect(p.lines[0]).toMatchObject({ effectiveBefore: 40000, remaining: 60000, amount: 60000 });
    await pay(w, { items: [{ playerId: w.playerIds[0]!, amount: 60000 }], expectedTotal: 60000 });
    expect(await charge(w.chargeIds[0]!)).toMatchObject({
      amount_allocated: 100000,
      status: "paid",
    });
    expect(await ledgerSum(w.chargeIds[0]!)).toBe(100000);
  });

  it("a batch pays many players under ONE commandId; replay returns the stored result and writes nothing", async () => {
    const w = await world({ players: 3 });
    const commandId = nextCommandId();
    const items = w.playerIds.map((playerId) => ({ playerId }));
    const first = await pay(w, { commandId, items, expectedTotal: 300000 });
    expect(first.lines).toHaveLength(3);
    expect(new Set(first.lines.map((l) => l.allocationId)).size).toBe(3);
    const before = await fx.counts(w.tenantId);
    const again = await pay(w, { commandId, items, expectedTotal: 300000 });
    expect(again).toMatchObject({ replayed: true, total: 300000 });
    expect(again.lines.map((l) => l.allocationId)).toEqual(first.lines.map((l) => l.allocationId));
    expect(await fx.counts(w.tenantId)).toEqual(before);
  });

  it("the batch is ATOMIC: one bad item (already paid) rolls the whole batch back", async () => {
    const w = await world();
    await pay(w, { items: [{ playerId: w.playerIds[1]! }], expectedTotal: 100000 });
    const before = await fx.counts(w.tenantId);
    expect(
      await codeOf(
        pay(w, { items: w.playerIds.map((playerId) => ({ playerId })), expectedTotal: 200000 }),
      ),
    ).toBe("CHARGE_ALREADY_SETTLED");
    expect(await fx.counts(w.tenantId)).toEqual(before);
    expect(await charge(w.chargeIds[0]!)).toMatchObject({ amount_allocated: 0, status: "open" });
  });

  it("over-allocation is ALLOCATION_EXCEEDS_FUNDS; a settled charge is CHARGE_ALREADY_SETTLED; nothing written", async () => {
    const w = await world();
    const before = await fx.counts(w.tenantId);
    expect(
      await codeOf(
        pay(w, { items: [{ playerId: w.playerIds[0]!, amount: 100001 }], expectedTotal: 100001 }),
      ),
    ).toBe("ALLOCATION_EXCEEDS_FUNDS");
    expect(await fx.counts(w.tenantId)).toEqual(before);
    await pay(w, { expectedTotal: 100000 });
    expect(await codeOf(pay(w, { expectedTotal: 100000 }))).toBe("CHARGE_ALREADY_SETTLED");
  });

  it("a stale/forged expectedTotal is MARK_PAID_TOTAL_MISMATCH (replaying a preview as another batch); missing is INVALID_INPUT", async () => {
    const w = await world();
    const before = await fx.counts(w.tenantId);
    expect(await codeOf(pay(w, { expectedTotal: 99999 }))).toBe("MARK_PAID_TOTAL_MISMATCH");
    expect(
      await codeOf(
        pay(w, { expectedTotal: 100000, items: w.playerIds.map((playerId) => ({ playerId })) }),
      ),
    ).toBe("MARK_PAID_TOTAL_MISMATCH");
    expect(await codeOf(pay(w, {}))).toBe("INVALID_INPUT");
    expect(await fx.counts(w.tenantId)).toEqual(before);
  });

  it("confirm REQUIRES an explicit amount on every item (preview may omit it); nothing is written", async () => {
    const w = await world();
    const before = await fx.counts(w.tenantId);
    expect(
      await codeOf(
        pay(w, { raw: true, items: [{ playerId: w.playerIds[0]! }], expectedTotal: 100000 }),
      ),
    ).toBe("INVALID_INPUT");
    expect(await fx.counts(w.tenantId)).toEqual(before);
  });

  it("a stale per-line split with the SAME total is refused per line (A was partly paid after the preview)", async () => {
    const w = await world();
    const items = w.playerIds.map((playerId) => ({ playerId, amount: 100000 }));
    const preview = await pay(w, { preview: true, items });
    expect(preview.total).toBe(200000);
    await pay(w, { items: [{ playerId: w.playerIds[0]!, amount: 40000 }], expectedTotal: 40000 });
    const before = await fx.counts(w.tenantId);
    // the UI resends the previewed lines and total; line A no longer fits its balance
    expect(await codeOf(pay(w, { items, expectedTotal: preview.total }))).toBe(
      "ALLOCATION_EXCEEDS_FUNDS",
    );
    expect(await fx.counts(w.tenantId)).toEqual(before);
  });

  it("a zero-price (already paid) charge is CHARGE_ALREADY_SETTLED", async () => {
    const w = await world({ priceAmount: 0, players: 1 });
    expect(await codeOf(pay(w, { expectedTotal: 1 }))).toBe("CHARGE_ALREADY_SETTLED");
  });

  it("hostile amounts and shapes are INVALID_INPUT with nothing written", async () => {
    const w = await world();
    const before = await fx.counts(w.tenantId);
    const p = w.playerIds[0]!;
    const bad: Partial<MarkPaidParams>[] = [
      { items: [{ playerId: p, amount: -5 }] },
      { items: [{ playerId: p, amount: 0 }] },
      { items: [{ playerId: p, amount: 10.5 }] },
      { items: [{ playerId: p, amount: Number.NaN }] },
      { items: [{ playerId: p, amount: Number.POSITIVE_INFINITY }] },
      { items: [{ playerId: p, amount: 2 ** 31 }] },
      { items: [] },
      { items: [{ playerId: "nope" }] },
      { items: [{ playerId: p }, { playerId: p.toUpperCase() }] },
      { method: "bank_transfer" as never },
      { method: "manual" as never },
      { note: "x".repeat(201) },
      { note: "" },
    ];
    for (const over of bad) {
      expect(await codeOf(pay(w, { expectedTotal: 100000, ...over })), JSON.stringify(over)).toBe(
        "INVALID_INPUT",
      );
    }
    expect(await fx.counts(w.tenantId)).toEqual(before);
  });

  it("unpayable targets: left player's void charge, waitlisted player (no charge), unknown id, ANOTHER tenant's player", async () => {
    const w = await world({ players: 2 });
    await removePlayerFromSession(ctx.appDb.db, {
      tenantId: w.tenantId,
      actorPersonId: w.actor,
      commandId: nextCommandId(),
      sessionId: w.sessionId,
      playerId: w.playerIds[1]!,
    });
    expect(await codeOf(pay(w, { items: [{ playerId: w.playerIds[1]! }], expectedTotal: 1 }))).toBe(
      "CHARGE_NOT_PAYABLE",
    );
    expect(await codeOf(pay(w, { items: [{ playerId: randomUUID() }], expectedTotal: 1 }))).toBe(
      "PLAYER_NOT_FOUND",
    );
    const full = await fx.seedSession(w.tenantId, { slotsMax: 1 });
    await addMemberToSession(ctx.appDb.db, {
      tenantId: w.tenantId,
      actorPersonId: w.actor,
      commandId: nextCommandId(),
      sessionId: full,
      member: { displayName: "A" },
      source: "host_add",
    });
    const waiting = await addMemberToSession(ctx.appDb.db, {
      tenantId: w.tenantId,
      actorPersonId: w.actor,
      commandId: nextCommandId(),
      sessionId: full,
      member: { displayName: "B" },
      source: "host_add",
    });
    expect(
      await codeOf(
        pay(w, { sessionId: full, items: [{ playerId: waiting.playerId }], expectedTotal: 1 }),
      ),
    ).toBe("CHARGE_NOT_PAYABLE"); // visible roster row without a charge (waitlisted), not "missing"
    const other = await world({ players: 1 });
    // other tenant's player id presented in MY session: no charge in this session -> PLAYER_NOT_FOUND
    expect(
      await codeOf(pay(w, { items: [{ playerId: other.playerIds[0]! }], expectedTotal: 1 })),
    ).toBe("PLAYER_NOT_FOUND");
  });

  it("RLS: tenant B can neither preview nor pay tenant A's session/charge; A's ledger is untouched", async () => {
    const a = await world({ players: 1 });
    const b = await world({ players: 1 });
    const asB = { tenantId: b.tenantId, actorPersonId: b.actor };
    expect(await codeOf(pay(a, { ...asB, preview: true }))).toBe("SESSION_NOT_FOUND");
    expect(await codeOf(pay(a, { ...asB, expectedTotal: 100000 }))).toBe("SESSION_NOT_FOUND");
    expect((await fx.counts(a.tenantId)).allocations).toBe(0);
    // and B's owner may not act on A as A (tenant context mismatch is a deny)
    expect(await codeOf(pay(a, { actorPersonId: b.actor, expectedTotal: 100000 }))).toBe(
      "FORBIDDEN",
    );
  });

  it("authorization: co_admin may mark paid (money.mark_paid is preset); stranger/inactive FORBIDDEN; suspended TENANT_SUSPENDED", async () => {
    const w = await world();
    const co = await fx.seedAdmin(w.tenantId, "co_admin");
    expect((await pay(w, { actorPersonId: co, expectedTotal: 100000 })).total).toBe(100000);
    const stranger = await fx.seedPerson();
    const inactive = await fx.seedAdmin(w.tenantId, "admin", false);
    for (const actorPersonId of [stranger, inactive]) {
      expect(await codeOf(pay(w, { actorPersonId, preview: true }))).toBe("FORBIDDEN");
    }
    await ctx.owner.query(`UPDATE tenants SET status = 'suspended' WHERE id = $1`, [w.tenantId]);
    expect(await codeOf(pay(w, { preview: true }))).toBe("TENANT_SUSPENDED");
  });

  it("COMMAND_ID_CONFLICT across sessions/actors; cancelled session takes no payment", async () => {
    const w = await world();
    const commandId = nextCommandId();
    await pay(w, { commandId, expectedTotal: 100000 });
    const co = await fx.seedAdmin(w.tenantId, "co_admin");
    expect(await codeOf(pay(w, { commandId, actorPersonId: co, expectedTotal: 100000 }))).toBe(
      "COMMAND_ID_CONFLICT",
    );
    expect(
      await codeOf(
        pay(w, { commandId, sessionId: await fx.seedSession(w.tenantId), expectedTotal: 100000 }),
      ),
    ).toBe("COMMAND_ID_CONFLICT");
    for (const status of ["cancelled", "draft"]) {
      await ctx.owner.query(`UPDATE sessions SET status = $2 WHERE id = $1`, [w.sessionId, status]);
      expect(
        await codeOf(pay(w, { items: [{ playerId: w.playerIds[1]! }], expectedTotal: 100000 })),
      ).toBe("SESSION_NOT_OPEN");
      expect(await codeOf(pay(w, { preview: true }))).toBe("SESSION_NOT_OPEN");
    }
  });

  it("applyEffective leaves a void charge void and untouched unless revive is explicit", async () => {
    const w = await world({ players: 1 });
    const [c] = await fx.rows(`SELECT id FROM charges WHERE player_id = $1`, [w.playerIds[0]!]);
    await ctx.owner.query(`UPDATE charges SET status = 'void' WHERE id = $1`, [c!.id]);
    await withTenant(ctx.appDb.db, w.tenantId, (tx) => applyEffective(tx, c!.id, 100000));
    expect(await charge(c!.id)).toMatchObject({ status: "void", amount_allocated: 0 });
    await withTenant(ctx.appDb.db, w.tenantId, (tx) =>
      applyEffective(tx, c!.id, 100000, { revive: true }),
    );
    expect((await charge(c!.id)).status).toBe("open");
  });

  it("a batch replayed with a different player set is refused; the same set replays", async () => {
    const w = await world();
    const commandId = nextCommandId();
    await pay(w, { commandId, expectedTotal: 100000 });
    expect(
      await codeOf(
        pay(w, { commandId, items: [{ playerId: w.playerIds[1]! }], expectedTotal: 100000 }),
      ),
    ).toBe("COMMAND_ID_CONFLICT");
    expect((await pay(w, { commandId, expectedTotal: 100000 })).replayed).toBe(true);
  });

  it("CONCURRENCY: two different commands paying the SAME charge in full -> one wins, invariant holds", async () => {
    const w = await world({ players: 1 });
    const results = await Promise.allSettled([
      pay(w, { expectedTotal: 100000 }),
      pay(w, { expectedTotal: 100000 }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const loser = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(["CHARGE_ALREADY_SETTLED", "MARK_PAID_TOTAL_MISMATCH"]).toContain(
      (loser.reason as RosterMoneyError).code,
    );
    expect(await charge(w.chargeIds[0]!)).toEqual({
      amount_due: 100000,
      amount_allocated: 100000,
      status: "paid",
    });
    expect(await ledgerSum(w.chargeIds[0]!)).toBe(100000);
  });

  it("CONCURRENCY: partial payments racing never exceed the due (6 x 30000 vs due 100000 -> exactly 3 succeed)", async () => {
    const w = await world({ players: 1 });
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        pay(w, { items: [{ playerId: w.playerIds[0]!, amount: 30000 }], expectedTotal: 30000 }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(3);
    const eff = await ledgerSum(w.chargeIds[0]!);
    expect(eff).toBe(90000);
    expect(await charge(w.chargeIds[0]!)).toMatchObject({
      amount_allocated: 90000,
      status: "partial",
    });
  });
});

describe("reversePaymentAllocation", () => {
  const reverse = (
    w: World,
    allocationId: string,
    over: Partial<Parameters<typeof reversePaymentAllocation>[1]> = {},
  ) =>
    reversePaymentAllocation(ctx.appDb.db, {
      tenantId: w.tenantId,
      actorPersonId: w.actor,
      commandId: nextCommandId(),
      sessionId: w.sessionId,
      allocationId,
      reason: "recorded by mistake",
      ...over,
    });
  async function paid(w: World, amount = 100000) {
    const r = await pay(w, {
      items: [{ playerId: w.playerIds[0]!, amount }],
      expectedTotal: amount,
    });
    return r.lines[0]!.allocationId as string;
  }

  it("reverses the remaining effective amount: negative row pointing at the original, charge back to open, payment.reversed", async () => {
    const w = await world();
    const allocationId = await paid(w);
    const r = await reverse(w, allocationId);
    expect(r).toMatchObject({
      allocationId,
      chargeId: w.chargeIds[0],
      amount: -100000,
      status: "open",
      replayed: false,
    });
    expect(
      await fx.row(
        `SELECT source, amount, reverses_allocation_id, created_by, reason_code FROM payment_allocations WHERE id = $1`,
        [r.reversalId],
      ),
    ).toEqual({
      source: "reversal",
      amount: -100000,
      reverses_allocation_id: allocationId,
      created_by: w.actor,
      reason_code: "recorded by mistake",
    });
    expect(await charge(w.chargeIds[0]!)).toEqual({
      amount_due: 100000,
      amount_allocated: 0,
      status: "open",
    });
    expect((await fx.events(w.sessionId)).map((e) => e.type)).toContain("payment.reversed");
    // the append-only original row is untouched
    expect(
      (await fx.row(`SELECT amount FROM payment_allocations WHERE id = $1`, [allocationId])).amount,
    ).toBe(100000);
  });

  it("partial: reversing one of two payments leaves the other effective (paid -> partial)", async () => {
    const w = await world();
    const a1 = await paid(w, 40000);
    await paid(w, 60000);
    expect(await charge(w.chargeIds[0]!)).toMatchObject({ status: "paid" });
    const r = await reverse(w, a1);
    expect(r).toMatchObject({ amount: -40000, status: "partial" });
    expect(await charge(w.chargeIds[0]!)).toMatchObject({
      amount_allocated: 60000,
      status: "partial",
    });
  });

  it("a second reversal of the same allocation, and a reversal of a reversal, are refused: EXCEEDS_EFFECTIVE / NOT_SUPPORTED", async () => {
    const w = await world();
    const allocationId = await paid(w);
    const r = await reverse(w, allocationId);
    const before = await fx.counts(w.tenantId);
    expect(await codeOf(reverse(w, allocationId))).toBe("REVERSAL_EXCEEDS_EFFECTIVE");
    expect(await codeOf(reverse(w, r.reversalId))).toBe("REVERSAL_NOT_SUPPORTED");
    expect(await fx.counts(w.tenantId)).toEqual(before);
  });

  it("replay returns the stored reversal; the key reused for another allocation is COMMAND_ID_CONFLICT", async () => {
    const w = await world();
    const a1 = await paid(w, 50000);
    const a2 = await paid(w, 50000);
    const commandId = nextCommandId();
    const first = await reverse(w, a1, { commandId });
    const before = await fx.counts(w.tenantId);
    expect(await reverse(w, a1, { commandId })).toMatchObject({
      reversalId: first.reversalId,
      replayed: true,
    });
    expect(await fx.counts(w.tenantId)).toEqual(before);
    // the key is bound to its target allocation: reusing it for a2 must NOT read as success.
    expect(await codeOf(reverse(w, a2, { commandId }))).toBe("COMMAND_ID_CONFLICT");
    expect(await charge(w.chargeIds[0]!)).toMatchObject({ amount_allocated: 50000 });
  });

  it("money.correct is owner-grantable: a co_admin WITHOUT a grant is FORBIDDEN; the owner is allowed", async () => {
    const w = await world();
    const allocationId = await paid(w);
    const co = await fx.seedAdmin(w.tenantId, "co_admin");
    expect(await codeOf(reverse(w, allocationId, { actorPersonId: co }))).toBe("FORBIDDEN");
    expect(
      (
        await fx.row(`SELECT count(*)::int n FROM payment_allocations WHERE charge_id = $1`, [
          w.chargeIds[0],
        ])
      ).n,
    ).toBe(1);
    expect((await reverse(w, allocationId)).amount).toBe(-100000);
  });

  it("another tenant's allocation (and a foreign session id, malformed ids) are ALLOCATION_NOT_FOUND/SESSION_NOT_FOUND", async () => {
    const a = await world({ players: 1 });
    const b = await world({ players: 1 });
    const allocationId = await paid(a);
    expect(await codeOf(reverse(b, allocationId))).toBe("ALLOCATION_NOT_FOUND");
    expect(await codeOf(reverse(a, allocationId, { sessionId: b.sessionId }))).toBe(
      "SESSION_NOT_FOUND",
    );
    expect(await codeOf(reverse(a, "nope"))).toBe("ALLOCATION_NOT_FOUND");
    expect(await codeOf(reverse(a, allocationId, { sessionId: "nope" }))).toBe("SESSION_NOT_FOUND");
    expect(await codeOf(reverse(a, allocationId, { reason: "" }))).toBe("INVALID_INPUT");
    expect(await codeOf(reverse(a, allocationId, { reason: "x".repeat(201) }))).toBe(
      "INVALID_INPUT",
    );
  });

  it("an allocation of ANOTHER session of the same tenant cannot be reversed through this session", async () => {
    const w = await world({ players: 1 });
    const allocationId = await paid(w);
    const otherSession = await fx.seedSession(w.tenantId);
    expect(await codeOf(reverse(w, allocationId, { sessionId: otherSession }))).toBe(
      "ALLOCATION_NOT_FOUND",
    );
  });

  it("bank-bound sources (auto/manual/waiver) are REVERSAL_NOT_SUPPORTED here", async () => {
    const w = await world({ players: 1 });
    const { rows } = await ctx.owner.query(
      `INSERT INTO payment_allocations (tenant_id, charge_id, amount, source, created_by) VALUES ($1,$2,500,'waiver',$3) RETURNING id`,
      [w.tenantId, w.chargeIds[0], w.actor],
    );
    await ctx.owner.query(
      `UPDATE charges SET amount_allocated = 500, status = 'partial' WHERE id = $1`,
      [w.chargeIds[0]],
    );
    expect(await codeOf(reverse(w, (rows[0] as { id: string }).id))).toBe("REVERSAL_NOT_SUPPORTED");
  });

  it("racing reversals of one allocation: exactly one wins", async () => {
    const w = await world({ players: 1 });
    const allocationId = await paid(w);
    const results = await Promise.allSettled([reverse(w, allocationId), reverse(w, allocationId)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await ledgerSum(w.chargeIds[0]!)).toBe(0);
  });

  it("a paid-then-reversed player can now be removed (effective 0) and the charge goes void", async () => {
    const w = await world({ players: 1 });
    await reverse(w, await paid(w));
    await removePlayerFromSession(ctx.appDb.db, {
      tenantId: w.tenantId,
      actorPersonId: w.actor,
      commandId: nextCommandId(),
      sessionId: w.sessionId,
      playerId: w.playerIds[0]!,
    });
    expect(await charge(w.chargeIds[0]!)).toMatchObject({ status: "void", amount_allocated: 0 });
  });
});

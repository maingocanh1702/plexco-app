import { and, eq, sql } from "drizzle-orm";
import { charges, paymentAllocations } from "../schema.js";
import type { Db } from "./client.js";
import { applyEffective, lockSession, type ChargeStatus } from "./payment-manual.js";
import {
  NOTE_MAX,
  UUID_RE,
  emitSessionEvent,
  fail,
  isBoundedText,
  recordCommand,
  replayOrNull,
  requireActor,
} from "./roster-money-shared.js";
import { withTenant } from "./tenant.js";

/**
 * Reversal of a mistaken manual payment: append a NEGATIVE `reversal` row pointing at the positive
 * allocation (same tenant AND same charge, enforced by 0039's composite FK), then re-derive the
 * charge through applyEffective. Lock order: authorize -> command dedup -> session -> charge ->
 * allocation. A reversal row cannot be reversed; an allocation can be reversed only for its remaining
 * effective amount (so two reversals can never exceed it).
 */
const REVERSE_TYPE = "ReversePaymentAllocation";
/** Limited to the host-recorded sources: reversing a bank-bound allocation must also restore
 *  bank_transactions.unallocated_amount, which belongs to the (unbuilt) reconcile engine. */
const REVERSIBLE_SOURCES: readonly string[] = ["cash", "attested_transfer"];

export interface ReversePaymentParams {
  tenantId: string;
  actorPersonId: string;
  commandId: string;
  sessionId: string;
  allocationId: string;
  reason: string;
}
export interface ReversePaymentResult {
  reversalId: string;
  allocationId: string;
  chargeId: string;
  amount: number; // negative
  status: ChargeStatus;
  replayed: boolean;
}
interface StoredReverse extends Omit<ReversePaymentResult, "replayed"> {
  sessionId: string;
  actorPersonId: string;
}
const isStoredReverse = (v: unknown): v is StoredReverse => {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.sessionId === "string" &&
    typeof r.actorPersonId === "string" &&
    typeof r.reversalId === "string" &&
    typeof r.allocationId === "string" &&
    typeof r.chargeId === "string" &&
    typeof r.amount === "number" &&
    typeof r.status === "string"
  );
};

/** money.correct is owner-grantable (DD-56): an admin/co_admin needs a current explicit grant. */
const REVERSE_ACTIONS = ["session.manage", "money.correct"] as const;

export async function reversePaymentAllocation(
  db: Db,
  params: ReversePaymentParams,
): Promise<ReversePaymentResult> {
  const { tenantId, commandId } = params;
  return withTenant(db, tenantId, async (tx) => {
    const actor = await requireActor(
      tx,
      tenantId,
      params.actorPersonId,
      REVERSE_ACTIONS,
      "mark_paid",
    );
    if (typeof params.sessionId !== "string" || !UUID_RE.test(params.sessionId)) {
      return fail("SESSION_NOT_FOUND", "session not found in tenant context");
    }
    const sessionId = params.sessionId.toLowerCase();
    const stored = await replayOrNull(
      tx,
      tenantId,
      commandId,
      REVERSE_TYPE,
      sessionId,
      actor,
      isStoredReverse,
    );
    if (stored !== null) {
      // The key is also bound to its TARGET (an id, not request content -- DD-117 D5 forbids
      // fingerprinting content): reusing it for a different allocation must not read as success.
      if (stored.allocationId !== String(params.allocationId).toLowerCase()) {
        return fail("COMMAND_ID_CONFLICT", "command_id belongs to a different allocation");
      }
      const { sessionId: _s, actorPersonId: _a, ...rest } = stored;
      return { ...rest, replayed: true };
    }
    if (typeof params.allocationId !== "string" || !UUID_RE.test(params.allocationId)) {
      return fail("NOT_FOUND", "allocation not found in tenant context");
    }
    if (!isBoundedText(params.reason, 1, NOTE_MAX)) {
      return fail("INVALID_INPUT", `reason must be 1..${NOTE_MAX} characters`);
    }
    const allocationId = params.allocationId.toLowerCase();

    await lockSession(tx, sessionId);
    // Charge id is immutable on an append-only row, so reading it before the charge lock is safe.
    const [probe] = await tx
      .select({ chargeId: paymentAllocations.chargeId })
      .from(paymentAllocations)
      .innerJoin(charges, eq(charges.id, paymentAllocations.chargeId))
      .where(and(eq(paymentAllocations.id, allocationId), eq(charges.sessionId, sessionId)));
    if (probe === undefined) return fail("NOT_FOUND", "allocation not found in this session");

    const [charge] = await tx
      .select({ id: charges.id, amountDue: charges.amountDue })
      .from(charges)
      .where(eq(charges.id, probe.chargeId))
      .for("update");
    const [alloc] = await tx
      .select({
        id: paymentAllocations.id,
        amount: paymentAllocations.amount,
        source: paymentAllocations.source,
      })
      .from(paymentAllocations)
      .where(eq(paymentAllocations.id, allocationId))
      .for("update");
    if (charge === undefined || alloc === undefined)
      return fail("NOT_FOUND", "allocation not found in this session");
    if (alloc.amount <= 0)
      return fail("REVERSAL_EXCEEDS_EFFECTIVE", "a reversal row cannot itself be reversed");
    if (!REVERSIBLE_SOURCES.includes(alloc.source)) {
      return fail("REVERSAL_NOT_SUPPORTED", "only host-recorded payments can be reversed here");
    }
    const [reversed] = await tx
      .select({ n: sql<number>`coalesce(sum(${paymentAllocations.amount}), 0)::int` })
      .from(paymentAllocations)
      .where(eq(paymentAllocations.reversesAllocationId, allocationId));
    const remaining = alloc.amount + Number(reversed!.n); // reversal rows are negative
    if (remaining <= 0)
      return fail("REVERSAL_EXCEEDS_EFFECTIVE", "allocation is already fully reversed");

    const [row] = await tx
      .insert(paymentAllocations)
      .values({
        tenantId,
        chargeId: charge.id,
        amount: -remaining,
        source: "reversal",
        reversesAllocationId: allocationId,
        createdBy: actor,
        reasonCode: params.reason,
      })
      .returning({ id: paymentAllocations.id });
    const derived = await applyEffective(tx, charge.id, charge.amountDue);
    await emitSessionEvent(tx, tenantId, sessionId, "payment.reversed", {
      session_id: sessionId,
      charge_id: charge.id,
      allocation_id: allocationId,
      reversal_id: row!.id,
      amount: -remaining,
      charge_status: derived.status,
    });
    const result: StoredReverse = {
      sessionId,
      actorPersonId: actor,
      reversalId: row!.id,
      allocationId,
      chargeId: charge.id,
      amount: -remaining,
      status: derived.status,
    };
    await recordCommand(tx, tenantId, commandId, REVERSE_TYPE, result);
    return {
      reversalId: result.reversalId,
      allocationId,
      chargeId: charge.id,
      amount: result.amount,
      status: result.status,
      replayed: false,
    };
  });
}

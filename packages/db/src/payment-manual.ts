import { and, asc, eq, inArray } from "drizzle-orm";
import { charges, paymentAllocations, players, sessions } from "../schema.js";
import type { Db, Tx } from "./client.js";
import {
  INT4_MAX,
  NOTE_MAX,
  UUID_RE,
  effectiveByCharge,
  emitSessionEvent,
  fail,
  isBoundedText,
  isPositiveInt4,
  isUuid,
  requireCommandId,
  recordCommand,
  replayOrNull,
  requireActor,
} from "./roster-money-shared.js";
import { withTenant } from "./tenant.js";

/**
 * Manual mark-paid (DD-40) and allocation reversal -- the ONLY writers of payment_allocations from a
 * human actor. Every payment is an INSERT into the append-only ledger (never an UPDATE); a mistake is
 * corrected by a NEGATIVE reversal row. `charges.amount_allocated` / `status` are DERIVED from the
 * ledger by ONE helper (chargeStatusFor + applyEffective below, INV-7): no other call site computes
 * a charge's paid state.
 *
 * (reversePaymentAllocation lives in payment-reversal.ts.)
 *
 * Methods: 'cash' -> source 'cash'; 'attested_transfer' -> source 'attested_transfer' (0050). Both
 * carry bank_transaction_id NULL and created_by = the host. Mapping a host-attested transfer to
 * 'cash'/'manual', or minting a synthetic bank_transaction, is forbidden by DD-40 / BRD FR-5.1.
 *
 * LOCK ORDER (same as the roster path): authorize (FOR SHARE locks) -> command advisory lock + dedup
 * -> session FOR UPDATE -> charges FOR UPDATE in UUID order -> allocation rows. The session lock
 * already serializes two host commands on one session; the per-charge lock is defence in depth for a
 * future writer (bank reconcile) that does not take the session lock.
 */

export type ManualPaymentMethod = "cash" | "attested_transfer";
const METHODS: readonly ManualPaymentMethod[] = ["cash", "attested_transfer"];
const MAX_ITEMS = 200;
const MARK_PAID_TYPE = "MarkPaid";

export type ChargeStatus = "open" | "partial" | "paid";

/** THE canonical derived state of a (non-void) charge. due 0 is `paid` (a free session). */
export function chargeStatusFor(amountDue: number, effectiveAllocated: number): ChargeStatus {
  if (effectiveAllocated >= amountDue) return "paid";
  if (effectiveAllocated <= 0) return "open";
  return "partial";
}

/** THE single writer of charges.amount_allocated/status: recomputes from the ledger and fails
 *  closed (internal fault, never a client code) if the ledger ever leaves [0, amount_due]. */
export async function applyEffective(
  tx: Tx,
  chargeId: string,
  amountDue: number,
): Promise<{ effective: number; status: ChargeStatus }> {
  const effective = (await effectiveByCharge(tx, [chargeId])).get(chargeId) ?? 0;
  if (effective < 0 || effective > amountDue) {
    throw new Error(`ledger invariant violated for charge ${chargeId}: effective ${effective}`);
  }
  const status = chargeStatusFor(amountDue, effective);
  await tx
    .update(charges)
    .set({ amountAllocated: effective, status })
    .where(eq(charges.id, chargeId));
  return { effective, status };
}

export interface MarkPaidItemInput {
  playerId: string;
  /** Absent = pay the whole remaining balance. */
  amount?: number;
}
export interface MarkPaidParams {
  tenantId: string;
  actorPersonId: string;
  /** Required for confirm; a preview consumes no command key. */
  commandId?: string;
  sessionId: string;
  method: ManualPaymentMethod;
  items: MarkPaidItemInput[];
  note?: string;
  preview: boolean;
  /** Confirm only: must equal the server total the preview showed. */
  expectedTotal?: number;
}
export interface MarkPaidLine {
  playerId: string;
  chargeId: string;
  amountDue: number;
  effectiveBefore: number;
  remaining: number;
  amount: number;
  allocationId?: string;
  status?: ChargeStatus;
}
export interface MarkPaidResult {
  preview: boolean;
  replayed: boolean;
  method: ManualPaymentMethod;
  total: number;
  lines: MarkPaidLine[];
}
interface StoredMarkPaid {
  sessionId: string;
  actorPersonId: string;
  method: ManualPaymentMethod;
  total: number;
  lines: MarkPaidLine[];
}
const isStoredMarkPaid = (v: unknown): v is StoredMarkPaid => {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    isUuid(r.sessionId) &&
    isUuid(r.actorPersonId) &&
    typeof r.total === "number" &&
    METHODS.includes(r.method as ManualPaymentMethod) &&
    Array.isArray(r.lines)
  );
};

/** `confirm` requires an explicit per-line amount: the confirmed lines are exactly what the host saw
 *  in the preview (which returns per-line amounts for the UI to resend), so a balance that changed
 *  in between fails per line instead of silently re-splitting the same total. */
function validateItems(params: MarkPaidParams, confirm: boolean): void {
  const { items, method, note } = params;
  if (!METHODS.includes(method)) fail("INVALID_INPUT", "unknown payment method");
  if (!Array.isArray(items) || items.length < 1 || items.length > MAX_ITEMS) {
    fail("INVALID_INPUT", `items must hold 1..${MAX_ITEMS} entries`);
  }
  const seen = new Set<string>();
  for (const item of items) {
    if (typeof item !== "object" || item === null) fail("INVALID_INPUT", "malformed item");
    if (typeof item.playerId !== "string" || !UUID_RE.test(item.playerId)) {
      fail("INVALID_INPUT", "playerId must be a UUID");
    }
    const key = item.playerId.toLowerCase();
    if (seen.has(key)) fail("INVALID_INPUT", "duplicate playerId in one batch");
    seen.add(key);
    if (confirm && item.amount === undefined) {
      fail("INVALID_INPUT", "confirm requires an explicit amount on every item");
    }
    if (item.amount !== undefined && !isPositiveInt4(item.amount)) {
      fail("INVALID_INPUT", "amount must be a positive integer");
    }
  }
  if (note !== undefined && !isBoundedText(note, 1, NOTE_MAX)) {
    fail("INVALID_INPUT", `note must be 1..${NOTE_MAX} characters`);
  }
}

/** Locks the batch's charges (UUID order) and computes every line under that lock. */
async function planLines(tx: Tx, sessionId: string, params: MarkPaidParams, lock: boolean) {
  const ids = params.items.map((i) => i.playerId.toLowerCase());
  // FROM players LEFT JOIN charges: a visible roster row WITHOUT a charge (waitlisted) is a payable-
  // state problem (CHARGE_NOT_PAYABLE), not a missing player. NULLs sort last, so charges still lock
  // in UUID order.
  const query = tx
    .select({
      chargeId: charges.id,
      playerId: players.id,
      amountDue: charges.amountDue,
      chargeStatus: charges.status,
      playerStatus: players.status,
    })
    .from(players)
    .leftJoin(
      charges,
      and(eq(charges.playerId, players.id), eq(charges.sessionId, players.sessionId)),
    )
    .where(and(eq(players.sessionId, sessionId), inArray(players.id, ids)))
    .orderBy(asc(charges.id));
  if (lock) {
    // FOR UPDATE cannot apply to the nullable side of an outer join, so the charges are locked by
    // their own statement (UUID order) BEFORE the read that computes the lines.
    await tx
      .select({ id: charges.id })
      .from(charges)
      .where(and(eq(charges.sessionId, sessionId), inArray(charges.playerId, ids)))
      .orderBy(asc(charges.id))
      .for("update");
  }
  const found = await query;
  const byPlayer = new Map(found.map((c) => [c.playerId, c]));
  const effective = await effectiveByCharge(
    tx,
    found.flatMap((c) => (c.chargeId === null ? [] : [c.chargeId])),
  );
  let total = 0;
  const lines: MarkPaidLine[] = params.items.map((item) => {
    const charge = byPlayer.get(item.playerId.toLowerCase());
    if (charge === undefined) return fail("PLAYER_NOT_FOUND", "player not found in this session");
    if (
      charge.chargeId === null ||
      charge.amountDue === null ||
      charge.playerStatus !== "active" ||
      charge.chargeStatus === "void"
    ) {
      return fail("CHARGE_NOT_PAYABLE", "only an active player's open charge can be paid");
    }
    const before = effective.get(charge.chargeId) ?? 0;
    const remaining = charge.amountDue - before;
    if (remaining <= 0) return fail("CHARGE_ALREADY_SETTLED", "charge is already fully paid");
    const amount = item.amount ?? remaining;
    if (amount > remaining) return fail("ALLOCATION_EXCEEDS_FUNDS", "amount exceeds the balance");
    total += amount;
    return {
      playerId: charge.playerId,
      chargeId: charge.chargeId,
      amountDue: charge.amountDue,
      effectiveBefore: before,
      remaining,
      amount,
    };
  });
  if (total > INT4_MAX) fail("INVALID_INPUT", "batch total is out of range");
  return { lines, total };
}

export async function lockSession(tx: Tx, sessionId: string): Promise<void> {
  const [row] = await tx
    .select({ status: sessions.status })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .for("update");
  // RLS hides another tenant's session, so this is also the cross-tenant answer (404, not 403).
  if (row === undefined) fail("SESSION_NOT_FOUND", "session not found in tenant context");
  if (row!.status === "cancelled")
    fail("SESSION_NOT_OPEN", "a cancelled session takes no payments");
}

const ACTIONS = ["session.manage", "money.mark_paid"] as const;

/**
 * Preview (preview: true) is READ-ONLY: authorizes, computes the per-player remaining balance and the
 * server total, writes nothing and consumes no commandId. Confirm re-computes under lock and requires
 * `expectedTotal` to equal the fresh total (a stale preview -> MARK_PAID_TOTAL_MISMATCH, nothing
 * written). One commandId covers the whole batch; a retry returns the stored result.
 */
export async function markPaid(db: Db, params: MarkPaidParams): Promise<MarkPaidResult> {
  const { tenantId, commandId } = params;
  return withTenant(db, tenantId, async (tx) => {
    const actor = await requireActor(tx, tenantId, params.actorPersonId, ACTIONS, "mark_paid");

    if (typeof params.sessionId !== "string" || !UUID_RE.test(params.sessionId)) {
      return fail("SESSION_NOT_FOUND", "session not found in tenant context");
    }
    const sessionId = params.sessionId.toLowerCase();

    if (params.preview) {
      validateItems(params, false);
      const [s] = await tx
        .select({ status: sessions.status })
        .from(sessions)
        .where(eq(sessions.id, sessionId));
      if (s === undefined) return fail("SESSION_NOT_FOUND", "session not found in tenant context");
      if (s.status === "cancelled")
        return fail("SESSION_NOT_OPEN", "a cancelled session takes no payments");
      const plan = await planLines(tx, sessionId, params, false);
      return { preview: true, replayed: false, method: params.method, ...plan };
    }

    const commandKey = requireCommandId(commandId);
    const stored = await replayOrNull(
      tx,
      tenantId,
      commandKey,
      MARK_PAID_TYPE,
      sessionId,
      actor,
      isStoredMarkPaid,
    );
    if (stored !== null) {
      return {
        preview: false,
        replayed: true,
        method: stored.method,
        total: stored.total,
        lines: stored.lines,
      };
    }
    validateItems(params, true);
    if (!isPositiveInt4(params.expectedTotal)) {
      return fail("INVALID_INPUT", "expectedTotal (from the preview) is required");
    }

    await lockSession(tx, sessionId);
    const plan = await planLines(tx, sessionId, params, true);
    if (plan.total !== params.expectedTotal) {
      return fail("MARK_PAID_TOTAL_MISMATCH", "the balance changed since the preview");
    }

    // ponytail: 4 statements per line (insert, recompute, charge update, outbox); 200 items max
    // (MAX_ITEMS) keeps a confirm well inside the transaction budget. Batch the inserts if the cap
    // is ever raised.
    const lines: MarkPaidLine[] = [];
    for (const line of plan.lines) {
      const [alloc] = await tx
        .insert(paymentAllocations)
        .values({
          tenantId,
          chargeId: line.chargeId,
          amount: line.amount,
          source: params.method,
          bankTransactionId: null,
          createdBy: actor,
          // The method is already the row's `source`; reason_code carries ONLY the host's note.
          reasonCode: params.note ?? null,
        })
        .returning({ id: paymentAllocations.id });
      const derived = await applyEffective(tx, line.chargeId, line.amountDue);
      await emitSessionEvent(tx, tenantId, sessionId, "payment.settled", {
        session_id: sessionId,
        player_id: line.playerId,
        charge_id: line.chargeId,
        allocation_id: alloc!.id,
        amount: line.amount,
        source: params.method,
        charge_status: derived.status,
      });
      lines.push({ ...line, allocationId: alloc!.id, status: derived.status });
    }
    const result: StoredMarkPaid = {
      sessionId,
      actorPersonId: actor,
      method: params.method,
      total: plan.total,
      lines,
    };
    await recordCommand(tx, tenantId, commandKey, MARK_PAID_TYPE, result);
    return { preview: false, replayed: false, method: params.method, total: plan.total, lines };
  });
}

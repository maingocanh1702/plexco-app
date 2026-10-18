import { inArray, sql } from "drizzle-orm";
import { outboxEvents, paymentAllocations, processedCommands } from "../schema.js";
import { authorizeTenantAction, type ActionClass } from "./authorization.js";
import type { Tx } from "./client.js";
import { nextOutboxSequence, reserveGuestNoteCommand } from "./session-service.js";
import { authorize } from "./tenant-capability-authority.js";

/**
 * Shared plumbing for the two host money/roster command modules (roster-service.ts,
 * payment-manual.ts): ONE error class, ONE actor gate, ONE dedup contract, ONE outbox writer, so the
 * two modules cannot drift on any of them.
 */

export type RosterMoneyErrorCode =
  | "FORBIDDEN" // authorize() denied the actor (cross-tenant, not an admin, missing grant)
  | "TENANT_SUSPENDED"
  | "SESSION_NOT_FOUND"
  | "SESSION_NOT_OPEN"
  | "PLAYER_NOT_FOUND"
  | "ALLOCATION_NOT_FOUND" // allocation not found in this session/tenant
  | "ALREADY_JOINED"
  | "REJOIN_REQUIRES_REVIEW"
  | "REMOVE_REQUIRES_REVIEW"
  // Player self-join (M9, readiness p3-m9-join-core 4.6):
  | "SESSION_NOT_JOINABLE" // not open, started, or private for a caller who is not an active member
  | "LEAVE_REQUIRES_HOST" // self-leave refused: net money != 0, after start, or the session is not open
  | "JOIN_REQUEST_NOT_FOUND" // unknown, foreign or not-own join request id (one answer)
  | "REQUEST_DECIDED" // the join request is no longer pending
  | "REQUEST_EXPIRED" // the pending join request passed its expiry
  | "CHARGE_NOT_PAYABLE"
  | "CHARGE_ALREADY_SETTLED"
  | "ALLOCATION_EXCEEDS_FUNDS"
  | "MARK_PAID_TOTAL_MISMATCH"
  | "REVERSAL_EXCEEDS_EFFECTIVE"
  | "REVERSAL_NOT_SUPPORTED"
  | "INVALID_INPUT"
  | "COMMAND_ID_CONFLICT"
  // Gender pricing (DD-39, readiness p3-m9-gender-pricing 4.4 / 4.10):
  | "CHARGE_DERIVATION_UNAVAILABLE" // a stored gender could not be opened: no charge, no fallback price
  | "GENDER_FORBIDDEN"; // the derivation definer refused the context (defect path, the tx aborts)

export class RosterMoneyError extends Error {
  readonly code: RosterMoneyErrorCode;
  constructor(code: RosterMoneyErrorCode, message: string) {
    super(message);
    this.name = "RosterMoneyError";
    this.code = code;
  }
}

export const fail = (code: RosterMoneyErrorCode, message: string): never => {
  throw new RosterMoneyError(code, message);
};

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const INT4_MAX = 2_147_483_647;
export const NOTE_MAX = 200;
export const DISPLAY_NAME_MAX = 100;

export const isPositiveInt4 = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= INT4_MAX;

/** Text PostgreSQL can store (no NUL, no unpaired surrogate) within `max` code points. */
export function isBoundedText(v: unknown, min: number, max: number): v is string {
  if (typeof v !== "string") return false;
  const points = [...v];
  if (points.length < min || points.length > max) return false;
  for (let i = 0; i < v.length; i += 1) {
    const c = v.charCodeAt(i);
    if (c === 0) return false;
    if (c >= 0xd800 && c <= 0xdbff) {
      const low = v.charCodeAt(i + 1);
      if (!(low >= 0xdc00 && low <= 0xdfff)) return false;
      i += 1;
    } else if (c >= 0xdc00 && c <= 0xdfff) return false;
  }
  return true;
}

/**
 * Actor gate, run FIRST inside the command transaction (actor recheck under lock): every named
 * capability via authorize() (the FOR SHARE locked DD-56 primitive), then the tenant status axis.
 * Authorization precedes dedup so an unauthorized caller can never read a stored result.
 */
export async function requireActor(
  tx: Tx,
  tenantId: string,
  actorPersonId: unknown,
  actions: readonly string[],
  tenantAction: ActionClass,
): Promise<string> {
  if (typeof actorPersonId !== "string" || !UUID_RE.test(actorPersonId)) {
    return fail("FORBIDDEN", "actor is not authorized");
  }
  for (const action of actions) {
    const decision = await authorize(tx, { tenantId, action, actorPersonId });
    if (!decision.allowed) return fail("FORBIDDEN", "actor is not authorized");
  }
  const tenantDecision = await authorizeTenantAction(tx, tenantId, tenantAction);
  if (!tenantDecision.allowed) return fail("TENANT_SUSPENDED", "tenant is not permitted");
  return actorPersonId.toLowerCase();
}

export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

/** The command key, validated once; callers keep the returned string instead of re-casting. */
export function requireCommandId(commandId: unknown): string {
  if (typeof commandId !== "string" || commandId.length === 0) {
    return fail("INVALID_INPUT", "commandId is required");
  }
  return commandId;
}

/**
 * Dedup (DD-117 D5: commandId-only). Returns the stored result for a legitimate replay (same
 * command type, session and actor), null for a fresh key, and throws COMMAND_ID_CONFLICT for any
 * other use of an owned key (which also tells the caller nothing about the stored result).
 */
export async function replayOrNull<T extends { sessionId: string; actorPersonId: string }>(
  tx: Tx,
  tenantId: string,
  commandId: string,
  commandType: string,
  sessionId: string,
  actorPersonId: string,
  isStored: (value: unknown) => value is T,
): Promise<T | null> {
  const prior = await reserveGuestNoteCommand(tx, tenantId, commandId);
  if (prior === null) return null;
  if (
    prior.commandType === commandType &&
    isStored(prior.stored) &&
    prior.stored.sessionId === sessionId &&
    prior.stored.actorPersonId === actorPersonId
  ) {
    return prior.stored;
  }
  return fail(
    "COMMAND_ID_CONFLICT",
    "command_id belongs to a different command, session or actor, or has no usable result",
  );
}

export async function recordCommand(
  tx: Tx,
  tenantId: string,
  commandId: string,
  commandType: string,
  result: object,
): Promise<void> {
  await tx
    .insert(processedCommands)
    .values({ tenantId, commandId, commandType, resultRef: result });
}

/** One outbox row on the session aggregate. Payloads carry ids and amounts only -- no PII. */
export async function emitSessionEvent(
  tx: Tx,
  tenantId: string,
  sessionId: string,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await tx.insert(outboxEvents).values({
    tenantId,
    aggregateType: "session",
    aggregateId: sessionId,
    sequence: nextOutboxSequence(sessionId),
    type,
    payload,
  });
}

/** Effective allocated amount per charge: reversals are negative rows, so it is a plain SUM. */
export async function effectiveByCharge(
  tx: Tx,
  chargeIds: readonly string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>(chargeIds.map((id) => [id, 0]));
  if (chargeIds.length === 0) return out;
  const rows = await tx
    .select({
      chargeId: paymentAllocations.chargeId,
      effective: sql<number>`coalesce(sum(${paymentAllocations.amount}), 0)::int`,
    })
    .from(paymentAllocations)
    .where(inArray(paymentAllocations.chargeId, [...chargeIds]))
    .groupBy(paymentAllocations.chargeId);
  for (const r of rows) out.set(r.chargeId, Number(r.effective));
  return out;
}

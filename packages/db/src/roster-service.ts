import { and, eq, sql } from "drizzle-orm";
import { charges, memberships, players, sessions } from "../schema.js";
import { deriveChargeAmount } from "./charge-derivation.js";
import type { Db, Tx } from "./client.js";
import { applyEffective, chargeStatusFor } from "./payment-manual.js";
import {
  DISPLAY_NAME_MAX,
  UUID_RE,
  effectiveByCharge,
  emitSessionEvent,
  fail,
  isBoundedText,
  isUuid,
  requireCommandId,
  recordCommand,
  replayOrNull,
  requireActor,
} from "./roster-money-shared.js";
// Call-time-only cycle (P-19): session-join-service.ts imports seatPlayer/upsertCharge from here.
import { closePendingJoinRequestOnExit } from "./join-request-service.js";
import { promoteFromWaitlist } from "./session-join-service.js";
import { getSessionOccupancy } from "./session-occupancy.js";
import { withTenant } from "./tenant.js";
import { checkTypedName, stripInvisibleChars } from "./text-safety.js";

/**
 * Host roster commands. `addMemberToSession` is the canonical join choke-point (DD-41 name); its
 * first caller is the host-add path. One withTenant transaction each:
 *   authorize (session.manage + tenant manage_roster, FOR SHARE) -> command advisory lock + dedup
 *   (DD-117 D5, commandId only) -> session FOR UPDATE -> guards -> mutate -> outbox -> record.
 *
 * Money rule: an ACTIVE player has exactly ONE charge (amount_due = deriveChargeAmount's result:
 * price_amount, or price_male / price_female by the stored gender, DD-39); a WAITLISTED player has
 * none (DD-45). A `left` player's charge is `void` and, on
 * re-join, is reused (never a second charge, UNIQUE (tenant, session, player)).
 *
 * Removing an ACTIVE player frees a seat: promoteFromWaitlist (session-join-service.ts, P-6/P-7)
 * seats the waitlist head(s) in the same transaction, under the session lock already held.
 * NOT built here (deliberately): pay_code issuance (BL-PAY-3), eligibility policy beyond
 * status/capacity (DD-41 evaluateSessionEligibility).
 */

export type AddMemberSource = "host_add";
export interface AddMemberParams {
  tenantId: string;
  actorPersonId: string;
  commandId: string;
  sessionId: string;
  /** An existing member (DD-85: never resolved by name) or a NEW member from a display name. */
  member: { membershipId: string } | { displayName: string };
  source: AddMemberSource;
}
export interface AddMemberResult {
  playerId: string;
  membershipId: string;
  status: "active" | "waitlisted";
  waitlistPosition: number | null;
  chargeId: string | null;
  replayed: boolean;
}
interface StoredAdd extends Omit<AddMemberResult, "replayed"> {
  sessionId: string;
  actorPersonId: string;
}
const isStoredAdd = (v: unknown): v is StoredAdd => {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    isUuid(r.sessionId) &&
    isUuid(r.actorPersonId) &&
    isUuid(r.playerId) &&
    isUuid(r.membershipId) &&
    (r.status === "active" || r.status === "waitlisted")
  );
};

const ADD_TYPE = "AddMemberToSession";
const REMOVE_TYPE = "RemovePlayerFromSession";
const ACTIONS = ["session.manage"] as const;

/** Existing member (active|guest of THIS tenant, RLS-scoped) or a brand-new Person + membership. */
async function resolveMembership(
  tx: Tx,
  tenantId: string,
  actor: string,
  member: AddMemberParams["member"],
): Promise<string> {
  if (typeof member !== "object" || member === null)
    return fail("INVALID_INPUT", "member is required");
  const hasId = "membershipId" in member && member.membershipId !== undefined;
  const hasName = "displayName" in member && member.displayName !== undefined;
  if (hasId === hasName)
    return fail("INVALID_INPUT", "give exactly one of membershipId or displayName");

  if (hasId) {
    const id = (member as { membershipId: string }).membershipId;
    if (typeof id !== "string" || !UUID_RE.test(id))
      return fail("PLAYER_NOT_FOUND", "member not found");
    const [m] = await tx
      .select({ id: memberships.id, status: memberships.status })
      .from(memberships)
      .where(and(eq(memberships.id, id.toLowerCase()), eq(memberships.tenantId, tenantId)))
      .for("share");
    if (m === undefined || (m.status !== "active" && m.status !== "guest")) {
      return fail("PLAYER_NOT_FOUND", "member not found");
    }
    return m.id;
  }

  const rawName = (member as { displayName: unknown }).displayName;
  // L27: strip invisible code points first so the person and the membership row get the same value;
  // an invisible-only name then fails exactly like an empty one. Non-strings reach the guard below as-is.
  const name = typeof rawName === "string" ? stripInvisibleChars(rawName) : rawName;
  // L29: shared typed-name rule (checkTypedName; SQL twin member_name_apply_rule, mode false): a
  // control, bidi or separator code point inside, or no visible character, refuses like an empty
  // name; the person and the membership both store its strip-and-trim result.
  const typed = isBoundedText(name, 1, DISPLAY_NAME_MAX) ? checkTypedName(name) : null;
  if (typed === null) {
    return fail("INVALID_INPUT", `displayName must be 1..${DISPLAY_NAME_MAX} characters`);
  }
  // persons has no grant to app: the narrow 0051 definer mints it. A name never matches an
  // existing person (DD-85) and pay_code stays NULL (BL-PAY-3).
  const created = await tx.execute(
    sql`SELECT create_host_added_person(${tenantId}::uuid, ${actor}::uuid, ${typed}) AS id`,
  );
  const personId = (created.rows[0] as { id: string } | undefined)?.id;
  if (personId === undefined) throw new Error("create_host_added_person returned no row");
  const [row] = await tx
    .insert(memberships)
    .values({ tenantId, personId, displayName: typed, status: "active" })
    .returning({ id: memberships.id });
  return row!.id;
}

export async function addMemberToSession(
  db: Db,
  params: AddMemberParams,
): Promise<AddMemberResult> {
  const { tenantId, commandId } = params;
  return withTenant(db, tenantId, async (tx) => {
    const actor = await requireActor(tx, tenantId, params.actorPersonId, ACTIONS, "manage_roster");
    if (typeof params.sessionId !== "string" || !UUID_RE.test(params.sessionId)) {
      return fail("SESSION_NOT_FOUND", "session not found in tenant context");
    }
    const sessionId = params.sessionId.toLowerCase();
    const commandKey = requireCommandId(commandId);
    const stored = await replayOrNull(
      tx,
      tenantId,
      commandKey,
      ADD_TYPE,
      sessionId,
      actor,
      isStoredAdd,
    );
    if (stored !== null) {
      // A membershipId add is bound to its TARGET member (an id, not request content -- DD-117 D5):
      // reusing the key for another member must not read as success. A displayName add has no
      // stable target (the name never resolves to an existing member, DD-85), so it is bound only
      // by session + actor.
      const requested = (params.member as { membershipId?: unknown } | null)?.membershipId;
      if (requested !== undefined && String(requested).toLowerCase() !== stored.membershipId) {
        return fail("COMMAND_ID_CONFLICT", "command_id belongs to a different member");
      }
      const { sessionId: _s, actorPersonId: _a, ...rest } = stored;
      return { ...rest, replayed: true };
    }
    if (params.source !== "host_add") return fail("INVALID_INPUT", "unknown join source");

    const [session] = await tx
      .select({
        status: sessions.status,
        slotsMax: sessions.slotsMax,
        price: sessions.priceAmount,
        priceMale: sessions.priceMale,
        priceFemale: sessions.priceFemale,
      })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .for("update");
    if (session === undefined)
      return fail("SESSION_NOT_FOUND", "session not found in tenant context");
    // OPEN only: a draft has no players and no charges (spec edge #28; cancelSession's draft branch
    // and updateSession's any-charge price guard both rely on it), so draft is SESSION_NOT_OPEN.
    if (session.status !== "open") {
      return fail("SESSION_NOT_OPEN", "players can only be added to an open session");
    }

    const membershipId = await resolveMembership(tx, tenantId, actor, params.member);

    const [existing] = await tx
      .select({ id: players.id, status: players.status })
      .from(players)
      .where(and(eq(players.sessionId, sessionId), eq(players.membershipId, membershipId)))
      .for("update");
    if (existing !== undefined && existing.status !== "left") {
      return fail("ALREADY_JOINED", "member is already on this session roster");
    }

    const { playerId, status, waitlistPosition, chargeId } = await seatPlayer(
      tx,
      tenantId,
      sessionId,
      session,
      membershipId,
      existing?.id,
      { context: "host_add", actorPersonId: actor },
    );
    const eventType = status === "waitlisted" ? "player.waitlisted" : "player.added";
    await emitSessionEvent(tx, tenantId, sessionId, eventType, {
      session_id: sessionId,
      player_id: playerId,
      membership_id: membershipId,
      status,
      waitlist_position: waitlistPosition,
      source: params.source,
    });
    const result: StoredAdd = {
      sessionId,
      actorPersonId: actor,
      playerId,
      membershipId,
      status,
      waitlistPosition,
      chargeId,
    };
    await recordCommand(tx, tenantId, commandKey, ADD_TYPE, result);
    const { sessionId: _s, actorPersonId: _a, ...rest } = result;
    return { ...rest, replayed: false };
  });
}

export interface SeatResult {
  playerId: string;
  status: "active" | "waitlisted";
  waitlistPosition: number | null;
  chargeId: string | null;
}

/**
 * Seats one member on an OPEN session whose row the caller already holds FOR UPDATE (every players
 * writer serializes on that lock): ACTIVE with exactly one charge while getSessionOccupancy is below
 * slots_max, else WAITLISTED at the FIFO tail (max position + 1) with none. `existingPlayerId` is the
 * member's `left` row, locked FOR UPDATE by the caller, and is reused (fresh joined_at, never a
 * second charge). The caller emits its own event. Shared by host-add and the player self-join paths
 * (session-join-service.ts); internal to packages/db, NOT exported from index.ts.
 */
export async function seatPlayer(
  tx: Tx,
  tenantId: string,
  sessionId: string,
  session: {
    slotsMax: number | null;
    price: number;
    priceMale: number | null;
    priceFemale: number | null;
  },
  membershipId: string,
  existingPlayerId: string | undefined,
  derivation: { context: "self_join" | "host_add"; actorPersonId: string },
): Promise<SeatResult> {
  const full =
    session.slotsMax !== null && (await getSessionOccupancy(tx, sessionId)) >= session.slotsMax;
  // DD-39 call site 1 (readiness 4.4 / 4.5): derive BEFORE any players or charges write; a stored
  // gender that cannot be opened throws, so the caller's whole transaction rolls back (no player,
  // no charge, no minted guest membership, no command row). Never a fallback price.
  let amount: number | null = null;
  if (!full) {
    const derived = await deriveChargeAmount(tx, {
      ...derivation,
      sessionId,
      membershipId,
      prices: {
        priceAmount: session.price,
        priceMale: session.priceMale,
        priceFemale: session.priceFemale,
      },
    });
    if (!derived.ok) return fail(derived.code, "the charge could not be derived");
    amount = derived.amount;
  }
  let waitlistPosition: number | null = null;
  if (full) {
    const [tail] = await tx
      .select({ max: sql<number>`coalesce(max(${players.waitlistPosition}), 0)` })
      .from(players)
      .where(and(eq(players.sessionId, sessionId), eq(players.status, "waitlisted")));
    waitlistPosition = Number(tail!.max) + 1;
  }
  const status = full ? "waitlisted" : "active";

  let playerId: string;
  if (existingPlayerId === undefined) {
    const [row] = await tx
      .insert(players)
      .values({ tenantId, sessionId, membershipId, status, waitlistPosition })
      .returning({ id: players.id });
    playerId = row!.id;
  } else {
    // Re-join of a `left` row: same row, fresh joined_at (queue order), no duplicate charge.
    playerId = existingPlayerId;
    await tx
      .update(players)
      .set({ status, waitlistPosition, joinedAt: sql`clock_timestamp()` })
      .where(eq(players.id, playerId));
  }

  let chargeId: string | null = null;
  if (amount !== null)
    chargeId = await upsertCharge(tx, tenantId, sessionId, playerId, membershipId, amount);
  return { playerId, status, waitlistPosition, chargeId };
}

/** Exactly ONE charge per (session, player): create it, or revive the `void` one of a re-join.
 *  Internal to packages/db (host-add, self-join, waitlist promotion), NOT exported from index.ts. */
export async function upsertCharge(
  tx: Tx,
  tenantId: string,
  sessionId: string,
  playerId: string,
  membershipId: string,
  price: number,
): Promise<string> {
  const [prior] = await tx
    .select({ id: charges.id })
    .from(charges)
    .where(and(eq(charges.sessionId, sessionId), eq(charges.playerId, playerId)))
    .for("update");
  if (prior === undefined) {
    const [row] = await tx
      .insert(charges)
      .values({
        tenantId,
        sessionId,
        playerId,
        membershipId,
        amountDue: price,
        amountAllocated: 0,
        status: chargeStatusFor(price, 0),
      })
      .returning({ id: charges.id });
    return row!.id;
  }
  // Void charges only exist for removed players, whose effective allocations were 0 (and still are).
  // REJOIN_REQUIRES_REVIEW is a fail-closed guard that this lane's writers cannot reach (removal
  // requires effective 0); it protects against a `left` row created by a future writer. The revived
  // amount_due re-derives from the CURRENT price, and applyEffective stays THE writer of
  // amount_allocated/status (INV-7).
  const effective = (await effectiveByCharge(tx, [prior.id])).get(prior.id) ?? 0;
  if (effective !== 0) return fail("REJOIN_REQUIRES_REVIEW", "prior payments need review first");
  await tx.update(charges).set({ amountDue: price }).where(eq(charges.id, prior.id));
  await applyEffective(tx, prior.id, price, { revive: true });
  return prior.id;
}

export interface RemovePlayerParams {
  tenantId: string;
  actorPersonId: string;
  commandId: string;
  sessionId: string;
  playerId: string;
}
export interface RemovePlayerResult {
  playerId: string;
  replayed: boolean;
}
interface StoredRemove {
  sessionId: string;
  actorPersonId: string;
  playerId: string;
}
const isStoredRemove = (v: unknown): v is StoredRemove => {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return isUuid(r.sessionId) && isUuid(r.actorPersonId) && isUuid(r.playerId);
};

/** Removes an UNPAID player (active or waitlisted): player -> left, charge -> void. Any effective
 *  allocation fails closed (REMOVE_REQUIRES_REVIEW): the host reverses the payment first. */
export async function removePlayerFromSession(
  db: Db,
  params: RemovePlayerParams,
): Promise<RemovePlayerResult> {
  const { tenantId, commandId } = params;
  return withTenant(db, tenantId, async (tx) => {
    const actor = await requireActor(tx, tenantId, params.actorPersonId, ACTIONS, "manage_roster");
    if (typeof params.sessionId !== "string" || !UUID_RE.test(params.sessionId)) {
      return fail("SESSION_NOT_FOUND", "session not found in tenant context");
    }
    const sessionId = params.sessionId.toLowerCase();
    const stored = await replayOrNull(
      tx,
      tenantId,
      requireCommandId(commandId),
      REMOVE_TYPE,
      sessionId,
      actor,
      isStoredRemove,
    );
    if (stored !== null) {
      // Bound to its target id as well (an id, not request content -- DD-117 D5).
      if (stored.playerId !== String(params.playerId).toLowerCase()) {
        return fail("COMMAND_ID_CONFLICT", "command_id belongs to a different player");
      }
      return { playerId: stored.playerId, replayed: true };
    }
    if (typeof params.playerId !== "string" || !UUID_RE.test(params.playerId)) {
      return fail("PLAYER_NOT_FOUND", "player not found in this session");
    }
    const playerId = params.playerId.toLowerCase();

    const [session] = await tx
      .select({ status: sessions.status })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .for("update");
    if (session === undefined)
      return fail("SESSION_NOT_FOUND", "session not found in tenant context");
    // OPEN only (same invariant as add: a draft never holds player rows).
    if (session.status !== "open") {
      return fail("SESSION_NOT_OPEN", "the roster of this session is frozen");
    }
    const [player] = await tx
      .select({ status: players.status })
      .from(players)
      .where(and(eq(players.id, playerId), eq(players.sessionId, sessionId)))
      .for("update");
    if (player === undefined || player.status === "left") {
      return fail("PLAYER_NOT_FOUND", "player not found in this session");
    }
    const [charge] = await tx
      .select({ id: charges.id })
      .from(charges)
      .where(and(eq(charges.sessionId, sessionId), eq(charges.playerId, playerId)))
      .for("update");
    if (charge !== undefined) {
      const effective = (await effectiveByCharge(tx, [charge.id])).get(charge.id) ?? 0;
      if (effective !== 0)
        return fail("REMOVE_REQUIRES_REVIEW", "player has payments; reverse them first");
      await tx.update(charges).set({ status: "void" }).where(eq(charges.id, charge.id));
    }
    await tx
      .update(players)
      .set({ status: "left", waitlistPosition: null })
      .where(eq(players.id, playerId));
    // R1A-1: the removal supersedes the person's pending join request (no second event).
    await closePendingJoinRequestOnExit(tx, tenantId, sessionId, playerId, actor);
    await emitSessionEvent(tx, tenantId, sessionId, "player.removed", {
      session_id: sessionId,
      player_id: playerId,
      previous_status: player.status,
    });
    // DT-10 / P-6 / P-7: an ACTIVE player's seat is now free (a waitlisted row frees none).
    if (player.status === "active") await promoteFromWaitlist(tx, tenantId, sessionId);
    await recordCommand(tx, tenantId, commandId, REMOVE_TYPE, {
      sessionId,
      actorPersonId: actor,
      playerId,
    });
    return { playerId, replayed: false };
  });
}

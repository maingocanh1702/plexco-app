import { and, asc, eq, inArray, ne, notInArray, sql } from "drizzle-orm";
import { charges, memberships, players, sessions } from "../schema.js";
import { authorizeTenantAction } from "./authorization.js";
import { deriveChargeAmount } from "./charge-derivation.js";
import type { Db, Tx } from "./client.js";
import { closePendingJoinRequestOnExit, openJoinRequest } from "./join-request-service.js";
import {
  effectiveByCharge,
  emitSessionEvent,
  fail,
  isUuid,
  recordCommand,
  replayOrNull,
  requireCommandId,
  type RosterMoneyErrorCode,
} from "./roster-money-shared.js";
import { seatPlayer, upsertCharge } from "./roster-service.js";
import { getSessionOccupancy, occupiedCountSql, slotsOpen } from "./session-occupancy.js";
import { withTenant } from "./tenant.js";

/**
 * Player self-service roster commands (Web MVP lane L8, M9; readiness p3-m9-join-core 4.2-4.4):
 * self-join, self-leave and FIFO waitlist promotion. One withTenant transaction each, in the
 * host-add lock order (4.2):
 *   suspension gate (authorizeTenantAction 'manage_roster') -> commandId dedup (DD-117 D5) ->
 *   sessions FOR UPDATE -> memberships FOR SHARE (or the 0058 definer) -> players FOR UPDATE ->
 *   occupancy (getSessionOccupancy, THE formula) -> writes -> upsertCharge -> ONE event ->
 *   promoteFromWaitlist (same tx) -> recordCommand.
 * Every refusal throws RosterMoneyError before any write, so the tx rolls back with zero writes.
 *
 * Tenant and identity are PARAMETERS: tenantId is the route-resolved `?tenant=` value of the
 * caller's own club and personId the authenticated session's person. Neither ever comes from a
 * request body or from a session-id lookup, and a display name never resolves to a person
 * (HARD RULE 4, DD-85). No money moves: L8 writes no payments or payment_allocations row.
 */

export interface JoinSessionParams {
  tenantId: string;
  personId: string;
  sessionId: string;
  commandId: string;
  /** L10b's public_listing_id route only: a caller without a membership gets a `guest` one, and
   *  only for a public session (P-1, P-3). Every other caller must already be a live member. */
  allowGuestMembership?: boolean;
}
/** Exactly these five keys (P-18: no amount, no venue). `requested` = a pending join_requests row
 *  on a join_policy 'approval' session (requestId set; playerId and waitlistPosition null). */
export interface JoinSessionResult {
  outcome: "active" | "waitlisted" | "requested";
  playerId: string | null;
  waitlistPosition: number | null;
  requestId: string | null;
  replayed: boolean;
}
export interface LeaveSessionParams {
  tenantId: string;
  personId: string;
  sessionId: string;
  commandId: string;
}
export interface LeaveSessionResult {
  playerId: string;
  status: "left";
  replayed: boolean;
}

type JoinOutcome = Omit<JoinSessionResult, "replayed">;
interface StoredJoin extends JoinOutcome {
  sessionId: string;
  actorPersonId: string;
}
interface StoredLeave {
  sessionId: string;
  actorPersonId: string;
  playerId: string;
}
const isStoredJoin = (v: unknown): v is StoredJoin => {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    isUuid(r.sessionId) &&
    isUuid(r.actorPersonId) &&
    (r.outcome === "active" || r.outcome === "waitlisted" || r.outcome === "requested") &&
    (r.playerId === null || isUuid(r.playerId)) &&
    (r.requestId === null || isUuid(r.requestId)) &&
    (r.waitlistPosition === null || typeof r.waitlistPosition === "number")
  );
};
const isStoredLeave = (v: unknown): v is StoredLeave => {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return isUuid(r.sessionId) && isUuid(r.actorPersonId) && isUuid(r.playerId);
};

const JOIN_TYPE = "JoinSession";
const LEAVE_TYPE = "LeaveSession";

/** Builds the five-key result field by field, whatever else a stored JSON may hold. */
const joinResult = (o: JoinOutcome, replayed: boolean): JoinSessionResult => ({
  outcome: o.outcome,
  playerId: o.playerId,
  waitlistPosition: o.waitlistPosition,
  requestId: o.requestId,
  replayed,
});

/** P-14: the player commands pass the tenant suspension gate only (no host capability), before
 *  the id checks and the dedup read, like requireActor. */
async function playerGate(tx: Tx, params: LeaveSessionParams, badSession: RosterMoneyErrorCode) {
  const decision = await authorizeTenantAction(tx, params.tenantId, "manage_roster");
  if (!decision.allowed) return fail("TENANT_SUSPENDED", "tenant is not permitted");
  if (!isUuid(params.personId)) return fail("FORBIDDEN", "caller is not authorized");
  if (!isUuid(params.sessionId)) return fail(badSession, "session not found in tenant context");
  return {
    personId: params.personId.toLowerCase(),
    sessionId: params.sessionId.toLowerCase(),
    commandKey: requireCommandId(params.commandId),
  };
}

/** sessions FOR UPDATE: every players writer of a session serializes on this row (4.2). Re-taking
 *  it in a transaction that already holds it is a no-op. P-2: "past" = starts_at <= now().
 *  R1A-3: RLS plus an explicit tenant filter (defense in depth, like liveMembership).
 *  Exported for join-request-service.ts only (not from index.ts). */
export async function lockSession(tx: Tx, tenantId: string, sessionId: string) {
  const [row] = await tx
    .select({
      status: sessions.status,
      slotsMax: sessions.slotsMax,
      price: sessions.priceAmount,
      priceMale: sessions.priceMale,
      priceFemale: sessions.priceFemale,
      visibility: sessions.visibility,
      joinPolicy: sessions.joinPolicy,
      started: sql<boolean>`${sessions.startsAt} <= now()`,
    })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.tenantId, tenantId)))
    .for("update");
  return row;
}

/** The person's live (active|guest) membership of the tenant, FOR SHARE: RLS plus an explicit
 *  tenant filter. At most one exists (UNIQUE (tenant_id, person_id) WHERE status is live).
 *  In-module callers include the Zalo list read listOwnJoinableSessions (L13 RC-3).
 *  Exported for join-request-service.ts only (not from index.ts). */
export async function liveMembership(tx: Tx, tenantId: string, personId: string) {
  const [row] = await tx
    .select({ id: memberships.id, status: memberships.status })
    .from(memberships)
    .where(
      and(
        eq(memberships.tenantId, tenantId),
        eq(memberships.personId, personId),
        inArray(memberships.status, ["active", "guest"]),
      ),
    )
    .for("share");
  return row;
}

/** Readiness 4.1 (the route's P-3 audience check). Signature note: it takes tenantId for the
 *  explicit tenant filter on top of RLS (4.1 lists `hasLiveMembership(tx, personId)`). */
export async function hasLiveMembership(
  tx: Tx,
  tenantId: string,
  personId: string,
): Promise<boolean> {
  return isUuid(personId) && (await liveMembership(tx, tenantId, personId)) !== undefined;
}

/** One /join list row (L13 readiness 4.4, R-22): the server-only id plus the safe fields the reply
 *  maps. Never a venue, a roster, another person's data or an amount (P-11). */
export interface JoinableSession {
  sessionId: string;
  /** ISO 8601 UTC, the input of formatSessionDate / formatSessionTime (P-20). */
  startsAt: string;
  timezone: string;
  area: string | null;
  /** null = unlimited (slotsOpen, the one capacity formula). */
  slotsOpen: number | null;
}
export type JoinableSessionsResult =
  { member: false } | { member: true; sessions: JoinableSession[] };

/**
 * The Zalo /join numbered list (L13 RC-3, 4.4, P-10): the club's open sessions with
 * starts_at > now() (the exact negation of joinSession's `started`) that are public, or any
 * visibility for an ACTIVE member; ordered (starts_at, id), LIMIT 10 (the caller shows 9 and a
 * 10th adds the "more" line). No live membership, or a non-UUID person -> { member: false }.
 * One withTenant read with an explicit tenant filter on top of RLS; it writes nothing.
 */
export async function listOwnJoinableSessions(
  db: Db,
  params: { tenantId: string; personId: string },
): Promise<JoinableSessionsResult> {
  const { tenantId, personId } = params;
  if (!isUuid(personId)) return { member: false };
  return withTenant(db, tenantId, async (tx) => {
    const membership = await liveMembership(tx, tenantId, personId);
    if (membership === undefined) return { member: false };
    const rows = await tx
      .select({
        sessionId: sessions.id,
        startsAt: sessions.startsAt,
        timezone: sessions.timezone,
        area: sessions.area,
        slotsMax: sessions.slotsMax,
        occupied: occupiedCountSql(sessions.id, tenantId),
      })
      .from(sessions)
      .where(
        and(
          eq(sessions.tenantId, tenantId),
          eq(sessions.status, "open"),
          sql`${sessions.startsAt} > now()`,
          membership.status === "active" ? undefined : eq(sessions.visibility, "public"),
        ),
      )
      .orderBy(asc(sessions.startsAt), asc(sessions.id))
      .limit(10);
    return {
      member: true,
      sessions: rows.map((r) => ({
        sessionId: r.sessionId,
        startsAt: r.startsAt.toISOString(),
        timezone: r.timezone,
        area: r.area,
        slotsOpen: slotsOpen(r.slotsMax, Number(r.occupied)),
      })),
    };
  });
}

/**
 * P-8: a player row's old charge is unprovable when it exists and is not a `void` charge with zero
 * effective money. L8 never re-seats such a row: join refuses it (REJOIN_REQUIRES_REVIEW) and
 * promotion skips it (it stays waitlisted). Also the check for part B's approve.
 */
export async function rejoinUnprovable(
  tx: Tx,
  sessionId: string,
  playerId: string,
): Promise<boolean> {
  const [charge] = await tx
    .select({ id: charges.id, status: charges.status })
    .from(charges)
    .where(and(eq(charges.sessionId, sessionId), eq(charges.playerId, playerId)))
    .for("update");
  if (charge === undefined) return false;
  if (charge.status !== "void") return true;
  return ((await effectiveByCharge(tx, [charge.id])).get(charge.id) ?? 0) !== 0;
}

/** 0058 definer (tenant pinned to the GUC, person must be active): the live membership or a new
 *  `guest` one, race-safe on the live UNIQUE. Same tx: a failed join rolls it back (BE edge 16).
 *  Exported for join-request-service.ts only (approve); never called for a join request. */
export async function mintGuestMembership(
  tx: Tx,
  tenantId: string,
  personId: string,
): Promise<string> {
  const created = await tx.execute(
    sql`SELECT create_guest_membership(${tenantId}::uuid, ${personId}::uuid) AS id`,
  );
  const id = (created.rows[0] as { id: string | null } | undefined)?.id;
  if (id === undefined || id === null) throw new Error("create_guest_membership returned no row");
  return id;
}

/** Self-join (readiness 4.3). Re-derives everything under the session lock, so it is also the
 *  confirm-time check behind L10b's public_listing_id join route. */
export async function joinSession(db: Db, params: JoinSessionParams): Promise<JoinSessionResult> {
  const { tenantId } = params;
  return withTenant(db, tenantId, async (tx) => {
    const { personId, sessionId, commandKey } = await playerGate(tx, params, "SESSION_NOT_FOUND");
    const stored = await replayOrNull(
      tx,
      tenantId,
      commandKey,
      JOIN_TYPE,
      sessionId,
      personId,
      isStoredJoin,
    );
    if (stored !== null) return joinResult(stored, true);

    const session = await lockSession(tx, tenantId, sessionId);
    const membership = await liveMembership(tx, tenantId, personId);
    // P-3: a caller who is not a live member of ?tenant= gets ONE answer before any session fact.
    if (membership === undefined && params.allowGuestMembership !== true) {
      return fail("FORBIDDEN", "caller is not a member of this club");
    }
    if (session === undefined)
      return fail("SESSION_NOT_FOUND", "session not found in tenant context");
    if (session.status !== "open" || session.started) {
      return fail("SESSION_NOT_JOINABLE", "session is not open for joining");
    }
    // P-1: a private session takes ACTIVE members only; a guest member or a visitor is refused
    // here, before any membership is minted.
    if (session.visibility !== "public" && membership?.status !== "active") {
      return fail("SESSION_NOT_JOINABLE", "session is not open for joining");
    }

    const [existing] =
      membership === undefined
        ? []
        : await tx
            .select({
              id: players.id,
              status: players.status,
              waitlistPosition: players.waitlistPosition,
            })
            .from(players)
            .where(and(eq(players.sessionId, sessionId), eq(players.membershipId, membership.id)))
            .for("update");
    if (existing !== undefined && existing.status !== "left") {
      // Already seated: the current outcome with zero writes and no recordCommand (idempotent).
      const outcome = existing.status as "active" | "waitlisted";
      const { id: playerId, waitlistPosition } = existing;
      return joinResult({ outcome, playerId, waitlistPosition, requestId: null }, false);
    }
    if (existing !== undefined && (await rejoinUnprovable(tx, sessionId, existing.id))) {
      return fail("REJOIN_REQUIRES_REVIEW", "prior payments need review first");
    }
    // RD-4 (L10b readiness 4.6, amended by R1-1), on BOTH paths: a membership of this person that
    // ended (left or merged) can still hold a live seat in this session, and players is unique
    // only per membership, so seating through the live or a newly minted guest membership would
    // seat the same person twice. Refused before any write. The live membership's own seat is
    // excluded: it already answered above with L8's current outcome.
    const [seated] = await tx
      .select({ id: players.id })
      .from(players)
      .innerJoin(memberships, eq(memberships.id, players.membershipId))
      .where(
        and(
          eq(players.tenantId, tenantId),
          eq(players.sessionId, sessionId),
          ne(players.status, "left"),
          eq(memberships.tenantId, tenantId),
          eq(memberships.personId, personId),
          membership === undefined ? undefined : ne(players.membershipId, membership.id),
        ),
      )
      .limit(1);
    if (seated !== undefined) {
      return fail("ALREADY_JOINED", "caller already holds a seat in this session");
    }
    // join_policy 'approval' opens a join request only (readiness 4.3, DT-7): no membership,
    // player, charge or held seat. It stays BEFORE mintGuestMembership, so a visitor's request
    // never creates a membership (BE :151); the 0058 definer runs at approve instead.
    if (session.joinPolicy !== "open") {
      const opened = await openJoinRequest(tx, tenantId, sessionId, personId, commandKey);
      const requested: JoinOutcome = {
        outcome: "requested",
        playerId: null,
        waitlistPosition: null,
        requestId: opened.requestId,
      };
      // A live pending request is the current outcome: zero writes and no recordCommand (like a
      // seated player).
      if (opened.created) {
        const record: StoredJoin = { sessionId, actorPersonId: personId, ...requested };
        await recordCommand(tx, tenantId, commandKey, JOIN_TYPE, record);
      }
      return joinResult(requested, false);
    }

    const membershipId = membership?.id ?? (await mintGuestMembership(tx, tenantId, personId));
    const seat = await seatPlayer(tx, tenantId, sessionId, session, membershipId, existing?.id, {
      context: "self_join",
      actorPersonId: personId,
    });
    const eventType = seat.status === "waitlisted" ? "player.waitlisted" : "player.added";
    await emitSessionEvent(tx, tenantId, sessionId, eventType, {
      session_id: sessionId,
      player_id: seat.playerId,
      membership_id: membershipId,
      status: seat.status,
      waitlist_position: seat.waitlistPosition,
      source: "self_join",
    });
    const outcome: JoinOutcome = {
      outcome: seat.status,
      playerId: seat.playerId,
      waitlistPosition: seat.waitlistPosition,
      requestId: null,
    };
    const record: StoredJoin = { sessionId, actorPersonId: personId, ...outcome };
    await recordCommand(tx, tenantId, commandKey, JOIN_TYPE, record);
    return joinResult(outcome, false);
  });
}

/** Self-leave (readiness 4.4, P-4, P-5): open and before start only, never with net money. */
export async function leaveSession(
  db: Db,
  params: LeaveSessionParams,
): Promise<LeaveSessionResult> {
  const { tenantId } = params;
  return withTenant(db, tenantId, async (tx) => {
    const { personId, sessionId, commandKey } = await playerGate(tx, params, "PLAYER_NOT_FOUND");
    const stored = await replayOrNull(
      tx,
      tenantId,
      commandKey,
      LEAVE_TYPE,
      sessionId,
      personId,
      isStoredLeave,
    );
    if (stored !== null) return { playerId: stored.playerId, status: "left", replayed: true };

    const session = await lockSession(tx, tenantId, sessionId);
    const membership = await liveMembership(tx, tenantId, personId);
    if (session === undefined || membership === undefined) {
      return fail("PLAYER_NOT_FOUND", "player not found in this session");
    }
    const [player] = await tx
      .select({ id: players.id, status: players.status })
      .from(players)
      .where(and(eq(players.sessionId, sessionId), eq(players.membershipId, membership.id)))
      .for("update");
    if (player === undefined) return fail("PLAYER_NOT_FOUND", "player not found in this session");
    if (player.status === "left") return { playerId: player.id, status: "left", replayed: false };
    if (session.status !== "open" || session.started) {
      return fail("LEAVE_REQUIRES_HOST", "the host must remove this player");
    }

    if (player.status === "active") {
      const [charge] = await tx
        .select({ id: charges.id })
        .from(charges)
        .where(and(eq(charges.sessionId, sessionId), eq(charges.playerId, player.id)))
        .for("update");
      if (charge !== undefined) {
        const effective = (await effectiveByCharge(tx, [charge.id])).get(charge.id) ?? 0;
        if (effective !== 0) return fail("LEAVE_REQUIRES_HOST", "the host must remove this player");
        await tx.update(charges).set({ status: "void" }).where(eq(charges.id, charge.id));
      }
    }
    await tx
      .update(players)
      .set({ status: "left", waitlistPosition: null })
      .where(eq(players.id, player.id));
    // R1A-1: the leave supersedes the person's pending request (no second event).
    await closePendingJoinRequestOnExit(tx, tenantId, sessionId, player.id, personId);
    await emitSessionEvent(tx, tenantId, sessionId, "player.removed", {
      session_id: sessionId,
      player_id: player.id,
      previous_status: player.status,
      source: "self_leave",
    });
    // Only an active leave frees a seat (P-5: a waitlisted leave promotes no one).
    if (player.status === "active") await promoteFromWaitlist(tx, tenantId, sessionId);
    await recordCommand(tx, tenantId, commandKey, LEAVE_TYPE, {
      sessionId,
      actorPersonId: personId,
      playerId: player.id,
    });
    return { playerId: player.id, status: "left", replayed: false };
  });
}

/**
 * FIFO waitlist promotion (readiness 4.4, P-6, P-7) inside the caller's transaction, which already
 * holds the session row lock. Only while the session is open and before its start: fills every
 * free seat (slots_max NULL = unlimited) in (waitlist_position, joined_at, id) order, skipping a
 * P-8 unprovable candidate (it stays waitlisted). Each promoted row: active, position cleared,
 * joined_at untouched, ONE charge at the derived price (DD-39), ONE `player.promoted` whose
 * amount_due is read back from that charge. An underivable candidate stays waitlisted (RD-1). No
 * renumbering, and no money moves. Returns how many it promoted.
 */
export async function promoteFromWaitlist(
  tx: Tx,
  tenantId: string,
  sessionId: string,
): Promise<number> {
  const session = await lockSession(tx, tenantId, sessionId);
  if (session === undefined || session.status !== "open" || session.started) return 0;
  const skipped: string[] = [];
  let promoted = 0;
  while (
    session.slotsMax === null ||
    (await getSessionOccupancy(tx, sessionId)) < session.slotsMax
  ) {
    // R-R5-b: only a membership that may hold a seat (active|guest, the set host-add, liveMembership
    // and the 0062 derivation definer accept); a left / merged one stays waitlisted, never promoted.
    // The lock stays on players only (memberships are never locked FOR UPDATE here, 4.2 order).
    const [next] = await tx
      .select({ id: players.id, membershipId: players.membershipId })
      .from(players)
      .innerJoin(memberships, eq(memberships.id, players.membershipId))
      .where(
        and(
          eq(players.sessionId, sessionId),
          eq(players.status, "waitlisted"),
          inArray(memberships.status, ["active", "guest"]),
          skipped.length > 0 ? notInArray(players.id, skipped) : undefined,
        ),
      )
      .orderBy(players.waitlistPosition, players.joinedAt, players.id)
      .limit(1)
      .for("update", { of: players });
    if (next === undefined) break;
    if (await rejoinUnprovable(tx, sessionId, next.id)) {
      skipped.push(next.id);
      continue;
    }
    // DD-39 call site 2 (readiness 4.4 / 4.5, RD-1): derive BEFORE the candidate's first write. A
    // stored gender that cannot be opened leaves this candidate waitlisted (same position, no
    // charge, no DM), writes ONE audit event and moves on to the next FIFO candidate; the opener's
    // seat-freeing write still commits. Never a fallback price.
    const derived = await deriveChargeAmount(tx, {
      context: "promotion",
      sessionId,
      membershipId: next.membershipId,
      actorPersonId: null,
      prices: {
        priceAmount: session.price,
        priceMale: session.priceMale,
        priceFemale: session.priceFemale,
      },
    });
    if (!derived.ok) {
      await emitSessionEvent(tx, tenantId, sessionId, "waitlist.charge_derivation_failed", {
        session_id: sessionId,
        player_id: next.id,
        membership_id: next.membershipId,
        reason: derived.code,
      });
      skipped.push(next.id);
      continue;
    }
    await tx
      .update(players)
      .set({ status: "active", waitlistPosition: null })
      .where(eq(players.id, next.id));
    const chargeId = await upsertCharge(
      tx,
      tenantId,
      sessionId,
      next.id,
      next.membershipId,
      derived.amount,
    );
    const [charge] = await tx
      .select({ amountDue: charges.amountDue })
      .from(charges)
      .where(eq(charges.id, chargeId));
    await emitSessionEvent(tx, tenantId, sessionId, "player.promoted", {
      session_id: sessionId,
      player_id: next.id,
      membership_id: next.membershipId,
      charge_id: chargeId,
      amount_due: charge!.amountDue,
    });
    promoted += 1;
  }
  return promoted;
}

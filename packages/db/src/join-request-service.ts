import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { joinRequests, memberships, players, sessions } from "../schema.js";
import { authorizeTenantAction } from "./authorization.js";
import type { Db, Tx } from "./client.js";
import {
  emitSessionEvent,
  fail,
  isUuid,
  recordCommand,
  replayOrNull,
  requireActor,
  requireCommandId,
} from "./roster-money-shared.js";
import { seatPlayer } from "./roster-service.js";
import {
  liveMembership,
  lockSession,
  mintGuestMembership,
  rejoinUnprovable,
} from "./session-join-service.js";
import { authorize } from "./tenant-capability-authority.js";
import { withTenant } from "./tenant.js";

/**
 * Join requests on a join_policy 'approval' session (Web MVP lane L8, M9; readiness
 * p3-m9-join-core 4.3, 4.5, P-9..P-12, P-14, P-15). openJoinRequest is joinSession's approval
 * branch; cancel (the requester), approve and reject (a host) run in their own withTenant
 * transaction in the host-add lock order (4.2): suspension gate -> commandId + an unlocked read of
 * the request's session_id -> replayOrNull -> sessions FOR UPDATE -> join_requests FOR UPDATE ->
 * memberships FOR SHARE (or the 0058 definer) -> players FOR UPDATE -> seatPlayer (occupancy via
 * getSessionOccupancy only) -> ONE event -> recordCommand. Every refusal throws RosterMoneyError
 * before any write, so the tx rolls back with zero writes.
 *
 * Tenant and identity are PARAMETERS: the route-resolved `?tenant=` value and the authenticated
 * session's person, never a request body. A request id outside the tenant (RLS) or, for cancel,
 * not the caller's own gets one answer: JOIN_REQUEST_NOT_FOUND (P-11). Expiry is lazy (P-9, P-10):
 * a new request marks the stale pending row 'expired'; any command on an expired pending row is
 * REQUEST_EXPIRED with zero writes. No money moves: no payments or payment_allocations row.
 */

export interface DecideJoinRequestParams {
  tenantId: string;
  actorPersonId: string;
  requestId: string;
  commandId: string;
}
export interface CancelJoinRequestParams {
  tenantId: string;
  personId: string;
  requestId: string;
  commandId: string;
}
export interface ApproveJoinRequestResult {
  requestId: string;
  status: "approved";
  outcome: "active" | "waitlisted";
  playerId: string;
  waitlistPosition: number | null;
  replayed: boolean;
}
export interface JoinRequestClosedResult {
  requestId: string;
  status: "rejected" | "cancelled";
  replayed: boolean;
}
export interface ListPendingJoinRequestsParams {
  tenantId: string;
  actorPersonId: string;
  sessionId: string;
}
/** Exactly these three keys (A-10, PendingJoinRequestDto): never money or contact data. */
export interface PendingJoinRequest {
  requestId: string;
  displayName: string | null;
  createdAt: string;
}

interface StoredClose {
  sessionId: string;
  actorPersonId: string;
  requestId: string;
}
interface StoredApproval extends StoredClose {
  outcome: "active" | "waitlisted";
  playerId: string;
  waitlistPosition: number | null;
}
const isStoredClose = (v: unknown): v is StoredClose => {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return isUuid(r.sessionId) && isUuid(r.actorPersonId) && isUuid(r.requestId);
};
const isStoredApproval = (v: unknown): v is StoredApproval => {
  if (!isStoredClose(v)) return false;
  const r = v as unknown as Record<string, unknown>;
  return (
    isUuid(r.playerId) &&
    (r.outcome === "active" || r.outcome === "waitlisted") &&
    (r.waitlistPosition === null || typeof r.waitlistPosition === "number")
  );
};

const HOST_ACTIONS = ["session.manage"] as const;
const NOT_FOUND = "join request not found in this club";
const APPROVE_TYPE = "ApproveJoinRequest";
const REJECT_TYPE = "RejectJoinRequest";
const CANCEL_TYPE = "CancelJoinRequest";

/**
 * joinSession's approval branch (4.3). The caller holds the session FOR UPDATE and has passed every
 * joinSession check; nothing here creates a membership (BE :151, the definer runs at approve). A live
 * pending request is returned as is with zero writes; a stale one is marked 'expired' first (P-9),
 * then ONE pending row (expires_at = now() + 24 h, the join's command id) and ONE event.
 */
export async function openJoinRequest(
  tx: Tx,
  tenantId: string,
  sessionId: string,
  personId: string,
  commandId: string,
): Promise<{ requestId: string; created: boolean }> {
  const [pending] = await tx
    .select({ id: joinRequests.id, expired: sql<boolean>`${joinRequests.expiresAt} <= now()` })
    .from(joinRequests)
    .where(
      and(
        eq(joinRequests.tenantId, tenantId),
        eq(joinRequests.sessionId, sessionId),
        eq(joinRequests.personId, personId),
        eq(joinRequests.status, "pending"),
      ),
    )
    .for("update");
  if (pending !== undefined && !pending.expired) return { requestId: pending.id, created: false };
  if (pending !== undefined) {
    await tx.update(joinRequests).set({ status: "expired" }).where(eq(joinRequests.id, pending.id));
  }
  const [row] = await tx
    .insert(joinRequests)
    .values({
      tenantId,
      sessionId,
      personId,
      commandId,
      expiresAt: sql`now() + interval '24 hours'`,
    })
    .returning({ id: joinRequests.id });
  const requestId = row!.id;
  await emitSessionEvent(tx, tenantId, sessionId, "join_request.created", {
    session_id: sessionId,
    request_id: requestId,
  });
  return { requestId, created: true };
}

interface RequestScope {
  actor: string;
  requestId: string;
  sessionId: string;
  commandKey: string;
}

/** The request's session, read unlocked (4.2) under RLS plus an explicit tenant filter; `ownerId`
 *  narrows it to the caller's own request (cancel). */
async function scopeRequest(
  tx: Tx,
  tenantId: string,
  actor: string,
  params: { requestId: string; commandId: string },
  ownerId?: string,
): Promise<RequestScope> {
  if (!isUuid(params.requestId)) return fail("JOIN_REQUEST_NOT_FOUND", NOT_FOUND);
  const requestId = params.requestId.toLowerCase();
  const commandKey = requireCommandId(params.commandId);
  const [row] = await tx
    .select({ sessionId: joinRequests.sessionId })
    .from(joinRequests)
    .where(
      and(
        eq(joinRequests.id, requestId),
        eq(joinRequests.tenantId, tenantId),
        ownerId === undefined ? undefined : eq(joinRequests.personId, ownerId),
      ),
    );
  if (row === undefined) return fail("JOIN_REQUEST_NOT_FOUND", NOT_FOUND);
  return { actor, requestId, sessionId: row.sessionId, commandKey };
}

/** P-14: a host needs session.manage plus the tenant suspension gate (requireActor). */
async function hostScope(tx: Tx, params: DecideJoinRequestParams): Promise<RequestScope> {
  const { tenantId } = params;
  const actor = await requireActor(
    tx,
    tenantId,
    params.actorPersonId,
    HOST_ACTIONS,
    "manage_roster",
  );
  return scopeRequest(tx, tenantId, actor, params);
}

/** P-14: the requester passes the suspension gate only, then owns the request or gets NOT_FOUND. */
async function requesterScope(tx: Tx, params: CancelJoinRequestParams): Promise<RequestScope> {
  const decision = await authorizeTenantAction(tx, params.tenantId, "manage_roster");
  if (!decision.allowed) return fail("TENANT_SUSPENDED", "tenant is not permitted");
  if (!isUuid(params.personId)) return fail("FORBIDDEN", "caller is not authorized");
  const personId = params.personId.toLowerCase();
  return scopeRequest(tx, params.tenantId, personId, params, personId);
}

/** replayOrNull plus the request id: one command id never answers for a different request. */
async function replayFor<T extends StoredClose>(
  tx: Tx,
  tenantId: string,
  scope: RequestScope,
  commandType: string,
  isStored: (value: unknown) => value is T,
): Promise<T | null> {
  const { commandKey, sessionId, actor } = scope;
  const stored = await replayOrNull(
    tx,
    tenantId,
    commandKey,
    commandType,
    sessionId,
    actor,
    isStored,
  );
  if (stored !== null && stored.requestId !== scope.requestId) {
    return fail("COMMAND_ID_CONFLICT", "command_id belongs to a different join request");
  }
  return stored;
}

/** join_requests FOR UPDATE, after the session lock (4.2). Only a live pending row moves (P-10). */
async function lockPending(tx: Tx, requestId: string) {
  const [row] = await tx
    .select({
      personId: joinRequests.personId,
      status: joinRequests.status,
      expired: sql<boolean>`${joinRequests.expiresAt} <= now()`,
    })
    .from(joinRequests)
    .where(eq(joinRequests.id, requestId))
    .for("update");
  if (row === undefined) return fail("JOIN_REQUEST_NOT_FOUND", NOT_FOUND);
  if (row.status !== "pending") return fail("REQUEST_DECIDED", "join request is already decided");
  if (row.expired) return fail("REQUEST_EXPIRED", "join request has expired");
  return row;
}

const decide = (tx: Tx, requestId: string, status: string, decidedBy: string) =>
  tx
    .update(joinRequests)
    .set({ status, decidedBy, decidedAt: sql`now()` })
    .where(eq(joinRequests.id, requestId));

/**
 * R1A-1: a roster exit (self-leave, host remove) supersedes the PENDING request of the exiting
 * player's person for that session, so a later approve answers REQUEST_DECIDED instead of seating
 * them again with a revived charge. Runs in the caller's transaction, which already holds the
 * session row lock (lock order 4.2: sessions before join_requests); `decidedBy` is whoever ended
 * the seat. No event of its own: the exit's `player.removed` stays the ONE event of that roster
 * change. At most one row matches (idx_join_requests_active); a player without a membership has none.
 */
export async function closePendingJoinRequestOnExit(
  tx: Tx,
  tenantId: string,
  sessionId: string,
  playerId: string,
  decidedBy: string,
): Promise<void> {
  const personOfPlayer = tx
    .select({ personId: memberships.personId })
    .from(players)
    .innerJoin(memberships, eq(memberships.id, players.membershipId))
    .where(and(eq(players.id, playerId), eq(players.sessionId, sessionId)));
  await tx
    .update(joinRequests)
    .set({ status: "cancelled", decidedBy, decidedAt: sql`now()` })
    .where(
      and(
        eq(joinRequests.tenantId, tenantId),
        eq(joinRequests.sessionId, sessionId),
        eq(joinRequests.status, "pending"),
        inArray(joinRequests.personId, personOfPlayer),
      ),
    );
}

const approvalResult = (s: StoredApproval, replayed: boolean): ApproveJoinRequestResult => ({
  requestId: s.requestId,
  status: "approved",
  outcome: s.outcome,
  playerId: s.playerId,
  waitlistPosition: s.waitlistPosition,
  replayed,
});

/** Host approve (4.5): re-derives the session, the requester's roster row and the seat under the
 *  session lock, like joinSession; a refusal leaves the request pending. */
export async function approveJoinRequest(
  db: Db,
  params: DecideJoinRequestParams,
): Promise<ApproveJoinRequestResult> {
  const { tenantId } = params;
  return withTenant(db, tenantId, async (tx) => {
    const scope = await hostScope(tx, params);
    const stored = await replayFor(tx, tenantId, scope, APPROVE_TYPE, isStoredApproval);
    if (stored !== null) return approvalResult(stored, true);
    const { requestId, sessionId } = scope;

    const session = await lockSession(tx, tenantId, sessionId);
    const request = await lockPending(tx, requestId);
    if (session === undefined || session.status !== "open" || session.started) {
      return fail("SESSION_NOT_JOINABLE", "session is not open for joining");
    }
    const membership = await liveMembership(tx, tenantId, request.personId);
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

    let seat: {
      playerId: string;
      status: "active" | "waitlisted";
      waitlistPosition: number | null;
    };
    let membershipId: string;
    if (membership !== undefined && existing !== undefined && existing.status !== "left") {
      // P-10: already on the roster (e.g. host-added): approved with zero roster writes.
      const status = existing.status as "active" | "waitlisted";
      seat = { playerId: existing.id, status, waitlistPosition: existing.waitlistPosition };
      membershipId = membership.id;
    } else {
      // P-20 (P-1 re-applied at confirm time): a non-public session seats ACTIVE members only,
      // checked before any mint; the refusal leaves the request pending (still rejectable).
      if (session.visibility !== "public" && membership?.status !== "active") {
        return fail("SESSION_NOT_JOINABLE", "session is not open for joining");
      }
      if (existing !== undefined && (await rejoinUnprovable(tx, sessionId, existing.id))) {
        return fail("REJOIN_REQUIRES_REVIEW", "prior payments need review first");
      }
      membershipId = membership?.id ?? (await mintGuestMembership(tx, tenantId, request.personId));
      seat = await seatPlayer(tx, tenantId, sessionId, session, membershipId, existing?.id);
    }

    await decide(tx, requestId, "approved", scope.actor);
    await emitSessionEvent(tx, tenantId, sessionId, "join_request.approved", {
      session_id: sessionId,
      request_id: requestId,
      player_id: seat.playerId,
      membership_id: membershipId,
      status: seat.status,
      waitlist_position: seat.waitlistPosition,
    });
    const record: StoredApproval = {
      sessionId,
      actorPersonId: scope.actor,
      requestId,
      outcome: seat.status,
      playerId: seat.playerId,
      waitlistPosition: seat.waitlistPosition,
    };
    await recordCommand(tx, tenantId, scope.commandKey, APPROVE_TYPE, record);
    return approvalResult(record, false);
  });
}

/** reject (host) and cancel (requester): pending -> terminal, ONE event `join_request.<status>`. */
async function closeRequest(
  tx: Tx,
  tenantId: string,
  scope: RequestScope,
  status: "rejected" | "cancelled",
  commandType: string,
): Promise<JoinRequestClosedResult> {
  const stored = await replayFor(tx, tenantId, scope, commandType, isStoredClose);
  if (stored !== null) return { requestId: stored.requestId, status, replayed: true };
  const { requestId, sessionId, actor } = scope;
  await lockSession(tx, tenantId, sessionId); // lock order 4.2: sessions before join_requests, as approve
  await lockPending(tx, requestId);
  await decide(tx, requestId, status, actor);
  await emitSessionEvent(tx, tenantId, sessionId, `join_request.${status}`, {
    session_id: sessionId,
    request_id: requestId,
  });
  const record: StoredClose = { sessionId, actorPersonId: actor, requestId };
  await recordCommand(tx, tenantId, scope.commandKey, commandType, record);
  return { requestId, status, replayed: false };
}

export async function rejectJoinRequest(
  db: Db,
  params: DecideJoinRequestParams,
): Promise<JoinRequestClosedResult> {
  return withTenant(db, params.tenantId, async (tx) =>
    closeRequest(tx, params.tenantId, await hostScope(tx, params), "rejected", REJECT_TYPE),
  );
}

export async function cancelJoinRequest(
  db: Db,
  params: CancelJoinRequestParams,
): Promise<JoinRequestClosedResult> {
  return withTenant(db, params.tenantId, async (tx) =>
    closeRequest(tx, params.tenantId, await requesterScope(tx, params), "cancelled", CANCEL_TYPE),
  );
}

/**
 * Host read (4.5, P-12, A-10): session.manage in the tenant, no suspension gate (like other host
 * reads). Unexpired pending rows, oldest first, as `{ requestId, displayName, createdAt }` only:
 * displayName is the requester's live membership name in the tenant, null when there is none.
 */
export async function listPendingJoinRequests(
  db: Db,
  params: ListPendingJoinRequestsParams,
): Promise<PendingJoinRequest[]> {
  const { tenantId, actorPersonId } = params;
  return withTenant(db, tenantId, async (tx) => {
    if (!isUuid(actorPersonId)) return fail("FORBIDDEN", "actor is not authorized");
    const decision = await authorize(tx, { tenantId, action: "session.manage", actorPersonId });
    if (!decision.allowed) return fail("FORBIDDEN", "actor is not authorized");
    if (!isUuid(params.sessionId)) {
      return fail("SESSION_NOT_FOUND", "session not found in tenant context");
    }
    const sessionId = params.sessionId.toLowerCase();
    const [session] = await tx
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.tenantId, tenantId)));
    if (session === undefined) {
      return fail("SESSION_NOT_FOUND", "session not found in tenant context");
    }
    const rows = await tx
      .select({
        requestId: joinRequests.id,
        displayName: memberships.displayName,
        createdAt: joinRequests.createdAt,
      })
      .from(joinRequests)
      .leftJoin(
        memberships,
        and(
          eq(memberships.tenantId, joinRequests.tenantId),
          eq(memberships.personId, joinRequests.personId),
          inArray(memberships.status, ["active", "guest"]),
        ),
      )
      .where(
        and(
          eq(joinRequests.sessionId, sessionId),
          eq(joinRequests.status, "pending"),
          gt(joinRequests.expiresAt, sql`now()`),
        ),
      )
      .orderBy(asc(joinRequests.createdAt), asc(joinRequests.id));
    return rows.map((r) => ({
      requestId: r.requestId,
      displayName: r.displayName,
      createdAt: r.createdAt.toISOString(),
    }));
  });
}

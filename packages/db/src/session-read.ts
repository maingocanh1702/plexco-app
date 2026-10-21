import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  charges,
  memberships,
  paymentAllocations,
  players,
  sessionGuestNotes,
  sessions,
  sports,
} from "../schema.js";
import type { Db } from "./client.js";
import { chargeRemaining } from "./payment-manual.js";
import { effectiveByCharge } from "./roster-money-shared.js";
import {
  activeCountSql,
  getSessionOccupancy,
  occupiedCountSql,
  slotsOpen,
} from "./session-occupancy.js";
import { withTenant } from "./tenant.js";

/**
 * Session READ models for the HOST view (BE tech spec feature_session_management_tech.md §3
 * `GET /api/sessions`, `GET /api/sessions/:id`). Authorization is the CALLER's job (the route runs
 * authorize(session.manage) first); this module guarantees tenant isolation: every query runs in
 * `withTenant` (RLS) AND repeats `tenant_id = $tenant` explicitly, so a missing policy could not
 * widen a read. The one exception is `getSessionOccupancy` (session-occupancy.ts, shared with the
 * commands, `counts.occupied`): it filters by session id only, relying on RLS plus the id already
 * verified in this tenant. Both reads are unlocked, so their counts are advisory.
 *
 * Least disclosure: only the columns named below leave. In particular `public_sessions.
 * confirmed_count` (0033: deliberately NOT exposed) is never selected or projected -- counts are
 * derived here from the tenant's own rows.
 */

export const SESSION_STATUSES = ["draft", "open", "closed", "cancelled"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const SESSION_LIST_DEFAULT_LIMIT = 20;
export const SESSION_LIST_MAX_LIMIT = 50;

export class SessionReadError extends Error {
  constructor(
    readonly code: "INVALID_CURSOR" | "INVALID_STATUS",
    message: string,
  ) {
    super(message);
    this.name = "SessionReadError";
  }
}

/** UTC, microsecond text -- lossless for a timestamptz (a JS Date would truncate to ms and skip rows). */
const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeSessionCursor(startsAt: string, id: string): string {
  return Buffer.from(JSON.stringify([startsAt, id]), "utf8").toString("base64url");
}

/** Returns null for anything that is not exactly an encoded `[startsAt, id]` pair we issued. */
export function decodeSessionCursor(cursor: string): { startsAt: string; id: string } | null {
  if (typeof cursor !== "string" || cursor.length === 0 || cursor.length > 200) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const [startsAt, id] = parsed as unknown[];
    if (typeof startsAt !== "string" || !TS_RE.test(startsAt)) return null;
    // Shape alone is not enough, and Date.parse is too lenient (it rolls 02-29 / 04-31 / 24:00
    // over). Strict round-trip on the ms prefix; the microsecond tail stays untouched.
    const d = new Date(startsAt);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 23) !== startsAt.slice(0, 23)) {
      return null;
    }
    if (d.getUTCFullYear() < 1) return null; // Postgres has no year 0 (22008 -> 5xx)
    if (typeof id !== "string" || !UUID_RE.test(id)) return null;
    return { startsAt, id: id.toLowerCase() };
  } catch {
    return null;
  }
}

export function clampSessionLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return SESSION_LIST_DEFAULT_LIMIT;
  return Math.min(SESSION_LIST_MAX_LIMIT, Math.max(1, Math.trunc(limit)));
}

export interface SessionScalars {
  id: string;
  sportId: string;
  sportKey: string;
  sportName: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  venueName: string | null;
  venueAddress: string | null;
  // DD-139 / B1: the per-session option, host-only view; the public and /me reads enforce it in SQL
  hideExactAddress: boolean;
  area: string | null;
  skillLevel: string | null;
  priceAmount: number;
  slotsMax: number | null;
  visibility: string;
  joinPolicy: string;
  status: string;
  version: number;
  allowPlayerInvite: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** List row = scalars + roster counts (additive, M2b). `occupiedCount` (active players + guest notes)
 *  is the ONE capacity numerator the card shows against `slotsMax`; `activeCount` is players only;
 *  `slotsOpen` = free slots from that same number (null when unlimited). */
export interface SessionListItem extends SessionScalars {
  activeCount: number;
  occupiedCount: number;
  slotsOpen: number | null;
}

export interface SessionListPage {
  sessions: SessionListItem[];
  pageInfo: { hasMore: boolean; nextCursor: string | null };
}

export interface SessionDetail extends SessionScalars {
  /** DD-39 per-gender prices, host / manage read ONLY (never on the list or a public surface);
   *  null = that side charges priceAmount. Prices only, never any person's gender. */
  priceMale: number | null;
  priceFemale: number | null;
  players: {
    id: string;
    membershipId: string;
    displayName: string | null;
    status: string;
    joinedAt: Date;
    waitlistPosition: number | null;
    charge: {
      id: string;
      amountDue: number;
      amountAllocated: number;
      status: string;
      /** SUM of the ledger (reversals are negative rows) -- the host-view truth for what is paid. */
      effectiveAllocated: number;
      /** chargeRemaining (payment-manual.ts): amount_due - effectiveAllocated for a payable charge,
       *  0 for a void one -- the same value close's open-debt guard refuses on when > 0. */
      remaining: number;
      allocations: {
        id: string;
        source: string;
        amount: number;
        createdAt: Date;
        reasonCode: string | null;
        reversesAllocationId: string | null;
      }[];
    } | null;
  }[];
  guestNotes: {
    id: string;
    guestName: string;
    note: string | null;
    createdByPersonId: string;
    createdAt: Date;
  }[];
  /** `occupied` = active players + guest notes: the ONE capacity formula (getSessionOccupancy);
   *  `slotsOpen` = free slots from it, null when slots_max is NULL (unlimited). */
  counts: {
    active: number;
    waitlisted: number;
    guestNotes: number;
    occupied: number;
    slotsOpen: number | null;
  };
}

const scalarColumns = {
  id: sessions.id,
  sportId: sessions.sportId,
  sportKey: sports.key,
  sportName: sports.name,
  startsAt: sessions.startsAt,
  endsAt: sessions.endsAt,
  timezone: sessions.timezone,
  venueName: sessions.venueName,
  venueAddress: sessions.venueAddress,
  hideExactAddress: sessions.hideExactAddress,
  area: sessions.area,
  skillLevel: sessions.skillLevel,
  priceAmount: sessions.priceAmount,
  slotsMax: sessions.slotsMax,
  visibility: sessions.visibility,
  joinPolicy: sessions.joinPolicy,
  status: sessions.status,
  version: sessions.version,
  allowPlayerInvite: sessions.allowPlayerInvite,
  createdAt: sessions.createdAt,
  updatedAt: sessions.updatedAt,
};

export interface ListSessionsParams {
  tenantId: string;
  status?: string;
  cursor?: string;
  limit?: number;
}

/** Newest-first by (starts_at desc, id desc), keyset-paginated. */
export async function listSessions(db: Db, params: ListSessionsParams): Promise<SessionListPage> {
  const { tenantId } = params;
  if (
    params.status !== undefined &&
    !(SESSION_STATUSES as readonly string[]).includes(params.status)
  ) {
    throw new SessionReadError("INVALID_STATUS", "unknown session status filter");
  }
  const after = params.cursor === undefined ? null : decodeSessionCursor(params.cursor);
  if (params.cursor !== undefined && after === null) {
    throw new SessionReadError("INVALID_CURSOR", "malformed cursor");
  }
  const limit = clampSessionLimit(params.limit);

  const rows = await withTenant(db, tenantId, (tx) =>
    tx
      .select({
        ...scalarColumns,
        // Correlated count under the same tenant GUC + explicit tenant filter (least disclosure:
        // a number, never the roster). Active only: waitlisted/left rows do not occupy a slot.
        activeCount: activeCountSql(sessions.id, tenantId),
        // Occupied slots (BL-DSC-1: ONE capacity formula = active players + guest notes, the
        // builder behind getSessionOccupancy). Same tenant GUC + explicit tenant filter (OC-1).
        occupiedCount: occupiedCountSql(sessions.id, tenantId),
        cursorStartsAt: sql<string>`to_char(${sessions.startsAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      })
      .from(sessions)
      .innerJoin(sports, eq(sports.id, sessions.sportId))
      .where(
        and(
          eq(sessions.tenantId, tenantId),
          params.status === undefined ? undefined : eq(sessions.status, params.status),
          after === null
            ? undefined
            : sql`(${sessions.startsAt}, ${sessions.id}) < (${after.startsAt}::timestamptz, ${after.id}::uuid)`,
        ),
      )
      .orderBy(desc(sessions.startsAt), desc(sessions.id))
      .limit(limit + 1),
  );

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    sessions: page.map(({ cursorStartsAt: _omit, ...scalars }) => ({
      ...scalars,
      slotsOpen: slotsOpen(scalars.slotsMax, scalars.occupiedCount),
    })),
    pageInfo: {
      hasMore,
      nextCursor: hasMore && last ? encodeSessionCursor(last.cursorStartsAt, last.id) : null,
    },
  };
}

export interface GetSessionDetailParams {
  tenantId: string;
  sessionId: string;
}

/** Host detail view; null when the session does not exist IN THIS TENANT (RLS + explicit filter). */
export async function getSessionDetail(
  db: Db,
  params: GetSessionDetailParams,
): Promise<SessionDetail | null> {
  const { tenantId, sessionId } = params;
  if (!UUID_RE.test(sessionId)) return null;

  return withTenant(db, tenantId, async (tx) => {
    // scalarColumns stays shared with listSessions; the per-gender prices join the detail only.
    const [head] = await tx
      .select({
        ...scalarColumns,
        priceMale: sessions.priceMale,
        priceFemale: sessions.priceFemale,
      })
      .from(sessions)
      .innerJoin(sports, eq(sports.id, sessions.sportId))
      .where(and(eq(sessions.tenantId, tenantId), eq(sessions.id, sessionId)));
    if (!head) return null;

    const roster = await tx
      .select({
        id: players.id,
        membershipId: players.membershipId,
        displayName: memberships.displayName,
        status: players.status,
        joinedAt: players.joinedAt,
        waitlistPosition: players.waitlistPosition,
        chargeId: charges.id,
        amountDue: charges.amountDue,
        amountAllocated: charges.amountAllocated,
        chargeStatus: charges.status,
      })
      .from(players)
      .innerJoin(
        memberships,
        and(eq(memberships.id, players.membershipId), eq(memberships.tenantId, tenantId)),
      )
      .leftJoin(
        charges,
        and(
          eq(charges.playerId, players.id),
          eq(charges.sessionId, players.sessionId),
          eq(charges.tenantId, tenantId),
        ),
      )
      .where(and(eq(players.tenantId, tenantId), eq(players.sessionId, sessionId)))
      .orderBy(asc(players.joinedAt), asc(players.id));

    const notes = await tx
      .select({
        id: sessionGuestNotes.id,
        guestName: sessionGuestNotes.guestName,
        note: sessionGuestNotes.note,
        createdByPersonId: sessionGuestNotes.createdByPersonId,
        createdAt: sessionGuestNotes.createdAt,
      })
      .from(sessionGuestNotes)
      .where(
        and(eq(sessionGuestNotes.tenantId, tenantId), eq(sessionGuestNotes.sessionId, sessionId)),
      )
      .orderBy(asc(sessionGuestNotes.createdAt), asc(sessionGuestNotes.id));

    // Host view only (HR2: money never reaches a public surface -- this module backs the
    // authenticated host routes). One query for the whole session, grouped in memory.
    const ledger = await tx
      .select({
        id: paymentAllocations.id,
        chargeId: paymentAllocations.chargeId,
        source: paymentAllocations.source,
        amount: paymentAllocations.amount,
        createdAt: paymentAllocations.createdAt,
        reasonCode: paymentAllocations.reasonCode,
        reversesAllocationId: paymentAllocations.reversesAllocationId,
      })
      .from(paymentAllocations)
      .innerJoin(charges, eq(charges.id, paymentAllocations.chargeId))
      .where(and(eq(charges.tenantId, tenantId), eq(charges.sessionId, sessionId)))
      .orderBy(asc(paymentAllocations.createdAt), asc(paymentAllocations.id));
    const allocationsByCharge = new Map<string, typeof ledger>();
    for (const row of ledger) {
      const list = allocationsByCharge.get(row.chargeId) ?? [];
      list.push(row);
      allocationsByCharge.set(row.chargeId, list);
    }

    // The canonical effective-amount derivation (never re-derived here): SUM of the ledger.
    const effectiveById = await effectiveByCharge(
      tx,
      roster.flatMap((r) => (r.chargeId === null ? [] : [r.chargeId])),
    );

    const mapped = roster.map((r) => ({
      id: r.id,
      membershipId: r.membershipId,
      displayName: r.displayName,
      status: r.status,
      joinedAt: r.joinedAt,
      waitlistPosition: r.waitlistPosition,
      charge:
        r.chargeId === null
          ? null
          : (() => {
              const rows = allocationsByCharge.get(r.chargeId) ?? [];
              const effectiveAllocated = effectiveById.get(r.chargeId) ?? 0;
              return {
                id: r.chargeId,
                amountDue: r.amountDue as number,
                amountAllocated: r.amountAllocated as number,
                status: r.chargeStatus as string,
                effectiveAllocated,
                // THE remaining formula, shared with close's open-debt guard (never inlined here)
                remaining: chargeRemaining(
                  r.amountDue as number,
                  effectiveAllocated,
                  r.chargeStatus as string,
                ),
                allocations: rows.map(({ chargeId: _c, ...a }) => a),
              };
            })(),
    }));
    const occupied = await getSessionOccupancy(tx, sessionId);
    return {
      ...head,
      players: mapped,
      guestNotes: notes,
      counts: {
        active: mapped.filter((p) => p.status === "active").length,
        waitlisted: mapped.filter((p) => p.status === "waitlisted").length,
        guestNotes: notes.length,
        occupied,
        slotsOpen: slotsOpen(head.slotsMax, occupied),
      },
    };
  });
}

import { and, asc, desc, eq, sql } from "drizzle-orm";
import { charges, memberships, players, sessionGuestNotes, sessions, sports } from "../schema.js";
import type { Db } from "./client.js";
import { withTenant } from "./tenant.js";

/**
 * Session READ models for the HOST view (BE tech spec feature_session_management_tech.md §3
 * `GET /api/sessions`, `GET /api/sessions/:id`). Authorization is the CALLER's job (the route runs
 * authorize(session.manage) first); this module guarantees tenant isolation: every query runs in
 * `withTenant` (RLS) AND repeats `tenant_id = $tenant` explicitly, so a missing policy could not
 * widen a read.
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

export interface SessionListPage {
  sessions: SessionScalars[];
  pageInfo: { hasMore: boolean; nextCursor: string | null };
}

export interface SessionDetail extends SessionScalars {
  players: {
    id: string;
    membershipId: string;
    displayName: string | null;
    status: string;
    joinedAt: Date;
    waitlistPosition: number | null;
    charge: { id: string; amountDue: number; amountAllocated: number; status: string } | null;
  }[];
  guestNotes: {
    id: string;
    guestName: string;
    note: string | null;
    createdByPersonId: string;
    createdAt: Date;
  }[];
  counts: { active: number; waitlisted: number; guestNotes: number };
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
    sessions: page.map(({ cursorStartsAt: _omit, ...scalars }) => scalars),
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
    const [head] = await tx
      .select(scalarColumns)
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
      .innerJoin(memberships, eq(memberships.id, players.membershipId))
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
          : {
              id: r.chargeId,
              amountDue: r.amountDue as number,
              amountAllocated: r.amountAllocated as number,
              status: r.chargeStatus as string,
            },
    }));
    return {
      ...head,
      players: mapped,
      guestNotes: notes,
      counts: {
        active: mapped.filter((p) => p.status === "active").length,
        waitlisted: mapped.filter((p) => p.status === "waitlisted").length,
        guestNotes: notes.length,
      },
    };
  });
}

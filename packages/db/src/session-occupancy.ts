import { sql, type AnyColumn, type SQL } from "drizzle-orm";
import { players, sessionGuestNotes } from "../schema.js";
import type { Tx } from "./client.js";

/**
 * THE occupancy authority, stage 1 (DD-133 (a), DD-32 amend): ONE formula for the occupied slots of
 * a session, shared by every capacity decision (updateSession CAPACITY_BELOW_OCCUPANCY,
 * createGuestNote SESSION_FULL, deleteGuestNote occupancy_after, addMemberToSession waitlisting)
 * and by the host read models (listSessions occupiedCount, getSessionDetail counts.occupied).
 * Internal to packages/db: NOT exported from index.ts.
 *
 * occupied = active players + guest notes. The spec's formula is `active + pending players + guest
 * notes + live holds`. Two of its four terms are STRUCTURALLY zero at this base and are therefore not
 * queried:
 *  - `pending` is not a live players.status value. 0014_players_waitlist.sql pins players_status_chk
 *    to exactly ('active','left','waitlisted') and no later migration touches it, so a pending row
 *    cannot exist to be counted (one stale doc comment at feature_session_management_tech.md:174
 *    says otherwise; the constraint is the authority). A pending join_requests row is not a player.
 *  - `live holds` has no table anywhere in schema.ts or the migrations — payment holds are not
 *    built.
 * Both terms return here with the migrations that make them representable. Counting a column that
 * does not exist is not possible; pretending to count one would be worse.
 *
 * Lock order: a capacity DECISION calls the scalar wrappers inside its own `withTenant` transaction
 * AFTER `sessions ... FOR UPDATE` (every players / guest-note writer serializes on that row lock).
 * Unlocked reads (the host list and detail) are advisory: they never admit anyone.
 */

/** A session id: a column for a correlated subquery (the list) or a bound uuid (the commands). */
type SessionRef = AnyColumn | SQL | string;

/** OC-1: the list repeats its explicit tenant filter on top of RLS; the wrappers filter by session
 *  id only (RLS plus a session id the caller already holds in its tenant). */
const tenantTerm = (column: AnyColumn, tenantId: string | undefined): SQL =>
  tenantId === undefined ? sql.empty() : sql` and ${column} = ${tenantId}`;

/** Active players of a session: waitlisted and left rows never occupy a slot. */
export function activeCountSql(sessionId: SessionRef, tenantId?: string): SQL<number> {
  return sql<number>`(select count(*)::int from ${players} where ${players.sessionId} = ${sessionId}${tenantTerm(players.tenantId, tenantId)} and ${players.status} = 'active')`;
}

/** THE formula as one SQL expression: active players + guest notes. The only per-session
 *  guest-note count in production code. */
export function occupiedCountSql(sessionId: SessionRef, tenantId?: string): SQL<number> {
  return sql<number>`(${activeCountSql(sessionId, tenantId)} + (select count(*)::int from ${sessionGuestNotes} where ${sessionGuestNotes.sessionId} = ${sessionId}${tenantTerm(sessionGuestNotes.tenantId, tenantId)}))::int`;
}

/** One statement per wrapper (OC-2), inside the caller's transaction. */
async function scalar(tx: Tx, expr: SQL<number>): Promise<number> {
  const result = await tx.execute(sql`select ${expr} as n`);
  return Number((result.rows[0] as { n: number | string }).n);
}

/** CANONICAL active-roster count: read by updateSession's CAPACITY_BELOW_ROSTER guard AND by
 *  cancelSession (so the two can never drift on separate formulas). Gate #3 (owner, 2026-08-26)
 *  makes a non-zero active roster a fail-closed REFUSAL on the open cancel path, so on cancel's
 *  clean path this is 0. NOT the draft-anomaly probe: that needs ANY player, active or not
 *  (session-service.ts sessionHasAnyPlayer). */
export function sessionActiveRosterCount(tx: Tx, sessionId: string): Promise<number> {
  return scalar(tx, activeCountSql(sessionId));
}

/** Live occupancy of a session, the shared denominator behind SESSION_FULL (§4 step 5/7, edge
 *  #39), CAPACITY_BELOW_OCCUPANCY and the waitlist decision. One number, never a per-term breakdown. */
export function getSessionOccupancy(tx: Tx, sessionId: string): Promise<number> {
  return scalar(tx, occupiedCountSql(sessionId));
}

/** Free slots (pure): NULL when slots_max is NULL (unlimited), else max(0, slots_max - occupied). */
export function slotsOpen(slotsMax: number | null, occupied: number): number | null {
  return slotsMax === null ? null : Math.max(0, slotsMax - occupied);
}

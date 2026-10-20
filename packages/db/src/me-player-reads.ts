import type pg from "pg";
import { chargeRemaining, chargeStatusFor } from "./payment-manual.js";

/**
 * The signed-in player's own cross-club reads (Phase 3 lane L9, M9): my clubs, my sessions, my open
 * charges and my join requests. Everything goes through the 0059/0066 definers keyed by
 * the ACCOUNT id taken from the verified session (me-settings.ts precedent): no function takes a
 * person, tenant or membership id, and the definers filter every row by the caller's own person,
 * tenant by tenant. Own money only: another person's charge never leaves the database.
 *
 * Lists are ordered here (M-6) and capped at cap + 1 rows (M-5): `truncated` says the cap cut them.
 * Each SELECT list below IS the DTO allowlist (toDto only renames and formats). Money follows the
 * readiness contract section 4.3: a value that cannot be derived is `unknown`, never 0, and an
 * unknown club makes the whole summary unknown (no partial sum).
 */
const CLUBS_CAP = 100;
/** Each is also its 0059 definer's per-tenant LIMIT (cap + 1); the M-5 catalog test pins the pair. */
export const SESSIONS_CAP = 50;
export const REQUESTS_CAP = 50;
export const OPEN_CHARGES_CAP = 200;

export interface MyClub {
  clubRef: string;
  clubLabel: string;
  membershipStatus: "active" | "guest";
}

export interface MySession {
  sessionId: string;
  clubRef: string;
  clubLabel: string;
  sportKey: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  area: string | null;
  myStatus: "active" | "waitlisted" | "pending";
  /** waitlisted only */
  waitlistPosition: number | null;
  /** both null unless myStatus is "active" (enforced in SQL) */
  venueName: string | null;
  venueAddress: string | null;
}

export interface MyJoinRequest {
  requestId: string;
  sessionId: string;
  clubRef: string;
  clubLabel: string;
  startsAt: string;
  area: string | null;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  decidedAt: string | null;
  expiresAt: string;
}

export interface MyChargeItem {
  sessionRef: string;
  startsAt: string;
  amountDue: number;
  amountAllocated: number;
  remaining: number;
  status: "open" | "partial";
}

type Unknown = {
  kind: "unknown";
  reasonCode: "LEDGER_INCONSISTENT" | "TOO_MANY_OPEN_CHARGES" | "READ_FAILED";
  retryable: boolean;
};
type KnownZero = { kind: "known_zero"; currency: "VND"; asOf: string };
type Amount = { kind: "known_amount"; currency: "VND"; totalOutstanding: number; asOf: string };

export type SelfPaymentStatus =
  KnownZero | (Amount & { chargeCount: number; items: MyChargeItem[] }) | Unknown;
export type SelfPaymentSummary = KnownZero | (Amount & { clubCount: number }) | Unknown;

export interface MyClubCharges {
  clubRef: string;
  clubLabel: string;
  status: SelfPaymentStatus;
}

export interface MyCharges {
  clubs: MyClubCharges[];
  summary: SelfPaymentSummary;
}

const unknown = (reasonCode: Unknown["reasonCode"], retryable = false): Unknown => ({
  kind: "unknown",
  reasonCode,
  retryable,
});

/** snake_case row -> camelCase DTO with timestamps as ISO strings; adds and drops nothing. */
function toDto<T>(row: Record<string, unknown>): T {
  const dto: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const camel = key.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
    dto[camel] = value instanceof Date ? value.toISOString() : value;
  }
  return dto as T;
}

async function capped<T>(pool: pg.Pool, sql: string, accountId: string, cap: number) {
  const { rows } = await pool.query(`${sql} LIMIT $2`, [accountId, cap + 1]);
  return { items: rows.slice(0, cap).map((row) => toDto<T>(row)), truncated: rows.length > cap };
}

const CLUBS_SQL = `SELECT club_ref, club_label, membership_status FROM account_my_clubs($1::uuid)`;

/** Own active|guest memberships (M-1), by (club_label, club_ref) in code-unit order. */
export async function listMyClubs(
  pool: pg.Pool,
  accountId: string,
): Promise<{ clubs: MyClub[]; truncated: boolean }> {
  const sql = `${CLUBS_SQL} ORDER BY club_label COLLATE "C", club_ref COLLATE "C"`;
  const { items, truncated } = await capped<MyClub>(pool, sql, accountId, CLUBS_CAP);
  return { clubs: items, truncated };
}

const CHAT_CONTEXT_SQL = `SELECT c.tenant_id, c.timezone FROM public.account_club_chat_context($1, $2) c`;

/**
 * The tenant id and time zone of the club whose slug is clubRef, only while the caller holds an
 * ACTIVE membership there (lane L16c, 0066); every deny is null, one shape for all of them. A
 * convenience for the member chat page, never a grant: the chat API's live-membership gate stays the
 * authorization. Logs nothing, so the slug never meets the account in a log line or an error.
 */
export async function readMyClubChatContext(
  pool: pg.Pool,
  accountId: string,
  clubRef: string,
): Promise<{ tenantId: string; timezone: string } | null> {
  const { rows } = await pool.query(CHAT_CONTEXT_SQL, [accountId, clubRef]);
  // The unique slug and memberships_active_person_unique allow one row (0066); more fails closed.
  if (rows.length > 1) throw new Error("account_club_chat_context returned more than one row");
  return rows[0] ? toDto<{ tenantId: string; timezone: string }>(rows[0]) : null;
}

/** Own seats and pending requests on open sessions not yet ended (M-3), by (starts_at, session_id). */
export async function listMySessions(
  pool: pg.Pool,
  accountId: string,
): Promise<{ sessions: MySession[]; truncated: boolean }> {
  const sql = `SELECT session_id, club_ref, club_label, sport_key, starts_at, ends_at, timezone, area,
                      my_status, waitlist_position, venue_name, venue_address
                 FROM account_my_sessions($1::uuid) ORDER BY starts_at, session_id`;
  const { items, truncated } = await capped<MySession>(pool, sql, accountId, SESSIONS_CAP);
  return { sessions: items, truncated };
}

/** Own pending|approved|rejected requests on sessions not yet ended (M-4), newest first. */
export async function listMyJoinRequests(
  pool: pg.Pool,
  accountId: string,
): Promise<{ requests: MyJoinRequest[]; truncated: boolean }> {
  const sql = `SELECT request_id, session_id, club_ref, club_label, starts_at, area, status,
                      created_at, decided_at, expires_at
                 FROM account_my_join_requests($1::uuid) ORDER BY created_at DESC, request_id DESC`;
  const { items, truncated } = await capped<MyJoinRequest>(pool, sql, accountId, REQUESTS_CAP);
  return { requests: items, truncated };
}

type ClubRow = { club_ref: string; club_label: string };
type ChargeRow = ClubRow & {
  session_id: string;
  starts_at: Date;
  amount_due: number | null;
  amount_allocated: number | null;
  effective_allocated: number | null;
  charge_status: string;
};

/** A consistent open|partial charge, or null when its amounts cannot be derived (section 4.3). */
function chargeItem(r: ChargeRow): MyChargeItem | null {
  const { amount_due: due, effective_allocated: effective, charge_status: status } = r;
  if (
    !Number.isInteger(due) ||
    !Number.isInteger(effective) ||
    due === null ||
    effective === null
  ) {
    return null;
  }
  if (effective !== r.amount_allocated || effective < 0 || effective > due) return null;
  if ((status !== "open" && status !== "partial") || chargeStatusFor(due, effective) !== status) {
    return null;
  }
  const remaining = chargeRemaining(due, effective, status);
  const startsAt = r.starts_at.toISOString();
  return {
    sessionRef: r.session_id,
    startsAt,
    amountDue: due,
    amountAllocated: effective,
    remaining,
    status,
  };
}

function clubStatus(rows: ChargeRow[], asOf: string): SelfPaymentStatus {
  if (rows.length === 0) return { kind: "known_zero", currency: "VND", asOf };
  const items = rows.map(chargeItem);
  if (items.some((i) => i === null)) return unknown("LEDGER_INCONSISTENT");
  const known = items as MyChargeItem[];
  const totalOutstanding = known.reduce((sum, i) => sum + i.remaining, 0);
  return {
    kind: "known_amount",
    currency: "VND",
    totalOutstanding,
    chargeCount: known.length,
    items: known,
    asOf,
  };
}

const byCodeUnits = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Own open|partial charges through ANY own membership (M-2), per club and summed across clubs.
 * One REPEATABLE READ READ ONLY snapshot covers the club set and the charges; any failure is
 * `unknown READ_FAILED` (retryable) and the client is discarded, never reused mid-transaction.
 */
export async function readMyCharges(pool: pg.Pool, accountId: string): Promise<MyCharges> {
  let client: pg.PoolClient | undefined;
  let clubRows: ClubRow[];
  let chargeRows: ChargeRow[];
  try {
    client = await pool.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    clubRows = (await client.query<ClubRow>(CLUBS_SQL, [accountId])).rows;
    const sql = `SELECT club_ref, club_label, session_id, starts_at, amount_due, amount_allocated,
                        effective_allocated, charge_status
                   FROM account_my_open_charges($1::uuid) ORDER BY starts_at, session_id LIMIT $2`;
    chargeRows = (await client.query<ChargeRow>(sql, [accountId, OPEN_CHARGES_CAP + 1])).rows;
    await client.query("COMMIT");
  } catch {
    await client?.query("ROLLBACK").catch(() => undefined);
    client?.release(true);
    return { clubs: [], summary: unknown("READ_FAILED", true) };
  }
  client.release();
  if (chargeRows.length > OPEN_CHARGES_CAP) {
    return { clubs: [], summary: unknown("TOO_MANY_OPEN_CHARGES") };
  }

  const asOf = new Date().toISOString();
  // The club set: own active|guest clubs (known_zero without an open charge) plus every club where
  // an own open charge exists (a left or merged membership still owes, M-2). Keyed by club_ref.
  const clubs = new Map<string, { clubLabel: string; rows: ChargeRow[] }>();
  for (const c of clubRows) clubs.set(c.club_ref, { clubLabel: c.club_label, rows: [] });
  for (const r of chargeRows) {
    const club = clubs.get(r.club_ref) ?? { clubLabel: r.club_label, rows: [] };
    club.rows.push(r);
    clubs.set(r.club_ref, club);
  }
  const list: MyClubCharges[] = [...clubs]
    .map(([clubRef, c]) => ({ clubRef, clubLabel: c.clubLabel, status: clubStatus(c.rows, asOf) }))
    .sort((a, b) => byCodeUnits(a.clubLabel, b.clubLabel) || byCodeUnits(a.clubRef, b.clubRef));

  if (list.some((c) => c.status.kind === "unknown")) {
    return { clubs: list, summary: unknown("LEDGER_INCONSISTENT") };
  }
  // A known_amount club always owes > 0 (open|partial on a consistent ledger), so clubCount counts
  // exactly the clubs with totalOutstanding > 0 and 0 clubs owing means every club is known_zero.
  const owing = list.flatMap((c) => (c.status.kind === "known_amount" ? [c.status] : []));
  const totalOutstanding = owing.reduce((sum, s) => sum + s.totalOutstanding, 0);
  const summary: SelfPaymentSummary =
    owing.length === 0
      ? { kind: "known_zero", currency: "VND", asOf }
      : { kind: "known_amount", currency: "VND", totalOutstanding, clubCount: owing.length, asOf };
  return { clubs: list, summary };
}

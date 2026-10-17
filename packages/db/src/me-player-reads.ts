import type pg from "pg";
import { chargeRemaining, chargeStatusFor } from "./payment-manual.js";

/**
 * The signed-in player's own cross-club reads (Phase 3 lane L9, M9): my clubs, my sessions, my open
 * charges and my join requests. Everything goes through the 0059 SECURITY DEFINER functions keyed by
 * the ACCOUNT id taken from the verified session (me-settings.ts precedent): no function takes a
 * person, tenant or membership id, and the definers filter every row by the caller's own person,
 * tenant by tenant. Own money only: another person's charge never leaves the database.
 *
 * Lists are ordered here (M-6) and capped at cap + 1 rows (M-5): `truncated` says the cap cut them.
 * Money follows the readiness contract section 4.3: a value that cannot be derived is `unknown`,
 * never 0, and an unknown club makes the whole summary unknown (no partial sum).
 */
const CLUBS_CAP = 100;
const SESSIONS_CAP = 50;
const REQUESTS_CAP = 50;
const OPEN_CHARGES_CAP = 200;

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

export type SelfPaymentStatus =
  | KnownZero
  | {
      kind: "known_amount";
      currency: "VND";
      totalOutstanding: number;
      chargeCount: number;
      items: MyChargeItem[];
      asOf: string;
    }
  | Unknown;

export type SelfPaymentSummary =
  | KnownZero
  | {
      kind: "known_amount";
      currency: "VND";
      totalOutstanding: number;
      clubCount: number;
      asOf: string;
    }
  | Unknown;

export interface MyClubCharges {
  clubRef: string;
  clubLabel: string;
  status: SelfPaymentStatus;
}

export interface MyCharges {
  clubs: MyClubCharges[];
  summary: SelfPaymentSummary;
}

const iso = (v: Date | string): string => new Date(v).toISOString();
const unknown = (reasonCode: Unknown["reasonCode"], retryable = false): Unknown => ({
  kind: "unknown",
  reasonCode,
  retryable,
});

async function capped<R extends pg.QueryResultRow, T>(
  pool: pg.Pool,
  sql: string,
  accountId: string,
  cap: number,
  map: (row: R) => T,
): Promise<{ items: T[]; truncated: boolean }> {
  const { rows } = await pool.query<R>(sql, [accountId, cap + 1]);
  return { items: rows.slice(0, cap).map(map), truncated: rows.length > cap };
}

type ClubRow = {
  club_ref: string;
  club_label: string;
  membership_status: "active" | "guest";
};

const CLUBS_SQL = `SELECT club_ref, club_label, membership_status FROM account_my_clubs($1::uuid)`;

/** Own active|guest memberships (M-1), by (club_label, club_ref) in code-unit order. */
export async function listMyClubs(
  pool: pg.Pool,
  accountId: string,
): Promise<{ clubs: MyClub[]; truncated: boolean }> {
  const { items, truncated } = await capped<ClubRow, MyClub>(
    pool,
    `${CLUBS_SQL} ORDER BY club_label COLLATE "C", club_ref COLLATE "C" LIMIT $2`,
    accountId,
    CLUBS_CAP,
    (r) => ({
      clubRef: r.club_ref,
      clubLabel: r.club_label,
      membershipStatus: r.membership_status,
    }),
  );
  return { clubs: items, truncated };
}

/** Own seats and pending requests on open sessions not yet ended (M-3), by (starts_at, session_id). */
export async function listMySessions(
  pool: pg.Pool,
  accountId: string,
): Promise<{ sessions: MySession[]; truncated: boolean }> {
  const { items, truncated } = await capped(
    pool,
    `SELECT session_id, club_ref, club_label, sport_key, starts_at, ends_at, timezone, area,
            my_status, waitlist_position, venue_name, venue_address
       FROM account_my_sessions($1::uuid) ORDER BY starts_at, session_id LIMIT $2`,
    accountId,
    SESSIONS_CAP,
    (r: {
      session_id: string;
      club_ref: string;
      club_label: string;
      sport_key: string;
      starts_at: Date;
      ends_at: Date;
      timezone: string;
      area: string | null;
      my_status: MySession["myStatus"];
      waitlist_position: number | null;
      venue_name: string | null;
      venue_address: string | null;
    }): MySession => ({
      sessionId: r.session_id,
      clubRef: r.club_ref,
      clubLabel: r.club_label,
      sportKey: r.sport_key,
      startsAt: iso(r.starts_at),
      endsAt: iso(r.ends_at),
      timezone: r.timezone,
      area: r.area,
      myStatus: r.my_status,
      waitlistPosition: r.waitlist_position,
      venueName: r.venue_name,
      venueAddress: r.venue_address,
    }),
  );
  return { sessions: items, truncated };
}

/** Own pending|approved|rejected requests on sessions not yet ended (M-4), newest first. */
export async function listMyJoinRequests(
  pool: pg.Pool,
  accountId: string,
): Promise<{ requests: MyJoinRequest[]; truncated: boolean }> {
  const { items, truncated } = await capped(
    pool,
    `SELECT request_id, session_id, club_ref, club_label, starts_at, area, status, created_at,
            decided_at, expires_at
       FROM account_my_join_requests($1::uuid) ORDER BY created_at DESC, request_id DESC LIMIT $2`,
    accountId,
    REQUESTS_CAP,
    (r: {
      request_id: string;
      session_id: string;
      club_ref: string;
      club_label: string;
      starts_at: Date;
      area: string | null;
      status: MyJoinRequest["status"];
      created_at: Date;
      decided_at: Date | null;
      expires_at: Date;
    }): MyJoinRequest => ({
      requestId: r.request_id,
      sessionId: r.session_id,
      clubRef: r.club_ref,
      clubLabel: r.club_label,
      startsAt: iso(r.starts_at),
      area: r.area,
      status: r.status,
      createdAt: iso(r.created_at),
      decidedAt: r.decided_at === null ? null : iso(r.decided_at),
      expiresAt: iso(r.expires_at),
    }),
  );
  return { requests: items, truncated };
}

type ChargeRow = {
  club_ref: string;
  club_label: string;
  session_id: string;
  starts_at: Date;
  amount_due: number | null;
  amount_allocated: number | null;
  effective_allocated: number | null;
  charge_status: string;
};

/** A consistent open|partial charge, or null when its amounts cannot be derived (section 4.3). */
function chargeItem(r: ChargeRow): MyChargeItem | null {
  const due = r.amount_due;
  const effective = r.effective_allocated;
  const status = r.charge_status;
  if (typeof due !== "number" || typeof effective !== "number") return null;
  if (!Number.isInteger(due) || !Number.isInteger(effective)) return null;
  if (effective !== r.amount_allocated || effective < 0 || effective > due) return null;
  if ((status !== "open" && status !== "partial") || chargeStatusFor(due, effective) !== status) {
    return null;
  }
  return {
    sessionRef: r.session_id,
    startsAt: iso(r.starts_at),
    amountDue: due,
    amountAllocated: effective,
    remaining: chargeRemaining(due, effective, status),
    status,
  };
}

function clubStatus(rows: ChargeRow[], asOf: string): SelfPaymentStatus {
  if (rows.length === 0) return { kind: "known_zero", currency: "VND", asOf };
  const items: MyChargeItem[] = [];
  for (const row of rows) {
    const item = chargeItem(row);
    if (!item) return unknown("LEDGER_INCONSISTENT");
    items.push(item);
  }
  const totalOutstanding = items.reduce((sum, i) => sum + i.remaining, 0);
  return {
    kind: "known_amount",
    currency: "VND",
    totalOutstanding,
    chargeCount: items.length,
    items,
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
    chargeRows = (
      await client.query<ChargeRow>(
        `SELECT club_ref, club_label, session_id, starts_at, amount_due, amount_allocated,
                effective_allocated, charge_status
           FROM account_my_open_charges($1::uuid) ORDER BY starts_at, session_id LIMIT $2`,
        [accountId, OPEN_CHARGES_CAP + 1],
      )
    ).rows;
    await client.query("COMMIT");
  } catch {
    if (client) {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release(true);
    }
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
  let totalOutstanding = 0;
  let clubCount = 0;
  for (const c of list) {
    if (c.status.kind === "known_amount" && c.status.totalOutstanding > 0) {
      totalOutstanding += c.status.totalOutstanding;
      clubCount += 1;
    }
  }
  const summary: SelfPaymentSummary =
    clubCount === 0
      ? { kind: "known_zero", currency: "VND", asOf }
      : { kind: "known_amount", currency: "VND", totalOutstanding, clubCount, asOf };
  return { clubs: list, summary };
}

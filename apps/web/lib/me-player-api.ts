import {
  badResponse,
  num,
  oneOf,
  readData,
  rec,
  required,
  rows,
  str,
  type Rec,
} from "./discover-api";

/**
 * Read client for the player's own pages (L12): my clubs, sessions, charges and join requests.
 * Shapes mirror packages/db/src/me-player-reads.ts and follow the rules of discover-api.ts: rebuilt
 * key by key, an unknown enum value is null, a row without its required keys fails the whole read.
 * Fields that depend on state are cut here as well, not only in SQL: a venue is kept only for an
 * active seat, a position only for a waitlisted one, an expiry only for a pending request.
 */

export interface MyClub {
  clubRef: string;
  clubLabel: string;
  membershipStatus: "active" | "guest" | null;
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
  myStatus: "active" | "waitlisted" | "pending" | null;
  waitlistPosition: number | null;
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
  status: "pending" | "approved" | "rejected" | null;
  createdAt: string;
  decidedAt: string | null;
  expiresAt: string | null;
}

export interface MyChargeItem {
  sessionRef: string;
  startsAt: string;
  amountDue: number;
  amountAllocated: number;
  remaining: number;
  status: "open" | "partial" | null;
}

/** The server could not tell, or its answer could not be trusted: no amount is shown, never 0. */
export interface AmountUnavailable {
  kind: "unknown";
  reasonCode: "LEDGER_INCONSISTENT" | "TOO_MANY_OPEN_CHARGES" | "READ_FAILED";
  retryable: boolean;
}
interface KnownZero {
  kind: "known_zero";
  currency: "VND";
  asOf: string;
}
interface KnownAmount {
  kind: "known_amount";
  currency: "VND";
  totalOutstanding: number;
  asOf: string;
}
export type SelfPaymentStatus =
  KnownZero | (KnownAmount & { chargeCount: number; items: MyChargeItem[] }) | AmountUnavailable;
export type SelfPaymentSummary =
  KnownZero | (KnownAmount & { clubCount: number }) | AmountUnavailable;

export interface MyClubCharges {
  clubRef: string;
  clubLabel: string;
  status: SelfPaymentStatus;
}

export interface MyCharges {
  clubs: MyClubCharges[];
  summary: SelfPaymentSummary;
}

const MEMBERSHIPS = ["active", "guest"] as const;
const SEATS = ["active", "waitlisted", "pending"] as const;
const REQUEST_STATUSES = ["pending", "approved", "rejected"] as const;
const ITEM_STATUSES = ["open", "partial"] as const;
const REASONS = ["LEDGER_INCONSISTENT", "TOO_MANY_OPEN_CHARGES", "READ_FAILED"] as const;

const unavailable = (): AmountUnavailable => ({
  kind: "unknown",
  reasonCode: "READ_FAILED",
  retryable: false,
});

function parseClub(value: unknown): MyClub {
  const row = rec(value);
  const keys = required(row, ["clubRef", "clubLabel"]);
  if (!row || !keys) throw badResponse();
  return { ...keys, membershipStatus: oneOf(row.membershipStatus, MEMBERSHIPS) };
}

function parseSession(value: unknown): MySession {
  const row = rec(value);
  const keys = required(row, [
    "sessionId",
    "clubRef",
    "clubLabel",
    "sportKey",
    "startsAt",
    "endsAt",
    "timezone",
  ]);
  if (!row || !keys) throw badResponse();
  const myStatus = oneOf(row.myStatus, SEATS);
  return {
    ...keys,
    area: str(row.area),
    myStatus,
    waitlistPosition: myStatus === "waitlisted" ? num(row.waitlistPosition) : null,
    venueName: myStatus === "active" ? str(row.venueName) : null,
    venueAddress: myStatus === "active" ? str(row.venueAddress) : null,
  };
}

function parseRequest(value: unknown): MyJoinRequest {
  const row = rec(value);
  const keys = required(row, [
    "requestId",
    "sessionId",
    "clubRef",
    "clubLabel",
    "startsAt",
    "createdAt",
  ]);
  if (!row || !keys) throw badResponse();
  const status = oneOf(row.status, REQUEST_STATUSES);
  return {
    ...keys,
    area: str(row.area),
    status,
    decidedAt: str(row.decidedAt),
    expiresAt: status === "pending" ? str(row.expiresAt) : null,
  };
}

function parseItem(value: unknown): MyChargeItem | null {
  const row = rec(value);
  const keys = required(row, ["sessionRef", "startsAt"]);
  const amountDue = num(row?.amountDue);
  const amountAllocated = num(row?.amountAllocated);
  const remaining = num(row?.remaining);
  if (!row || !keys || amountDue === null || amountAllocated === null || remaining === null) {
    return null;
  }
  return {
    ...keys,
    amountDue,
    amountAllocated,
    remaining,
    status: oneOf(row.status, ITEM_STATUSES),
  };
}

/** The amount states every money read shares; anything not provably known becomes unavailable. */
function parseAmountState(row: Rec | null): KnownZero | KnownAmount | AmountUnavailable {
  if (row?.kind === "unknown") {
    return {
      kind: "unknown",
      reasonCode: oneOf(row.reasonCode, REASONS) ?? "READ_FAILED",
      retryable: row.retryable === true,
    };
  }
  const asOf = str(row?.asOf);
  if (!row || row.currency !== "VND" || asOf === null) return unavailable();
  if (row.kind === "known_zero") return { kind: "known_zero", currency: "VND", asOf };
  const totalOutstanding = num(row.totalOutstanding);
  // A known_amount club always owes more than 0 (me-player-reads.ts): 0 or below is not provably known.
  if (row.kind !== "known_amount" || totalOutstanding === null || totalOutstanding <= 0) {
    return unavailable();
  }
  return { kind: "known_amount", currency: "VND", totalOutstanding, asOf };
}

function parseClubStatus(value: unknown): SelfPaymentStatus {
  const row = rec(value);
  const state = parseAmountState(row);
  if (state.kind !== "known_amount") return state;
  const chargeCount = num(row?.chargeCount);
  const list = row?.items;
  const items = Array.isArray(list) ? list.map(parseItem) : [null];
  if (chargeCount === null || !items.every((item): item is MyChargeItem => item !== null)) {
    return unavailable();
  }
  return { ...state, chargeCount, items };
}

function parseSummary(value: unknown): SelfPaymentSummary {
  const row = rec(value);
  const state = parseAmountState(row);
  if (state.kind !== "known_amount") return state;
  const clubCount = num(row?.clubCount);
  return clubCount === null ? unavailable() : { ...state, clubCount };
}

function parseClubCharges(value: unknown): MyClubCharges {
  const row = rec(value);
  const keys = required(row, ["clubRef", "clubLabel"]);
  if (!row || !keys) throw badResponse();
  return { ...keys, status: parseClubStatus(row.status) };
}

export async function getMyClubs(): Promise<{ clubs: MyClub[]; truncated: boolean }> {
  const data = rec(await readData("/api/me/clubs"));
  return { clubs: rows(data?.clubs, parseClub), truncated: data?.truncated === true };
}

export async function getMySessions(): Promise<{ sessions: MySession[]; truncated: boolean }> {
  const data = rec(await readData("/api/me/sessions"));
  return { sessions: rows(data?.sessions, parseSession), truncated: data?.truncated === true };
}

export async function getMyRequests(): Promise<{ requests: MyJoinRequest[]; truncated: boolean }> {
  const data = rec(await readData("/api/me/requests"));
  return { requests: rows(data?.requests, parseRequest), truncated: data?.truncated === true };
}

export async function getMyCharges(): Promise<MyCharges> {
  const data = rec(await readData("/api/me/charges"));
  return {
    clubs: rows(data?.clubs, parseClubCharges),
    summary: parseSummary(data?.summary),
  };
}

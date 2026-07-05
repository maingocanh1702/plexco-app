/**
 * Pure payment-decision logic (no DB / transport / IO) — unit-tested in
 * isolation. Lifted from the production single-club bot (payments-logic.ts;
 * 0 false positives in production).
 *
 * Core PROPOSES decisions; the ledger service is the only writer (BL-PAY-2/8,
 * INV-4). Decision tables: .autopilot/state/core-lift/decision-table.md —
 * every classifier is fail-closed: unprovable fee/coverage NEVER auto-settles.
 *
 * Amounts are integer minor units (VND). `OpenDebt` is structural (was a db
 * type in the bot): the caller maps ledger rows into it.
 */
import { parseMoney } from "./dates.js";
import type { PlayerId } from "./matching.js";

/** One open (not fully settled) debt of a member, oldest-first per BL-PAY-5. */
export interface OpenDebt {
  /** ISO session date "YYYY-MM-DD" — FIFO/today ordering key */
  date: string;
  /** per-person fee for that session; null when the session has no fee yet */
  fee: number | null;
  /** amount already allocated/deposited toward this debt (null = none) */
  paid_amount?: number | null;
}

/** Split "Wang 220k" / "Wang 110 000" / "Wang 110k vnd" into name + amount.
 * The trailing amount is validated by parseMoney ITSELF (single source of the
 * money grammar — no second regex to drift): take the maximal run of trailing
 * amount-shaped tokens that parseMoney accepts as one value. */
// Every token shape a parseMoney-valid amount can decompose into when split
// on whitespace: digit groups, digit+k, digit(+k)+unit, standalone k(+unit),
// standalone unit. Keep in lockstep with parseMoney's stripped grammar.
const AMOUNT_TOKEN_RE = /^(?:[\d.,]+k?(?:vnd|d|đ)?|k(?:vnd|d|đ)?|vnd|d|đ)$/i;

export function splitNameAmount(raw: string): { name: string; amount: number | null } {
  const tokens = raw.trim().split(/\s+/);
  // widest trailing run of amount-shaped tokens, keeping a non-empty name
  let start = tokens.length;
  while (start > 1 && AMOUNT_TOKEN_RE.test(tokens[start - 1]!)) start--;
  for (let i = start; i < tokens.length; i++) {
    const candidate = tokens.slice(i).join(" ");
    if (!/^\d/.test(candidate)) continue; // an amount starts with a digit
    const amount = parseMoney(candidate);
    if (amount) return { name: tokens.slice(0, i).join(" "), amount };
  }
  return { name: raw.trim(), amount: null };
}

/**
 * Manual amount commands should settle the current play date first, then the
 * remaining open debts in their existing order.
 */
export function orderManualSettlementDebts<T extends OpenDebt>(debts: T[], today: string): T[] {
  return [...debts.filter((d) => d.date === today), ...debts.filter((d) => d.date !== today)];
}

/**
 * How many of the member's debts (in order) the amount covers EXACTLY.
 * 220k with two 110k sessions -> 2; 110k -> 1; 150k -> 0 (no clean split).
 */
export function coverDebts(debts: OpenDebt[], amount: number): number {
  let acc = 0;
  let count = 0;
  for (const d of debts) {
    if (!d.fee) return 0; // can't price a session without a fee
    acc += d.fee;
    count++;
    if (acc === amount) return count;
    if (acc > amount) return 0;
  }
  return 0; // amount exceeds total debt
}

/**
 * Manual `/transfer|/cash <name> <amount>`: when the amount can't be consumed
 * EXACTLY by the payer's own open debts (ownCovered === 0) but IS a clean
 * multiple of the fee implying ≥2 shares, the payer is likely covering buddies
 * too. Returns how many shares the money implies (`expected`) and the player
 * ids to pre-tick — payer first, then known unpaid buddies — or null when no
 * buddy-style expansion applies. SUGGESTION only; owner confirms.
 */
export function planBuddyExpansion(opts: {
  fee: number | null | undefined;
  amount: number;
  /** result of coverDebts() on the payer's OWN debts */
  ownCovered: number;
  /** payer's player id in the current session, or null if they're not unpaid there */
  payerPlayerId: PlayerId | null;
  /** unpaid buddy player ids in the current session, in display order */
  buddyPlayerIds: PlayerId[];
}): { expected: number; preselected: PlayerId[] } | null {
  const { fee, amount, ownCovered, payerPlayerId, buddyPlayerIds } = opts;
  if (ownCovered > 0) return null; // own debts already account for the money exactly
  if (payerPlayerId == null) return null; // payer isn't an unpaid player here
  if (!fee || amount <= 0 || amount % fee !== 0) return null;
  const expected = amount / fee;
  if (expected < 2) return null; // only the multi-person case
  const preselected = [payerPlayerId, ...buddyPlayerIds.slice(0, expected - 1)];
  return { expected, preselected };
}

/**
 * Auto webhook path, NO payer name matched, but the amount cleanly implies
 * `expected` (>=2) people (flat-fee session). If EXACTLY ONE unpaid host (a
 * member who pays for buddies) forms a group {host + their unpaid buddies} of
 * EXACTLY `expected` people, return that group's member ids (host first) so
 * the caller can PRE-SELECT them for owner confirmation.
 *
 * Conservative on purpose (this only SUGGESTS, never auto-marks):
 *   - host must be unpaid too (they're paying for self + buddies),
 *   - the group size must EQUAL expected (no guessing which subset of a bigger group),
 *   - ZERO or MULTIPLE distinct qualifying groups -> null (ambiguous, don't guess).
 */
export function inferBuddyGroupByAmount(opts: {
  expected: number;
  /** member ids of players still unpaid in the session */
  unpaidMemberIds: Set<PlayerId>;
  /** candidate hosts: a member id + the member ids they pay for (buddies) */
  hosts: { hostMemberId: PlayerId; buddyMemberIds: PlayerId[] }[];
}): PlayerId[] | null {
  const { expected, unpaidMemberIds, hosts } = opts;
  if (expected < 2) return null;

  const groups: PlayerId[][] = [];
  for (const { hostMemberId, buddyMemberIds } of hosts) {
    if (!unpaidMemberIds.has(hostMemberId)) continue; // host must be paying (unpaid) too
    const buddies = buddyMemberIds.filter((id) => id !== hostMemberId && unpaidMemberIds.has(id));
    const group = [hostMemberId, ...new Set(buddies)];
    if (group.length === expected) groups.push(group);
  }
  if (groups.length === 0) return null;

  // collapse identical membership; >1 DISTINCT group of the right size = ambiguous
  const keyOf = (g: PlayerId[]) => [...g].sort().join(",");
  const distinct = new Map<string, PlayerId[]>();
  for (const g of groups) distinct.set(keyOf(g), g);
  if (distinct.size !== 1) return null;
  return [...distinct.values()][0]!;
}

/**
 * Decide what to do with a transfer once we know the fee, the amount, and how
 * many players the content confidently matched.
 *
 *  - "mark-all"      : money PROVABLY covers everyone matched (exact split or
 *                      an overpay >= fee×matched) -> auto-mark, split evenly.
 *  - "need-more"     : amount is a clean multiple implying MORE people than
 *                      matched (220k, 1 name) -> suggest buddies, owner confirms.
 *  - "too-few-money" : amount < fee * matchCount (210k for 2, or 100k for 1) ->
 *                      NEVER auto-mark; ask the owner who actually paid.
 *  - "unknown-fee"   : session has no priced fee -> coverage is UNPROVABLE ->
 *                      manual review, never auto-mark (INV-4 fail-closed).
 *  - "no-match"      : nothing matched -> ambiguous-candidate prompt (manual).
 *
 * `expected` = how many people the money cleanly accounts for (0 when it can't
 * be derived), used to drive the confirm-count hint on prompts.
 */
export type AmountDecision =
  | { kind: "mark-all"; expected: number }
  | { kind: "need-more"; expected: number }
  | { kind: "too-few-money"; expected: number }
  | { kind: "unknown-fee"; expected: 0 }
  | { kind: "no-match"; expected: number };

export function classifyAmount(
  fee: number | null | undefined,
  amount: number,
  matchCount: number,
): AmountDecision {
  const cleanCount = fee && amount > 0 && amount % fee === 0 ? amount / fee : 0;
  if (matchCount === 0) return { kind: "no-match", expected: cleanCount };

  // No priced fee -> coverage can't be proven -> manual, never auto-mark.
  // (The single-club bot auto-marked here; Plexco is fail-closed on money.)
  if (!fee) return { kind: "unknown-fee", expected: 0 };

  // The money can't cover everyone the names matched -> never auto-mark.
  // (210k for 2×110k, or 100k for 1×110k.)
  if (amount < fee * matchCount) {
    return { kind: "too-few-money", expected: Math.floor(amount / fee) };
  }
  // a clean multiple bigger than the names found -> someone paid for others too.
  if (cleanCount > matchCount) return { kind: "need-more", expected: cleanCount };
  // exact split, or an overpay covering everyone matched -> mark all matched.
  return { kind: "mark-all", expected: cleanCount };
}

/**
 * Remaining fee for a debt after accounting for any prior deposit.
 * Returns null when the session fee is unknown (can't compute remainder).
 */
export function effectiveFee(d: OpenDebt): number | null {
  if (d.fee === null || d.fee === undefined) return null;
  return Math.max(0, d.fee - (d.paid_amount ?? 0));
}

/**
 * Like coverDebts but operates on the REMAINING amount (fee − paid_amount).
 * Returns how many debts (in order) the amount covers EXACTLY via their
 * remaining balances. Debts with remaining=0 are skipped (already settled).
 */
export function coverRemaining(debts: OpenDebt[], amount: number): number {
  let acc = 0;
  for (let i = 0; i < debts.length; i++) {
    const rem = effectiveFee(debts[i]!);
    if (rem === null) return 0;
    if (rem === 0) continue;
    acc += rem;
    if (acc === amount) return i + 1; // original-array prefix (includes skipped zero-rem rows)
    if (acc > amount) return 0;
  }
  return 0;
}

/**
 * Classify how `amount` relates to what `d` still needs:
 *   "exact"       — covers exactly the remaining balance
 *   "partial"     — less than remaining (deposit)
 *   "over"        — more than remaining (overpay)
 *   "unknown-fee" — fee unknown, can't decide (fail-closed)
 */
export type DepositClassification = "exact" | "partial" | "over" | "unknown-fee";

export function classifyDeposit(d: OpenDebt, amount: number): DepositClassification {
  const rem = effectiveFee(d);
  if (rem === null) return "unknown-fee";
  if (amount === rem) return "exact";
  if (amount < rem) return "partial";
  return "over";
}

/**
 * How an incoming payment relates to a SINGLE matched member's open debts.
 * `debts` already exclude fully-paid sessions, so an EMPTY list means the
 * member is fully settled and any money is an OVERPAY. PURE — drives the
 * overpay / already-paid decision WITHOUT changing coverRemaining's contract.
 *
 *  - "unknown-fee"  — a debt has no fee → can't price; caller keeps its existing path.
 *  - "already-paid" — total remaining <= 0 (nothing owed) → incoming money is OVERPAY.
 *  - "exact"        — amount exactly covers a leading prefix (delegates to coverRemaining).
 *  - "over"         — amount strictly exceeds the total remaining across all open debts.
 *  - "under"        — positive but < total remaining and not a clean prefix.
 *
 * Money: compares remaining via REAL effectiveFee and `<= 0` (never `=== 0`).
 */
export type IncomingClass =
  | { kind: "unknown-fee" }
  | { kind: "already-paid"; overpay: number }
  | { kind: "exact"; settleCount: number }
  | { kind: "over"; overpay: number }
  | { kind: "under" };

export function classifyIncoming(debts: OpenDebt[], amount: number): IncomingClass {
  // Exact prefix FIRST: coverRemaining only fails on a null fee that falls WITHIN the
  // needed prefix, so a later unpriced session never blocks settling a valid priced
  // prefix (a global unknown-fee check up front would regress that).
  const prefix = coverRemaining(debts, amount);
  if (prefix > 0) return { kind: "exact", settleCount: prefix };
  // No exact prefix → classify by total remaining; a still-unknown fee means we can't total it.
  if (debts.some((d) => effectiveFee(d) === null)) return { kind: "unknown-fee" };
  const totalRemaining = debts.reduce((sum, d) => sum + effectiveFee(d)!, 0);
  if (totalRemaining <= 0) return { kind: "already-paid", overpay: Math.max(0, amount) };
  if (amount > totalRemaining) return { kind: "over", overpay: amount - totalRemaining };
  return { kind: "under" };
}

/**
 * Combined-transfer coverage across the still-owing members of a combo. Pass
 * the flat list of debts to settle (already filtered to members WITH an open
 * debt). PURE. `totalRemaining` = Σ effectiveFee. Fail-CLOSED: empty set or
 * any unknown fee → "unknown-fee" (caller blocks); an underpay → "under"
 * (caller blocks).
 *
 *  - "exact" — amount === totalRemaining (settle all, no excess).
 *  - "over"  — amount > totalRemaining; `overpay` = excess → settle all + OVERPAY notice.
 *  - "under" — amount < totalRemaining → insufficient.
 */
export type CoverageClass =
  | { kind: "unknown-fee" }
  | { kind: "exact"; totalRemaining: number }
  | { kind: "over"; totalRemaining: number; overpay: number }
  | { kind: "under"; totalRemaining: number };

export function classifyCoverage(debts: OpenDebt[], amount: number): CoverageClass {
  if (debts.length === 0 || debts.some((d) => effectiveFee(d) === null)) {
    return { kind: "unknown-fee" };
  }
  const totalRemaining = debts.reduce((sum, d) => sum + effectiveFee(d)!, 0);
  if (amount === totalRemaining) return { kind: "exact", totalRemaining };
  if (amount > totalRemaining)
    return { kind: "over", totalRemaining, overpay: amount - totalRemaining };
  return { kind: "under", totalRemaining };
}

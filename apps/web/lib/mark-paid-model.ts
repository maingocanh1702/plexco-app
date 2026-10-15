import type { MarkPaidLineDto, PaymentMethod } from "./roster-payments-api";

/**
 * Pure model of the manual mark-paid sheet (DD-25 preview -> confirm). The confirm body is built
 * from ONE pass over the lines, so `expectedTotal` is by construction the sum of the item amounts
 * the host saw: MARK_PAID_TOTAL_MISMATCH cannot come from this UI.
 */
export const NOTE_MAX = 200;

export type AmountProblem = "empty" | "below_min" | "above_remaining";

/** Integer VND in 1..remaining. `null`/NaN = nothing valid typed. */
export function amountProblem(amount: number | null, remaining: number): AmountProblem | null {
  if (amount === null || !Number.isInteger(amount)) return "empty";
  if (amount < 1) return "below_min";
  if (amount > remaining) return "above_remaining";
  return null;
}

/** Amount per player the host is paying; missing key = not typed. */
export type AmountMap = Record<string, number | null>;

/** The server's own preview amounts, as the editable starting point. */
export function initialAmounts(lines: readonly MarkPaidLineDto[]): AmountMap {
  return Object.fromEntries(lines.map((l) => [l.playerId, l.amount]));
}

export function problems(
  lines: readonly MarkPaidLineDto[],
  amounts: AmountMap,
): Record<string, AmountProblem | null> {
  return Object.fromEntries(
    lines.map((l) => [l.playerId, amountProblem(amounts[l.playerId] ?? null, l.remaining)]),
  );
}

/** Sum of the amounts currently shown, or `null` while any line is invalid (never a misleading partial sum). */
export function shownTotal(lines: readonly MarkPaidLineDto[], amounts: AmountMap): number | null {
  let sum = 0;
  for (const l of lines) {
    const a = amounts[l.playerId] ?? null;
    if (amountProblem(a, l.remaining) !== null) return null;
    sum += a as number;
  }
  return sum;
}

/** The confirm body minus the idempotency key, which the command hook supplies per attempt. */
export interface ConfirmBody {
  method: PaymentMethod;
  items: { playerId: string; amount: number }[];
  expectedTotal: number;
  note?: string;
}

/** `null` unless every line is valid (and there is at least one). The note is trimmed, omitted when empty. */
export function buildConfirmBody(input: {
  method: PaymentMethod;
  lines: readonly MarkPaidLineDto[];
  amounts: AmountMap;
  note: string;
}): ConfirmBody | null {
  if (input.lines.length === 0) return null;
  const items: ConfirmBody["items"] = [];
  let expectedTotal = 0;
  for (const l of input.lines) {
    const amount = input.amounts[l.playerId] ?? null;
    if (amountProblem(amount, l.remaining) !== null) return null;
    items.push({ playerId: l.playerId, amount: amount as number });
    expectedTotal += amount as number;
  }
  const note = input.note.trim();
  if (note.length > NOTE_MAX) return null;
  return {
    method: input.method,
    items,
    expectedTotal,
    ...(note ? { note } : {}),
  };
}

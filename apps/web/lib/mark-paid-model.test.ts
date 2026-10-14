import { describe, expect, it } from "vitest";
import {
  amountProblem,
  buildConfirmBody,
  initialAmounts,
  problems,
  shownTotal,
} from "./mark-paid-model";
import type { MarkPaidLineDto } from "./roster-payments-api";

const line = (playerId: string, remaining: number, amount = remaining): MarkPaidLineDto => ({
  playerId,
  chargeId: `c-${playerId}`,
  amountDue: 50000,
  effectiveBefore: 50000 - remaining,
  remaining,
  amount,
});
const lines = [line("p1", 50000), line("p2", 30000)];

describe("amountProblem", () => {
  it("accepts integers in 1..remaining and nothing else", () => {
    expect(amountProblem(1, 100)).toBeNull();
    expect(amountProblem(100, 100)).toBeNull();
    expect(amountProblem(101, 100)).toBe("above_remaining");
    expect(amountProblem(0, 100)).toBe("below_min");
    expect(amountProblem(-5, 100)).toBe("below_min");
    expect(amountProblem(null, 100)).toBe("empty");
    expect(amountProblem(Number.NaN, 100)).toBe("empty");
    expect(amountProblem(10.5, 100)).toBe("empty");
  });
});

describe("buildConfirmBody", () => {
  const base = { method: "cash" as const, lines, note: "" };

  it("expectedTotal is always the sum of the item amounts shown (partial payment included)", () => {
    const amounts = { p1: 50000, p2: 10000 }; // p2 pays partially
    const body = buildConfirmBody({ ...base, amounts });
    expect(body).toEqual({
      method: "cash",
      items: [
        { playerId: "p1", amount: 50000 },
        { playerId: "p2", amount: 10000 },
      ],
      expectedTotal: 60000,
    });
    expect(body!.expectedTotal).toBe(body!.items.reduce((s, i) => s + i.amount, 0));
    expect(shownTotal(lines, amounts)).toBe(body!.expectedTotal);
  });

  it("MARK_PAID_TOTAL_MISMATCH is impossible: for any valid edit the total equals the item sum", () => {
    for (const a of [1, 777, 29999, 30000]) {
      const body = buildConfirmBody({ ...base, amounts: { p1: 50000 - a + 1, p2: a } })!;
      expect(body.expectedTotal).toBe(body.items.reduce((s, i) => s + i.amount, 0));
    }
  });

  it("carries an explicit amount on every item, and the preview amounts are a valid start", () => {
    const body = buildConfirmBody({ ...base, amounts: initialAmounts(lines) })!;
    expect(body.items.every((i) => Number.isInteger(i.amount))).toBe(true);
    expect(body.expectedTotal).toBe(80000);
  });

  it("is null when any line is invalid, when there are no lines, or when the note is too long", () => {
    expect(buildConfirmBody({ ...base, amounts: { p1: 50000, p2: 30001 } })).toBeNull();
    expect(buildConfirmBody({ ...base, amounts: { p1: 50000 } })).toBeNull();
    expect(buildConfirmBody({ ...base, lines: [], amounts: {} })).toBeNull();
    expect(
      buildConfirmBody({ ...base, amounts: initialAmounts(lines), note: "x".repeat(201) }),
    ).toBeNull();
  });

  it("trims the note and omits it when empty", () => {
    const amounts = initialAmounts(lines);
    expect(buildConfirmBody({ ...base, amounts, note: "  tiền mặt  " })!.note).toBe("tiền mặt");
    expect("note" in buildConfirmBody({ ...base, amounts, note: "   " })!).toBe(false);
  });

  it("shownTotal is null while any line is invalid, never a partial sum", () => {
    expect(shownTotal(lines, { p1: 50000, p2: 10000 })).toBe(60000);
    expect(shownTotal(lines, { p1: 50000, p2: 30001 })).toBeNull();
    expect(shownTotal(lines, { p1: 50000 })).toBeNull();
  });

  it("the body carries no commandId (the hook mints one per attempt)", () => {
    expect("commandId" in buildConfirmBody({ ...base, amounts: initialAmounts(lines) })!).toBe(
      false,
    );
  });

  it("per-line problems are reported by player", () => {
    expect(problems(lines, { p1: 0, p2: 30000 })).toEqual({ p1: "below_min", p2: null });
  });
});

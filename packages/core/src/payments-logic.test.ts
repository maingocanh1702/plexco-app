/**
 * Lifted from the production single-club bot's payments-logic suite, plus
 * decision-table cases for classifyAmount/coverDebts/splitNameAmount/
 * planBuddyExpansion whose original coverage lived in the DB-coupled
 * payments suite (not lifted). Tables: .autopilot/state/core-lift/decision-table.md.
 */
import { describe, expect, it } from "vitest";
import {
  classifyAmount,
  classifyCoverage,
  classifyDeposit,
  classifyIncoming,
  coverDebts,
  coverRemaining,
  effectiveFee,
  inferBuddyGroupByAmount,
  orderManualSettlementDebts,
  planBuddyExpansion,
  splitNameAmount,
  type OpenDebt,
} from "./payments-logic.js";

function debt(fee: number | null, paid_amount: number | null = null): OpenDebt {
  return { date: "2026-06-13", fee, paid_amount };
}

describe("effectiveFee", () => {
  it("remaining = fee − deposit, clamped at 0; unknown fee → null", () => {
    expect(effectiveFee(debt(110000, null))).toBe(110000);
    expect(effectiveFee(debt(110000, 50000))).toBe(60000);
    expect(effectiveFee(debt(110000, 110000))).toBe(0);
    expect(effectiveFee(debt(110000, 120000))).toBe(0); // over-deposited → clamp 0
    expect(effectiveFee(debt(null, null))).toBeNull();
    expect(effectiveFee(debt(null, 50000))).toBeNull();
  });
});

describe("coverDebts (exact-prefix only, fail-closed)", () => {
  const d = () => [debt(110000), debt(110000)];
  it("counts exact prefixes; overshoot/unknown → 0", () => {
    expect(coverDebts(d(), 110000)).toBe(1);
    expect(coverDebts(d(), 220000)).toBe(2);
    expect(coverDebts(d(), 150000)).toBe(0); // no clean split
    expect(coverDebts(d(), 330000)).toBe(0); // exceeds total
    expect(coverDebts([debt(null)], 110000)).toBe(0); // unpriced → 0
  });
});

describe("coverRemaining (deposit-aware)", () => {
  const d1 = debt(110000, null); // remaining = 110k
  const d2 = debt(110000, 50000); // remaining = 60k
  const d3 = debt(110000, 110000); // remaining = 0 (skip)

  it("covers by remaining balances", () => {
    expect(coverRemaining([d1, d2], 110000)).toBe(1);
    expect(coverRemaining([d2, d1], 60000)).toBe(1);
    expect(coverRemaining([d1, d2], 170000)).toBe(2);
    expect(coverRemaining([d1, d2], 100000)).toBe(0); // mismatch
    expect(coverRemaining([debt(null, null)], 110000)).toBe(0); // unknown fee
    // zero-remaining debt at idx 0 — prefix=2 (caller skips it), d1 at idx 1 covered
    expect(coverRemaining([d3, d1], 110000)).toBe(2);
  });
});

describe("classifyDeposit", () => {
  it("exact / partial / over / unknown-fee", () => {
    expect(classifyDeposit(debt(110000, null), 110000)).toBe("exact");
    expect(classifyDeposit(debt(110000, null), 50000)).toBe("partial");
    expect(classifyDeposit(debt(110000, 50000), 60000)).toBe("exact");
    expect(classifyDeposit(debt(110000, 50000), 30000)).toBe("partial");
    expect(classifyDeposit(debt(110000, null), 150000)).toBe("over");
    expect(classifyDeposit(debt(110000, 50000), 100000)).toBe("over");
    expect(classifyDeposit(debt(null, null), 50000)).toBe("unknown-fee");
  });
});

describe("classifyIncoming (single member)", () => {
  it("already-paid / exact / over / under / unknown-fee", () => {
    expect(classifyIncoming([], 110000)).toEqual({ kind: "already-paid", overpay: 110000 });
    expect(classifyIncoming([debt(110000, 110000)], 110000)).toEqual({
      kind: "already-paid",
      overpay: 110000,
    });
    expect(classifyIncoming([debt(110000, null)], 110000)).toEqual({
      kind: "exact",
      settleCount: 1,
    });
    expect(classifyIncoming([debt(110000, null), debt(110000, null)], 220000)).toEqual({
      kind: "exact",
      settleCount: 2,
    });
    expect(classifyIncoming([debt(110000, 50000)], 60000)).toEqual({
      kind: "exact",
      settleCount: 1,
    });
    expect(classifyIncoming([debt(110000, null)], 220000)).toEqual({
      kind: "over",
      overpay: 110000,
    });
    expect(classifyIncoming([debt(110000, 50000)], 100000)).toEqual({
      kind: "over",
      overpay: 40000,
    });
    expect(classifyIncoming([debt(110000, null)], 50000)).toEqual({ kind: "under" });
    expect(classifyIncoming([debt(null, null)], 110000)).toEqual({ kind: "unknown-fee" });
  });

  it("a priced exact prefix settles even when a LATER session is unpriced", () => {
    expect(
      classifyIncoming([debt(110000, null), debt(110000, null), debt(null, null)], 220000),
    ).toEqual({ kind: "exact", settleCount: 2 });
  });

  it("unknown fee WITHIN the needed prefix → unknown-fee (fail-closed)", () => {
    expect(classifyIncoming([debt(null, null), debt(110000, null)], 110000)).toEqual({
      kind: "unknown-fee",
    });
  });
});

describe("classifyCoverage (combo settle)", () => {
  it("fail-closed on empty/unknown; exact/over/under otherwise", () => {
    expect(classifyCoverage([], 110000)).toEqual({ kind: "unknown-fee" });
    expect(classifyCoverage([debt(110000, null), debt(110000, null)], 220000)).toEqual({
      kind: "exact",
      totalRemaining: 220000,
    });
    expect(classifyCoverage([debt(110000, null), debt(110000, null)], 330000)).toEqual({
      kind: "over",
      totalRemaining: 220000,
      overpay: 110000,
    });
    expect(classifyCoverage([debt(110000, null), debt(110000, null)], 110000)).toEqual({
      kind: "under",
      totalRemaining: 220000,
    });
    expect(classifyCoverage([debt(110000, 50000)], 60000)).toEqual({
      kind: "exact",
      totalRemaining: 60000,
    });
    expect(classifyCoverage([debt(110000, 50000)], 100000)).toEqual({
      kind: "over",
      totalRemaining: 60000,
      overpay: 40000,
    });
    expect(classifyCoverage([debt(null, null), debt(110000, null)], 220000)).toEqual({
      kind: "unknown-fee",
    });
  });
});

describe("inferBuddyGroupByAmount (suggest-only, never auto-marks)", () => {
  const bobHost = [{ hostMemberId: 1, buddyMemberIds: [2, 3, 4] }];

  it("unique host+buddies group of exactly `expected` size", () => {
    expect(
      inferBuddyGroupByAmount({
        expected: 4,
        unpaidMemberIds: new Set([1, 2, 3, 4]),
        hosts: bobHost,
      }),
    ).toEqual([1, 2, 3, 4]);
    expect(
      inferBuddyGroupByAmount({ expected: 3, unpaidMemberIds: new Set([1, 2, 3]), hosts: bobHost }),
    ).toEqual([1, 2, 3]);
  });

  it("refuses ambiguous/impossible groups (fail-closed)", () => {
    expect(
      inferBuddyGroupByAmount({
        expected: 1,
        unpaidMemberIds: new Set([1, 2, 3, 4]),
        hosts: bobHost,
      }),
    ).toBeNull();
    expect(
      inferBuddyGroupByAmount({ expected: 4, unpaidMemberIds: new Set([1, 2, 3]), hosts: bobHost }),
    ).toBeNull();
    expect(
      inferBuddyGroupByAmount({ expected: 3, unpaidMemberIds: new Set([2, 3, 4]), hosts: bobHost }),
    ).toBeNull(); // host already paid
    expect(
      inferBuddyGroupByAmount({
        expected: 2,
        unpaidMemberIds: new Set([1, 2, 10, 11]),
        hosts: [
          { hostMemberId: 1, buddyMemberIds: [2] },
          { hostMemberId: 10, buddyMemberIds: [11] },
        ],
      }),
    ).toBeNull(); // two distinct qualifying groups → ambiguous
    expect(
      inferBuddyGroupByAmount({ expected: 4, unpaidMemberIds: new Set([1, 2, 3, 4]), hosts: [] }),
    ).toBeNull();
  });
});

describe("classifyAmount (decision table)", () => {
  it("M=0 → no-match with clean-count hint", () => {
    expect(classifyAmount(110000, 220000, 0)).toEqual({ kind: "no-match", expected: 2 });
    expect(classifyAmount(110000, 150000, 0)).toEqual({ kind: "no-match", expected: 0 });
  });

  it("underpay for matched names → too-few-money, NEVER auto-mark", () => {
    expect(classifyAmount(110000, 210000, 2)).toEqual({ kind: "too-few-money", expected: 1 });
    expect(classifyAmount(110000, 100000, 1)).toEqual({ kind: "too-few-money", expected: 0 });
  });

  it("clean multiple beyond matched names → need-more (owner confirms)", () => {
    expect(classifyAmount(110000, 220000, 1)).toEqual({ kind: "need-more", expected: 2 });
    expect(classifyAmount(110000, 440000, 1)).toEqual({ kind: "need-more", expected: 4 });
  });

  it("exact split / overpay covering all matched → mark-all", () => {
    expect(classifyAmount(110000, 220000, 2)).toEqual({ kind: "mark-all", expected: 2 });
    expect(classifyAmount(110000, 110000, 1)).toEqual({ kind: "mark-all", expected: 1 });
    expect(classifyAmount(110000, 250000, 2)).toEqual({ kind: "mark-all", expected: 0 }); // messy overpay ≥ fee×M
  });

  it("unpriced session → unknown-fee, NEVER auto-mark (INV-4 fail-closed)", () => {
    expect(classifyAmount(null, 220000, 2)).toEqual({ kind: "unknown-fee", expected: 0 });
    expect(classifyAmount(null, 50000, 1)).toEqual({ kind: "unknown-fee", expected: 0 });
    expect(classifyAmount(undefined, 110000, 1)).toEqual({ kind: "unknown-fee", expected: 0 });
    expect(classifyAmount(0, 110000, 1)).toEqual({ kind: "unknown-fee", expected: 0 }); // free session receiving money → manual
    // no names matched stays the no-match manual prompt, priced or not
    expect(classifyAmount(null, 110000, 0)).toEqual({ kind: "no-match", expected: 0 });
  });
});

describe("splitNameAmount", () => {
  it("splits trailing amounts, keeps plain names", () => {
    expect(splitNameAmount("Wang 220k")).toEqual({ name: "Wang", amount: 220000 });
    expect(splitNameAmount("Ngoc-Anh Mai 110.000")).toEqual({
      name: "Ngoc-Anh Mai",
      amount: 110000,
    });
    expect(splitNameAmount("Wang")).toEqual({ name: "Wang", amount: null });
  });

  it("accepts every amount shape parseMoney accepts (single grammar source)", () => {
    expect(splitNameAmount("Wang 110k vnd")).toEqual({ name: "Wang", amount: 110000 });
    expect(splitNameAmount("Wang 110000đ")).toEqual({ name: "Wang", amount: 110000 });
    expect(splitNameAmount("Wang 110000 d")).toEqual({ name: "Wang", amount: 110000 });
    expect(splitNameAmount("Wang 220K VND")).toEqual({ name: "Wang", amount: 220000 });
    expect(splitNameAmount("Wang 110 000")).toEqual({ name: "Wang", amount: 110000 });
    expect(splitNameAmount("Ngoc-Anh Mai 110 000 vnd")).toEqual({
      name: "Ngoc-Anh Mai",
      amount: 110000,
    });
    // separated k / unit tokens (parseMoney strips whitespace, so must we)
    expect(splitNameAmount("Wang 110 k")).toEqual({ name: "Wang", amount: 110000 });
    expect(splitNameAmount("Wang 110 k vnd")).toEqual({ name: "Wang", amount: 110000 });
    expect(splitNameAmount("Wang 110 kvnd")).toEqual({ name: "Wang", amount: 110000 });
    // a bare unit word never eats the name
    expect(splitNameAmount("Wang d")).toEqual({ name: "Wang d", amount: null });
    expect(splitNameAmount("Wang k")).toEqual({ name: "Wang k", amount: null });
  });

  it("numeric name tails never inflate the amount (shortest trailing run wins)", () => {
    expect(splitNameAmount("Player 2 110k")).toEqual({ name: "Player 2", amount: 110000 });
    expect(splitNameAmount("Court 7 110 000")).toEqual({ name: "Court 7", amount: 110000 });
    expect(splitNameAmount("San 2 220000")).toEqual({ name: "San 2", amount: 220000 });
    expect(splitNameAmount("Player 2 110 k vnd")).toEqual({ name: "Player 2", amount: 110000 });
    // degenerate "<name> <digit>" has no better parse — the digit reads as a
    // (tiny) amount, exactly like the production splitter; downstream
    // classification rejects it as under-payment, so no money can move on it
    expect(splitNameAmount("Player 2")).toEqual({ name: "Player", amount: 2 });
  });
});

describe("orderManualSettlementDebts", () => {
  it("settles today's session first, then existing order", () => {
    const a = { ...debt(110000), date: "2026-06-06" };
    const b = { ...debt(110000), date: "2026-06-13" };
    const c = { ...debt(110000), date: "2026-06-10" };
    expect(orderManualSettlementDebts([a, b, c], "2026-06-13")).toEqual([b, a, c]);
  });
});

describe("planBuddyExpansion", () => {
  it("suggests payer+buddies when amount implies ≥2 shares", () => {
    expect(
      planBuddyExpansion({
        fee: 110000,
        amount: 220000,
        ownCovered: 0,
        payerPlayerId: 7,
        buddyPlayerIds: [8, 9],
      }),
    ).toEqual({ expected: 2, preselected: [7, 8] });
  });

  it("refuses when own debts already cover, payer absent, or amount unclean", () => {
    expect(
      planBuddyExpansion({
        fee: 110000,
        amount: 220000,
        ownCovered: 2,
        payerPlayerId: 7,
        buddyPlayerIds: [8],
      }),
    ).toBeNull();
    expect(
      planBuddyExpansion({
        fee: 110000,
        amount: 220000,
        ownCovered: 0,
        payerPlayerId: null,
        buddyPlayerIds: [8],
      }),
    ).toBeNull();
    expect(
      planBuddyExpansion({
        fee: 110000,
        amount: 150000,
        ownCovered: 0,
        payerPlayerId: 7,
        buddyPlayerIds: [8],
      }),
    ).toBeNull();
    expect(
      planBuddyExpansion({
        fee: 110000,
        amount: 110000,
        ownCovered: 0,
        payerPlayerId: 7,
        buddyPlayerIds: [8],
      }),
    ).toBeNull(); // expected < 2
    expect(
      planBuddyExpansion({
        fee: null,
        amount: 220000,
        ownCovered: 0,
        payerPlayerId: 7,
        buddyPlayerIds: [8],
      }),
    ).toBeNull();
  });
});

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

  it("single payer covered → mark-all; multi-person fuzzy → multi-exact (owner-confirm)", () => {
    expect(classifyAmount(110000, 110000, 1)).toEqual({ kind: "mark-all", expected: 1 });
    expect(classifyAmount(110000, 150000, 1)).toEqual({ kind: "mark-all", expected: 0 }); // single overpay
    // BL-PAY-3: 'kelly chi 220k' never auto-splits — owner confirms the pair
    expect(classifyAmount(110000, 220000, 2)).toEqual({ kind: "multi-exact", expected: 2 });
    expect(classifyAmount(110000, 250000, 2)).toEqual({ kind: "multi-exact", expected: 0 }); // messy overpay ≥ fee×M
    expect(classifyAmount(110000, 330000, 3)).toEqual({ kind: "multi-exact", expected: 3 });
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

describe("splitNameAmount (DD-87 fail-closed ambiguity contract)", () => {
  // DD-87 §4 decision table — 18 exact rows (9 none/resolved, 9 ambiguous).
  // Every row is an exact unit assertion; ambiguous rows list ordered
  // shortest→longest candidates and carry NO top-level name/amount.
  it("row 1 — empty input → none", () => {
    expect(splitNameAmount("")).toEqual({ kind: "none", name: "" });
  });
  it("row 2 — name only → none", () => {
    expect(splitNameAmount("Wang")).toEqual({ kind: "none", name: "Wang" });
  });
  it("row 3 — a trailing 0 is not a positive amount → none", () => {
    expect(splitNameAmount("Wang 0")).toEqual({ kind: "none", name: "Wang 0" });
  });
  it("row 4 — degenerate '<name> <digit>' → resolved (downstream rejects the underpay)", () => {
    // the lone digit is the only parseMoney-valid run, so it resolves; no
    // second reading exists, so it is NOT ambiguous. Money can't move on it
    // because classifyAmount treats it as too-few-money.
    expect(splitNameAmount("Player 2")).toEqual({ kind: "resolved", name: "Player", amount: 2 });
  });
  it("row 5 — k suffix → resolved", () => {
    expect(splitNameAmount("Wang 220k")).toEqual({
      kind: "resolved",
      name: "Wang",
      amount: 220000,
    });
  });
  it("row 6 — grouped zero tail parses as one amount → resolved", () => {
    // '000' alone parses to 0 (rejected), so only 'Wang'+110000 survives.
    expect(splitNameAmount("Wang 110 000")).toEqual({
      kind: "resolved",
      name: "Wang",
      amount: 110000,
    });
  });
  it("row 7 — k + unit suffix → resolved", () => {
    expect(splitNameAmount("Wang 110k vnd")).toEqual({
      kind: "resolved",
      name: "Wang",
      amount: 110000,
    });
  });
  it("row 8 — spaced k → resolved", () => {
    expect(splitNameAmount("Wang 110 k")).toEqual({
      kind: "resolved",
      name: "Wang",
      amount: 110000,
    });
  });
  it("row 9 — multi-word name + grouped amount + unit → resolved", () => {
    expect(splitNameAmount("Ngoc-Anh Mai 110 000 vnd")).toEqual({
      kind: "resolved",
      name: "Ngoc-Anh Mai",
      amount: 110000,
    });
  });
  it("row 10 — 'Wang 110 500' → ambiguous (the DD-87 money-loss bug: 500 must not win)", () => {
    expect(splitNameAmount("Wang 110 500")).toEqual({
      kind: "ambiguous",
      candidates: [
        { name: "Wang 110", amount: 500, rawAmount: "500" },
        { name: "Wang", amount: 110500, rawAmount: "110 500" },
      ],
    });
  });
  it("row 11 — 'Wang 110 050' → ambiguous", () => {
    expect(splitNameAmount("Wang 110 050")).toEqual({
      kind: "ambiguous",
      candidates: [
        { name: "Wang 110", amount: 50, rawAmount: "050" },
        { name: "Wang", amount: 110050, rawAmount: "110 050" },
      ],
    });
  });
  it("row 12 — 'Wang 1 500 000' → ambiguous (longest-run would silently inflate)", () => {
    expect(splitNameAmount("Wang 1 500 000")).toEqual({
      kind: "ambiguous",
      candidates: [
        { name: "Wang 1", amount: 500000, rawAmount: "500 000" },
        { name: "Wang", amount: 1500000, rawAmount: "1 500 000" },
      ],
    });
  });
  it("row 13 — 'Wang 110 500k' → ambiguous", () => {
    expect(splitNameAmount("Wang 110 500k")).toEqual({
      kind: "ambiguous",
      candidates: [
        { name: "Wang 110", amount: 500000, rawAmount: "500k" },
        { name: "Wang", amount: 110500000, rawAmount: "110 500k" },
      ],
    });
  });
  it("row 14 — 'Player 2 110k' → ambiguous (numeric name tail)", () => {
    expect(splitNameAmount("Player 2 110k")).toEqual({
      kind: "ambiguous",
      candidates: [
        { name: "Player 2", amount: 110000, rawAmount: "110k" },
        { name: "Player", amount: 2110000, rawAmount: "2 110k" },
      ],
    });
  });
  it("row 15 — 'Player 2 110 000' → ambiguous", () => {
    expect(splitNameAmount("Player 2 110 000")).toEqual({
      kind: "ambiguous",
      candidates: [
        { name: "Player 2", amount: 110000, rawAmount: "110 000" },
        { name: "Player", amount: 2110000, rawAmount: "2 110 000" },
      ],
    });
  });
  it("row 16 — 'Court 7 110 000' → ambiguous", () => {
    expect(splitNameAmount("Court 7 110 000")).toEqual({
      kind: "ambiguous",
      candidates: [
        { name: "Court 7", amount: 110000, rawAmount: "110 000" },
        { name: "Court", amount: 7110000, rawAmount: "7 110 000" },
      ],
    });
  });
  it("row 17 — 'San 2 220000' → ambiguous", () => {
    expect(splitNameAmount("San 2 220000")).toEqual({
      kind: "ambiguous",
      candidates: [
        { name: "San 2", amount: 220000, rawAmount: "220000" },
        { name: "San", amount: 2220000, rawAmount: "2 220000" },
      ],
    });
  });
  it("row 18 — 'Player 0 110k' → ambiguous with EQUAL amount, DIFFERENT payer-name", () => {
    // both readings settle 110000 but to a different person — ambiguity is
    // distinct (name,amount), not amount-only; dedupe must NOT collapse these.
    expect(splitNameAmount("Player 0 110k")).toEqual({
      kind: "ambiguous",
      candidates: [
        { name: "Player 0", amount: 110000, rawAmount: "110k" },
        { name: "Player", amount: 110000, rawAmount: "0 110k" },
      ],
    });
  });

  // SNA-6 — every parseMoney grammar variant still resolves (single grammar source).
  it("SNA-6 — dotted thousands, unit suffixes and separated k/unit tokens resolve", () => {
    expect(splitNameAmount("Ngoc-Anh Mai 110.000")).toEqual({
      kind: "resolved",
      name: "Ngoc-Anh Mai",
      amount: 110000,
    });
    expect(splitNameAmount("Wang 110000đ")).toEqual({
      kind: "resolved",
      name: "Wang",
      amount: 110000,
    });
    expect(splitNameAmount("Wang 110000 d")).toEqual({
      kind: "resolved",
      name: "Wang",
      amount: 110000,
    });
    expect(splitNameAmount("Wang 220K VND")).toEqual({
      kind: "resolved",
      name: "Wang",
      amount: 220000,
    });
    // parseMoney strips whitespace, so split k / unit tokens still parse as one amount
    expect(splitNameAmount("Wang 110 k vnd")).toEqual({
      kind: "resolved",
      name: "Wang",
      amount: 110000,
    });
    expect(splitNameAmount("Wang 110 kvnd")).toEqual({
      kind: "resolved",
      name: "Wang",
      amount: 110000,
    });
  });

  // SNA-2 — a bare unit word never eats the name (no digit-led run) → none.
  it("SNA-2 — a bare unit word is not an amount → none", () => {
    expect(splitNameAmount("Wang d")).toEqual({ kind: "none", name: "Wang d" });
    expect(splitNameAmount("Wang k")).toEqual({ kind: "none", name: "Wang k" });
  });

  // SNA-3 — the multi-token analog of row 14 (existing 'Player 2 110 k vnd' assertion,
  // converted from a silently-resolved reading to the exhaustive ambiguous union).
  it("SNA-3 — 'Player 2 110 k vnd' → ambiguous (existing case, not weakened)", () => {
    expect(splitNameAmount("Player 2 110 k vnd")).toEqual({
      kind: "ambiguous",
      candidates: [
        { name: "Player 2", amount: 110000, rawAmount: "110 k vnd" },
        { name: "Player", amount: 2110000, rawAmount: "2 110 k vnd" },
      ],
    });
  });

  // SNA-3 — ambiguous exposes ordered candidates and NO settleable top-level fields at runtime.
  it("SNA-3 — ambiguous carries no top-level name/amount property", () => {
    const r = splitNameAmount("Wang 110 500");
    expect(r.kind).toBe("ambiguous");
    expect(r).not.toHaveProperty("amount");
    expect(r).not.toHaveProperty("name");
    if (r.kind === "ambiguous") {
      expect(r.candidates).toHaveLength(2);
      expect(r.candidates[0]).toEqual({ name: "Wang 110", amount: 500, rawAmount: "500" });
    }
  });

  // SNA-5 — pure/deterministic: repeated calls are deep-equal, fresh objects, no shared state.
  it("SNA-5 — repeated calls are deep-equal with no shared mutable state", () => {
    const a = splitNameAmount("Wang 110 500");
    const b = splitNameAmount("Wang 110 500");
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    // an interleaved different call must not mutate the earlier result
    expect(splitNameAmount("Wang 220k")).toEqual({
      kind: "resolved",
      name: "Wang",
      amount: 220000,
    });
    expect(splitNameAmount("Wang 110 500")).toEqual(a);
  });

  // SNA-7 — compile-time fence: the top-level amount is unreachable without narrowing `kind`.
  it("SNA-7 — TypeScript rejects reading a settleable amount before narrowing kind", () => {
    const r = splitNameAmount("Wang 110 500");
    // @ts-expect-error — top-level `amount` does not exist until `kind` is narrowed to "resolved"
    const leaked: number | undefined = r.amount;
    expect(leaked).toBeUndefined(); // ambiguous carries no top-level amount at runtime either
    expect(r.kind).toBe("ambiguous");
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

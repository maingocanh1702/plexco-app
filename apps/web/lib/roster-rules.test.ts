import { describe, expect, it } from "vitest";
import { makeT } from "./i18n-client";
import {
  canEditRoster,
  canTakePayments,
  displayNameOf,
  isPayable,
  ledgerRows,
  methodLabel,
  sourceLabel,
} from "./roster-rules";
import type { RosterChargeDto, RosterPlayerDto } from "./sessions-api";

const t = makeT("en");
const charge = (over: Partial<RosterChargeDto> = {}): RosterChargeDto => ({
  id: "c1",
  amountDue: 50000,
  amountAllocated: 0,
  status: "open",
  effectiveAllocated: 0,
  remaining: 50000,
  allocations: [],
  ...over,
});
const player = (over: Partial<RosterPlayerDto> = {}): RosterPlayerDto => ({
  id: "p1",
  membershipId: "m1",
  displayName: "Lan",
  status: "active",
  joinedAt: "2026-10-01T00:00:00.000Z",
  waitlistPosition: null,
  charge: charge(),
  ...over,
});

describe("status gates mirror the server allowlists", () => {
  it("roster edits: open only", () => {
    expect(["draft", "open", "closed", "cancelled", "weird"].map(canEditRoster)).toEqual([
      false,
      true,
      false,
      false,
      false,
    ]);
  });
  it("payments: open or closed only", () => {
    expect(["draft", "open", "closed", "cancelled", "weird"].map(canTakePayments)).toEqual([
      false,
      true,
      true,
      false,
      false,
    ]);
  });
});

describe("isPayable", () => {
  it("needs an active player with an open/partial charge and remaining > 0", () => {
    expect(isPayable(player())).toBe(true);
    expect(isPayable(player({ charge: charge({ status: "partial", remaining: 10 }) }))).toBe(true);
    expect(isPayable(player({ status: "waitlisted" }))).toBe(false);
    expect(isPayable(player({ charge: null }))).toBe(false);
    expect(isPayable(player({ charge: charge({ status: "paid", remaining: 0 }) }))).toBe(false);
    expect(isPayable(player({ charge: charge({ status: "void", remaining: 0 }) }))).toBe(false);
    expect(isPayable(player({ charge: charge({ remaining: 0 }) }))).toBe(false);
  });
});

describe("ledgerRows", () => {
  const alloc = (id: string, source: string, amount: number, rev: string | null = null) => ({
    id,
    source,
    amount,
    createdAt: "2026-10-02T00:00:00.000Z",
    reasonCode: null,
    reversesAllocationId: rev,
  });
  it("labels sources and marks only un-reversed host-recorded rows reversible", () => {
    const rows = ledgerRows(
      charge({
        allocations: [
          alloc("a1", "cash", 20000),
          alloc("a2", "attested_transfer", 10000),
          alloc("a3", "reversal", -10000, "a2"),
          alloc("a4", "auto", 5000),
        ],
      }),
      t,
    );
    expect(rows.map((r) => [r.id, r.label, r.reversible])).toEqual([
      ["a1", "Cash", true],
      ["a2", "Bank transfer (host-confirmed)", false], // already reversed in full
      ["a3", "Reversal", false],
      ["a4", "Bank match", false], // bank-bound: REVERSAL_NOT_SUPPORTED server-side
    ]);
  });
  it("a partially reversed row stays reversible for its remainder", () => {
    const rows = ledgerRows(
      charge({ allocations: [alloc("a1", "cash", 20000), alloc("a2", "reversal", -5000, "a1")] }),
      t,
    );
    expect(rows[0]!.reversible).toBe(true);
  });
  it("vi labels", () => {
    expect(
      ledgerRows(charge({ allocations: [alloc("a1", "cash", 1)] }), makeT("vi"))[0]!.label,
    ).toBe("Tiền mặt");
  });
});

describe("OD-6 money-source labels", () => {
  const vi = makeT("vi");
  it("cash and host-attested transfer are named the same in the picker and the ledger", () => {
    expect(methodLabel("cash", vi)).toBe("Tiền mặt");
    expect(methodLabel("attested_transfer", vi)).toBe("Chuyển khoản (chủ xác nhận)");
    expect(sourceLabel("attested_transfer", 1, vi)).toBe(methodLabel("attested_transfer", vi));
    expect(sourceLabel("cash", 1, t)).toBe(methodLabel("cash", t));
  });
  it("an unknown source never leaks its raw key: it reads Other / Khác", () => {
    expect(sourceLabel("stripe_v9", 1, t)).toBe("Other");
    expect(sourceLabel("stripe_v9", 1, vi)).toBe("Khác");
  });
});

describe("displayNameOf", () => {
  it("falls back to (unnamed) for a missing name only", () => {
    expect(displayNameOf(null, t)).toBe("(unnamed)");
    expect(displayNameOf(undefined, makeT("vi"))).toBe("(chưa đặt tên)");
    expect(displayNameOf("Lan", t)).toBe("Lan");
  });
});

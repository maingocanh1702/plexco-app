import { fmtMoney } from "@plexco/core";
import { describe, expect, it } from "vitest";
import { INT4_MAX, formatVnd, formatVndInput, parseVndInput } from "./money";

const D = "\u0111"; // lowercase d-stroke
const DONG_SIGN = "\u20ab";

describe("formatVnd (DD-128 OD-4b: one VND display)", () => {
  it.each([
    [0, `0${D}`],
    [999, `999${D}`],
    [1000, `1.000${D}`],
    [50000, `50.000${D}`],
    [150000, `150.000${D}`],
    [1234567, `1.234.567${D}`],
    [INT4_MAX, `2.147.483.647${D}`],
    [-1234, `-1.234${D}`],
    [-5, `-5${D}`],
  ])("formats %i as %s", (amount, expected) => {
    expect(formatVnd(amount)).toBe(expected);
  });

  it("renders -0 as a plain zero", () => {
    expect(formatVnd(-0)).toBe(`0${D}`);
  });

  it("puts lowercase U+0111 directly after the digits: no space of any kind, never U+20AB", () => {
    const out = formatVnd(150000);
    expect(out).toBe("150.000\u0111");
    expect(out).not.toMatch(/\s/u);
    expect(out).not.toContain(DONG_SIGN);
    expect(out.codePointAt(out.length - 1)).toBe(0x111);
  });

  it("takes no language: vi and en render the very same string", () => {
    expect(formatVnd.length).toBe(1);
  });

  it.each([
    ["a fraction", 1500.5],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["an unsafe integer", 2 ** 53],
    ["undefined", undefined],
    ["null", null],
    ["a numeric string", "50000"],
  ])("fail-safe: %s renders an em dash, never a rounded or guessed amount", (_label, bad) => {
    const out = formatVnd(bad as unknown as number);
    expect(out).toBe("—");
    expect(out).not.toMatch(/\d|NaN|Infinity|undefined|null/);
  });
});

describe("formatVndInput / parseVndInput", () => {
  it("groups with dots for every language and renders null as empty", () => {
    expect(formatVndInput(1250000)).toBe("1.250.000");
    expect(formatVndInput(0)).toBe("0");
    expect(formatVndInput(null)).toBe("");
  });

  it("renders a non-whole value as empty instead of a wrong number", () => {
    expect(formatVndInput(Number.NaN)).toBe("");
    expect(formatVndInput(12.5)).toBe("");
  });

  it("round-trips: parse(formatInput(n)) === n and parse(formatVnd(n)) === n", () => {
    for (const n of [0, 1, 999, 1000, 50000, 150000, 1234567, INT4_MAX]) {
      expect(parseVndInput(formatVndInput(n))).toBe(n);
      expect(parseVndInput(formatVnd(n))).toBe(n);
    }
  });

  it("parses typed/pasted amounts digits-only", () => {
    expect(parseVndInput("50.000")).toBe(50000);
    expect(parseVndInput(`50,000 ${D}`)).toBe(50000);
    expect(parseVndInput(`50.000${DONG_SIGN}`)).toBe(50000);
    expect(parseVndInput("0")).toBe(0);
    expect(parseVndInput("")).toBeNull();
    expect(parseVndInput("abc")).toBeNull();
  });

  it("flags an amount above int4 as invalid instead of clamping", () => {
    expect(parseVndInput("2147483647")).toBe(2147483647);
    expect(parseVndInput("2147483648")).toBeNaN();
  });
});

// L8 DM-9 (A1): the promotion DM renders its fee with @plexco/core's fmtMoney while the web renders
// amounts with formatVnd; one amount must read the same on both surfaces over the int4 domain.
describe("DM-9: fmtMoney (bot DM) === formatVnd (web) for every whole int4 amount class", () => {
  it.each([0, 5, 999, 1000, 50000, 1234567, 100000000, INT4_MAX])(
    "fmtMoney(%i) equals formatVnd of the same amount",
    (amount) => {
      expect(fmtMoney(amount)).toBe(formatVnd(amount));
    },
  );
});

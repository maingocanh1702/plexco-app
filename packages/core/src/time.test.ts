import { describe, expect, it } from "vitest";
import { inferYear } from "./time.js";

describe("inferYear", () => {
  it("exactly 30 calendar days ago stays the CURRENT year, even parsed at noon (boundary regression)", () => {
    // now = Jun 12 at noon; May 13 is exactly 30 calendar days earlier.
    const now = new Date(2026, 5, 12, 12, 0, 0);
    expect(inferYear(5, 13, now)).toBe(2026);
  });

  it("31 calendar days ago rolls to NEXT year, regardless of time-of-day", () => {
    const midnight = new Date(2026, 5, 12, 0, 0, 0);
    const noon = new Date(2026, 5, 12, 12, 0, 0);
    const lateNight = new Date(2026, 5, 12, 23, 59, 59);
    for (const now of [midnight, noon, lateNight]) {
      expect(inferYear(5, 12, now)).toBe(2027);
    }
  });

  it("29 calendar days ago stays the current year, regardless of time-of-day", () => {
    const midnight = new Date(2026, 5, 12, 0, 0, 0);
    const noon = new Date(2026, 5, 12, 12, 0, 0);
    for (const now of [midnight, noon]) {
      expect(inferYear(5, 14, now)).toBe(2026);
    }
  });

  it("a future date within the current year does not roll forward", () => {
    const now = new Date(2026, 0, 15);
    expect(inferYear(11, 25, now)).toBe(2026);
  });
});

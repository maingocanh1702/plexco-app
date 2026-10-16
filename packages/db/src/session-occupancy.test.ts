import { describe, expect, it } from "vitest";
import { slotsOpen } from "./session-occupancy.js";

/** slotsOpen is pure (no DB): NULL slots_max = unlimited = null; otherwise free slots clamped at 0. */
describe("slotsOpen", () => {
  it.each([
    { id: "SO1", slotsMax: null, occupied: 0, expected: null },
    { id: "SO2", slotsMax: null, occupied: 5, expected: null },
    { id: "SO3", slotsMax: 5, occupied: 0, expected: 5 },
    { id: "SO4", slotsMax: 5, occupied: 3, expected: 2 },
    { id: "SO5", slotsMax: 5, occupied: 5, expected: 0 },
    { id: "SO6", slotsMax: 2, occupied: 3, expected: 0 }, // over cap: never negative
  ])("$id: slotsOpen($slotsMax, $occupied) = $expected", ({ slotsMax, occupied, expected }) => {
    expect(slotsOpen(slotsMax, occupied)).toBe(expected);
  });
});

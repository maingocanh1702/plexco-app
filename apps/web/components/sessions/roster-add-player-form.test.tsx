import { describe, expect, it } from "vitest";
import { DISPLAY_NAME_MAX, addPlayerNameProblem } from "./roster-add-player-form";

// The code points under test are control, bidi or invisible characters, so every input is built from
// numbers and none of them appears as a literal in this source.
const cp = (codePoint: number): string => String.fromCodePoint(codePoint);

// One row per cell of the L29 decision table for the host-typed name of the add-player form (P2 web):
// "length" = nothing visible is left after the L27 strip and the trim, or more than DISPLAY_NAME_MAX;
// "chars" = a code point the web twin checkTypedName refuses is left (control, bidi, line or paragraph
// separator, blank-looking); null = the name is sent.
describe("addPlayerNameProblem", () => {
  it.each([
    { cell: "Cc U+0001 inside", raw: `Minh${cp(0x01)}Anh`, expected: "chars" },
    { cell: "Bidi_Control U+202E inside", raw: `Minh${cp(0x202e)}Anh`, expected: "chars" },
    { cell: "U+2028 inside", raw: `Minh${cp(0x2028)}Anh`, expected: "chars" },
    { cell: "U+2800 only", raw: cp(0x2800), expected: "chars" },
    { cell: "U+0000 inside", raw: `Minh${cp(0x00)}Anh`, expected: "chars" },
    { cell: "U+00A0 only", raw: cp(0xa0), expected: "length" },
    { cell: "U+3000 only", raw: cp(0x3000), expected: "length" },
    { cell: "U+200B only", raw: cp(0x200b), expected: "length" },
    { cell: "empty", raw: "", expected: "length" },
    { cell: "101 characters", raw: "a".repeat(DISPLAY_NAME_MAX + 1), expected: "length" },
    { cell: "ordinary name", raw: "Minh Anh", expected: null },
    {
      cell: "U+0009 before and U+2028 after Minh",
      raw: `${cp(0x09)}Minh${cp(0x2028)}`,
      expected: null,
    },
  ])("$cell -> $expected", ({ raw, expected }) => {
    expect(addPlayerNameProblem(raw)).toBe(expected);
  });
});

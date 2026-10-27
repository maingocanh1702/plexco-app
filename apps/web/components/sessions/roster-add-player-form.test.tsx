import {
  DISPLAY_NAME_MAX as SERVER_DISPLAY_NAME_MAX,
  checkTypedName as serverCheckTypedName,
  stripInvisibleChars as serverStripInvisibleChars,
} from "@plexco/db";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DISPLAY_NAME_MAX } from "../../lib/session-form-model";
import { addPlayerNameProblem } from "./roster-add-player-form";

// The code points under test are control, bidi or invisible characters, so every input is built from
// numbers and none of them appears as a literal in this source.
const cp = (codePoint: number): string => String.fromCodePoint(codePoint);

// One row per cell of the L29 decision table for the host-typed name of the add-player form (P2 web):
// "length" = nothing visible is left after the L27 strip and the trim, or more than DISPLAY_NAME_MAX
// code points; "chars" = a code point the web twin checkTypedName refuses is left (control, bidi,
// line or paragraph separator, blank-looking); null = the name is sent.
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
    { cell: "101 characters", raw: "a".repeat(101), expected: null },
    { cell: "120 characters", raw: "a".repeat(DISPLAY_NAME_MAX), expected: null },
    { cell: "121 characters", raw: "a".repeat(DISPLAY_NAME_MAX + 1), expected: "length" },
    // The cap counts code points: an astral emoji is one code point, two UTF-16 units.
    {
      cell: "120 astral (240 UTF-16 units)",
      raw: cp(0x1f3f8).repeat(DISPLAY_NAME_MAX),
      expected: null,
    },
    { cell: "121 astral", raw: cp(0x1f3f8).repeat(DISPLAY_NAME_MAX + 1), expected: "length" },
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

// A static render shows only the closed form (`open` starts false, the "Add player" button) and this
// package has no DOM test environment, so the open form's input bound and hint are pinned in its source,
// as the name-input bounds of the other forms are (session-form-model.test.ts).
describe("RosterAddPlayerForm source: the paste bound and the hint follow the cap", () => {
  const source = readFileSync(new URL("./roster-add-player-form.tsx", import.meta.url), "utf8");
  const count = (needle: string) => source.split(needle).length - 1;

  it("bounds the paste at 240 UTF-16 units (2 * DISPLAY_NAME_MAX) and shows the cap in the hint (vi, en)", () => {
    // 240 units let 120 astral code points through; the literal pins the value.
    expect(2 * DISPLAY_NAME_MAX).toBe(240);
    expect(count("maxLength=")).toBe(1);
    expect(count("maxLength={2 * DISPLAY_NAME_MAX}")).toBe(1);
    // The hint interpolates the cap: the needle is the interpolation as written in the form's source.
    const capInSource = "$" + "{DISPLAY_NAME_MAX}";
    const hint = (words: string) => `(1${cp(0x2013)}${capInSource} ${words})`;
    expect(count(hint("ký tự"))).toBe(1);
    expect(count(hint("characters"))).toBe(1);
  });
});

// Production-shaped names against the server rule of the @plexco/db root entry: the form sends a
// name exactly when the server accepts it, and `want` documents that answer.
describe("addPlayerNameProblem against the server rule", () => {
  const serverAccepts = (raw: string) => {
    const s = serverStripInvisibleChars(raw).trim();
    const n = [...s].length;
    return n >= 1 && n <= SERVER_DISPLAY_NAME_MAX && serverCheckTypedName(s) !== null;
  };
  const family = `${cp(0x1f468)}${cp(0x200d)}${cp(0x1f469)}${cp(0x200d)}${cp(0x1f467)}`;
  it.each([
    { cell: "ZWJ family", raw: family, want: true },
    {
      cell: "117 a + ZWJ family (120 after strip)",
      raw: `${"a".repeat(117)}${family}`,
      want: true,
    },
    {
      cell: "Nguyen Thi Anh (NFD marks)",
      raw: `Nguy${cp(0x1ec5)}n Th${cp(0x1ecb)} ${cp(0xc1)}nh`.normalize("NFD"),
      want: true,
    },
    { cell: "RLE Minh PDF (bidi-wrapped)", raw: `${cp(0x202b)}Minh${cp(0x202c)}`, want: false },
    { cell: "U+200B U+2060 only (hidden-only)", raw: `${cp(0x200b)}${cp(0x2060)}`, want: false },
    { cell: "VS16 heart + Lan", raw: `${cp(0x2764)}${cp(0xfe0f)} Lan`, want: true },
  ])("$cell -> server accepts: $want", ({ raw, want }) => {
    expect(serverAccepts(raw)).toBe(want);
    expect(addPlayerNameProblem(raw) === null).toBe(serverAccepts(raw));
  });
});

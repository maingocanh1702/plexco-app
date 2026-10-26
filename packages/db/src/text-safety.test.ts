import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DISPLAY_NAME_MAX as SETTINGS_NAME_MAX, validateDisplayName } from "./me-settings.js";
import { DISPLAY_NAME_MAX as ROSTER_NAME_MAX } from "./roster-money-shared.js";
import {
  checkTypedName,
  DISPLAY_NAME_MAX,
  hasHiddenChar,
  hasVisibleChar,
  normalizeExternalName,
  STRIP_CHAR_RANGES,
  stripInvisibleChars,
} from "./text-safety.js";

// Test strings are built from numbers, never pasted or escaped: these code points are invisible in
// source, and the editing tools turn escape sequences into raw bytes.
const cps = (...codePoints: number[]): string => String.fromCodePoint(...codePoints);
const units = (...codeUnits: number[]): string => String.fromCharCode(...codeUnits);

describe("stripInvisibleChars: the public-name strip (L23, DD-138 A.1)", () => {
  it("TX-ALL: strips exactly DI minus Bidi_Control of the running Node, over every scalar", () => {
    const defaultIgnorable = /^\p{Default_Ignorable_Code_Point}$/u;
    const bidiControl = /^\p{Bidi_Control}$/u;
    const mismatches: number[] = [];
    for (let cp = 0; cp <= 0x10ffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const c = cps(cp);
      const strip = defaultIgnorable.test(c) && !bidiControl.test(c);
      const expected = strip ? "ab" : "a" + c + "b";
      if (stripInvisibleChars("a" + c + "b") !== expected) mismatches.push(cp);
    }
    expect(mismatches).toEqual([]);
  });

  it("TX-PIN: one list of 16 sorted, disjoint, non-adjacent ranges holding 4162 code points", () => {
    expect(STRIP_CHAR_RANGES).toHaveLength(16);
    let total = 0;
    let previousLast = -2;
    for (const [first, last] of STRIP_CHAR_RANGES) {
      expect(first).toBeGreaterThan(previousLast + 1);
      expect(last).toBeGreaterThanOrEqual(first);
      total += last - first + 1;
      previousLast = last;
    }
    expect(total).toBe(4162);
  });

  it("TX-R1: a name without STRIP code points is unchanged", () => {
    const vietnamese = "S" + cps(0xe2) + "n C" + cps(0x1ea7) + "u L" + cps(0xf4) + "ng";
    for (const name of ["Quan 1", vietnamese, cps(0x1f3f8)]) {
      expect(stripInvisibleChars(name)).toBe(name);
    }
  });

  it("TX-R2: STRIP code points among visible text are removed, the rest kept in order", () => {
    for (const cp of [0x200b, 0x00ad, 0x3164, 0xfe00, 0xe0001, 0x2065]) {
      expect(stripInvisibleChars("Quan" + cps(cp) + " 1")).toBe("Quan 1");
    }
    const mixed = cps(0x200b) + "S" + cps(0xfeff, 0x2060) + "an" + cps(0xe0100);
    expect(stripInvisibleChars(mixed)).toBe("San");
  });

  it("TX-R3: a name of STRIP code points only (or with whitespace) keeps no visible character", () => {
    expect(stripInvisibleChars(cps(0x200b, 0xfe0f, 0x3164, 0xe0001))).toBe("");
    // The caller's trim then sees an empty name and refuses it exactly as today.
    const blank = stripInvisibleChars(" " + cps(0x200d, 0xffa0) + " ");
    expect(blank).toBe("  ");
    expect(hasVisibleChar(blank)).toBe(false);
  });

  it("TX-R4: the owner's rule as written splits composed emoji (no emoji exception)", () => {
    // U+1F468 U+200D U+1F469 U+200D U+1F467 (a ZWJ family) becomes its three separate emoji.
    const family = cps(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467);
    expect(stripInvisibleChars(family)).toBe(cps(0x1f468, 0x1f469, 0x1f467));
    // U+2764 U+FE0F (the emoji-presentation heart) becomes the text heart U+2764.
    expect(stripInvisibleChars(cps(0x2764, 0xfe0f))).toBe(cps(0x2764));
  });

  it("TX-R5: control, bidi, line-separator and U+2800 code points are kept for hasHiddenChar", () => {
    for (const cp of [0x202e, 0x0007, 0x2028, 0x2800]) {
      const name = "a" + cps(cp) + "b";
      expect(stripInvisibleChars(name)).toBe(name);
      expect(hasHiddenChar(stripInvisibleChars(name))).toBe(true);
    }
  });

  it("the 133 STRIP code points hasHiddenChar refuses today are stripped, so they pass it", () => {
    const moved: number[] = [];
    for (const [first, last] of STRIP_CHAR_RANGES) {
      for (let cp = first; cp <= last; cp++) if (hasHiddenChar(cps(cp))) moved.push(cp);
    }
    expect(moved).toHaveLength(133);
    const stillHidden = moved.filter((cp) =>
      hasHiddenChar(stripInvisibleChars("a" + cps(cp) + "b")),
    );
    expect(stillHidden).toEqual([]);
    expect(hasHiddenChar(stripInvisibleChars("a" + cps(0x202e) + "b"))).toBe(true);
  });

  it("changes nothing else: outer spaces, case and an NFD string are kept byte for byte", () => {
    const padded = "  QuAn 1  ";
    expect(stripInvisibleChars(padded)).toBe(padded);
    const nfc = "Qu" + cps(0x1ead) + "n";
    const nfd = nfc.normalize("NFD");
    expect(nfd).not.toBe(nfc);
    expect(stripInvisibleChars(nfd)).toBe(nfd);
    expect(stripInvisibleChars(nfc)).toBe(nfc);
  });

  it("one call is final on malformed input: lone surrogates that meet after a strip are retested", () => {
    // U+DB40, U+200B, U+DD00: once the ZWSP is gone the halves form U+E0100 (a variation selector).
    expect(stripInvisibleChars(units(0xdb40, 0x200b, 0xdd00))).toBe("");
    const nested = "a" + units(0xdb40, 0xdb40, 0x200b, 0xdd00, 0xdd00) + "b";
    expect(stripInvisibleChars(nested)).toBe("ab");
    // Halves that meet as a non-STRIP code point (U+1F600) stay; lone surrogates are not touched.
    expect(stripInvisibleChars(units(0xd83d, 0x200b, 0xde00))).toBe(cps(0x1f600));
    const lone = units(0xd800) + "a" + units(0xdc00);
    expect(stripInvisibleChars(lone)).toBe(lone);
  });

  it("is idempotent: strip of strip = strip", () => {
    const samples = [
      "Quan" + cps(0x200b) + " 1",
      " " + cps(0xfeff, 0xe0001, 0xe007f) + " ",
      cps(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467),
      cps(0x2764, 0xfe0f),
      "a" + cps(0x202e) + "b",
      units(0xdb40, 0x200b, 0xdd00),
      units(0xdb40, 0xdb40, 0x200b, 0xdd00, 0xdd00),
      units(0xd83d, 0x200b, 0xde00),
      units(0xd800, 0x200b),
    ];
    for (const sample of samples) {
      const once = stripInvisibleChars(sample);
      expect(stripInvisibleChars(once)).toBe(once);
    }
  });
});

describe("L29-T text-safety: the typed-name check and the external-name normalizer (L29, readiness D1, D2, D5a)", () => {
  // Three positions per scalar: alone, at an edge, inside visible text. A hidden code point that
  // trim() also removes (TAB, LF, U+2028, U+2029) is trimmed away at an edge, refused inside (D1d).
  const placed = (c: string): string[] => [c, c + "ab", "a" + c + "b"];
  const badScalars = (ok: (value: string, alone: boolean) => boolean): number[] => {
    const bad: number[] = [];
    for (let cp = 0; cp <= 0x10ffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      if (!placed(cps(cp)).every((value, i) => ok(value, i === 0))) bad.push(cp);
    }
    return bad;
  };

  it("L29-T2: normalizeExternalName never throws or returns '', keeps no hidden code point, is idempotent and agrees with checkTypedName, over every scalar", () => {
    const bad = badScalars((value, alone) => {
      let got: string | null;
      try {
        got = normalizeExternalName(value);
      } catch {
        return false;
      }
      // Null exactly when a lone code point leaves nothing visible: visible text never goes away.
      const mustBeNull = alone && !(hasVisibleChar(value) && !hasHiddenChar(value));
      if ((got === null) !== mustBeNull) return false;
      if (got === null) return true;
      const typed = checkTypedName(value);
      return (
        got !== "" &&
        !hasHiddenChar(got) &&
        normalizeExternalName(got) === got &&
        (typed === null || typed === got)
      );
    });
    expect(bad).toEqual([]);
  }, 30_000);

  it("L29-T3: validateDisplayName equals checkTypedName inside its length bound, over every scalar", () => {
    const validated = (value: string): string | null => {
      try {
        return validateDisplayName(value);
      } catch {
        return null; // A refusal counts as null.
      }
    };
    const bad = badScalars((value) => validated(value) === checkTypedName(value));
    expect(bad).toEqual([]);
  }, 30_000);
});

describe("L42 one display-name cap", () => {
  it("is 120, and me-settings and roster-money-shared export the same value", () => {
    expect(DISPLAY_NAME_MAX).toBe(120);
    expect(SETTINGS_NAME_MAX).toBe(DISPLAY_NAME_MAX);
    expect(ROSTER_NAME_MAX).toBe(DISPLAY_NAME_MAX);
  });

  it("source guard: exactly one definition in packages/db/src, in text-safety.ts", () => {
    const dir = new URL("./", import.meta.url);
    const definitions = readdirSync(dir)
      .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
      .flatMap((file) => {
        const source = readFileSync(new URL(file, dir), "utf8");
        // Every declaration counts, with or without a type annotation or a numeric initializer.
        return (source.match(/\b(?:const|let|var)\s+DISPLAY_NAME_MAX\b/g) ?? []).map(() => file);
      });
    expect(definitions).toEqual(["text-safety.ts"]);
  });
});

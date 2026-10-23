import { validatePublicAlias } from "@plexco/db";
import { describe, expect, it } from "vitest";
import type { ClubConfigDto } from "./club-settings-client";
import {
  buildDefaultsPatch,
  buildProfilePatch,
  clubNameProblem,
  defaultsValues,
  normalizePriceInput,
  profileValues,
  publicAliasProblem,
  publicAliasValue,
  timezoneOptions,
  unsureAfter,
} from "./club-settings-model";
import { validateNewClub } from "./new-club-form";

const club: ClubConfigDto = {
  slug: "clb",
  name: "CLB Cầu lông",
  timezone: "Asia/Ho_Chi_Minh",
  locale: "vi",
  defaultSportKey: "badminton",
  defaultPriceAmount: 50000,
  defaultVisibility: "private",
};
const fmt = (n: number) => String(n);
const ch = (cp: number) => String.fromCodePoint(cp);

describe("clubNameProblem (same count as club-config-validation.ts: UTF-16 units)", () => {
  it.each([
    ["CLB Cầu lông", null],
    ["x".repeat(120), null],
    ["x".repeat(121), "too_long"],
    // An astral emoji is 2 UTF-16 units: 60 fit, 61 are 122 units and the route refuses them.
    [ch(0x1f3f8).repeat(60), null],
    [ch(0x1f3f8).repeat(61), "too_long"],
    ["", "empty"],
    ["   ", "empty"],
    ["a" + ch(0x09) + "b", "invalid_chars"],
    // L27: the strip comes first (the server stores the stripped name): U+200B among visible text
    // raises no error (R2), alone it is empty (R3), a control after it still refuses (R4).
    ["a" + ch(0x200b) + "b", null],
    [ch(0x200b) + ch(0x3164), "empty"],
    ["x".repeat(120) + ch(0x200b).repeat(3), null], // length counts after the strip
    ["a" + ch(0x200b) + ch(0x09) + "b", "invalid_chars"],
    ["a" + ch(0x202e) + "b", "invalid_chars"],
    // L29: U+2028 is refused like a control (the web checkTypedName); it was accepted before.
    ["a" + ch(0x2028) + "b", "invalid_chars"],
    // R5: U+200D and U+FE0F are stripped, so the server stores composed emoji split (the owner's
    // rule applied as written, no exception); the form raises no error for them.
    [ch(0x1f468) + ch(0x200d) + ch(0x1f469) + ch(0x200d) + ch(0x1f467), null], // ZWJ family
    [ch(0x2764) + ch(0xfe0f), null], // VS16 heart
  ])("%j -> %s", (input, expected) => {
    expect(clubNameProblem(input)).toBe(expected);
  });
});

// L29 U8c (readiness section 7, row T2 web clubNameProblem): after the strip, the trim and the
// length checks the club name is held to the web checkTypedName, the server's typed-name rule.
// One cell per class; the same inputs feed the T1 and T2 agreement cell.
const tEn = (_vi: string, e: string) => e;
const CLUB_NAME_CELLS: { name: string; input: string; expected: string | null }[] = [
  { name: "Cc U+0001 inside", input: "a" + ch(0x01) + "b", expected: "invalid_chars" },
  { name: "Bidi_Control U+202E inside", input: "a" + ch(0x202e) + "b", expected: "invalid_chars" },
  { name: "U+0000 inside", input: "a" + ch(0x00) + "b", expected: "invalid_chars" },
  {
    name: "U+2028 inside (was accepted)",
    input: "a" + ch(0x2028) + "b",
    expected: "invalid_chars",
  },
  { name: "U+2800 only (was accepted)", input: ch(0x2800), expected: "invalid_chars" },
  { name: "U+00A0 only", input: ch(0x00a0), expected: "empty" },
  { name: "U+200B only", input: ch(0x200b), expected: "empty" },
  { name: "ordinary name", input: "WAO Club", expected: null },
  {
    name: "edge: U+0009 before, U+2028 after",
    input: ch(0x09) + "WAO" + ch(0x2028),
    expected: null,
  },
];

describe("L29 clubNameProblem cells (T2 web mirror of the server typed-name rule)", () => {
  it.each(CLUB_NAME_CELLS)("$name -> $expected", ({ input, expected }) => {
    expect(clubNameProblem(input)).toBe(expected);
  });

  it("T1 and T2 agree: clubNameProblem is null exactly when validateNewClub has no name error", () => {
    const values = {
      name: "",
      slug: "wao-club",
      timezone: "Asia/Ho_Chi_Minh",
      locale: "vi" as const,
    };
    const disagree = CLUB_NAME_CELLS.filter(
      ({ input }) =>
        (clubNameProblem(input) === null) !==
        (validateNewClub({ ...values, name: input }, tEn).name === undefined),
    ).map(({ name }) => name);
    expect(disagree).toEqual([]);
  });
});

describe("publicAliasProblem (A-24: M-1..M-3, the rule of validatePublicAlias)", () => {
  it.each([
    ["  CLB Cầu Lông Q7  ", null],
    // Code points, unlike the club name: 60 astral emoji are 120 UTF-16 units and still fit.
    [ch(0x1f600).repeat(60), null],
    [ch(0x1f600).repeat(61), "too_long"],
    ["", "empty"],
    ["   ", "empty"],
    [ch(0xfe0f), "empty"], // a lone variation selector renders blank
    // Strip-first (L23, readiness D3), R3: U+3164 alone is stripped to nothing, so it reads as empty
    // exactly like "" (it was invalid_chars before the strip).
    [ch(0x3164), "empty"],
    [ch(0x2800), "invalid_chars"],
    ["a" + ch(0x202e) + "b", "invalid_chars"],
    // Strip-first (L23, readiness D3), R2: U+200B and U+00AD inside visible text are stripped, so
    // "ab" is accepted (both were invalid_chars before the strip).
    ["a" + ch(0x200b) + "b", null],
    ["a" + ch(0x07) + "b", "invalid_chars"],
    ["a" + ch(0x2028) + "b", "invalid_chars"], // refused here, accepted in a club name
    ["a" + ch(0xad) + "b", null],
  ])("%j -> %s", (input, expected) => {
    expect(publicAliasProblem(input)).toBe(expected);
  });

  it("accepts exactly what validatePublicAlias accepts, alone and embedded, over every scalar", () => {
    const accepts = (s: string) => {
      try {
        return validatePublicAlias(s).length > 0;
      } catch {
        return false;
      }
    };
    const mismatches: number[] = [];
    for (let cp = 0; cp <= 0x10ffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      for (const s of [ch(cp), "a" + ch(cp) + "b"]) {
        if ((publicAliasProblem(s) === null) !== accepts(s)) mismatches.push(cp);
      }
    }
    expect(mismatches).toEqual([]);
  }, 30_000);
});

// L23 strip-first (DD-138 sign-off A.1; readiness D3, D4, D11): rows R1-R5 of the readiness decision
// table for the public alias in this model. Every input is built with ch() or String.fromCodePoint,
// never pasted.
const cps = (s: string) => [...s].map((c) => c.codePointAt(0));
const visibleWith = (cp: number) => "CLB" + ch(cp) + "Q7";
const serverStores = (s: string): string | null => {
  try {
    return validatePublicAlias(s);
  } catch {
    return null;
  }
};

describe("public alias strip-first rule (L23 decision table, alias column)", () => {
  it("CS-R1: no invisible code point -> unchanged (trimmed only) and accepted", () => {
    for (const input of ["CLB Cầu Lông Q7", "  CLB Cầu Lông Q7  ", "a b", ch(0x1f3f8)]) {
      expect(publicAliasProblem(input)).toBeNull();
      expect(publicAliasValue(input)).toBe(input.trim());
    }
  });

  it.each([
    { name: "U+200B ZERO WIDTH SPACE", cp: 0x200b },
    { name: "U+00AD SOFT HYPHEN", cp: 0x00ad },
    { name: "U+3164 HANGUL FILLER", cp: 0x3164 },
    { name: "U+FE00 VARIATION SELECTOR-1", cp: 0xfe00 },
    { name: "U+E0001 LANGUAGE TAG", cp: 0xe0001 },
    { name: "U+2065 unassigned default-ignorable", cp: 0x2065 },
  ])("CS-R2: $name inside visible text -> stripped and accepted", ({ cp }) => {
    expect(publicAliasProblem(visibleWith(cp))).toBeNull();
    expect(publicAliasValue(visibleWith(cp))).toBe("CLBQ7");
  });

  it("CS-R2: the strip runs before the trim, and the 1..60 length counts the stripped value", () => {
    const spaced = "  " + ch(0x200b) + " CLB Q7 " + ch(0x3164) + "  ";
    expect(publicAliasProblem(spaced)).toBeNull();
    expect(publicAliasValue(spaced)).toBe("CLB Q7");
    expect(publicAliasProblem("x".repeat(60) + ch(0x200b).repeat(20))).toBeNull();
    expect(publicAliasProblem("x".repeat(61) + ch(0x200b))).toBe("too_long");
  });

  it("CS-R3: only invisible code points (or them and whitespace) -> 'empty', exactly like an empty alias", () => {
    const empty = publicAliasProblem("");
    expect(empty).toBe("empty");
    for (const cp of [0x200b, 0x00ad, 0x3164, 0xfe0f, 0xe0100, 0x180b, 0x2060, 0xfeff]) {
      for (const input of [
        ch(cp),
        ch(cp).repeat(5),
        " " + ch(cp) + " ",
        ch(cp) + " " + ch(0x3164),
      ]) {
        expect(publicAliasProblem(input)).toBe(empty);
        expect(publicAliasValue(input)).toBe("");
      }
    }
  });

  it("CS-R4: U+200D and U+FE0F inside an emoji sequence are stripped, exact code points (owner's rule, no emoji exception)", () => {
    const heart = ch(0x2764) + ch(0xfe0f);
    const family = String.fromCodePoint(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467);
    expect(publicAliasProblem(heart)).toBeNull();
    expect(cps(publicAliasValue(heart))).toEqual([0x2764]);
    expect(publicAliasProblem(family)).toBeNull();
    expect(cps(publicAliasValue(family))).toEqual([0x1f468, 0x1f469, 0x1f467]);
    expect(cps(publicAliasValue("CLB " + heart))).toEqual([0x43, 0x4c, 0x42, 0x20, 0x2764]);
  });

  it.each([
    { name: "U+202E bidi override", cp: 0x202e },
    { name: "U+0007 control", cp: 0x07 },
    { name: "U+2028 line separator", cp: 0x2028 },
    { name: "U+2800 braille blank", cp: 0x2800 },
  ])("CS-R5: $name among visible text -> refused as today", ({ cp }) => {
    expect(publicAliasProblem(visibleWith(cp))).toBe("invalid_chars");
    // A stripped code point beside it does not launder it: the refused one is still there.
    expect(publicAliasProblem("CLB" + ch(0x200b) + ch(cp) + "Q7")).toBe("invalid_chars");
  });

  it("client and server agree on the R1-R5 inputs: same verdict and the very value the server stores", () => {
    const inputs = [
      "CLB Cầu Lông Q7", // R1
      "  CLB Cầu Lông Q7  ",
      ...[0x200b, 0x00ad, 0x3164, 0xfe00, 0xe0001, 0x2065].map(visibleWith), // R2
      "  " + ch(0x200b) + " CLB Q7 " + ch(0x3164) + "  ",
      "x".repeat(60) + ch(0x200b).repeat(20),
      "x".repeat(61) + ch(0x200b),
      ch(0x3164), // R3
      " " + ch(0x200b) + " ",
      ch(0xfe0f).repeat(4),
      String.fromCharCode(0xdb40, 0x200b, 0xdd00), // lone surrogates around a stripped code point
      ch(0x2764) + ch(0xfe0f), // R4
      String.fromCodePoint(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467),
      ...[0x202e, 0x07, 0x2028, 0x2800].map(visibleWith), // R5
      "CLB" + ch(0x200b) + ch(0x202e) + "Q7",
    ];
    const mismatches: string[] = [];
    for (const input of inputs) {
      const client = publicAliasProblem(input) === null ? publicAliasValue(input) : null;
      if (client !== serverStores(input)) mismatches.push(cps(input).join(","));
    }
    expect(mismatches).toEqual([]);
    // Not vacuous: the table holds accepted and refused inputs.
    expect(inputs.filter((s) => serverStores(s) !== null).length).toBeGreaterThan(10);
    expect(inputs.filter((s) => serverStores(s) === null).length).toBeGreaterThan(5);
  });
});

describe("buildProfilePatch", () => {
  it("unchanged form sends nothing (a PATCH needs >= 1 field)", () => {
    expect(buildProfilePatch(club, profileValues(club))).toBeNull();
  });
  it("sends only the changed fields, trimmed", () => {
    expect(
      buildProfilePatch(club, { name: "  CLB Mới ", timezone: "Asia/Ho_Chi_Minh", locale: "en" }),
    ).toEqual({ name: "CLB Mới", locale: "en" });
  });
  it("a whitespace-only edit of the name is not a change", () => {
    expect(buildProfilePatch(club, { ...profileValues(club), name: " CLB Cầu lông " })).toBeNull();
  });
  it("after an uncertain failure, a field changed back to the loaded value is SENT, never 'nothing changed'", () => {
    // {name: "CLB Mới"} failed uncertainly: the server may hold it, so reverting must reach it.
    const unsure = unsureAfter(undefined, { name: "CLB Mới" });
    expect(buildProfilePatch(club, profileValues(club), unsure)).toEqual({ name: "CLB Cầu lông" });
    // ...and alongside a real edit, the unsure field still travels.
    expect(buildProfilePatch(club, { ...profileValues(club), locale: "en" }, unsure)).toEqual({
      name: "CLB Cầu lông",
      locale: "en",
    });
  });
});

describe("unsureAfter", () => {
  it("accumulates the fields of every uncertain attempt", () => {
    const first = unsureAfter(undefined, { name: "A" });
    expect([...unsureAfter(first, { timezone: "UTC", locale: "en" })].sort()).toEqual([
      "locale",
      "name",
      "timezone",
    ]);
    expect([...first]).toEqual(["name"]); // the earlier set is not mutated
  });
});

describe("buildDefaultsPatch", () => {
  const base = defaultsValues(club, fmt);
  it("unchanged -> no patch", () => {
    expect(buildDefaultsPatch(club, base)).toEqual({ patch: null, problem: null });
  });
  it("changed price + visibility only", () => {
    expect(buildDefaultsPatch(club, { ...base, price: "60.000", visibility: "public" })).toEqual({
      patch: { defaultPriceAmount: 60000, defaultVisibility: "public" },
      problem: null,
    });
  });
  it("0 is a valid price (free)", () => {
    expect(buildDefaultsPatch(club, { ...base, price: "0" }).patch).toEqual({
      defaultPriceAmount: 0,
    });
  });
  it("an over-int4 price is invalid, never clamped", () => {
    expect(buildDefaultsPatch(club, { ...base, price: "99999999999" })).toEqual({
      patch: null,
      problem: "price_invalid",
    });
  });
  it("a saved price cannot be blanked", () => {
    expect(buildDefaultsPatch(club, { ...base, price: "" }).problem).toBe("price_required");
  });
  it("a saved sport cannot be cleared: 'Not set' is a problem, never a silent 'nothing changed'", () => {
    expect(buildDefaultsPatch(club, { ...base, sportKey: "" })).toEqual({
      patch: null,
      problem: "sport_required",
    });
    // ...even when another field changed in the same submit.
    expect(buildDefaultsPatch(club, { ...base, sportKey: "", visibility: "public" }).problem).toBe(
      "sport_required",
    );
  });
  it("a changed sport is sent; a never-set sport may stay unset", () => {
    expect(buildDefaultsPatch(club, { ...base, sportKey: "pickleball" }).patch).toEqual({
      defaultSportKey: "pickleball",
    });
    const noSport: ClubConfigDto = { ...club, defaultSportKey: null };
    expect(buildDefaultsPatch(noSport, defaultsValues(noSport, fmt))).toEqual({
      patch: null,
      problem: null,
    });
  });
  it("after an uncertain failure the unsure defaults are sent back as the form holds them", () => {
    const unsure = unsureAfter(undefined, {
      defaultPriceAmount: 60000,
      defaultVisibility: "public",
    });
    expect(buildDefaultsPatch(club, base, unsure)).toEqual({
      patch: { defaultPriceAmount: 50000, defaultVisibility: "private" },
      problem: null,
    });
  });
  it("an unsure sport or price counts as saved: blanking it is a problem, not 'nothing changed'", () => {
    const empty: ClubConfigDto = { ...club, defaultSportKey: null, defaultPriceAmount: null };
    const values = defaultsValues(empty, fmt);
    expect(
      buildDefaultsPatch(empty, values, unsureAfter(undefined, { defaultSportKey: "badminton" })),
    ).toEqual({ patch: null, problem: "sport_required" });
    expect(
      buildDefaultsPatch(empty, values, unsureAfter(undefined, { defaultPriceAmount: 1000 })),
    ).toEqual({ patch: null, problem: "price_required" });
  });
  it("a never-set club with an untouched form sends nothing", () => {
    const empty: ClubConfigDto = {
      ...club,
      defaultSportKey: null,
      defaultPriceAmount: null,
      defaultVisibility: null,
    };
    expect(buildDefaultsPatch(empty, defaultsValues(empty, fmt))).toEqual({
      patch: null,
      problem: null,
    });
  });
});

describe("normalizePriceInput (displayed default price === saved default price)", () => {
  const savedFor = (typed: string) =>
    buildDefaultsPatch(club, { ...defaultsValues(club, (n) => String(n)), price: typed }).patch
      ?.defaultPriceAmount;

  it.each([
    ["1,500.50", "150.050", 150050],
    ["1.5", "15", 15],
    ["50000", "50.000", undefined], // equals the saved club price -> no patch
    ["12 345", "12.345", 12345],
    ["0", "0", 0],
  ] as const)("typed %j shows %j and saves %j", (typed, shown, saved) => {
    const display = normalizePriceInput(typed);
    expect(display).toBe(shown);
    // what the box shows, fed back through the patch builder, is what gets saved
    expect(savedFor(display)).toBe(saved);
    expect(savedFor(typed)).toBe(saved);
  });

  it("is idempotent, so re-rendering the shown value never changes it", () => {
    for (const typed of ["1,500.50", "1.5", "007", "2147483647"]) {
      const once = normalizePriceInput(typed);
      expect(normalizePriceInput(once)).toBe(once);
    }
  });

  it("empty and non-digit input clear the box; an over-int4 value is kept as typed (submit rejects it)", () => {
    expect(normalizePriceInput("")).toBe("");
    expect(normalizePriceInput("abc")).toBe("");
    expect(normalizePriceInput("2147483648")).toBe("2147483648");
    expect(
      buildDefaultsPatch(club, { ...defaultsValues(club, String), price: "2147483648" }),
    ).toEqual({
      patch: null,
      problem: "price_invalid",
    });
  });
});

describe("timezoneOptions", () => {
  it("keeps an uncommon saved zone selectable", () => {
    expect(timezoneOptions("Pacific/Auckland")[0]).toBe("Pacific/Auckland");
    expect(timezoneOptions("Asia/Tokyo")).not.toContain("Pacific/Auckland");
  });
});

import { describe, expect, it } from "vitest";
import { makeT } from "./i18n-client";
import {
  DEFAULT_TIMEZONE,
  SLUG_RE,
  buildTimezoneOptions,
  onboardingErrorMessage,
  slugify,
  validateNewClub,
} from "./new-club-form";

const t = makeT("en");

describe("slugify", () => {
  it("strips Vietnamese diacritics and joins words with dashes", () => {
    expect(slugify("Câu Lạc Bộ Cầu Lông Đống Đa")).toBe("cau-lac-bo-cau-long-dong-da");
  });
  it("trims edges, collapses runs and caps at 63 chars with no trailing dash", () => {
    expect(slugify("  --Hello!!  World--  ")).toBe("hello-world");
    const long = slugify("a ".repeat(60));
    expect(long.length).toBeLessThanOrEqual(63);
    expect(long.endsWith("-")).toBe(false);
  });
  it("derived slugs satisfy the server pattern when long enough", () => {
    expect(SLUG_RE.test(slugify("Plexco FC"))).toBe(true);
  });
});

describe("validateNewClub", () => {
  const ok = {
    name: "Plexco FC",
    slug: "plexco-fc",
    timezone: "Asia/Ho_Chi_Minh",
    locale: "vi" as const,
  };
  it("accepts a valid form", () => expect(validateNewClub(ok, t)).toEqual({}));
  it("rejects empty and over-long names", () => {
    expect(validateNewClub({ ...ok, name: "   " }, t).name).toBeTruthy();
    expect(validateNewClub({ ...ok, name: "x".repeat(121) }, t).name).toBe(
      "Name can be at most 120 characters.",
    );
    expect(validateNewClub({ ...ok, name: "x".repeat(120) }, t).name).toBeUndefined();
  });
  it("counts the club name in code points: 120 astral letters accepted, 121 refused", () => {
    const ch = String.fromCodePoint(0x20000); // a CJK Extension B ideograph, a letter
    expect(validateNewClub({ ...ok, name: ch.repeat(120) }, t).name).toBeUndefined();
    expect(validateNewClub({ ...ok, name: ch.repeat(121) }, t).name).toBe(
      "Name can be at most 120 characters.",
    );
  });
  // L27: strip first, as the server stores the stripped name. R2 and R5 raise no error, R3 is the
  // existing empty error; R5: composed emoji are stored split (the owner's rule as written).
  it.each([
    ["CLB " + String.fromCodePoint(0x200b) + "Đống Đa", false],
    ["x".repeat(120) + String.fromCodePoint(0x200b), false],
    ["x".repeat(114) + String.fromCodePoint(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467), false], // R5 (owner's rule, emoji stored split): 117 code points after the strip, 119 if the ZWJs stayed
    ["x".repeat(119) + String.fromCodePoint(0x2764, 0xfe0f), false], // R5 (owner's rule, emoji stored split): 120 code points after the strip, 121 if U+FE0F stayed
    [String.fromCodePoint(0x20, 0x200b, 0x3164), true],
  ])("name %j -> error %s", (name, hasError) => {
    const error = validateNewClub({ ...ok, name }, t).name;
    expect(Boolean(error)).toBe(hasError);
    if (hasError) expect(error).toBe(t("Nhập tên câu lạc bộ.", "Enter a club name."));
  });
  // L29 (T1): after the strip, trim, empty and length checks, a name the web twin checkTypedName
  // refuses gets the settings form's pair; U+00A0 and U+200B alone stay the empty error.
  // Every input is built from code points.
  const cp = (...points: number[]) => String.fromCodePoint(...points);
  const tVi = makeT("vi");
  const emptyPair = ["Nhập tên câu lạc bộ.", "Enter a club name."] as const;
  const hiddenPair = [
    "Tên không được chứa ký tự điều khiển hoặc ký tự ẩn.",
    "The name cannot contain control or hidden characters.",
  ] as const;
  it.each([
    ["Cc U+0001 inside", "WAO" + cp(0x01) + "Club", hiddenPair],
    ["Bidi_Control U+202E inside", "WAO" + cp(0x202e) + "Club", hiddenPair],
    ["U+2028 inside", "WAO" + cp(0x2028) + "Club", hiddenPair],
    ["U+2800 only", cp(0x2800), hiddenPair],
    ["U+0000 inside", "WAO" + cp(0x00) + "Club", hiddenPair],
    ["lone surrogate U+D800 inside", "WAO" + cp(0xd800) + "Club", hiddenPair],
    ["U+00A0 only", cp(0xa0), emptyPair],
    ["U+200B only", cp(0x200b), emptyPair],
    ["ordinary name", "WAO Club", undefined],
    ["U+0009 before and U+2028 after, trimmed", cp(0x09) + "WAO" + cp(0x2028), undefined],
  ])("name: %s", (_cell, name, pair) => {
    const want = (tr: typeof t) => (pair ? tr(pair[0], pair[1]) : undefined);
    expect(validateNewClub({ ...ok, name }, t).name).toBe(want(t));
    expect(validateNewClub({ ...ok, name }, tVi).name).toBe(want(tVi));
  });
  it("rejects bad slugs (leading dash, 1 char, uppercase digits ok after lowercasing)", () => {
    expect(validateNewClub({ ...ok, slug: "-abc" }, t).slug).toBeTruthy();
    expect(validateNewClub({ ...ok, slug: "a" }, t).slug).toBeTruthy();
    expect(validateNewClub({ ...ok, slug: "has space" }, t).slug).toBeTruthy();
    expect(validateNewClub({ ...ok, slug: "ABC-1" }, t).slug).toBeUndefined();
  });
});

describe("onboardingErrorMessage", () => {
  it("AUTH_REQUIRED means redirect (null); known codes map; unknown fails closed", () => {
    expect(onboardingErrorMessage("AUTH_REQUIRED", t)).toBeNull();
    expect(onboardingErrorMessage("AUTH_INVALID", t)).toBeNull();
    expect(onboardingErrorMessage("SLUG_TAKEN", t)).toMatch(/already uses/);
    expect(onboardingErrorMessage("RATE_LIMITED", t)).toMatch(/Too many/);
    expect(onboardingErrorMessage("INVALID_BODY", t)).toMatch(/invalid/);
    expect(onboardingErrorMessage("WHATEVER", t)).toMatch(/could not create/);
  });
});

describe("buildTimezoneOptions", () => {
  it("puts the default first even when the browser only lists its canonical alias", () => {
    const options = buildTimezoneOptions(["Africa/Abidjan", "Asia/Saigon"]);
    expect(options[0]).toBe(DEFAULT_TIMEZONE);
    expect(options).toContain("Asia/Saigon");
  });
  it("does not duplicate the default when it is already listed", () => {
    const options = buildTimezoneOptions(["Africa/Abidjan", DEFAULT_TIMEZONE]);
    expect(options.filter((zone) => zone === DEFAULT_TIMEZONE)).toHaveLength(1);
  });
});

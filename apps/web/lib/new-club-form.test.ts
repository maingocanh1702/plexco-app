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
    expect(validateNewClub({ ...ok, name: "x".repeat(121) }, t).name).toBeTruthy();
    expect(validateNewClub({ ...ok, name: "x".repeat(120) }, t).name).toBeUndefined();
  });
  // L27: strip first, as the server stores the stripped name. R2 and R5 raise no error, R3 is the
  // existing empty error; R5: composed emoji are stored split (the owner's rule as written).
  it.each([
    ["CLB " + String.fromCodePoint(0x200b) + "Đống Đa", false],
    ["x".repeat(120) + String.fromCodePoint(0x200b), false],
    [String.fromCodePoint(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467), false],
    [String.fromCodePoint(0x2764, 0xfe0f), false],
    [String.fromCodePoint(0x20, 0x200b, 0x3164), true],
  ])("name %j -> error %s", (name, hasError) => {
    const error = validateNewClub({ ...ok, name }, t).name;
    expect(Boolean(error)).toBe(hasError);
    if (hasError) expect(error).toBe(t("Nhập tên câu lạc bộ.", "Enter a club name."));
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

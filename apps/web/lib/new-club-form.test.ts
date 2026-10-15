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

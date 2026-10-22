import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "./api-client";
import {
  displayNameProblem,
  genderChanges,
  getMyProfile,
  patchMyProfile,
  platformLabel,
} from "./me-settings-client";

vi.mock("./api-client", () => ({ apiFetch: vi.fn() }));

describe("profile wrappers (4.9: gender, consent, genderCollection)", () => {
  const profile = { displayName: "Lan", gender: "female", genderConsent: true } as const;
  beforeEach(() => vi.mocked(apiFetch).mockReset());

  it.each([true, false])(
    "getMyProfile carries genderCollection %s with the profile",
    async (on) => {
      vi.mocked(apiFetch).mockResolvedValue({ profile, genderCollection: on });
      await expect(getMyProfile()).resolves.toEqual({ ...profile, genderCollection: on });
      expect(apiFetch).toHaveBeenCalledWith("/api/me/profile", { signal: undefined });
    },
  );

  it("patchMyProfile sends only the given fields plus commandId and returns the profile", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ profile, genderCollection: true });
    const body = { gender: null, genderConsent: false, commandId: "c1" };
    await expect(patchMyProfile("csrf", body)).resolves.toEqual(profile);
    expect(apiFetch).toHaveBeenCalledWith("/api/me/profile", {
      method: "PATCH",
      csrfToken: "csrf",
      json: body,
    });
  });

  it("genderChanges: only the changed fields, and never genderConsent true with gender null", () => {
    const stored = { displayName: "Lan", gender: "male", genderConsent: false } as const;
    expect(genderChanges(stored, "male", false)).toEqual({});
    expect(genderChanges(stored, "other", true)).toEqual({ gender: "other", genderConsent: true });
    expect(genderChanges(stored, null, true)).toEqual({ gender: null });
    expect(genderChanges({ ...stored, gender: null }, null, true)).toEqual({});
  });
});

describe("displayNameProblem (client mirror of the 0055 / validateDisplayName rule)", () => {
  it.each([
    ["Lan", null],
    ["Nguyễn Thị Ánh", null],
    ["x".repeat(120), null],
    ["\u{1F600}".repeat(120), null],
    ["", "empty"],
    ["   ", "empty"],
    ["x".repeat(121), "too_long"],
    ["\u{1F600}".repeat(121), "too_long"],
    ["a\tb", "invalid_chars"],
    ["a\u200Bb", null],
    ["a\u202Eb", "invalid_chars"],
    // N6 + L27: line breaks and U+2800 keep the error. The invisible set is stripped first, so the
    // fillers and marks raise none among visible text (R2) and read as empty alone (R3).
    ["Lan" + String.fromCodePoint(0x2028) + "Anh", "invalid_chars"],
    ["Lan" + String.fromCodePoint(0x2029) + "Anh", "invalid_chars"],
    [String.fromCodePoint(0x3164), "empty"],
    ["a" + String.fromCodePoint(0x115f, 0x1160, 0xffa0) + "b", null],
    [String.fromCodePoint(0x2800), "invalid_chars"],
    ["a" + String.fromCodePoint(0x34f) + "b", null],
    [String.fromCodePoint(0x17b4, 0x17b5), "empty"],
    [String.fromCodePoint(0x20, 0x200b, 0x20), "empty"], // R3: strip, then trim
    ["a" + String.fromCodePoint(0x200b, 0x09) + "b", "invalid_chars"], // R4: a control is not masked
    [String.fromCodePoint(0x2028) + "Lan" + String.fromCodePoint(0x2029), null], // trimmed edges
    [String.fromCodePoint(0x2764, 0xfe0f) + " Lan", null], // variation selectors stay allowed
    // No visible code point (only variation selectors, unassigned default-ignorables, whitespace):
    // it renders blank, so it reads as empty. Same rule as validateDisplayName / 0055 c_visible.
    [String.fromCodePoint(0xfe0f), "empty"],
    [String.fromCodePoint(0xe0100), "empty"],
    [String.fromCodePoint(0x180b), "empty"],
    [String.fromCodePoint(0x2065, 0xfff0, 0xe0fff), "empty"],
    [String.fromCodePoint(0xfe0f, 0x20, 0xfe0f), "empty"],
    [String.fromCodePoint(0xfe0f).repeat(121), "empty"], // stripped first: nothing is left to count
    ["x".repeat(120) + String.fromCodePoint(0x200b).repeat(5), null], // R2: length after the strip
    // R5: U+200D and U+FE0F are in the strip set, so the server stores composed emoji split (the
    // owner's rule applied as written, no exception); the form raises no error for them.
    [String.fromCodePoint(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467), null], // ZWJ family
    [String.fromCodePoint(0x2764, 0xfe0f), null], // VS16 heart, stored as U+2764 alone
    [String.fromCodePoint(0x845b, 0xe0100), null], // CJK ideograph + ideographic variation selector
    ["Nguyễn Thị Ánh".normalize("NFD"), null], // combining marks after their base letters
    [String.fromCodePoint(0xfe0f) + "Lan", null],
    [String.fromCodePoint(0x301), null], // a lone combining mark draws a glyph
  ])("%j -> %s", (input, expected) => {
    expect(displayNameProblem(input)).toBe(expected);
  });
});

describe("platformLabel", () => {
  it("names the known platforms and passes an unknown one through (never blank)", () => {
    expect(platformLabel("zalo")).toBe("Zalo");
    expect(platformLabel("messenger")).toBe("Messenger");
    expect(platformLabel("signal")).toBe("signal");
  });
});

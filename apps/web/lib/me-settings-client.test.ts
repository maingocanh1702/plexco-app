import { describe, expect, it } from "vitest";
import { displayNameProblem, platformLabel } from "./me-settings-client";

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
    ["a​b", "invalid_chars"],
    ["a‮b", "invalid_chars"],
    // N6: line breaks and blank-looking characters, same set as validateDisplayName / 0055.
    ["Lan" + String.fromCodePoint(0x2028) + "Anh", "invalid_chars"],
    ["Lan" + String.fromCodePoint(0x2029) + "Anh", "invalid_chars"],
    [String.fromCodePoint(0x3164), "invalid_chars"],
    ["a" + String.fromCodePoint(0x115f, 0x1160, 0xffa0) + "b", "invalid_chars"],
    [String.fromCodePoint(0x2800), "invalid_chars"],
    ["a" + String.fromCodePoint(0x34f) + "b", "invalid_chars"],
    [String.fromCodePoint(0x17b4, 0x17b5), "invalid_chars"],
    [String.fromCodePoint(0x2028) + "Lan" + String.fromCodePoint(0x2029), null], // trimmed edges
    [String.fromCodePoint(0x2764, 0xfe0f) + " Lan", null], // variation selectors stay allowed
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

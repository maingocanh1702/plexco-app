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

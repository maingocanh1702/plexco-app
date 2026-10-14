import { describe, expect, it } from "vitest";
import { formatVnd, formatVndInput, parseVndInput } from "./money";

const flat = (s: string) => s.replace(/\s/g, " ");

describe("money (VND)", () => {
  it("formats integer VND per language", () => {
    expect(flat(formatVnd(50000, "vi"))).toBe("50.000 ₫");
    expect(formatVnd(50000, "en")).toContain("50,000");
    expect(formatVnd(0, "vi")).toContain("0");
  });

  it("groups thousands in an input box", () => {
    expect(formatVndInput(1250000, "vi")).toBe("1.250.000");
    expect(formatVndInput(1250000, "en")).toBe("1,250,000");
    expect(formatVndInput(null, "vi")).toBe("");
  });

  it("parses typed/pasted amounts digits-only", () => {
    expect(parseVndInput("50.000")).toBe(50000);
    expect(parseVndInput("50,000 ₫")).toBe(50000);
    expect(parseVndInput("0")).toBe(0);
    expect(parseVndInput("")).toBeNull();
    expect(parseVndInput("abc")).toBeNull();
  });

  it("flags an amount above int4 as invalid instead of clamping", () => {
    expect(parseVndInput("2147483647")).toBe(2147483647);
    expect(parseVndInput("2147483648")).toBeNaN();
  });
});

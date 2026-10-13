import { describe, expect, it } from "vitest";
import { safeReturnTo } from "./offline-view";

describe("safeReturnTo (open-redirect guard, CWE-601)", () => {
  it.each([
    "//evil.com/p",
    "/\\evil.com",
    "https://evil.com",
    "javascript:alert(1)",
    "",
    null,
    undefined,
    123,
  ])("falls back to / for %j", (value) => {
    expect(safeReturnTo(value)).toBe("/");
  });

  it.each(["/c/abc?x=1#h", "/offline", "/"])("passes %s through", (value) => {
    expect(safeReturnTo(value)).toBe(value);
  });
});

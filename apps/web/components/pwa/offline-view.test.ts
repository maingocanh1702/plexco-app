import { describe, expect, it } from "vitest";
import { safeReturnTo } from "./offline-view";

const ORIGIN = "https://app.plexco.test";

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
    // The URL parser drops TAB/LF/CR, so each of these would otherwise navigate to evil.com.
    "/\t/evil.com",
    "/\n/evil.com",
    "/\r/evil.com",
    "/\t\\evil.com",
    "/\u0000//evil.com",
    "///evil.com",
    "\\/evil.com",
    "\\\\evil.com",
    "HTTPS://evil.com",
    "JaVaScRiPt:alert(1)",
    "data:text/html,x",
    "//user@evil.com",
  ])("falls back to / for %j", (value) => {
    expect(safeReturnTo(value, ORIGIN)).toBe("/");
  });

  it("falls back to / for a non-string (array) value", () => {
    expect(safeReturnTo(["/a", "//evil.com"], ORIGIN)).toBe("/");
  });

  it("never leaves the app origin for a 2048-slash prefix", () => {
    const result = safeReturnTo("/".repeat(2048) + "evil", ORIGIN);
    expect(new URL(result, ORIGIN).origin).toBe(ORIGIN);
  });

  it.each([
    "/c/abc?x=1#h",
    "/offline",
    "/",
    "/@evil.com",
    "/foo#//evil.com",
    "/%2f%2fevil.com",
    "/%09/evil.com",
  ])("keeps %j as an undecoded same-origin path", (value) => {
    const result = safeReturnTo(value, ORIGIN);
    expect(result).toBe(value);
    expect(new URL(result, ORIGIN).origin).toBe(ORIGIN);
  });

  // undefined: no window under vitest and none supplied; "null": an opaque origin, URL() throws.
  it.each([undefined, "null"])("falls back to / when the origin is %j", (origin) => {
    expect(safeReturnTo("/c/abc", origin)).toBe("/");
  });
});

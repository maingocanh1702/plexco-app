import { describe, expect, it } from "vitest";
import { authErrorMessage, normalizeAuthErrorParam } from "./auth-error-message";
import { makeT } from "./i18n-client";

describe("authErrorMessage", () => {
  const t = makeT("vi");
  it("returns null when there is no error", () => {
    expect(authErrorMessage(null, t)).toBeNull();
    expect(authErrorMessage("", t)).toBeNull();
  });
  it("maps the codes the OAuth routes redirect with", () => {
    for (const code of [
      "AUTH_INVALID",
      "AUTH_UNAVAILABLE",
      "AUTH_STALE",
      "AUTH_IDENTITY_CONFLICT",
    ]) {
      expect(authErrorMessage(code, t)).toBeTruthy();
    }
    expect(authErrorMessage("AUTH_UNAVAILABLE", t)).not.toBe(authErrorMessage("AUTH_INVALID", t));
  });
  it("unknown / hostile values get the generic message and are never echoed", () => {
    const hostile = "<b>evil</b>";
    const message = authErrorMessage(hostile, t);
    expect(message).toBe(authErrorMessage("AUTH_INVALID", t));
    expect(message).not.toContain("evil");
  });
});

describe("normalizeAuthErrorParam", () => {
  it("passes only members of the closed set; anything else becomes the generic marker", () => {
    expect(normalizeAuthErrorParam("AUTH_STALE")).toBe("AUTH_STALE");
    expect(normalizeAuthErrorParam("<b>evil</b>")).toBe("AUTH_INVALID");
    expect(normalizeAuthErrorParam(undefined)).toBeNull();
    expect(normalizeAuthErrorParam("")).toBeNull();
    expect(normalizeAuthErrorParam(["AUTH_STALE"])).toBeNull();
  });
});

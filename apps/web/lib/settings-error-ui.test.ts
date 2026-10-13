import { describe, expect, it } from "vitest";
import { ApiClientError, CLIENT_NETWORK_ERROR } from "./api-client";
import { makeT } from "./i18n-client";
import { describeSettingsError, isForbidden } from "./settings-error-ui";

const en = makeT("en");
const err = (code: string, status = 400, message = "") =>
  new ApiClientError(code, message, status, "req-1");

describe("describeSettingsError", () => {
  it.each([
    ["CHANNEL_NOT_LINKED", "reload", /no longer linked/],
    ["NOT_FOUND", "none", /not found/],
    ["ZALO_TOKEN_INVALID", "none", /not valid/],
    ["AUTH_UNAVAILABLE", "retry", /temporarily unavailable/],
    ["COMMAND_ID_CONFLICT", "reload", /superseded/],
  ])("%s is a known code with its own wording", (code, action, text) => {
    const view = describeSettingsError(err(code, 409), en);
    expect(view.known).toBe(true);
    expect(view.action).toBe(action);
    expect(view.message).toMatch(text);
  });

  it("TENANT_SUSPENDED shows the server's (tenant-language) message, with a fallback", () => {
    expect(describeSettingsError(err("TENANT_SUSPENDED", 403, "CLB tạm ngưng"), en).message).toBe(
      "CLB tạm ngưng",
    );
    expect(describeSettingsError(err("TENANT_SUSPENDED", 403, " "), en).message).toMatch(
      /suspended/,
    );
  });

  it("falls back to the shared mapping for everything else", () => {
    expect(describeSettingsError(err("AUTH_REQUIRED", 401), en).action).toBe("sign-in");
    expect(describeSettingsError(err("RATE_LIMITED", 429), en).action).toBe("retry");
    expect(describeSettingsError(err("CSRF_INVALID", 403), en).action).toBe("reload");
    expect(describeSettingsError(new ApiClientError(CLIENT_NETWORK_ERROR, "", 0), en).action).toBe(
      "retry",
    );
  });

  it("an unknown code never leaks a raw server string (fail closed + requestId)", () => {
    const view = describeSettingsError(err("SOMETHING_NEW", 500, "stack trace here"), en);
    expect(view.known).toBe(false);
    expect(view.message).not.toContain("stack trace");
    expect(view.requestId).toBe("req-1");
  });

  it("a non-ApiClientError is the generic view", () => {
    expect(describeSettingsError(new Error("boom"), en).known).toBe(false);
  });
});

describe("isForbidden", () => {
  it("is true only for the FORBIDDEN code", () => {
    expect(isForbidden(err("FORBIDDEN", 403))).toBe(true);
    expect(isForbidden(err("TENANT_SUSPENDED", 403))).toBe(false);
    expect(isForbidden(new Error("x"))).toBe(false);
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { sameOriginRequest } from "./session-cookies";

function reqWith(headers: Record<string, string>): Request {
  return new Request("https://plexco.app/api/auth/telegram", { method: "POST", headers });
}

describe("sameOriginRequest", () => {
  it("accepts a same-origin Origin header", () => {
    expect(sameOriginRequest(reqWith({ host: "plexco.app", origin: "https://plexco.app" }))).toBe(
      true,
    );
  });

  it("rejects a cross-site Origin header (login CSRF vector)", () => {
    expect(sameOriginRequest(reqWith({ host: "plexco.app", origin: "https://attacker.example" }))).toBe(
      false,
    );
  });

  it("falls back to Referer when Origin is absent", () => {
    expect(
      sameOriginRequest(reqWith({ host: "plexco.app", referer: "https://plexco.app/login" })),
    ).toBe(true);
  });

  it("rejects a cross-site Referer when Origin is absent", () => {
    expect(
      sameOriginRequest(reqWith({ host: "plexco.app", referer: "https://attacker.example/x" })),
    ).toBe(false);
  });

  it("fails closed when neither Origin nor Referer is present", () => {
    expect(sameOriginRequest(reqWith({ host: "plexco.app" }))).toBe(false);
  });

  it("fails closed when Host itself is missing", () => {
    expect(sameOriginRequest(reqWith({ origin: "https://plexco.app" }))).toBe(false);
  });
});

describe("sameOriginRequest — scheme enforcement (codex round-03)", () => {
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  });

  it("in production, rejects a same-host Origin over the WRONG scheme", () => {
    process.env.NODE_ENV = "production";
    expect(
      sameOriginRequest(reqWith({ host: "plexco.app", origin: "http://plexco.app" })),
    ).toBe(false);
  });

  it("in production, still accepts a same-host Origin over https", () => {
    process.env.NODE_ENV = "production";
    expect(
      sameOriginRequest(reqWith({ host: "plexco.app", origin: "https://plexco.app" })),
    ).toBe(true);
  });

  it("in production, rejects a same-host Referer over the WRONG scheme", () => {
    process.env.NODE_ENV = "production";
    expect(
      sameOriginRequest(reqWith({ host: "plexco.app", referer: "http://plexco.app/login" })),
    ).toBe(false);
  });

  it("outside production, scheme is not enforced (local dev commonly runs plain http)", () => {
    process.env.NODE_ENV = "test";
    expect(
      sameOriginRequest(reqWith({ host: "plexco.app", origin: "http://plexco.app" })),
    ).toBe(true);
  });
});

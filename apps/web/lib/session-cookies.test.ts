import { afterEach, describe, expect, it } from "vitest";
import { clientIp, sameOriginRequest, trustedIngressProvider } from "./session-cookies";

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
    expect(
      sameOriginRequest(reqWith({ host: "plexco.app", origin: "https://attacker.example" })),
    ).toBe(false);
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
    expect(sameOriginRequest(reqWith({ host: "plexco.app", origin: "http://plexco.app" }))).toBe(
      false,
    );
  });

  it("in production, still accepts a same-host Origin over https", () => {
    process.env.NODE_ENV = "production";
    expect(sameOriginRequest(reqWith({ host: "plexco.app", origin: "https://plexco.app" }))).toBe(
      true,
    );
  });

  it("in production, rejects a same-host Referer over the WRONG scheme", () => {
    process.env.NODE_ENV = "production";
    expect(
      sameOriginRequest(reqWith({ host: "plexco.app", referer: "http://plexco.app/login" })),
    ).toBe(false);
  });

  it("outside production, scheme is not enforced (local dev commonly runs plain http)", () => {
    process.env.NODE_ENV = "test";
    expect(sameOriginRequest(reqWith({ host: "plexco.app", origin: "http://plexco.app" }))).toBe(
      true,
    );
  });
});

describe("clientIp — provider-pinned trusted ingress", () => {
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
  const ORIGINAL_PROVIDER = process.env.TRUSTED_INGRESS_PROVIDER;

  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    if (ORIGINAL_PROVIDER === undefined) delete process.env.TRUSTED_INGRESS_PROVIDER;
    else process.env.TRUSTED_INGRESS_PROVIDER = ORIGINAL_PROVIDER;
  });

  it("uses only DigitalOcean's overwritten client-IP header", () => {
    const request = reqWith({
      "do-connecting-ip": "203.0.113.10",
      "fly-client-ip": "198.51.100.90",
      "x-forwarded-for": "198.51.100.91, 10.0.0.2",
    });

    expect(clientIp(request, "digitalocean")).toBe("203.0.113.10");
  });

  it("does not let a cross-provider or X-Forwarded-For header mint a DO bucket", () => {
    const request = reqWith({
      "fly-client-ip": "198.51.100.90",
      "x-forwarded-for": "198.51.100.91, 10.0.0.2",
    });

    expect(clientIp(request, "digitalocean")).toBe("digitalocean:untrusted");
  });

  it("rejects malformed and multi-value trusted headers", () => {
    expect(clientIp(reqWith({ "do-connecting-ip": "not-an-ip" }), "digitalocean")).toBe(
      "digitalocean:untrusted",
    );
    expect(
      clientIp(reqWith({ "do-connecting-ip": "203.0.113.10, 198.51.100.2" }), "digitalocean"),
    ).toBe("digitalocean:untrusted");
  });

  it("uses only Fly's overwritten header when Fly is the configured edge", () => {
    const request = reqWith({
      "do-connecting-ip": "203.0.113.10",
      "fly-client-ip": "2001:db8::1",
    });

    expect(clientIp(request, "fly")).toBe("2001:db8::1");
  });

  it("uses direct mode only for local development", () => {
    expect(clientIp(reqWith({ "do-connecting-ip": "203.0.113.10" }), "direct")).toBe("local");
  });

  it("requires an explicit trusted ingress provider in production", () => {
    process.env.NODE_ENV = "production";
    delete process.env.TRUSTED_INGRESS_PROVIDER;

    expect(() => trustedIngressProvider()).toThrow("TRUSTED_INGRESS_PROVIDER");
  });

  it("forbids direct mode in production", () => {
    process.env.NODE_ENV = "production";
    process.env.TRUSTED_INGRESS_PROVIDER = "direct";

    expect(() => trustedIngressProvider()).toThrow("forbidden in production");
  });

  it("rejects an unsupported provider instead of silently falling back", () => {
    process.env.NODE_ENV = "test";
    process.env.TRUSTED_INGRESS_PROVIDER = "unknown-edge";

    expect(() => trustedIngressProvider()).toThrow("TRUSTED_INGRESS_PROVIDER");
  });

  it("reads the explicit production provider", () => {
    process.env.NODE_ENV = "production";
    process.env.TRUSTED_INGRESS_PROVIDER = "digitalocean";

    expect(trustedIngressProvider()).toBe("digitalocean");
  });
});

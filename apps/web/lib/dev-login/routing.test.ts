import { describe, expect, it } from "vitest";
import {
  DEV_LOGIN_API_PATH,
  DEV_LOGIN_API_ROUTE,
  DEV_LOGIN_PAGE_PATH,
  DEV_LOGIN_PAGE_ROUTE,
  devLoginRouting,
  isInternalDevLoginPath,
  type RoutableRequest,
} from "./routing";

const OPEN_ENV = {
  NODE_ENV: "development",
  PLEXCO_DEV_LOGIN: "1",
  TRUSTED_INGRESS_PROVIDER: "direct",
  DATABASE_URL: "postgres://app:plexco_dev_app@localhost:5432/plexco",
  __NEXT_PRIVATE_ORIGIN: "http://127.0.0.1:3000", // next dev -H 127.0.0.1 -p 3000
  PORT: "3000",
};

/** Shaped like the NextRequest the middleware receives, with Next's injected forwarding headers. */
function req(
  pathAndQuery: string,
  host = "127.0.0.1:3000",
  extra: Record<string, string> = {},
  method = "GET",
): RoutableRequest {
  const url = new URL(pathAndQuery, "http://localhost:3000");
  return {
    method,
    nextUrl: { pathname: url.pathname, search: url.search },
    headers: new Headers({
      host,
      "x-forwarded-for": "127.0.0.1",
      "x-forwarded-host": host,
      "x-forwarded-port": /:(\d+)$/.exec(host)?.[1] ?? "80",
      "x-forwarded-proto": "http",
      ...extra,
    }),
  };
}

describe("virtual public paths", () => {
  it("redirect to their implementation routes only when the gate is open", () => {
    expect(devLoginRouting(req(DEV_LOGIN_PAGE_PATH), OPEN_ENV)).toEqual({
      kind: "redirect",
      location: `http://127.0.0.1:3000${DEV_LOGIN_PAGE_ROUTE}`,
    });
    expect(devLoginRouting(req(DEV_LOGIN_API_PATH, undefined, {}, "POST"), OPEN_ENV)).toEqual({
      kind: "redirect",
      location: `http://127.0.0.1:3000${DEV_LOGIN_API_ROUTE}`,
    });
  });

  it("point only at this machine, whatever loopback Host was used", () => {
    for (const host of ["127.0.0.1:3000", "localhost:3000", "[::1]:3000"]) {
      const routing = devLoginRouting(req(DEV_LOGIN_PAGE_PATH, host), OPEN_ENV);
      expect(routing?.kind).toBe("redirect");
      const url = new URL((routing as { location: string }).location);
      expect(url.protocol).toBe("http:");
      expect(url.host).toBe(host);
      expect(url.pathname).toBe(DEV_LOGIN_PAGE_ROUTE);
    }
  });

  it("carry the original query string (closed-set ?error= for the page)", () => {
    expect(devLoginRouting(req("/dev-login?error=reauth"), OPEN_ENV)).toEqual({
      kind: "redirect",
      location: `http://127.0.0.1:3000${DEV_LOGIN_PAGE_ROUTE}?error=reauth`,
    });
  });

  it.each([
    ["flag off", { ...OPEN_ENV, PLEXCO_DEV_LOGIN: undefined }, "127.0.0.1:3000"],
    ["production", { ...OPEN_ENV, NODE_ENV: "production" }, "127.0.0.1:3000"],
    ["ingress", { ...OPEN_ENV, TRUSTED_INGRESS_PROVIDER: "digitalocean" }, "127.0.0.1:3000"],
    [
      "remote db",
      { ...OPEN_ENV, DATABASE_URL: "postgres://a:b@db.example.com/p" },
      "127.0.0.1:3000",
    ],
    [
      "no -H (binds *)",
      { ...OPEN_ENV, __NEXT_PRIVATE_ORIGIN: "http://localhost:3000" },
      "127.0.0.1:3000",
    ],
    ["-H ::", { ...OPEN_ENV, __NEXT_PRIVATE_ORIGIN: "http://[::1]:3000" }, "127.0.0.1:3000"],
    ["non-loopback host", OPEN_ENV, "192.168.1.20:3000"],
  ])("are left alone when the gate is closed (%s), so they 404 natively", (_, env, host) => {
    expect(devLoginRouting(req(DEV_LOGIN_PAGE_PATH, host), env)).toBeNull();
    expect(devLoginRouting(req(DEV_LOGIN_API_PATH, host, {}, "POST"), env)).toBeNull();
  });

  it("are left alone for a forwarded request even on a loopback Host", () => {
    const tunnelled = req(DEV_LOGIN_PAGE_PATH, "localhost:3000", {
      "x-forwarded-for": "203.0.113.9",
    });
    expect(devLoginRouting(tunnelled, OPEN_ENV)).toBeNull();
  });

  it("match exactly (variants are just missing routes)", () => {
    for (const path of [
      "/Dev-Login",
      "/dev-login/x",
      "/api/dev/login/x",
      "/api/dev",
      "/dev-login-x",
    ]) {
      expect(devLoginRouting(req(path), OPEN_ENV)).toBeNull();
    }
  });
});

describe("implementation paths", () => {
  it("are left to their handler only with the gate open and a route method", () => {
    for (const method of ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      expect(
        devLoginRouting(req(DEV_LOGIN_PAGE_ROUTE, undefined, {}, method), OPEN_ENV),
      ).toBeNull();
    }
  });

  it.each([
    ["non-loopback Host", req(DEV_LOGIN_PAGE_ROUTE, "evil.test:3000")],
    ["DNS rebinding Host", req(DEV_LOGIN_API_ROUTE, "rebind.attacker.example:3000", {}, "POST")],
    [
      "tunnel headers",
      req(DEV_LOGIN_PAGE_ROUTE, "localhost:3000", { "x-forwarded-host": "a.ngrok.app" }),
    ],
    ["PROPFIND (no route can export it)", req(DEV_LOGIN_PAGE_ROUTE, undefined, {}, "PROPFIND")],
    ["unknown method", req(DEV_LOGIN_API_ROUTE, undefined, {}, "BREW")],
    ["case variant", req("/INTERNAL-DEV-LOGIN/page", "evil.test:3000")],
    ["percent-encoded", req("/internal-dev-lo%67in/session", "evil.test:3000")],
  ])("get a 404 from the middleware for %s while the routes are compiled", (_, request) => {
    expect(devLoginRouting(request, OPEN_ENV)).toEqual({ kind: "not_found" });
  });

  it("get the 404 when the bind evidence is missing (all-interfaces dev server)", () => {
    const env = { ...OPEN_ENV, __NEXT_PRIVATE_ORIGIN: "http://localhost:3000" };
    expect(devLoginRouting(req(DEV_LOGIN_PAGE_ROUTE), env)).toEqual({ kind: "not_found" });
  });

  it("are left alone when the routes are not compiled (the framework's own 404 is exact)", () => {
    const env = { ...OPEN_ENV, PLEXCO_DEV_LOGIN: undefined };
    expect(devLoginRouting(req(DEV_LOGIN_PAGE_ROUTE, "evil.test:3000"), env)).toBeNull();
    expect(devLoginRouting(req(DEV_LOGIN_PAGE_ROUTE, undefined, {}, "PROPFIND"), env)).toBeNull();
  });

  it("isInternalDevLoginPath does not swallow look-alike prefixes", () => {
    expect(isInternalDevLoginPath("/internal-dev-loginx")).toBe(false);
    expect(isInternalDevLoginPath("/x/internal-dev-login/page")).toBe(false);
    expect(isInternalDevLoginPath("/internal-dev-login%")).toBe(false);
  });
});

describe("everything else", () => {
  it("is never touched", () => {
    for (const path of ["/", "/healthz", "/api/auth/session", "/c/123", "/api/sessions"]) {
      expect(devLoginRouting(req(path), OPEN_ENV)).toBeNull();
      expect(devLoginRouting(req(path, "evil.test:3000", {}, "PROPFIND"), OPEN_ENV)).toBeNull();
    }
  });
});

import { describe, expect, it } from "vitest";
import {
  DEV_LOGIN_API_PATH,
  DEV_LOGIN_API_ROUTE,
  DEV_LOGIN_PAGE_PATH,
  DEV_LOGIN_PAGE_ROUTE,
  devLoginRedirectLocation,
  type RoutableRequest,
} from "./routing";

const OPEN_ENV = {
  NODE_ENV: "development",
  PLEXCO_DEV_LOGIN: "1",
  TRUSTED_INGRESS_PROVIDER: "direct",
  DATABASE_URL: "postgres://app:plexco_dev_app@localhost:5432/plexco",
};

/** Shaped like the NextRequest the middleware receives, with Next's injected forwarding headers. */
function req(pathAndQuery: string, host = "127.0.0.1:3000", extra: Record<string, string> = {}) {
  const url = new URL(pathAndQuery, "http://localhost:3000");
  const request: RoutableRequest = {
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
  return request;
}

describe("devLoginRedirectLocation — virtual public paths", () => {
  it("redirects /dev-login and /api/dev/login to their implementation routes only when the gate is open", () => {
    expect(devLoginRedirectLocation(req(DEV_LOGIN_PAGE_PATH), OPEN_ENV)).toBe(
      `http://127.0.0.1:3000${DEV_LOGIN_PAGE_ROUTE}`,
    );
    expect(devLoginRedirectLocation(req(DEV_LOGIN_API_PATH), OPEN_ENV)).toBe(
      `http://127.0.0.1:3000${DEV_LOGIN_API_ROUTE}`,
    );
  });

  it("returns the browser to exactly the loopback host it used (never anywhere else)", () => {
    for (const host of ["127.0.0.1:3000", "localhost:3000", "[::1]:3000", "localhost"]) {
      const location = devLoginRedirectLocation(req(DEV_LOGIN_PAGE_PATH, host), OPEN_ENV)!;
      const url = new URL(location);
      expect(url.protocol).toBe("http:");
      expect(url.host).toBe(host);
      expect(url.pathname).toBe(DEV_LOGIN_PAGE_ROUTE);
    }
  });

  it("carries the original query string (closed-set ?error= for the page)", () => {
    expect(devLoginRedirectLocation(req("/dev-login?error=reauth"), OPEN_ENV)).toBe(
      `http://127.0.0.1:3000${DEV_LOGIN_PAGE_ROUTE}?error=reauth`,
    );
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
    ["non-loopback host", OPEN_ENV, "192.168.1.20:3000"],
  ])(
    "leaves the virtual paths alone when the gate is closed (%s), so they 404 natively",
    (_, env, host) => {
      expect(devLoginRedirectLocation(req(DEV_LOGIN_PAGE_PATH, host), env)).toBeNull();
      expect(devLoginRedirectLocation(req(DEV_LOGIN_API_PATH, host), env)).toBeNull();
    },
  );

  it("leaves a forwarded request alone even on a loopback Host", () => {
    const tunnelled = req(DEV_LOGIN_PAGE_PATH, "localhost:3000", {
      "x-forwarded-for": "203.0.113.9",
    });
    expect(devLoginRedirectLocation(tunnelled, OPEN_ENV)).toBeNull();
  });

  it("matches the public paths exactly (variants are just missing routes)", () => {
    for (const path of [
      "/Dev-Login",
      "/dev-login/x",
      "/api/dev/login/x",
      "/api/dev",
      "/dev-login-x",
    ]) {
      expect(devLoginRedirectLocation(req(path), OPEN_ENV)).toBeNull();
    }
  });

  it("never touches any other path, the implementation routes included (they gate themselves)", () => {
    for (const path of [
      "/",
      "/healthz",
      "/api/auth/session",
      "/c/123",
      DEV_LOGIN_PAGE_ROUTE,
      DEV_LOGIN_API_ROUTE,
    ]) {
      expect(devLoginRedirectLocation(req(path), OPEN_ENV)).toBeNull();
    }
  });
});

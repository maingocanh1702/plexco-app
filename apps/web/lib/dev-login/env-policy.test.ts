import { describe, expect, it } from "vitest";
import {
  DEV_LOGIN_FLAG,
  DEV_ROUTE_EXTENSION,
  assertDevLoginBootSafe,
  assertNoDevLoginInProductionCompile,
  devLoginEnvironmentVerdict,
  devLoginFlagPresent,
  devLoginRoutesEnabled,
  isLocalDatabaseUrl,
  pageExtensionsFor,
} from "./env-policy.mjs";

const LOCAL_DB = "postgres://app:plexco_dev_app@localhost:5432/plexco";
const OPEN_ENV = {
  NODE_ENV: "development",
  [DEV_LOGIN_FLAG]: "1",
  TRUSTED_INGRESS_PROVIDER: "direct",
  DATABASE_URL: LOCAL_DB,
};

describe("boot fail-closed: assertDevLoginBootSafe", () => {
  it("is a no-op when the flag is absent, whatever NODE_ENV is", () => {
    for (const NODE_ENV of ["production", "test", "development", undefined, ""]) {
      expect(() => assertDevLoginBootSafe({ NODE_ENV })).not.toThrow();
    }
  });

  it.each([
    ["production", "1"],
    ["production", ""],
    ["production", "0"],
    ["test", "1"],
    [undefined, "1"],
    ["", ""],
    ["Development", "1"],
  ])("refuses NODE_ENV=%s with the flag present (value %j)", (NODE_ENV, flag) => {
    expect(() => assertDevLoginBootSafe({ NODE_ENV, [DEV_LOGIN_FLAG]: flag })).toThrow(
      /PLEXCO_DEV_LOGIN is set while NODE_ENV is .* refusing to start/,
    );
  });

  it("allows the flag under NODE_ENV=development (next dev)", () => {
    expect(() =>
      assertDevLoginBootSafe({ NODE_ENV: "development", [DEV_LOGIN_FLAG]: "1" }),
    ).not.toThrow();
  });

  it("refuses the flag under Turbopack (the production-compile guard is a webpack hook)", () => {
    expect(() =>
      assertDevLoginBootSafe({ NODE_ENV: "development", [DEV_LOGIN_FLAG]: "1", TURBOPACK: "1" }),
    ).toThrow(/Turbopack/);
  });

  it("treats an EMPTY value as present", () => {
    expect(devLoginFlagPresent({ [DEV_LOGIN_FLAG]: "" })).toBe(true);
    expect(devLoginFlagPresent({})).toBe(false);
  });
});

describe("process-level conditions: devLoginEnvironmentVerdict / pageExtensionsFor", () => {
  it("opens only with all four conditions", () => {
    expect(devLoginEnvironmentVerdict(OPEN_ENV)).toBeNull();
    expect(devLoginRoutesEnabled(OPEN_ENV)).toBe(true);
    expect(pageExtensionsFor(OPEN_ENV)).toEqual(["tsx", "ts", "jsx", "js", DEV_ROUTE_EXTENSION]);
  });

  it.each([
    ["node_env", { NODE_ENV: "production" }],
    ["node_env", { NODE_ENV: "test" }],
    ["node_env", { NODE_ENV: undefined }],
    ["flag", { [DEV_LOGIN_FLAG]: undefined }],
    ["flag", { [DEV_LOGIN_FLAG]: "" }],
    ["flag", { [DEV_LOGIN_FLAG]: "true" }],
    ["flag", { [DEV_LOGIN_FLAG]: " 1" }],
    ["ingress", { TRUSTED_INGRESS_PROVIDER: undefined }],
    ["ingress", { TRUSTED_INGRESS_PROVIDER: "Direct" }],
    ["ingress", { TRUSTED_INGRESS_PROVIDER: "digitalocean" }],
    ["database_url", { DATABASE_URL: undefined }],
    ["database_url", { DATABASE_URL: "postgres://app:x@db.example.com:5432/plexco" }],
  ])("closes with reason %s when one condition is false: %j", (reason, override) => {
    const env = { ...OPEN_ENV, ...override };
    expect(devLoginEnvironmentVerdict(env)).toBe(reason);
    expect(pageExtensionsFor(env)).toEqual(["tsx", "ts", "jsx", "js"]);
  });
});

describe("isLocalDatabaseUrl — the seed and the gate share this one rule", () => {
  it.each([
    "postgres://app:plexco_dev_app@localhost:5432/plexco",
    "postgresql://app:pw@127.0.0.1:5432/plexco",
    "postgres://app:pw@[::1]:5432/plexco",
    "postgres://app:plexco_dev_app@postgres:5432/plexco",
    "postgres://localhost/plexco",
  ])("accepts %s", (url) => {
    expect(isLocalDatabaseUrl(url)).toBe(true);
  });

  it.each([
    undefined,
    "",
    "postgres://app:pw@db.example.com:5432/plexco",
    "postgres://app:pw@localhost.evil.test:5432/plexco",
    "postgres://app:pw@127.0.0.1.nip.io:5432/plexco",
    "postgres://localhost:5432@evil.example.com/plexco", // userinfo trick: the host is evil
    "postgres://app:pw@localhost:5432/plexco?host=db.example.com", // pg reads ?host= over the URL host
    "postgres://app:pw@localhost:5432/plexco?sslmode=require",
    "postgres://app:pw@localhost:5432/plexco#frag",
    "postgres://app:pw@LocalHost:5432/plexco",
    "postgres://app:pw@local%68ost:5432/plexco",
    "postgres://app:pw@localhost,db.example.com/plexco",
    "postgres:///plexco", // empty host: pg falls back to PGHOST
    "postgres://app:pw@/plexco",
    "localhost:5432/plexco", // scheme-less: pg resolves it against a dummy base
    "/var/run/postgresql plexco", // pg unix-socket form
    "socket://app@/var/run/postgresql?db=plexco",
    "mysql://app:pw@localhost/plexco",
    "postgres://app:pw@127.0.0.2:5432/plexco",
    "postgres://app:pw@0.0.0.0:5432/plexco",
    "postgres://app:p w@localhost/plexco",
    "postgres://app:pw@localhost/plexco\\x",
  ])("refuses %j", (url) => {
    expect(isLocalDatabaseUrl(url as string | undefined)).toBe(false);
  });
});

describe("production-compile guard: assertNoDevLoginInProductionCompile", () => {
  const base = ["tsx", "ts", "jsx", "js"];

  it("allows any development compilation", () => {
    expect(() =>
      assertNoDevLoginInProductionCompile({
        dev: true,
        pageExtensions: [...base, DEV_ROUTE_EXTENSION],
        env: OPEN_ENV,
      }),
    ).not.toThrow();
  });

  it("allows a clean production compilation", () => {
    expect(() =>
      assertNoDevLoginInProductionCompile({
        dev: false,
        pageExtensions: base,
        env: { NODE_ENV: "production" },
      }),
    ).not.toThrow();
  });

  it("refuses a production compilation that would carry the dev routes (NODE_ENV=development next build)", () => {
    expect(() =>
      assertNoDevLoginInProductionCompile({
        dev: false,
        pageExtensions: [...base, DEV_ROUTE_EXTENSION],
        env: OPEN_ENV,
      }),
    ).toThrow(/refusing a production compilation/);
  });

  it("refuses a production compilation with the flag present even when the routes are off", () => {
    expect(() =>
      assertNoDevLoginInProductionCompile({
        dev: false,
        pageExtensions: base,
        env: { NODE_ENV: "development", [DEV_LOGIN_FLAG]: "" },
      }),
    ).toThrow(/refusing a production compilation/);
  });
});

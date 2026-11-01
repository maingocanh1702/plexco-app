import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDb } from "./client.js";
import { PgSslConfigError, pgSslConnectionConfig } from "./pg-ssl-options.js";

// The production CA requirement: docs/sessions/web-mvp-phase5-readiness-p5-db-tls-ca-required.md,
// section 4 (A2, A5, A7, A9 need a generated CA and live in pg-ssl-options.test.ts). Pure: no listen,
// no openssl, no database. The mutation target of its section 5: without the requirement, A1 fails.

const PROD = { NODE_ENV: "production" };
const MARKER = "pw-marker-l89";
const REMOTE = "db.example.invalid";
const MESSAGE =
  "DATABASE_CA_CERT is required when NODE_ENV is production and the database host is not loopback or a Unix socket";
const at = (host: string, rest = "/plexco") => `postgres://app:${MARKER}@${host}:25060${rest}`;
const REMOTE_URL = at(REMOTE);
const SOCKET = "%2Fvar%2Frun%2Fpostgresql";
// Strings pg's own parser rejects (the constructor throws), loopback-looking where the shape allows.
const UNPARSABLE: [string, string][] = [
  ["bare ::1", `postgres://app:${MARKER}@::1/plexco`],
  ["unclosed [::1", `postgres://app:${MARKER}@[::1/plexco`],
  ["a host:port list", `postgres://app:${MARKER}@h1:5432,h2:5432/plexco`],
  ["port 99999", `postgres://app:${MARKER}@127.0.0.1:99999/plexco`],
];

/** [test name, input, the helper's env (default PROD), PGHOST in process.env (default unset)] */
type Row = [name: string, input: string, env?: NodeJS.ProcessEnv, pghost?: string];

const A1 = "A1: production web against a DigitalOcean host with no CA refuses";
const B8 = "B8: loopback look-alikes are remote";
const B14 = "B14: a host list is one string and refuses";
const REFUSE: Row[] = [
  [`${A1}: plain`, REMOTE_URL],
  [`${A1}: sslmode=require cannot opt out`, at(REMOTE, "/plexco?sslmode=require")],
  [`${A1}: sslmode=disable cannot opt out`, at(REMOTE, "/plexco?sslmode=disable")],
  ...UNPARSABLE.map(([label, input]): Row => [
    `A8: a URL pg cannot parse is remote: ${label}`,
    input,
  ]),
  ["B2: an upper-case LOCALHOST is remote", at("LOCALHOST")],
  ["B3: a trailing-dot localhost is remote", at("localhost.")],
  ...["127.1", "2130706433", "0x7f.0.0.1", "0"].map((host): Row => [
    `B5: short or numeric IPv4 forms are remote: ${host}`,
    at(host),
  ]),
  ["B7: an IPv4-mapped loopback is remote", at("[::ffff:127.0.0.1]")],
  [`${B8}: localhost.example.com`, at("localhost.example.com")],
  [`${B8}: 127.0.0.1.nip.io`, at("127.0.0.1.nip.io")],
  [`${B8}: 0.0.0.0`, at("0.0.0.0")],
  [`${B8}: user localhost`, `postgres://localhost:${MARKER}@${REMOTE}:25060/plexco`],
  [`${B8}: database name localhost`, at(REMOTE, "/localhost")],
  [`${B8}: application_name`, at(REMOTE, "/plexco?application_name=127.0.0.1")],
  [`${B8}: fragment`, at(REMOTE, "/plexco#127.0.0.1")],
  [
    "B9: a userinfo that looks like loopback does not hide the real host: user@127.0.0.1@",
    `postgres://app:${MARKER}@127.0.0.1@${REMOTE}:25060/plexco`,
  ],
  [
    "B9: a userinfo that looks like loopback does not hide the real host: 127.0.0.1:5432@",
    `postgres://127.0.0.1:5432@${REMOTE}:25060/plexco`,
  ],
  [
    "B10: a remote host= behind a loopback authority refuses",
    at("127.0.0.1", `/plexco?host=${REMOTE}`),
  ],
  [`${B14}: two names`, at("h1,h2")],
  [`${B14}: loopback then remote`, at(`127.0.0.1,${REMOTE}`)],
  [`${B14}: in host=`, at("127.0.0.1", `/plexco?host=h1,${REMOTE}`)],
  ["B15: no host in the URL uses PGHOST: remote", "postgres:///plexco", PROD, REMOTE],
  ["B16: an empty URL follows pg: PGHOST remote", "", PROD, REMOTE],
  ["B17: scheme-less garbage is remote", "not a url"],
  [
    "B18: a socket authority with a remote host= refuses",
    `postgres://app:${MARKER}@${SOCKET}/plexco?host=${REMOTE}`,
  ],
  ["B19: a host= with a slash inside is not a socket", at("127.0.0.1", "/plexco?host=x%2Fy")],
  ...Object.entries({
    DATABASE_CA_REQUIRED: "false",
    DEPLOY_ENVIRONMENT: "dev",
    PGSSLMODE: "disable",
    NODE_TLS_REJECT_UNAUTHORIZED: "0",
  }).map(([name, value]): Row => [
    `B21: an attempted off-switch has no effect: ${name}=${value}`,
    REMOTE_URL,
    { ...PROD, [name]: value },
  ]),
  ["B22: production on the bare service name postgres is remote", at("postgres")],
];

const A6 = "A6: a Unix-socket database keeps today's config in production";
const B12 = "B12: parameters pg ignores do not change the host";
const B13 = "B13: encoded and tab-split loopback is decided on pg's parsed host";
const C3 = "C3: an ad-hoc script with no NODE_ENV keeps today's config";
const TODAY: Row[] = [
  ["A4: CI e2e production build on 127.0.0.1 keeps today's config", at("127.0.0.1")],
  [`${A6}: host= parameter`, `postgres://app:${MARKER}@/plexco?host=/var/run/postgresql`],
  [`${A6}: encoded authority`, `postgres://app:${MARKER}@${SOCKET}/plexco`],
  ["B1: production on localhost keeps today's config", at("localhost")],
  ...["127.0.0.1", "127.0.0.2", "127.255.255.254"].map((host): Row => [
    `B4: production on 127/8 keeps today's config: ${host}`,
    at(host),
  ]),
  ...["[::1]", "[0:0:0:0:0:0:0:1]"].map((host): Row => [
    `B6: production on IPv6 loopback keeps today's config: ${host}`,
    at(host),
  ]),
  [
    "B11: a loopback host= behind a remote authority keeps today's config",
    at(REMOTE, "/plexco?host=127.0.0.1"),
  ],
  [`${B12}: upper-case HOST=`, at("127.0.0.1", `/plexco?HOST=${REMOTE}`)],
  [`${B12}: hostaddr=`, at("127.0.0.1", "/plexco?hostaddr=203.0.113.5")],
  [`${B12}: an empty host=`, at("127.0.0.1", "/plexco?host=")],
  [`${B13}: percent-encoded 127`, at("%31%32%37.0.0.1")],
  [`${B13}: percent-encoded localhost`, at("%6c%6f%63%61%6c%68%6f%73%74")],
  [`${B13}: a tab inside localhost`, at("loc\talhost")],
  ["B15: no host in the URL uses PGHOST, then localhost: PGHOST unset", "postgres:///plexco"],
  [
    "B15: no host in the URL uses PGHOST: a socket",
    "postgres:///plexco",
    PROD,
    "/var/run/postgresql",
  ],
  ["B16: an empty URL follows pg: PGHOST unset, so localhost", ""],
  ["B20: a special scheme is normalised by pg's parser", `http://app:${MARKER}@127.1/plexco`],
  [
    "C1: compose dev on host postgres keeps today's config",
    at("postgres"),
    { NODE_ENV: "development" },
  ],
  ["C2: the unit tests' NODE_ENV keeps today's config", REMOTE_URL, { NODE_ENV: "test" }],
  [`${C3}: unset`, REMOTE_URL, {}],
  [`${C3}: empty`, REMOTE_URL, { NODE_ENV: "" }],
  ...["Production", "PRODUCTION", "production ", "staging"].map((value): Row => [
    `C4: a mis-set NODE_ENV is not production: ${JSON.stringify(value)}`,
    REMOTE_URL,
    { NODE_ENV: value },
  ]),
  ...[{}, { NODE_ENV: "test" }].flatMap((env) =>
    [...UNPARSABLE, ["scheme-less garbage", "not a url"] as [string, string]].map(
      ([label, input]): Row => [
        `C5: an unparsable URL outside production never throws: ${label}, NODE_ENV ${env.NODE_ENV ?? "unset"}`,
        input,
        env,
      ],
    ),
  ),
];

function refusal(build: () => unknown): PgSslConfigError {
  try {
    build();
  } catch (err) {
    if (err instanceof PgSslConfigError) return err;
    throw err;
  }
  throw new Error("expected a PgSslConfigError, nothing was thrown");
}

beforeEach(() => {
  vi.stubEnv("PGHOST", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("pgSslConnectionConfig: DATABASE_CA_CERT is required in production off loopback", () => {
  it.each(REFUSE)("%s", (_, input, env = PROD, pghost) => {
    vi.stubEnv("PGHOST", pghost);
    expect(refusal(() => pgSslConnectionConfig(input, env)).message).toBe(MESSAGE);
  });

  it.each(TODAY)("%s", (_, input, env = PROD, pghost) => {
    vi.stubEnv("PGHOST", pghost);
    const cfg = pgSslConnectionConfig(input, env);
    expect(cfg).toStrictEqual({ connectionString: input });
    expect("ssl" in cfg).toBe(false);
  });

  it("A3: an empty pasted CA in production is a bad CA, not a missing one", () => {
    const err = refusal(() => pgSslConnectionConfig(REMOTE_URL, { ...PROD, DATABASE_CA_CERT: "" }));
    expect(err.message).toBe(
      "DATABASE_CA_CERT is set but is not PEM certificate text (certificate blocks only)",
    );
  });

  it("E1: every refusal of the rule is one constant message and leaks nothing", () => {
    for (const [, input, env = PROD, pghost] of REFUSE) {
      vi.stubEnv("PGHOST", pghost);
      const err = refusal(() => pgSslConnectionConfig(input, env));
      expect(err.message).toBe(MESSAGE);
      expect("cause" in err).toBe(false);
      const text = `${err.message}\n${err.stack ?? ""}`;
      for (const leak of [MARKER, REMOTE, "nip.io", ...(input ? [input] : [])]) {
        expect(text).not.toContain(leak);
      }
    }
  });

  it("E2: createDb in production on a remote host with no CA throws before any pool", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_CA_CERT", undefined);
    expect(() => createDb(REMOTE_URL)).toThrow(PgSslConfigError);
  });

  it("E3: importing the helper and the client in production does not throw", async () => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_CA_CERT", undefined);
    await expect(import("./pg-ssl-options.js")).resolves.toHaveProperty("pgSslConnectionConfig");
    await expect(import("./client.js")).resolves.toHaveProperty("createDb");
  });

  it("E4: the helper reads no env name besides DATABASE_CA_CERT and NODE_ENV", () => {
    const src = readFileSync(new URL("./pg-ssl-options.ts", import.meta.url), "utf8");
    const names = [...src.matchAll(/\benv(?:\.(\w+)|\[\s*["'`]?(\w+)["'`]?\s*\])/g)].map(
      (m) => m[1] ?? m[2],
    );
    expect([...new Set(names)].sort()).toEqual(["NODE_ENV", "VAR"]);
    expect(src).toContain('const VAR = "DATABASE_CA_CERT";');
  });
});

import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tls from "node:tls";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createDb, type DbHandle } from "./client.js";
import { formatMigrationFailureForLog, migrate } from "./migrate.js";
import { PgSslConfigError, pgSslConnectionConfig } from "./pg-ssl-options.js";

// Decision table R1-R11 of docs/sessions/web-mvp-phase5-readiness-p5-db-tls-ca-options.md.
// openssl makes every key and certificate at test time in a temp dir, so no key or certificate
// text lives in this file; a missing openssl fails beforeAll, it never skips the proof.

const PASSWORD = "pw-marker-5c1e";
const HOST = "host-marker-8a2d.example";
const VALUE = "val-marker-3b7f";
const URL_PLAIN = `postgres://app:${PASSWORD}@${HOST}:5432/plexco`;
const URL_ENCODED = "postgres://app:p%40ss%2Fw@db.internal:25060/plexco";

let dir = "";
let caA = "";
let caB = "";
let caAKey = "";
let srvLocalCrt = "";
let srvLocalKey = "";
let srvOtherCrt = "";
let srvOtherKey = "";

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "l78-tls-"));
  const openssl = (...args: string[]) => execFileSync("openssl", args, { cwd: dir, stdio: "pipe" });
  writeFileSync(
    join(dir, "ca.cnf"),
    "[req]\ndistinguished_name=dn\nprompt=no\n[dn]\nCN=l78-test\n[v3_ca]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n",
  );
  for (const ca of ["ca-a", "ca-b"]) {
    openssl(
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      `${ca}.key`,
      "-out",
      `${ca}.crt`,
      "-days",
      "2",
      "-subj",
      `/CN=l78-${ca}`,
      "-config",
      "ca.cnf",
      "-extensions",
      "v3_ca",
    );
  }
  for (const [name, dns] of [
    ["localhost", "localhost"],
    ["other", "other.example"],
  ] as const) {
    writeFileSync(
      join(dir, `ext-${name}.cnf`),
      `subjectAltName=DNS:${dns}\nbasicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\n`,
    );
    openssl(
      "req",
      "-new",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      `srv-${name}.key`,
      "-out",
      `srv-${name}.csr`,
      "-subj",
      `/CN=${dns}`,
      "-config",
      "ca.cnf",
    );
    openssl(
      "x509",
      "-req",
      "-in",
      `srv-${name}.csr`,
      "-CA",
      "ca-a.crt",
      "-CAkey",
      "ca-a.key",
      "-CAcreateserial",
      "-out",
      `srv-${name}.crt`,
      "-days",
      "2",
      "-extfile",
      `ext-${name}.cnf`,
    );
  }
  const read = (file: string) => readFileSync(join(dir, file), "utf8");
  [caA, caB, caAKey] = [read("ca-a.crt"), read("ca-b.crt"), read("ca-a.key")];
  [srvLocalCrt, srvLocalKey, srvOtherCrt, srvOtherKey] = [
    read("srv-localhost.crt"),
    read("srv-localhost.key"),
    read("srv-other.crt"),
    read("srv-other.key"),
  ];
});

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const env = (ca: string) => ({ DATABASE_CA_CERT: ca });
const corrupt = (pem: string) => pem.slice(0, 120) + "!!!!!!!!" + pem.slice(128);

// R4: built at runtime from the generated material (the certificates exist only after beforeAll).
const R4_CASES: [string, () => string][] = [
  ["plain text", () => "not a certificate"],
  ["empty", () => ""],
  ["whitespace only", () => " \n\t "],
  ["truncated", () => caA.slice(0, Math.floor(caA.length / 2))],
  ["a corrupted body", () => corrupt(caA)],
  ["a private key pasted by mistake", () => caAKey],
  ["junk after a valid block", () => `${caA}junk\n`],
  ["a bundle whose second block is a private key", () => caA + caAKey],
  ["a bundle whose second certificate is corrupted", () => caA + corrupt(caB)],
  ["escaped newlines", () => caA.trim().replace(/\n/g, "\\n")],
  ["escaped newlines with a trailing escape", () => caA.replace(/\n/g, "\\n")],
];
const R5_QUERIES = [
  "?sslmode=disable",
  "?sslmode=allow",
  "?sslmode=prefer",
  "?sslmode=no-verify",
  `?sslmode=${VALUE}`,
  "?sslmode=",
  "?sslmode",
  "?sslmode=require&sslmode=disable",
  "?application_name=api&sslmode=disable",
  "?SSLMODE=disable",
  "?sslmode=REQUIRE",
  "?ssl%6Dode=disable",
  "?ssl\tmode=disable",
  "?sslmode=require\n",
];
const R6_QUERIES = [
  "?ssl=0",
  "?ssl=false",
  "?ssl=no-verify",
  `?ssl=${VALUE}`,
  "?ssl=",
  "?ssl",
  "?uselibpqcompat=true",
  "?uselibpqcompat=1",
  `?uselibpqcompat=${VALUE}`,
  "?sslmode=require&uselibpqcompat=true",
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

describe("pgSslConnectionConfig: the decision table", () => {
  it.each(["", "?sslmode=require", "?sslmode=disable"])(
    "R1: CA variable unset (URL query %j): the same string and no ssl key, today's pg behaviour, no new refusal",
    (query) => {
      const cfg = pgSslConnectionConfig(URL_PLAIN + query, {});
      expect(cfg).toStrictEqual({ connectionString: URL_PLAIN + query });
      expect("ssl" in cfg).toBe(false);
    },
  );

  it("R2: one valid CA: exactly ca plus rejectUnauthorized true, no identity override, the URL unchanged", () => {
    const cfg = pgSslConnectionConfig(URL_PLAIN, env(caA));
    expect(cfg).toStrictEqual({
      connectionString: URL_PLAIN,
      ssl: { ca: [caA.trim()], rejectUnauthorized: true },
    });
    expect(Object.keys(cfg.ssl ?? {})).toEqual(["ca", "rejectUnauthorized"]);
  });

  it("R2: the default env is process.env", () => {
    vi.stubEnv("DATABASE_CA_CERT", caA);
    expect(pgSslConnectionConfig(URL_PLAIN).ssl?.ca).toEqual([caA.trim()]);
  });

  // L89 (docs/sessions/web-mvp-phase5-readiness-p5-db-tls-ca-required.md): with a CA set, production
  // takes the CA branch exactly as without NODE_ENV, whatever host pg would dial.
  const CA_SET_IN_PRODUCTION: [string, string][] = [
    ["A2: normal production boot after the owner's paste keeps the CA branch", URL_PLAIN],
    [
      "A5: a local production run with a CA keeps the CA branch on loopback",
      `postgres://app:${PASSWORD}@127.0.0.1:5432/plexco`,
    ],
    [
      "A7: a socket with a CA keeps the CA branch",
      "postgres://app@%2Fvar%2Frun%2Fpostgresql/plexco",
    ],
    ["A9: an unparsable URL with a CA keeps the CA branch: bare ::1", "postgres://app@::1/plexco"],
    [
      "A9: an unparsable URL with a CA keeps the CA branch: unclosed [::1",
      "postgres://app@[::1/plexco",
    ],
    [
      "A9: an unparsable URL with a CA keeps the CA branch: a host:port list",
      "postgres://app@h1:5432,h2:5432/plexco",
    ],
    [
      "A9: an unparsable URL with a CA keeps the CA branch: port 99999",
      "postgres://app@127.0.0.1:99999/plexco",
    ],
  ];
  it.each(CA_SET_IN_PRODUCTION)("%s", (_, url) => {
    const cfg = pgSslConnectionConfig(url, { NODE_ENV: "production", ...env(caA) });
    expect(cfg).toStrictEqual(pgSslConnectionConfig(url, env(caA)));
    expect(cfg.ssl).toStrictEqual({ ca: [caA.trim()], rejectUnauthorized: true });
  });

  it("R3: a two-certificate bundle: every block is validated and ca holds both", () => {
    expect(pgSslConnectionConfig(URL_PLAIN, env(caB + caA)).ssl?.ca).toEqual([
      caB.trim(),
      caA.trim(),
    ]);
  });

  it.each(R4_CASES)("R4: a CA that is %s is refused at config time", (_name, value) => {
    expect(() => pgSslConnectionConfig(URL_PLAIN, env(value()))).toThrow(PgSslConfigError);
  });

  it.each(R5_QUERIES)(
    "R5: with the CA set, URL query %j is refused (sslmode outside require/verify-ca/verify-full)",
    (query) => {
      expect(() => pgSslConnectionConfig(URL_PLAIN + query, env(caA))).toThrow(PgSslConfigError);
    },
  );

  it.each(R6_QUERIES)(
    "R6: with the CA set, URL query %j is refused (ssl outside true/1, uselibpqcompat not false)",
    (query) => {
      expect(() => pgSslConnectionConfig(URL_PLAIN + query, env(caA))).toThrow(PgSslConfigError);
    },
  );

  const R7_QUERIES: [string, string][] = [
    ["?sslmode=require", ""],
    ["?sslmode=verify-ca", ""],
    ["?sslmode=verify-full", ""],
    ["?ssl=true", ""],
    ["?ssl=1&sslmode=require", ""],
    ["?sslrootcert=/nonexistent/root.crt", ""],
    ["?sslcert=/nonexistent/c.crt&sslkey=/nonexistent/c.key", ""],
    ["?sslnegotiation=direct", ""],
    ["?SSLMODE=require&SslPassword=x", ""],
    ["?uselibpqcompat=false&sslmode=require", ""],
    [
      "?application_name=api&sslmode=require&options=-c%20statement_timeout%3D5000",
      "?application_name=api&options=-c%20statement_timeout%3D5000",
    ],
    ["?sslmode=require#frag?x", "#frag?x"],
    ["?application_name=api&&x=%41", "?application_name=api&&x=%41"],
  ];

  it.each(R7_QUERIES)(
    "R7: URL query %j keeps only %j, byte for byte, and pg's effective ssl is the helper's",
    (query, rest) => {
      const cfg = pgSslConnectionConfig(URL_ENCODED + query, env(caA));
      expect(cfg.connectionString).toBe(URL_ENCODED + rest);
      expect(new pg.Client(cfg).ssl).toStrictEqual(cfg.ssl);
    },
  );

  it.each(["disable", "no-verify"])(
    "R8: PGSSLMODE=%s in the process env cannot override the explicit ssl object",
    (mode) => {
      vi.stubEnv("PGSSLMODE", mode);
      const cfg = pgSslConnectionConfig(URL_PLAIN, env(caA));
      expect(new pg.Client(cfg).ssl).toStrictEqual(cfg.ssl);
    },
  );

  it("R8 control: pg does read PGSSLMODE in this process when no ssl key is given", () => {
    vi.stubEnv("PGSSLMODE", "no-verify");
    expect(new pg.Client(pgSslConnectionConfig(URL_PLAIN, {})).ssl).toBeTypeOf("object");
  });

  it("R11: every refusal names DATABASE_CA_CERT and a reason, never the password, host, a value or CA text", () => {
    const errors = [
      ...R4_CASES.map(([, value]) => refusal(() => pgSslConnectionConfig(URL_PLAIN, env(value())))),
      ...[...R5_QUERIES, ...R6_QUERIES].map((q) =>
        refusal(() => pgSslConnectionConfig(URL_PLAIN + q, env(caA))),
      ),
    ];
    expect(errors).toHaveLength(R4_CASES.length + R5_QUERIES.length + R6_QUERIES.length);
    for (const err of errors) {
      expect(err.message).toMatch(/^DATABASE_CA_CERT \S/);
      expect(err.cause).toBeUndefined();
      const text = `${err.message}\n${err.stack ?? ""}`;
      for (const secret of [
        PASSWORD,
        HOST,
        VALUE,
        caA.slice(100, 140),
        caB.slice(100, 140),
        caAKey.slice(100, 140),
      ]) {
        expect(text).not.toContain(secret);
      }
    }
  });

  it.each(R7_QUERIES)(
    "T11: DATABASE_CA_CERT=system strips URL query %j to %j exactly as a PEM CA does",
    (query) => {
      const cfg = pgSslConnectionConfig(URL_ENCODED + query, env("system"));
      expect(cfg.connectionString).toBe(
        pgSslConnectionConfig(URL_ENCODED + query, env(caA)).connectionString,
      );
      expect(cfg.ssl).toStrictEqual({ ca: [...tls.rootCertificates], rejectUnauthorized: true });
      expect(new pg.Client(cfg).ssl).toStrictEqual(cfg.ssl);
    },
  );

  it.each([...R5_QUERIES, ...R6_QUERIES])(
    "T12: DATABASE_CA_CERT=system refuses URL query %j with the PEM path's message",
    (query) => {
      expect(refusal(() => pgSslConnectionConfig(URL_PLAIN + query, env("system"))).message).toBe(
        refusal(() => pgSslConnectionConfig(URL_PLAIN + query, env(caA))).message,
      );
    },
  );
});

// A local net server answers pg's SSLRequest with "S" and hands the same socket to a Node TLS
// server that is never listened; pg's own Client drives it, so the proof covers helper + pg + Node.
const SSL_REQUEST_CODE = 80877103;
// AuthenticationOk then ReadyForQuery(idle): connect() resolves with no database behind the stub.
const AUTH_OK_READY = Buffer.from("5200000008000000005a0000000549", "hex");
// R9: the codes Node reports for a server certificate that does not chain to the configured CA.
const VERIFY_CODES = [
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
];

interface Stub {
  port: number;
  connections: number;
  plainStartup: number;
  secure: number;
  startupOverTls: number;
  close: () => Promise<void>;
}

async function startStub(key: string, cert: string): Promise<Stub> {
  const sockets = new Set<net.Socket>();
  const stub: Stub = {
    port: 0,
    connections: 0,
    plainStartup: 0,
    secure: 0,
    startupOverTls: 0,
    close: async () => {},
  };
  const tlsServer = tls.createServer({ key, cert }, (socket) => {
    stub.secure++;
    sockets.add(socket);
    socket.on("error", () => undefined);
    socket.once("data", () => {
      stub.startupOverTls++;
      socket.write(AUTH_OK_READY);
    });
  });
  tlsServer.on("tlsClientError", (_err, socket) => socket.destroy());
  const server = net.createServer((raw) => {
    stub.connections++;
    sockets.add(raw);
    raw.on("error", () => undefined);
    raw.once("data", (chunk) => {
      if (chunk.length === 8 && chunk.readUInt32BE(4) === SSL_REQUEST_CODE) {
        raw.write("S");
        tlsServer.emit("connection", raw);
      } else {
        stub.plainStartup++;
        raw.destroy();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  stub.port = (server.address() as net.AddressInfo).port;
  stub.close = () => {
    for (const socket of sockets) socket.destroy();
    return new Promise<void>((resolve) => server.close(() => resolve()));
  };
  return stub;
}

async function connectOnce(cfg: pg.ClientConfig): Promise<(Error & { code?: string }) | undefined> {
  const client = new pg.Client(cfg);
  client.on("error", () => undefined); // a late socket error must not crash the run; connect() is asserted
  try {
    await client.connect();
  } catch (err) {
    return err as Error & { code?: string };
  }
  await client.end();
  return undefined;
}

// S1-2: NODE_EXTRA_CA_CERTS is read only when a process starts, so the default-store proof runs pg in
// a child Node. The child reads its JSON config from the file path in argv, not from an env or argv
// string: Linux caps one such string at 128 KiB and a DATABASE_CA_CERT=system config is about 200 KB.
// It prints "connected" or the error code. Async execFile: a sync spawn would block the event loop
// that serves the stub.
const runFile = promisify(execFile);
const CHILD_CONNECT = `
const pg = require("pg");
const client = new pg.Client(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")));
client.on("error", () => undefined);
client.connect().then(
  () => client.end().then(() => console.log("connected")),
  (err) => console.log(String(err.code)),
);
`;

async function connectInChildWithCaA(cfg: pg.ClientConfig): Promise<string> {
  const file = join(dir, "child-pg-config.json");
  writeFileSync(file, JSON.stringify(cfg));
  const { stdout } = await runFile(process.execPath, ["-e", CHILD_CONNECT, file], {
    cwd: new URL(".", import.meta.url), // require("pg") resolves from this package
    env: {
      PATH: process.env.PATH ?? "",
      NODE_EXTRA_CA_CERTS: join(dir, "ca-a.crt"),
    },
    encoding: "utf8",
    timeout: 10_000,
  });
  return stdout.trim();
}

// S1 P2-1: connectInChildWithCaA hands its child a config built in this process, which has no
// NODE_EXTRA_CA_CERTS, so it cannot see a `system` trust set that follows the environment. This child
// imports the helper itself, through apps/bot's tsx as pg-ssl-boot-check.test.ts runs TypeScript, and
// builds the config there under NODE_EXTRA_CA_CERTS trusting CA-A, its whole env as the helper's env.
// "no-ca" is the control: ssl with no ca in the same child connects, so the variable is live there.
// The URL goes in a temp-dir file, not argv (a failed execFile echoes its argv); the child prints
// "connected" or the error code only.
const BOT = new URL("../../../apps/bot/", import.meta.url);
const TSX = fileURLToPath(new URL("node_modules/.bin/tsx", BOT));
const CHILD_BUILD_CONNECT = `
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const [helper, urlFile, mode] = process.argv.slice(2);
const { pgSslConnectionConfig } = await import(helper);
const pg = createRequire(helper)("pg");
const connectionString = readFileSync(urlFile, "utf8");
const cfg =
  mode === "system"
    ? pgSslConnectionConfig(connectionString, { ...process.env, DATABASE_CA_CERT: "system" })
    : { connectionString, ssl: { rejectUnauthorized: true } };
const client = new pg.Client(cfg);
client.on("error", () => undefined);
client.connect().then(
  () => client.end().then(() => console.log("connected")),
  (err) => console.log(String(err.code)),
);
`;

async function connectInTsxChildWithCaA(
  connectionString: string,
  mode: "system" | "no-ca",
): Promise<string> {
  const script = join(dir, "child-build-connect.mts");
  const urlFile = join(dir, "child-url.txt");
  writeFileSync(script, CHILD_BUILD_CONNECT);
  writeFileSync(urlFile, connectionString);
  const helper = new URL("./pg-ssl-options.ts", import.meta.url).href;
  const { stdout } = await runFile(TSX, [script, helper, urlFile, mode], {
    cwd: BOT,
    env: {
      PATH: process.env.PATH ?? "",
      ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
      NODE_EXTRA_CA_CERTS: join(dir, "ca-a.crt"),
    },
    encoding: "utf8",
    timeout: 20_000,
  });
  return stdout.trim();
}

describe("pgSslConnectionConfig: TLS stub driven by pg's own Client", () => {
  let stub: Stub | undefined;
  const url = (port: number) => `postgres://app:${PASSWORD}@localhost:${port}/plexco`;
  afterEach(async () => {
    await stub?.close();
    stub = undefined;
  });

  it("R2: the right CA completes the handshake against a server certificate for localhost", async () => {
    stub = await startStub(srvLocalKey, srvLocalCrt);
    expect(await connectOnce(pgSslConnectionConfig(url(stub.port), env(caA)))).toBeUndefined();
    expect(stub).toMatchObject({ connections: 1, secure: 1, startupOverTls: 1, plainStartup: 0 });
  });

  it("R3: a bundle whose second block is the issuing CA completes the handshake", async () => {
    stub = await startStub(srvLocalKey, srvLocalCrt);
    expect(
      await connectOnce(pgSslConnectionConfig(url(stub.port), env(caB + caA))),
    ).toBeUndefined();
    expect(stub).toMatchObject({ connections: 1, secure: 1, plainStartup: 0 });
  });

  it("R4: an invalid CA is refused before any socket opens, the stub sees 0 connections", async () => {
    const live = await startStub(srvLocalKey, srvLocalCrt);
    stub = live;
    for (const [, value] of R4_CASES) {
      let cfg: pg.ClientConfig | undefined;
      // soft: a value the helper accepts still reaches the connect below, so the 0 can fail too
      expect
        .soft(() => {
          cfg = pgSslConnectionConfig(url(live.port), env(value()));
        })
        .toThrow(PgSslConfigError);
      if (cfg) await connectOnce(cfg); // runs only if the helper did NOT throw
    }
    expect(live.connections).toBe(0);
  });

  it.each(["unset", "0"])(
    "R9: a server certificate from another CA fails closed, one connection, no startup sent, no retry (NODE_TLS_REJECT_UNAUTHORIZED %s)",
    async (flag) => {
      if (flag === "0") vi.stubEnv("NODE_TLS_REJECT_UNAUTHORIZED", "0");
      stub = await startStub(srvLocalKey, srvLocalCrt);
      const err = await connectOnce(pgSslConnectionConfig(url(stub.port), env(caB)));
      expect(VERIFY_CODES).toContain(err?.code);
      expect(`${err?.message}\n${err?.stack}`).not.toContain(PASSWORD);
      await sleep(300);
      expect(stub).toMatchObject({ connections: 1, startupOverTls: 0, plainStartup: 0 });
    },
  );

  it("R9 control: with NODE_TLS_REJECT_UNAUTHORIZED=0, a config without the explicit true connects to that server", async () => {
    vi.stubEnv("NODE_TLS_REJECT_UNAUTHORIZED", "0");
    stub = await startStub(srvLocalKey, srvLocalCrt);
    expect(
      await connectOnce({ connectionString: url(stub.port), ssl: { ca: [caB] } }),
    ).toBeUndefined();
  });

  it("R9 default store: the helper's ca replaces Node's default store, so a CA trusted only through NODE_EXTRA_CA_CERTS is refused", async () => {
    stub = await startStub(srvLocalKey, srvLocalCrt);
    // control: no ca, so the child's default store (CA-A loaded from NODE_EXTRA_CA_CERTS) verifies the server
    expect(
      await connectInChildWithCaA({
        connectionString: url(stub.port),
        ssl: { rejectUnauthorized: true },
      }),
    ).toBe("connected");
    // proof: ca = [CA-B] replaces that store, so the same server no longer verifies
    expect(VERIFY_CODES).toContain(
      await connectInChildWithCaA(pgSslConnectionConfig(url(stub.port), env(caB))),
    );
    await sleep(300);
    expect(stub).toMatchObject({ connections: 2, startupOverTls: 1, plainStartup: 0 });
  }, 15_000);

  it("T15: DATABASE_CA_CERT=system refuses a server certificate from a private CA with a verify code, and that config, built in this process, is not widened at connect time by a child's NODE_EXTRA_CA_CERTS trusting the CA", async () => {
    stub = await startStub(srvLocalKey, srvLocalCrt);
    const cfg = pgSslConnectionConfig(url(stub.port), env("system"));
    const err = await connectOnce(cfg);
    expect(VERIFY_CODES).toContain(err?.code);
    expect(`${err?.message}\n${err?.stack}`).not.toContain(PASSWORD);
    await sleep(300);
    expect(stub).toMatchObject({ connections: 1, startupOverTls: 0, plainStartup: 0 });
    // control: no ca, so the child's default store (CA-A loaded from NODE_EXTRA_CA_CERTS) verifies the server
    expect(
      await connectInChildWithCaA({
        connectionString: url(stub.port),
        ssl: { rejectUnauthorized: true },
      }),
    ).toBe("connected");
    // proof: the same config, built here, still fails in that child: an explicit ca is its whole trust set
    expect(VERIFY_CODES).toContain(await connectInChildWithCaA(cfg));
    await sleep(300);
    expect(stub).toMatchObject({ connections: 3, startupOverTls: 1, plainStartup: 0 });
  }, 15_000);

  it("T15: a child whose NODE_EXTRA_CA_CERTS trusts a private CA builds its own DATABASE_CA_CERT=system config through the helper, and a server certificate from that CA is still refused with a verify code", async () => {
    stub = await startStub(srvLocalKey, srvLocalCrt);
    // control: the same child with ssl and no ca connects, so CA-A from NODE_EXTRA_CA_CERTS is trusted there
    expect(await connectInTsxChildWithCaA(url(stub.port), "no-ca")).toBe("connected");
    // proof: the helper, run inside that child with its environment, still trusts the bundled roots only
    expect(VERIFY_CODES).toContain(await connectInTsxChildWithCaA(url(stub.port), "system"));
    await sleep(300);
    expect(stub).toMatchObject({ connections: 2, startupOverTls: 1, plainStartup: 0 });
  }, 30_000);

  it("R10: a server certificate for another hostname fails with ERR_TLS_CERT_ALTNAME_INVALID", async () => {
    stub = await startStub(srvOtherKey, srvOtherCrt);
    const err = await connectOnce(pgSslConnectionConfig(url(stub.port), env(caA)));
    expect(err?.code).toBe("ERR_TLS_CERT_ALTNAME_INVALID");
    await sleep(300);
    expect(stub).toMatchObject({ connections: 1, startupOverTls: 0, plainStartup: 0 });
  });

  it("R4 createDb: an invalid CA throws before a pool exists, the stub sees 0 connections", async () => {
    const live = await startStub(srvLocalKey, srvLocalCrt);
    stub = live;
    for (const [, value] of R4_CASES) {
      vi.stubEnv("DATABASE_CA_CERT", value());
      let handle: DbHandle | undefined;
      // soft: a value createDb accepts still reaches the connect below, so the 0 can fail too
      expect
        .soft(() => {
          handle = createDb(url(live.port));
        })
        .toThrow(PgSslConfigError);
      // runs only if createDb did NOT throw; connect, not a query: the stub answers only the startup
      if (handle) {
        handle.pool.on("error", () => undefined);
        await handle.pool.connect().then(
          (client) => client.release(),
          () => undefined,
        );
        await handle.close();
      }
    }
    expect(live.connections).toBe(0);
  });

  it("R9 pool: a createDb pool facing a server certificate from another CA rejects the first query, one connection", async () => {
    stub = await startStub(srvLocalKey, srvLocalCrt);
    vi.stubEnv("DATABASE_CA_CERT", caB);
    const handle = createDb(url(stub.port), { max: 1 });
    handle.pool.on("error", () => undefined); // a late socket error must not crash the run
    try {
      const err = await handle.pool.query("SELECT 1").then(
        () => undefined,
        (e: Error & { code?: string }) => e,
      );
      expect(VERIFY_CODES).toContain(err?.code);
      expect(`${err?.message}\n${err?.stack}`).not.toContain(PASSWORD);
      await sleep(300);
      expect(stub).toMatchObject({ connections: 1, startupOverTls: 0, plainStartup: 0 });
    } finally {
      await handle.close();
    }
  });
});

describe("createDb: the pool takes the helper's options", () => {
  it("R1: unset builds the pool with no ssl key and the URL unchanged", async () => {
    vi.stubEnv("DATABASE_CA_CERT", undefined);
    const handle = createDb(URL_PLAIN);
    try {
      expect(handle.pool.options).not.toHaveProperty("ssl");
      expect(handle.pool.options.connectionString).toBe(URL_PLAIN);
    } finally {
      await handle.close();
    }
  });

  it("R2: set gives the pool exactly the helper's ssl options", async () => {
    vi.stubEnv("DATABASE_CA_CERT", caA);
    const handle = createDb(URL_PLAIN);
    try {
      expect(handle.pool.options.ssl).toStrictEqual(pgSslConnectionConfig(URL_PLAIN, env(caA)).ssl);
    } finally {
      await handle.close();
    }
  });
});

describe("migrate: the CLI log line carries the refusal reason", () => {
  it("R4 and R11: a refused value names DATABASE_CA_CERT, never the URL", async () => {
    vi.stubEnv("DATABASE_CA_CERT", caA.trim().replace(/\n/g, "\\n"));
    const error = await migrate(URL_PLAIN).catch((e: unknown) => e);
    // The cause is the helper's refusal, so no pg.Client was built and nothing connected.
    expect((error as Error).cause).toBeInstanceOf(PgSslConfigError);
    const line = formatMigrationFailureForLog(error);
    expect(line).toContain("DATABASE_CA_CERT");
    expect(line).not.toContain(PASSWORD);
    expect(line).not.toContain(HOST);
  });
});

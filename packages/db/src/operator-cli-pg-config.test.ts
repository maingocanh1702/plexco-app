import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error -- the shared module is an untyped .mjs; its one export is typed below
import * as shared from "../../../scripts/lib/operator-cli-pg-config.mjs";

// Lane L90, decision table O1-O13 of docs/sessions/web-mvp-phase5-readiness-p5-operator-cli-pg-tls-helper.md.
// openssl makes the CA at test time in a temp dir, so no key or certificate text lives in this file.
// tsx loads the helper inside the module, so its error class is not the one this file would import:
// a refusal is matched by name and message, never by instanceof.

type PgConfig = { connectionString: string; ssl?: { ca: string[]; rejectUnauthorized: true } };
type OperatorCliPgConfig = (connectionString: string, env?: NodeJS.ProcessEnv) => Promise<PgConfig>;
const operatorCliPgConfig = shared.operatorCliPgConfig as OperatorCliPgConfig;

const MODULE = new URL("../../../scripts/lib/operator-cli-pg-config.mjs", import.meta.url);
const REMOTE = "postgres://u:FakePw123@db.invalid:5432/d";
const LOOPBACK = "postgres://u:FakePw123@127.0.0.1:5432/d";
const REQUIRED = {
  name: "PgSslConfigError",
  message:
    "DATABASE_CA_CERT is required when NODE_ENV is production and the database host is not loopback or a Unix socket",
};

let dir = "";
let ca = "";

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "l90-ca-"));
  writeFileSync(
    join(dir, "ca.cnf"),
    "[req]\ndistinguished_name=dn\nprompt=no\n[dn]\nCN=l90-test\n",
  );
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      "ca.key",
      "-out",
      "ca.crt",
      "-days",
      "2",
      "-subj",
      "/CN=l90-test",
      "-config",
      "ca.cnf",
    ],
    { cwd: dir, stdio: "pipe" },
  );
  ca = readFileSync(join(dir, "ca.crt"), "utf8");
});

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("operatorCliPgConfig: the owner CLIs' pg config is the helper evaluated as a production build", () => {
  it("a remote host with no CA refuses when the caller's NODE_ENV is unset (the owner's machine)", async () => {
    await expect(operatorCliPgConfig(REMOTE, {})).rejects.toMatchObject(REQUIRED);
  });

  it("a remote host with no CA refuses when the caller's NODE_ENV is development", async () => {
    await expect(operatorCliPgConfig(REMOTE, { NODE_ENV: "development" })).rejects.toMatchObject(
      REQUIRED,
    );
  });

  it("a remote host with a valid CA gives the verified ssl config", async () => {
    await expect(operatorCliPgConfig(REMOTE, { DATABASE_CA_CERT: ca })).resolves.toEqual({
      connectionString: REMOTE,
      ssl: { ca: [ca.trim()], rejectUnauthorized: true },
    });
  });

  it("a loopback host with no CA gives today's config (the tests, the e2e proofs, local compose)", async () => {
    await expect(operatorCliPgConfig(LOOPBACK, {})).resolves.toEqual({
      connectionString: LOOPBACK,
    });
  });

  it("a weakening URL with a CA refuses", async () => {
    await expect(
      operatorCliPgConfig(`${REMOTE}?sslmode=disable`, { DATABASE_CA_CERT: ca }),
    ).rejects.toMatchObject({
      name: "PgSslConfigError",
      message:
        "DATABASE_CA_CERT is set, so the database URL parameter sslmode must be require or verify-ca or verify-full",
    });
  });

  it("a copy whose helper cannot load rejects and gives no config (no fallback)", async () => {
    // From the copy's location tsx does not resolve (MODULE_NOT_FOUND), or, under pnpm's bin shim
    // (NODE_PATH = its store), tsx loads and the helper file is missing (ERR_MODULE_NOT_FOUND).
    const copy = join(dir, "operator-cli-pg-config.mjs");
    copyFileSync(MODULE, copy);
    const { operatorCliPgConfig: unloadable } = (await import(pathToFileURL(copy).href)) as {
      operatorCliPgConfig: OperatorCliPgConfig;
    };
    await expect(unloadable(LOOPBACK, {})).rejects.toMatchObject({
      code: expect.stringMatching(/^(?:ERR_)?MODULE_NOT_FOUND$/),
    });
  });
});

describe("owner CLIs: a remote host without DATABASE_CA_CERT is refused before connecting", () => {
  // `node scripts/<cli> <args>` from the repo root with PATH and DATABASE_URL_MIGRATION only, so no
  // NODE_ENV, CA or PGHOST of the runner reaches it; the refusal comes before any connection attempt.
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  it.each([
    ["outbox-dlq-replay.mjs", ["list"]],
    ["outbox-projector-enable.mjs", ["enable", "--projector", "zalo_dm"]],
    ["public-alias-moderate.mjs", ["list"]],
  ])(
    "%s exits 1, its first error line names DATABASE_CA_CERT, no stack and no URL, host or credential",
    (script, args) => {
      const run = spawnSync(process.execPath, [`scripts/${script}`, ...args], {
        cwd: root,
        env: { PATH: process.env.PATH, DATABASE_URL_MIGRATION: REMOTE },
        encoding: "utf8",
        timeout: 30_000,
      });
      expect(run.status).toBe(1);
      expect(run.stderr.split("\n")[0]).toBe(`error: ${REQUIRED.message}`);
      expect(run.stderr).not.toMatch(/^\s+at /m);
      for (const leak of ["postgres://", "db.invalid", "FakePw123"]) {
        expect(run.stdout + run.stderr).not.toContain(leak);
      }
    },
  );
});

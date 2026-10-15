import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { DevSeedRefusedError, assertDevSeedEnvironment, runDevSeed } from "./seed";

const KEY = Buffer.alloc(32, 1).toString("base64");
const LOCAL = "postgres://app:plexco_dev_app@localhost:5432/plexco";

describe("dev:seed refuses BEFORE connecting", () => {
  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["remote host", "postgres://app:pw@db.example.com:5432/plexco"],
    [
      "managed cloud host",
      "postgres://doadmin:pw@plexco-do-user-1.db.ondigitalocean.com:25060/defaultdb",
    ],
    ["loopback look-alike", "postgres://app:pw@localhost.evil.test:5432/plexco"],
    ["?host= override", `${LOCAL}?host=db.example.com`],
    ["any query string", `${LOCAL}?sslmode=require`],
    ["empty host (PGHOST fallback)", "postgres:///plexco"],
    ["userinfo trick", "postgres://localhost:5432@db.example.com/plexco"],
  ])("DATABASE_URL %s => DevSeedRefusedError, connect never called", async (_, url) => {
    const connect = vi.fn(() => {
      throw new Error("connect must not be called");
    });
    await expect(
      runDevSeed({ DATABASE_URL: url, ENCRYPTION_KEY: KEY }, { connect }),
    ).rejects.toBeInstanceOf(DevSeedRefusedError);
    expect(connect).not.toHaveBeenCalled();
  });

  it.each(["aws-kms", "gcp-kms"])(
    "KMS_PROVIDER=%s => refused (never a KMS-held pepper)",
    async (kms) => {
      const connect = vi.fn();
      await expect(
        runDevSeed({ DATABASE_URL: LOCAL, ENCRYPTION_KEY: KEY, KMS_PROVIDER: kms }, { connect }),
      ).rejects.toThrow(/KMS_PROVIDER/);
      expect(connect).not.toHaveBeenCalled();
    },
  );

  it("missing ENCRYPTION_KEY => refused", async () => {
    const connect = vi.fn();
    await expect(runDevSeed({ DATABASE_URL: LOCAL }, { connect })).rejects.toThrow(
      /ENCRYPTION_KEY/,
    );
    expect(connect).not.toHaveBeenCalled();
  });

  it.each([
    LOCAL,
    "postgres://app:pw@127.0.0.1:5432/plexco",
    "postgres://app:pw@[::1]:5432/plexco",
    "postgres://app:plexco_dev_app@postgres:5432/plexco",
  ])("accepts the local URL %s", (url) => {
    expect(assertDevSeedEnvironment({ DATABASE_URL: url, ENCRYPTION_KEY: KEY })).toBe(url);
    expect(
      assertDevSeedEnvironment({ DATABASE_URL: url, ENCRYPTION_KEY: KEY, KMS_PROVIDER: "local" }),
    ).toBe(url);
  });

  it("the refusal message never echoes the URL (it carries a password)", () => {
    try {
      assertDevSeedEnvironment({
        DATABASE_URL: "postgres://app:s3cret@db.example.com/p",
        ENCRYPTION_KEY: KEY,
      });
      expect.unreachable();
    } catch (error) {
      expect(String((error as Error).message)).not.toContain("s3cret");
      expect(String((error as Error).message)).not.toContain("db.example.com");
    }
  });
});

describe("dev:seed refuses, after connecting but BEFORE any write, a database that is not safe", () => {
  function fakeHandle(row: Record<string, unknown>) {
    const query = vi.fn(async () => ({ rows: [row] }));
    const close = vi.fn(async () => {});
    return { handle: { pool: { query }, db: {}, close } as never, query, close };
  }

  it("not opted in by its owner (a port-forward to a shared database looks local by host string)", async () => {
    const { handle, query, close } = fakeHandle({
      database: "plexco",
      opt_in: false,
      current_bypasses: false,
      session_bypasses: false,
    });
    await expect(
      runDevSeed({ DATABASE_URL: LOCAL, ENCRYPTION_KEY: KEY }, { connect: () => handle }),
    ).rejects.toThrow(
      /not opted in to dev-login.*ALTER DATABASE plexco SET plexco\.dev_login = 'on'/,
    );
    expect(query).toHaveBeenCalledTimes(1); // the guard read only: no definer call, no write
    expect(close).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["superuser or BYPASSRLS current_user", { current_bypasses: true, session_bypasses: true }],
    [
      "superuser session_user behind `-c role=app`",
      { current_bypasses: false, session_bypasses: true },
    ],
    ["role that cannot be found", { current_bypasses: null, session_bypasses: false }],
  ])("connecting with a %s (RLS would not apply)", async (_, attrs) => {
    const { handle, query } = fakeHandle({ database: "plexco", opt_in: true, ...attrs });
    await expect(
      runDevSeed({ DATABASE_URL: LOCAL, ENCRYPTION_KEY: KEY }, { connect: () => handle }),
    ).rejects.toThrow(/superuser or BYPASSRLS/);
    expect(query).toHaveBeenCalledTimes(1);
  });
});

describe("the real `pnpm dev:seed` entry refuses a non-local URL (process level)", () => {
  // Same command the root package.json `dev:seed` script runs: tsx from @plexco/db on seed-cli.ts.
  const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
  const tsx = `${repoRoot}packages/db/node_modules/.bin/tsx`;
  const cli = fileURLToPath(new URL("./seed-cli.ts", import.meta.url));

  it.skipIf(!existsSync(tsx))(
    "exits non-zero with the refusal message, without trying the remote host",
    () => {
      const started = Date.now();
      // 10.255.255.1 is a non-routable address: a connect attempt would hang until the timeout.
      const run = spawnSync(tsx, [cli], {
        cwd: `${repoRoot}packages/db`,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          DATABASE_URL: "postgres://app:pw@10.255.255.1:5432/plexco",
          ENCRYPTION_KEY: KEY,
        } as unknown as NodeJS.ProcessEnv,
        encoding: "utf8",
        timeout: 60_000,
      });
      expect(run.status).toBe(1);
      expect(run.stderr).toContain("dev:seed refused: DATABASE_URL must point at localhost");
      expect(Date.now() - started).toBeLessThan(30_000);
    },
    60_000,
  );
});

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "node:util";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ensureRoleExists, logMigrationFailure, migrate } from "./migrate.js";
import {
  bootstrapJobDefiner,
  setupNonSuperuserOwnerContext,
  withJobDefinerLock,
} from "./test-harness.js";

const actualFsPromises =
  await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");

let readdirImpl: (dir: string) => Promise<string[]> = (dir) =>
  actualFsPromises.readdir(dir) as Promise<string[]>;
let readFileImpl: (filePath: string, encoding: "utf8") => Promise<string> = (filePath, encoding) =>
  actualFsPromises.readFile(filePath, encoding);
vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  return {
    ...actual,
    readdir: (dir: string) => readdirImpl(dir),
    readFile: (filePath: string, encoding: "utf8") => readFileImpl(filePath, encoding),
  };
});

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const MIGRATION_COUNT = 28;

const BASE = process.env.DATABASE_URL_TEST;
if (!BASE) {
  throw new Error(
    "DATABASE_URL_TEST is required for the migrate suite (CI sets it; locally: " +
      "docker compose -f infra/docker-compose.yml up -d postgres and export " +
      "DATABASE_URL_TEST=postgres://plexco:plexco_dev@localhost:5432/plexco_test)",
  );
}
const BASE_DB = new URL(BASE).pathname.replace(/^\//, "");

function url(db: string, user?: string, password?: string): string {
  const u = new URL(BASE!);
  u.pathname = `/${db}`;
  if (user) {
    u.username = user;
    u.password = password ?? "";
  }
  return u.toString();
}

async function connect(connectionString: string): Promise<pg.Client> {
  const c = new pg.Client({ connectionString });
  await c.connect();
  return c;
}

async function roleCount(admin: pg.Client, role: string): Promise<number> {
  const { rows } = await admin.query(`SELECT count(*)::int AS n FROM pg_roles WHERE rolname = $1`, [
    role,
  ]);
  return (rows[0] as { n: number }).n;
}

let admin: pg.Client;

beforeAll(async () => {
  admin = await connect(BASE!);

  await bootstrapJobDefiner(admin);
}, 120_000);

afterAll(async () => {
  await admin?.end();
});

describe("BR-1 race-safe cluster-global role creation", () => {
  it("N concurrent creates of an absent role all succeed; role exists exactly once", async () => {
    const race = "plexco_migrate_race";
    const N = 8;
    for (let iter = 0; iter < 5; iter++) {
      await admin.query(`DROP ROLE IF EXISTS ${race}`);
      const clients = await Promise.all(Array.from({ length: N }, () => connect(BASE!)));
      try {
        const results = await Promise.allSettled(clients.map((c) => ensureRoleExists(c, race)));
        const rejected = results.filter((r) => r.status === "rejected");
        expect(
          rejected,
          `no create should escape: ${rejected
            .map((r) => String((r as PromiseRejectedResult).reason))
            .join(" | ")}`,
        ).toEqual([]);
        expect(await roleCount(admin, race)).toBe(1);
      } finally {
        await Promise.all(clients.map((c) => c.end()));
      }
    }
    await admin.query(`DROP ROLE IF EXISTS ${race}`);
  }, 60_000);

  it("N concurrent migrate() bootstrapping fresh databases all succeed, roles intact", async () => {
    const N = 3;
    for (let iter = 0; iter < 2; iter++) {
      const dbs = Array.from({ length: N }, (_, i) => `plexco_migrate_conc_${iter}_${i}`);
      for (const db of dbs) {
        await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
        await admin.query(`CREATE DATABASE ${db}`);
      }
      try {
        const results = await Promise.allSettled(dbs.map((db) => migrate(url(db))));
        for (const r of results) {
          if (r.status === "rejected") {
            throw new Error(`concurrent migrate rejected: ${String(r.reason)}`);
          }
          expect(r.value.applied.length).toBe(MIGRATION_COUNT);
        }
        for (const role of ["app", "app_worker", "readonly"]) {
          expect(await roleCount(admin, role), `${role} must exist exactly once`).toBe(1);
        }
      } finally {
        for (const db of dbs) {
          await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
        }
      }
    }
  }, 180_000);
});

describe("BR-2 applied migrations stay immutable", () => {
  it("0000's recorded sha256 equals the file on disk, and a changed applied file is rejected", async () => {
    const db = "plexco_migrate_immut";
    await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${db}`);
    try {
      await migrate(url(db));

      const fileSql = await readFile(
        path.join(MIGRATIONS_DIR, "0000_roles_extensions.sql"),
        "utf8",
      );
      const fileSha = createHash("sha256").update(fileSql).digest("hex");

      const c = await connect(url(db));
      try {
        const rec = await c.query(
          `SELECT sha256 FROM schema_migrations WHERE name = '0000_roles_extensions.sql'`,
        );

        expect((rec.rows[0] as { sha256: string }).sha256).toBe(fileSha);

        await c.query(
          `UPDATE schema_migrations SET sha256 = 'tampered' WHERE name = '0000_roles_extensions.sql'`,
        );
      } finally {
        await c.end();
      }

      await expect(migrate(url(db))).rejects.toThrow(/changed after being applied/);
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
    }
  }, 60_000);
});

describe("BR-3 role ensure is gated + only creates genuinely-absent roles", () => {
  it("re-migrating an already-applied database needs no CREATEROLE", async () => {
    const db = "plexco_migrate_gate";
    const norole = "plexco_migrate_norole";
    await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${db}`);
    await admin.query(`DROP ROLE IF EXISTS ${norole}`);
    await admin.query(`CREATE ROLE ${norole} LOGIN NOSUPERUSER NOCREATEROLE PASSWORD 'x'`);
    try {
      const first = await migrate(url(db));
      expect(first.applied.length).toBe(MIGRATION_COUNT);

      const g = await connect(url(db));
      try {
        await g.query(`GRANT ALL ON SCHEMA public TO ${norole}`);
        await g.query(`GRANT ALL ON ALL TABLES IN SCHEMA public TO ${norole}`);
      } finally {
        await g.end();
      }

      const second = await migrate(url(db, norole, "x"));
      expect(second.applied).toEqual([]);
      expect(second.skipped.length).toBe(MIGRATION_COUNT);
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
      await admin.query(`DROP ROLE IF EXISTS ${norole}`);
    }
  }, 60_000);

  it("a fresh database with pre-provisioned roles needs no CREATEROLE", async () => {
    const db = "plexco_migrate_preprov";
    const owner = "plexco_migrate_owner";
    await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
    await admin.query(`DROP ROLE IF EXISTS ${owner}`);

    for (const role of ["app", "app_worker", "readonly"]) {
      await ensureRoleExists(admin, role);
    }

    await admin.query(`CREATE ROLE ${owner} LOGIN NOSUPERUSER NOCREATEROLE PASSWORD 'x'`);
    await admin.query(`CREATE DATABASE ${db} OWNER ${owner}`);
    try {
      await admin.query(`SET job_definer_bootstrap.migration_role = '${owner}'`);
      try {
        await bootstrapJobDefiner(admin);
      } finally {
        await admin.query(`RESET job_definer_bootstrap.migration_role`);
      }
      const res = await migrate(url(db, owner, "x"));
      expect(res.applied.length).toBe(MIGRATION_COUNT);
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
      await admin.query(`DROP ROLE IF EXISTS ${owner}`);
    }
  }, 60_000);
});

describe("BR-4 only the role-already-exists race codes are swallowed", () => {
  it("insufficient_privilege from CREATE ROLE propagates and does not create the role", async () => {
    const lowpriv = "plexco_migrate_lowpriv";
    const target = "plexco_migrate_target";
    await admin.query(`DROP ROLE IF EXISTS ${lowpriv}`);
    await admin.query(`DROP ROLE IF EXISTS ${target}`);
    await admin.query(`CREATE ROLE ${lowpriv} LOGIN NOSUPERUSER NOCREATEROLE PASSWORD 'x'`);
    const c = await connect(url(BASE_DB, lowpriv, "x"));
    try {
      await expect(ensureRoleExists(c, target)).rejects.toThrow(/permission denied/i);
      expect(await roleCount(admin, target)).toBe(0);
    } finally {
      await c.end();
      await admin.query(`DROP ROLE IF EXISTS ${lowpriv}`);
      await admin.query(`DROP ROLE IF EXISTS ${target}`);
    }
  }, 60_000);

  it("refuses an unsafe role identifier before issuing any DDL", async () => {
    const c = await connect(BASE!);
    try {
      await expect(ensureRoleExists(c, "app; DROP ROLE readonly")).rejects.toThrow(
        /unsafe identifier/,
      );
    } finally {
      await c.end();
    }
  });

  it("rejects an unsafe role identifier from reaching the CLI sink's actual output even though it is preserved in .message", async () => {
    const c = await connect(BASE!);
    const secret = "pii-marker@example.com;DROP ROLE app";
    try {
      let caught: unknown;
      try {
        await ensureRoleExists(c, secret);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);

      expect((caught as Error).message).toContain(secret);

      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      let printed: string;
      try {
        logMigrationFailure(caught);
        expect(spy).toHaveBeenCalledTimes(1);
        printed = format(...spy.mock.calls[0]!);
      } finally {
        spy.mockRestore();
      }
      expect(printed).toContain("unsafe identifier");
      expect(printed).not.toContain(secret);
    } finally {
      await c.end();
    }
  });
});

describe("BR-5 0022 upgrade path: pre-existing claims survive the new lease-shape CHECK", () => {
  it("backfills lease_expires_at across tenants for legacy claimed_at-only rows under a non-superuser migration owner, and the backfilled leases are immediately reclaimable", async () => {
    const ctx = await setupNonSuperuserOwnerContext("plexco_migrate_br5_legacy_claim");

    const superuserInDb = await connect(url(ctx.dbName));
    try {
      const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
      for (const f of files) {
        if (Number.parseInt(f.slice(0, 4), 10) >= 22) continue;
        await ctx.ownerPool.query(await readFile(path.join(MIGRATIONS_DIR, f), "utf8"));
      }

      const claimedAt = new Date(Date.now() - 3_600_000);
      const t = await superuserInDb.query(
        `INSERT INTO tenants (name, slug, status) VALUES
           ('BR5 A', 'br5-legacy-a', 'active'), ('BR5 B', 'br5-legacy-b', 'active') RETURNING id`,
      );
      const tenantA = (t.rows[0] as { id: string }).id;
      const tenantB = (t.rows[1] as { id: string }).id;
      const seedEvent = (tenantId: string) =>
        superuserInDb
          .query(
            `INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, sequence, type, payload, claimed_at)
             VALUES ($1, 'br5_test', gen_random_uuid(), 1, 'br5.legacy', '{}'::jsonb, $2) RETURNING id`,
            [tenantId, claimedAt],
          )
          .then((r) => (r.rows[0] as { id: string }).id);
      const eventIdA = await seedEvent(tenantA);
      const eventIdB = await seedEvent(tenantB);

      await withJobDefinerLock(BASE!, async () => {
        await ctx.bootstrapJobDefinerForOwner();
        const sql0022 = await readFile(
          path.join(MIGRATIONS_DIR, "0022_job_claim_lease_core.sql"),
          "utf8",
        );
        await ctx.ownerPool.query(sql0022);
      });

      const rows = await superuserInDb.query(
        `SELECT id, claimed_at, lease_expires_at FROM outbox_events WHERE id = ANY($1) ORDER BY id`,
        [[eventIdA, eventIdB]],
      );
      expect(rows.rows.length).toBe(2);
      for (const row of rows.rows as { claimed_at: Date; lease_expires_at: Date }[]) {
        expect(row.lease_expires_at.getTime()).toBe(row.claimed_at.getTime() + 5 * 60_000);
      }

      const worker = await ctx.connectAsWorker();
      const claimed = await worker.query(
        `SELECT event_id FROM claim_outbox_batch(100) WHERE event_id = ANY($1)`,
        [[eventIdA, eventIdB]],
      );
      expect(claimed.rows.length).toBe(2);
    } finally {
      await superuserInDb.end();
      await ctx.teardown();
    }
  }, 60_000);
});

describe("BR-6 0022 succeeds end to end when the migration role is NOINHERIT", () => {
  it("app_worker can call claim_outbox_batch after the whole migration applies", async () => {
    const ctx = await setupNonSuperuserOwnerContext("plexco_migrate_br6_noinherit", {
      inherit: false,
    });
    try {
      await withJobDefinerLock(BASE!, async () => {
        await ctx.bootstrapJobDefinerForOwner();
        const res = await ctx.runMigration();
        expect(res.applied[res.applied.length - 1]).toBe("0027_resolve_tenant_status_locked.sql");
      });

      const worker = await ctx.connectAsWorker();
      const claimed = await worker.query(`SELECT * FROM claim_outbox_batch(1)`);
      expect(claimed.rows).toEqual([]);
    } finally {
      await ctx.teardown();
    }
  }, 60_000);
});

describe("BR-7 0023 upgrade path: pre-existing claims survive the new triple-shape CHECK", () => {
  it("backfills claim_token across tenants for legacy claimed_at-only rows under a non-superuser migration owner, and the backfilled token is immediately usable to ack", async () => {
    const ctx = await setupNonSuperuserOwnerContext("plexco_migrate_br7_legacy_claim");
    const superuserInDb = await connect(url(ctx.dbName));
    try {
      let eventIdA = "";
      let eventIdB = "";

      await withJobDefinerLock(BASE!, async () => {
        await ctx.bootstrapJobDefinerForOwner();

        const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
        for (const f of files) {
          if (Number.parseInt(f.slice(0, 4), 10) >= 23) continue;
          await ctx.ownerPool.query(await readFile(path.join(MIGRATIONS_DIR, f), "utf8"));
        }

        const t = await superuserInDb.query(
          `INSERT INTO tenants (name, slug, status) VALUES
             ('BR7 A', 'br7-legacy-a', 'active'), ('BR7 B', 'br7-legacy-b', 'active') RETURNING id`,
        );
        const tenantA = (t.rows[0] as { id: string }).id;
        const tenantB = (t.rows[1] as { id: string }).id;
        const claimedAt = new Date();
        const leaseExpiresAt = new Date(Date.now() + 5 * 60_000);
        const seedEvent = (tenantId: string) =>
          superuserInDb
            .query(
              `INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, sequence, type, payload, claimed_at, lease_expires_at)
               VALUES ($1, 'br7_test', gen_random_uuid(), 1, 'br7.legacy', '{}'::jsonb, $2, $3) RETURNING id`,
              [tenantId, claimedAt, leaseExpiresAt],
            )
            .then((r) => (r.rows[0] as { id: string }).id);
        eventIdA = await seedEvent(tenantA);
        eventIdB = await seedEvent(tenantB);

        const sql0023 = await readFile(
          path.join(MIGRATIONS_DIR, "0023_outbox_ack_marker.sql"),
          "utf8",
        );
        await ctx.ownerPool.query(sql0023);
      });

      const rows = await superuserInDb.query(
        `SELECT id, claim_token FROM outbox_events WHERE id = ANY($1) ORDER BY id`,
        [[eventIdA, eventIdB]],
      );
      expect(rows.rows.length).toBe(2);
      for (const row of rows.rows as { claim_token: string | null }[]) {
        expect(row.claim_token).not.toBeNull();
      }

      const rowA = (rows.rows as { id: string; claim_token: string }[]).find(
        (r) => r.id === eventIdA,
      )!;
      const worker = await ctx.connectAsWorker();
      const ackA = await worker.query(`SELECT ack_outbox_event($1, ARRAY[]::text[], $2) AS ok`, [
        eventIdA,
        rowA.claim_token,
      ]);
      expect((ackA.rows[0] as { ok: boolean }).ok).toBe(true);
    } finally {
      await superuserInDb.end();
      await ctx.teardown();
    }
  }, 60_000);
});

describe("setupNonSuperuserOwnerContext teardown", () => {
  it("drops the scratch database and its privileged owner role", async () => {
    const ctx = await setupNonSuperuserOwnerContext("plexco_migrate_teardown_check");
    const { dbName, ownerRole } = ctx;
    await ctx.teardown();

    const admin = await connect(BASE!);
    try {
      const db = await admin.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [dbName]);
      expect(db.rows.length).toBe(0);
      const role = await admin.query(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [ownerRole]);
      expect(role.rows.length).toBe(0);
    } finally {
      await admin.end();
    }
  }, 30_000);
});

async function expectNoPartialJobCoreRow(ctx: { ownerPool: pg.Pool }): Promise<void> {
  const rec = await ctx.ownerPool.query(
    `SELECT 1 FROM schema_migrations WHERE name = '0022_job_claim_lease_core.sql'`,
  );
  expect(rec.rows.length).toBe(0);
}

async function hideRealJobDefiner(superuser: pg.Client, fn: () => Promise<void>): Promise<void> {
  const existing = await superuser.query(`SELECT 1 FROM pg_roles WHERE rolname = 'job_definer'`);
  const hadRealRole = existing.rows.length > 0;
  if (hadRealRole) {
    await superuser.query(`ALTER ROLE job_definer RENAME TO job_definer_hidden_for_test`);
  }
  try {
    await fn();
  } finally {
    if (hadRealRole) {
      await superuser.query(`ALTER ROLE job_definer_hidden_for_test RENAME TO job_definer`);
    }
  }
}

describe("JCL-2/JCL-3 job-core migration fails closed on job_definer preconditions", () => {
  it("JCL-2a: job_definer absent — migration fails, 0022 is not recorded", async () => {
    const ctx = await setupNonSuperuserOwnerContext("plexco_migrate_jcl2_absent");
    try {
      await withJobDefinerLock(BASE!, () =>
        hideRealJobDefiner(ctx.superuser, async () => {
          await expect(ctx.runMigration()).rejects.toThrow(/job_definer/i);
        }),
      );
      await expectNoPartialJobCoreRow(ctx);
    } finally {
      await ctx.teardown();
    }
  }, 60_000);

  it("JCL-2b: job_definer with a wrong attribute — migration fails, 0022 is not recorded", async () => {
    const ctx = await setupNonSuperuserOwnerContext("plexco_migrate_jcl2_wrongattr");
    try {
      await withJobDefinerLock(BASE!, () =>
        hideRealJobDefiner(ctx.superuser, async () => {
          await ctx.superuser.query(
            `CREATE ROLE job_definer LOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION`,
          );
          try {
            await expect(ctx.runMigration()).rejects.toThrow(/job_definer/i);
          } finally {
            await ctx.superuser.query(`DROP ROLE job_definer`);
          }
        }),
      );
      await expectNoPartialJobCoreRow(ctx);
    } finally {
      await ctx.teardown();
    }
  }, 60_000);

  it("preserve-caught-error: a migration failure's rethrown Error attaches the original as .cause", async () => {
    const ctx = await setupNonSuperuserOwnerContext("plexco_migrate_cause_preserved");
    try {
      await withJobDefinerLock(BASE!, () =>
        hideRealJobDefiner(ctx.superuser, async () => {
          let caught: unknown;
          try {
            await ctx.runMigration();
          } catch (error) {
            caught = error;
          }
          expect(caught).toBeInstanceOf(Error);
          expect((caught as Error).cause).toBeDefined();
        }),
      );
      await expectNoPartialJobCoreRow(ctx);
    } finally {
      await ctx.teardown();
    }
  }, 60_000);

  it("JCL-3: job_definer correct but not granted to the migration owner — ownership transfer fails closed", async () => {
    const ctx = await setupNonSuperuserOwnerContext("plexco_migrate_jcl3_nomembership");
    try {
      await bootstrapJobDefiner(ctx.superuser);
      await expect(ctx.runMigration()).rejects.toThrow(/job_definer/i);
      await expectNoPartialJobCoreRow(ctx);
    } finally {
      await ctx.teardown();
    }
  }, 60_000);

  it("JCL-3b: job_definer already granted to a runtime role — migration fails closed even though the migration role's own membership is correct", async () => {
    const ctx = await setupNonSuperuserOwnerContext("plexco_migrate_jcl3b_runtimemember");
    try {
      await withJobDefinerLock(BASE!, async () => {
        await ctx.bootstrapJobDefinerForOwner();

        await ctx.superuser.query(`GRANT job_definer TO app_worker`);
        try {
          await expect(ctx.runMigration()).rejects.toThrow(/app_worker|app\/app_worker\/readonly/i);
          await expectNoPartialJobCoreRow(ctx);
        } finally {
          await ctx.superuser.query(`REVOKE job_definer FROM app_worker`);
        }
      });
    } finally {
      await ctx.teardown();
    }
  }, 60_000);
});

describe("CLI failure-log sink never prints row values from a real Postgres unique violation", () => {
  it("keeps the offending row value out of console.error's actual output on a real Postgres unique violation", async () => {
    const db = "plexco_migrate_sink_allowlist";
    await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${db}`);
    const c = await connect(url(db));
    const secret = "pii-marker+unique-violation-probe@example.com";
    try {
      await c.query(`CREATE TABLE sink_probe (name text PRIMARY KEY)`);
      await c.query(`INSERT INTO sink_probe(name) VALUES ($1)`, [secret]);

      let dbError: unknown;
      try {
        await c.query(`INSERT INTO sink_probe(name) VALUES ($1)`, [secret]);
      } catch (error) {
        dbError = error;
      }

      expect((dbError as Error).message).not.toContain(secret);
      expect(String((dbError as { detail?: string }).detail)).toContain(secret);

      const wrapped = new Error(
        `migrate: 0099_sink_probe.sql failed and was rolled back: ${String(dbError)}`,
        { cause: dbError },
      );

      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      let printed: string;
      try {
        logMigrationFailure(wrapped);
        expect(spy).toHaveBeenCalledTimes(1);

        printed = format(...spy.mock.calls[0]!);
      } finally {
        spy.mockRestore();
      }

      expect(printed).toContain("migrate: a migration step failed");
      expect(printed).not.toContain(secret);
    } finally {
      await c.end();
      await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
    }
  }, 30_000);

  it("keeps a data-exception error (22P02) out of console.error's actual output even though its offending value sits in the PRIMARY message, not .detail", async () => {
    const c = await connect(BASE!);
    const secret = "pii-in-primary-message-probe@example.com";
    try {
      let dbError: unknown;
      try {
        await c.query(`SELECT $1::integer`, [secret]);
      } catch (error) {
        dbError = error;
      }

      expect((dbError as { code?: string }).code).toBe("22P02");
      expect((dbError as Error).message).toContain(secret);
      expect((dbError as { detail?: unknown }).detail).toBeUndefined();

      const wrapped = new Error(
        `migrate: 0099_sink_primary_message_probe.sql failed and was rolled back: ${String(dbError)}`,
        { cause: dbError },
      );

      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      let printed: string;
      try {
        logMigrationFailure(wrapped);
        expect(spy).toHaveBeenCalledTimes(1);
        printed = format(...spy.mock.calls[0]!);
      } finally {
        spy.mockRestore();
      }
      expect(printed).toContain("migrate: a migration step failed");
      expect(printed).not.toContain("22P02");
      expect(printed).not.toContain(secret);
    } finally {
      await c.end();
    }
  }, 30_000);

  it("preserves the migration filename in the CLI sink's actual output on a per-file migration failure", async () => {
    const ctx = await setupNonSuperuserOwnerContext("plexco_migrate_filename_preserved");
    try {
      await withJobDefinerLock(BASE!, () =>
        hideRealJobDefiner(ctx.superuser, async () => {
          let caught: unknown;
          try {
            await ctx.runMigration();
          } catch (error) {
            caught = error;
          }
          expect(caught).toBeInstanceOf(Error);
          expect((caught as Error).cause).toBeDefined();

          const spy = vi.spyOn(console, "error").mockImplementation(() => {});
          let printed: string;
          try {
            logMigrationFailure(caught);
            expect(spy).toHaveBeenCalledTimes(1);
            printed = format(...spy.mock.calls[0]!);
          } finally {
            spy.mockRestore();
          }

          expect(printed).toContain("0022_job_claim_lease_core.sql");
        }),
      );
      await expectNoPartialJobCoreRow(ctx);
    } finally {
      await ctx.teardown();
    }
  }, 60_000);

  it("keeps a marker embedded in a real Postgres per-file failure out of the CLI sink's actual output, while the real cause carries it", async () => {
    const db = "plexco_migrate_realfile_probe";
    await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${db}`);
    const secret = "pii-marker-real-per-file-probe@example.com";
    const originalReaddir = readdirImpl;
    const originalReadFile = readFileImpl;
    readdirImpl = (async () => ["0001_marker_probe.sql"]) as typeof readdirImpl;
    readFileImpl = (async () =>
      `DO $$ BEGIN RAISE EXCEPTION '${secret}'; END $$;`) as typeof readFileImpl;
    try {
      let caught: unknown;
      try {
        await migrate(url(db));
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      expect(String((caught as Error).cause)).toContain(secret);

      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      let printed: string;
      try {
        logMigrationFailure(caught);
        expect(spy).toHaveBeenCalledTimes(1);
        printed = format(...spy.mock.calls[0]!);
      } finally {
        spy.mockRestore();
      }
      expect(printed).toContain("0001_marker_probe.sql");
      expect(printed).not.toContain(secret);
    } finally {
      readdirImpl = originalReaddir;
      readFileImpl = originalReadFile;
      await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
    }
  }, 30_000);

  it("preserves its own safe static message in full in the CLI sink's actual output on a direct failure with no per-file cause", async () => {
    let caught: unknown;
    try {
      await migrate("");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);

    expect((caught as Error).cause).toBeUndefined();

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    let printed: string;
    try {
      logMigrationFailure(caught);
      expect(spy).toHaveBeenCalledTimes(1);
      printed = format(...spy.mock.calls[0]!);
    } finally {
      spy.mockRestore();
    }
    expect(printed).toContain("migrate: DATABASE_URL_MIGRATION is required (DDL-owner role)");
  }, 10_000);

  it("keeps the SQLSTATE off a real unwrapped error's actual output when it never reached a safeLogSummary throw site", async () => {
    const lowpriv = "plexco_migrate_sink_lowpriv";
    const target = "plexco_migrate_sink_target";
    await admin.query(`DROP ROLE IF EXISTS ${lowpriv}`);
    await admin.query(`DROP ROLE IF EXISTS ${target}`);
    await admin.query(`CREATE ROLE ${lowpriv} LOGIN NOSUPERUSER NOCREATEROLE PASSWORD 'x'`);
    const c = await connect(url(BASE_DB, lowpriv, "x"));
    try {
      let caught: unknown;
      try {
        await ensureRoleExists(c, target);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);

      expect((caught as Error).cause).toBeUndefined();
      expect((caught as { code?: string }).code).toBe("42501");

      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      let printed: string;
      try {
        logMigrationFailure(caught);
        expect(spy).toHaveBeenCalledTimes(1);
        printed = format(...spy.mock.calls[0]!);
      } finally {
        spy.mockRestore();
      }

      expect(printed).toContain("migrate: a migration step failed");
      expect(printed).not.toContain("42501");
    } finally {
      await c.end();
      await admin.query(`DROP ROLE IF EXISTS ${lowpriv}`);
      await admin.query(`DROP ROLE IF EXISTS ${target}`);
    }
  }, 60_000);

  it("keeps forged severity/routine/file/line off an ordinary Error out of the CLI sink's actual output", () => {
    const secret = "pii-marker-forged-field@example.com";
    const forged = new Error("synthetic failure");
    Object.assign(forged, { severity: secret, routine: secret, file: secret, line: secret });

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    let printed: string;
    try {
      logMigrationFailure(forged);
      expect(spy).toHaveBeenCalledTimes(1);
      printed = format(...spy.mock.calls[0]!);
    } finally {
      spy.mockRestore();
    }

    expect(printed).not.toContain(secret);
    expect(printed).not.toContain("severity=");
    expect(printed).not.toContain("routine=");
    expect(printed).not.toContain("file=");
    expect(printed).not.toContain("line=");
  });

  it("keeps forged severity/routine/file/line off an ordinary Error's .cause out of the CLI sink's actual output", () => {
    const secret = "pii-marker-forged-cause-field@example.com";
    const forgedCause = new Error("inner synthetic failure");
    Object.assign(forgedCause, { severity: secret, routine: secret, file: secret, line: secret });
    const wrapped = new Error("migrate: synthetic wrapper failure", { cause: forgedCause });

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    let printed: string;
    try {
      logMigrationFailure(wrapped);
      expect(spy).toHaveBeenCalledTimes(1);
      printed = format(...spy.mock.calls[0]!);
    } finally {
      spy.mockRestore();
    }

    expect(printed).not.toContain(secret);
    expect(printed).not.toContain("severity=");
    expect(printed).not.toContain("routine=");
    expect(printed).not.toContain("file=");
    expect(printed).not.toContain("line=");
  });

  it("keeps forged severity/routine/file/line off a directly constructed pg.DatabaseError out of the CLI sink's actual output", () => {
    const secret = "pii-marker-forged-database-error@example.com";
    const forged = new pg.DatabaseError("synthetic failure", 0, "error");
    Object.assign(forged, { severity: secret, routine: secret, file: secret, line: secret });

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    let printed: string;
    try {
      logMigrationFailure(forged);
      expect(spy).toHaveBeenCalledTimes(1);
      printed = format(...spy.mock.calls[0]!);
    } finally {
      spy.mockRestore();
    }

    expect(printed).not.toContain(secret);
    expect(printed).not.toContain("severity=");
    expect(printed).not.toContain("routine=");
    expect(printed).not.toContain("file=");
    expect(printed).not.toContain("line=");
  });

  it("keeps forged severity/routine/file/line off a directly constructed pg.DatabaseError's .cause out of the CLI sink's actual output", () => {
    const secret = "pii-marker-forged-database-error-cause@example.com";
    const forgedCause = new pg.DatabaseError("inner synthetic failure", 0, "error");
    Object.assign(forgedCause, { severity: secret, routine: secret, file: secret, line: secret });
    const wrapped = new Error("migrate: synthetic wrapper failure", { cause: forgedCause });

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    let printed: string;
    try {
      logMigrationFailure(wrapped);
      expect(spy).toHaveBeenCalledTimes(1);
      printed = format(...spy.mock.calls[0]!);
    } finally {
      spy.mockRestore();
    }

    expect(printed).not.toContain(secret);
    expect(printed).not.toContain("severity=");
    expect(printed).not.toContain("routine=");
    expect(printed).not.toContain("file=");
    expect(printed).not.toContain("line=");
  });

  it("keeps a Symbol recovered via Object.getOwnPropertySymbols from forging a different error's CLI sink output", async () => {
    const c = await connect(BASE!);
    let genuine: unknown;
    try {
      try {
        await ensureRoleExists(c, "app; DROP ROLE readonly");
      } catch (error) {
        genuine = error;
      }
    } finally {
      await c.end();
    }
    expect(genuine).toBeInstanceOf(Error);
    expect(Object.getOwnPropertySymbols(genuine as Error)).toHaveLength(0);

    const secret = "pii-marker-reflection-forged@example.com";
    const forged = new Error("unrelated synthetic failure");
    for (const sym of Object.getOwnPropertySymbols(genuine as Error)) {
      (forged as unknown as Record<symbol, unknown>)[sym] = secret;
    }

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    let printed: string;
    try {
      logMigrationFailure(forged);
      expect(spy).toHaveBeenCalledTimes(1);
      printed = format(...spy.mock.calls[0]!);
    } finally {
      spy.mockRestore();
    }
    expect(printed).not.toContain(secret);
    expect(printed).toContain("migrate: a migration step failed");
  });

  it("keeps a table/column/constraint value set via RAISE ... USING out of the CLI sink's actual output", async () => {
    const c = await connect(BASE!);
    const secret = "pii-diagnostic-field@example.com";
    try {
      let dbError: unknown;
      try {
        await c.query(
          `DO $$ BEGIN RAISE EXCEPTION USING MESSAGE = 'synthetic failure', TABLE = '${secret}'; END $$;`,
        );
      } catch (error) {
        dbError = error;
      }
      expect(dbError).toBeInstanceOf(Error);

      expect((dbError as { table?: string }).table).toBe(secret);
      expect((dbError as { code?: string }).code).toBe("P0001");

      expect((dbError as { routine?: string }).routine).toBe("exec_stmt_raise");

      const wrapped = new Error(
        `migrate: 0099_raise_using_probe.sql failed and was rolled back: ${String(dbError)}`,
        { cause: dbError },
      );

      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      let printed: string;
      try {
        logMigrationFailure(wrapped);
        expect(spy).toHaveBeenCalledTimes(1);
        printed = format(...spy.mock.calls[0]!);
      } finally {
        spy.mockRestore();
      }
      expect(printed).toContain("migrate: a migration step failed");
      expect(printed).not.toContain(secret);
    } finally {
      await c.end();
    }
  });

  it("keeps a name-shaped value set via RAISE ... USING ERRCODE out of the CLI sink's actual output", async () => {
    const c = await connect(BASE!);
    const secret = "ALICE";
    try {
      let dbError: unknown;
      try {
        await c.query(
          `DO $$ BEGIN RAISE EXCEPTION USING MESSAGE = 'synthetic failure', ERRCODE = '${secret}'; END $$;`,
        );
      } catch (error) {
        dbError = error;
      }
      expect(dbError).toBeInstanceOf(Error);

      expect((dbError as { code?: string }).code).toBe(secret);
      expect((dbError as { severity?: string }).severity).toBe("ERROR");

      const wrapped = new Error(
        `migrate: 0099_errcode_probe.sql failed and was rolled back: ${String(dbError)}`,
        { cause: dbError },
      );

      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      let printed: string;
      try {
        logMigrationFailure(wrapped);
        expect(spy).toHaveBeenCalledTimes(1);
        printed = format(...spy.mock.calls[0]!);
      } finally {
        spy.mockRestore();
      }
      expect(printed).toContain("migrate: a migration step failed");
      expect(printed).not.toContain(secret);
    } finally {
      await c.end();
    }
  });

  it("names its own site, with no path or interpolated value, on a readdir failure on the migrations directory", async () => {
    const originalReaddir = readdirImpl;
    readdirImpl = (async () => {
      throw Object.assign(
        new Error("ENOENT: no such file or directory, scandir '/private/probe'"),
        {
          code: "ENOENT",
          path: "/private/probe",
        },
      );
    }) as typeof readdirImpl;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    let printed: string;
    try {
      let caught: unknown;
      try {
        await migrate(BASE!);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).cause).toBeInstanceOf(Error);
      logMigrationFailure(caught);
      expect(spy).toHaveBeenCalledTimes(1);
      printed = format(...spy.mock.calls[0]!);
    } finally {
      readdirImpl = originalReaddir;
      spy.mockRestore();
    }
    expect(printed).toContain("failed to read the migrations directory");
    expect(printed).not.toContain("failed to read a migration file");
    expect(printed).not.toContain("/private/probe");
    expect(printed).not.toContain("ENOENT");
  });

  it("names its own site, with no path or interpolated value, on a readFile failure on a migration file", async () => {
    const originalReadFile = readFileImpl;
    readFileImpl = (async () => {
      throw Object.assign(
        new Error(
          "ENOENT: no such file or directory, open '/private/probe/0000_roles_extensions.sql'",
        ),
        { code: "ENOENT", path: "/private/probe/0000_roles_extensions.sql" },
      );
    }) as typeof readFileImpl;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    let printed: string;
    try {
      let caught: unknown;
      try {
        await migrate(BASE!);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).cause).toBeInstanceOf(Error);
      logMigrationFailure(caught);
      expect(spy).toHaveBeenCalledTimes(1);
      printed = format(...spy.mock.calls[0]!);
    } finally {
      readFileImpl = originalReadFile;
      spy.mockRestore();
    }
    expect(printed).toContain("failed to read a migration file");
    expect(printed).not.toContain("failed to read the migrations directory");
    expect(printed).not.toContain("0000_roles_extensions.sql");
    expect(printed).not.toContain("/private/probe");
    expect(printed).not.toContain("ENOENT");
  });

  function mockQuerySiteFailure(matchText: string, errorMessage: string) {
    const original = pg.Client.prototype.query;
    return vi.spyOn(pg.Client.prototype, "query").mockImplementation(function (
      this: pg.Client,
      ...args: unknown[]
    ) {
      const text = typeof args[0] === "string" ? args[0] : (args[0] as { text?: string })?.text;
      if (typeof text === "string" && text.includes(matchText)) {
        return Promise.reject(new Error(errorMessage));
      }
      return (original as (...a: unknown[]) => unknown).apply(this, args) as Promise<unknown>;
    });
  }

  const ALL_SITE_SUMMARIES = [
    "failed to connect to database",
    "failed to acquire the advisory lock",
    "failed to create the schema_migrations table",
    "failed to read the schema_migrations table",
    "failed to check for pre-provisioned runtime roles",
    "failed to count RLS policies after apply",
  ];

  async function expectOnlyOwnSummary(printed: string, ownSummary: string) {
    expect(printed).toContain(ownSummary);
    for (const other of ALL_SITE_SUMMARIES) {
      if (other !== ownSummary) expect(printed).not.toContain(other);
    }
  }

  it("names its own site, never the connection string, on a client.connect() failure", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    let printed: string;
    try {
      let caught: unknown;
      try {
        await migrate("postgres://plexco:wrongpass@127.0.0.1:1/nonexistent_probe_db");
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).cause).toBeInstanceOf(Error);
      logMigrationFailure(caught);
      expect(spy).toHaveBeenCalledTimes(1);
      printed = format(...spy.mock.calls[0]!);
    } finally {
      spy.mockRestore();
    }
    await expectOnlyOwnSummary(printed, "failed to connect to database");
    expect(printed).not.toContain("wrongpass");
    expect(printed).not.toContain("127.0.0.1:1");
    expect(printed).not.toContain("nonexistent_probe_db");
  });

  it("names its own site on a pg_advisory_lock failure", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const querySpy = mockQuerySiteFailure("pg_advisory_lock", "PROBE_LOCK_FAIL");
    let printed: string;
    try {
      let caught: unknown;
      try {
        await migrate(BASE!);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).cause).toBeInstanceOf(Error);
      logMigrationFailure(caught);
      expect(spy).toHaveBeenCalledTimes(1);
      printed = format(...spy.mock.calls[0]!);
    } finally {
      querySpy.mockRestore();
      spy.mockRestore();
    }
    await expectOnlyOwnSummary(printed, "failed to acquire the advisory lock");
    expect(printed).not.toContain("PROBE_LOCK_FAIL");
  });

  it("names its own site on a schema_migrations CREATE TABLE failure", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const querySpy = mockQuerySiteFailure(
      "CREATE TABLE IF NOT EXISTS schema_migrations",
      "PROBE_CREATE_FAIL",
    );
    let printed: string;
    try {
      let caught: unknown;
      try {
        await migrate(BASE!);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).cause).toBeInstanceOf(Error);
      logMigrationFailure(caught);
      expect(spy).toHaveBeenCalledTimes(1);
      printed = format(...spy.mock.calls[0]!);
    } finally {
      querySpy.mockRestore();
      spy.mockRestore();
    }
    await expectOnlyOwnSummary(printed, "failed to create the schema_migrations table");
    expect(printed).not.toContain("PROBE_CREATE_FAIL");
  });

  it("names its own site on a schema_migrations SELECT failure", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const querySpy = mockQuerySiteFailure(
      "SELECT name, sha256 FROM schema_migrations",
      "PROBE_SELECT_FAIL",
    );
    let printed: string;
    try {
      let caught: unknown;
      try {
        await migrate(BASE!);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).cause).toBeInstanceOf(Error);
      logMigrationFailure(caught);
      expect(spy).toHaveBeenCalledTimes(1);
      printed = format(...spy.mock.calls[0]!);
    } finally {
      querySpy.mockRestore();
      spy.mockRestore();
    }
    await expectOnlyOwnSummary(printed, "failed to read the schema_migrations table");
    expect(printed).not.toContain("PROBE_SELECT_FAIL");
  });

  it("names its own site on a pg_roles pre-check failure", async () => {
    const db = "plexco_migrate_sink_roles_precheck";
    await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${db}`);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const querySpy = mockQuerySiteFailure(
      "SELECT rolname FROM pg_roles WHERE rolname = ANY",
      "PROBE_ROLES_FAIL",
    );
    let printed: string;
    try {
      let caught: unknown;
      try {
        await migrate(url(db));
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).cause).toBeInstanceOf(Error);
      logMigrationFailure(caught);
      expect(spy).toHaveBeenCalledTimes(1);
      printed = format(...spy.mock.calls[0]!);
    } finally {
      querySpy.mockRestore();
      spy.mockRestore();
      await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
    }
    await expectOnlyOwnSummary(printed, "failed to check for pre-provisioned runtime roles");
    expect(printed).not.toContain("PROBE_ROLES_FAIL");
  });

  it("names its own site on a pg_policies count failure", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const querySpy = mockQuerySiteFailure(
      "SELECT count(*)::int AS n FROM pg_policies",
      "PROBE_POLICIES_FAIL",
    );
    let printed: string;
    try {
      let caught: unknown;
      try {
        await migrate(BASE!);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).cause).toBeInstanceOf(Error);
      logMigrationFailure(caught);
      expect(spy).toHaveBeenCalledTimes(1);
      printed = format(...spy.mock.calls[0]!);
    } finally {
      querySpy.mockRestore();
      spy.mockRestore();
    }
    await expectOnlyOwnSummary(printed, "failed to count RLS policies after apply");
    expect(printed).not.toContain("PROBE_POLICIES_FAIL");
  });
});

describe("job_definer bootstrap script itself fails closed on runtime-role targets", () => {
  it("refuses to grant job_definer to a runtime role passed as the migration_role target", async () => {
    await withJobDefinerLock(BASE!, async () => {
      const admin = await connect(BASE!);
      try {
        await bootstrapJobDefiner(admin);
        await admin.query(`SET job_definer_bootstrap.migration_role = 'readonly'`);
        try {
          await expect(bootstrapJobDefiner(admin)).rejects.toThrow(/runtime role/i);
        } finally {
          await admin.query(`RESET job_definer_bootstrap.migration_role`);
        }
        const granted = await admin.query(
          `SELECT 1 FROM pg_auth_members am
             JOIN pg_roles m ON m.oid = am.member
             JOIN pg_roles r ON r.oid = am.roleid
            WHERE r.rolname = 'job_definer' AND m.rolname = 'readonly'`,
        );
        expect(granted.rows.length).toBe(0);
      } finally {
        await admin.end();
      }
    });
  }, 30_000);

  it("refuses to proceed at all when job_definer is already granted to a runtime role beforehand", async () => {
    await withJobDefinerLock(BASE!, async () => {
      const admin = await connect(BASE!);
      try {
        await bootstrapJobDefiner(admin);
        await admin.query(`GRANT job_definer TO app_worker`);
        try {
          await expect(bootstrapJobDefiner(admin)).rejects.toThrow(/already granted/i);
        } finally {
          await admin.query(`REVOKE job_definer FROM app_worker`);
        }
      } finally {
        await admin.end();
      }
    });
  }, 30_000);

  it("pg_has_role on an absent role name raises rather than returning false — the exact hazard the fresh-cluster bootstrap must guard against", async () => {
    const admin = await connect(BASE!);
    try {
      const fakeRole = "zz_never_created_probe_role";
      await expect(
        admin.query(`SELECT pg_has_role('${fakeRole}', 'job_definer', 'MEMBER')`),
      ).rejects.toThrow(/does not exist/i);

      const guarded = await admin.query(
        `SELECT EXISTS (
           SELECT 1 FROM pg_roles WHERE rolname = $1 AND pg_has_role(rolname, 'job_definer', 'MEMBER')
         ) AS is_member`,
        [fakeRole],
      );
      expect((guarded.rows[0] as { is_member: boolean }).is_member).toBe(false);
    } finally {
      await admin.end();
    }
  }, 30_000);
});

const CHAT_DEFINER_BOOTSTRAP_SQL_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "infra",
  "postgres-init",
  "02-chat-definer.sql",
);

async function bootstrapChatDefiner(client: pg.Client): Promise<void> {
  const sql = await readFile(CHAT_DEFINER_BOOTSTRAP_SQL_PATH, "utf8");
  try {
    await client.query(sql);
  } catch (error) {
    // The file wraps itself in an explicit BEGIN/COMMIT (infra/postgres-init/02-chat-definer.sql),
    // so a rejection leaves that transaction open and aborted on `client` — mirrors
    // bootstrapJobDefiner's own catch-and-ROLLBACK idiom (test-harness.ts).
    await client.query("ROLLBACK");
    throw error;
  }
}

const CHAT_DEFINER_LOCK_KEY = 0x63686164; // "chad" — distinct from "jobd" (0x6a6f6264) and "plxc" (0x706c7863)

async function withChatDefinerLock<T>(base: string, fn: () => Promise<T>): Promise<T> {
  const lockClient = new pg.Client({ connectionString: base });
  await lockClient.connect();
  await lockClient.query("SELECT pg_advisory_lock($1)", [CHAT_DEFINER_LOCK_KEY]);
  try {
    return await fn();
  } finally {
    await lockClient
      .query("SELECT pg_advisory_unlock($1)", [CHAT_DEFINER_LOCK_KEY])
      .catch(() => {});
    await lockClient.end();
  }
}

async function hideRealChatDefiner(superuser: pg.Client, fn: () => Promise<void>): Promise<void> {
  const existing = await superuser.query(`SELECT 1 FROM pg_roles WHERE rolname = 'chat_definer'`);
  const hadRealRole = existing.rows.length > 0;
  if (hadRealRole) {
    await superuser.query(`ALTER ROLE chat_definer RENAME TO chat_definer_hidden_for_test`);
  }
  try {
    await fn();
  } finally {
    if (hadRealRole) {
      await superuser.query(`ALTER ROLE chat_definer_hidden_for_test RENAME TO chat_definer`);
    }
  }
}

async function chatDefinerMembers(client: pg.Client): Promise<string[]> {
  const result = await client.query(
    `SELECT r.rolname FROM pg_auth_members m
       JOIN pg_roles r ON r.oid = m.member
       JOIN pg_roles g ON g.oid = m.roleid
      WHERE g.rolname = 'chat_definer'`,
  );
  return (result.rows as { rolname: string }[]).map((r) => r.rolname).sort();
}

describe("chat_definer bootstrap script bootstraps idempotently and fails closed on invalid grant targets", () => {
  it("first bootstrap with no migration role set grants membership to CURRENT_USER", async () => {
    await withChatDefinerLock(BASE!, () =>
      hideRealChatDefiner(admin, async () => {
        await bootstrapChatDefiner(admin);
        const whoami = await admin.query(`SELECT current_user AS u`);
        expect(await chatDefinerMembers(admin)).toEqual([(whoami.rows[0] as { u: string }).u]);
        await admin.query(`DROP ROLE chat_definer`);
      }),
    );
  }, 30_000);

  it("first bootstrap with the migration role GUC explicitly set to an empty string grants membership to CURRENT_USER", async () => {
    // package.json's db:bootstrap always issues `SET chat_definer_bootstrap.migration_role = '$mr'`,
    // where $mr is "" when MIGRATION_ROLE is unset — the GUC is explicitly set to an empty string on
    // every real invocation, never left fully unset. NULLIF('', '') must collapse this to the same
    // CURRENT_USER fallback as the fully-unset case (contract SS8, Boundary row), a distinct code path
    // from the previous test (current_setting(..., true) returning NULL vs. returning '').
    await withChatDefinerLock(BASE!, () =>
      hideRealChatDefiner(admin, async () => {
        await admin.query(`SET chat_definer_bootstrap.migration_role = ''`);
        try {
          await bootstrapChatDefiner(admin);
        } finally {
          await admin.query(`RESET chat_definer_bootstrap.migration_role`);
        }
        const whoami = await admin.query(`SELECT current_user AS u`);
        expect(await chatDefinerMembers(admin)).toEqual([(whoami.rows[0] as { u: string }).u]);
        await admin.query(`DROP ROLE chat_definer`);
      }),
    );
  }, 30_000);

  it("first bootstrap with an explicit valid migration role grants membership to that role, not CURRENT_USER", async () => {
    await withChatDefinerLock(BASE!, () =>
      hideRealChatDefiner(admin, async () => {
        const target = "plexco_chat_definer_test_target_a";
        await admin.query(
          `DO $$ BEGIN CREATE ROLE ${target}; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
        );
        try {
          await admin.query(`SET chat_definer_bootstrap.migration_role = '${target}'`);
          try {
            await bootstrapChatDefiner(admin);
          } finally {
            await admin.query(`RESET chat_definer_bootstrap.migration_role`);
          }
          expect(await chatDefinerMembers(admin)).toEqual([target]);
          await admin.query(`DROP ROLE chat_definer`);
        } finally {
          await admin.query(`DROP ROLE ${target}`);
        }
      }),
    );
  }, 30_000);

  it("exact replay is a no-op", async () => {
    await withChatDefinerLock(BASE!, () =>
      hideRealChatDefiner(admin, async () => {
        await bootstrapChatDefiner(admin);
        const before = await admin.query(
          `SELECT rolsuper, rolcanlogin, rolbypassrls, rolcreatedb, rolcreaterole, rolinherit, rolreplication
             FROM pg_roles WHERE rolname = 'chat_definer'`,
        );
        // Explicit values, not just before==after — a bug that flipped e.g. rolbypassrls on BOTH
        // calls identically would still pass a bare equality check (codex round-01 [P2]).
        expect(before.rows).toEqual([
          {
            rolsuper: false,
            rolcanlogin: false,
            rolbypassrls: true,
            rolcreatedb: false,
            rolcreaterole: false,
            rolinherit: false,
            rolreplication: false,
          },
        ]);
        const membersBefore = await chatDefinerMembers(admin);
        await bootstrapChatDefiner(admin);
        const after = await admin.query(
          `SELECT rolsuper, rolcanlogin, rolbypassrls, rolcreatedb, rolcreaterole, rolinherit, rolreplication
             FROM pg_roles WHERE rolname = 'chat_definer'`,
        );
        expect(after.rows).toEqual(before.rows);
        expect(await chatDefinerMembers(admin)).toEqual(membersBefore);
        await admin.query(`DROP ROLE chat_definer`);
      }),
    );
  }, 30_000);

  // Two isolated cases, not one combined case (codex round-02 [P2]): the SQL guard is
  // `v_existing_admin OR NOT v_existing_set` — a single test that sets BOTH options unsafely at once
  // would still pass even if either half of that OR regressed away, since the other half alone still
  // rejects. Each case below leaves the OTHER option at its own safe bare-GRANT default (ADMIN=false,
  // SET=true — postgresql.org/docs/16/sql-grant.html) so only ONE guard clause can possibly be the
  // reason for the rejection.
  it("refuses to bootstrap when the existing membership for the target has ADMIN TRUE (SET left at its safe default)", async () => {
    await withChatDefinerLock(BASE!, () =>
      hideRealChatDefiner(admin, async () => {
        await bootstrapChatDefiner(admin);
        const whoami = await admin.query(`SELECT current_user AS u`);
        const target = (whoami.rows[0] as { u: string }).u;
        // Simulate an out-of-band GRANT issued directly against the cluster, outside this script —
        // PG16 retains ADMIN/SET options across a bare re-GRANT ("the omission of an option results
        // in the current value being retained"), so this script's own idempotent bare GRANT would
        // otherwise silently leave a unilaterally-set unsafe option in place.
        await admin.query(`GRANT chat_definer TO ${target} WITH ADMIN TRUE`);
        try {
          await expect(bootstrapChatDefiner(admin)).rejects.toThrow(/unsafe options/i);
        } finally {
          await admin.query(`REVOKE chat_definer FROM ${target}`);
        }
        await admin.query(`DROP ROLE chat_definer`);
      }),
    );
  }, 30_000);

  it("refuses to bootstrap when the existing membership for the target has SET FALSE (ADMIN left at its safe default)", async () => {
    await withChatDefinerLock(BASE!, () =>
      hideRealChatDefiner(admin, async () => {
        await bootstrapChatDefiner(admin);
        const whoami = await admin.query(`SELECT current_user AS u`);
        const target = (whoami.rows[0] as { u: string }).u;
        await admin.query(`GRANT chat_definer TO ${target} WITH SET FALSE`);
        try {
          await expect(bootstrapChatDefiner(admin)).rejects.toThrow(/unsafe options/i);
        } finally {
          await admin.query(`REVOKE chat_definer FROM ${target}`);
        }
        await admin.query(`DROP ROLE chat_definer`);
      }),
    );
  }, 30_000);

  it("refuses to bootstrap when chat_definer already exists with a wrong attribute", async () => {
    await withChatDefinerLock(BASE!, () =>
      hideRealChatDefiner(admin, async () => {
        await admin.query(
          `CREATE ROLE chat_definer LOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION`,
        );
        try {
          await expect(bootstrapChatDefiner(admin)).rejects.toThrow(/unexpected attributes/i);
          expect(await chatDefinerMembers(admin)).toEqual([]);
          const attrs = await admin.query(
            `SELECT rolcanlogin FROM pg_roles WHERE rolname = 'chat_definer'`,
          );
          expect((attrs.rows[0] as { rolcanlogin: boolean }).rolcanlogin).toBe(true);
        } finally {
          await admin.query(`DROP ROLE chat_definer`);
        }
      }),
    );
  }, 30_000);

  it("refuses to grant chat_definer to a runtime role passed as the migration_role target", async () => {
    await withChatDefinerLock(BASE!, () =>
      hideRealChatDefiner(admin, async () => {
        await bootstrapChatDefiner(admin);
        await admin.query(`SET chat_definer_bootstrap.migration_role = 'readonly'`);
        try {
          await expect(bootstrapChatDefiner(admin)).rejects.toThrow(/runtime role/i);
        } finally {
          await admin.query(`RESET chat_definer_bootstrap.migration_role`);
        }
        const granted = await admin.query(
          `SELECT 1 FROM pg_auth_members am
             JOIN pg_roles m ON m.oid = am.member
             JOIN pg_roles r ON r.oid = am.roleid
            WHERE r.rolname = 'chat_definer' AND m.rolname = 'readonly'`,
        );
        expect(granted.rows.length).toBe(0);
        await admin.query(`DROP ROLE chat_definer`);
      }),
    );
  }, 30_000);

  it("refuses to proceed at all when chat_definer is already granted to a runtime role beforehand", async () => {
    await withChatDefinerLock(BASE!, () =>
      hideRealChatDefiner(admin, async () => {
        await bootstrapChatDefiner(admin);
        await admin.query(`GRANT chat_definer TO app_worker`);
        try {
          await expect(bootstrapChatDefiner(admin)).rejects.toThrow(/already granted/i);
        } finally {
          await admin.query(`REVOKE chat_definer FROM app_worker`);
        }
        await admin.query(`DROP ROLE chat_definer`);
      }),
    );
  }, 30_000);

  it("refuses when the migration role target is a non-runtime group a runtime role already belongs to (indirect BYPASSRLS path)", async () => {
    await withChatDefinerLock(BASE!, () =>
      hideRealChatDefiner(admin, async () => {
        const group = "plexco_chat_definer_test_indirect_group";
        await admin.query(
          `DO $$ BEGIN CREATE ROLE ${group}; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
        );
        await admin.query(`GRANT ${group} TO readonly`);
        try {
          await admin.query(`SET chat_definer_bootstrap.migration_role = '${group}'`);
          try {
            // The pre-grant checks see no DIRECT chat_definer membership for `readonly` or `${group}`
            // (correct — neither has one yet), so only the POST-grant transitive recheck can catch
            // this: granting chat_definer to ${group} would give `readonly` a brand-new indirect path
            // (readonly -> ${group} -> chat_definer, BYPASSRLS) that did not exist before this call.
            await expect(bootstrapChatDefiner(admin)).rejects.toThrow(/indirect path/i);
          } finally {
            await admin.query(`RESET chat_definer_bootstrap.migration_role`);
          }
          // Whole transaction — including the triggering GRANT — rolled back atomically (contract
          // SS8, Failure row): no inert chat_definer role, and ${group} never became a member.
          const roleExists = await admin.query(
            `SELECT 1 FROM pg_roles WHERE rolname = 'chat_definer'`,
          );
          expect(roleExists.rows.length).toBe(0);
        } finally {
          await admin.query(`REVOKE ${group} FROM readonly`);
          await admin.query(`DROP ROLE ${group}`);
        }
      }),
    );
  }, 30_000);

  it("refuses to bootstrap when the migration role does not exist", async () => {
    await withChatDefinerLock(BASE!, () =>
      hideRealChatDefiner(admin, async () => {
        await admin.query(
          `SET chat_definer_bootstrap.migration_role = 'zz_chat_definer_never_created_role'`,
        );
        try {
          await expect(bootstrapChatDefiner(admin)).rejects.toThrow(/does not exist/i);
        } finally {
          await admin.query(`RESET chat_definer_bootstrap.migration_role`);
        }
        // The whole file is one transaction: the rejection at the grant-target check rolls back
        // the earlier CREATE too, so no inert leftover role survives (contract SS8, Failure row).
        const roleExists = await admin.query(
          `SELECT 1 FROM pg_roles WHERE rolname = 'chat_definer'`,
        );
        expect(roleExists.rows.length).toBe(0);
      }),
    );
  }, 30_000);

  it("refuses to re-point when chat_definer is already granted to a different valid migration role", async () => {
    await withChatDefinerLock(BASE!, () =>
      hideRealChatDefiner(admin, async () => {
        const roleA = "plexco_chat_definer_test_repoint_a";
        const roleB = "plexco_chat_definer_test_repoint_b";
        await admin.query(
          `DO $$ BEGIN CREATE ROLE ${roleA}; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
        );
        await admin.query(
          `DO $$ BEGIN CREATE ROLE ${roleB}; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
        );
        try {
          await admin.query(`SET chat_definer_bootstrap.migration_role = '${roleA}'`);
          try {
            await bootstrapChatDefiner(admin);
          } finally {
            await admin.query(`RESET chat_definer_bootstrap.migration_role`);
          }
          await admin.query(`SET chat_definer_bootstrap.migration_role = '${roleB}'`);
          try {
            await expect(bootstrapChatDefiner(admin)).rejects.toThrow(/already granted to/i);
          } finally {
            await admin.query(`RESET chat_definer_bootstrap.migration_role`);
          }
          expect(await chatDefinerMembers(admin)).toEqual([roleA]);
          await admin.query(`DROP ROLE chat_definer`);
        } finally {
          await admin.query(`DROP ROLE ${roleA}`);
          await admin.query(`DROP ROLE ${roleB}`);
        }
      }),
    );
  }, 30_000);

  it("N concurrent bootstrap calls against a fresh cluster all succeed; role exists exactly once with exactly one membership grant", async () => {
    await withChatDefinerLock(BASE!, () =>
      hideRealChatDefiner(admin, async () => {
        const N = 8;
        const clients = await Promise.all(Array.from({ length: N }, () => connect(BASE!)));
        try {
          const results = await Promise.allSettled(clients.map((c) => bootstrapChatDefiner(c)));
          const rejected = results.filter((r) => r.status === "rejected");
          expect(
            rejected,
            `no concurrent bootstrap call should fail: ${rejected
              .map((r) => String((r as PromiseRejectedResult).reason))
              .join(" | ")}`,
          ).toEqual([]);
          expect(await roleCount(admin, "chat_definer")).toBe(1);
          expect(await chatDefinerMembers(admin)).toHaveLength(1);
        } finally {
          await Promise.all(clients.map((c) => c.end()));
        }
        await admin.query(`DROP ROLE chat_definer`);
      }),
    );
  }, 60_000);
});

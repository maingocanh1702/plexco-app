import pg from "pg";
import { migrate, type MigrateResult } from "./migrate.js";
import { createDb, type DbHandle } from "./client.js";

/**
 * RLS invariant-test harness.
 *
 * Needs DATABASE_URL_TEST = a SUPERUSER url on a THROWAWAY cluster (CI service
 * container / local compose postgres). The harness:
 *   1. drops + recreates a dedicated database (never touches the url's own db),
 *   2. runs the real migration runner against it (0000..0011),
 *   3. gives the cluster-global runtime roles passwords so tests can connect
 *      AS app/readonly — proving RLS/grants from the runtime roles' seats,
 *      never from superuser (FORCE RLS is meaningless to a superuser),
 *   4. seeds two tenants via the owner connection (tenant provisioning is an
 *      auth-slice concern; tests only need two isolated tenants to exist).
 */

const TEST_DB = "plexco_rls_check";
const ROLE_PW: Record<string, string> = {
  app: "plexco_test_app",
  app_worker: "plexco_test_worker",
  readonly: "plexco_test_readonly",
};

export interface RlsTestContext {
  /** superuser/owner connection INTO the test db (setup + assertions only) */
  owner: pg.Client;
  appDb: DbHandle;
  appPool: pg.Pool;
  readonlyPool: pg.Pool;
  tenantA: string;
  tenantB: string;
  badmintonSportId: string;
  migrateResult: MigrateResult;
  /** re-run the runner against the same db (idempotency assertions) */
  remigrate: () => Promise<MigrateResult>;
  teardown: () => Promise<void>;
}

function testUrl(base: string, opts: { db?: string; user?: string; password?: string }): string {
  const url = new URL(base);
  if (opts.db) url.pathname = `/${opts.db}`;
  if (opts.user) {
    url.username = opts.user;
    url.password = opts.password ?? "";
  }
  return url.toString();
}

export async function setupRlsTestContext(): Promise<RlsTestContext> {
  const base = process.env.DATABASE_URL_TEST;
  if (!base) {
    throw new Error(
      "DATABASE_URL_TEST is required for the RLS invariant suite (CI sets it; " +
        "locally: docker compose -f infra/docker-compose.yml up -d postgres and " +
        "export DATABASE_URL_TEST=postgres://plexco:plexco_dev@localhost:5432/plexco)",
    );
  }

  // 1. fresh database
  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  // 3. runtime roles get passwords (cluster-global, idempotent)
  for (const [role, pw] of Object.entries(ROLE_PW)) {
    await admin.query(`ALTER ROLE ${role} WITH LOGIN PASSWORD '${pw}'`).catch(async (e) => {
      // role missing = migrations never ran on this cluster; 0000 creates it below
      if (!String(e).includes("does not exist")) throw e;
    });
  }
  await admin.end();

  // 2. real runner against the fresh db
  const migrationUrl = testUrl(base, { db: TEST_DB });
  const migrateResult = await migrate(migrationUrl);

  // roles now certainly exist (0000) — ensure passwords
  const owner = new pg.Client({ connectionString: migrationUrl });
  await owner.connect();
  for (const [role, pw] of Object.entries(ROLE_PW)) {
    await owner.query(`ALTER ROLE ${role} WITH LOGIN PASSWORD '${pw}'`);
  }

  // 4. two tenants + resolve a seeded sport
  const tenants = await owner.query(
    `INSERT INTO tenants (name, slug, status) VALUES
       ('RLS Test Club A', 'rls-test-a', 'active'),
       ('RLS Test Club B', 'rls-test-b', 'active')
     RETURNING id`,
  );
  const sport = await owner.query(`SELECT id FROM sports WHERE key = 'badminton'`);

  const appUrl = testUrl(base, { db: TEST_DB, user: "app", password: ROLE_PW.app });
  const readonlyUrl = testUrl(base, { db: TEST_DB, user: "readonly", password: ROLE_PW.readonly });
  const appDb = createDb(appUrl, { max: 4 });
  const readonlyPool = new pg.Pool({ connectionString: readonlyUrl, max: 2 });

  return {
    owner,
    appDb,
    appPool: appDb.pool,
    readonlyPool,
    tenantA: (tenants.rows[0] as { id: string }).id,
    tenantB: (tenants.rows[1] as { id: string }).id,
    badmintonSportId: (sport.rows[0] as { id: string }).id,
    migrateResult,
    remigrate: () => migrate(migrationUrl),
    teardown: async () => {
      await appDb.close();
      await readonlyPool.end();
      await owner.end();
    },
  };
}

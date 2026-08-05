import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { expect } from "vitest";
import { migrate, type MigrateResult } from "./migrate.js";
import { createDb, type DbHandle } from "./client.js";

/**
 * Assert a rejection whose message appears ANYWHERE in the error's cause chain.
 *
 * Required for anything routed through drizzle (withTenant/tenantRepo): drizzle
 * re-throws as `Failed query: <sql>` and hangs the real pg error — the one
 * carrying "new row violates row-level security policy" — off `.cause`. A plain
 * `rejects.toThrow(/row-level security/)` therefore FAILS on a correctly
 * rejecting query, which reads as a missing RLS policy and is the exact wrong
 * conclusion to draw. Raw ctx.appPool queries need no chain walk, but using this
 * everywhere keeps one habit instead of two.
 */
export async function expectErrorChainToMatch(promise: Promise<unknown>, pattern: RegExp) {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(Error);
  const messages: string[] = [];
  const seen = new Set<Error>();
  let current = caught;
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    messages.push(current.message);
    current = current.cause;
  }
  expect(messages.join("\n")).toMatch(pattern);
}

/**
 * RLS invariant-test harness.
 *
 * Needs DATABASE_URL_TEST = a SUPERUSER url on a THROWAWAY cluster (CI service
 * container / local compose postgres). The harness:
 *   1. drops + recreates a dedicated database (never touches the url's own db),
 *   2. runs the real migration runner against it (current baseline 0000..0014),
 *   3. gives the cluster-global runtime roles passwords so tests can connect
 *      AS app/readonly — proving RLS/grants from the runtime roles' seats,
 *      never from superuser (FORCE RLS is meaningless to a superuser),
 *   4. seeds two tenants via the owner connection (tenant provisioning is an
 *      auth-slice concern; tests only need two isolated tenants to exist).
 */

const ROLE_PW: Record<string, string> = {
  app: "plexco_test_app",
  app_worker: "plexco_test_worker",
  readonly: "plexco_test_readonly",
};

/**
 * Canonical job_definer bootstrap (DD-89/DD-90 Q5) — the SAME file `pnpm db:bootstrap` and the
 * compose init mount apply, read once and executed here so tests never duplicate its idempotent/
 * race-safe role-creation logic. The 0022 migration only ASSERTS job_definer; it never creates it,
 * so every test path that reaches 0022 must bootstrap first, exactly like production/CI must.
 */
const JOB_DEFINER_BOOTSTRAP_SQL_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "infra",
  "postgres-init",
  "01-job-definer.sql",
);

export async function bootstrapJobDefiner(client: pg.Client): Promise<void> {
  const sql = await readFile(JOB_DEFINER_BOOTSTRAP_SQL_PATH, "utf8");
  try {
    await client.query(sql);
  } catch (error) {
    // The file wraps itself in an explicit BEGIN/COMMIT (infra/postgres-init/01-job-definer.sql),
    // so a rejection (e.g. codex round-08's runtime-role denylist) leaves that transaction open
    // and aborted on `client` — every later query on the same connection would fail with "current
    // transaction is aborted" otherwise. Mirrors migrate.ts's own catch-and-ROLLBACK idiom.
    await client.query("ROLLBACK");
    throw error;
  }
}

/**
 * Canonical chat_definer bootstrap (chat-definer-role-provisioning, merged 286f48b) — mirrors
 * bootstrapJobDefiner exactly, same reason: chat-dm-safety-authority-core's migration 0030 is the
 * first to ALTER FUNCTION ... OWNER TO chat_definer, which mechanically requires the migration role
 * to already be a member of chat_definer (PostgreSQL: "you must be able to SET ROLE to the new
 * owning role"). Every test path whose migration reaches 0030 under a non-superuser role must
 * bootstrap first, exactly like production/CI must (added 2026-08-05, owner-authorized scope
 * amendment — see docs/autopilot-chat-dm-safety-authority-core.md SS6.3/SS8).
 */
const CHAT_DEFINER_BOOTSTRAP_SQL_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "infra",
  "postgres-init",
  "02-chat-definer.sql",
);

export async function bootstrapChatDefiner(client: pg.Client): Promise<void> {
  const sql = await readFile(CHAT_DEFINER_BOOTSTRAP_SQL_PATH, "utf8");
  try {
    await client.query(sql);
  } catch (error) {
    // Same reasoning as bootstrapJobDefiner: 02-chat-definer.sql wraps itself in an explicit
    // BEGIN/COMMIT, so a rejection leaves that transaction open and aborted on `client`.
    await client.query("ROLLBACK");
    throw error;
  }
}

/**
 * Unlike job_definer's own bootstrap (01-job-definer.sql's re-run guard only refuses a RUNTIME-role
 * re-target, so a different non-runtime target silently ACCUMULATES as an additional member),
 * chat_definer's bootstrap (02-chat-definer.sql, chat-definer-role-provisioning, merged) explicitly
 * REFUSES to grant a second, different non-runtime member — intentional, reviewed, fail-closed
 * design; not a bug and not this slice's to change. That means bootstrapChatDefiner alone cannot be
 * called for a NEW target once ANY other role already holds membership (e.g. `plexco`, granted by
 * this repo's own `pnpm db:bootstrap`/CI step, which falls back to CURRENT_USER when MIGRATION_ROLE
 * is unset — the common case). This helper clears that path the same way an operator would per the
 * script's own error text ("revoke the existing membership first if this is an intentional
 * re-point") before calling bootstrapChatDefiner for a DIFFERENT target — safe in a test context
 * (every prior target is either a superuser needing no membership to function, or a scratch role
 * this run created and will drop at teardown) and a no-op when chat_definer does not exist yet or
 * already points at `keepTarget` (added 2026-08-05, owner-authorized scope amendment).
 */
export async function revokeStaleChatDefinerMembership(
  client: pg.Client,
  keepTarget: string,
): Promise<void> {
  const { rows } = await client.query(
    `SELECT r.rolname FROM pg_auth_members m
       JOIN pg_roles r ON r.oid = m.member
       JOIN pg_roles g ON g.oid = m.roleid
      WHERE g.rolname = 'chat_definer' AND r.rolname <> $1`,
    [keepTarget],
  );
  for (const { rolname } of rows as { rolname: string }[]) {
    // Quoted via pg's own escapeIdentifier (codex round-01 [P2]) rather than this file's usual
    // plain interpolation (e.g. DROP ROLE IF EXISTS ${ownerRole} elsewhere, always a literal
    // this file itself just chose) — rolname here is catalog-sourced, so a role created with a
    // quoted identifier containing a space/quote/statement terminator would otherwise break or
    // misparse the REVOKE statement.
    await client.query(`REVOKE chat_definer FROM ${client.escapeIdentifier(rolname)}`);
  }
}

/**
 * chat_definer is CLUSTER-global, same hazard withJobDefinerLock documents for job_definer: a test
 * that deliberately puts it into a BROKEN/hidden state (migrate.test.ts's own bootstrap-script
 * negative-path tests) races every OTHER parallel test FILE's own ordinary bootstrap+migrate call.
 * Moved here from migrate.test.ts (2026-08-05, owner-authorized scope amendment) so it can be
 * shared cross-file, exactly like withJobDefinerLock already is — chat-dm-safety-authority-core's
 * migration 0030 is the first NON-migrate.test.ts caller (rls-invariants.test.ts's JCL-1, via
 * setupNonSuperuserOwnerContext's bootstrapChatDefinerForOwner) to need this same protection;
 * leaving the lock stranded as a local, non-exported function in migrate.test.ts would have left
 * that caller with no way to synchronize against migrate.test.ts's own hiding tests.
 */
const CHAT_DEFINER_LOCK_KEY = 0x63686164; // "chad" — distinct from "jobd" (0x6a6f6264) and "plxc" (0x706c7863)

export async function withChatDefinerLock<T>(base: string, fn: () => Promise<T>): Promise<T> {
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

/**
 * job_definer is CLUSTER-global, so a test that deliberately puts it into a BROKEN state (JCL-2:
 * absent / wrong attributes) races every OTHER parallel test FILE's own bootstrap+migrate — the
 * same class of hazard BR-1 documents for app/app_worker/readonly, except those tests dodge it by
 * never touching the shared roles at all (migrate.test.ts:24-25). job_definer's negative-path
 * proofs have no such option (they must actually break it), so this advisory lock makes "must be
 * correct" (every bootstrap+migrate call) and "deliberately broken for one assertion" (the JCL-2/3
 * negative tests) mutually exclusive: whichever side holds the lock, the other blocks until it's
 * released, so the two windows can never overlap. A leftover ABSENT role self-heals (the next
 * lock-holder's bootstrap recreates it) — a leftover WRONG-ATTRIBUTE role does NOT (bootstrap
 * fails closed on drift instead of silently fixing it), so every caller that intentionally
 * corrupts the attributes MUST drop the role again before releasing the lock.
 */
const JOB_DEFINER_LOCK_KEY = 0x6a6f6264; // "jobd"

export async function withJobDefinerLock<T>(base: string, fn: () => Promise<T>): Promise<T> {
  const lockClient = new pg.Client({ connectionString: base });
  await lockClient.connect();
  await lockClient.query("SELECT pg_advisory_lock($1)", [JOB_DEFINER_LOCK_KEY]);
  try {
    return await fn();
  } finally {
    await lockClient.query("SELECT pg_advisory_unlock($1)", [JOB_DEFINER_LOCK_KEY]).catch(() => {});
    await lockClient.end();
  }
}

export interface RlsTestContext {
  /** superuser/owner connection INTO the test db (setup + assertions only) */
  owner: pg.Client;
  appDb: DbHandle;
  appPool: pg.Pool;
  readonlyPool: pg.Pool;
  /** narrow app_worker seat — the real caller identity for every job_definer function (JCL-5..12) */
  workerPool: pg.Pool;
  /** superuser-backed drizzle handle — for proving a query fails closed even when RLS is bypassed */
  superuserDb: DbHandle;
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

/**
 * Set a cluster-global role's password, race-tolerant so the DB suites can run
 * as parallel vitest workers (fileParallelism:true). Two independent races:
 *   - on a cold cluster the role may not exist yet when the PRE-migrate call
 *     runs (migrate() creates it moments later) — tolerated when allowMissing;
 *   - several suites ALTER the SAME cluster-global role at the same instant,
 *     which Postgres reports as "tuple concurrently updated" (a transient
 *     catalog-write conflict on the shared pg_authid row). Every suite sets the
 *     identical static password, so retrying always converges on that value.
 */
async function setRolePasswordRaceSafe(
  client: pg.Client,
  role: string,
  password: string,
  allowMissing: boolean,
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await client.query(`ALTER ROLE ${role} WITH LOGIN PASSWORD '${password}'`);
      return;
    } catch (e) {
      const msg = String(e);
      if (allowMissing && msg.includes("does not exist")) return;
      if (msg.includes("tuple concurrently updated") && attempt < 10) {
        await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
        continue;
      }
      throw e;
    }
  }
}

/**
 * @param dbName Dedicated throwaway database for THIS test file. Vitest runs
 *   test files in parallel by default; every caller MUST pass a name unique
 *   to its own suite (codex round-02) — two suites sharing one name would
 *   race their DROP/CREATE DATABASE against each other and could terminate
 *   or wipe a sibling suite mid-run.
 */
export async function setupRlsTestContext(dbName: string): Promise<RlsTestContext> {
  const base = process.env.DATABASE_URL_TEST;
  if (!base) {
    throw new Error(
      "DATABASE_URL_TEST is required for the RLS invariant suite (CI sets it; " +
        "locally: docker compose -f infra/docker-compose.yml up -d postgres and " +
        "export DATABASE_URL_TEST=postgres://plexco:plexco_dev@localhost:5432/plexco_test)",
    );
  }

  // 1. fresh database
  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${dbName}`);
  // 3. runtime roles get passwords (cluster-global, idempotent, race-tolerant).
  //    role missing = migrations never ran on this cluster; migrate() creates it below.
  for (const [role, pw] of Object.entries(ROLE_PW)) {
    await setRolePasswordRaceSafe(admin, role, pw, /* allowMissing */ true);
  }

  // 2. real runner against the fresh db. job_definer is cluster-global and must exist (correctly)
  // before migrate() reaches 0022 (which only asserts it, never creates it) — bootstrap+migrate
  // run under the lock so this can never overlap a sibling file's own bootstrap+migrate with the
  // JCL-2/3 negative tests' deliberately-broken window (see withJobDefinerLock).
  const migrationUrl = testUrl(base, { db: dbName });
  const migrateResult = await withJobDefinerLock(base, async () => {
    await bootstrapJobDefiner(admin);
    return migrate(migrationUrl);
  });
  await admin.end();

  // roles now certainly exist (ensured by the runner + 0000) — set passwords
  const owner = new pg.Client({ connectionString: migrationUrl });
  await owner.connect();
  for (const [role, pw] of Object.entries(ROLE_PW)) {
    await setRolePasswordRaceSafe(owner, role, pw, /* allowMissing */ false);
  }

  // 4. two tenants + resolve a seeded sport
  const tenants = await owner.query(
    `INSERT INTO tenants (name, slug, status) VALUES
       ('RLS Test Club A', 'rls-test-a', 'active'),
       ('RLS Test Club B', 'rls-test-b', 'active')
     RETURNING id`,
  );
  const sport = await owner.query(`SELECT id FROM sports WHERE key = 'badminton'`);

  const appUrl = testUrl(base, { db: dbName, user: "app", password: ROLE_PW.app });
  const readonlyUrl = testUrl(base, { db: dbName, user: "readonly", password: ROLE_PW.readonly });
  const workerUrl = testUrl(base, { db: dbName, user: "app_worker", password: ROLE_PW.app_worker });
  const appDb = createDb(appUrl, { max: 4 });
  const readonlyPool = new pg.Pool({ connectionString: readonlyUrl, max: 2 });
  const workerPool = new pg.Pool({ connectionString: workerUrl, max: 4 });
  const superuserDb = createDb(migrationUrl, { max: 2 });

  return {
    owner,
    appDb,
    appPool: appDb.pool,
    readonlyPool,
    workerPool,
    superuserDb,
    tenantA: (tenants.rows[0] as { id: string }).id,
    tenantB: (tenants.rows[1] as { id: string }).id,
    badmintonSportId: (sport.rows[0] as { id: string }).id,
    migrateResult,
    remigrate: () => migrate(migrationUrl),
    teardown: async () => {
      await appDb.close();
      await readonlyPool.end();
      await workerPool.end();
      await superuserDb.close();
      await owner.end();
    },
  };
}

const NONSUPER_OWNER_PW = "plexco_test_nonsuper_owner";

export interface NonSuperuserOwnerContext {
  dbName: string;
  ownerRole: string;
  /** superuser connection — for constructing job_definer preconditions (bootstrap via a role
   *  OTHER than ownerRole for JCL-3, or a deliberately wrong-attribute role for JCL-2) before
   *  calling runMigration(). Never used to run the migration itself — that must be `ownerPool`/
   *  `runMigration`, or the whole point (a genuinely non-superuser DDL owner) is lost. */
  superuser: pg.Client;
  /** non-superuser DDL-owner connection — owns every 0000..0022 object created via runMigration() */
  ownerPool: pg.Pool;
  /** idempotent job_definer bootstrap (grants membership to ownerRole) — call before runMigration()
   *  for the happy path; withhold for JCL-2 (role absent). NOT internally lock-protected: both this
   *  AND the runMigration() call that follows it reference job_definer BY NAME (bootstrap/grant here;
   *  the 0022 assertion + ownership transfers there), so the CALLER must wrap the whole
   *  "bootstrapJobDefinerForOwner() then runMigration()" sequence in ONE withJobDefinerLock — wrapping
   *  each call separately leaves a gap between them, and locking inside both would deadlock a caller
   *  that already holds the lock. */
  bootstrapJobDefinerForOwner: () => Promise<void>;
  /** idempotent chat_definer bootstrap (grants membership to ownerRole) — call before runMigration()
   *  whenever the migration will reach 0030 (chat-dm-safety-authority-core) or later under a
   *  non-superuser role. Same NOT-internally-lock-protected caveat as bootstrapJobDefinerForOwner:
   *  the caller must wrap the whole "bootstrap...ForOwner() then runMigration()" sequence in ONE
   *  withJobDefinerLock (added 2026-08-05, mirrors bootstrapJobDefinerForOwner exactly). */
  bootstrapChatDefinerForOwner: () => Promise<void>;
  /** run the real migration runner AS the non-superuser owner (never superuser) */
  runMigration: () => Promise<MigrateResult>;
  /** call AFTER a successful runMigration(): ensures app_worker's test password (superuser-backed,
   *  since the role may have just been created by migrate()) and returns a pool connected as it */
  connectAsWorker: () => Promise<pg.Pool>;
  teardown: () => Promise<void>;
}

/**
 * Non-superuser DDL-owner context (JCL-2..JCL-4). `plexco` (DATABASE_URL_TEST) is a real
 * Postgres superuser — it bypasses RLS *and* every ACL check unconditionally, which is exactly
 * why the production defect this slice fixes was invisible to every existing test (design-probe,
 * .autopilot/state/db-job-claim-lease-core/design-probe.md). These tests need a genuinely
 * NOSUPERUSER NOBYPASSRLS owner so FORCE RLS and role-membership checks are not silently skipped.
 * The owner gets CREATEROLE (mirrors migrate.ts's ensureRoleExists dependency: a fresh cluster's
 * very first migration run must be able to create app/app_worker/readonly itself) and becomes the
 * fresh database's OWNER, so it implicitly holds full rights on every object it creates via
 * migrate() with no separate schema-level GRANT required.
 */
export async function setupNonSuperuserOwnerContext(
  dbName: string,
  opts: { inherit?: boolean } = {},
): Promise<NonSuperuserOwnerContext> {
  const base = process.env.DATABASE_URL_TEST;
  if (!base) {
    throw new Error(
      "DATABASE_URL_TEST is required for the non-superuser owner suite (see setupRlsTestContext)",
    );
  }

  // codex round-08 [P2]: INHERIT (the default) makes a role automatically exercise privileges
  // of roles it's a member of; NOINHERIT requires an explicit SET ROLE for each such operation
  // instead. Both are valid, real production postures — the default here matches ordinary roles,
  // but callers proving NOINHERIT-specific behavior (job_definer's post-transfer ACL statements,
  // 0022's own SET ROLE bracket) must opt in explicitly.
  const inheritClause = opts.inherit === false ? "NOINHERIT" : "INHERIT";
  const ownerRole = `${dbName}_owner`;
  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  // race-safe create/reset, mirrors migrate.ts's ensureRoleExists swallow idiom. ownerRole is
  // unique per dbName (per test), so the only realistic race is this exact test re-running.
  await admin.query(
    `DO $$ BEGIN
       CREATE ROLE ${ownerRole} LOGIN NOSUPERUSER NOBYPASSRLS CREATEROLE ${inheritClause} PASSWORD '${NONSUPER_OWNER_PW}';
     EXCEPTION WHEN duplicate_object OR unique_violation THEN
       ALTER ROLE ${ownerRole} WITH LOGIN NOSUPERUSER NOBYPASSRLS CREATEROLE ${inheritClause} PASSWORD '${NONSUPER_OWNER_PW}';
     END $$;`,
  );
  await admin.query(`CREATE DATABASE ${dbName} OWNER ${ownerRole}`);

  const ownerUrl = testUrl(base, { db: dbName, user: ownerRole, password: NONSUPER_OWNER_PW });
  const ownerPool = new pg.Pool({ connectionString: ownerUrl, max: 2 });
  const workerPools: pg.Pool[] = [];

  const bootstrapJobDefinerForOwner = async () => {
    // job_definer needs BYPASSRLS, and PG16 forbids a role from creating (or being granted) a
    // BYPASSRLS role unless the GRANTOR/CREATOR itself has BYPASSRLS (or is superuser) — ownerRole
    // has CREATEROLE but not BYPASSRLS, so it can never self-bootstrap job_definer from scratch
    // ("permission denied to create role"). The privileged `admin` (superuser) connection stands
    // in for the real "privileged cluster-tier bootstrap" (task contract §4.1): it creates/
    // verifies job_definer, then grants membership to ownerRole via the SAME session-GUC
    // mechanism `pnpm db:bootstrap`/CI use for a distinct migration-role identity (codex
    // round-06 [P1] — this is also this exact mechanism's own regression coverage).
    await admin.query(`SET job_definer_bootstrap.migration_role = '${ownerRole}'`);
    try {
      await bootstrapJobDefiner(admin);
    } finally {
      await admin.query(`RESET job_definer_bootstrap.migration_role`);
    }
  };

  const bootstrapChatDefinerForOwner = async () => {
    // Mirrors bootstrapJobDefinerForOwner exactly (2026-08-05): chat_definer needs BYPASSRLS, so
    // ownerRole (CREATEROLE but not BYPASSRLS) can never self-bootstrap it either. The privileged
    // `admin` connection creates/verifies chat_definer, then grants membership to ownerRole via the
    // same session-GUC mechanism pnpm db:bootstrap/CI use for a distinct migration-role identity.
    // revokeStaleChatDefinerMembership first: chat_definer's OWN bootstrap script (unlike
    // job_definer's) refuses to re-point to a different target once any member exists — see that
    // helper's own comment.
    await revokeStaleChatDefinerMembership(admin, ownerRole);
    await admin.query(`SET chat_definer_bootstrap.migration_role = '${ownerRole}'`);
    try {
      await bootstrapChatDefiner(admin);
    } finally {
      await admin.query(`RESET chat_definer_bootstrap.migration_role`);
    }
  };

  const connectAsWorker = async (): Promise<pg.Pool> => {
    await setRolePasswordRaceSafe(
      admin,
      "app_worker",
      ROLE_PW.app_worker!,
      /* allowMissing */ false,
    );
    const pool = new pg.Pool({
      connectionString: testUrl(base, {
        db: dbName,
        user: "app_worker",
        password: ROLE_PW.app_worker,
      }),
      max: 2,
    });
    workerPools.push(pool);
    return pool;
  };

  return {
    dbName,
    ownerRole,
    superuser: admin,
    ownerPool,
    bootstrapJobDefinerForOwner,
    bootstrapChatDefinerForOwner,
    runMigration: () => migrate(ownerUrl),
    connectAsWorker,
    teardown: async () => {
      await ownerPool.end();
      for (const p of workerPools) await p.end();
      // codex round-07 [P1]: closing connections alone leaves the database, the cluster-global
      // ownerRole, and its job_definer/chat_definer membership behind — a LOGIN role with a known,
      // fixed password and BYPASSRLS-via-membership on a shared local cluster. Drop the database
      // (ownerRole owns it, so it must go first) then the role itself, before closing the admin
      // connection that is the one privileged enough to do both. DROP ROLE natively revokes every
      // membership the dropped role held (job_definer's, chat_definer's, or both) — no separate
      // REVOKE step needed.
      await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await admin.query(`DROP ROLE IF EXISTS ${ownerRole}`);
      await admin.end();
    },
  };
}

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { expect } from "vitest";
import { migrate, type MigrateResult } from "./migrate.js";
import { createDb, type DbHandle } from "./client.js";

/**
 * DROP DATABASE's FORCE option (used throughout this file's teardown paths) calls
 * pg_terminate_backend() on every remaining connection to the target database, which delivers a
 * FATAL 57P01 (admin_shutdown) to whichever client still holds that connection — including one
 * that is already in the middle of its own client.end() (pg-pool's Pool.end() removes an idle
 * client from its bookkeeping synchronously, in _remove(), before the client's actual socket
 * close resolves, so end() can return slightly before the connection is gone). A pg.Pool/pg.Client
 * with no 'error' listener turns that into an unhandled error that crashes the whole test run,
 * even though the termination is expected and harmless. Every pool/client this file constructs is
 * guarded, but the guard is scoped: it swallows ONLY a connection-termination code, and ONLY while
 * the owning context's own teardown is in progress — anything else still throws, exactly as it
 * would with no listener at all, so a genuine connection failure never goes silent.
 */
const CONNECTION_TERMINATION_CODES = new Set(["57P01"]);

function isConnectionTerminationError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return typeof code === "string" && CONNECTION_TERMINATION_CODES.has(code);
}

function guardPoolErrors(pool: pg.Pool, isTearingDown: () => boolean): void {
  pool.on("error", (error) => {
    if (isTearingDown() && isConnectionTerminationError(error)) return;
    throw error;
  });
}

function guardClientErrors(client: pg.Client, isTearingDown: () => boolean): void {
  client.on("error", (error) => {
    if (isTearingDown() && isConnectionTerminationError(error)) return;
    throw error;
  });
}

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
 *   3. after step 4, leases the cluster-global runtime roles' test passwords so tests can connect
 *      AS app/readonly — proving RLS/grants from the runtime roles' seats,
 *      never from superuser (FORCE RLS is meaningless to a superuser),
 *   4. seeds two tenants via the owner connection (tenant provisioning is an
 *      auth-slice concern; tests only need two isolated tenants to exist).
 * teardown() closes the pools, ends the lease and drops the database.
 */

/** The ONE spelling of the runtime roles' test passwords: every other test file imports ROLE_PW. */
export const ROLE_PW = {
  app: "plexco_test_app",
  app_worker: "plexco_test_worker",
  readonly: "plexco_test_readonly",
} as const;

export interface TestRolePasswordLease {
  release(): Promise<void>;
}

type RoleRow = { rolname: string; rolpassword: string | null; rolcanlogin: boolean };
type RoleSnapshot = Record<string, RoleRow | null>;

/**
 * Leases the roles' test passwords, held SHARED (participantKey) and written only under mutexKey:
 * no two ALTER ROLEs race, no value changes under a live participant. The first of a set snapshots
 * pg_authid password + LOGIN to a 0600 file outside the repo (never logged); the last restores and
 * checks it; a killed run's file is kept, not overwritten; a role missing from it ends passwordless.
 */
export function createRolePasswordLeaser(config: {
  passwords: Readonly<Record<string, string>>;
  mutexKey: number;
  participantKey: number;
  storeDir: string;
}): (base: string) => Promise<TestRolePasswordLease> {
  const roles = Object.keys(config.passwords);
  return async (base) => {
    const client = new pg.Client({ connectionString: base });
    let tearingDown = false;
    guardClientErrors(client, () => tearingDown);
    const rolesNow = async () => {
      const sql = "SELECT rolname, rolpassword, rolcanlogin FROM pg_authid WHERE rolname = ANY($1)";
      return new Map((await client.query<RoleRow>(sql, [roles])).rows.map((r) => [r.rolname, r]));
    };
    const lastOne = async () => {
      const sql = "SELECT pg_try_advisory_lock($1) AS ok";
      return (await client.query<{ ok: boolean }>(sql, [config.participantKey])).rows[0]!.ok;
    };
    const storeFile = async () => {
      const sql = "SELECT system_identifier::text AS id FROM pg_control_system()";
      const cluster = (await client.query<{ id: string }>(sql)).rows[0]!.id;
      return path.join(config.storeDir, `${cluster}-${config.participantKey.toString(16)}.json`);
    };
    const inSession = async (work: () => Promise<void>) => {
      try {
        await work();
      } catch (error) {
        tearingDown = true;
        await client.end().catch(() => {});
        throw error;
      }
    };
    await inSession(async () => {
      await client.connect();
      await client.query("SELECT pg_advisory_lock($1)", [config.mutexKey]);
      if (await lastOne()) {
        const file = await storeFile();
        if (!existsSync(file)) {
          const now = await rolesNow();
          const snapshot = Object.fromEntries(roles.map((role) => [role, now.get(role) ?? null]));
          mkdirSync(config.storeDir, { recursive: true, mode: 0o700 });
          writeFileSync(`${file}.tmp`, JSON.stringify(snapshot), { mode: 0o600 });
          renameSync(`${file}.tmp`, file);
        }
        await client.query("SELECT pg_advisory_unlock($1)", [config.participantKey]);
      }
      await client.query("SELECT pg_advisory_lock_shared($1)", [config.participantKey]);
      for (const role of (await rolesNow()).keys()) {
        const password = client.escapeLiteral(config.passwords[role]!);
        await client.query(
          `ALTER ROLE ${client.escapeIdentifier(role)} WITH LOGIN PASSWORD ${password}`,
        );
      }
      await client.query("SELECT pg_advisory_unlock($1)", [config.mutexKey]);
    });
    let released = false;
    return {
      release: async () => {
        if (released) return;
        released = true;
        await inSession(async () => {
          await client.query("SELECT pg_advisory_lock($1)", [config.mutexKey]);
          await client.query("SELECT pg_advisory_unlock_shared($1)", [config.participantKey]);
          if (await lastOne()) {
            const file = await storeFile();
            const snapshot = JSON.parse(readFileSync(file, "utf8")) as RoleSnapshot;
            for (const role of (await rolesNow()).keys()) {
              const was = snapshot[role];
              const login = was ? (was.rolcanlogin ? "LOGIN " : "NOLOGIN ") : "";
              const password = was?.rolpassword ? client.escapeLiteral(was.rolpassword) : "NULL";
              await client.query(
                `ALTER ROLE ${client.escapeIdentifier(role)} WITH ${login}PASSWORD ${password}`,
              );
            }
            const after = await rolesNow();
            for (const [role, was] of Object.entries(snapshot)) {
              const now = after.get(role);
              const same = was
                ? now?.rolpassword === was.rolpassword && now.rolcanlogin === was.rolcanlogin
                : !now?.rolpassword;
              if (!same) throw new Error(`role ${role}: the restore does not match the snapshot`);
            }
            rmSync(file);
          }
          await client.query("SELECT pg_advisory_unlock_all()");
        });
        tearingDown = true;
        await client.end();
      },
    };
  };
}

/** The runtime roles' lease, one for the db, bot and web suites ("rlpw" mutex, "rlpr" participants). */
export const leaseTestRolePasswords = createRolePasswordLeaser({
  passwords: ROLE_PW,
  mutexKey: 0x726c7077,
  participantKey: 0x726c7072,
  storeDir: path.join(os.homedir(), ".plexco-test-role-snapshot"),
});

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

/** packages/db/src/migrate.ts's ADVISORY_LOCK_KEY (:31), copied; a test pins the two equal. */
export const MIGRATE_ADVISORY_LOCK_KEY = 0x706c7863; // "plxc"

/**
 * Serializes bootstrapJobDefiner's 01-job-definer.sql run with migrate() of the same database.
 * Race: 01:179's GRANT USAGE ON SCHEMA public rewrites the pg_namespace row of `public` in the
 * client's database; a concurrent migrate() of that database rewrites the same row
 * (migrate.test.ts's migrate(BASE!) applying every migration to CI's unmigrated plexco_test), and
 * the loser fails with "tuple concurrently updated". 01's own jdlk already serializes 01 with 01.
 * A lock, not a retry: owner decision item 9. The runner's own key, as a new key would not
 * serialize against migrate(): conductor ruling RO-L18-1. Advisory locks are database-local.
 * Lock order: [idnm] -> chad/chst or jobd/chst (their own lock clients) -> plxc (the caller's
 * client, here) -> 01's in-script jdlk and pg_auth_members lock; migrate() holds only plxc, then
 * its DDL. migrate.test.ts:2789-2791 and :2845 spy pg.Client.prototype.query
 * on "pg_advisory_lock", which this lock SQL matches (safe: no bootstrap runs in those tests).
 * Proof: docs/sessions/web-mvp-phase3-readiness-p3-test-harness-job-definer-bootstrap-lock.md
 */
export async function withJobDefinerBootstrapLock<T>(
  client: pg.Client,
  fn: () => Promise<T>,
): Promise<T> {
  await client.query("SELECT pg_advisory_lock($1)", [MIGRATE_ADVISORY_LOCK_KEY]);
  let succeeded = false;
  try {
    const result = await fn();
    succeeded = true;
    return result;
  } finally {
    // After fn's own ROLLBACK, so never inside an aborted transaction; never masks fn's error.
    const unlock = client.query("SELECT pg_advisory_unlock($1)", [MIGRATE_ADVISORY_LOCK_KEY]);
    await (succeeded ? unlock : unlock.catch(() => {}));
  }
}

export async function bootstrapJobDefiner(client: pg.Client): Promise<void> {
  const sql = await readFile(JOB_DEFINER_BOOTSTRAP_SQL_PATH, "utf8");
  await withJobDefinerBootstrapLock(client, async () => {
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
  });
}

/**
 * Canonical chat_definer bootstrap (chat-definer-role-provisioning, merged 286f48b) — mirrors
 * bootstrapJobDefiner exactly, same reason: chat-dm-safety-authority-core's migration 0030 is the
 * first to ALTER FUNCTION ... OWNER TO chat_definer, which mechanically requires the migration role
 * to already be a member of chat_definer (PostgreSQL: "you must be able to SET ROLE to the new
 * owning role"). Every test path whose migration reaches 0030 under a non-superuser role must
 * bootstrap first, exactly like production/CI must (added 2026-08-05, owner-authorized scope
 * amendment — see docs/autopilot/contracts/autopilot-chat-dm-safety-authority-core.md SS6.3/SS8).
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
 * Canonical identity_definer bootstrap (DD-127 / DD-131 OD-3: the BYPASSRLS owner of 0054's
 * link_code_reparent_empty_person). Mirrors bootstrapChatDefiner: 03-identity-definer.sql is
 * 02-chat-definer.sql with only the role name, GUC and in-script lock key swapped (migrate.test.ts
 * asserts that), so it shares 02's one-non-runtime-member rule and the revoke/restore helpers below.
 */
const IDENTITY_DEFINER_BOOTSTRAP_SQL_PATH = path.join(
  path.dirname(CHAT_DEFINER_BOOTSTRAP_SQL_PATH),
  "03-identity-definer.sql",
);

export async function bootstrapIdentityDefiner(client: pg.Client): Promise<void> {
  const sql = await readFile(IDENTITY_DEFINER_BOOTSTRAP_SQL_PATH, "utf8");
  try {
    await client.query(sql);
  } catch (error) {
    // Same BEGIN/COMMIT-wrapped file shape as 02: leave no aborted transaction on `client`.
    await client.query("ROLLBACK");
    throw error;
  }
}

/** The two definers whose bootstrap refuses a second non-runtime member (02 and 03). */
export type OneMemberDefiner = "chat_definer" | "identity_definer";

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
 * re-point") before calling bootstrapChatDefiner for a DIFFERENT target.
 *
 * Returns the revoked role names so the CALLER can restore them (codex round-03 [P1]: the original
 * version revoked and forgot — every caller's own teardown only dropped its OWN scratch role,
 * never re-granting whatever this revoked. Confirmed as a REAL, not theoretical, break: this
 * session's own test runs against the local dev cluster left chat_definer with zero members,
 * verified directly via pg_auth_members after the fact). Restoring is a plain `GRANT chat_definer
 * TO <role>` with no extra options, matching 02-chat-definer.sql's own grant shape exactly (that
 * script's `GRANT chat_definer TO %I` is the ONLY code path in this repo that ever grants this
 * membership, so there is no other options-shape to replay).
 */
export async function revokeStaleChatDefinerMembership(
  client: pg.Client,
  keepTarget: string,
): Promise<string[]> {
  return revokeStaleDefinerMembership(client, "chat_definer", keepTarget);
}

/** revokeStaleChatDefinerMembership for either one-member definer (identity_definer too). */
export async function revokeStaleDefinerMembership(
  client: pg.Client,
  definer: OneMemberDefiner,
  keepTarget: string,
): Promise<string[]> {
  const { rows } = await client.query(
    `SELECT r.rolname FROM pg_auth_members m
       JOIN pg_roles r ON r.oid = m.member
       JOIN pg_roles g ON g.oid = m.roleid
      WHERE g.rolname = $2 AND r.rolname <> $1`,
    [keepTarget, definer],
  );
  const revoked = (rows as { rolname: string }[]).map((r) => r.rolname);
  for (const rolname of revoked) {
    // Quoted via pg's own escapeIdentifier (codex round-01 [P2]) rather than this file's usual
    // plain interpolation (e.g. DROP ROLE IF EXISTS ${ownerRole} elsewhere, always a literal
    // this file itself just chose) — rolname here is catalog-sourced, so a role created with a
    // quoted identifier containing a space/quote/statement terminator would otherwise break or
    // misparse the REVOKE statement.
    await client.query(
      `REVOKE ${client.escapeIdentifier(definer)} FROM ${client.escapeIdentifier(rolname)}`,
    );
  }
  return revoked;
}

/**
 * Faithful counterpart to revokeStaleChatDefinerMembership's own return value (codex round-03
 * [P1]). Tolerates `undefined_object` (SQLSTATE 42704, "role does not exist") specifically: the
 * revoked snapshot can legitimately name ANOTHER test's own transient scratch owner role (chat_
 * definer tolerates only one non-runtime member, so whichever test held it moments before this one
 * ran is what gets snapshotted, not necessarily a stable role like `plexco`) — reproduced live in
 * this session (JCL-1 snapshotted BR-6's own scratch owner, which BR-6 had already DROP ROLE'd by
 * the time JCL-1's restore ran). That role's own DROP ROLE already revoked its chat_definer
 * membership as a side effect, so there is nothing left to restore for it — not a real failure.
 * Any OTHER error still propagates.
 */
export async function restoreChatDefinerMembership(
  client: pg.Client,
  roleNames: string[],
): Promise<void> {
  return restoreDefinerMembership(client, "chat_definer", roleNames);
}

/** restoreChatDefinerMembership for either one-member definer. */
export async function restoreDefinerMembership(
  client: pg.Client,
  definer: OneMemberDefiner,
  roleNames: string[],
): Promise<void> {
  for (const rolname of roleNames) {
    try {
      await client.query(
        `GRANT ${client.escapeIdentifier(definer)} TO ${client.escapeIdentifier(rolname)}`,
      );
    } catch (error) {
      if ((error as { code?: string }).code !== "42704") throw error;
    }
  }
}

/**
 * Unconditionally revokes roleName's own chat_definer membership, tolerating the role already
 * being gone (codex round-02 [P1]). `DROP ROLE` normally revokes membership as a side effect of
 * dropping the role entirely, which is the common case this is a no-op for (42704 -- the role no
 * longer exists to query). It exists for the case where DROP ROLE itself threw and the role, still
 * present, may still hold the slot: without this call, restoreChatDefinerMembership running
 * unconditionally in the same cleanup (codex round-01 [P1]) would add the predecessor back ON TOP
 * of a scratch role that was never actually removed, leaving TWO simultaneous non-runtime members
 * and violating the one-member invariant every caller of chat_definer's bootstrap depends on.
 * Always call this immediately before restoreChatDefinerMembership, never after.
 */
export async function ensureChatDefinerMembershipRevoked(
  client: pg.Client,
  roleName: string,
): Promise<void> {
  return ensureDefinerMembershipRevoked(client, "chat_definer", roleName);
}

/** ensureChatDefinerMembershipRevoked for either one-member definer (42704 also covers a missing definer). */
export async function ensureDefinerMembershipRevoked(
  client: pg.Client,
  definer: OneMemberDefiner,
  roleName: string,
): Promise<void> {
  try {
    await client.query(
      `REVOKE ${client.escapeIdentifier(definer)} FROM ${client.escapeIdentifier(roleName)}`,
    );
  } catch (error) {
    if ((error as { code?: string }).code !== "42704") throw error;
  }
}

/**
 * Revokes EVERY current chat_definer member, unconditionally (codex round-03 [P1]). A thin wrapper
 * over revokeStaleChatDefinerMembership with a keepTarget no real role can ever equal (Postgres
 * identifiers are never empty) -- exists for tests whose own body can throw between capturing a
 * `preExisting` snapshot and restoring it: at that point ANY role (the test's own scratch target,
 * or nobody, depending on exactly where the throw happened) could hold the slot, not necessarily
 * one known name ensureChatDefinerMembershipRevoked could target. Always call immediately before
 * restoring the snapshot, in a finally that wraps everything after the snapshot was captured.
 */
export async function revokeAllChatDefinerMembers(client: pg.Client): Promise<string[]> {
  return revokeStaleChatDefinerMembership(client, "");
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
// "chad": the one-member SLOT of chat_definer and identity_definer, held by a hand-off until its
// teardown. "chst": their STATE (0030/0054), shared in withDefinerReadLock and exclusive in each
// breaker window (withChatDefinerLock, 0054 step 1 too). The reader locks never take chad; a
// non-superuser hand-off takes it in its jobd reader hold and migrates under the slot, not chst.
const CHAT_DEFINER_STATE_LOCK_KEY = 0x63687374; // "chst"

/** A chat_definer or identity_definer breaker window: the slot, then the state, both exclusive. */
export async function withChatDefinerLock<T>(base: string, fn: () => Promise<T>): Promise<T> {
  const keys = [CHAT_DEFINER_LOCK_KEY, CHAT_DEFINER_STATE_LOCK_KEY];
  return withAdvisoryLocks(base, keys, "exclusive", fn);
}

/**
 * The slot alone, released by hand (codex round-05 [P1]): a caller whose
 * chat_definer hand-off spans more than one function call -- bootstrap now, arbitrary test work
 * later, restore/drop at teardown -- cannot express that as one callback. The prior shape (separate
 * withChatDefinerLock calls for the bootstrap step and, independently, the teardown/restore step)
 * released the lock in between, leaving a real window: another test could acquire it, install its
 * OWN scratch member, and have that member either overwritten (bootstrapChatDefiner's own
 * one-non-runtime-member refusal doesn't apply to a plain GRANT) or wrongly co-exist with the first
 * test's restored predecessor -- reproduced live this session (JCL-1 observed BR-6's own transient
 * member). Callers holding the whole lifecycle use this directly and MUST call release() exactly
 * once, in a finally, after their own restore/cleanup completes -- see
 * setupNonSuperuserOwnerContext's bootstrapChatDefinerForOwner/teardown for the pattern.
 */
export async function acquireChatDefinerLock(
  base: string,
): Promise<{ release: () => Promise<void> }> {
  const lockClient = new pg.Client({ connectionString: base });
  let tearingDown = false;
  guardClientErrors(lockClient, () => tearingDown);
  // Everything before `release` reaches the caller runs under this try. connect() and the lock
  // query are the two rejections possible in that window, and until this existed either one left a
  // client nobody could ever close: end() is reachable ONLY through release(), and a caller that
  // throws here never receives release(). setupNonSuperuserOwnerContext is where that costs
  // something concrete -- it assigns chatDefinerLockRelease from THIS return value, so a throw
  // leaves it null and leaves its own teardown() with nothing to release.
  try {
    await lockClient.connect();
    await lockClient.query("SELECT pg_advisory_lock($1)", [CHAT_DEFINER_LOCK_KEY]);
  } catch (error) {
    // tearingDown BEFORE the cleanup, for the same reason teardown() sets it: on the lock-query
    // branch the client IS connected, so end() can race a server-side termination and
    // guardClientErrors would re-throw the expected 57P01 as an unhandled client error -- turning a
    // clean failure into a noisy one.
    tearingDown = true;
    // Cleanup is swallowed; the original error is not. Measured on pg 8.22, end() after a failed
    // connect() RESOLVES (bad database, ECONNREFUSED, bad password and ENOTFOUND all checked) and
    // emits no 'error' event, so on THAT branch neither guard is load-bearing today. Both are kept
    // anyway: the contract that must hold is "cleanup never replaces the diagnosis", and that must
    // not depend on a driver's current behaviour. Same shape as release()'s .catch(() => {}) on the
    // unlock, deliberately rather than a second cleanup idiom.
    await lockClient.end().catch(() => {});
    // Rethrown unchanged -- identity preserved, not wrapped. The caller's failure is a failure to
    // acquire the lock, and a wrapper here would bury the pg error code that says why.
    throw error;
  }
  // No unlock on the failure path above: if the lock query rejected, the lock was never taken, and
  // a session-level advisory lock dies with its session regardless (verified: 0 rows left in
  // pg_locks for this key after end()). end() alone is therefore sufficient AND complete.
  let released = false;
  return {
    release: async () => {
      if (released) return;
      released = true;
      tearingDown = true;
      await lockClient
        .query("SELECT pg_advisory_unlock($1)", [CHAT_DEFINER_LOCK_KEY])
        .catch(() => {});
      await lockClient.end();
    },
  };
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

/** The reader side. Never call it inside a reader's fn: see withAdvisoryLocks. */
export async function withJobDefinerLock<T>(base: string, fn: () => Promise<T>): Promise<T> {
  return withAdvisoryLocks(base, [JOB_DEFINER_LOCK_KEY], "shared", fn);
}

/** The exclusive side, for every window that breaks job_definer (JCL-2/3, bootstrap refusals). */
export async function withJobDefinerBreakerLock<T>(base: string, fn: () => Promise<T>): Promise<T> {
  return withAdvisoryLocks(base, [JOB_DEFINER_LOCK_KEY], "exclusive", fn);
}

/** The shared side of every definer a full migrate() reaches: 0022 (jobd), 0030 and 0054 (chst). */
export async function withDefinerReadLock<T>(base: string, fn: () => Promise<T>): Promise<T> {
  const keys = [JOB_DEFINER_LOCK_KEY, CHAT_DEFINER_STATE_LOCK_KEY];
  return withAdvisoryLocks(base, keys, "shared", fn);
}

/**
 * Holds `keys` on one session while fn runs. Exclusive: in order. Shared: all-or-nothing, waiting on
 * a busy key while holding nothing. A connect() or lock failure ends the session, error unchanged
 * (audit 2026-09-06, test-harness-job-definer-lock-client-leak). Never take a reader lock inside a
 * reader's fn: a breaker queued between the two waits on the outer, the inner on it: an unseen hang.
 */
export async function withAdvisoryLocks<T>(
  base: string,
  keys: readonly number[],
  mode: "shared" | "exclusive",
  fn: () => Promise<T>,
): Promise<T> {
  const lockClient = new pg.Client({ connectionString: base });
  let tearingDown = false;
  guardClientErrors(lockClient, () => tearingDown);
  try {
    await lockClient.connect();
    if (mode === "shared") await lockAllShared(lockClient, keys);
    else for (const key of keys) await lockClient.query("SELECT pg_advisory_lock($1)", [key]);
  } catch (error) {
    tearingDown = true;
    await lockClient.end().catch(() => {});
    throw error; // identity preserved — the pg error code is the diagnosis
  }
  try {
    return await fn();
  } finally {
    tearingDown = true;
    await lockClient.query("SELECT pg_advisory_unlock_all()").catch(() => {});
    await lockClient.end();
  }
}

async function lockAllShared(client: pg.Client, keys: readonly number[]): Promise<void> {
  for (;;) {
    let busy: number | undefined;
    for (const key of keys) {
      const sql = "SELECT pg_try_advisory_lock_shared($1) AS ok";
      if (!(await client.query<{ ok: boolean }>(sql, [key])).rows[0]!.ok) {
        busy = key;
        break;
      }
    }
    if (busy === undefined) return;
    await client.query("SELECT pg_advisory_unlock_all()");
    await client.query("SELECT pg_advisory_lock_shared($1)", [busy]);
    await client.query("SELECT pg_advisory_unlock_shared($1)", [busy]);
  }
}

/**
 * identity_definer is cluster-global and NAMED by identity-link-web.test.ts (GRANT ... TO it, ALTER
 * ROLE it, catalog checks by name), while migrate.test.ts's 0054 step-1 cases hide it, re-create it
 * with drifted attributes or re-grant it, each for one migrate() call. "shared" = a reader,
 * "exclusive" = that window. A key of its own, NOT the job/chat locks: readers then never queue
 * behind a sibling suite's migration. Acquire it BEFORE the chat or job lock, never while holding
 * either: the window holds it while it waits for the chat lock, and a chat holder waiting for this
 * lock would close a cycle (and would sit on the "chst" key every reader waits for).
 */
const IDENTITY_DEFINER_NAME_LOCK_KEY = 0x69646e6d; // "idnm" — distinct from jobd/chad/plxc/jdlk/cdlk/idlk

export async function withIdentityDefinerNameLock<T>(
  base: string,
  mode: "shared" | "exclusive",
  fn: () => Promise<T>,
): Promise<T> {
  const suffix = mode === "shared" ? "_shared" : "";
  const lockClient = new pg.Client({ connectionString: base });
  let tearingDown = false;
  guardClientErrors(lockClient, () => tearingDown);
  try {
    await lockClient.connect();
    await lockClient.query(`SELECT pg_advisory_lock${suffix}($1)`, [
      IDENTITY_DEFINER_NAME_LOCK_KEY,
    ]);
  } catch (error) {
    tearingDown = true;
    await lockClient.end().catch(() => {});
    throw error; // identity preserved — the pg error code is the diagnosis
  }
  try {
    return await fn();
  } finally {
    tearingDown = true;
    await lockClient
      .query(`SELECT pg_advisory_unlock${suffix}($1)`, [IDENTITY_DEFINER_NAME_LOCK_KEY])
      .catch(() => {});
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
  let tearingDown = false;
  guardClientErrors(admin, () => tearingDown);
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${dbName}`);

  // 2. real runner against the fresh db. job_definer is cluster-global and must exist (correctly)
  // before migrate() reaches 0022 (which only asserts it, never creates it); 0030 and 0054 then
  // need chat_definer and identity_definer intact; withDefinerReadLock keeps every breaker out.
  const migrationUrl = testUrl(base, { db: dbName });
  const migrateResult = await withDefinerReadLock(base, async () => {
    await bootstrapJobDefiner(admin);
    return migrate(migrationUrl);
  });
  await admin.end();

  const owner = new pg.Client({ connectionString: migrationUrl });
  guardClientErrors(owner, () => tearingDown);
  await owner.connect();

  // 4. two tenants + resolve a seeded sport
  const tenants = await owner.query(
    `INSERT INTO tenants (name, slug, status) VALUES
       ('RLS Test Club A', 'rls-test-a', 'active'),
       ('RLS Test Club B', 'rls-test-b', 'active')
     RETURNING id`,
  );
  const sport = await owner.query(`SELECT id FROM sports WHERE key = 'badminton'`);

  // last (step 3): lease the roles' test passwords, so a failed connect or seed never holds them
  const passwords = await leaseTestRolePasswords(base);
  const appUrl = testUrl(base, { db: dbName, user: "app", password: ROLE_PW.app });
  const readonlyUrl = testUrl(base, { db: dbName, user: "readonly", password: ROLE_PW.readonly });
  const workerUrl = testUrl(base, { db: dbName, user: "app_worker", password: ROLE_PW.app_worker });
  const appDb = createDb(appUrl, { max: 4 });
  const readonlyPool = new pg.Pool({ connectionString: readonlyUrl, max: 2 });
  const workerPool = new pg.Pool({ connectionString: workerUrl, max: 4 });
  const superuserDb = createDb(migrationUrl, { max: 2 });
  guardPoolErrors(appDb.pool, () => tearingDown);
  guardPoolErrors(readonlyPool, () => tearingDown);
  guardPoolErrors(workerPool, () => tearingDown);
  guardPoolErrors(superuserDb.pool, () => tearingDown);

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
      tearingDown = true;
      const closed = await Promise.allSettled([
        appDb.close(),
        readonlyPool.end(),
        workerPool.end(),
        superuserDb.close(),
        owner.end(),
      ]);
      await passwords.release(); // after every close settled: a failed close can't keep the lease
      // No FORCE: every connection this context opened is closed, DROP DATABASE waits up to 5 s for
      // sockets still closing, and a connection a caller leaked fails here instead of being killed.
      const dropper = new pg.Client({ connectionString: base });
      await dropper.connect();
      try {
        await dropper.query(`DROP DATABASE IF EXISTS ${dbName}`);
      } finally {
        await dropper.end();
      }
      for (const result of closed) if (result.status === "rejected") throw result.reason;
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
   *  each call separately leaves a gap between them, and locking inside both would nest a second
   *  reader session in the caller's, which hangs once a breaker queues (see withAdvisoryLocks). */
  bootstrapJobDefinerForOwner: () => Promise<void>;
  /** idempotent chat_definer bootstrap (grants membership to ownerRole) — call before runMigration()
   *  whenever the migration will reach 0030 (chat-dm-safety-authority-core) or later under a
   *  non-superuser role. UNLIKE bootstrapJobDefinerForOwner, this one DOES acquire its own lock
   *  internally (acquireChatDefinerLock, codex round-05 [P1] of the predecessor lane) and holds it
   *  until teardown() runs — the caller does not need to wrap it in withJobDefinerLock. Safe to
   *  call more than once, sequentially OR concurrently: every call after the first, however soon it
   *  arrives, awaits the SAME in-flight or completed bootstrap rather than starting a second one
   *  (codex round-04/round-05 [P2] of this registration — a boolean "already ran" guard alone
   *  raced across the internal `await`; a synchronously-assigned memoized promise does not).
   *  ALSO bootstraps identity_definer for ownerRole (0054, DD-127 / DD-131 OD-3) inside the same
   *  lock-held critical section, restored in teardown() the same way: every non-superuser run that
   *  reaches 0030 reaches 0054 too, and 03-identity-definer.sql has 02's one-member rule. */
  bootstrapChatDefinerForOwner: () => Promise<void>;
  /** run the real migration runner AS the non-superuser owner (never superuser) */
  runMigration: () => Promise<MigrateResult>;
  /** after runMigration(): lease ROLE_PW until teardown() (idempotent) for a caller's own client */
  useRuntimeRolePasswords: () => Promise<void>;
  /** after runMigration(): useRuntimeRolePasswords() plus an app_worker pool ended by teardown() */
  connectAsWorker: () => Promise<pg.Pool>;
  /** same as connectAsWorker but for the HTTP runtime role `app` (the only grantee of the identity definers) */
  connectAsApp: () => Promise<pg.Pool>;
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
  let tearingDown = false;
  guardClientErrors(admin, () => tearingDown);
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
  guardPoolErrors(ownerPool, () => tearingDown);
  const workerPools: pg.Pool[] = [];
  // Populated by bootstrapChatDefinerForOwner if/when it runs; restored in teardown() (codex
  // round-03 [P1]) — empty means either it never ran, or chat_definer had no pre-existing member.
  let revokedChatDefinerMembers: string[] = [];
  // Same, for identity_definer (bootstrapped inside bootstrapChatDefinerForOwner's critical section).
  let revokedIdentityDefinerMembers: string[] = [];
  // Held from bootstrapChatDefinerForOwner's own revoke through teardown's own restore, as ONE
  // continuous critical section (codex round-05 [P1] — releasing and re-acquiring between those two
  // points left a real window for another test to occupy the slot in between; see
  // acquireChatDefinerLock's own comment for the reproduction). null until bootstrapChatDefinerForOwner
  // actually runs.
  let chatDefinerLockRelease: (() => Promise<void>) | null = null;
  // codex round-05 [P2]: memoizes bootstrapChatDefinerForOwner's own in-flight/completed call.
  // Assigned SYNCHRONOUSLY (no `await` between the null-check and this assignment), which is what
  // makes it safe against concurrent callers -- chatDefinerLockRelease alone (round-04's fix) was
  // check-then-act across an `await` boundary: two callers could both observe it null before
  // either finished acquiring the lock, so both would proceed, and the second would deadlock
  // against the first exactly like the original round-04 bug. A caller arriving after this promise
  // is created but before the underlying bootstrap finishes now awaits the SAME promise instead of
  // returning early into a still-incomplete bootstrap.
  let chatDefinerBootstrapPromise: Promise<void> | null = null;
  // Memoized the same way (assigned synchronously): one lease per context, ended in teardown().
  let passwordLease: Promise<TestRolePasswordLease> | null = null;
  const useRuntimeRolePasswords = async (): Promise<void> => {
    passwordLease ??= leaseTestRolePasswords(base);
    await passwordLease;
  };

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

  const bootstrapChatDefinerForOwner = (): Promise<void> => {
    // Mirrors bootstrapJobDefinerForOwner exactly (2026-08-05): chat_definer needs BYPASSRLS, so
    // ownerRole (CREATEROLE but not BYPASSRLS) can never self-bootstrap it either. The privileged
    // `admin` connection creates/verifies chat_definer, then grants membership to ownerRole via the
    // same session-GUC mechanism pnpm db:bootstrap/CI use for a distinct migration-role identity.
    // revokeStaleChatDefinerMembership first: chat_definer's OWN bootstrap script (unlike
    // job_definer's) refuses to re-point to a different target once any member exists — see that
    // helper's own comment. Its return value is restored in teardown() (codex round-03 [P1]).
    //
    // codex round-04/round-05 [P2]: a second call before teardown() must be a no-op, not a repeat
    // bootstrap or a race — acquireChatDefinerLock opens a BRAND NEW connection every call, so
    // calling this twice would try to acquire the same session-level advisory lock from a SECOND
    // session while the first (still open, held until teardown()) already holds it, deadlocking
    // forever. Round-04 guarded on chatDefinerLockRelease, but that check happened BEFORE the
    // `await` that sets it — two concurrent callers could both observe it null before either
    // finished, so both would proceed (round-05's own finding). Guarding on
    // chatDefinerBootstrapPromise instead and assigning it in this SAME synchronous tick (nothing
    // awaited between the null-check and the assignment) closes that: every caller, concurrent or
    // sequential, either creates the one shared promise or immediately awaits the one already
    // created by whichever caller got there first.
    if (!chatDefinerBootstrapPromise) {
      chatDefinerBootstrapPromise = (async () => {
        // The lock is acquired HERE and released only in teardown(), after the restore completes
        // (codex round-05 [P1]) — the whole revoke -> bootstrap -> [caller's own work] -> teardown
        // -> restore sequence is one continuous critical section, not two separately-locked halves
        // with a gap another test could occupy in between.
        chatDefinerLockRelease = (await acquireChatDefinerLock(base)).release;
        revokedChatDefinerMembers = await revokeStaleChatDefinerMembership(admin, ownerRole);
        await admin.query(`SET chat_definer_bootstrap.migration_role = '${ownerRole}'`);
        try {
          await bootstrapChatDefiner(admin);
        } finally {
          await admin.query(`RESET chat_definer_bootstrap.migration_role`);
        }
        // identity_definer (0054) rides this SAME lock-held critical section rather than a second
        // advisory key: every caller here migrates past 0054, and 03-identity-definer.sql refuses a
        // second non-runtime member exactly like 02, so it needs the identical revoke -> bootstrap
        // -> restore lifecycle. One lock means no acquisition order to get wrong.
        revokedIdentityDefinerMembers = await revokeStaleDefinerMembership(
          admin,
          "identity_definer",
          ownerRole,
        );
        await admin.query(`SET identity_definer_bootstrap.migration_role = '${ownerRole}'`);
        try {
          await bootstrapIdentityDefiner(admin);
        } finally {
          await admin.query(`RESET identity_definer_bootstrap.migration_role`);
        }
      })();
    }
    return chatDefinerBootstrapPromise;
  };

  const connectAsApp = async (): Promise<pg.Pool> => {
    await useRuntimeRolePasswords();
    const pool = new pg.Pool({
      connectionString: testUrl(base, { db: dbName, user: "app", password: ROLE_PW.app }),
      max: 4,
    });
    guardPoolErrors(pool, () => tearingDown);
    workerPools.push(pool);
    return pool;
  };

  const connectAsWorker = async (): Promise<pg.Pool> => {
    await useRuntimeRolePasswords();
    const pool = new pg.Pool({
      connectionString: testUrl(base, {
        db: dbName,
        user: "app_worker",
        password: ROLE_PW.app_worker,
      }),
      max: 2,
    });
    guardPoolErrors(pool, () => tearingDown);
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
    useRuntimeRolePasswords,
    connectAsWorker,
    connectAsApp,
    teardown: async () => {
      tearingDown = true;
      // codex round-06 [P2]: the whole post-acquisition cleanup sequence now runs under ONE outer
      // try/finally whose finally unconditionally releases the chat lock (and closes admin) —
      // previously, pool shutdown / DROP DATABASE / DROP ROLE ran BEFORE the try/finally that
      // released the lock, so if any of those earlier statements threw, chatDefinerLockRelease()
      // was never called: the dedicated lock-holder connection leaked, and the advisory lock it
      // held blocked every other test file's own chat_definer work until timeout. This finally
      // does not catch/swallow — a genuine cleanup failure still propagates as a test failure,
      // it just never leaks the lock on the way out.
      try {
        // codex round-08 [P1]: the restore below must run even when pool/database/role cleanup
        // itself throws. It previously sat at the end of this same try block, so an earlier
        // exception here jumped straight past it to the outer finally — the lock would still
        // release cleanly, but chat_definer's original member would stay permanently revoked, the
        // exact cluster corruption this whole revoke/restore mechanism exists to prevent. Nesting
        // the restore in its own finally guarantees it runs regardless of which statement above it
        // fails, while a genuine failure still propagates afterward (nothing here catches/swallows).
        try {
          await ownerPool.end();
          for (const p of workerPools) await p.end();
          // codex round-07 [P1]: closing connections alone leaves the database, the cluster-global
          // ownerRole, and its job_definer/chat_definer membership behind — a LOGIN role with a
          // known, fixed password and BYPASSRLS-via-membership on a shared local cluster. Drop the
          // database (ownerRole owns it, so it must go first) then the role itself, before closing
          // the admin connection that is the one privileged enough to do both. DROP ROLE natively
          // revokes every membership the dropped role held (job_definer's, chat_definer's, or
          // both) — no separate REVOKE step needed.
          await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
          await admin.query(`DROP ROLE IF EXISTS ${ownerRole}`);
          // Last, so a throwing release can't skip the drops; a failed acquisition already threw.
          await (passwordLease && (await passwordLease.catch(() => null)))?.release();
        } finally {
          // codex round-02 [P1]: DROP ROLE above may itself have thrown, in which case ownerRole
          // still exists and may still hold the chat_definer slot — revoke it explicitly and
          // unconditionally before restoring, so a failed DROP ROLE can never leave both ownerRole
          // AND the restored predecessor as simultaneous members. ensureChatDefinerMembershipRevoked
          // tolerates ownerRole already being gone (the common case, when DROP ROLE succeeded).
          try {
            await ensureChatDefinerMembershipRevoked(admin, ownerRole);
            // Restore whatever bootstrapChatDefinerForOwner revoked (codex round-03 [P1]), still
            // under the SAME lock acquired back in bootstrapChatDefinerForOwner — never released in
            // between (codex round-05 [P1]), so no other test can occupy the slot between the DROP
            // ROLE above (which vacates it) and this restore. Empty array is a no-op.
            if (revokedChatDefinerMembers.length > 0) {
              await restoreChatDefinerMembership(admin, revokedChatDefinerMembers);
            }
          } finally {
            // identity_definer, same rules, still under the same lock; runs even if the chat
            // restore threw.
            await ensureDefinerMembershipRevoked(admin, "identity_definer", ownerRole);
            await restoreDefinerMembership(
              admin,
              "identity_definer",
              revokedIdentityDefinerMembers,
            );
          }
        }
      } finally {
        // Release regardless of whether anything above threw, and regardless of whether there was
        // ever anything to revoke — the lock was acquired unconditionally in
        // bootstrapChatDefinerForOwner whenever that ran.
        if (chatDefinerLockRelease) {
          await chatDefinerLockRelease();
        }
        await admin.end();
      }
    },
  };
}

/**
 * Test-fixture person + account, seeded DIRECTLY as the owner/superuser connection.
 *
 * Replaces the `loginTelegram(ctx.appPool, freshLogin(uid))` fixture that 60+ tests used purely to
 * obtain an {accountId, personId} pair (audit 2026-09-06 W-1 / row
 * db-channel-identities-platform-chk-drop-telegram): that helper drove the Telegram login
 * definer, which 0042 drops. Same return shape (`created` is always true — a fixture never
 * "re-logs in"), so call sites are a one-line swap. `displayName` mirrors the old
 * `Player <uid>` convention because a few assertions (DD-26 name-never-overwritten class) read it.
 * NOT a production path: persons/accounts are global-protected tables with zero grants to `app`,
 * which is exactly why this takes the owner client and not the app pool.
 */
export async function seedPersonAccount(
  owner: pg.Client | pg.Pool,
  uid: string,
  opts: { displayName?: string | null } = {},
): Promise<{ accountId: string; personId: string; created: true }> {
  const displayName = opts.displayName === undefined ? `Player ${uid}` : opts.displayName;
  const person = await owner.query<{ id: string }>(
    `INSERT INTO persons (display_name) VALUES ($1) RETURNING id`,
    [displayName],
  );
  const personId = person.rows[0]!.id;
  const account = await owner.query<{ id: string }>(
    `INSERT INTO accounts (person_id) VALUES ($1) RETURNING id`,
    [personId],
  );
  return { accountId: account.rows[0]!.id, personId, created: true };
}

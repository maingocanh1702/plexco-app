import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "node:util";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  assertMonotonicMigrationOrder,
  ensureRoleExists,
  logMigrationFailure,
  migrate,
} from "./migrate.js";
import {
  acquireChatDefinerLock,
  bootstrapChatDefiner,
  bootstrapIdentityDefiner,
  bootstrapJobDefiner,
  ensureChatDefinerMembershipRevoked,
  ensureDefinerMembershipRevoked,
  restoreChatDefinerMembership,
  restoreDefinerMembership,
  revokeAllChatDefinerMembers,
  revokeStaleChatDefinerMembership,
  revokeStaleDefinerMembership,
  setupNonSuperuserOwnerContext,
  withChatDefinerLock,
  withIdentityDefinerNameLock,
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
const MIGRATION_COUNT = 55; // 0000..0054 (0054 link_code reparent empty person) (0053 zalo ingress) (0037 D-2 · 0038 D-1 · 0039 audit P3 schema · 0040 idle TTL · 0041 worker heartbeat · 0042 drop telegram login · 0043 link_code issue/consume · 0044 session guest notes schema · 0045 guest-note tenant context · 0046 bounded rate-limit cleanup · 0047 tenant capability authority core · 0048 capability grant trigger search_path · 0049 tenant capability authorize · 0050 attested_transfer allocation source · 0051 host-add person definer · 0052 tenant profile definers)

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
  // A previous run killed inside the 0054 step-1 window left identity_definer parked: put it back.
  await healHiddenIdentityDefiner(admin);

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

/**
 * BR-2b — the P17 immutability guard must stay exactly as trigger-happy as it is today, and
 * separately must be able to say why it fired.
 *
 * The two halves are deliberately separate tests because they are separate claims, and only one
 * of them was ever in doubt. The guard's CONDITION has always been right; what cost a real
 * session ~40 minutes and two wrong diagnoses was that the throw carried no `.cause`, so the
 * failure surfaced through an unrelated assertion — `expected undefined to be an instance of
 * Error` — in whichever test happened to assert a cause chain first. Nothing in that sentence
 * mentions a migration, a digest, or an invariant.
 */
describe("BR-2b P17 immutability guard: condition unchanged, failure diagnosable", () => {
  const RECORDED_SENTINEL = "4606baf8".padEnd(64, "0");

  it("fires on exactly prior !== sha — not before, and not once the file matches again", async () => {
    const db = "plexco_migrate_p17_condition";
    await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${db}`);
    try {
      const first = await migrate(url(db));
      expect(first.applied.length).toBe(MIGRATION_COUNT);
      expect(first.skipped.length).toBe(0);

      // Negative edge: every recorded sha still equals its file, so the guard must stay silent
      // and the whole run must degrade to skips. A guard that fired here would be the real
      // regression this test exists to catch.
      const second = await migrate(url(db));
      expect(second.applied.length).toBe(0);
      expect(second.skipped.length).toBe(MIGRATION_COUNT);

      const fileSql = await readFile(
        path.join(MIGRATIONS_DIR, "0000_roles_extensions.sql"),
        "utf8",
      );
      const trueSha = createHash("sha256").update(fileSql).digest("hex");

      const c = await connect(url(db));
      try {
        // Positive edge.
        await c.query(`UPDATE schema_migrations SET sha256 = $1 WHERE name = $2`, [
          RECORDED_SENTINEL,
          "0000_roles_extensions.sql",
        ]);
        await expect(migrate(url(db))).rejects.toThrow(/changed after being applied/);

        // Back to matching: the predicate is a live comparison, not a sticky "was tampered"
        // flag, so restoring the true digest must restore the skip path.
        await c.query(`UPDATE schema_migrations SET sha256 = $1 WHERE name = $2`, [
          trueSha,
          "0000_roles_extensions.sql",
        ]);
      } finally {
        await c.end();
      }

      const restored = await migrate(url(db));
      expect(restored.applied.length).toBe(0);
      expect(restored.skipped.length).toBe(MIGRATION_COUNT);
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
    }
  }, 180_000);

  it("names the file, both digests and the cure — and still keeps the recorded digest out of the CLI log", async () => {
    const db = "plexco_migrate_p17_diagnosable";
    await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${db}`);
    try {
      await migrate(url(db));

      const fileSql = await readFile(
        path.join(MIGRATIONS_DIR, "0000_roles_extensions.sql"),
        "utf8",
      );
      const trueSha = createHash("sha256").update(fileSql).digest("hex");

      const c = await connect(url(db));
      try {
        await c.query(`UPDATE schema_migrations SET sha256 = $1 WHERE name = $2`, [
          RECORDED_SENTINEL,
          "0000_roles_extensions.sql",
        ]);
      } finally {
        await c.end();
      }

      let caught: unknown;
      try {
        await migrate(url(db));
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(Error);
      const err = caught as Error;

      // `.message` — the rule and the remedy. Free to carry `prior`: the CLI never reads it.
      expect(err.message).toContain("0000_roles_extensions.sql");
      expect(err.message).toContain(RECORDED_SENTINEL);
      expect(err.message).toContain(trueSha);
      expect(err.message).toMatch(/immutable/i);
      expect(err.message).toMatch(/P17/);
      // Both cures, because the guard fires in two situations with opposite fixes: a shipped
      // migration needs a new forward one, an unshipped one being iterated on locally needs the
      // test database reset. The old message named only the first, which is the wrong advice for
      // the case that actually burned the session.
      expect(err.message).toMatch(/new forward migration/i);
      expect(err.message).toMatch(/reset/i);
      // Name the forbidden shortcut at the moment of temptation.
      expect(err.message).toMatch(/never edit or delete/i);

      // `.cause` — present, an Error, and carrying the measurement. This is the assertion whose
      // absence produced "expected undefined to be an instance of Error" somewhere else entirely.
      expect(err.cause).toBeInstanceOf(Error);
      const cause = err.cause as Error;
      expect(cause.message).toContain(RECORDED_SENTINEL);
      expect(cause.message).toContain(trueSha);
      expect(cause.message).toContain("0000_roles_extensions.sql");

      // The whole chain, as a cause-chain walker (test-harness's expectErrorChainToMatch) sees it.
      expect(`${err.message}\n${cause.message}`).toMatch(/sha256|sha mismatch/i);

      // AP-42's allowlist still holds in the opposite direction: the CLI sink may name the file
      // (a repo-known identifier) but must not print `prior`, which is a schema_migrations ROW
      // VALUE. `trueSha` is locally computed and would be safe, but one digest without the other
      // to compare against tells an operator nothing, so the log carries neither.
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      let printed: string;
      try {
        logMigrationFailure(caught);
        expect(spy).toHaveBeenCalledTimes(1);
        printed = format(...spy.mock.calls[0]!);
      } finally {
        spy.mockRestore();
      }
      expect(printed).toContain("0000_roles_extensions.sql");
      expect(printed).toMatch(/immutable/i);
      expect(printed).not.toContain(RECORDED_SENTINEL);
      expect(printed).not.toContain(trueSha);
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
    }
  }, 120_000);
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
    let revokedChatDefinerMembers: string[] = [];
    let revokedIdentityDefinerMembers: string[] = [];
    // Held from the revoke below through the restore in the outer finally, as ONE continuous
    // critical section (codex round-05 [P1] — two separate withChatDefinerLock calls, one for
    // revoke+bootstrap+migrate and a second, later one for the restore, left a real window in
    // between for another test to occupy the slot; see acquireChatDefinerLock's own comment for
    // the reproduction: JCL-1 observed BR-6's own transient member this exact way).
    const { release: releaseChatDefinerLock } = await acquireChatDefinerLock(BASE!);
    try {
      await admin.query(`SET job_definer_bootstrap.migration_role = '${owner}'`);
      try {
        await bootstrapJobDefiner(admin);
      } finally {
        await admin.query(`RESET job_definer_bootstrap.migration_role`);
      }
      // chat_definer bootstrap + migrate() run under the lock acquired above (2026-08-05, fixing a
      // race this exact session discovered live): migrate() now reaches 0030
      // (chat-dm-safety-authority-core), which does ALTER FUNCTION ... OWNER TO chat_definer and
      // mechanically requires `owner` to already be a member of chat_definer.
      // revokeStaleChatDefinerMembership first, since unlike job_definer's bootstrap,
      // chat_definer's own script refuses to re-point to a different target once any member
      // exists (see that helper's own comment, test-harness.ts) — chat_definer tolerates only ONE
      // non-runtime member at a time. Without the lock, a DIFFERENT test file's own concurrent
      // revoke-then-grant sequence (BR-6, JCL-1, both correctly wrapped) can steal this test's
      // membership grant in the window between granting it and migrate() actually consuming it
      // via SET ROLE — reproduced empirically as an intermittent "must be able to SET ROLE
      // chat_definer" failure before this wrap was added. Its return value is restored in the
      // outer finally below (codex round-03 [P1] — the original version revoked and forgot,
      // confirmed to have left this session's own local dev cluster's chat_definer with zero
      // members).
      revokedChatDefinerMembers = await revokeStaleChatDefinerMembership(admin, owner);
      await admin.query(`SET chat_definer_bootstrap.migration_role = '${owner}'`);
      try {
        await bootstrapChatDefiner(admin);
      } finally {
        await admin.query(`RESET chat_definer_bootstrap.migration_role`);
      }
      // 0054 creates its function inside SET ROLE identity_definer: same one-member dance, same lock
      // (setupNonSuperuserOwnerContext does the identical thing in bootstrapChatDefinerForOwner).
      revokedIdentityDefinerMembers = await revokeStaleDefinerMembership(
        admin,
        "identity_definer",
        owner,
      );
      await admin.query(`SET identity_definer_bootstrap.migration_role = '${owner}'`);
      try {
        await bootstrapIdentityDefiner(admin);
      } finally {
        await admin.query(`RESET identity_definer_bootstrap.migration_role`);
      }
      const res = await migrate(url(db, owner, "x"));
      expect(res.applied.length).toBe(MIGRATION_COUNT);
    } finally {
      // codex round-06 [P2]: DROP DATABASE/DROP ROLE now run INSIDE the same try this finally
      // covers, alongside the restore — previously they ran BEFORE a separate inner try/finally
      // that released the lock, so a throw from either one would skip releaseChatDefinerLock()
      // entirely, leaking the dedicated lock-holder connection and blocking every other test
      // file's own chat_definer work until timeout. This finally does not catch/swallow — a
      // genuine cleanup failure still propagates, it just never leaks the lock on the way out.
      try {
        // codex round-08 [P1]: nest the restore in its own finally so it still runs when DROP
        // DATABASE/DROP ROLE themselves throw — previously it sat at the end of this same try, so
        // an earlier exception here skipped it entirely, leaving chat_definer's original member
        // permanently revoked even though the lock released cleanly (mirrors the identical fix in
        // test-harness.ts's teardown()). A genuine failure still propagates afterward.
        try {
          await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
          await admin.query(`DROP ROLE IF EXISTS ${owner}`);
        } finally {
          // codex round-02 [P1]: DROP ROLE above may itself have thrown, in which case owner still
          // exists and may still hold the chat_definer slot — revoke it explicitly before
          // restoring, so a failed DROP ROLE can never leave both owner AND the restored
          // predecessor as simultaneous members (mirrors the identical fix in test-harness.ts's
          // teardown()).
          try {
            await ensureChatDefinerMembershipRevoked(admin, owner);
            if (revokedChatDefinerMembers.length > 0) {
              await restoreChatDefinerMembership(admin, revokedChatDefinerMembers);
            }
          } finally {
            await ensureDefinerMembershipRevoked(admin, "identity_definer", owner);
            await restoreDefinerMembership(
              admin,
              "identity_definer",
              revokedIdentityDefinerMembers,
            );
          }
        }
      } finally {
        await releaseChatDefinerLock();
      }
    }
  }, 60_000);

  // codex round-03 [P1]: revokeStaleChatDefinerMembership on its own permanently strips whoever
  // held chat_definer before a test ran (e.g. `plexco`, granted by this repo's own
  // pnpm db:bootstrap) — confirmed as a REAL break this session, not a theoretical one: running
  // this suite against the local dev cluster left chat_definer with zero members, verified
  // directly via pg_auth_members. This proves the restore half of the fix actually works, not
  // just that it compiles.
  it("revokeStaleChatDefinerMembership + restoreChatDefinerMembership round-trips a pre-existing member", async () => {
    const predecessor = "plexco_migrate_predecessor";
    const newTarget = "plexco_migrate_restore_target";
    await admin.query(`DROP ROLE IF EXISTS ${predecessor}`);
    await admin.query(`DROP ROLE IF EXISTS ${newTarget}`);
    await admin.query(`CREATE ROLE ${predecessor} NOLOGIN`);
    await admin.query(`CREATE ROLE ${newTarget} NOLOGIN`);
    const memberOf = async (role: string): Promise<boolean> => {
      const { rows } = await admin.query(
        `SELECT 1 FROM pg_auth_members m
           JOIN pg_roles r ON r.oid = m.member
           JOIN pg_roles g ON g.oid = m.roleid
          WHERE g.rolname = 'chat_definer' AND r.rolname = $1`,
        [role],
      );
      return rows.length > 0;
    };
    try {
      // One lock scope for the whole revoke -> bootstrap -> revoke -> restore -> restore sequence
      // (not several separate acquisitions) — a sibling file's own test could otherwise mutate
      // chat_definer's membership in the gap between releases, invalidating this test's own
      // assertions about what it revoked/restored.
      await withChatDefinerLock(BASE!, async () => {
        // Reproduced live (codex round-03 follow-up): a sibling FILE's own test can genuinely
        // hold chat_definer's one non-runtime member slot when this test starts under
        // fileParallelism — bootstrapChatDefiner refuses to re-point onto an existing member, so
        // this test's OWN setup needs the same revoke-stale-first discipline every real caller
        // uses, not an assumed-clean slate. What was there originally is restored at the end.
        const preExisting = await revokeStaleChatDefinerMembership(admin, predecessor);
        try {
          await admin.query(`SET chat_definer_bootstrap.migration_role = '${predecessor}'`);
          try {
            await bootstrapChatDefiner(admin);
          } finally {
            await admin.query(`RESET chat_definer_bootstrap.migration_role`);
          }
          expect(await memberOf(predecessor)).toBe(true);

          const revoked = await revokeStaleChatDefinerMembership(admin, newTarget);
          expect(revoked).toContain(predecessor);
          expect(await memberOf(predecessor)).toBe(false);

          await restoreChatDefinerMembership(admin, revoked);
          expect(await memberOf(predecessor)).toBe(true);
        } finally {
          // codex round-03 [P1]: preExisting was captured above but only ever handed back at the
          // very end of this callback — a throw from any assertion or step in between (bootstrap,
          // an unexpected membership state) skipped straight past that hand-back, permanently
          // losing whatever held chat_definer before this test ran. revokeAllChatDefinerMembers
          // clears the slot regardless of which role (predecessor, newTarget, or nobody) is
          // currently holding it before preExisting is restored on top.
          await revokeAllChatDefinerMembers(admin);
          await restoreChatDefinerMembership(admin, preExisting);
        }
      });
    } finally {
      await admin.query(`DROP ROLE IF EXISTS ${predecessor}`);
      await admin.query(`DROP ROLE IF EXISTS ${newTarget}`);
    }
  }, 30_000);

  // codex round-03 [P1] follow-up, found by this exact fix's own new regression test in CI: the
  // revoked snapshot can legitimately name ANOTHER test's own transient scratch owner role (chat_
  // definer tolerates only one non-runtime member at a time), which may already be DROP ROLE'd by
  // the time THIS test's restore runs (reproduced live: JCL-1 snapshotted BR-6's own scratch owner
  // mid-suite). That DROP ROLE already revoked the membership as a side effect — restoring to an
  // already-gone role must be a graceful no-op, not a hard failure.
  it("restoreChatDefinerMembership tolerates a role that no longer exists (undefined_object, 42704)", async () => {
    const ghost = "plexco_migrate_ghost_predecessor";
    await admin.query(`DROP ROLE IF EXISTS ${ghost}`);
    // Never created — restoreChatDefinerMembership must not throw for a name that never existed
    // either, the same as one that existed and was since dropped.
    await expect(restoreChatDefinerMembership(admin, [ghost])).resolves.toBeUndefined();
  });

  // codex round-02 [P1]: a cleanup failure (DROP ROLE throwing after DROP DATABASE succeeds, or
  // never running at all) must not leave TWO simultaneous chat_definer members. Simulates the
  // exact failure this fixes: the scratch owner is never dropped (as if DROP ROLE had thrown), so
  // its own chat_definer membership survives to the moment restoreChatDefinerMembership runs.
  // Without ensureChatDefinerMembershipRevoked immediately before it, the predecessor would be
  // restored ON TOP OF the still-present scratch owner, leaving two members; with it, exactly the
  // predecessor remains -- proving the invariant teardown()/BR-3's own finally now depends on.
  it("ensureChatDefinerMembershipRevoked + restoreChatDefinerMembership leaves exactly one member even when the scratch role is never dropped (simulated cleanup failure)", async () => {
    const predecessor = "plexco_migrate_cleanup_fail_predecessor";
    const scratchOwner = "plexco_migrate_cleanup_fail_scratch";
    await admin.query(`DROP ROLE IF EXISTS ${predecessor}`);
    await admin.query(`DROP ROLE IF EXISTS ${scratchOwner}`);
    await admin.query(`CREATE ROLE ${predecessor} NOLOGIN`);
    await admin.query(`CREATE ROLE ${scratchOwner} NOLOGIN`);
    const chatDefinerMembers = async (): Promise<string[]> => {
      const { rows } = await admin.query(
        `SELECT r.rolname FROM pg_auth_members m
           JOIN pg_roles r ON r.oid = m.member
           JOIN pg_roles g ON g.oid = m.roleid
          WHERE g.rolname = 'chat_definer'`,
      );
      return (rows as { rolname: string }[]).map((r) => r.rolname);
    };
    try {
      await withChatDefinerLock(BASE!, async () => {
        // Simulate prior state: predecessor holds the slot, exactly like BR-3's own setup.
        const preExisting = await revokeStaleChatDefinerMembership(admin, predecessor);
        try {
          await admin.query(`SET chat_definer_bootstrap.migration_role = '${predecessor}'`);
          try {
            await bootstrapChatDefiner(admin);
          } finally {
            await admin.query(`RESET chat_definer_bootstrap.migration_role`);
          }
          expect(await chatDefinerMembers()).toEqual([predecessor]);

          // Simulate bootstrapChatDefinerForOwner running for scratchOwner: revoke predecessor
          // (captured for later restore), grant scratchOwner.
          const revoked = await revokeStaleChatDefinerMembership(admin, scratchOwner);
          await admin.query(`SET chat_definer_bootstrap.migration_role = '${scratchOwner}'`);
          try {
            await bootstrapChatDefiner(admin);
          } finally {
            await admin.query(`RESET chat_definer_bootstrap.migration_role`);
          }
          expect(await chatDefinerMembers()).toEqual([scratchOwner]);

          // The failure this proves fixed: DROP ROLE never runs (as if it had thrown), so
          // scratchOwner is STILL a member here — exactly the state teardown's own inner
          // try/finally would be in when DROP DATABASE/DROP ROLE throws before completing.
          await ensureChatDefinerMembershipRevoked(admin, scratchOwner);
          await restoreChatDefinerMembership(admin, revoked);
          expect(await chatDefinerMembers()).toEqual([predecessor]);
        } finally {
          // codex round-03 [P1]: preExisting was captured above but only ever handed back at the
          // very end of this callback — a throw from any assertion or step in between skipped
          // straight past that hand-back, permanently losing whatever held chat_definer before
          // this test ran (the same defect found in the round-trip test above, inherited here by
          // copying its structure). revokeAllChatDefinerMembers clears the slot regardless of
          // which role is currently holding it before preExisting is restored on top.
          await revokeAllChatDefinerMembers(admin);
          await restoreChatDefinerMembership(admin, preExisting);
        }
      });
    } finally {
      await admin.query(`DROP ROLE IF EXISTS ${predecessor}`);
      await admin.query(`DROP ROLE IF EXISTS ${scratchOwner}`);
    }
  }, 30_000);
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
      // codex round-05 [P1]: bootstrapChatDefinerForOwner now acquires and holds the chat lock
      // itself, internally, through ctx.teardown() (see test-harness.ts's own comment) — nesting
      // withChatDefinerLock here would deadlock (two different connections each waiting on the
      // same session-scoped advisory lock the other holds). job_definer has no such internal hold
      // (its own bootstrap never revokes an existing member), so withJobDefinerLock still wraps
      // explicitly here.
      //
      // codex round-06 [P1] regression fix: round-05's own fix above narrowed withJobDefinerLock to
      // wrap ONLY bootstrapJobDefinerForOwner(), releasing it before bootstrapChatDefinerForOwner()
      // and runMigration() ran — but runMigration() reaches migration 0022, which ASSERTS (never
      // creates) job_definer, so it still needs that lock's protection against a concurrent
      // JCL-2/JCL-3 test hiding/corrupting job_definer. withJobDefinerLock (key 0x6a6f6264 "jobd")
      // and the chat lock bootstrapChatDefinerForOwner acquires internally (key 0x63686164 "chad")
      // are DIFFERENT advisory-lock keys, so wrapping the whole sequence in withJobDefinerLock does
      // NOT reintroduce round-05's own deadlock — only nesting the SAME key twice deadlocks.
      const res = await withJobDefinerLock(BASE!, async () => {
        await ctx.bootstrapJobDefinerForOwner();
        await ctx.bootstrapChatDefinerForOwner();
        return ctx.runMigration();
      });
      expect(res.applied[res.applied.length - 1]).toBe("0054_link_code_reparent_empty_person.sql");

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

  // codex round-04 [P2]: acquireChatDefinerLock opens a brand new connection every call, so a
  // second bootstrapChatDefinerForOwner() before teardown() used to try to acquire the same
  // session-level advisory lock from a SECOND session while the first (open until teardown())
  // still held it -- deadlocking forever, since the test could never reach teardown() to release
  // the first lock either. Must resolve promptly, not hang; the 30s test timeout is the backstop
  // that turns "hangs forever" into "a specific failing test" if this regresses.
  it("bootstrapChatDefinerForOwner is idempotent — a second call before teardown() does not deadlock", async () => {
    const ctx = await setupNonSuperuserOwnerContext("plexco_migrate_chat_definer_idempotent");
    try {
      await ctx.bootstrapChatDefinerForOwner();
      await ctx.bootstrapChatDefinerForOwner();

      const { rows } = await ctx.superuser.query(
        `SELECT r.rolname FROM pg_auth_members m
           JOIN pg_roles r ON r.oid = m.member
           JOIN pg_roles g ON g.oid = m.roleid
          WHERE g.rolname = 'chat_definer'`,
      );
      expect((rows as { rolname: string }[]).map((r) => r.rolname)).toEqual([ctx.ownerRole]);
    } finally {
      await ctx.teardown();
    }
  }, 30_000);

  // codex round-05 [P2]: round-04's own fix guarded on chatDefinerLockRelease, set only AFTER an
  // `await` -- two callers racing via Promise.all could both observe it null before either
  // finished, so both would proceed into acquireChatDefinerLock and the second would deadlock
  // against the first's still-held lock, exactly like the original round-04 bug. The sequential
  // test above never exercised this: with `await` between the two calls, the first always finishes
  // before the second starts. This one starts both from the same synchronous tick.
  it("bootstrapChatDefinerForOwner is safe under concurrent calls, not just sequential ones", async () => {
    const ctx = await setupNonSuperuserOwnerContext("plexco_migrate_chat_definer_concurrent");
    try {
      await Promise.all([ctx.bootstrapChatDefinerForOwner(), ctx.bootstrapChatDefinerForOwner()]);

      const { rows } = await ctx.superuser.query(
        `SELECT r.rolname FROM pg_auth_members m
           JOIN pg_roles r ON r.oid = m.member
           JOIN pg_roles g ON g.oid = m.roleid
          WHERE g.rolname = 'chat_definer'`,
      );
      expect((rows as { rolname: string }[]).map((r) => r.rolname)).toEqual([ctx.ownerRole]);
    } finally {
      await ctx.teardown();
    }
  }, 30_000);
});

describe("0037 tenant_provision / tenant_ids_for_person self-scope under a NOBYPASSRLS owner (audit 2026-09-06 D-2)", () => {
  // Reproduced 2026-09-06 by replaying 0000..0036 as a NOSUPERUSER NOBYPASSRLS owner:
  //   SELECT tenant_provision(...) as app
  //   ERROR: new row violates row-level security policy for table "memberships"
  //   SELECT * FROM tenant_ids_for_person(...) as app -> 0 rows
  // Both functions are SECURITY DEFINER and only ever worked because setupRlsTestContext replays as
  // a superuser. 0037 makes each function scope its own GUC so the owner's attributes stop mattering.
  it("tenant_provision inserts into four FORCE-RLS tables and tenant_ids_for_person lists across tenants, both as role app, with no GUC leaking to the caller", async () => {
    const ctx = await setupNonSuperuserOwnerContext("plexco_migrate_0037_tenant_provision");
    let appClient: pg.Client | undefined;
    /** superuser connection to THIS test's database (ctx.superuser is on the base one) */
    let suDb: pg.Client | undefined;
    try {
      // Same lock discipline as BR-6 above: withJobDefinerLock wraps the whole sequence because
      // runMigration() reaches 0022 (asserts job_definer); the chat bootstrap holds its own key.
      await withJobDefinerLock(BASE!, async () => {
        await ctx.bootstrapJobDefinerForOwner();
        await ctx.bootstrapChatDefinerForOwner();
        return ctx.runMigration();
      });

      // Prove the owner really is what this test claims — otherwise the assertions below pass
      // vacuously (superuser-owned objects bypass RLS and the whole point is lost).
      const ownerAttrs = await ctx.superuser.query(
        `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1`,
        [ctx.ownerRole],
      );
      expect(ownerAttrs.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });

      // app's cluster-global test password is owned by setupRlsTestContext (ROLE_PW.app); set the
      // SAME literal here so a concurrently running rls suite keeps connecting.
      await ctx.superuser.query(`ALTER ROLE app WITH PASSWORD 'plexco_test_app'`);
      appClient = await connect(url(ctx.dbName, "app", "plexco_test_app"));

      // ctx.superuser is connected to DATABASE_URL_TEST — the BASE database, NOT this test's
      // per-test one (the harness only ever intends it for cluster-global role work, which is
      // why the two statements above are correct on it). Every DATA statement and every
      // per-DATABASE catalog read below must run against ctx.dbName instead: seeding a person
      // on the base connection puts the row where tenant_provision can never see it, and the
      // provision then dies on memberships_person_id_fkey. url() with no user keeps the base
      // superuser credentials and only swaps the database.
      suDb = await connect(url(ctx.dbName));

      const person = await suDb.query(`INSERT INTO persons DEFAULT VALUES RETURNING id`);
      const personId = (person.rows[0] as { id: string }).id;
      const other = await suDb.query(`INSERT INTO persons DEFAULT VALUES RETURNING id`);
      const otherId = (other.rows[0] as { id: string }).id;

      // 1. fresh provision as app — the exact statement that raised at base.
      const first = await appClient.query(`SELECT tenant_provision($1, $2, $3, $4, $5) AS id`, [
        "club-0037-a",
        "Club A",
        "Asia/Ho_Chi_Minh",
        "vi",
        personId,
      ]);
      const tenantA = (first.rows[0] as { id: string }).id;
      expect(tenantA).toMatch(/^[0-9a-f-]{36}$/);

      // 2. all four tenant-scoped rows exist (read as superuser: the point is that app WROTE them
      //    under FORCE RLS, not that app can read them back without a GUC).
      const counts = await suDb.query(
        `SELECT
           (SELECT count(*)::int FROM memberships    WHERE tenant_id = $1) AS m,
           (SELECT count(*)::int FROM tenant_admins  WHERE tenant_id = $1) AS a,
           (SELECT count(*)::int FROM subscriptions  WHERE tenant_id = $1) AS s,
           (SELECT count(*)::int FROM onboarding_runs WHERE tenant_id = $1) AS o`,
        [tenantA],
      );
      expect(counts.rows[0]).toEqual({ m: 1, a: 1, s: 1, o: 1 });

      // 3. idempotent re-submit by the same owner returns the same id (this branch READS
      //    tenant_admins under RLS, so it needs the GUC bracket just as much as the inserts).
      const again = await appClient.query(`SELECT tenant_provision($1, $2, $3, $4, $5) AS id`, [
        "club-0037-a",
        "Club A",
        "Asia/Ho_Chi_Minh",
        "vi",
        personId,
      ]);
      expect((again.rows[0] as { id: string }).id).toBe(tenantA);

      // 4. a different person re-submitting the slug still gets SLUG_TAKEN (unique_violation).
      await expect(
        appClient.query(`SELECT tenant_provision($1, $2, $3, $4, $5)`, [
          "club-0037-a",
          "Club A",
          "Asia/Ho_Chi_Minh",
          "vi",
          otherId,
        ]),
      ).rejects.toMatchObject({ code: "23505" });

      // 5. second tenant for the same person, then the cross-tenant listing as app.
      const second = await appClient.query(`SELECT tenant_provision($1, $2, $3, $4, $5) AS id`, [
        "club-0037-b",
        "Club B",
        "Asia/Ho_Chi_Minh",
        "vi",
        personId,
      ]);
      const tenantB = (second.rows[0] as { id: string }).id;
      const listed = await appClient.query(
        `SELECT tenant_id, role FROM tenant_ids_for_person($1) ORDER BY tenant_id`,
        [personId],
      );
      expect(listed.rows).toEqual(
        [tenantA, tenantB].sort().map((tenant_id) => ({ tenant_id, role: "owner" })),
      );
      const listedOther = await appClient.query(`SELECT tenant_id FROM tenant_ids_for_person($1)`, [
        otherId,
      ]);
      expect(listedOther.rows).toEqual([]);

      // 6. neither function leaks its GUC into the caller's session/transaction.
      const gucs = await appClient.query(
        `SELECT tenant_provision($1, $2, $3, $4, $5) AS id,
                coalesce(current_setting('app.tenant_id', true), '') AS t,
                coalesce(current_setting('app.person_id', true), '') AS p`,
        ["club-0037-c", "Club C", "Asia/Ho_Chi_Minh", "vi", personId],
      );
      expect((gucs.rows[0] as { t: string; p: string }).t).toBe("");
      expect((gucs.rows[0] as { t: string; p: string }).p).toBe("");

      // 7. the new SELECT-only policy does not widen app's direct reads: without a person GUC,
      //    tenant_admins is still empty for app; with a tenant GUC it is still tenant-scoped.
      const direct = await appClient.query(`SELECT count(*)::int AS n FROM tenant_admins`);
      expect((direct.rows[0] as { n: number }).n).toBe(0);
      await appClient.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantA]);
      try {
        const scoped = await appClient.query(`SELECT count(*)::int AS n FROM tenant_admins`);
        expect((scoped.rows[0] as { n: number }).n).toBe(1);
      } finally {
        await appClient.query(`SELECT set_config('app.tenant_id', '', false)`);
      }
    } finally {
      await appClient?.end();
      await suDb?.end();
      await ctx.teardown();
    }
  }, 90_000);
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
    // round-01 (v3) codex review finding: unconditional, mirroring hideRealChatDefiner's own pattern —
    // a caller's assertion/query throwing before its OWN scratch-role cleanup runs must not leave a
    // leftover scratch job_definer colliding with the rename-back below, masking the original failure
    // and leaking cluster-global role state to whichever test or test file runs next. Unlike
    // chat_definer, job_definer's own bootstrap grants USAGE ON SCHEMA public as its final statement
    // (01-job-definer.sql) — a plain DROP ROLE fails ("cannot be dropped because some objects depend on
    // it: privileges for schema public") until that grant is revoked first; there is no CASCADE option
    // for DROP ROLE. Revoke is best-effort (a harmless no-op if it was never granted, or if no scratch
    // job_definer exists at all).
    await superuser.query(`REVOKE USAGE ON SCHEMA public FROM job_definer`).catch(() => {});
    await superuser.query(`DROP ROLE IF EXISTS job_definer`);
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

const LINK_REPARENT_MIGRATION = "0054_link_code_reparent_empty_person.sql";

/** Where hideRealIdentityDefiner parks the real role while a case owns the name. */
const HIDDEN_IDENTITY_DEFINER = "identity_definer_hidden_for_test";

/** Rename the real identity_definer away for one case; whatever the case created under its name goes. */
async function hideRealIdentityDefiner(
  superuser: pg.Client,
  fn: () => Promise<void>,
): Promise<void> {
  await superuser.query(`ALTER ROLE identity_definer RENAME TO ${HIDDEN_IDENTITY_DEFINER}`);
  try {
    await fn();
  } finally {
    // Reached only with the real role safely renamed, so this drops a scratch role or nothing.
    await superuser.query(`DROP ROLE IF EXISTS identity_definer`);
    await superuser.query(`ALTER ROLE ${HIDDEN_IDENTITY_DEFINER} RENAME TO identity_definer`);
  }
}

/**
 * Self-heal for a run killed inside hideRealIdentityDefiner (SIGKILL, OOM, a second Ctrl-C): its
 * finally never ran, so the real role is still parked under HIDDEN_IDENTITY_DEFINER, maybe beside a
 * LOGIN / NOBYPASSRLS scratch holding the name, and every later bootstrap or 0054 step 1 fails
 * closed on it. Called first in this file's beforeAll, and acts only under the 0054 step-1 window's
 * own locks in its order (exclusive name lock, then the chat lock), so no window, bootstrap or
 * name reader is live meanwhile; a healthy cluster costs one catalog read and takes no lock. While
 * the real role is parked only a scratch can hold the name, and DROP ROLE refuses a role that owns
 * or holds anything in any database, so nothing beyond a scratch is ever dropped. A refusal means
 * a bootstrap created a second identity_definer after the kill and a migration used it. Manual
 * repair then: drop the (test) databases the refusal lists, then run, as the compose superuser,
 *   docker compose -f infra/docker-compose.yml exec -T postgres psql -U plexco -d postgres
 *     -c 'DROP ROLE IF EXISTS identity_definer'
 *     -c 'ALTER ROLE identity_definer_hidden_for_test RENAME TO identity_definer'
 */
async function healHiddenIdentityDefiner(superuser: pg.Client): Promise<void> {
  const parked = async () =>
    (await superuser.query(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [HIDDEN_IDENTITY_DEFINER]))
      .rows.length > 0;
  if (!(await parked())) return;
  await withIdentityDefinerNameLock(BASE!, "exclusive", () =>
    withChatDefinerLock(BASE!, async () => {
      if (!(await parked())) return; // a live window elsewhere put it back while this waited
      try {
        await superuser.query(`DROP ROLE IF EXISTS identity_definer`);
      } catch (error) {
        throw new Error(
          `${HIDDEN_IDENTITY_DEFINER} is parked but identity_definer is more than a scratch; ` +
            "manual repair: see healHiddenIdentityDefiner in migrate.test.ts",
          { cause: error },
        );
      }
      await superuser.query(`ALTER ROLE ${HIDDEN_IDENTITY_DEFINER} RENAME TO identity_definer`);
    }),
  );
}

describe("0054 step 1 fails closed on identity_definer preconditions (JCL-2/JCL-3 for 0054, plus 03's member-of and one-member rules)", () => {
  it("each broken precondition aborts 0054 before any grant and records nothing; restored, 0054 applies", async () => {
    const ctx = await setupNonSuperuserOwnerContext("plexco_migrate_0054_step1");
    const su = ctx.superuser;
    const owner = ctx.ownerRole;
    const scratch = `plexco_migrate_0054_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    // ctx.dbName, read as superuser: grants/functions in THIS database only.
    let inDb: pg.Client | undefined;
    const expectNothingFrom0054 = async (label: string) => {
      const recorded = await inDb!.query(`SELECT 1 FROM schema_migrations WHERE name = $1`, [
        LINK_REPARENT_MIGRATION,
      ]);
      expect(recorded.rows, `${label}: 0054 recorded`).toEqual([]);
      const leftovers = await inDb!.query(
        `SELECT to_regprocedure('link_code_reparent_empty_person(uuid, uuid)') AS fn,
                has_any_column_privilege('identity_definer', 'link_codes', 'SELECT') AS granted`,
      );
      expect(leftovers.rows[0], `${label}: 0054 left something behind`).toEqual({
        fn: null,
        granted: false,
      });
    };
    // One case per check; every run below has only 0054 pending.
    const cases: {
      name: string;
      error: RegExp;
      broken: (check: () => Promise<void>) => Promise<void>;
    }[] = [
      {
        name: "JCL-3: not granted to the migration role",
        error: /migration role \S+ is not a member of identity_definer/,
        broken: async (check) => {
          await su.query(`REVOKE identity_definer FROM ${owner}`);
          try {
            await check();
          } finally {
            await su.query(`GRANT identity_definer TO ${owner}`);
          }
        },
      },
      {
        name: "JCL-2a: absent",
        error: /identity_definer role does not exist/,
        broken: (check) => hideRealIdentityDefiner(su, check),
      },
      {
        name: "JCL-2b: drifted to LOGIN",
        error: /identity_definer has unexpected attributes/,
        broken: (check) =>
          hideRealIdentityDefiner(su, async () => {
            await su.query(
              `CREATE ROLE identity_definer LOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION`,
            );
            await check();
          }),
      },
      {
        name: "JCL-2b: drifted to NOBYPASSRLS",
        error: /identity_definer has unexpected attributes/,
        broken: (check) =>
          hideRealIdentityDefiner(su, async () => {
            await su.query(
              `CREATE ROLE identity_definer NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION`,
            );
            await check();
          }),
      },
      {
        name: "JCL-3b: granted to a runtime role",
        error: /identity_definer must not be granted to app\/app_worker\/readonly/,
        broken: async (check) => {
          await su.query(`GRANT identity_definer TO app_worker`);
          try {
            await check();
          } finally {
            await su.query(`REVOKE identity_definer FROM app_worker`);
          }
        },
      },
      {
        name: "03 step 2: identity_definer is a member of another role",
        error: new RegExp(`identity_definer is a member of role ${scratch}`),
        broken: async (check) => {
          await su.query(`CREATE ROLE ${scratch} NOLOGIN`);
          try {
            await su.query(`GRANT ${scratch} TO identity_definer`);
            await check();
          } finally {
            await su.query(`DROP ROLE IF EXISTS ${scratch}`); // drops the membership with it
          }
        },
      },
      {
        name: "03 step 3: a second member besides the migration role",
        error: new RegExp(`identity_definer must have exactly one member.*${scratch}`),
        broken: async (check) => {
          await su.query(`CREATE ROLE ${scratch} NOLOGIN`);
          try {
            await su.query(`GRANT identity_definer TO ${scratch}`);
            await check();
          } finally {
            await su.query(`DROP ROLE IF EXISTS ${scratch}`);
          }
        },
      },
    ];
    const originalReaddir = readdirImpl;
    try {
      inDb = await connect(url(ctx.dbName));
      // 0000..0053 by the SUPERUSER under no harness lock (BR-1/BR-2 migrate the same way), so no
      // lock is held across a full migration. Step 1 is about the MIGRATION ROLE, which stays the
      // non-superuser owner: it runs 0054 alone and only has to read the ledger.
      readdirImpl = async (dir) =>
        (await originalReaddir(dir)).filter((file) => file !== LINK_REPARENT_MIGRATION);
      try {
        expect((await migrate(url(ctx.dbName))).applied.at(-1)).toBe("0053_zalo_ingress.sql");
      } finally {
        readdirImpl = originalReaddir;
      }
      await inDb.query(`GRANT SELECT ON schema_migrations TO ${owner}`);
      // ONE short window for every case. Exclusive identity_definer name lock FIRST (the shared
      // side is what identity-link-web.test.ts takes whenever it names that role), then the chat
      // lock, which every migration reaching 0054 holds, so no other suite migrates while a case has
      // identity_definer broken. In this order the chat lock is never held while waiting for a
      // reader, and only for these runs: every setupRlsTestContext holds the job lock while it
      // waits for the chat lock, so a longer hold here starved rls-invariants JCL-4 (30 s timeout)
      // in three measured full runs. No job lock: nothing here touches job_definer.
      await withIdentityDefinerNameLock(BASE!, "exclusive", () =>
        withChatDefinerLock(BASE!, async () => {
          // bootstrapChatDefinerForOwner's one-member hand-off, inside the window only: `owner`
          // becomes identity_definer's single member, and whoever held it gets it back.
          const revoked = await revokeStaleDefinerMembership(su, "identity_definer", owner);
          try {
            await su.query(`GRANT identity_definer TO ${owner}`);
            for (const c of cases) {
              await c.broken(async () => {
                await expect(ctx.runMigration(), c.name).rejects.toThrow(c.error);
              });
              await expectNothingFrom0054(c.name);
            }
            // Every precondition restored. The SUPERUSER applies 0054 while `owner` still holds
            // the slot: the one-member rule's superuser branch (its member is not the migration role).
            const res = await migrate(url(ctx.dbName));
            expect(res.applied).toEqual([LINK_REPARENT_MIGRATION]);
          } finally {
            await ensureDefinerMembershipRevoked(su, "identity_definer", owner);
            await restoreDefinerMembership(su, "identity_definer", revoked);
          }
        }),
      );
      const owned = await inDb.query(
        `SELECT pg_get_userbyid(proowner) AS owner FROM pg_proc
          WHERE oid = 'link_code_reparent_empty_person(uuid, uuid)'::regprocedure`,
      );
      expect(owned.rows).toEqual([{ owner: "identity_definer" }]);
    } finally {
      readdirImpl = originalReaddir;
      await inDb?.end();
      await ctx.teardown();
    }
  }, 300_000);
});

describe("DD29-1/DD29-2 0028 expand fails closed on plan_key data anomalies", () => {
  it("DD29-1 (guard 1): a subscriptions row referencing an unrecognized plan_key rolls back 0028 entirely", async () => {
    const ctx = await setupNonSuperuserOwnerContext("plexco_migrate_dd29_guard1");
    const superuserInDb = await connect(url(ctx.dbName));
    try {
      // 0000-0027 includes 0022/0023, which require job_definer membership on the
      // migration owner (see BR-5/BR-7) — bootstrap it before replaying the files.
      await withJobDefinerLock(BASE!, async () => {
        await ctx.bootstrapJobDefinerForOwner();
        const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
        for (const f of files) {
          if (Number.parseInt(f.slice(0, 4), 10) >= 28) continue;
          await ctx.ownerPool.query(await readFile(path.join(MIGRATIONS_DIR, f), "utf8"));
        }
      });

      // Seed via the superuser connection (bypasses RLS), matching BR-5/BR-7 — the
      // owner pool is reserved for applying migration files, not application DML.
      // An orphaned subscriptions row referencing a plan_key outside the known
      // old∪new set can only exist live via a historical FK bypass (see 0028's
      // header) — drop the FK momentarily to construct that anomaly for the test.
      // The live FK is Postgres-auto-named (0007_billing.sql never named it, and
      // 0025's naming-drift sweep covered CHECK constraints only, not this FK), so
      // look its actual name up rather than assuming schema.ts's declared name.
      // subscriptions carries TWO FKs (tenant_id -> tenants, (plan_key, plan_version)
      // -> plans) — filter by the referenced table so this can never accidentally
      // grab the tenant FK instead (codex round-01 [P2], gate-attempt-02).
      const fk = await superuserInDb.query(
        `SELECT conname FROM pg_constraint
         WHERE conrelid = 'subscriptions'::regclass AND contype = 'f' AND confrelid = 'plans'::regclass`,
      );
      expect(fk.rows.length, "exactly one FK from subscriptions to plans").toBe(1);
      const fkName = (fk.rows[0] as { conname: string }).conname;
      await superuserInDb.query(`ALTER TABLE subscriptions DROP CONSTRAINT ${fkName}`);
      const t = await superuserInDb.query(
        `INSERT INTO tenants (name, slug, status) VALUES ('DD29 Guard1', 'dd29-guard1', 'active') RETURNING id`,
      );
      const tenantId = (t.rows[0] as { id: string }).id;
      await superuserInDb.query(
        `INSERT INTO subscriptions (tenant_id, plan_key, plan_version, period_start, period_end)
         VALUES ($1, 'bogus', 1, now(), now() + interval '30 days')`,
        [tenantId],
      );

      const sql0028 = await readFile(
        path.join(MIGRATIONS_DIR, "0028_dd29_capability_registry_expand.sql"),
        "utf8",
      );
      await expect(ctx.ownerPool.query(sql0028)).rejects.toThrow(/unrecognized plan_key/i);

      // Prove the whole file rolled back, not just the failing guard statement.
      const plans = await superuserInDb.query(
        `SELECT plan_key FROM plans WHERE plan_key IN ('free','host_pro')`,
      );
      expect(plans.rows.length).toBe(0);
    } finally {
      await superuserInDb.end();
      await ctx.teardown();
    }
  }, 60_000);

  it("DD29-2 (guard 2): an old plan_key at plan_version != 1 rolls back 0028 entirely", async () => {
    const ctx = await setupNonSuperuserOwnerContext("plexco_migrate_dd29_guard2");
    const superuserInDb = await connect(url(ctx.dbName));
    try {
      await withJobDefinerLock(BASE!, async () => {
        await ctx.bootstrapJobDefinerForOwner();
        const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
        for (const f of files) {
          if (Number.parseInt(f.slice(0, 4), 10) >= 28) continue;
          await ctx.ownerPool.query(await readFile(path.join(MIGRATIONS_DIR, f), "utf8"));
        }
      });

      // Seed via the superuser connection (bypasses RLS), matching BR-5/BR-7. A
      // hypothetical price-change event on an old tier: the schema explicitly
      // supports multiple plan versions per key (edge case #6 / test #19 — "plan
      // version immutable, change price -> new version created").
      await superuserInDb.query(
        `INSERT INTO plans (plan_key, version, price) VALUES ('telegram', 2, 89000)`,
      );
      const t = await superuserInDb.query(
        `INSERT INTO tenants (name, slug, status) VALUES ('DD29 Guard2', 'dd29-guard2', 'active') RETURNING id`,
      );
      const tenantId = (t.rows[0] as { id: string }).id;
      await superuserInDb.query(
        `INSERT INTO subscriptions (tenant_id, plan_key, plan_version, period_start, period_end)
         VALUES ($1, 'telegram', 2, now(), now() + interval '30 days')`,
        [tenantId],
      );

      const sql0028 = await readFile(
        path.join(MIGRATIONS_DIR, "0028_dd29_capability_registry_expand.sql"),
        "utf8",
      );
      await expect(ctx.ownerPool.query(sql0028)).rejects.toThrow(/version <> 1/i);

      const plans = await superuserInDb.query(
        `SELECT plan_key FROM plans WHERE plan_key IN ('free','host_pro')`,
      );
      expect(plans.rows.length).toBe(0);
    } finally {
      await superuserInDb.end();
      await ctx.teardown();
    }
  }, 60_000);

  it("DD29-10 (guard 2, catalog check): an UNREFERENCED old-key plans row at version != 1 rolls back 0028 entirely (codex round-08 [P1], gate-attempt-04) — no subscription needs to point at it", async () => {
    const ctx = await setupNonSuperuserOwnerContext("plexco_migrate_dd29_guard2_catalog");
    const superuserInDb = await connect(url(ctx.dbName));
    try {
      await withJobDefinerLock(BASE!, async () => {
        await ctx.bootstrapJobDefinerForOwner();
        const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
        for (const f of files) {
          if (Number.parseInt(f.slice(0, 4), 10) >= 28) continue;
          await ctx.ownerPool.query(await readFile(path.join(MIGRATIONS_DIR, f), "utf8"));
        }
      });

      // A historical price-change snapshot that NOTHING references any more (the tenant that
      // was on it long since cancelled/migrated away) — deliberately no subscriptions INSERT
      // here, unlike DD29-2. The subscriptions-only check in guard 2 would miss this row
      // entirely; only the catalog-side check added for this finding can see it.
      await superuserInDb.query(
        `INSERT INTO plans (plan_key, version, price) VALUES ('telegram', 2, 89000)`,
      );

      const sql0028 = await readFile(
        path.join(MIGRATIONS_DIR, "0028_dd29_capability_registry_expand.sql"),
        "utf8",
      );
      await expect(ctx.ownerPool.query(sql0028)).rejects.toThrow(/plans catalog row/i);

      // Prove the whole file rolled back and the historical row survives untouched.
      const legacy = await superuserInDb.query(
        `SELECT price FROM plans WHERE plan_key = 'telegram' AND version = 2`,
      );
      expect(legacy.rows.length).toBe(1);
      expect((legacy.rows[0] as { price: number }).price).toBe(89000);
      const plans = await superuserInDb.query(
        `SELECT plan_key FROM plans WHERE plan_key IN ('free','host_pro')`,
      );
      expect(plans.rows.length).toBe(0);
    } finally {
      await superuserInDb.end();
      await ctx.teardown();
    }
  }, 60_000);
});

describe("DD29-9 0028 expand fails closed on a conflicting pre-existing plans catalog row", () => {
  it("guard 4: a pre-existing free@1 row with the wrong payload survives ON CONFLICT DO NOTHING, and the post-insert check catches it (codex round-07 [P1], gate-attempt-01 on this registration)", async () => {
    const ctx = await setupNonSuperuserOwnerContext("plexco_migrate_dd29_guard4");
    const superuserInDb = await connect(url(ctx.dbName));
    try {
      await withJobDefinerLock(BASE!, async () => {
        await ctx.bootstrapJobDefinerForOwner();
        const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
        for (const f of files) {
          if (Number.parseInt(f.slice(0, 4), 10) >= 28) continue;
          await ctx.ownerPool.query(await readFile(path.join(MIGRATIONS_DIR, f), "utf8"));
        }
      });

      // Simulate a stray free@1 row from an earlier manual edit or a partially-applied
      // prior attempt: widen the CHECK ourselves (same predicate 0028's own step 2
      // creates — its later DROP+re-ADD is then a harmless no-op) so a 'free' value is
      // insertable, then insert a row whose payload does NOT match the canonical DD-29
      // shape (wrong price, empty limits/entitlements instead of the real ones).
      await superuserInDb.query(`ALTER TABLE plans DROP CONSTRAINT plans_key_chk`);
      await superuserInDb.query(
        `ALTER TABLE plans ADD CONSTRAINT plans_key_chk
           CHECK (plan_key IN ('free_web','telegram','plus_channel','all_channels','free','host_pro'))`,
      );
      await superuserInDb.query(
        `INSERT INTO plans (plan_key, version, price, limits, entitlements)
         VALUES ('free', 1, 999999, '{}', '{}')`,
      );

      const sql0028 = await readFile(
        path.join(MIGRATIONS_DIR, "0028_dd29_capability_registry_expand.sql"),
        "utf8",
      );
      await expect(ctx.ownerPool.query(sql0028)).rejects.toThrow(
        /free@1 plans row does not match/i,
      );

      // Prove the whole file rolled back: the stray row is untouched (still the wrong
      // price, not silently "fixed"), and host_pro was never left half-inserted either.
      const free = await superuserInDb.query(
        `SELECT price, limits, entitlements FROM plans WHERE plan_key = 'free' AND version = 1`,
      );
      expect(free.rows.length).toBe(1);
      expect((free.rows[0] as { price: number }).price).toBe(999999);
      const hostPro = await superuserInDb.query(
        `SELECT 1 FROM plans WHERE plan_key = 'host_pro' AND version = 1`,
      );
      expect(hostPro.rows.length).toBe(0);
    } finally {
      await superuserInDb.end();
      await ctx.teardown();
    }
  }, 60_000);
});

describe("DD29-7 0028 expand fails closed on any legacy channel-tier subscription, regardless of status (guard 3)", () => {
  async function replayThrough27(ctx: {
    bootstrapJobDefinerForOwner: () => Promise<void>;
    ownerPool: { query: (sql: string) => Promise<unknown> };
  }): Promise<void> {
    await withJobDefinerLock(BASE!, async () => {
      await ctx.bootstrapJobDefinerForOwner();
      const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
      for (const f of files) {
        if (Number.parseInt(f.slice(0, 4), 10) >= 28) continue;
        await ctx.ownerPool.query(await readFile(path.join(MIGRATIONS_DIR, f), "utf8"));
      }
    });
  }

  async function expectGuard3Fires(dbSlug: string, planKey: string, status: string) {
    const ctx = await setupNonSuperuserOwnerContext(dbSlug);
    const superuserInDb = await connect(url(ctx.dbName));
    try {
      await replayThrough27(ctx);
      const t = await superuserInDb.query(
        `INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'active') RETURNING id`,
        [`DD29 Guard3 ${dbSlug}`, `dd29-guard3-${dbSlug}`],
      );
      const tenantId = (t.rows[0] as { id: string }).id;
      await superuserInDb.query(
        `INSERT INTO subscriptions (tenant_id, plan_key, plan_version, period_start, period_end, status)
         VALUES ($1, $2, 1, now(), now() + interval '30 days', $3)`,
        [tenantId, planKey, status],
      );

      const sql0028 = await readFile(
        path.join(MIGRATIONS_DIR, "0028_dd29_capability_registry_expand.sql"),
        "utf8",
      );
      await expect(ctx.ownerPool.query(sql0028)).rejects.toThrow(/distinctly-priced channel tier/i);

      const plans = await superuserInDb.query(
        `SELECT plan_key FROM plans WHERE plan_key IN ('free','host_pro')`,
      );
      expect(plans.rows.length).toBe(0);
    } finally {
      await superuserInDb.end();
      await ctx.teardown();
    }
  }

  it("guard 3 fires for an ACTIVE telegram subscription — remapping to host_pro would silently reprice/upgrade a paying tenant", async () => {
    await expectGuard3Fires("plexco_migrate_dd29_guard3_active", "telegram", "active");
  }, 60_000);

  it("guard 3 fires for a PAST_DUE plus_channel subscription", async () => {
    await expectGuard3Fires("plexco_migrate_dd29_guard3_pastdue", "plus_channel", "past_due");
  }, 60_000);

  it("guard 3 fires for a CANCELLED all_channels subscription too — tier identity is unconditionally lost once collapsed, regardless of status (codex round-02 [P1], gate-attempt-03: trialing/suspended rows can later reactivate onto the wrong tier if this were allowed through)", async () => {
    await expectGuard3Fires("plexco_migrate_dd29_guard3_cancelled", "all_channels", "cancelled");
  }, 60_000);

  it("guard 3 fires for a TRIALING telegram subscription — a trial can convert to active later, still on the wrong tier if collapsed now", async () => {
    await expectGuard3Fires("plexco_migrate_dd29_guard3_trialing", "telegram", "trialing");
  }, 60_000);

  it("guard 3 fires for a SUSPENDED plus_channel subscription — a suspended tenant can pay its balance and reactivate, still onto the wrong tier if collapsed now", async () => {
    await expectGuard3Fires("plexco_migrate_dd29_guard3_suspended", "plus_channel", "suspended");
  }, 60_000);

  it("guard 3 does NOT fire for an ACTIVE free_web subscription — free_web is not a paid tier, no re-pricing question, remapped cleanly to free", async () => {
    const ctx = await setupNonSuperuserOwnerContext("plexco_migrate_dd29_guard3_freeweb");
    const superuserInDb = await connect(url(ctx.dbName));
    try {
      await replayThrough27(ctx);
      const t = await superuserInDb.query(
        `INSERT INTO tenants (name, slug, status) VALUES ('DD29 Guard3 FreeWeb', 'dd29-guard3-freeweb', 'active') RETURNING id`,
      );
      const tenantId = (t.rows[0] as { id: string }).id;
      await superuserInDb.query(
        `INSERT INTO subscriptions (tenant_id, plan_key, plan_version, period_start, period_end, status)
         VALUES ($1, 'free_web', 1, now(), 'infinity', 'active')`,
        [tenantId],
      );

      const sql0028 = await readFile(
        path.join(MIGRATIONS_DIR, "0028_dd29_capability_registry_expand.sql"),
        "utf8",
      );
      await ctx.ownerPool.query(sql0028);

      const sub = await superuserInDb.query(
        `SELECT plan_key, plan_version FROM subscriptions WHERE tenant_id = $1`,
        [tenantId],
      );
      const subRow = sub.rows[0] as { plan_key: string; plan_version: number };
      expect(subRow.plan_key).toBe("free");
      expect(subRow.plan_version).toBe(1);
    } finally {
      await superuserInDb.end();
      await ctx.teardown();
    }
  }, 60_000);
});

describe("DD29-8 0028's lock ordering avoids a deadlock with concurrent tenant_provision()", () => {
  it("structural: 0028's first statement touching subscriptions appears before its first statement touching plans", async () => {
    // The dynamic test below proves "if 0028 locks subscriptions first, a concurrent
    // tenant_provision() call blocks cleanly instead of deadlocking" — but it manually replays
    // just the one ALTER statement, not 0028's actual file, so on its own it cannot prove 0028
    // ITSELF has that order. This structural check closes that gap by reading the real file.
    const sql0028 = await readFile(
      path.join(MIGRATIONS_DIR, "0028_dd29_capability_registry_expand.sql"),
      "utf8",
    );
    const withoutComments = sql0028.replace(/--.*$/gm, "");
    const firstSubscriptionsStatement = withoutComments.search(/\bsubscriptions\b/i);
    const firstPlansStatement = withoutComments.search(/\bALTER TABLE plans\b/i);
    expect(firstSubscriptionsStatement).toBeGreaterThan(-1);
    expect(firstPlansStatement).toBeGreaterThan(-1);
    expect(
      firstSubscriptionsStatement,
      "0028 must touch subscriptions (acquiring its lock) before it touches plans, or a concurrent tenant_provision() call can deadlock against it — see the file's own lock-ordering header note",
    ).toBeLessThan(firstPlansStatement);
  });

  it("a concurrent tenant_provision() call blocks cleanly on 0028's subscriptions lock and completes once the migration's transaction ends — no deadlock (codex round-05 [P1], gate-attempt-08)", async () => {
    const dbName = "plexco_migrate_dd29_lockorder";
    const admin = new pg.Client({ connectionString: BASE! });
    await admin.connect();
    let dbClient: pg.Client | undefined;
    let appClient: pg.Client | undefined;
    let migrationClient: pg.Client | undefined;
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await admin.query(`CREATE DATABASE ${dbName}`);

      // Superuser-owned replay of 0000-0027 (matches setupRlsTestContext's own pattern, the same
      // one auth.test.ts's already-passing tenant_provision tests rely on) — every object,
      // including tenant_provision() itself, ends up owned by a role that bypasses RLS. Using
      // setupNonSuperuserOwnerContext here instead would make tenant_provision()'s OWN inserts
      // (memberships, tenant_admins — unrelated to this test's subscriptions/plans concern) hit
      // FORCE RLS with no app.tenant_id set, for a reason orthogonal to the lock-ordering fix this
      // test targets.
      dbClient = await connect(url(dbName));
      await withJobDefinerLock(BASE!, async () => {
        await bootstrapJobDefiner(admin);
        const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
        for (const f of files) {
          if (Number.parseInt(f.slice(0, 4), 10) >= 28) continue;
          await dbClient!.query(await readFile(path.join(MIGRATIONS_DIR, f), "utf8"));
        }
      });

      // Connect as `app` — the runtime role tenant_provision() is GRANTed to (already granted by
      // 0012, part of the 0000-0027 replay above). `app` is a CLUSTER-GLOBAL role, shared with
      // every other suite's own setRolePasswordRaceSafe(client, "app", "plexco_test_app", ...) —
      // this MUST set the exact same password those use (a first version of this test picked its
      // own literal instead and, by racing a concurrent suite's ALTER ROLE, broke every other
      // connect-as-app test in the run with "password authentication failed"). Retry on the same
      // "tuple concurrently updated" race test-harness.ts's own helper tolerates, since two
      // concurrent ALTERs to the identical value can still MVCC-conflict.
      const appPassword = "plexco_test_app";
      for (let attempt = 0; ; attempt++) {
        try {
          await dbClient.query(`ALTER ROLE app WITH LOGIN PASSWORD '${appPassword}'`);
          break;
        } catch (error) {
          if (String(error).includes("tuple concurrently updated") && attempt < 10) {
            await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
            continue;
          }
          throw error;
        }
      }
      appClient = await connect(url(dbName, "app", appPassword));

      const personRow = await dbClient.query(
        `INSERT INTO persons (display_name) VALUES ('DD29 Lock Order Owner') RETURNING id`,
      );
      const personId = (personRow.rows[0] as { id: string }).id;

      // A: take 0028's FIRST lock-acquiring statement (subscriptions) and hold it open —
      // simulates the migration being mid-flight. Lock conflicts are enforced regardless of role
      // privilege (RLS bypass only affects policy evaluation, not lock acquisition), so this still
      // exercises the exact mechanic the fix relies on.
      migrationClient = await connect(url(dbName));
      await migrationClient.query("BEGIN");
      await migrationClient.query("ALTER TABLE subscriptions NO FORCE ROW LEVEL SECURITY");

      // B: a concurrent tenant_provision() call needs the SAME subscriptions lock for its own
      // INSERT — with the fix, it must BLOCK (queue), not error and not deadlock, while A holds it.
      const provisionPromise = appClient.query(
        `SELECT tenant_provision($1, $2, $3, $4, $5) AS tenant_id`,
        ["dd29-lockorder-tenant", "DD29 Lock Order Tenant", "Asia/Ho_Chi_Minh", "vi", personId],
      );
      let settled = false;
      let rejection: unknown;
      provisionPromise.then(
        () => {
          settled = true;
        },
        (error: unknown) => {
          settled = true;
          rejection = error;
        },
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(
        settled,
        `tenant_provision() must still be BLOCKED (not resolved, not errored) while the migration's transaction holds the subscriptions lock. rejection=${String(rejection)}`,
      ).toBe(false);

      // A commits — releases the lock. B's blocked call must now complete cleanly: no deadlock
      // error, a real tenant_id returned.
      await migrationClient.query("COMMIT");
      const provisionResult = await provisionPromise;
      expect(rejection).toBeUndefined();
      expect((provisionResult.rows[0] as { tenant_id: string }).tenant_id).toMatch(
        /^[0-9a-f-]{36}$/i,
      );
    } finally {
      if (migrationClient) await migrationClient.end();
      if (appClient) await appClient.end();
      if (dbClient) await dbClient.end();
      await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {});
      await admin.end();
    }
  }, 60_000);
});

describe("DD29-3 0028 expand upgrade path: pre-existing subscriptions rows are correctly repointed", () => {
  it("A1/A3: old plans rows survive alongside the new ones, and a pre-existing free_web row remaps to free at version 1", async () => {
    const ctx = await setupNonSuperuserOwnerContext("plexco_migrate_dd29_upgrade");
    const superuserInDb = await connect(url(ctx.dbName));
    try {
      await withJobDefinerLock(BASE!, async () => {
        await ctx.bootstrapJobDefinerForOwner();
        const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
        for (const f of files) {
          if (Number.parseInt(f.slice(0, 4), 10) >= 28) continue;
          await ctx.ownerPool.query(await readFile(path.join(MIGRATIONS_DIR, f), "utf8"));
        }
      });

      // Only free_web is ever auto-repointed by this migration (0011's seed shape,
      // version 1). telegram/plus_channel/all_channels are deliberately NOT seeded
      // here — guard 3 (see 0028) unconditionally halts on any row referencing one
      // of those three, regardless of status; DD29-7's tests prove that behavior.
      const t = await superuserInDb.query(
        `INSERT INTO tenants (name, slug, status) VALUES ('DD29 Upgrade free_web', 'dd29-upgrade-free-web', 'active') RETURNING id`,
      );
      const tenantId = (t.rows[0] as { id: string }).id;
      await superuserInDb.query(
        `INSERT INTO subscriptions (tenant_id, plan_key, plan_version, period_start, period_end)
         VALUES ($1, 'free_web', 1, now(), now() + interval '30 days')`,
        [tenantId],
      );

      const sql0028 = await readFile(
        path.join(MIGRATIONS_DIR, "0028_dd29_capability_registry_expand.sql"),
        "utf8",
      );
      await ctx.ownerPool.query(sql0028);

      // A1: the 4 old catalog rows still exist alongside the 2 new ones.
      const plans = await superuserInDb.query<{ plan_key: string }>(
        `SELECT plan_key FROM plans ORDER BY plan_key`,
      );
      expect(plans.rows.map((r) => r.plan_key).sort()).toEqual(
        ["all_channels", "free", "free_web", "host_pro", "plus_channel", "telegram"].sort(),
      );

      // A1 (capability payload): the exact price/limits/entitlements for both new
      // rows, not just plan_key existence — a plan_key-only check would miss a
      // flipped capability flag, a wrong price, or a dropped key (codex round-01
      // [P2], gate-attempt-02). Literals match feature_billing_lifecycle_tech.md:68-81
      // verbatim, same source 0028's own INSERT transcribes from.
      const catalog = await superuserInDb.query(
        `SELECT plan_key, price, limits, entitlements FROM plans
         WHERE plan_key IN ('free','host_pro') ORDER BY plan_key`,
      );
      expect(catalog.rows).toEqual([
        {
          plan_key: "free",
          price: 0,
          limits: { max_clubs: 2, ai_monthly_question_cap: 0 },
          entitlements: {
            capabilities: {
              web_app: true,
              bot_zalo: true,
              bot_messenger: true,
              session_management: true,
              discovery_marketplace: true,
              payment_mark_manual: true,
              payment_reconcile_auto: false,
              reminders_manual: true,
              reminders_auto: false,
              assistant_ai_kb: false,
              crm_dashboard: false,
            },
          },
        },
        {
          plan_key: "host_pro",
          price: 250000,
          limits: { max_clubs: null, ai_monthly_question_cap: 2000 },
          entitlements: {
            capabilities: {
              web_app: true,
              bot_zalo: true,
              bot_messenger: true,
              session_management: true,
              discovery_marketplace: true,
              payment_mark_manual: true,
              payment_reconcile_auto: true,
              reminders_manual: true,
              reminders_auto: true,
              assistant_ai_kb: true,
              crm_dashboard: true,
            },
          },
        },
      ]);

      // A3: the pre-existing free_web row remapped to free at version 1.
      const sub = await superuserInDb.query(
        `SELECT plan_key, plan_version FROM subscriptions WHERE tenant_id = $1`,
        [tenantId],
      );
      const subRow = sub.rows[0] as { plan_key: string; plan_version: number };
      expect(subRow.plan_key).toBe("free");
      expect(subRow.plan_version).toBe(1);
    } finally {
      await superuserInDb.end();
      await ctx.teardown();
    }
  }, 60_000);

  it("A2: tenant_provision() writes plan_key='free' immediately after 0028 alone, with 0029 NOT yet applied (codex round-2, gate-attempt-03 [P2]: no existing test isolates this phase boundary — DD29-8's deadlock test never runs 0028's SQL at all, and auth.test.ts's own plan_key='free' assertion runs after the full migration tail, so it would pass unchanged even if the function redefinition had been mistakenly authored in 0029 instead of 0028)", async () => {
    const dbName = "plexco_migrate_dd29_provision_0028_only";
    const admin = new pg.Client({ connectionString: BASE! });
    await admin.connect();
    let dbClient: pg.Client | undefined;
    let appClient: pg.Client | undefined;
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await admin.query(`CREATE DATABASE ${dbName}`);

      // Superuser-owned replay of 0000-0028 ONLY — same reasoning as DD29-8: every object,
      // including tenant_provision() itself, ends up owned by a role that bypasses RLS, so its
      // own inserts (memberships, tenant_admins) don't hit FORCE RLS with no app.tenant_id set.
      dbClient = await connect(url(dbName));
      await withJobDefinerLock(BASE!, async () => {
        await bootstrapJobDefiner(admin);
        const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
        for (const f of files) {
          if (Number.parseInt(f.slice(0, 4), 10) >= 29) continue;
          await dbClient!.query(await readFile(path.join(MIGRATIONS_DIR, f), "utf8"));
        }
      });

      // Confirm 0029 genuinely has not run — the old 4 plans rows must still exist, or this
      // test would prove nothing about the phase boundary it claims to isolate.
      const preCheck = await dbClient.query(
        `SELECT plan_key FROM plans WHERE plan_key IN ('free_web','telegram','plus_channel','all_channels')`,
      );
      expect(preCheck.rows.length).toBe(4);

      // Connect as `app` — same password convention DD29-8 uses (shared cluster-global role;
      // must match every other suite's own setRolePasswordRaceSafe(client, "app", ...) literal).
      const appPassword = "plexco_test_app";
      for (let attempt = 0; ; attempt++) {
        try {
          await dbClient.query(`ALTER ROLE app WITH LOGIN PASSWORD '${appPassword}'`);
          break;
        } catch (error) {
          if (String(error).includes("tuple concurrently updated") && attempt < 10) {
            await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
            continue;
          }
          throw error;
        }
      }
      appClient = await connect(url(dbName, "app", appPassword));

      const personRow = await dbClient.query(
        `INSERT INTO persons (display_name) VALUES ('DD29 A2 Phase Owner') RETURNING id`,
      );
      const personId = (personRow.rows[0] as { id: string }).id;

      const result = await appClient.query(
        `SELECT tenant_provision($1, $2, $3, $4, $5) AS tenant_id`,
        ["dd29-a2-phase", "DD29 A2 Phase Tenant", "Asia/Ho_Chi_Minh", "vi", personId],
      );
      const tenantId = (result.rows[0] as { tenant_id: string }).tenant_id;

      const subOut = await dbClient.query(
        `SELECT plan_key, plan_version, status FROM subscriptions WHERE tenant_id = $1`,
        [tenantId],
      );
      const subOutRow = subOut.rows[0] as {
        plan_key: string;
        plan_version: number;
        status: string;
      };
      expect(subOutRow.plan_key).toBe("free");
      expect(subOutRow.plan_version).toBe(1);
      expect(subOutRow.status).toBe("active");
    } finally {
      if (appClient) await appClient.end();
      if (dbClient) await dbClient.end();
      await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {});
      await admin.end();
    }
  }, 60_000);
});

describe("DD29-4/DD29-5 0029 contract narrows plans_key_chk and self-guards on stragglers", () => {
  it("B1: applying 0029 immediately after a clean 0028 succeeds — old 4 plans rows gone, plans_key_chk now free/host_pro only", async () => {
    const ctx = await setupNonSuperuserOwnerContext("plexco_migrate_dd29_contract_clean");
    const superuserInDb = await connect(url(ctx.dbName));
    try {
      await withJobDefinerLock(BASE!, async () => {
        await ctx.bootstrapJobDefinerForOwner();
        const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
        for (const f of files) {
          if (Number.parseInt(f.slice(0, 4), 10) >= 29) continue;
          await ctx.ownerPool.query(await readFile(path.join(MIGRATIONS_DIR, f), "utf8"));
        }
      });

      const sql0029 = await readFile(
        path.join(MIGRATIONS_DIR, "0029_dd29_capability_registry_contract.sql"),
        "utf8",
      );
      await ctx.ownerPool.query(sql0029);

      const plans = await superuserInDb.query<{ plan_key: string }>(
        `SELECT plan_key FROM plans ORDER BY plan_key`,
      );
      expect(plans.rows.map((r) => r.plan_key).sort()).toEqual(["free", "host_pro"]);

      const chk = await superuserInDb.query(
        `SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'plans_key_chk'`,
      );
      const chkDef = (chk.rows[0] as { d: string }).d;
      expect(chkDef).toMatch(/'free'/);
      expect(chkDef).toMatch(/'host_pro'/);
      expect(chkDef).not.toMatch(/free_web|telegram|plus_channel|all_channels/);
    } finally {
      await superuserInDb.end();
      await ctx.teardown();
    }
  }, 60_000);

  it("B2: 0029's own guard rejects a subscriptions row still on an old plan_key, even after 0028 already ran", async () => {
    const ctx = await setupNonSuperuserOwnerContext("plexco_migrate_dd29_contract_straggler");
    const superuserInDb = await connect(url(ctx.dbName));
    try {
      await withJobDefinerLock(BASE!, async () => {
        await ctx.bootstrapJobDefinerForOwner();
        const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
        for (const f of files) {
          if (Number.parseInt(f.slice(0, 4), 10) >= 29) continue;
          await ctx.ownerPool.query(await readFile(path.join(MIGRATIONS_DIR, f), "utf8"));
        }
      });

      // A straggler created AFTER 0028 ran (e.g. a write path 0028 didn't know about,
      // or a restored/replayed row) — the old plans row still exists post-0028 (0029
      // is what deletes it), so this FK insert is still valid at this point.
      const t = await superuserInDb.query(
        `INSERT INTO tenants (name, slug, status) VALUES ('DD29 Straggler', 'dd29-straggler', 'active') RETURNING id`,
      );
      const tenantId = (t.rows[0] as { id: string }).id;
      await superuserInDb.query(
        `INSERT INTO subscriptions (tenant_id, plan_key, plan_version, period_start, period_end)
         VALUES ($1, 'telegram', 1, now(), now() + interval '30 days')`,
        [tenantId],
      );

      const sql0029 = await readFile(
        path.join(MIGRATIONS_DIR, "0029_dd29_capability_registry_contract.sql"),
        "utf8",
      );
      await expect(ctx.ownerPool.query(sql0029)).rejects.toThrow(/still on an old plan_key/i);

      // Prove the whole file rolled back — the 4 old plans rows must still exist.
      const plans = await superuserInDb.query(
        `SELECT plan_key FROM plans WHERE plan_key IN ('free_web','telegram','plus_channel','all_channels')`,
      );
      expect(plans.rows.length).toBe(4);
    } finally {
      await superuserInDb.end();
      await ctx.teardown();
    }
  }, 60_000);

  it("guard 1b: an unreferenced old-key plans row inserted in the gap AFTER 0028 committed but BEFORE 0029 runs rolls 0029 back entirely, instead of being silently deleted (codex round-13 [P1], gate-attempt-02: 0029's guard 1 only ever scanned subscriptions, so a catalog-only gap-window row sailed past it)", async () => {
    const ctx = await setupNonSuperuserOwnerContext("plexco_migrate_dd29_contract_catalog_gap");
    const superuserInDb = await connect(url(ctx.dbName));
    try {
      await withJobDefinerLock(BASE!, async () => {
        await ctx.bootstrapJobDefinerForOwner();
        const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
        for (const f of files) {
          if (Number.parseInt(f.slice(0, 4), 10) >= 29) continue;
          await ctx.ownerPool.query(await readFile(path.join(MIGRATIONS_DIR, f), "utf8"));
        }
      });

      // Simulate the gap window: a historical price-change snapshot lands in the catalog
      // AFTER 0028 already committed (e.g. a manual pricing note, unrelated to onboarding
      // traffic) — deliberately NO subscription references it, so 0029's guard 1 (which only
      // scans subscriptions) would see zero remaining references and proceed straight to the
      // unconditional DELETE without guard 1b.
      await superuserInDb.query(
        `INSERT INTO plans (plan_key, version, price) VALUES ('telegram', 2, 89000)`,
      );

      const sql0029 = await readFile(
        path.join(MIGRATIONS_DIR, "0029_dd29_capability_registry_contract.sql"),
        "utf8",
      );
      await expect(ctx.ownerPool.query(sql0029)).rejects.toThrow(/plans catalog row.*version/i);

      // Prove the whole file rolled back: the gap-window row survives untouched, and so do
      // the original 4 old plans rows (0029 never reached its DELETE).
      const legacy = await superuserInDb.query(
        `SELECT price FROM plans WHERE plan_key = 'telegram' AND version = 2`,
      );
      expect(legacy.rows.length).toBe(1);
      expect((legacy.rows[0] as { price: number }).price).toBe(89000);
      const oldPlans = await superuserInDb.query(
        `SELECT plan_key FROM plans WHERE plan_key IN ('free_web','telegram','plus_channel','all_channels') AND version = 1`,
      );
      expect(oldPlans.rows.length).toBe(4);
    } finally {
      await superuserInDb.end();
      await ctx.teardown();
    }
  }, 60_000);

  it("guard 1b's LOCK TABLE plans closes the TOCTOU race: a concurrent INSERT into plans blocks while 0029 holds the exclusive lock, and only resolves (rejected by the now-narrowed CHECK) after 0029 commits — never sneaking in between the check and the DELETE (codex round-15 [P1], gate-attempt-04: the guard's own SELECT alone only takes ACCESS SHARE, which does not block a concurrent writer)", async () => {
    const dbName = "plexco_migrate_dd29_contract_lock_race";
    const admin = new pg.Client({ connectionString: BASE! });
    await admin.connect();
    let dbClient: pg.Client | undefined;
    let migrationClient: pg.Client | undefined;
    let concurrentClient: pg.Client | undefined;
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await admin.query(`CREATE DATABASE ${dbName}`);
      dbClient = await connect(url(dbName));
      await withJobDefinerLock(BASE!, async () => {
        await bootstrapJobDefiner(admin);
        const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
        for (const f of files) {
          if (Number.parseInt(f.slice(0, 4), 10) >= 29) continue;
          await dbClient!.query(await readFile(path.join(MIGRATIONS_DIR, f), "utf8"));
        }
      });

      // Split 0029's real file at its own LOCK TABLE statement, rather than hand-transcribing a
      // parallel copy, so this test can never silently drift from what the migration actually
      // runs. Part A ends with (and includes) the LOCK acquisition; part B is guard 1b through
      // the CHECK narrow.
      const sql0029 = await readFile(
        path.join(MIGRATIONS_DIR, "0029_dd29_capability_registry_contract.sql"),
        "utf8",
      );
      const lockStatement = "LOCK TABLE plans IN ACCESS EXCLUSIVE MODE;";
      const lockIndex = sql0029.indexOf(lockStatement);
      if (lockIndex === -1) {
        throw new Error("could not find 0029's LOCK TABLE statement to split the file on");
      }
      const bodyStart = sql0029.indexOf("ALTER TABLE subscriptions NO FORCE ROW LEVEL SECURITY;");
      const partA = sql0029.slice(bodyStart, lockIndex + lockStatement.length);
      const partB = sql0029.slice(lockIndex + lockStatement.length);

      migrationClient = await connect(url(dbName));
      await migrationClient.query("BEGIN");
      await migrationClient.query(partA);

      // Concurrent writer: attempts to insert a stray old-key catalog row WHILE 0029 holds the
      // exclusive lock it just took. With the fix, this must BLOCK (queue), not succeed
      // immediately — that would be the exact race the guard is supposed to close.
      concurrentClient = await connect(url(dbName));
      const insertPromise = concurrentClient.query(
        `INSERT INTO plans (plan_key, version, price) VALUES ('telegram', 2, 89000)`,
      );
      let settled = false;
      let insertError: unknown;
      insertPromise.then(
        () => {
          settled = true;
        },
        (error: unknown) => {
          settled = true;
          insertError = error;
        },
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(
        settled,
        `the concurrent INSERT must still be BLOCKED while 0029 holds the exclusive lock on plans. error=${String(insertError)}`,
      ).toBe(false);

      // 0029 proceeds — guard 1b passes (0 bad rows, since the concurrent insert has not landed
      // and cannot land while the lock is held), the DELETE and CHECK narrow both succeed, commit.
      await migrationClient.query(partB);
      await migrationClient.query("COMMIT");

      // The blocked INSERT now unblocks. It must fail — not because it was silently deleted, but
      // because it never actually existed during 0029's transaction at all: by the time Postgres
      // lets it proceed, plans_key_chk has already narrowed to ('free','host_pro'), so 'telegram'
      // is rejected outright. This is the proof the race window is closed, not just documented.
      await expect(insertPromise).rejects.toThrow(/plans_key_chk|check constraint/i);

      const finalPlans = await dbClient.query(
        `SELECT plan_key, version FROM plans WHERE plan_key = 'telegram'`,
      );
      expect(finalPlans.rows.length).toBe(0);
    } finally {
      if (migrationClient) await migrationClient.end();
      if (concurrentClient) await concurrentClient.end();
      if (dbClient) await dbClient.end();
      await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {});
      await admin.end();
    }
  }, 60_000);

  it("guard 1c: a target row (host_pro@1) DELETED in the gap window after 0028 committed but before 0029 runs rolls 0029 back entirely, instead of narrowing plans_key_chk over a missing FK target (codex round-1 [P1], gate-attempt-02: guards 1/1b only ever scan for OLD-key rows, so a gap-window edit to the NEW target rows sailed past both)", async () => {
    const ctx = await setupNonSuperuserOwnerContext("plexco_migrate_dd29_contract_target_deleted");
    const superuserInDb = await connect(url(ctx.dbName));
    try {
      await withJobDefinerLock(BASE!, async () => {
        await ctx.bootstrapJobDefinerForOwner();
        const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
        for (const f of files) {
          if (Number.parseInt(f.slice(0, 4), 10) >= 29) continue;
          await ctx.ownerPool.query(await readFile(path.join(MIGRATIONS_DIR, f), "utf8"));
        }
      });

      // Simulate the gap window: a privileged edit removes host_pro@1 after 0028 committed
      // (0028's own guard 4 validated it at that commit — this is strictly AFTER that).
      await superuserInDb.query(`DELETE FROM plans WHERE plan_key = 'host_pro' AND version = 1`);

      const sql0029 = await readFile(
        path.join(MIGRATIONS_DIR, "0029_dd29_capability_registry_contract.sql"),
        "utf8",
      );
      await expect(ctx.ownerPool.query(sql0029)).rejects.toThrow(
        /host_pro@1 plans row is missing or no longer matches/i,
      );

      // Prove the whole file rolled back: the old 4 plans rows survive untouched, and
      // plans_key_chk is still the wide expand-phase CHECK, not narrowed over a missing target.
      const oldPlans = await superuserInDb.query(
        `SELECT plan_key FROM plans WHERE plan_key IN ('free_web','telegram','plus_channel','all_channels') AND version = 1`,
      );
      expect(oldPlans.rows.length).toBe(4);
      const chk = await superuserInDb.query(
        `SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'plans_key_chk'`,
      );
      expect((chk.rows[0] as { d: string }).d).toMatch(/free_web/);
    } finally {
      await superuserInDb.end();
      await ctx.teardown();
    }
  }, 60_000);

  it("guard 1c: a target row (free@1) MODIFIED (wrong price) in the gap window after 0028 committed but before 0029 runs rolls 0029 back entirely, instead of narrowing plans_key_chk over a corrupted catalog row (codex round-1 [P1], gate-attempt-02)", async () => {
    const ctx = await setupNonSuperuserOwnerContext("plexco_migrate_dd29_contract_target_modified");
    const superuserInDb = await connect(url(ctx.dbName));
    try {
      await withJobDefinerLock(BASE!, async () => {
        await ctx.bootstrapJobDefinerForOwner();
        const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
        for (const f of files) {
          if (Number.parseInt(f.slice(0, 4), 10) >= 29) continue;
          await ctx.ownerPool.query(await readFile(path.join(MIGRATIONS_DIR, f), "utf8"));
        }
      });

      // Simulate the gap window: a privileged edit alters free@1's price after 0028 committed.
      await superuserInDb.query(
        `UPDATE plans SET price = 19000 WHERE plan_key = 'free' AND version = 1`,
      );

      const sql0029 = await readFile(
        path.join(MIGRATIONS_DIR, "0029_dd29_capability_registry_contract.sql"),
        "utf8",
      );
      await expect(ctx.ownerPool.query(sql0029)).rejects.toThrow(
        /free@1 plans row is missing or no longer matches/i,
      );

      // Prove the whole file rolled back: the corrupted row survives exactly as altered (not
      // silently accepted as canonical), and the old 4 plans rows are untouched too.
      const free = await superuserInDb.query(
        `SELECT price FROM plans WHERE plan_key = 'free' AND version = 1`,
      );
      expect((free.rows[0] as { price: number }).price).toBe(19000);
      const oldPlans = await superuserInDb.query(
        `SELECT plan_key FROM plans WHERE plan_key IN ('free_web','telegram','plus_channel','all_channels') AND version = 1`,
      );
      expect(oldPlans.rows.length).toBe(4);
    } finally {
      await superuserInDb.end();
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

const JOB_DEFINER_BOOTSTRAP_SQL_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "infra",
  "postgres-init",
  "01-job-definer.sql",
);

// Shared by the job_definer and chat_definer cluster-wide-serialization concurrency cases below
// (definer-bootstrap-cluster-wide-serialization). Widens the race window so a genuinely concurrent
// race — two real connections, Promise.all/allSettled, not sequential awaits — reliably exercises
// whichever lock is under test instead of finishing too fast to ever contend.
//
// round-01 (v3) codex review finding: injecting the sleep INSIDE the LOCK TABLE statement's own text
// (the original design) meant a mutation test that removes/neutralizes that statement ALSO destroys the
// injection point, so the "test" only proved the marker-guard below fires — never that the TIMING
// assertion itself depends on a lock actually being held. Anchored instead on JOB_DEFINER_RACE_ANCHOR /
// CHAT_DEFINER_RACE_ANCHOR — the first statement AFTER *both* lock attempts (advisory lock, then LOCK
// TABLE) and unrelated to either one's own text — so removing/neutralizing EITHER lock statement leaves
// the injection point intact and the timing assertion genuinely free to go red.
const JOB_DEFINER_RACE_ANCHOR = "IF v_grant_to IN ('app', 'app_worker', 'readonly') THEN";
const CHAT_DEFINER_RACE_ANCHOR =
  "IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_target) THEN";

async function withSyntheticRaceWindow(
  sql: string,
  seconds: number,
  marker: string,
): Promise<string> {
  if (!sql.includes(marker)) {
    throw new Error(
      `withSyntheticRaceWindow: marker not found (${marker}) — has the file's mechanism changed?`,
    );
  }
  return sql.replace(marker, `PERFORM pg_sleep(${seconds});\n  ${marker}`);
}

// Mirrors DigitalOcean's own documented doadmin attribute set exactly (docs.digitalocean.com/products/
// databases/postgresql/how-to/modify-user-privileges/, confirmed 2026-08-05): CREATEROLE, CREATEDB,
// REPLICATION, BYPASSRLS — deliberately NOT superuser. Used to prove the fail-open degraded-privilege
// design (definer-bootstrap-cluster-wide-serialization contract §5.4.1) and the auto-membership side
// effect (§5.4.2) against a role shaped like the real production credential, not an arbitrary
// non-superuser role. Created via the superuser `admin` connection, which — being superuser — can
// freely grant any attribute set to a scratch role regardless of what that role itself will later be
// able to do.
async function withManagedPostgresAdminRole<T>(
  fn: (roleName: string, password: string) => Promise<T>,
): Promise<T> {
  const roleName = "zz_managed_pg_admin_sim";
  const password = "probe";
  await admin.query(`DROP ROLE IF EXISTS ${roleName}`);
  await admin.query(
    `CREATE ROLE ${roleName} LOGIN NOSUPERUSER CREATEROLE CREATEDB REPLICATION BYPASSRLS PASSWORD '${password}'`,
  );
  try {
    return await fn(roleName, password);
  } finally {
    await admin.query(`DROP ROLE IF EXISTS ${roleName}`);
  }
}

describe("job_definer bootstrap script itself fails closed on runtime-role targets", () => {
  it("refuses a nonexistent configured migration target with the native missing-role error", async () => {
    await withJobDefinerLock(BASE!, async () => {
      const client = await connect(BASE!);
      const missing = `zz_missing_job_target_${randomUUID().replaceAll("-", "")}`;
      try {
        await client.query(`SET job_definer_bootstrap.migration_role = '${missing}'`);
        await expect(bootstrapJobDefiner(client)).rejects.toMatchObject({
          code: "42704",
          message: `role "${missing}" does not exist`,
        });
      } finally {
        try {
          await client.query("RESET job_definer_bootstrap.migration_role");
        } finally {
          await client.end();
        }
      }
    });
  }, 30_000);

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

  it("N=2 concurrent bootstrap calls against DIFFERENT databases in the same cluster genuinely serialize (timing-verified)", async () => {
    // definer-bootstrap-cluster-wide-serialization: job_definer is CLUSTER-global (pg_auth_members is a
    // shared catalog, not per-database), so a concurrent bootstrap from a DIFFERENT database in the same
    // cluster is a real race this file previously had zero protection against. Unlike the chat_definer
    // case below, job_definer has no re-pointing guard (a separately-recorded, deliberately out-of-scope
    // gap), so both calls here target the SAME migration role — this case can only prove what the LOCK
    // TABLE mechanism actually guarantees: (a) genuine serialization, proven by TIMING, not by one call
    // being refused; (b) zero duplicate-grant errors when both callers agree on the same target.
    await withJobDefinerLock(BASE!, async () => {
      await bootstrapJobDefiner(admin);
      const scratchDb = "plexco_migrate_clusterlock_job";
      await admin.query(`DROP DATABASE IF EXISTS ${scratchDb}`);
      await admin.query(`CREATE DATABASE ${scratchDb}`);
      const target = "plexco_job_definer_test_clusterlock_target";
      await admin.query(
        `DO $$ BEGIN CREATE ROLE ${target}; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
      );
      try {
        const sql = await readFile(JOB_DEFINER_BOOTSTRAP_SQL_PATH, "utf8");
        const racySql = await withSyntheticRaceWindow(sql, 2, JOB_DEFINER_RACE_ANCHOR);
        const clientA = await connect(BASE!);
        const clientB = await connect(url(scratchDb));
        try {
          await clientA.query(`SET job_definer_bootstrap.migration_role = '${target}'`);
          await clientB.query(`SET job_definer_bootstrap.migration_role = '${target}'`);
          const startedAt = Date.now();
          const results = await Promise.allSettled([
            clientA.query(racySql),
            clientB.query(racySql),
          ]);
          const elapsedMs = Date.now() - startedAt;
          // Two 2s-holding calls that genuinely serialize take close to the SUM of both holds (~4s+);
          // two that race concurrently finish close to the MAX (~2s). 3000ms cleanly separates the two.
          expect(elapsedMs).toBeGreaterThan(3_000);
          const rejected = results.filter((r) => r.status === "rejected");
          expect(
            rejected,
            `no concurrent bootstrap call targeting the SAME role should fail: ${rejected
              .map((r) => String((r as PromiseRejectedResult).reason))
              .join(" | ")}`,
          ).toEqual([]);
          const granted = await admin.query(
            `SELECT 1 FROM pg_auth_members am
               JOIN pg_roles m ON m.oid = am.member
               JOIN pg_roles r ON r.oid = am.roleid
              WHERE r.rolname = 'job_definer' AND m.rolname = $1`,
            [target],
          );
          expect(granted.rows.length).toBe(1);
        } finally {
          await clientA.end();
          await clientB.end();
        }
      } finally {
        await admin.query(`REVOKE job_definer FROM ${target}`).catch(() => {});
        await admin.query(`DROP ROLE IF EXISTS ${target}`);
        await admin.query(`DROP DATABASE IF EXISTS ${scratchDb}`);
      }
    });
  }, 60_000);

  it("N=2 concurrent DEGRADED (non-superuser) bootstrap calls against the SAME database still serialize via the same-database advisory-lock fallback, even though the cluster-wide LOCK TABLE upgrade cannot be taken", async () => {
    // round-01 codex review (2026-08-05): the FIRST version of this fix removed chat_definer's
    // pre-existing pg_advisory_xact_lock outright, leaving the degraded (production) path with ZERO
    // protection -- a regression, since that lock needs no elevated privilege and would have kept
    // providing same-database serialization there. Both files now take it UNCONDITIONALLY, before
    // attempting the LOCK TABLE upgrade (see the "TWO-LAYER design" comment in both SQL files). This
    // proves the RESTORED fallback actually serializes two genuinely concurrent DEGRADED callers
    // targeting the SAME database -- the exact scenario the regression would have broken, and the
    // realistic production shape (one shared doadmin-like credential, not a distinct one per caller).
    //
    // round-01 (v3) codex review finding: starting from a HIDDEN (fully absent) job_definer, as this
    // test originally did, gives the same false confidence case 14's own comment already documents for
    // chat_definer -- both racing callers' first write is block 1's CREATE ROLE, and PostgreSQL's own
    // unique-index insert would serialize the LOSER against the WINNER'S ENTIRE transaction (including
    // its injected sleep) regardless of whether the advisory lock does anything at all. Pre-create
    // job_definer via `roleName` itself (not `admin`) BEFORE the race: this makes both racing
    // connections' own CREATE ROLE a fast duplicate_object no-op (removing the confound) while keeping
    // both eligible to grant membership to themselves (PG16 auto-grants `roleName` ADMIN OPTION as the
    // actual creator here, SS5.4.2 -- a role's ADMIN OPTION is a property of the ROLE, not of any one
    // connection, so both racing connections -- also authenticated as `roleName` -- inherit it).
    await withJobDefinerLock(BASE!, () =>
      withManagedPostgresAdminRole(async (roleName, password) => {
        await hideRealJobDefiner(admin, async () => {
          const setupClient = await connect(url(BASE_DB, roleName, password));
          try {
            await setupClient.query(await readFile(JOB_DEFINER_BOOTSTRAP_SQL_PATH, "utf8"));
          } finally {
            await setupClient.end();
          }
          const sql = await readFile(JOB_DEFINER_BOOTSTRAP_SQL_PATH, "utf8");
          const racySql = await withSyntheticRaceWindow(sql, 2, JOB_DEFINER_RACE_ANCHOR);
          const clientA = await connect(url(BASE_DB, roleName, password));
          const clientB = await connect(url(BASE_DB, roleName, password));
          const notices: Array<{ severity?: string; message?: string }> = [];
          clientA.on("notice", (n) => notices.push({ severity: n.severity, message: n.message }));
          clientB.on("notice", (n) => notices.push({ severity: n.severity, message: n.message }));
          try {
            const startedAt = Date.now();
            const results = await Promise.allSettled([
              clientA.query(racySql),
              clientB.query(racySql),
            ]);
            const elapsedMs = Date.now() - startedAt;
            // Two 2s-holding calls that genuinely serialize take close to the SUM of both holds (~4s+);
            // two that race concurrently (the regression this test guards against) finish close to the
            // MAX (~2s).
            expect(elapsedMs).toBeGreaterThan(3_000);
            const rejected = results.filter((r) => r.status === "rejected");
            expect(
              rejected,
              `no concurrent DEGRADED bootstrap call targeting the SAME role should fail: ${rejected
                .map((r) => String((r as PromiseRejectedResult).reason))
                .join(" | ")}`,
            ).toEqual([]);
            // Both callers independently attempt the LOCK TABLE upgrade and independently fail it —
            // two DEGRADED warnings expected, not one (the setup call's own warning is not captured —
            // no notice listener was attached to setupClient).
            const warnings = notices.filter((n) => n.severity === "WARNING");
            expect(
              warnings.filter((n) => /^job_definer bootstrap: DEGRADED/.test(n.message ?? "")),
            ).toHaveLength(2);
            const granted = await admin.query(
              `SELECT 1 FROM pg_auth_members am
                 JOIN pg_roles m ON m.oid = am.member
                 JOIN pg_roles r ON r.oid = am.roleid
                WHERE r.rolname = 'job_definer' AND m.rolname = $1
                LIMIT 1`,
              [roleName],
            );
            expect(granted.rows.length).toBe(1);
          } finally {
            await clientA.end();
            await clientB.end();
          }
          // No explicit job_definer cleanup here — hideRealJobDefiner's own finally now
          // unconditionally revokes schema usage and drops it (round-01 v3 review finding; see that
          // helper's own comment).
        });
      }),
    );
  }, 60_000);
});

// Raw-file-content path, mirrors JOB_DEFINER_BOOTSTRAP_SQL_PATH above: several tests below read
// 02-chat-definer.sql's own text directly (regex matching, race-window injection) rather than only
// calling the imported bootstrapChatDefiner function.
const CHAT_DEFINER_BOOTSTRAP_SQL_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "infra",
  "postgres-init",
  "02-chat-definer.sql",
);

describe("03-identity-definer.sql mirrors 02-chat-definer.sql (DD-127 / DD-131 OD-3)", () => {
  it("is 02 statement for statement, with only the role name, GUC and in-script lock key swapped", async () => {
    // Comments dropped and whitespace trimmed; the GUC is `<role>_bootstrap.migration_role`, so the
    // role swap covers it. Equal text means every 02 bootstrap test in this file also covers 03.
    // A `--` only starts a comment OUTSIDE a single-quoted literal: several RAISE texts contain
    // " -- ", and a plain /--.*$/ would cut them (and their closing quote) out of the comparison.
    const stripComment = (line: string) => {
      let quoted = false;
      for (let i = 0; i < line.length; i++) {
        if (line[i] === "'") quoted = !quoted;
        else if (!quoted && line.startsWith("--", i)) return line.slice(0, i);
      }
      return line;
    };
    const norm = (sql: string, role: string, lockKey: string) =>
      sql
        .split("\n")
        .map((line) => stripComment(line).trim())
        .filter(Boolean)
        .join("\n")
        .replaceAll(role, "DEFINER")
        .replaceAll(lockKey, "LOCK_KEY");
    const chat = norm(
      await actualFsPromises.readFile(CHAT_DEFINER_BOOTSTRAP_SQL_PATH, "utf8"),
      "chat_definer",
      "1667525739",
    );
    const identity = norm(
      await actualFsPromises.readFile(
        path.join(path.dirname(CHAT_DEFINER_BOOTSTRAP_SQL_PATH), "03-identity-definer.sql"),
        "utf8",
      ),
      "identity_definer",
      "1768189035",
    );
    expect(identity).toContain("CREATE ROLE DEFINER");
    // Proves the literal-aware stripping kept a RAISE text whole past its own " -- ".
    expect(identity).toContain("DEGRADED -- cannot acquire the cluster-wide serialization lock");
    expect(identity).toBe(chat);
  });
});

async function hideRealChatDefiner(superuser: pg.Client, fn: () => Promise<void>): Promise<void> {
  const existing = await superuser.query(`SELECT 1 FROM pg_roles WHERE rolname = 'chat_definer'`);
  const hadRealRole = existing.rows.length > 0;
  if (hadRealRole) {
    await superuser.query(`ALTER ROLE chat_definer RENAME TO chat_definer_hidden_for_test`);
  }
  try {
    await fn();
  } finally {
    // codex round-06 [P2] + audit finding (this session): the round-06 fix unconditionally cleared a
    // leftover scratch chat_definer only inside the hadRealRole branch, because it only reasoned about
    // the rename-back colliding with one. But the same root cause -- a caller's assertion throwing
    // before ITS OWN cleanup line runs -- is just as reachable when hadRealRole is false, which is the
    // common case in a test database with no production chat_definer to hide. That orphan then survives
    // to the NEXT test's existence check, which misreads it as a real role, hides it via a pointless
    // rename, and the ORIGINAL failing test's assertion gets buried under a confusing secondary
    // "duplicate object" / "cannot be dropped, objects depend on it" error several tests later --
    // exactly the failure-mode-laundering this whole audit exists to catch, just in the harness instead
    // of the script under test. Unconditional either way; the rename-back only applies when there was a
    // real role to restore.
    await superuser.query(`DROP ROLE IF EXISTS chat_definer`);
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

describe.each([
  { name: "job_definer", sqlPath: JOB_DEFINER_BOOTSTRAP_SQL_PATH },
  { name: "chat_definer", sqlPath: CHAT_DEFINER_BOOTSTRAP_SQL_PATH },
])("$name catalog snapshot guards", ({ sqlPath }) => {
  it.each([
    { index: 0, phase: "pre-grant" },
    { index: 1, phase: "post-grant" },
  ])("$phase guard tolerates an unrelated role dropped after its snapshot", async ({ index }) => {
    await withJobDefinerLock(BASE!, () =>
      withChatDefinerLock(BASE!, () =>
        hideRealChatDefiner(admin, async () => {
          await bootstrapChatDefiner(admin);
          const source = await readFile(sqlPath, "utf8");
          const guards =
            source.match(
              /SELECT rolname INTO v_existing_runtime_member\s+FROM pg_roles\s+WHERE rolname IN \('app', 'app_worker', 'readonly'\)\s+AND pg_has_role\((?:rolname|oid), '(?:job_definer|chat_definer)', 'MEMBER'\)\s+LIMIT 1;/g,
            ) ?? [];
          expect(guards).toHaveLength(2);
          // Execute the shipped predicate, changing only PL/pgSQL's destination clause.
          const query = guards[index]!.replace(" INTO v_existing_runtime_member", "");
          const scratchRole = `plexco_catalog_snapshot_${randomUUID().replaceAll("-", "")}`;
          const reader = await connect(BASE!);
          try {
            await admin.query(`CREATE ROLE ${scratchRole} NOLOGIN`);
            await reader.query("BEGIN");
            // DECLARE fixes the statement snapshot before the other connection commits DROP.
            await reader.query(`DECLARE bootstrap_guard NO SCROLL CURSOR FOR ${query}`);
            await admin.query(`DROP ROLE ${scratchRole}`);
            const result = await reader.query("FETCH ALL FROM bootstrap_guard");
            expect(result.rows).toEqual([]);
          } finally {
            try {
              await reader.query("ROLLBACK");
            } finally {
              try {
                await reader.end();
              } finally {
                await admin.query(`DROP ROLE IF EXISTS ${scratchRole}`);
              }
            }
          }
        }),
      ),
    );
  });
});

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

  it("the unsafe-options EXISTS check examines every grant record for the target, not one arbitrary row", async () => {
    // codex round-04 [P1]: PG16 allows multiple pg_auth_members rows for the same (role, member)
    // pair from different grantors ("Allow multiple role membership records" -- release notes;
    // pre-16 a new grant replaced the prior row). A non-STRICT SELECT INTO with no ORDER BY could
    // pick an arbitrary one of them and miss an unsafe record left by a different grantor. Fixed by
    // replacing the single-row SELECT INTO with the EXISTS check at SS5.1.
    //
    // codex round-06 [P1]: the ORIGINAL version of this test tried to exercise that fix through a
    // full bootstrapChatDefiner() round-trip, using a second grantor role to create the second row.
    // That is unreachable: PostgreSQL requires a non-superuser grantor to hold live ADMIN OPTION
    // (membership) before it can be named via GRANTED BY, and holding that membership makes it a
    // SECOND, DIFFERENT chat_definer member -- which SS5.1's re-pointing guard (checking "any member
    // other than v_target") correctly refuses BEFORE the unsafe-options check is ever reached. This
    // was verified exhaustively this session: a second SUPERUSER collapses onto one grantor row
    // (round-06's original bug); a non-superuser CREATEROLE+BYPASSRLS grantor is refused outright
    // ("permission denied... only roles with ADMIN option... may grant this role" -- PG16 tightened
    // this from pre-16); and a role attempting to grant itself a second, differently-attributed row
    // is refused ("ADMIN option cannot be granted back to your own grantor"). There is no reachable
    // state, via ordinary GRANT statements, with two distinct grantor rows for one member and no
    // second live member -- which also means the re-pointing guard already closes this exact class
    // of multi-grantor attack for free, in every state a real client can produce.
    //
    // The EXISTS fix therefore is not a gap the full script can be driven into today; it is defense
    // in depth against states that are NOT reachable via GRANT (a future re-pointing-guard change, a
    // different script version without one, or direct catalog manipulation). This test proves the
    // query itself is correct against exactly that kind of state, constructed directly rather than
    // through bootstrapChatDefiner.
    //
    // codex round-07 [P2]: the prior version hand-duplicated SS5.1's EXISTS condition as a literal
    // string, which the audit (SS11.3) confirmed is disconnected from the real file -- mutating the
    // production predicate does not turn this test red. Fixed by EXTRACTING the exact EXISTS(...)
    // block from the loaded SQL text (never hand-copied) and running that extracted predicate,
    // parameterized, against the directly-constructed two-row state. A regression to the production
    // condition now changes what this test actually executes, closing the disconnect structurally
    // rather than by convention.
    //
    // codex round-07 [P2]: the prior version's cleanup (REVOKE + DROP ROLE chat_definer) sat after
    // the assertions with no guard, so a failing assertion skipped it and the outer finally's
    // `DROP ROLE otherGrantor` then failed on a dependent grant record, burying the real
    // AssertionError under a confusing secondary one (found and left open in SS11.3; closed here).
    // Dropping the GROUP role directly removes every chat_definer membership row regardless of
    // grantor (confirmed empirically this session, SS11.1's hideRealChatDefiner fix), so a bare
    // `DROP ROLE IF EXISTS chat_definer` in a guaranteed nested finally is sufficient -- no separate
    // REVOKE needed.
    await withChatDefinerLock(BASE!, () =>
      hideRealChatDefiner(admin, async () => {
        const target = "plexco_chat_definer_test_grantor_target";
        const otherGrantor = "plexco_chat_definer_test_grantor_b";
        await admin.query(
          `DO $$ BEGIN CREATE ROLE ${target}; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
        );
        await admin.query(
          `DO $$ BEGIN CREATE ROLE ${otherGrantor}; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
        );
        try {
          // Use the real bootstrap to create chat_definer with its exact attributes and the first
          // (safe) grant record, rather than hand-duplicating the attribute list here.
          await admin.query(`SET chat_definer_bootstrap.migration_role = '${target}'`);
          try {
            await bootstrapChatDefiner(admin);
          } finally {
            await admin.query(`RESET chat_definer_bootstrap.migration_role`);
          }
          await admin.query(`GRANT chat_definer TO ${otherGrantor} WITH ADMIN TRUE`);
          // Safe row already exists (grantor: bootstrap superuser, from bootstrapChatDefiner above);
          // this adds the unsafe SECOND row (grantor: otherGrantor) for the SAME target -- the
          // non-STRICT bug this fix closes picked whichever row postgres returned first, which was
          // never guaranteed to be either specific one.
          await admin.query(
            `GRANT chat_definer TO ${target} WITH ADMIN TRUE GRANTED BY ${otherGrantor}`,
          );
          try {
            const grantors = await admin.query(
              `SELECT DISTINCT g.rolname AS grantor
                 FROM pg_auth_members m
                 JOIN pg_roles r ON r.oid = m.member
                 JOIN pg_roles role_ ON role_.oid = m.roleid
                 JOIN pg_roles g ON g.oid = m.grantor
                WHERE role_.rolname = 'chat_definer' AND r.rolname = '${target}'`,
            );
            expect(grantors.rows.length).toBe(2); // genuinely two distinct grantor records, not one

            const sql = await readFile(CHAT_DEFINER_BOOTSTRAP_SQL_PATH, "utf8");
            // The \n right after "(" is load-bearing: SS5.1 also has an earlier single-line
            // `EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_target)` (the migration-role
            // existence check) that a bare `EXISTS \(` would match first, then lazily swallow
            // everything up to THIS block's own close -- self-caught the first time this was written.
            const existsMatch = sql.match(/(EXISTS \(\n[\s\S]+?\n {2}\)) THEN/);
            const existsBlock = existsMatch?.[1];
            if (!existsBlock) {
              throw new Error(
                "could not locate the unsafe-options EXISTS block in 02-chat-definer.sql -- the " +
                  "extraction regex needs updating alongside whatever changed its shape",
              );
            }
            const existsPredicate = existsBlock.replace("v_target", "$1");
            const unsafeExists = await admin.query(`SELECT ${existsPredicate} AS found`, [target]);
            expect((unsafeExists.rows[0] as { found: boolean }).found).toBe(true);
          } finally {
            await admin.query(`DROP ROLE IF EXISTS chat_definer`);
          }
        } finally {
          await admin.query(`DROP ROLE ${otherGrantor}`);
          await admin.query(`DROP ROLE ${target}`);
        }
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

  it("refuses to bootstrap when chat_definer already exists as a member of another role, even with INHERIT overriding its own NOINHERIT", async () => {
    // codex round 12 [P1] (prior registration's MAX_ROUNDS halt): PostgreSQL 16 lets a per-grant
    // WITH INHERIT TRUE override chat_definer's own NOINHERIT for that specific membership
    // (postgresql.org/docs/16/role-attributes.html: "inheritance can be overridden for individual
    // grants"), so a chat_definer with every attribute column exactly correct can still silently
    // inherit another role's privileges through such a grant -- invisible to the attribute-only
    // check SS5.1 block 2 had before this fix. Verified empirically against the real bootstrap
    // script (this session, before landing this regression): a scratch superuser role granted TO a
    // correctly-attributed chat_definer WITH INHERIT TRUE gave pg_has_role(..., 'USAGE') = true
    // despite chat_definer.rolinherit reading false, and running the real script against that state
    // raised exactly the message this test asserts on.
    await withChatDefinerLock(BASE!, () =>
      hideRealChatDefiner(admin, async () => {
        const privilegedRole = "plexco_chat_definer_test_privileged";
        await admin.query(
          `DO $$ BEGIN CREATE ROLE ${privilegedRole} SUPERUSER; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
        );
        await admin.query(
          `CREATE ROLE chat_definer NOLOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION`,
        );
        await admin.query(`GRANT ${privilegedRole} TO chat_definer WITH INHERIT TRUE`);
        try {
          await expect(bootstrapChatDefiner(admin)).rejects.toThrow(
            /chat_definer is unexpectedly a member of/i,
          );
          expect(await chatDefinerMembers(admin)).toEqual([]);
          const stillMember = await admin.query(
            `SELECT 1 FROM pg_auth_members m
               JOIN pg_roles g ON g.oid = m.roleid
               JOIN pg_roles r ON r.oid = m.member
              WHERE r.rolname = 'chat_definer' AND g.rolname = '${privilegedRole}'`,
          );
          expect(stillMember.rows.length).toBe(1); // fail-closed, not silently revoked
        } finally {
          await admin.query(`REVOKE ${privilegedRole} FROM chat_definer`);
          await admin.query(`DROP ROLE chat_definer`);
          await admin.query(`DROP ROLE ${privilegedRole}`);
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
    // Audit finding (this session): the original /already granted/i regex also matches the
    // re-pointing guard's message ("chat_definer is already granted to % -- refusing to also grant
    // it to %"), which independently fires here too since app_worker != CURRENT_USER (the implicit
    // v_target). The test passed even with the pre-grant runtime-member check (SS5.1) disabled,
    // for a reason unrelated to what it claims to prove. Tightened to the exact distinguishing
    // phrase this specific check raises, so only it can satisfy the assertion.
    await withChatDefinerLock(BASE!, () =>
      hideRealChatDefiner(admin, async () => {
        await bootstrapChatDefiner(admin);
        await admin.query(`GRANT chat_definer TO app_worker`);
        try {
          await expect(bootstrapChatDefiner(admin)).rejects.toThrow(
            /already granted to a runtime role/i,
          );
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
    // Audit finding (this session): /does not exist/i also matches PostgreSQL's OWN native error
    // from the later `GRANT chat_definer TO %I` (role "..." does not exist, no "migration" word) --
    // the explicit SS5.1 pre-check this test targets can be disabled entirely and the test still
    // passes, because the script fails closed downstream regardless (same atomic-rollback outcome,
    // just a less specific message). Tightened to the exact phrase only the explicit check raises.
    await withChatDefinerLock(BASE!, () =>
      hideRealChatDefiner(admin, async () => {
        await admin.query(
          `SET chat_definer_bootstrap.migration_role = 'zz_chat_definer_never_created_role'`,
        );
        try {
          await expect(bootstrapChatDefiner(admin)).rejects.toThrow(
            /migration role .* does not exist/i,
          );
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

  it("N concurrent bootstrap calls targeting DIFFERENT valid migration roles: exactly one succeeds, no member accumulates", async () => {
    // codex round-03 [P1]: the previous concurrent test only exercises the SAME target, which the
    // re-pointing guard's own read handles fine even under a race (every caller resolves the
    // identical row). A DIFFERENT-target race is the one the serialization statement in block 3 exists
    // to serialize: without it, N concurrent calls could each observe zero existing members and all
    // GRANT their own distinct target before any of them commits.
    //
    // STALE COMMENT UPDATED TWICE (definer-bootstrap-cluster-wide-serialization, 2026-08-05): this test
    // originally exercised pg_advisory_xact_lock alone. round-00's fix replaced it with LOCK TABLE
    // pg_auth_members and briefly removed the advisory lock outright; round-01's codex review found that
    // a REGRESSION (chat_definer's degraded/production path lost the same-database protection it
    // previously had) and restored the advisory lock as an UNCONDITIONAL fallback, taken before LOCK
    // TABLE is attempted (see 02-chat-definer.sql's own block 3 "TWO-LAYER design" comment and
    // docs/autopilot-definer-bootstrap-cluster-wide-serialization.md §9.4). So this test's own SAME
    // mechanism (the advisory lock) is still exactly what it exercises today — this test's assertions
    // were never wrong, only this comment's account of what SQL text backs them. The outcome it proves
    // (exactly one caller succeeds, no member accumulates) also holds under the LOCK TABLE upgrade layer
    // when superuser is available, and the "N=2 concurrent bootstrap calls against DIFFERENT databases"
    // case below exists to prove that upgrade closes the cross-database gap this test's own advisory
    // lock cannot (database-local, §5.1).
    //
    // Audit finding (this session): starting from a HIDDEN (fully absent) chat_definer, as this test
    // originally did, gives false confidence. All N callers' first write is block 1's `CREATE ROLE
    // chat_definer`, and PostgreSQL's own unique-index insert forces every loser to BLOCK until the
    // winner's transaction commits or rolls back -- by which point the winner's GRANT (same
    // transaction) has already committed too, so the re-pointing guard alone finishes the job. The
    // serialization statement was never exercised; disabling it left this test green across 8/8 empirical runs.
    // Pre-creating chat_definer bare and COMMITTED here removes that accidental serialization: block 1
    // resolves instantly for every caller (no insert to wait on), so only the lock -- or lack of it --
    // determines the outcome. Confirmed empirically: with the lock disabled and this fixture, 4/4
    // concurrent calls fulfilled and chat_definer ended up with 4 members, reproducibly.
    await withChatDefinerLock(BASE!, () =>
      hideRealChatDefiner(admin, async () => {
        await admin.query(
          `DO $$ BEGIN CREATE ROLE chat_definer NOLOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION; EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL; END $$;`,
        );
        const N = 4;
        const targets = Array.from({ length: N }, (_, i) => `plexco_chat_definer_test_race_${i}`);
        for (const t of targets) {
          await admin.query(
            `DO $$ BEGIN CREATE ROLE ${t}; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
          );
        }
        try {
          const clients = await Promise.all(Array.from({ length: N }, () => connect(BASE!)));
          try {
            await Promise.all(
              clients.map((c, i) =>
                c.query(`SET chat_definer_bootstrap.migration_role = '${targets[i]}'`),
              ),
            );
            const results = await Promise.allSettled(clients.map((c) => bootstrapChatDefiner(c)));
            const fulfilled = results.filter((r) => r.status === "fulfilled");
            const rejected = results.filter((r) => r.status === "rejected");
            expect(fulfilled.length).toBe(1);
            expect(rejected.length).toBe(N - 1);
            for (const r of rejected) {
              expect(String((r as PromiseRejectedResult).reason)).toMatch(/already granted to/i);
            }
            const members = await chatDefinerMembers(admin);
            expect(members).toHaveLength(1);
            expect(targets).toContain(members[0]);
          } finally {
            await Promise.all(clients.map((c) => c.end()));
          }
        } finally {
          await admin.query(`DROP ROLE IF EXISTS chat_definer`);
          for (const t of targets) {
            await admin.query(`DROP ROLE ${t}`);
          }
        }
      }),
    );
  }, 60_000);

  it("N=2 concurrent bootstrap calls against DIFFERENT databases in the same cluster serialize correctly; at most one non-runtime member ever exists", async () => {
    // definer-bootstrap-cluster-wide-serialization: chat_definer is CLUSTER-global, so — unlike the case
    // above, which only proves same-database serialization — this proves the LOCK TABLE mechanism closes
    // the cross-database gap the prior pg_advisory_xact_lock mechanism could not (that lock is
    // database-local; see docs/autopilot-definer-bootstrap-cluster-wide-serialization.md §5.1). This is
    // the assertion that goes red if the LOCK TABLE statement is removed: without it, both callers can
    // observe zero existing members and both succeed, landing two members and never triggering the
    // re-pointing guard's rejection at all (verified by mutation-testing during implementation).
    //
    // round-01 (v3) codex review finding: this test originally started from a HIDDEN (fully absent)
    // chat_definer, exactly the false-confidence shape case 14's own comment above documents — both
    // racing callers' first write would be block 1's CREATE ROLE, and PostgreSQL's own unique-index
    // insert alone would serialize the loser against the winner's full transaction regardless of the
    // LOCK TABLE statement's presence. Pre-creating chat_definer bare and COMMITTED here (mirroring case
    // 14's own established fix for the identical confound) removes that accidental serialization: block
    // 1 resolves instantly for both callers, so only the LOCK TABLE statement — or its absence —
    // determines the timing.
    await withChatDefinerLock(BASE!, () =>
      hideRealChatDefiner(admin, async () => {
        await admin.query(
          `DO $$ BEGIN CREATE ROLE chat_definer NOLOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION; EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL; END $$;`,
        );
        const scratchDb = "plexco_migrate_clusterlock_chat_b";
        await admin.query(`DROP DATABASE IF EXISTS ${scratchDb}`);
        await admin.query(`CREATE DATABASE ${scratchDb}`);
        const targetA = "plexco_chat_definer_test_clusterlock_a";
        const targetB = "plexco_chat_definer_test_clusterlock_b";
        await admin.query(
          `DO $$ BEGIN CREATE ROLE ${targetA}; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
        );
        await admin.query(
          `DO $$ BEGIN CREATE ROLE ${targetB}; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
        );
        try {
          const sql = await readFile(CHAT_DEFINER_BOOTSTRAP_SQL_PATH, "utf8");
          const racySql = await withSyntheticRaceWindow(sql, 2, CHAT_DEFINER_RACE_ANCHOR);
          const clientA = await connect(BASE!);
          const clientB = await connect(url(scratchDb));
          try {
            await clientA.query(`SET chat_definer_bootstrap.migration_role = '${targetA}'`);
            await clientB.query(`SET chat_definer_bootstrap.migration_role = '${targetB}'`);
            const startedAt = Date.now();
            const results = await Promise.allSettled([
              clientA.query(racySql),
              clientB.query(racySql),
            ]);
            const elapsedMs = Date.now() - startedAt;
            // Two 2s-holding calls that genuinely serialize take close to the SUM of both holds (~4s+);
            // two that race concurrently (the pre-fix behavior) finish close to the MAX (~2s).
            expect(elapsedMs).toBeGreaterThan(3_000);
            const fulfilled = results.filter((r) => r.status === "fulfilled");
            const rejected = results.filter((r) => r.status === "rejected");
            expect(fulfilled.length).toBe(1);
            expect(rejected.length).toBe(1);
            expect(String((rejected[0] as PromiseRejectedResult).reason)).toMatch(
              /already granted to/i,
            );
            const members = await chatDefinerMembers(admin);
            expect(members).toHaveLength(1);
            expect([targetA, targetB]).toContain(members[0]);
          } finally {
            await clientA.end();
            await clientB.end();
          }
        } finally {
          await admin.query(`DROP ROLE IF EXISTS chat_definer`);
          await admin.query(`DROP ROLE IF EXISTS ${targetA}`);
          await admin.query(`DROP ROLE IF EXISTS ${targetB}`);
          await admin.query(`DROP DATABASE IF EXISTS ${scratchDb}`);
        }
      }),
    );
  }, 60_000);

  it("N=2 concurrent DEGRADED (non-superuser) chat_definer bootstrap calls against the SAME database still serialize via the same-database advisory-lock fallback (timing-verified), even though the cluster-wide LOCK TABLE upgrade cannot be taken", async () => {
    // round-01 (v3) codex review finding: the "both files, degraded path" case below proves the
    // DEGRADED WARNING itself fires correctly for chat_definer, but with only ONE degraded caller it
    // cannot prove the RESTORED advisory-lock fallback actually SERIALIZES two concurrent degraded
    // callers -- the exact regression round-01 (v2 registration) found and fixed. The job_definer
    // sibling case above proves this for job_definer; this is chat_definer's own dedicated behavioral
    // proof, not just the manifest's grep check on the SQL text.
    //
    // chat_definer is pre-created via the SUPERUSER `admin` connection deliberately, not via the
    // degraded `roleName` used to race below: this means NEITHER racing caller has ADMIN OPTION on
    // chat_definer (only its actual creator would, per PG16's auto-membership side effect, SS5.4.2), so
    // both are EXPECTED to fail at the final `EXECUTE format('GRANT chat_definer TO %I', ...)` step via
    // ordinary PostgreSQL permission semantics ("permission denied to grant role... Only roles with the
    // ADMIN option... may grant this role") -- deliberately DIFFERENT from, and avoiding, the
    // pre-existing "unsafe membership options"/"re-pointing" bug (SS10 item 7) this test does not exist
    // to exercise (that bug fires only when the DEGRADED caller is itself chat_definer's creator).
    // Failure mode aside, the TIMING proof below is unaffected: it depends only on the advisory lock,
    // acquired (or not) identically regardless of what happens afterward.
    await withChatDefinerLock(BASE!, () =>
      withManagedPostgresAdminRole(async (roleName, password) => {
        await hideRealChatDefiner(admin, async () => {
          await admin.query(
            `DO $$ BEGIN CREATE ROLE chat_definer NOLOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION; EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL; END $$;`,
          );
          const sql = await readFile(CHAT_DEFINER_BOOTSTRAP_SQL_PATH, "utf8");
          const racySql = await withSyntheticRaceWindow(sql, 2, CHAT_DEFINER_RACE_ANCHOR);
          const clientA = await connect(url(BASE_DB, roleName, password));
          const clientB = await connect(url(BASE_DB, roleName, password));
          const notices: Array<{ severity?: string; message?: string }> = [];
          clientA.on("notice", (n) => notices.push({ severity: n.severity, message: n.message }));
          clientB.on("notice", (n) => notices.push({ severity: n.severity, message: n.message }));
          try {
            const startedAt = Date.now();
            const results = await Promise.allSettled([
              clientA.query(racySql),
              clientB.query(racySql),
            ]);
            const elapsedMs = Date.now() - startedAt;
            // Two 2s-holding calls that genuinely serialize take close to the SUM of both holds (~4s+);
            // two that race concurrently (the regression this test guards against) finish close to the
            // MAX (~2s).
            expect(elapsedMs).toBeGreaterThan(3_000);
            const rejected = results.filter((r) => r.status === "rejected");
            expect(rejected).toHaveLength(2);
            for (const r of rejected) {
              expect(String((r as PromiseRejectedResult).reason)).toMatch(
                /permission denied to grant role/i,
              );
            }
            const warnings = notices.filter((n) => n.severity === "WARNING");
            expect(
              warnings.filter((n) => /^chat_definer bootstrap: DEGRADED/.test(n.message ?? "")),
            ).toHaveLength(2);
          } finally {
            await clientA.end();
            await clientB.end();
          }
          // No explicit chat_definer cleanup here — hideRealChatDefiner's own finally already
          // unconditionally drops it regardless of outcome.
        });
      }),
    );
  }, 60_000);

  it("refuses to bootstrap when chat_definer already exists with any one of the other six wrong attributes", async () => {
    // codex round-03 [P2]: the SQL's attribute-drift check is a single OR across 7 columns; only
    // rolcanlogin (case above) had a dedicated regression, so a regression dropping any of the other
    // 6 branches from that OR would leave the suite green. One full-assertion case (membership stays
    // empty, the wrong attribute is left untouched) already exists above; these 6 only need to prove
    // rejection, since the whole-transaction-rollback property they'd otherwise re-verify is not
    // per-attribute-dependent.
    const safeFlags = {
      rolsuper: "NOSUPERUSER",
      rolcanlogin: "NOLOGIN",
      rolbypassrls: "BYPASSRLS",
      rolcreatedb: "NOCREATEDB",
      rolcreaterole: "NOCREATEROLE",
      rolinherit: "NOINHERIT",
      rolreplication: "NOREPLICATION",
    };
    const variants: Array<keyof typeof safeFlags> = [
      "rolsuper",
      "rolbypassrls",
      "rolcreatedb",
      "rolcreaterole",
      "rolinherit",
      "rolreplication",
    ];
    const badFlag: Record<keyof typeof safeFlags, string> = {
      rolsuper: "SUPERUSER",
      rolcanlogin: "LOGIN",
      rolbypassrls: "NOBYPASSRLS",
      rolcreatedb: "CREATEDB",
      rolcreaterole: "CREATEROLE",
      rolinherit: "INHERIT",
      rolreplication: "REPLICATION",
    };
    await withChatDefinerLock(BASE!, () =>
      hideRealChatDefiner(admin, async () => {
        for (const column of variants) {
          const flags = { ...safeFlags, [column]: badFlag[column] };
          await admin.query(`CREATE ROLE chat_definer ${Object.values(flags).join(" ")}`);
          try {
            await expect(bootstrapChatDefiner(admin)).rejects.toThrow(/unexpected attributes/i);
          } finally {
            await admin.query(`DROP ROLE chat_definer`);
          }
        }
      }),
    );
  }, 30_000);

  it("when the connecting role cannot acquire the cluster-wide lock (mirroring DigitalOcean's doadmin), the LOCK TABLE statement itself degrades loudly instead of aborting silently for both files — job_definer's bootstrap transaction then commits without aborting (though its own unrelated final schema-usage grant separately no-ops under this role, §10 item 8, not this mechanism's concern); chat_definer's is separately refused by a pre-existing, unrelated check (documented, not fixed here)", async () => {
    // definer-bootstrap-cluster-wide-serialization §5.4.1: DigitalOcean Managed PostgreSQL never grants
    // superuser, so LOCK TABLE pg_auth_members fails there with insufficient_privilege. The design is
    // fail-OPEN with a loud RAISE WARNING, not a silent no-op and not a hard abort — proven here for
    // BOTH bootstrap files against one scratch role shaped exactly like doadmin's own documented
    // attributes (CREATEROLE, CREATEDB, REPLICATION, BYPASSRLS, no SUPERUSER).
    await withManagedPostgresAdminRole(async (roleName, password) => {
      const scratchClient = await connect(url(BASE_DB, roleName, password));
      const notices: Array<{ severity?: string; message?: string }> = [];
      scratchClient.on("notice", (n) => notices.push({ severity: n.severity, message: n.message }));
      try {
        await withJobDefinerLock(BASE!, () =>
          hideRealJobDefiner(admin, async () => {
            const jobSql = await readFile(JOB_DEFINER_BOOTSTRAP_SQL_PATH, "utf8");
            await expect(scratchClient.query(jobSql)).resolves.toBeDefined();
            const jobGranted = await admin.query(
              `SELECT 1 FROM pg_auth_members am
                 JOIN pg_roles m ON m.oid = am.member
                 JOIN pg_roles r ON r.oid = am.roleid
                WHERE r.rolname = 'job_definer' AND m.rolname = $1
                LIMIT 1`,
              [roleName],
            );
            // LIMIT 1, not an exact count: PostgreSQL 16 allows multiple pg_auth_members rows for the
            // same (role, member) pair from different grantors (§5.4.2's own auto-membership finding —
            // the CREATE-time auto-grant and the bootstrap's own explicit GRANT are two separate
            // records here), so this only proves membership EXISTS, not how many records back it.
            expect(jobGranted.rows.length).toBe(1);
            // No explicit job_definer cleanup here — hideRealJobDefiner's own finally now
            // unconditionally revokes schema usage and drops it even if an assertion above throws
            // (round-01 v3 review finding; see that helper's own comment).
          }),
        );

        // NEWLY DISCOVERED, SEVERE finding (this session, via this exact test): unlike job_definer,
        // chat_definer's bootstrap CANNOT COMPLETE under ANY non-superuser CREATEROLE scenario. All
        // three natural cases were tested empirically:
        //   1. self-targeting fresh creation (what this test exercises below): chat_definer's own
        //      "unsafe membership options" check (chat-definer-role-provisioning/AP-47 codex round-04,
        //      unrelated to this slice) refuses — it sees its OWN just-created PG16 auto-granted
        //      (§5.4.2) ADMIN-OPTION record on the connecting role and treats it as an unsafe grant.
        //   2. different-target fresh creation: chat_definer's "re-pointing" guard refuses instead,
        //      reading that SAME auto-grant as "already granted to a different role".
        //   3. re-run against an ALREADY-EXISTING chat_definer created by someone else: ordinary
        //      Postgres refuses the GRANT itself — "permission denied to grant role... Only roles with
        //      the ADMIN option... may grant this role" — since the connecting role never had ADMIN
        //      OPTION on chat_definer to begin with (it did not create it).
        // Every path is blocked. This means chat_definer's bootstrap, AS MERGED TODAY, can never
        // succeed on the real target production host (DigitalOcean Managed PostgreSQL, doadmin, no true
        // superuser) — a materially more severe conclusion than the already-merged §5.4.2 note's
        // "benign when MIGRATION_ROLE is unset". NOT fixed here: this slice's negative scope is the
        // serialization mechanism only, not chat_definer's existing fail-closed checks or Postgres's own
        // GRANT/ADMIN-OPTION semantics. What this test proves instead, and what IS this slice's own
        // responsibility: the LOCK TABLE mechanism itself still degrades correctly in ISOLATION — the
        // WARNING fires and the transaction does not abort AT THAT STATEMENT (confirmed by the notice
        // assertion below capturing it) — before the SEPARATE, pre-existing check refuses the overall
        // bootstrap for its own, unrelated reason, rolling back the whole transaction (including the
        // role creation itself — verified empirically: chat_definer does not exist afterward, so no
        // extra cleanup is needed here beyond hideRealChatDefiner's own unconditional DROP ROLE IF
        // EXISTS). See docs/autopilot-definer-bootstrap-cluster-wide-serialization.md §10 for the full
        // writeup and the recommended (not implemented here) follow-up.
        await withChatDefinerLock(BASE!, () =>
          hideRealChatDefiner(admin, async () => {
            const chatSql = await readFile(CHAT_DEFINER_BOOTSTRAP_SQL_PATH, "utf8");
            await expect(scratchClient.query(chatSql)).rejects.toThrow(/unsafe grant record/i);
          }),
        );

        // Not an exact total count: job_definer's own bootstrap (unchanged by this slice) issues a bare
        // `GRANT USAGE ON SCHEMA public TO job_definer;` as its FINAL statement, outside any DO block —
        // when run by this non-superuser scratch role, that GRANT itself no-ops with Postgres's OWN
        // native WARNING ("no privileges were granted for \"public\""), a genuinely new finding this
        // end-to-end test surfaced (the manual §5.4.1 probe used a simplified sequence, not this exact
        // file). Pre-existing, unedited behavior, outside this slice's negative scope to fix — recorded
        // in docs/autopilot-definer-bootstrap-cluster-wide-serialization.md §10 item 8 (codex round-06,
        // gate-attempt-06: item 8 did not exist when this comment was first written, an actual gap this
        // round corrected, not just a wrong pointer). This test asserts on the SPECIFIC DEGRADED warnings
        // this slice's own mechanism is responsible for, not this schema-usage no-op nor a total warning
        // count — it does not, and is not intended to, verify job_definer's effective schema privileges.
        const warnings = notices.filter((n) => n.severity === "WARNING");
        expect(
          warnings.some((n) =>
            /^job_definer bootstrap: DEGRADED.*cannot acquire.*lock/i.test(n.message ?? ""),
          ),
        ).toBe(true);
        expect(
          warnings.some((n) =>
            /^chat_definer bootstrap: DEGRADED.*cannot acquire.*lock/i.test(n.message ?? ""),
          ),
        ).toBe(true);

        // §5.4.2 auto-membership finding, documented here for job_definer — NOT asserted as a pass/fail
        // condition: PostgreSQL 16 auto-grants a CREATEROLE-holding creator membership (with ADMIN
        // OPTION) in any role it creates, so `roleName` itself was ALSO a member of job_definer
        // (before this test's own cleanup dropped it above) — real and expected, not a defect. For
        // chat_definer the same auto-grant is what makes its bootstrap refuse outright (see the large
        // comment above) rather than merely leaving a documented side effect.
      } finally {
        await scratchClient.end();
        // No explicit chat_definer cleanup here (fixed 2026-08-05, owner-authorized scope
        // amendment to chat-dm-safety-authority-core) — mirrors the job_definer half of this same
        // test (see the comment at its own "No explicit job_definer cleanup" line): by this point
        // withChatDefinerLock/hideRealChatDefiner above has ALREADY restored the real chat_definer
        // role (the scratch bootstrap attempt inside it rolled back entirely and left no role to
        // clean up — see that block's own comment). A bare `DROP ROLE IF EXISTS chat_definer` here
        // was always semantically wrong: it targets the just-restored REAL role, not a scratch
        // leftover. It stayed silently harmless only because chat_definer never owned any object
        // for a DROP to fail on — chat-dm-safety-authority-core's migration 0030 is the first to
        // give it real objects (in whatever other database has 0030 applied, cluster-wide, since
        // chat_definer is cluster-global), which turned this latent mistake into a hard failure
        // ("role chat_definer cannot be dropped because some objects depend on it"). Removed, not
        // patched around — hideRealChatDefiner's own restoration is already correct and sufficient.
      }
    });
  }, 60_000);
});

/**
 * Audit 2026-09-06 D-11 (runner half): the runner sorted by filename but never REFUSED a pending
 * file numbered below the applied tail, nor two files sharing an ordinal. Pure function, no
 * Postgres — the same inputs migrate() derives from readdir() and schema_migrations.
 */
describe("assertMonotonicMigrationOrder (audit 2026-09-06 D-11)", () => {
  const files = ["0000_roles.sql", "0001_a.sql", "0002_b.sql"];

  it("accepts a fresh database, a partially applied one, and a fully applied one", () => {
    expect(() => assertMonotonicMigrationOrder(files, [])).not.toThrow();
    expect(() => assertMonotonicMigrationOrder(files, ["0000_roles.sql"])).not.toThrow();
    expect(() => assertMonotonicMigrationOrder(files, files)).not.toThrow();
  });

  it("accepts a new file above the applied tail", () => {
    expect(() =>
      assertMonotonicMigrationOrder(
        ["0000_roles.sql", "0002_b.sql", "0003_new.sql"],
        ["0000_roles.sql", "0002_b.sql"],
      ),
    ).not.toThrow();
  });

  it("refuses a pending file numbered BELOW an already-applied ordinal", () => {
    expect(() =>
      assertMonotonicMigrationOrder(
        ["0000_roles.sql", "0001_late.sql", "0002_b.sql"],
        ["0000_roles.sql", "0002_b.sql"],
      ),
    ).toThrow(/out-of-order migration 0001_late\.sql .*0002/);
  });

  it("refuses two files sharing an ordinal, before anything is applied", () => {
    expect(() => assertMonotonicMigrationOrder([...files, "0001_dup.sql"], [])).toThrow(
      /duplicate migration ordinal 0001/,
    );
  });

  /**
   * The renamed-applied-migration case, which the duplicate scan above cannot see: the ledger
   * records 0002_b.sql, the checkout carries 0002_renamed.sql instead, so only ONE file numbered
   * 0002 is on disk and the pending one's ordinal EQUALS the applied tail rather than falling
   * below it. `<` let that through and the ledger ended up with two different migrations numbered
   * 0002 — two databases built from the same repo then diverge.
   */
  it("refuses a pending file whose ordinal EQUALS an applied one under a different name", () => {
    expect(() =>
      assertMonotonicMigrationOrder(
        ["0000_roles.sql", "0001_a.sql", "0002_renamed.sql"],
        ["0000_roles.sql", "0001_a.sql", "0002_b.sql"],
      ),
    ).toThrow(/out-of-order migration 0002_renamed\.sql .*at or below .*0002/);
  });

  it("refuses a file without a 4-digit ordinal", () => {
    expect(() => assertMonotonicMigrationOrder(["notes.sql"], [])).toThrow(
      /does not start with a 4-digit ordinal/,
    );
  });

  it("the real migrations/ directory passes against its own full listing (no duplicates on disk)", async () => {
    const onDisk = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
    expect(() => assertMonotonicMigrationOrder(onDisk, onDisk)).not.toThrow();
    expect(onDisk.length).toBe(MIGRATION_COUNT);
  });
});

/**
 * Audit 2026-09-06 — migration 0039 (P3 schema items D-7 · D-8 · D-9 · D-12 · W-8).
 * Replayed as a NOBYPASSRLS owner like 0037/0038 so the definer assertions are not vacuous.
 */
describe("0039 definer search_path + tenant assert, link_codes DD-50 shape, ledger aggregate FKs, tenants.name bound", () => {
  it("applies and enforces each item", async () => {
    // See the 0037 note: ctx.superuser is the BASE-database connection, so every data statement
    // and every per-DATABASE catalog read (pg_proc, information_schema, pg_constraint) below has
    // to run against ctx.dbName or it inspects the wrong database — which is how this test
    // "passed" its proconfig assertion while the base database happened to carry 0039 too.
    const ctx = await setupNonSuperuserOwnerContext("plexco_migrate_0039_audit_hardening");
    let appClient: pg.Client | undefined;
    /** superuser connection to THIS test's database (ctx.superuser is on the base one) */
    let suDb: pg.Client | undefined;
    try {
      await withJobDefinerLock(BASE!, async () => {
        await ctx.bootstrapJobDefinerForOwner();
        await ctx.bootstrapChatDefinerForOwner();
        return ctx.runMigration();
      });
      await ctx.superuser.query(`ALTER ROLE app WITH PASSWORD 'plexco_test_app'`);
      appClient = await connect(url(ctx.dbName, "app", "plexco_test_app"));
      suDb = await connect(url(ctx.dbName));
      // narrow once, before first use: the `let` above stays optional for the finally block
      const su = suDb;

      // D-7: both oauth definers now carry pg_temp in their search_path.
      const sp = await su.query(
        `SELECT proname, proconfig FROM pg_proc
          WHERE proname IN ('create_oauth_transaction', 'consume_oauth_transaction') ORDER BY 1`,
      );
      expect(sp.rows).toHaveLength(2);
      for (const r of sp.rows as { proname: string; proconfig: string[] }[]) {
        expect(r.proconfig, r.proname).toContain("search_path=public, pg_temp");
      }

      // D-8: create_oauth_transaction refuses a tenant that is not the current app.tenant_id.
      // suDb, not ctx.superuser: the latter is connected to the BASE database (see 0037).
      const person = await su.query(`INSERT INTO persons DEFAULT VALUES RETURNING id`);
      const personId = (person.rows[0] as { id: string }).id;
      const tenant = await appClient.query(`SELECT tenant_provision($1, $2, $3, $4, $5) AS id`, [
        "club-0039",
        "Club 0039",
        "Asia/Ho_Chi_Minh",
        "vi",
        personId,
      ]);
      const tenantId = (tenant.rows[0] as { id: string }).id;
      const otherTenant = await appClient.query(
        `SELECT tenant_provision($1, $2, $3, $4, $5) AS id`,
        ["club-0039-other", "Other", "Asia/Ho_Chi_Minh", "vi", personId],
      );
      const otherId = (otherTenant.rows[0] as { id: string }).id;
      const callCreate = (forTenant: string) =>
        appClient!.query(
          `SELECT create_oauth_transaction($1, $2, 'sepay', '\\x00'::bytea, 'https://plexco.app/cb', $3)`,
          [`state-${forTenant.slice(0, 8)}`, forTenant, personId],
        );
      await expect(callCreate(tenantId)).rejects.toMatchObject({ code: "42501" }); // no GUC
      await appClient.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);
      try {
        await expect(callCreate(otherId)).rejects.toMatchObject({ code: "42501" }); // wrong tenant
        await expect(callCreate(tenantId)).resolves.toBeDefined(); // own tenant
        const consumed = await appClient.query(
          `SELECT tenant_id FROM consume_oauth_transaction($1)`,
          [`state-${tenantId.slice(0, 8)}`],
        );
        expect(consumed.rows).toEqual([{ tenant_id: tenantId }]);
      } finally {
        await appClient.query(`SELECT set_config('app.tenant_id', '', false)`);
      }

      // D-9: link_codes XOR issuer + max_attempts bound + new columns.
      const cols = await su.query(
        `SELECT column_name, is_nullable FROM information_schema.columns
          WHERE table_name = 'link_codes'
            AND column_name IN ('source_channel_identity_id','source_account_id','max_attempts','locked_until','revoked_at')
          ORDER BY 1`,
      );
      expect(cols.rows).toEqual([
        { column_name: "locked_until", is_nullable: "YES" },
        { column_name: "max_attempts", is_nullable: "NO" },
        { column_name: "revoked_at", is_nullable: "YES" },
        { column_name: "source_account_id", is_nullable: "YES" },
        { column_name: "source_channel_identity_id", is_nullable: "YES" },
      ]);
      const account = await su.query(`INSERT INTO accounts (person_id) VALUES ($1) RETURNING id`, [
        personId,
      ]);
      const accountId = (account.rows[0] as { id: string }).id;
      const insertLinkCode = (issuer: { ci?: string; acc?: string }, maxAttempts = 5) =>
        su.query(
          `INSERT INTO link_codes(source_person_id, source_channel_identity_id, source_account_id,
                                  code_lookup_hash, code_hash, salt, expires_at, max_attempts)
           VALUES ($1, $2, $3, $4, '\\x00'::bytea, '\\x00'::bytea, now() + interval '1 hour', $5)`,
          [personId, issuer.ci ?? null, issuer.acc ?? null, `lc-${randomUUID()}`, maxAttempts],
        );
      await expect(insertLinkCode({})).rejects.toMatchObject({ code: "23514" }); // neither
      await expect(insertLinkCode({ acc: accountId })).resolves.toBeDefined(); // account-issued
      await expect(insertLinkCode({ acc: accountId }, 0)).rejects.toMatchObject({ code: "23514" });
      await expect(insertLinkCode({ acc: accountId }, 21)).rejects.toMatchObject({ code: "23514" });

      // W-8 (db half): tenants.name is bounded to 120 chars, empty rejected.
      await expect(
        su.query(`INSERT INTO tenants (name, slug) VALUES ($1, 'too-long-0039')`, [
          "x".repeat(121),
        ]),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        su.query(`INSERT INTO tenants (name, slug) VALUES ('', 'empty-0039')`),
      ).rejects.toMatchObject({ code: "23514" });

      // D-12: the two aggregate-bound FKs exist with the expected column sets.
      const fks = await su.query(
        `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
          WHERE conname IN ('charges_tenant_session_player_fk', 'payment_allocations_reversal_same_charge_fk')
          ORDER BY 1`,
      );
      expect((fks.rows as { conname: string; def: string }[]).map((r) => r.conname)).toEqual([
        "charges_tenant_session_player_fk",
        "payment_allocations_reversal_same_charge_fk",
      ]);
      expect((fks.rows[0] as { def: string }).def).toMatch(
        /FOREIGN KEY \(tenant_id, session_id, player_id\) REFERENCES players\(tenant_id, session_id, id\)/,
      );
      expect((fks.rows[1] as { def: string }).def).toMatch(
        /FOREIGN KEY \(tenant_id, charge_id, reverses_allocation_id\) REFERENCES payment_allocations\(tenant_id, charge_id, id\)/,
      );
    } finally {
      await appClient?.end();
      await suDb?.end();
      await ctx.teardown();
    }
  }, 90_000);
});

describe("0044 session_guest_notes: allow_player_invite / invited_by_person_id / trigger + RLS + tenant FK", () => {
  it("applies cleanly, defaults allow_player_invite true, exposes invited_by_person_id, enforces the 3-note trigger limit under real concurrency, rejects a cross-tenant session_id, and RLS blocks a cross-tenant read", async () => {
    const ctx = await setupNonSuperuserOwnerContext("plexco_migrate_0044_guest_notes");
    let appClient: pg.Client | undefined;
    let appClient2: pg.Client | undefined;
    let suDb: pg.Client | undefined;
    try {
      await withJobDefinerLock(BASE!, async () => {
        await ctx.bootstrapJobDefinerForOwner();
        await ctx.bootstrapChatDefinerForOwner();
        return ctx.runMigration();
      });
      await ctx.superuser.query(`ALTER ROLE app WITH PASSWORD 'plexco_test_app'`);
      appClient = await connect(url(ctx.dbName, "app", "plexco_test_app"));
      suDb = await connect(url(ctx.dbName));
      const su = suDb;

      const person = await su.query(`INSERT INTO persons DEFAULT VALUES RETURNING id`);
      const personId = (person.rows[0] as { id: string }).id;
      const tenantA = await appClient.query(`SELECT tenant_provision($1, $2, $3, $4, $5) AS id`, [
        "club-0044-a",
        "Club 0044 A",
        "Asia/Ho_Chi_Minh",
        "vi",
        personId,
      ]);
      const tenantAId = (tenantA.rows[0] as { id: string }).id;
      const tenantB = await appClient.query(`SELECT tenant_provision($1, $2, $3, $4, $5) AS id`, [
        "club-0044-b",
        "Club 0044 B",
        "Asia/Ho_Chi_Minh",
        "vi",
        personId,
      ]);
      const tenantBId = (tenantB.rows[0] as { id: string }).id;

      // D-1: sessions.allow_player_invite defaults true.
      await appClient.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantAId]);
      const sport = await appClient.query(`SELECT id FROM sports WHERE key = 'badminton'`);
      const sportId = (sport.rows[0] as { id: string }).id;
      const session = await appClient.query(
        `INSERT INTO sessions (tenant_id, sport_id, starts_at, ends_at, timezone, status)
         VALUES ($1, $2, now(), now() + interval '2 hours', 'Asia/Ho_Chi_Minh', 'open')
         RETURNING id, allow_player_invite`,
        [tenantAId, sportId],
      );
      const sessionId = (session.rows[0] as { id: string }).id;
      expect((session.rows[0] as { allow_player_invite: boolean }).allow_player_invite).toBe(true);

      // D-2: players.invited_by_person_id column + its partial index exist.
      const cols = await su.query(
        `SELECT column_name, is_nullable FROM information_schema.columns
          WHERE table_name = 'players' AND column_name = 'invited_by_person_id'`,
      );
      expect(cols.rows).toEqual([{ column_name: "invited_by_person_id", is_nullable: "YES" }]);
      const idx = await su.query(
        `SELECT indexname FROM pg_indexes
          WHERE tablename = 'players' AND indexname = 'idx_players_invited_by'`,
      );
      expect(idx.rows).toHaveLength(1);

      // D-3: trg_session_guest_note_limit rejects a 4th note for the same (session, person).
      const insertNote = (n: number) =>
        appClient!.query(
          `INSERT INTO session_guest_notes (tenant_id, session_id, created_by_person_id, guest_name)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [tenantAId, sessionId, personId, `Guest ${n}`],
        );
      await insertNote(1);
      await insertNote(2);
      await insertNote(3);
      await expect(insertNote(4)).rejects.toMatchObject({
        code: "P0001",
        message: expect.stringContaining("GUEST_NOTE_LIMIT_REACHED"),
      });

      // D-4: RLS fail-closed — same connection, GUC flipped to the other tenant sees nothing.
      await appClient.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantBId]);
      const crossTenant = await appClient.query(
        `SELECT id FROM session_guest_notes WHERE session_id = $1`,
        [sessionId],
      );
      expect(crossTenant.rows).toEqual([]);

      // sanity: the 3 committed rows are visible again once the GUC is restored to their own tenant.
      await appClient.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantAId]);
      const ownTenant = await appClient.query(
        `SELECT id FROM session_guest_notes WHERE session_id = $1`,
        [sessionId],
      );
      expect(ownTenant.rows).toHaveLength(3);

      // D-5: session_guest_notes_tenant_session_fk rejects a session_id owned by another tenant —
      // RLS's WITH CHECK alone would pass (tenant_id=A matches the GUC); only the composite FK
      // (tenant_id, session_id) -> sessions(tenant_id, id) catches session_id actually being B's.
      await appClient.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantBId]);
      const sessionB = await appClient.query(
        `INSERT INTO sessions (tenant_id, sport_id, starts_at, ends_at, timezone, status)
         VALUES ($1, $2, now(), now() + interval '2 hours', 'Asia/Ho_Chi_Minh', 'open')
         RETURNING id`,
        [tenantBId, sportId],
      );
      const sessionBId = (sessionB.rows[0] as { id: string }).id;
      await appClient.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantAId]);
      await expect(
        appClient.query(
          `INSERT INTO session_guest_notes (tenant_id, session_id, created_by_person_id, guest_name)
           VALUES ($1, $2, $3, 'Cross-tenant guest')`,
          [tenantAId, sessionBId, personId],
        ),
      ).rejects.toMatchObject({ code: "23503" });

      // D-6: a DETERMINISTIC proof that trg_session_guest_note_limit's session-row lock actually
      // blocks a second connection, not just "two autocommit promises happened to interleave" (which
      // could pass by luck even against the pre-fix unlocked trigger — codex round-02 [P2]). Connection
      // A opens an explicit transaction, inserts the 3rd note (acquiring + holding the sessions row
      // lock) and stays OPEN. Connection B's 4th-note attempt is started but not awaited; a third
      // connection (su) polls pg_blocking_pids() until Postgres itself confirms B is waiting on A's
      // backend — proving genuine lock contention, not timing luck. Only then does A commit, B
      // unblocks, observes count=3, and is rejected.
      const session2 = await appClient.query(
        `INSERT INTO sessions (tenant_id, sport_id, starts_at, ends_at, timezone, status)
         VALUES ($1, $2, now(), now() + interval '2 hours', 'Asia/Ho_Chi_Minh', 'open')
         RETURNING id`,
        [tenantAId, sportId],
      );
      const session2Id = (session2.rows[0] as { id: string }).id;
      const insertRaceNote = (client: pg.Client) =>
        client.query(
          `INSERT INTO session_guest_notes (tenant_id, session_id, created_by_person_id, guest_name)
           VALUES ($1, $2, $3, 'Race note') RETURNING id`,
          [tenantAId, session2Id, personId],
        );
      await insertRaceNote(appClient);
      await insertRaceNote(appClient);

      appClient2 = await connect(url(ctx.dbName, "app", "plexco_test_app"));
      await appClient2.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantAId]);
      const appPid = (await appClient.query(`SELECT pg_backend_pid() AS pid`)).rows[0] as {
        pid: number;
      };
      const app2Pid = (await appClient2.query(`SELECT pg_backend_pid() AS pid`)).rows[0] as {
        pid: number;
      };

      await appClient.query("BEGIN");
      await insertRaceNote(appClient); // holds the sessions row lock, uncommitted
      // Handler attached IMMEDIATELY, not after COMMIT: CI flake fix. If B's P0001 rejection is
      // processed by the event loop before the `await blockedOutcome` below claims it, an
      // unhandled-rejection-free window never opens, since `.then` here converts the rejection
      // into a resolved outcome object right away. The bare promise (started, not awaited) used
      // to leave that window open long enough for Vitest to occasionally observe an unhandled
      // rejection and exit 1 on `pull_request`-triggered CI runs specifically (never reproduced
      // locally or on `push` runs of the identical commit).
      const blockedOutcome = insertRaceNote(appClient2).then(
        () => ({ settled: "resolved" as const }),
        (e: unknown) => ({ settled: "rejected" as const, error: e }),
      );

      let genuinelyBlocked = false;
      for (let attempt = 0; attempt < 200 && !genuinelyBlocked; attempt++) {
        const { rows } = await su.query(
          `SELECT $1::int = ANY(pg_blocking_pids($2::int)) AS is_blocked`,
          [appPid.pid, app2Pid.pid],
        );
        genuinelyBlocked = (rows[0] as { is_blocked: boolean }).is_blocked;
        if (!genuinelyBlocked) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(
        genuinelyBlocked,
        "second connection's insert must be lock-blocked on the first's open transaction",
      ).toBe(true);

      await appClient.query("COMMIT");
      const outcome = await blockedOutcome;
      expect(outcome.settled).toBe("rejected");
      expect(outcome).toMatchObject({
        error: expect.objectContaining({
          code: "P0001",
          message: expect.stringContaining("GUEST_NOTE_LIMIT_REACHED"),
        }),
      });
      await appClient2.query("ROLLBACK");

      const raceFinal = await su.query(
        `SELECT count(*)::int AS n FROM session_guest_notes WHERE session_id = $1`,
        [session2Id],
      );
      expect((raceFinal.rows[0] as { n: number }).n).toBe(3);

      // D-7: no UPDATE grant — an app-role caller cannot reassign an existing note's grouping key
      // to sneak past trg_session_guest_note_limit, which only fires BEFORE INSERT (codex review
      // finding: UPDATE was part of the copied 0009 blanket grant but nothing in the BE command
      // surface ever updates a guest note).
      await expect(
        appClient.query(`UPDATE session_guest_notes SET note = 'edited' WHERE session_id = $1`, [
          session2Id,
        ]),
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await appClient?.end();
      await appClient2?.end();
      await suDb?.end();
      await ctx.teardown();
    }
  }, 90_000);
});

describe("0045 guest-note tenant context", () => {
  const migrationFile = "0045_guest_note_tenant_context.sql";
  const signature = "public.guest_note_tenant_for_person(uuid,uuid,uuid)";
  const proofSql = "SELECT public.guest_note_tenant_for_person($1, $2, $3) AS tenant";

  it("fresh non-bypass owner migration installs the app-only proof and replays zero files", async () => {
    const ctx = await setupNonSuperuserOwnerContext("plexco_migrate_0045_fresh");
    const originalReaddir = readdirImpl;
    try {
      readdirImpl = async (dir) =>
        (await originalReaddir(dir)).filter((file) => file <= migrationFile);
      await withJobDefinerLock(BASE!, async () => {
        await ctx.bootstrapJobDefinerForOwner();
        await ctx.bootstrapChatDefinerForOwner();
        const first = await ctx.runMigration();
        expect(first.applied).toHaveLength(46);
        expect(first.applied.at(-1)).toBe(migrationFile);
        expect(
          (await ctx.ownerPool.query(`SELECT to_regprocedure($1)::text AS name`, [signature]))
            .rows[0].name,
        ).toBeTruthy();
        expect((await ctx.runMigration()).applied).toEqual([]);
      });
    } finally {
      readdirImpl = originalReaddir;
      await ctx.teardown();
    }
  }, 120_000);

  it("upgrades retained data under FORCE RLS, preserves grants and restores caller scope on every path", async () => {
    const ctx = await setupNonSuperuserOwnerContext("plexco_migrate_0045_upgrade");
    const clients: pg.Client[] = [];
    let ownerClient: pg.PoolClient | undefined;
    const originalDirectory = readdirImpl;
    try {
      readdirImpl = async (dir) =>
        (await originalDirectory(dir)).filter((file) => file <= migrationFile);
      // Hold job outer/chat inner across both migration passes; reacquiring job while
      // this fixture retains chat could deadlock another file waiting for chat.
      await withJobDefinerLock(BASE!, async () => {
        await ctx.bootstrapJobDefinerForOwner();
        await ctx.bootstrapChatDefinerForOwner();
        const originalReaddir = readdirImpl;
        try {
          readdirImpl = async (dir) =>
            (await originalReaddir(dir)).filter((file) => file !== migrationFile);
          const previous = await ctx.runMigration();
          expect(previous.applied).toHaveLength(45);
          expect(previous.applied.at(-1)).toBe("0044_session_guest_notes.sql");
        } finally {
          readdirImpl = originalReaddir;
        }
        ownerClient = await ctx.ownerPool.connect();
        const owner = ownerClient;
        const scoped = async <T>(tenant: string, operation: () => Promise<T>): Promise<T> => {
          await owner.query("BEGIN");
          try {
            await owner.query("SELECT set_config('app.tenant_id', $1, true)", [tenant]);
            const result = await operation();
            await owner.query("COMMIT");
            return result;
          } catch (error) {
            await owner.query("ROLLBACK");
            throw error;
          }
        };
        const person = randomUUID();
        const stranger = randomUUID();
        const tenantA = randomUUID();
        const tenantB = randomUUID();
        const sessionA = randomUUID();
        const sessionB = randomUUID();
        await owner.query("INSERT INTO persons(id) VALUES ($1), ($2)", [person, stranger]);
        await owner.query(
          `INSERT INTO tenants(id, name, slug, status) VALUES
           ($1, 'Context A', 'context-0045-a', 'active'), ($2, 'Context B', 'context-0045-b', 'active')`,
          [tenantA, tenantB],
        );
        const sport = (await owner.query("SELECT id FROM sports WHERE key = 'badminton'")).rows[0]
          .id;
        for (const [tenant, session] of [
          [tenantA, sessionA],
          [tenantB, sessionB],
        ] as const) {
          await scoped(tenant, () =>
            owner.query(
              `INSERT INTO sessions(id, tenant_id, sport_id, starts_at, ends_at, timezone, status)
             VALUES ($1, $2, $3, now() + interval '1 hour', now() + interval '2 hours', 'Asia/Ho_Chi_Minh', 'open')`,
              [session, tenant, sport],
            ),
          );
        }
        await scoped(tenantA, async () => {
          const member = (
            await owner.query(
              "INSERT INTO memberships(tenant_id, person_id) VALUES ($1, $2) RETURNING id",
              [tenantA, person],
            )
          ).rows[0].id;
          await owner.query(
            "INSERT INTO players(tenant_id, session_id, membership_id) VALUES ($1, $2, $3)",
            [tenantA, sessionA, member],
          );
          await owner.query(
            `INSERT INTO session_guest_notes(tenant_id, session_id, created_by_person_id, guest_name)
             VALUES ($1, $2, $3, 'Retained guest')`,
            [tenantA, sessionA, person],
          );
          await owner.query(
            `INSERT INTO processed_commands(tenant_id, command_id, command_type, result_ref)
             VALUES ($1, 'retained-0045', 'CreateGuestNote', $2)`,
            [
              tenantA,
              {
                actorPersonId: person,
                sessionId: sessionA,
                noteId: randomUUID(),
                remainingNotes: 2,
              },
            ],
          );
          await owner.query(
            `INSERT INTO tenant_admins(tenant_id, platform, platform_user_lookup_hash, role)
             VALUES ($1, 'web', $2, 'owner')`,
            [tenantA, person],
          );
        });
        // Exercise a shared-role catalog conflict without racing another suite by timing.
        const passwordSetter = vi
          .spyOn(ctx.superuser, "query")
          .mockRejectedValueOnce(new Error("tuple concurrently updated"));
        try {
          for (const [role, password] of [
            ["app", "plexco_test_app"],
            ["readonly", "plexco_test_readonly"],
          ] as const) {
            for (let attempt = 0; ; attempt++) {
              try {
                await ctx.superuser.query(`ALTER ROLE ${role} WITH PASSWORD '${password}'`);
                break;
              } catch (error) {
                if (String(error).includes("tuple concurrently updated") && attempt < 10) {
                  await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
                  continue;
                }
                throw error;
              }
            }
          }
          expect(passwordSetter).toHaveBeenNthCalledWith(
            2,
            "ALTER ROLE app WITH PASSWORD 'plexco_test_app'",
          );
        } finally {
          passwordSetter.mockRestore();
        }
        const app = await connect(url(ctx.dbName, "app", "plexco_test_app"));
        clients.push(app);
        const readonly = await connect(url(ctx.dbName, "readonly", "plexco_test_readonly"));
        clients.push(readonly);
        const worker = await ctx.connectAsWorker();
        const adminBefore = (await app.query("SELECT * FROM tenant_ids_for_person($1)", [person]))
          .rows;
        expect(adminBefore).toEqual([{ tenant_id: tenantA, role: "owner" }]);
        const retainedRows = () =>
          scoped(tenantA, async () => ({
            notes: (await owner.query("SELECT * FROM session_guest_notes ORDER BY id")).rows,
            players: (await owner.query("SELECT * FROM players ORDER BY id")).rows,
            commands: (await owner.query("SELECT * FROM processed_commands ORDER BY id")).rows,
          }));
        const dataBefore = await retainedRows();
        // Restrict cluster catalog reads to this migration's principals. Unrelated
        // test files may create their own fixture owner roles concurrently.
        const principals = [
          ctx.ownerRole,
          "app",
          "readonly",
          "app_worker",
          "job_definer",
          "chat_definer",
        ];
        const catalog = async () => ({
          ledgerIndexes: (
            await owner.query(`SELECT indexname, indexdef FROM pg_indexes
              WHERE schemaname = 'public' AND tablename = 'processed_commands' ORDER BY indexname`)
          ).rows,
          relations: (
            await owner.query(`SELECT relname, relowner, relacl::text, relrowsecurity, relforcerowsecurity
            FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r','p','S','v') ORDER BY relname`)
          ).rows,
          policies: (
            await owner.query(
              "SELECT * FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname",
            )
          ).rows,
          functions: (
            await owner.query(`SELECT oid, proowner, proacl::text, prosecdef, provolatile, proconfig
            FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname <> 'guest_note_tenant_for_person' ORDER BY oid`)
          ).rows,
          roles: (
            await owner.query(
              "SELECT rolname, rolsuper, rolbypassrls, rolcreaterole, rolcanlogin FROM pg_roles WHERE rolname = ANY($1) ORDER BY rolname",
              [principals],
            )
          ).rows,
          memberships: (
            await owner.query(
              `SELECT roleid, member, grantor, admin_option, inherit_option, set_option FROM pg_auth_members
            WHERE roleid IN (SELECT oid FROM pg_roles WHERE rolname = ANY($1))
               OR member IN (SELECT oid FROM pg_roles WHERE rolname = ANY($1)) ORDER BY roleid, member, grantor`,
              [principals],
            )
          ).rows,
        });
        const before = await catalog();
        expect(before.ledgerIndexes).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ indexname: "processed_commands_tenant_id_command_id_key" }),
          ]),
        );
        expect(
          (await owner.query("SELECT to_regprocedure($1) AS proof", [signature])).rows[0].proof,
        ).toBeNull();
        // Keep a real ledger writer open during the upgrade. An ordinary CREATE INDEX
        // would conflict with its RowExclusiveLock and fail the native lock timeout.
        const writeLockSql = `SELECT EXISTS (SELECT 1 FROM pg_locks
          WHERE pid = pg_backend_pid() AND relation = 'public.processed_commands'::regclass
            AND mode = 'RowExclusiveLock' AND granted) AS held`;
        const migrationUrl = new URL(ctx.ownerPool.options.connectionString!);
        migrationUrl.searchParams.set(
          "options",
          [
            migrationUrl.searchParams.get("options"),
            "-c lock_timeout=500ms -c statement_timeout=15000ms",
          ]
            .filter(Boolean)
            .join(" "),
        );
        await app.query("BEGIN");
        try {
          await app.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
          await app.query(
            `INSERT INTO processed_commands(tenant_id, command_id, command_type, result_ref)
             VALUES ($1, $2, 'CreateGuestNote', '{}'::jsonb)`,
            [tenantA, randomUUID()],
          );
          expect((await app.query(writeLockSql)).rows[0].held).toBe(true);
          expect((await migrate(migrationUrl.toString())).applied).toEqual([migrationFile]);
          expect((await app.query(writeLockSql)).rows[0].held).toBe(true);
        } finally {
          await app.query("ROLLBACK");
        }
        expect((await ctx.runMigration()).applied).toEqual([]);
        expect(await catalog()).toEqual(before);
        expect(await retainedRows()).toEqual(dataBefore);
        expect((await app.query("SELECT * FROM tenant_ids_for_person($1)", [person])).rows).toEqual(
          adminBefore,
        );

        for (const [connection, role] of [
          [owner, ctx.ownerRole],
          [app, "app"],
        ] as const) {
          expect(
            (
              await connection.query(`SELECT current_user, session_user, rolsuper, rolbypassrls
            FROM pg_roles WHERE rolname = current_user`)
            ).rows,
          ).toEqual([
            { current_user: role, session_user: role, rolsuper: false, rolbypassrls: false },
          ]);
          expect(
            (await connection.query("SELECT count(*)::int AS count FROM players")).rows[0].count,
          ).toBe(0);
          expect(
            (await connection.query(proofSql, [person, tenantA, sessionA])).rows[0].tenant,
          ).toBe(tenantA);
          expect(
            (await connection.query("SELECT count(*)::int AS count FROM players")).rows[0].count,
          ).toBe(0);
        }
        expect(
          (
            await owner.query(
              `SELECT relname, relowner::regrole::text AS owner, relrowsecurity, relforcerowsecurity
          FROM pg_class WHERE oid = ANY($1::regclass[]) ORDER BY relname`,
              [["memberships", "players", "session_guest_notes", "processed_commands"]],
            )
          ).rows,
        ).toEqual(
          ["memberships", "players", "processed_commands", "session_guest_notes"].map(
            (relname) => ({
              relname,
              owner: ctx.ownerRole,
              relrowsecurity: true,
              relforcerowsecurity: true,
            }),
          ),
        );
        expect(
          (
            await owner.query(
              `SELECT proowner::regrole::text AS owner, prosecdef, provolatile, proconfig
          FROM pg_proc WHERE oid = $1::regprocedure`,
              [signature],
            )
          ).rows,
        ).toEqual([
          {
            owner: ctx.ownerRole,
            prosecdef: true,
            provolatile: "v",
            proconfig: ["search_path=public, pg_temp"],
          },
        ]);
        const acl = (
          await owner.query(
            `SELECT a.grantee::regrole::text AS grantee, a.privilege_type, a.is_grantable
          FROM pg_proc p, LATERAL aclexplode(p.proacl) a WHERE p.oid = $1::regprocedure ORDER BY grantee`,
            [signature],
          )
        ).rows;
        expect(acl).toEqual([
          { grantee: "app", privilege_type: "EXECUTE", is_grantable: false },
          { grantee: ctx.ownerRole, privilege_type: "EXECUTE", is_grantable: false },
        ]);
        await expect(app.query("SELECT * FROM persons LIMIT 1")).rejects.toMatchObject({
          code: "42501",
        });
        for (const [connection, role] of [
          [readonly, "readonly"],
          [worker, "app_worker"],
        ] as const) {
          expect((await connection.query("SELECT current_user, session_user")).rows).toEqual([
            { current_user: role, session_user: role },
          ]);
          await expect(
            connection.query(proofSql, [person, tenantA, sessionA]),
          ).rejects.toMatchObject({ code: "42501" });
        }
        await app.query("BEGIN");
        try {
          await app.query("SELECT set_config('app.tenant_id', $1, true)", [tenantB]);
          for (let i = 0; i < 3; i++) {
            const values: (string | null)[] = [person, tenantA, sessionA];
            values[i] = null;
            expect((await app.query(proofSql, values)).rows[0].tenant).toBeNull();
            expect(
              (await app.query("SELECT current_setting('app.tenant_id') AS tenant")).rows[0].tenant,
            ).toBe(tenantB);
          }
        } finally {
          await app.query("ROLLBACK");
        }

        const gucCase = async (prior: string | undefined, outcome: "match" | "deny" | "error") => {
          const client = await connect(url(ctx.dbName, "app", "plexco_test_app"));
          try {
            await client.query("BEGIN");
            if (prior !== undefined)
              await client.query("SELECT set_config('app.tenant_id', $1, true)", [prior]);
            const previous = (
              await client.query("SELECT current_setting('app.tenant_id', true) AS value")
            ).rows[0].value;
            if (outcome === "error") {
              expect(
                (
                  await client.query("SELECT public.guest_context_test_catch($1,$2,$3) AS code", [
                    person,
                    tenantA,
                    sessionA,
                  ])
                ).rows[0].code,
              ).toBe("P0044");
            } else {
              expect(
                (
                  await client.query(proofSql, [
                    outcome === "match" ? person : stranger,
                    tenantA,
                    sessionA,
                  ])
                ).rows[0].tenant,
              ).toBe(outcome === "match" ? tenantA : null);
            }
            const after = (
              await client.query("SELECT current_setting('app.tenant_id', true) AS value")
            ).rows[0].value;
            expect(after || null).toBe(previous || null);
            if (previous !== null) expect(after).toBe(previous);
            expect(
              (
                await client.query(
                  "SELECT DISTINCT tenant_id::text AS tenant FROM sessions ORDER BY tenant",
                )
              ).rows,
            ).toEqual(prior ? [{ tenant: prior }] : []);
          } finally {
            try {
              await client.query("ROLLBACK");
            } finally {
              await client.end();
            }
          }
        };
        const priorValues = [undefined, "", tenantA, tenantB];
        for (const prior of priorValues) {
          await gucCase(prior, "match");
          await gucCase(prior, "deny");
        }
        expect(
          await Promise.allSettled([gucCase(tenantA, "match"), gucCase(tenantB, "match")]),
        ).toEqual([
          { status: "fulfilled", value: undefined },
          { status: "fulfilled", value: undefined },
        ]);
        await owner.query(`CREATE FUNCTION public.guest_context_test_raise() RETURNS boolean LANGUAGE plpgsql AS $$
          BEGIN RAISE EXCEPTION 'synthetic proof failure' USING ERRCODE='P0044'; END $$;
          CREATE POLICY guest_context_test_fault ON public.players AS RESTRICTIVE FOR SELECT TO ${ctx.ownerRole}
            USING (public.guest_context_test_raise());
          CREATE FUNCTION public.guest_context_test_catch(p uuid, t uuid, s uuid) RETURNS text LANGUAGE plpgsql AS $$
          DECLARE code text; BEGIN
            BEGIN PERFORM public.guest_note_tenant_for_person(p,t,s);
            EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS code = RETURNED_SQLSTATE; END;
            RETURN code; END $$;
          REVOKE ALL ON FUNCTION public.guest_context_test_catch(uuid,uuid,uuid) FROM PUBLIC;
          GRANT EXECUTE ON FUNCTION public.guest_context_test_catch(uuid,uuid,uuid) TO app;`);
        try {
          await expect(app.query(proofSql, [person, tenantA, sessionA])).rejects.toMatchObject({
            code: "P0044",
          });
          for (const prior of priorValues) await gucCase(prior, "error");
        } finally {
          await owner.query(`DROP POLICY guest_context_test_fault ON public.players;
            DROP FUNCTION public.guest_context_test_raise(); DROP FUNCTION public.guest_context_test_catch(uuid,uuid,uuid);`);
        }
        expect(await catalog()).toEqual(before);
      });
    } finally {
      readdirImpl = originalDirectory;
      try {
        await Promise.all(clients.map((client) => client.end()));
      } finally {
        ownerClient?.release();
        await ctx.teardown();
      }
    }
  }, 120_000);
});

describe("0046 bounded rate-limit cleanup", () => {
  const migrationFile = "0046_rate_limit_bounded_cleanup.sql";
  const signature = "public.rate_limit_check(text,integer,interval)";

  it.each(["fresh", "upgrade"])(
    "%s non-bypass owner migration preserves limiter storage and authority, then replays zero files",
    async (mode) => {
      const ctx = await setupNonSuperuserOwnerContext(`plexco_migrate_0046_${mode}`);
      const originalReaddir = readdirImpl;
      const through0046 = async (dir: string) =>
        (await originalReaddir(dir)).filter((file) => file <= migrationFile);
      try {
        readdirImpl = through0046;
        await withJobDefinerLock(BASE!, async () => {
          await ctx.bootstrapJobDefinerForOwner();
          await ctx.bootstrapChatDefinerForOwner();
          expect(
            (
              await ctx.ownerPool.query(
                "SELECT current_user AS name, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user",
              )
            ).rows,
          ).toEqual([{ name: ctx.ownerRole, rolsuper: false, rolbypassrls: false }]);
          if (mode === "upgrade") {
            readdirImpl = async (dir) =>
              (await originalReaddir(dir)).filter((file) => file < migrationFile);
            const previous = await ctx.runMigration();
            expect(previous.applied).toHaveLength(46);
            expect(previous.applied.at(-1)).toBe("0045_guest_note_tenant_context.sql");
            readdirImpl = through0046;
            await ctx.ownerPool.query(`INSERT INTO rate_limit_hits(bucket, at)
              VALUES ('migration:expired', now() - interval '2 days'), ('migration:live', now())`);
          }
          const catalog = async () => ({
            function: (
              await ctx.ownerPool.query(
                `SELECT p.oid, p.proowner::regrole::text AS owner,
                pg_get_function_identity_arguments(p.oid) AS arguments,
                p.prorettype::regtype::text AS returns, p.provolatile, p.prosecdef,
                p.proconfig, p.proacl::text AS acl, l.lanname AS language
               FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
               WHERE p.oid = $1::regprocedure`,
                [signature],
              )
            ).rows[0],
            table: (
              await ctx.ownerPool.query(
                `SELECT oid, relowner::regrole::text AS owner, relpersistence,
                relrowsecurity, relforcerowsecurity, relacl::text AS acl
               FROM pg_class WHERE oid = 'public.rate_limit_hits'::regclass`,
              )
            ).rows[0],
            indexes: (
              await ctx.ownerPool.query(
                "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'rate_limit_hits' ORDER BY indexname",
              )
            ).rows,
          });
          const before = mode === "upgrade" ? await catalog() : undefined;
          const dataBefore =
            mode === "upgrade"
              ? (
                  await ctx.ownerPool.query(
                    "SELECT bucket, at::text FROM rate_limit_hits ORDER BY bucket, at",
                  )
                ).rows
              : [];
          const result = await ctx.runMigration();
          if (mode === "upgrade") expect(result.applied).toEqual([migrationFile]);
          else {
            expect(result.applied).toHaveLength(47);
            expect(result.applied.at(-1)).toBe(migrationFile);
          }
          const after = await catalog();
          if (before) expect(after).toEqual(before);
          expect(after.function).toMatchObject({
            owner: ctx.ownerRole,
            arguments: "p_bucket text, p_limit integer, p_window interval",
            returns: "boolean",
            provolatile: "v",
            prosecdef: true,
            proconfig: ["search_path=public, pg_temp"],
            language: "plpgsql",
          });
          expect(after.table).toMatchObject({
            owner: ctx.ownerRole,
            relpersistence: "u",
            relrowsecurity: false,
            relforcerowsecurity: false,
            acl: null,
          });
          expect(after.indexes.map((index: { indexname: string }) => index.indexname)).toEqual([
            "idx_rate_limit_at",
            "idx_rate_limit_bucket_at",
          ]);
          expect(
            (
              await ctx.ownerPool.query(
                `SELECT has_function_privilege('app', $1, 'EXECUTE') AS app,
              has_function_privilege('chat_definer', $1, 'EXECUTE') AS chat,
              has_function_privilege('app_worker', $1, 'EXECUTE') AS worker,
              has_function_privilege('readonly', $1, 'EXECUTE') AS readonly,
              EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
                WHERE p.oid = $1::regprocedure AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS public,
              has_table_privilege('app', 'public.rate_limit_hits', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') AS app_table,
              has_table_privilege('chat_definer', 'public.rate_limit_hits', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') AS chat_table`,
                [signature],
              )
            ).rows[0],
          ).toEqual({
            app: true,
            chat: true,
            worker: false,
            readonly: false,
            public: false,
            app_table: false,
            chat_table: false,
          });
          expect(
            (
              await ctx.ownerPool.query(
                "SELECT bucket, at::text FROM rate_limit_hits ORDER BY bucket, at",
              )
            ).rows,
          ).toEqual(dataBefore);
          expect((await ctx.runMigration()).applied).toEqual([]);
          expect(await catalog()).toEqual(after);
        });
      } finally {
        readdirImpl = originalReaddir;
        await ctx.teardown();
      }
    },
    120_000,
  );
});

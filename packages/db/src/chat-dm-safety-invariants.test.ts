import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { setupRlsTestContext, type RlsTestContext } from "./test-harness.js";

const TEST_DB_NAME = "plexco_chat_dm_safety_check";

/**
 * DD-55 DM safety authority invariants (migration 0030).
 *
 * chat_dm_safety_config/chat_blocks/chat_reports are global-protected (no
 * RLS, zero grant to app/readonly) -- every access goes through the three
 * chat_definer-owned SECURITY DEFINER functions or, for fixture setup, the
 * privileged owner connection directly (this slice owns no write RPC, so
 * seeding chat_blocks is direct SQL, exactly as root's own test plan
 * directly manipulates chat_members to test RLS in isolation).
 *
 * NO chat_dm_safety_audit table (owner-amended 2026-08-05): the original
 * pinned design (INSERT an audit row, then RAISE EXCEPTION, same statement)
 * can never persist a row -- PL/pgSQL's exception handling is
 * savepoint-rollback-based, so the RAISE unconditionally undoes the INSERT,
 * proven empirically during this slice's own implementation. Rather than
 * ship a table that always reads empty, assert_dm_allowed() emits RAISE LOG
 * instead, which Postgres delivers outside transactional rollback.
 *
 * client_min_messages is a plain, caller-controlled session GUC (codex round-04 [P1]) -- a session
 * that SETs it to 'log' itself DOES receive a LOG-severity RAISE as a client notice, verified
 * directly; nothing about SECURITY DEFINER changes that, since delivery is keyed to the CALLING
 * connection, not the function owner. That means RAISE LOG alone was never actually
 * caller-unreachable, contradicting this migration's own design goal. assert_dm_allowed() now
 * carries its own `SET client_min_messages = warning` clause, forcing the threshold above LOG for
 * the DURATION of that one call regardless of what the caller's session requests (log_min_messages,
 * a separate GUC, still delivers it to the server log as before). captureNotices() below remains a
 * valid general technique, but it can no longer observe assert_dm_allowed()'s own RAISE LOG content
 * from ANY client connection, including ctx.owner's -- that unreachability is now the property
 * under test, not an artifact to work around. This environment's Postgres logs to stderr with
 * logging_collector off (no log file in the data directory), so there is no portable, in-SQL way to
 * verify the suppressed message's CONTENT from this suite either; that specific claim is verifiable
 * by reading the migration's own RAISE LOG statement, not by a live round-trip test.
 */

let ctx: RlsTestContext;

beforeAll(async () => {
  ctx = await setupRlsTestContext(TEST_DB_NAME);
  // RAISE LOG sits below the default 'notice' client_min_messages threshold;
  // this makes it visible to ctx.owner's own 'notice' event for the rest of
  // this file. Harmless for every other test here: none of them RAISE at
  // LOG level, so this only adds visibility, never behavior.
  await ctx.owner.query(`SET client_min_messages = 'log'`);
}, 120_000);

afterAll(async () => {
  await ctx?.teardown();
});

/** Captures pg 'notice' events (including RAISE LOG, see beforeAll) raised by ctx.owner during fn(). */
async function captureNotices(
  fn: () => Promise<unknown>,
): Promise<Array<{ severity?: string; message?: string }>> {
  const notices: Array<{ severity?: string; message?: string }> = [];
  const handler = (n: { severity?: string; message?: string }) => notices.push(n);
  ctx.owner.on("notice", handler);
  try {
    await fn();
  } finally {
    ctx.owner.off("notice", handler);
  }
  return notices;
}

async function seedPerson(name: string): Promise<string> {
  const { rows } = await ctx.owner.query(
    `INSERT INTO persons (display_name) VALUES ($1) RETURNING id`,
    [name],
  );
  return (rows[0] as { id: string }).id;
}

function callAssertDmAllowed(actor: string | null, peer: string | null, action: string | null) {
  return ctx.owner.query(`SELECT assert_dm_allowed($1, $2, $3)`, [actor, peer, action]);
}

async function chatPairBlocked(a: string, b: string): Promise<boolean> {
  const { rows } = await ctx.owner.query(`SELECT chat_pair_blocked($1, $2) AS v`, [a, b]);
  return (rows[0] as { v: boolean }).v;
}

async function dmSafetyEnabled(): Promise<boolean> {
  const { rows } = await ctx.owner.query(`SELECT dm_safety_enabled() AS v`);
  return (rows[0] as { v: boolean }).v;
}

async function setConfigFlag(column: string, value: boolean | number) {
  await ctx.owner.query(`UPDATE chat_dm_safety_config SET ${column} = $1`, [value]);
}

async function resetConfigDefaults() {
  await ctx.owner.query(
    `UPDATE chat_dm_safety_config SET
       block_enabled = true, report_enabled = true, rate_limit_enabled = true,
       audit_enabled = true, dm_sender_limit_per_min = 30, dm_target_limit_per_min = 30`,
  );
  await ctx.owner.query(`DELETE FROM chat_blocks`);
  await ctx.owner.query(`DELETE FROM rate_limit_hits WHERE bucket LIKE 'chat_dm_%'`);
}

describe("migration baseline", () => {
  it("0030 is applied", () => {
    expect(ctx.migrateResult.applied).toContain("0030_chat_dm_safety_authority_core.sql");
  });

  // codex round-02 [P1]: must run before any resetConfigDefaults() call in this file, which is
  // exactly why it lives here rather than in the "fail closed per capability flag" describe block
  // below — this is the ONE assertion that needs the untouched, as-migrated row, not a reset one.
  it("dm_safety_enabled() is false on a genuinely fresh migration (no config UPDATE yet)", async () => {
    expect(await dmSafetyEnabled()).toBe(false);
  });
});

describe("chat_dm_safety_config boundary", () => {
  it("has exactly one row after migration", async () => {
    const { rows } = await ctx.owner.query(`SELECT count(*)::int AS n FROM chat_dm_safety_config`);
    expect((rows[0] as { n: number }).n).toBe(1);
  });

  it("rejects a second row (singleton PK)", async () => {
    await expect(
      ctx.owner.query(`INSERT INTO chat_dm_safety_config (singleton) VALUES (true)`),
    ).rejects.toThrow(/duplicate key|chat_dm_safety_config_pkey/i);
  });

  it("defaults dm_sender_limit_per_min and dm_target_limit_per_min to 30", async () => {
    const { rows } = await ctx.owner.query(
      `SELECT dm_sender_limit_per_min, dm_target_limit_per_min FROM chat_dm_safety_config`,
    );
    expect(rows[0]).toMatchObject({ dm_sender_limit_per_min: 30, dm_target_limit_per_min: 30 });
  });

  it("rejects dm_sender_limit_per_min = 0 and -1, leaving the prior value unchanged", async () => {
    await expect(setConfigFlag("dm_sender_limit_per_min", 0)).rejects.toThrow(
      /chat_dm_safety_config_sender_limit_positive_chk/,
    );
    await expect(setConfigFlag("dm_sender_limit_per_min", -1)).rejects.toThrow(
      /chat_dm_safety_config_sender_limit_positive_chk/,
    );
    const { rows } = await ctx.owner.query(
      `SELECT dm_sender_limit_per_min FROM chat_dm_safety_config`,
    );
    expect((rows[0] as { dm_sender_limit_per_min: number }).dm_sender_limit_per_min).toBe(30);
  });

  it("rejects dm_target_limit_per_min = 0, leaving the prior value unchanged", async () => {
    await expect(setConfigFlag("dm_target_limit_per_min", 0)).rejects.toThrow(
      /chat_dm_safety_config_target_limit_positive_chk/,
    );
    const { rows } = await ctx.owner.query(
      `SELECT dm_target_limit_per_min FROM chat_dm_safety_config`,
    );
    expect((rows[0] as { dm_target_limit_per_min: number }).dm_target_limit_per_min).toBe(30);
  });

  // codex round-03 [P2]: claimed tested (SS9's own acceptance-matrix row, round-01) but never
  // actually asserted anywhere in this file — a manual one-off smoke test against a scratch
  // database during implementation is not a regression test. Added for real here.
  it("updated_at advances on UPDATE, not just at INSERT (trg_chat_dm_safety_config_touch_updated_at)", async () => {
    const before = (await ctx.owner.query(`SELECT updated_at FROM chat_dm_safety_config`))
      .rows[0] as { updated_at: Date };
    await ctx.owner.query(`SELECT pg_sleep(0.01)`); // ensure now() advances past clock resolution
    await setConfigFlag("dm_sender_limit_per_min", 30);
    const after = (await ctx.owner.query(`SELECT updated_at FROM chat_dm_safety_config`))
      .rows[0] as { updated_at: Date };
    expect(new Date(after.updated_at).getTime()).toBeGreaterThan(
      new Date(before.updated_at).getTime(),
    );
  });
});

// codex round-03 [P2]: the migration's own comment claims a missing config row fails closed via
// COALESCE rather than erroring — claimed, never asserted anywhere in this file until now. Only a
// superuser (no DELETE grant exists to anyone else) can reach this state, exactly as ctx.owner is.
describe("dm_safety_enabled() / assert_dm_allowed() fail closed when the config row itself is missing", () => {
  it("both deny (not error) with the row deleted, and both recover once it's restored", async () => {
    await resetConfigDefaults();
    await ctx.owner.query(`DELETE FROM chat_dm_safety_config`);
    try {
      expect(await dmSafetyEnabled()).toBe(false);
      const a = await seedPerson("Missing Config A");
      const b = await seedPerson("Missing Config B");
      await expect(callAssertDmAllowed(a, b, "create")).rejects.toThrow(/chat safety blocked/);
    } finally {
      await ctx.owner.query(`INSERT INTO chat_dm_safety_config (singleton) VALUES (true)`);
      await resetConfigDefaults();
    }
    expect(await dmSafetyEnabled()).toBe(true);
  });
});

// codex round-02 [P1]: proves the `SET search_path = public, pg_temp` fix (not `pg_catalog,
// public`, which this file originally shipped) actually closes the temp-table shadowing hole --
// without an explicit pg_temp entry, Postgres searches pg_temp FIRST regardless, so a session's
// own temp table of the same name would silently substitute for the real one inside every
// unqualified reference in these SECURITY DEFINER function bodies.
describe("SECURITY DEFINER functions resist temp-table shadowing", () => {
  afterEach(async () => {
    await ctx.owner.query(`DROP TABLE IF EXISTS pg_temp.chat_dm_safety_config`);
    await ctx.owner.query(`DROP TABLE IF EXISTS pg_temp.chat_blocks`);
    await resetConfigDefaults();
  });

  it("dm_safety_enabled() ignores a same-session temp table shadowing chat_dm_safety_config", async () => {
    await resetConfigDefaults();
    expect(await dmSafetyEnabled()).toBe(true);
    await ctx.owner.query(`
      CREATE TEMP TABLE chat_dm_safety_config (
        singleton boolean PRIMARY KEY DEFAULT true,
        block_enabled boolean, report_enabled boolean,
        rate_limit_enabled boolean, audit_enabled boolean
      )
    `);
    await ctx.owner.query(
      `INSERT INTO pg_temp.chat_dm_safety_config
         (singleton, block_enabled, report_enabled, rate_limit_enabled, audit_enabled)
       VALUES (true, false, false, false, false)`,
    );
    // If the shadow were consulted, this would flip to false (the poisoned temp row).
    expect(await dmSafetyEnabled()).toBe(true);
  });

  it("chat_pair_blocked() ignores a same-session temp table shadowing chat_blocks", async () => {
    const a = await seedPerson("Shadow Pair A");
    const b = await seedPerson("Shadow Pair B");
    expect(await chatPairBlocked(a, b)).toBe(false);
    await ctx.owner.query(`
      CREATE TEMP TABLE chat_blocks (
        blocker_person_id uuid, blocked_person_id uuid
      )
    `);
    await ctx.owner.query(
      `INSERT INTO pg_temp.chat_blocks (blocker_person_id, blocked_person_id) VALUES ($1, $2)`,
      [a, b],
    );
    // If the shadow were consulted, this would flip to true (the poisoned temp row).
    expect(await chatPairBlocked(a, b)).toBe(false);
  });
});

describe("dm_safety_enabled() / chat_pair_blocked() happy path", () => {
  // "reset" here means resetConfigDefaults()'s own all-enabled operational baseline, distinct
  // from the migration's own column DEFAULT (false as of codex round-02 -- see "migration
  // baseline"'s fresh-migration test above for that one).
  it("dm_safety_enabled() is true once all four capabilities are explicitly enabled", async () => {
    await resetConfigDefaults();
    expect(await dmSafetyEnabled()).toBe(true);
  });

  it("chat_pair_blocked() is false for an unblocked pair", async () => {
    const a = await seedPerson("Pair Happy A");
    const b = await seedPerson("Pair Happy B");
    expect(await chatPairBlocked(a, b)).toBe(false);
  });
});

describe("assert_dm_allowed() happy path", () => {
  it("returns void with no exception for create/send/read when nothing blocks", async () => {
    await resetConfigDefaults();
    const a = await seedPerson("Happy Create A");
    const b = await seedPerson("Happy Create B");
    await expect(callAssertDmAllowed(a, b, "create")).resolves.toBeTruthy();
    await expect(callAssertDmAllowed(a, b, "send")).resolves.toBeTruthy();
    await expect(callAssertDmAllowed(a, b, "read")).resolves.toBeTruthy();
  });
});

describe("chat_blocks boundary", () => {
  it("rejects a self-block", async () => {
    const a = await seedPerson("Self Block");
    await expect(
      ctx.owner.query(
        `INSERT INTO chat_blocks (blocker_person_id, blocked_person_id) VALUES ($1, $1)`,
        [a],
      ),
    ).rejects.toThrow(/chat_blocks_no_self_chk/);
  });
});

describe("chat_reports boundary", () => {
  async function insertReport(
    reporter: string,
    reported: string,
    reason: string,
    note: string | null,
  ) {
    return ctx.owner.query(
      `INSERT INTO chat_reports (reporter_person_id, reported_person_id, reason_code, note)
       VALUES ($1, $2, $3, $4)`,
      [reporter, reported, reason, note],
    );
  }

  it("rejects reason_code='other' with a NULL note", async () => {
    const a = await seedPerson("Report Other Null A");
    const b = await seedPerson("Report Other Null B");
    await expect(insertReport(a, b, "other", null)).rejects.toThrow(/chat_reports_note_shape_chk/);
  });

  it("rejects reason_code='other' with an empty note", async () => {
    const a = await seedPerson("Report Other Empty A");
    const b = await seedPerson("Report Other Empty B");
    await expect(insertReport(a, b, "other", "   ")).rejects.toThrow(/chat_reports_note_shape_chk/);
  });

  it("rejects reason_code='spam' with a non-NULL note", async () => {
    const a = await seedPerson("Report Spam Note A");
    const b = await seedPerson("Report Spam Note B");
    await expect(insertReport(a, b, "spam", "unsolicited detail")).rejects.toThrow(
      /chat_reports_note_shape_chk/,
    );
  });

  it("accepts a note at exactly 500 chars and rejects 501", async () => {
    const a = await seedPerson("Report Note Len A");
    const b = await seedPerson("Report Note Len B");
    await expect(insertReport(a, b, "other", "x".repeat(500))).resolves.toBeTruthy();
    const c = await seedPerson("Report Note Len C");
    await expect(insertReport(a, c, "other", "x".repeat(501))).rejects.toThrow(
      /chat_reports_note_shape_chk/,
    );
  });

  it("rejects a 1-character note padded with whitespace to 501 raw chars (codex round-02 [P2])", async () => {
    const a = await seedPerson("Report Note Padded A");
    const b = await seedPerson("Report Note Padded B");
    const padded = " ".repeat(250) + "x" + " ".repeat(250); // trimmed length 1, raw length 501
    await expect(insertReport(a, b, "other", padded)).rejects.toThrow(
      /chat_reports_note_shape_chk/,
    );
  });

  it("rejects an unrecognized reason_code", async () => {
    const a = await seedPerson("Report Reason A");
    const b = await seedPerson("Report Reason B");
    await expect(insertReport(a, b, "not_a_real_reason", null)).rejects.toThrow(
      /chat_reports_reason_code_chk/,
    );
  });

  it("rejects a self-report", async () => {
    const a = await seedPerson("Report Self");
    await expect(insertReport(a, a, "spam", null)).rejects.toThrow(/chat_reports_no_self_chk/);
  });
});

describe("chat_pair_blocked() is direction-agnostic (highest-consequence property)", () => {
  it("returns true for BOTH argument orders once one direction is blocked", async () => {
    const a = await seedPerson("Direction A");
    const b = await seedPerson("Direction B");
    await ctx.owner.query(
      `INSERT INTO chat_blocks (blocker_person_id, blocked_person_id) VALUES ($1, $2)`,
      [a, b],
    );
    expect(await chatPairBlocked(a, b)).toBe(true);
    expect(await chatPairBlocked(b, a)).toBe(true);
  });

  it("does not block an unrelated pair sharing one member", async () => {
    const a = await seedPerson("Direction Scope A");
    const b = await seedPerson("Direction Scope B");
    const c = await seedPerson("Direction Scope C");
    await ctx.owner.query(
      `INSERT INTO chat_blocks (blocker_person_id, blocked_person_id) VALUES ($1, $2)`,
      [a, b],
    );
    expect(await chatPairBlocked(a, c)).toBe(false);
  });
});

describe("assert_dm_allowed() denies a blocked pair", () => {
  it("raises 'chat safety blocked' for the blocked pair", async () => {
    await resetConfigDefaults();
    const a = await seedPerson("Deny Blocked A");
    const b = await seedPerson("Deny Blocked B");
    await ctx.owner.query(
      `INSERT INTO chat_blocks (blocker_person_id, blocked_person_id) VALUES ($1, $2)`,
      [a, b],
    );
    await expect(callAssertDmAllowed(a, b, "create")).rejects.toThrow(/chat safety blocked/);
  });

  // codex round-04 [P1]: the four tests below used to assert on the RAISE LOG's own CLIENT-VISIBLE
  // content (actor/peer/action/deny_reason), which was itself the leak this round closed — a
  // caller-controlled client_min_messages='log' session received the same text a genuine attacker's
  // own connection could request. assert_dm_allowed() now forces client_min_messages = warning for
  // its own call, so that content is no longer observable from ANY client, including ctx.owner's
  // (see file header). These now prove the opposite, and more important, property: nothing arrives,
  // no matter what the caller's own session asks for, on every path that used to be checked.
  it("exposes nothing to the client on a denial, even though ctx.owner's own session requests client_min_messages='log'", async () => {
    await resetConfigDefaults();
    const a = await seedPerson("Deny Log A");
    const b = await seedPerson("Deny Log B");
    await ctx.owner.query(
      `INSERT INTO chat_blocks (blocker_person_id, blocked_person_id) VALUES ($1, $2)`,
      [a, b],
    );
    const notices = await captureNotices(() =>
      expect(callAssertDmAllowed(a, b, "create")).rejects.toThrow(/chat safety blocked/),
    );
    expect(notices.find((n) => n.severity === "LOG")).toBeUndefined();
  });

  it("exposes nothing to the client regardless of which flag/reason caused the denial", async () => {
    await resetConfigDefaults();
    const a = await seedPerson("Deny Log Other Flag A");
    const b = await seedPerson("Deny Log Other Flag B");
    await setConfigFlag("block_enabled", false); // audit_enabled itself stays true
    const notices = await captureNotices(() =>
      expect(callAssertDmAllowed(a, b, "create")).rejects.toThrow(/chat safety blocked/),
    );
    expect(notices.find((n) => n.severity === "LOG")).toBeUndefined();
  });

  it("exposes nothing to the client whether audit_enabled is true or false — that distinction is now server-side only, by design", async () => {
    await resetConfigDefaults();
    const a = await seedPerson("Deny No Log A");
    const b = await seedPerson("Deny No Log B");
    await ctx.owner.query(
      `INSERT INTO chat_blocks (blocker_person_id, blocked_person_id) VALUES ($1, $2)`,
      [a, b],
    );
    await setConfigFlag("audit_enabled", false);
    const notices = await captureNotices(() =>
      expect(callAssertDmAllowed(a, b, "create")).rejects.toThrow(/chat safety blocked/),
    );
    expect(notices.find((n) => n.severity === "LOG")).toBeUndefined();
  });

  it("racing the same (actor,peer,action) denial twice exposes nothing to the client either time", async () => {
    await resetConfigDefaults();
    const a = await seedPerson("Dup Log A");
    const b = await seedPerson("Dup Log B");
    await ctx.owner.query(
      `INSERT INTO chat_blocks (blocker_person_id, blocked_person_id) VALUES ($1, $2)`,
      [a, b],
    );
    const notices = await captureNotices(async () => {
      await expect(callAssertDmAllowed(a, b, "create")).rejects.toThrow(/chat safety blocked/);
      await expect(callAssertDmAllowed(a, b, "create")).rejects.toThrow(/chat safety blocked/);
    });
    expect(notices.filter((n) => n.severity === "LOG")).toHaveLength(0);
  });

  it("assert_dm_allowed's own client_min_messages override does not leak into the caller's session afterward", async () => {
    await resetConfigDefaults();
    const a = await seedPerson("Threshold Restore A");
    const b = await seedPerson("Threshold Restore B");
    await ctx.owner.query(
      `INSERT INTO chat_blocks (blocker_person_id, blocked_person_id) VALUES ($1, $2)`,
      [a, b],
    );
    await expect(callAssertDmAllowed(a, b, "create")).rejects.toThrow(/chat safety blocked/);
    const { rows } = await ctx.owner.query(`SHOW client_min_messages`);
    expect((rows[0] as { client_min_messages: string }).client_min_messages).toBe("log");
  });
});

describe("roles app/app_worker/readonly have zero direct access (global-protected plane)", () => {
  // codex round-03 [P2]: the original version only tried SELECT, and only for `app` — it could not
  // have detected a stray DML grant, or a grant to app_worker/readonly, either of which this
  // negative-scope explicitly forbids (SS8: "NO grant of any kind to app, app_worker, or readonly").
  const TABLES = ["chat_dm_safety_config", "chat_blocks", "chat_reports"];
  const ROLES: Array<["app" | "app_worker" | "readonly", () => pg.Pool]> = [
    ["app", () => ctx.appPool],
    ["app_worker", () => ctx.workerPool],
    ["readonly", () => ctx.readonlyPool],
  ];

  for (const [roleName, getPool] of ROLES) {
    for (const table of TABLES) {
      it(`${roleName} cannot SELECT from ${table}`, async () => {
        await expect(getPool().query(`SELECT 1 FROM ${table}`)).rejects.toThrow(
          /permission denied/i,
        );
      });

      it(`${roleName} cannot INSERT into ${table}`, async () => {
        await expect(getPool().query(`INSERT INTO ${table} DEFAULT VALUES`)).rejects.toThrow(
          /permission denied/i,
        );
      });
    }

    it(`${roleName} cannot EXECUTE dm_safety_enabled/chat_pair_blocked/assert_dm_allowed`, async () => {
      const pool = getPool();
      await expect(pool.query(`SELECT dm_safety_enabled()`)).rejects.toThrow(/permission denied/i);
      await expect(
        pool.query(`SELECT chat_pair_blocked($1, $1)`, ["00000000-0000-0000-0000-000000000000"]),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        pool.query(`SELECT assert_dm_allowed($1, $2, 'create')`, [
          "00000000-0000-0000-0000-000000000000",
          "00000000-0000-0000-0000-000000000001",
        ]),
      ).rejects.toThrow(/permission denied/i);
    });
  }

  // codex round-04 [P2]: the live-attempt tests above only try SELECT/INSERT/EXECUTE — they could
  // not have caught a stray UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER grant, or a column-level one.
  // has_table_privilege/has_function_privilege query the ACTUAL catalog-derived effective privilege
  // set (via ctx.owner, a superuser, checking on each role's behalf — no live connection needed per
  // role/privilege combination), covering every table-level privilege PG16 defines.
  const TABLE_PRIVILEGES = [
    "SELECT",
    "INSERT",
    "UPDATE",
    "DELETE",
    "TRUNCATE",
    "REFERENCES",
    "TRIGGER",
  ];
  const FUNCTIONS = [
    "dm_safety_enabled()",
    "chat_pair_blocked(uuid, uuid)",
    "assert_dm_allowed(uuid, uuid, text)",
  ];

  it("catalog confirms zero table privilege of any kind, for any role, on any of the three tables", async () => {
    for (const [roleName] of ROLES) {
      for (const table of TABLES) {
        for (const privilege of TABLE_PRIVILEGES) {
          const { rows } = await ctx.owner.query(`SELECT has_table_privilege($1, $2, $3) AS has`, [
            roleName,
            table,
            privilege,
          ]);
          expect(
            (rows[0] as { has: boolean }).has,
            `${roleName} must not have ${privilege} on ${table}`,
          ).toBe(false);
        }
      }
    }
  });

  it("catalog confirms zero EXECUTE privilege, for any role, on any of the three functions", async () => {
    for (const [roleName] of ROLES) {
      for (const fn of FUNCTIONS) {
        const { rows } = await ctx.owner.query(
          `SELECT has_function_privilege($1, $2, 'EXECUTE') AS has`,
          [roleName, fn],
        );
        expect(
          (rows[0] as { has: boolean }).has,
          `${roleName} must not have EXECUTE on ${fn}`,
        ).toBe(false);
      }
    }
  });
});

describe("dm_safety_enabled() / assert_dm_allowed() fail closed per capability flag", () => {
  const flags = ["block_enabled", "report_enabled", "rate_limit_enabled", "audit_enabled"];

  it.each(flags)(
    "disabling %s alone makes dm_safety_enabled() false and denies with safety_disabled",
    async (flag) => {
      await resetConfigDefaults();
      const a = await seedPerson(`Flag ${flag} A`);
      const b = await seedPerson(`Flag ${flag} B`);
      await setConfigFlag(flag, false);
      expect(await dmSafetyEnabled()).toBe(false);
      await expect(callAssertDmAllowed(a, b, "send")).rejects.toThrow(/chat safety blocked/);
      await resetConfigDefaults();
    },
  );
});

describe("assert_dm_allowed() invalid input", () => {
  it("rejects NULL actor, NULL peer, and actor === peer before any side effect", async () => {
    await resetConfigDefaults();
    const a = await seedPerson("Invalid Input A");
    const b = await seedPerson("Invalid Input B");
    await expect(callAssertDmAllowed(null, b, "create")).rejects.toThrow(/invalid participants/);
    await expect(callAssertDmAllowed(a, null, "create")).rejects.toThrow(/invalid participants/);
    await expect(callAssertDmAllowed(a, a, "create")).rejects.toThrow(/invalid participants/);
  });

  it("rejects an unknown action", async () => {
    const a = await seedPerson("Invalid Action A");
    const b = await seedPerson("Invalid Action B");
    await expect(callAssertDmAllowed(a, b, "delete")).rejects.toThrow(/invalid action/);
  });

  // codex round-03 [P2]: this exact regression was CLAIMED fixed and tested in round-01, but
  // callAssertDmAllowed's own signature required a non-null string for action, so the claimed
  // test could never have been written — the acceptance-matrix row was asserting something this
  // file never actually verified. Widened the helper's type and added the real test.
  it("rejects a NULL action (codex round-01 [P1] fix, actually exercised here)", async () => {
    const a = await seedPerson("Null Action A");
    const b = await seedPerson("Null Action B");
    await expect(callAssertDmAllowed(a, b, null)).rejects.toThrow(/invalid action/);
  });
});

describe("assert_dm_allowed() rate limiting", () => {
  it("denies with rate_limited_sender on the call after the live-tuned limit, without migration or reconnect", async () => {
    await resetConfigDefaults();
    const a = await seedPerson("Rate Sender A");
    const target1 = await seedPerson("Rate Sender Target1");
    const target2 = await seedPerson("Rate Sender Target2");
    await setConfigFlag("dm_sender_limit_per_min", 1);

    await expect(callAssertDmAllowed(a, target1, "create")).resolves.toBeTruthy();
    await expect(callAssertDmAllowed(a, target2, "create")).rejects.toThrow(/chat safety blocked/);
  });

  it("denies with rate_limited_target once the target bucket is exhausted across distinct senders", async () => {
    await resetConfigDefaults();
    const sender1 = await seedPerson("Rate Target Sender1");
    const sender2 = await seedPerson("Rate Target Sender2");
    const target = await seedPerson("Rate Target Target");
    await setConfigFlag("dm_target_limit_per_min", 1);

    await expect(callAssertDmAllowed(sender1, target, "send")).resolves.toBeTruthy();
    await expect(callAssertDmAllowed(sender2, target, "send")).rejects.toThrow(
      /chat safety blocked/,
    );
  });

  it("never rate-limits the 'read' action even past the sender limit", async () => {
    await resetConfigDefaults();
    const a = await seedPerson("Rate Read A");
    const b = await seedPerson("Rate Read B");
    await setConfigFlag("dm_sender_limit_per_min", 1);
    // Exhaust the sender bucket via 'create' first.
    const other = await seedPerson("Rate Read Other");
    await callAssertDmAllowed(a, other, "create");
    // 'read' between a and b must still succeed even though a's sender bucket is now exhausted.
    await expect(callAssertDmAllowed(a, b, "read")).resolves.toBeTruthy();
  });
});

describe("security/privacy: denial message never varies by deny_reason", () => {
  it("safety_disabled, blocked, and rate_limited paths all raise the exact same string", async () => {
    await resetConfigDefaults();

    const dA = await seedPerson("Msg Disabled A");
    const dB = await seedPerson("Msg Disabled B");
    await setConfigFlag("block_enabled", false);
    await expect(callAssertDmAllowed(dA, dB, "create")).rejects.toThrow(/^chat safety blocked$/);
    await resetConfigDefaults();

    const bA = await seedPerson("Msg Blocked A");
    const bB = await seedPerson("Msg Blocked B");
    await ctx.owner.query(
      `INSERT INTO chat_blocks (blocker_person_id, blocked_person_id) VALUES ($1, $2)`,
      [bA, bB],
    );
    await expect(callAssertDmAllowed(bA, bB, "create")).rejects.toThrow(/^chat safety blocked$/);
    await resetConfigDefaults();

    const rA = await seedPerson("Msg Rate A");
    const rB = await seedPerson("Msg Rate B");
    const rC = await seedPerson("Msg Rate C");
    await setConfigFlag("dm_sender_limit_per_min", 1);
    await callAssertDmAllowed(rA, rB, "create");
    await expect(callAssertDmAllowed(rA, rC, "create")).rejects.toThrow(/^chat safety blocked$/);
  });
});

describe("concurrency: sender bucket admits exactly up to the configured limit", () => {
  // codex round-02 [P2]: the original version fired all 6 calls through ctx.owner, a single
  // pg.Client — node-postgres queues a Client's queries FIFO on one connection, so despite
  // Promise.allSettled at the JS layer, Postgres itself ran them strictly sequentially and never
  // exercised assert_dm_allowed()'s pg_advisory_xact_lock serialization at all. Six independent
  // clients, connected first (a barrier) and then fired together, exercise a real race.
  it("admits exactly 3 of 6 truly concurrent create attempts at limit=3", async () => {
    await resetConfigDefaults();
    const a = await seedPerson("Concurrency Sender A");
    await setConfigFlag("dm_sender_limit_per_min", 3);
    const targets = await Promise.all(
      Array.from({ length: 6 }, (_, i) => seedPerson(`Concurrency Target ${i}`)),
    );

    const dbUrl = new URL(process.env.DATABASE_URL_TEST as string);
    dbUrl.pathname = `/${TEST_DB_NAME}`;
    const clients = Array.from(
      { length: 6 },
      () => new pg.Client({ connectionString: dbUrl.toString() }),
    );
    await Promise.all(clients.map((c) => c.connect()));
    try {
      const results = await Promise.allSettled(
        clients.map((c, i) =>
          c.query(`SELECT assert_dm_allowed($1, $2, 'create')`, [a, targets[i]]),
        ),
      );
      const fulfilled = results.filter((r) => r.status === "fulfilled").length;
      const rejected = results.filter((r) => r.status === "rejected").length;
      expect(fulfilled).toBe(3);
      expect(rejected).toBe(3);
    } finally {
      await Promise.all(clients.map((c) => c.end()));
    }
  });
});

describe("migration shape", () => {
  it("adds exactly one new migration file for this slice", () => {
    const chatMigrations = ctx.migrateResult.applied.filter((f) =>
      f.includes("chat_dm_safety_authority_core"),
    );
    expect(chatMigrations).toEqual(["0030_chat_dm_safety_authority_core.sql"]);
  });
});

// ---------------------------------------------------------------------------
// chat-dm-safety-config-single-read (migration 0032, DD-102 hard condition):
// assert_dm_allowed() now decides on ONE consistent snapshot of
// chat_dm_safety_config instead of four independent READ COMMITTED reads. The 66
// behavioural tests above already re-assert 0030's every deny path against the
// RECREATED functions (the harness applies 0032); the tests below add the new
// invariants the collapse itself introduces — the structural single-read proof,
// dm_safety_enabled()'s behaviour-preservation across the CREATE OR REPLACE, the
// out-of-scope consumer dm_current_read_allowed() being unaffected, and the new
// pure helper leaking nothing.
// ---------------------------------------------------------------------------

/** dm_key = the two person ids sorted ascending, matching chat_assert_dm_two's own
 *  `string_agg(person_id::text, ':' ORDER BY person_id)` (canonical lowercase uuid text
 *  compares in the same order Postgres sorts the uuid type). Mirrors chat-schema-invariants. */
function dmKeyFor(personA: string, personB: string): string {
  const [a, b] = [personA, personB].sort();
  return `${a}:${b}`;
}

/** Channel + both members MUST commit in one transaction: chat_assert_dm_two's deferred
 *  constraint triggers re-check "exactly 2 members" at COMMIT, so a dm channel can never
 *  durably rest at 0 or 1 member between separate autocommit statements. */
async function seedDmChannelWithMembers(personA: string, personB: string): Promise<string> {
  await ctx.owner.query("BEGIN");
  try {
    const { rows } = await ctx.owner.query(
      `INSERT INTO chat_channels (kind, dm_key) VALUES ('dm', $1) RETURNING id`,
      [dmKeyFor(personA, personB)],
    );
    const channelId = (rows[0] as { id: string }).id;
    await ctx.owner.query(
      `INSERT INTO chat_members (channel_id, person_id) VALUES ($1, $2), ($1, $3)`,
      [channelId, personA, personB],
    );
    await ctx.owner.query("COMMIT");
    return channelId;
  } catch (error) {
    await ctx.owner.query("ROLLBACK");
    throw error;
  }
}

async function dmCurrentReadAllowed(channelId: string): Promise<boolean> {
  const { rows } = await ctx.owner.query(`SELECT dm_current_read_allowed($1) AS v`, [channelId]);
  return (rows[0] as { v: boolean }).v;
}

describe("0032 single-read collapse: structural proof (acceptance rows 1 & 2)", () => {
  it("assert_dm_allowed() reads the singleton config row exactly once and no longer calls dm_safety_enabled()", async () => {
    const { rows } = await ctx.owner.query(
      `SELECT pg_get_functiondef('assert_dm_allowed(uuid, uuid, text)'::regprocedure) AS def`,
    );
    const def = (rows[0] as { def: string }).def;
    // one snapshot: exactly one read of the singleton row. The `%ROWTYPE` type reference in the
    // DECLARE is not a read, so match the read predicate specifically, not the bare table name.
    expect(def.match(/chat_dm_safety_config WHERE singleton/g) ?? []).toHaveLength(1);
    // torn read closed: the 4th read (the dm_safety_enabled() call) is gone. `dm_safety_flags_enabled(`
    // is NOT matched by /dm_safety_enabled\(/ (it has `flags_` between), so this is unambiguous.
    expect(def).not.toMatch(/dm_safety_enabled\(/);
    // enabled is derived from the shared single-source helper, from that same one snapshot.
    expect(def).toMatch(/dm_safety_flags_enabled\(/);
  });

  it("dm_safety_enabled() delegates to the single-source helper and keeps its own single read", async () => {
    const { rows } = await ctx.owner.query(
      `SELECT pg_get_functiondef('dm_safety_enabled()'::regprocedure) AS def`,
    );
    const def = (rows[0] as { def: string }).def;
    expect(def).toMatch(/dm_safety_flags_enabled\(/);
    expect(def.match(/chat_dm_safety_config WHERE singleton/g) ?? []).toHaveLength(1);
  });
});

describe("0032: dm_safety_enabled() observable semantics preserved across CREATE OR REPLACE (acceptance row 2b)", () => {
  const flags = ["block_enabled", "report_enabled", "rate_limit_enabled", "audit_enabled"];

  it("returns false — not NULL, not an error — when the singleton config row is missing (outer COALESCE)", async () => {
    await resetConfigDefaults();
    await ctx.owner.query(`DELETE FROM chat_dm_safety_config`);
    try {
      const { rows } = await ctx.owner.query(
        `SELECT dm_safety_enabled() AS v, dm_safety_enabled() IS NULL AS is_null`,
      );
      expect((rows[0] as { v: boolean }).v).toBe(false);
      expect((rows[0] as { is_null: boolean }).is_null).toBe(false); // outer COALESCE, not the NULL-returning inner form
    } finally {
      await ctx.owner.query(`INSERT INTO chat_dm_safety_config (singleton) VALUES (true)`);
      await resetConfigDefaults();
    }
  });

  it.each(flags)(
    "returns false when only %s is disabled (each toggle independently gates)",
    async (flag) => {
      await resetConfigDefaults();
      await setConfigFlag(flag, false);
      expect(await dmSafetyEnabled()).toBe(false);
      await resetConfigDefaults();
    },
  );

  it("returns true when all four flags are enabled", async () => {
    await resetConfigDefaults();
    expect(await dmSafetyEnabled()).toBe(true);
  });
});

describe("0032: dm_current_read_allowed() (0031, out of scope) is unaffected by the dm_safety_enabled() recreation (acceptance row 12)", () => {
  it("still gates on the recreated dm_safety_enabled() and chat_pair_blocked()", async () => {
    await resetConfigDefaults();
    const p1 = await seedPerson("Consumer DM A");
    const p2 = await seedPerson("Consumer DM B");
    const channelId = await seedDmChannelWithMembers(p1, p2);
    try {
      await ctx.owner.query(`SELECT set_config('app.person_id', $1, false)`, [p1]);
      // safety fully enabled, pair not blocked, caller is a member -> read allowed
      expect(await dmCurrentReadAllowed(channelId)).toBe(true);
      // disabling any safety flag flips dm_safety_enabled() to false -> read denied (the recreated term)
      await setConfigFlag("block_enabled", false);
      expect(await dmCurrentReadAllowed(channelId)).toBe(false);
      await resetConfigDefaults();
      expect(await dmCurrentReadAllowed(channelId)).toBe(true);
      // blocking the pair -> chat_pair_blocked() true -> read denied (unchanged second term)
      await ctx.owner.query(
        `INSERT INTO chat_blocks (blocker_person_id, blocked_person_id) VALUES ($1, $2)`,
        [p1, p2],
      );
      expect(await dmCurrentReadAllowed(channelId)).toBe(false);
    } finally {
      await ctx.owner.query(`SELECT set_config('app.person_id', '', false)`);
      await resetConfigDefaults();
    }
  });
});

describe("0032: the new pure helper dm_safety_flags_enabled leaks nothing (security item 8)", () => {
  const helper = "dm_safety_flags_enabled(boolean, boolean, boolean, boolean)";

  it("is owned by chat_definer (so the two definer callers keep implicit EXECUTE)", async () => {
    const { rows } = await ctx.owner.query(
      `SELECT pg_get_userbyid(proowner) AS owner FROM pg_proc WHERE proname = 'dm_safety_flags_enabled'`,
    );
    expect(rows).toHaveLength(1);
    expect((rows[0] as { owner: string }).owner).toBe("chat_definer");
    const cd = await ctx.owner.query(
      `SELECT has_function_privilege('chat_definer', $1, 'EXECUTE') AS has`,
      [helper],
    );
    expect((cd.rows[0] as { has: boolean }).has).toBe(true);
  });

  it("grants zero EXECUTE to app/app_worker/readonly (REVOKE PUBLIC intact)", async () => {
    for (const role of ["app", "app_worker", "readonly"]) {
      const { rows } = await ctx.owner.query(
        `SELECT has_function_privilege($1, $2, 'EXECUTE') AS has`,
        [role, helper],
      );
      expect((rows[0] as { has: boolean }).has, `${role} must not EXECUTE the helper`).toBe(false);
    }
  });

  it("touches no table (pure): it reads only its four boolean arguments", async () => {
    const { rows } = await ctx.owner.query(
      `SELECT pg_get_functiondef('${helper}'::regprocedure) AS def`,
    );
    const def = (rows[0] as { def: string }).def;
    expect(def).not.toMatch(/chat_dm_safety_config/); // no table access at all
    expect(def).toMatch(/p_block AND p_report AND p_rate AND p_audit/);
  });
});

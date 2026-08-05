import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupRlsTestContext, type RlsTestContext } from "./test-harness.js";

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
 * instead, which Postgres delivers outside transactional rollback. RAISE LOG
 * is invisible to a client at the default client_min_messages ('notice'), so
 * tests that assert on it SET client_min_messages = 'log' on ctx.owner and
 * capture the pg driver's 'notice' event -- see captureNotices() below.
 */

let ctx: RlsTestContext;

beforeAll(async () => {
  ctx = await setupRlsTestContext("plexco_chat_dm_safety_check");
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
async function captureNotices(fn: () => Promise<unknown>): Promise<Array<{ severity?: string; message?: string }>> {
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

function callAssertDmAllowed(actor: string | null, peer: string | null, action: string) {
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
});

describe("dm_safety_enabled() / chat_pair_blocked() happy path", () => {
  it("dm_safety_enabled() is true with default config", async () => {
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

  it("emits a RAISE LOG line carrying actor/peer/action/deny_reason (no chat_dm_safety_audit table — see file header)", async () => {
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
    const logLine = notices.find((n) => n.severity === "LOG");
    expect(logLine?.message).toContain(`actor=${a}`);
    expect(logLine?.message).toContain(`peer=${b}`);
    expect(logLine?.message).toContain("action=create");
    expect(logLine?.message).toContain("deny_reason=blocked");
  });

  it("still logs when the denial reason is safety_disabled via a flag OTHER than audit_enabled", async () => {
    await resetConfigDefaults();
    const a = await seedPerson("Deny Log Other Flag A");
    const b = await seedPerson("Deny Log Other Flag B");
    await setConfigFlag("block_enabled", false); // audit_enabled itself stays true
    const notices = await captureNotices(() =>
      expect(callAssertDmAllowed(a, b, "create")).rejects.toThrow(/chat safety blocked/),
    );
    const logLine = notices.find((n) => n.severity === "LOG");
    expect(logLine?.message).toContain("deny_reason=safety_disabled");
  });

  it("emits NO RAISE LOG line when audit_enabled is false (fail-closed: missing/disabled audit means silent, not 'log anyway')", async () => {
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
});

describe("role app has zero direct access (global-protected plane)", () => {
  it("app cannot SELECT/INSERT chat_dm_safety_config/chat_blocks/chat_reports", async () => {
    await expect(ctx.appPool.query(`SELECT 1 FROM chat_dm_safety_config`)).rejects.toThrow(
      /permission denied/i,
    );
    await expect(ctx.appPool.query(`SELECT 1 FROM chat_blocks`)).rejects.toThrow(
      /permission denied/i,
    );
    await expect(ctx.appPool.query(`SELECT 1 FROM chat_reports`)).rejects.toThrow(
      /permission denied/i,
    );
  });

  it("app cannot EXECUTE dm_safety_enabled/chat_pair_blocked/assert_dm_allowed", async () => {
    await expect(ctx.appPool.query(`SELECT dm_safety_enabled()`)).rejects.toThrow(
      /permission denied/i,
    );
    await expect(
      ctx.appPool.query(`SELECT chat_pair_blocked($1, $1)`, [
        "00000000-0000-0000-0000-000000000000",
      ]),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      ctx.appPool.query(`SELECT assert_dm_allowed($1, $2, 'create')`, [
        "00000000-0000-0000-0000-000000000000",
        "00000000-0000-0000-0000-000000000001",
      ]),
    ).rejects.toThrow(/permission denied/i);
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
  it("admits exactly 3 of 6 concurrent create attempts at limit=3", async () => {
    await resetConfigDefaults();
    const a = await seedPerson("Concurrency Sender A");
    await setConfigFlag("dm_sender_limit_per_min", 3);
    const targets = await Promise.all(
      Array.from({ length: 6 }, (_, i) => seedPerson(`Concurrency Target ${i}`)),
    );

    const results = await Promise.allSettled(
      targets.map((t) => callAssertDmAllowed(a, t, "create")),
    );
    const fulfilled = results.filter((r) => r.status === "fulfilled").length;
    const rejected = results.filter((r) => r.status === "rejected").length;
    expect(fulfilled).toBe(3);
    expect(rejected).toBe(3);
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

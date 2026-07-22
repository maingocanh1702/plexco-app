import { createHash, randomBytes } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  LoginReplayError,
  onboardingSnapshot,
  rateLimitCheck,
  SlugTakenError,
  consumeLoginState,
  createWebSession,
  issueLoginState,
  loginTelegram,
  provisionTenant,
  resolveWebSession,
  revokeAllWebSessions,
  revokeWebSession,
  rotateWebSession,
  tenantsForPerson,
} from "./auth.js";
import { setupRlsTestContext, type RlsTestContext } from "./test-harness.js";

/** S4 auth invariants — run as the REAL `app` role via the 0012 fns. */

let ctx: RlsTestContext;

beforeAll(async () => {
  ctx = await setupRlsTestContext("plexco_auth_check");
}, 120_000);

afterAll(async () => {
  await ctx?.teardown();
});

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const freshLogin = (uid: string) => ({
  platformUserHash: sha(`tg:${uid}`),
  displayName: `Player ${uid}`,
  loginHash: sha(`payload:${uid}:${randomBytes(8).toString("hex")}`),
});

/**
 * Deterministic concurrency barrier for the D0a epoch race suite (G3 §8: "two
 * checked-out PostgreSQL connections and deterministic barriers ... timing
 * sleeps are not acceptance evidence"). Confirms `waiterPid` is blocked
 * SPECIFICALLY by `holderPid` via `pg_blocking_pids()` — not just "blocked on
 * something" (codex round-01 [P2]: a bare `wait_event_type = 'Lock'` check
 * would also pass for a waiter blocked on an unrelated/incidental lock).
 * NOTE: an uncontended row lock (`SELECT ... FOR UPDATE`) leaves no `pg_locks`
 * row for the HOLDER at all — Postgres encodes it directly in the tuple's
 * xmax, not the lock manager — so proving which RELATION the holder locked
 * isn't externally observable this way; pinning the exact blocking backend
 * is the strongest black-box signal available without instrumenting the
 * function under test.
 */
async function waitUntilBlockedByHolder(
  owner: pg.Client,
  holderPid: number,
  waiterPid: number,
): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const { rows } = await owner.query(
      `SELECT 1 FROM pg_stat_activity
       WHERE pid = $2 AND wait_event_type = 'Lock' AND $1 = ANY(pg_blocking_pids($2))`,
      [holderPid, waiterPid],
    );
    if (rows.length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error(
    `waiter ${waiterPid} never blocked specifically by holder ${holderPid} within 5s`,
  );
}

async function backendPid(client: pg.PoolClient): Promise<number> {
  const { rows } = await client.query(`SELECT pg_backend_pid() AS pid`);
  return (rows[0] as { pid: number }).pid;
}

describe("auth_login_telegram", () => {
  it("first login creates person+account; re-login reuses them", async () => {
    const input = freshLogin("111");
    const first = await loginTelegram(ctx.appPool, input);
    expect(first.created).toBe(true);

    const again = await loginTelegram(ctx.appPool, {
      ...freshLogin("111"),
      platformUserHash: input.platformUserHash,
    });
    expect(again.created).toBe(false);
    expect(again.accountId).toBe(first.accountId);
    expect(again.personId).toBe(first.personId);
  });

  it("replayed login payload (same nonce) is rejected", async () => {
    const input = freshLogin("222");
    await loginTelegram(ctx.appPool, input);
    await expect(loginTelegram(ctx.appPool, input)).rejects.toThrow(LoginReplayError);
  });

  it("DD-26: an existing person's display name is NEVER overwritten at login", async () => {
    const input = freshLogin("333");
    const { personId } = await loginTelegram(ctx.appPool, input);
    await loginTelegram(ctx.appPool, {
      platformUserHash: input.platformUserHash,
      displayName: "Totally Different Name",
      loginHash: sha(`payload:333:${randomBytes(8).toString("hex")}`),
    });
    const { rows } = await ctx.owner.query(`SELECT display_name FROM persons WHERE id = $1`, [
      personId,
    ]);
    expect((rows[0] as { display_name: string }).display_name).toBe("Player 333");
  });

  it("app role still has NO direct access to the nonce table", async () => {
    await expect(ctx.appPool.query(`SELECT * FROM auth_login_nonces`)).rejects.toThrow(
      /permission denied/i,
    );
  });

  it("has a standalone index on `seen_at` so the retention sweep never full-scans (codex round-09)", async () => {
    const { rows } = await ctx.owner.query(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'auth_login_nonces' AND indexname = 'idx_auth_login_nonces_seen_at'`,
    );
    expect(rows).toHaveLength(1);
    expect((rows[0] as { indexdef: string }).indexdef).toMatch(/\(seen_at\)/);
  });
});

describe("auth_login_telegram concurrency", () => {
  it("two concurrent FIRST logins (distinct nonces) converge on one account", async () => {
    const userHash = sha("tg:race-user");
    const mk = () => ({
      platformUserHash: userHash,
      displayName: "Race User",
      loginHash: sha(`payload:race:${randomBytes(8).toString("hex")}`),
    });
    const [a, b] = await Promise.all([
      loginTelegram(ctx.appPool, mk()),
      loginTelegram(ctx.appPool, mk()),
    ]);
    expect(a.accountId).toBe(b.accountId);
    expect(a.personId).toBe(b.personId);
    const { rows } = await ctx.owner.query(
      `SELECT count(*)::int AS n FROM account_identities WHERE platform_user_hash = $1`,
      [userHash],
    );
    expect((rows[0] as { n: number }).n).toBe(1);
  });
});

describe("auth_login_state (DD-31 SI-1 — login-state CSRF binding)", () => {
  const stateHash = (raw: string) => sha(`state:${raw}`);

  it("a freshly issued state consumes exactly once", async () => {
    const raw = randomBytes(16).toString("hex");
    const hash = stateHash(raw);
    await issueLoginState(ctx.appPool, { stateHash: hash, ttlSeconds: 600 });

    expect(await consumeLoginState(ctx.appPool, hash)).toBe(true);
    // second consume of the SAME state must fail (single-use)
    expect(await consumeLoginState(ctx.appPool, hash)).toBe(false);
  });

  it("consuming a state that was never issued fails closed", async () => {
    expect(await consumeLoginState(ctx.appPool, stateHash("never-issued"))).toBe(false);
  });

  it("an expired state fails closed even though it was never consumed", async () => {
    const raw = randomBytes(16).toString("hex");
    const hash = stateHash(raw);
    await issueLoginState(ctx.appPool, { stateHash: hash, ttlSeconds: -1 }); // already expired
    expect(await consumeLoginState(ctx.appPool, hash)).toBe(false);
  });

  it("concurrent consumes of the SAME state admit exactly one winner", async () => {
    const raw = randomBytes(16).toString("hex");
    const hash = stateHash(raw);
    await issueLoginState(ctx.appPool, { stateHash: hash, ttlSeconds: 600 });
    const results = await Promise.all(
      Array.from({ length: 5 }, () => consumeLoginState(ctx.appPool, hash)),
    );
    expect(results.filter(Boolean).length).toBe(1);
  });

  it("app role has no direct access to the login-state table", async () => {
    await expect(ctx.appPool.query(`SELECT * FROM auth_login_state`)).rejects.toThrow(
      /permission denied/i,
    );
  });
});

describe("web sessions", () => {
  it("create → resolve → revoke lifecycle; expired/revoked resolve to null", async () => {
    const { accountId, personId } = await loginTelegram(ctx.appPool, freshLogin("444"));
    const tokenHash = sha(randomBytes(32).toString("hex"));
    await createWebSession(ctx.appPool, {
      accountId,
      tokenHash,
      csrfSecret: "csrf-1",
      ttlSeconds: 900,
    });

    const resolved = await resolveWebSession(ctx.appPool, tokenHash);
    expect(resolved?.accountId).toBe(accountId);
    expect(resolved?.personId).toBe(personId);
    expect(resolved?.csrfSecret).toBe("csrf-1");

    expect(await revokeWebSession(ctx.appPool, tokenHash)).toBe(true);
    expect(await resolveWebSession(ctx.appPool, tokenHash)).toBeNull();

    const expiredHash = sha(randomBytes(32).toString("hex"));
    await createWebSession(ctx.appPool, {
      accountId,
      tokenHash: expiredHash,
      csrfSecret: "csrf-2",
      ttlSeconds: -5, // already expired
    });
    expect(await resolveWebSession(ctx.appPool, expiredHash)).toBeNull();
  });

  it("rotation revokes the old token and links the new session (fixation defense)", async () => {
    const { accountId } = await loginTelegram(ctx.appPool, freshLogin("555"));
    const oldHash = sha(randomBytes(32).toString("hex"));
    await createWebSession(ctx.appPool, {
      accountId,
      tokenHash: oldHash,
      csrfSecret: "old",
      ttlSeconds: 900,
    });

    const newHash = sha(randomBytes(32).toString("hex"));
    const rotated = await rotateWebSession(ctx.appPool, {
      oldTokenHash: oldHash,
      newTokenHash: newHash,
      newCsrfSecret: "new",
      ttlSeconds: 900,
      accountId,
    });
    expect(rotated).not.toBeNull();
    expect(await resolveWebSession(ctx.appPool, oldHash)).toBeNull();
    const fresh = await resolveWebSession(ctx.appPool, newHash);
    expect(fresh?.csrfSecret).toBe("new");

    // cross-account login over a live cookie binds the NEW session to the
    // NEWLY authenticated account (account-confusion regression)
    const other = await loginTelegram(ctx.appPool, freshLogin("5555"));
    const crossHash = sha(randomBytes(32).toString("hex"));
    await rotateWebSession(ctx.appPool, {
      oldTokenHash: newHash,
      newTokenHash: crossHash,
      newCsrfSecret: "cross",
      ttlSeconds: 900,
      accountId: other.accountId,
    });
    const crossResolved = await resolveWebSession(ctx.appPool, crossHash);
    expect(crossResolved?.accountId).toBe(other.accountId);

    // rotating a dead token mints nothing
    expect(
      await rotateWebSession(ctx.appPool, {
        oldTokenHash: oldHash,
        newTokenHash: sha("x"),
        newCsrfSecret: "x",
        ttlSeconds: 900,
        accountId,
      }),
    ).toBeNull();
  });

  it("a token guess (person B) cannot resolve person A's session", async () => {
    const { accountId } = await loginTelegram(ctx.appPool, freshLogin("666"));
    const tokenHash = sha(randomBytes(32).toString("hex"));
    await createWebSession(ctx.appPool, {
      accountId,
      tokenHash,
      csrfSecret: "c",
      ttlSeconds: 900,
    });
    expect(await resolveWebSession(ctx.appPool, sha("wrong-token"))).toBeNull();
  });
});

describe("rate_limit_check (shared store)", () => {
  it("has a standalone index on `at` so the global sweep never full-scans as buckets grow (codex round-01)", async () => {
    const { rows } = await ctx.owner.query(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'rate_limit_hits' AND indexname = 'idx_rate_limit_at'`,
    );
    expect(rows).toHaveLength(1);
    expect((rows[0] as { indexdef: string }).indexdef).toMatch(/\(at\)/);
  });

  it("allows up to the limit within the window, then refuses", async () => {
    const bucket = "test:limiter";
    expect(await rateLimitCheck(ctx.appPool, bucket, 2, 60)).toBe(true);
    expect(await rateLimitCheck(ctx.appPool, bucket, 2, 60)).toBe(true);
    expect(await rateLimitCheck(ctx.appPool, bucket, 2, 60)).toBe(false);
    // separate bucket unaffected
    expect(await rateLimitCheck(ctx.appPool, "test:other", 2, 60)).toBe(true);
  });

  it("concurrent burst admits EXACTLY the limit (per-bucket serialization)", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => rateLimitCheck(ctx.appPool, "test:burst", 2, 60)),
    );
    expect(results.filter(Boolean).length).toBe(2);
  });

  it("app role has no direct access to the hits table", async () => {
    await expect(ctx.appPool.query(`SELECT * FROM rate_limit_hits`)).rejects.toThrow(
      /permission denied/i,
    );
  });

  it("global sweep purges a stale row from an UNRELATED bucket that never returns", async () => {
    await ctx.owner.query(
      `INSERT INTO rate_limit_hits (bucket, at) VALUES ('test:abandoned', now() - interval '2 days')`,
    );
    // any call, on a different bucket, triggers the global sweep
    await rateLimitCheck(ctx.appPool, "test:trigger-sweep", 10, 60);
    const { rows } = await ctx.owner.query(
      `SELECT 1 FROM rate_limit_hits WHERE bucket = 'test:abandoned'`,
    );
    expect(rows).toHaveLength(0);
  });

  it("global sweep never shortens an active bucket's own (longer) window", async () => {
    const bucket = "test:long-window";
    // 30 minutes old — well within a 1h window, must still count toward the limit
    await ctx.owner.query(
      `INSERT INTO rate_limit_hits (bucket, at) VALUES ($1, now() - interval '30 minutes')`,
      [bucket],
    );
    expect(await rateLimitCheck(ctx.appPool, bucket, 3, 3600)).toBe(true);
    expect(await rateLimitCheck(ctx.appPool, bucket, 3, 3600)).toBe(true);
    expect(await rateLimitCheck(ctx.appPool, bucket, 3, 3600)).toBe(false);
  });
});

describe("tenant_provision (BL-BIL-1)", () => {
  it("new tenant is ACTIVE on the free plan immediately — no trial, period never ends", async () => {
    const { personId } = await loginTelegram(ctx.appPool, freshLogin("777"));
    const tenantId = await provisionTenant(ctx.appPool, {
      slug: "wao-club-a",
      name: "WAO Club A",
      personId,
    });

    const tenant = await ctx.owner.query(`SELECT status FROM tenants WHERE id = $1`, [tenantId]);
    expect((tenant.rows[0] as { status: string }).status).toBe("active");

    const sub = await ctx.owner.query(
      `SELECT plan_key, status, trial_end, period_end FROM subscriptions WHERE tenant_id = $1`,
      [tenantId],
    );
    const s = sub.rows[0] as {
      plan_key: string;
      status: string;
      trial_end: Date | null;
      period_end: Date | string;
    };
    expect(s.plan_key).toBe("free_web");
    expect(s.status).toBe("active"); // never trialing/past_due for free
    expect(s.trial_end).toBeNull();
    expect(String(s.period_end)).toMatch(/infinity/i);

    const run = await ctx.owner.query(`SELECT status FROM onboarding_runs WHERE tenant_id = $1`, [
      tenantId,
    ]);
    expect((run.rows[0] as { status: string }).status).toBe("in_progress");

    const mine = await tenantsForPerson(ctx.appPool, personId);
    expect(mine).toEqual([{ tenantId, role: "owner" }]);
  });

  it("re-submit by the same owner is idempotent; another person gets SLUG_TAKEN", async () => {
    const owner = await loginTelegram(ctx.appPool, freshLogin("888"));
    const first = await provisionTenant(ctx.appPool, {
      slug: "wao-club-b",
      name: "WAO Club B",
      personId: owner.personId,
    });
    const again = await provisionTenant(ctx.appPool, {
      slug: "wao-club-b",
      name: "WAO Club B",
      personId: owner.personId,
    });
    expect(again).toBe(first);

    const intruder = await loginTelegram(ctx.appPool, freshLogin("999"));
    await expect(
      provisionTenant(ctx.appPool, {
        slug: "wao-club-b",
        name: "Steal It",
        personId: intruder.personId,
      }),
    ).rejects.toThrow(SlugTakenError);
  });

  it("concurrent same-owner submissions both get the SAME tenant (no false 409)", async () => {
    const owner = await loginTelegram(ctx.appPool, freshLogin("1313"));
    const [a, b] = await Promise.all([
      provisionTenant(ctx.appPool, {
        slug: "wao-club-race",
        name: "Race",
        personId: owner.personId,
      }),
      provisionTenant(ctx.appPool, {
        slug: "wao-club-race",
        name: "Race",
        personId: owner.personId,
      }),
    ]);
    expect(a).toBe(b);
    const { rows } = await ctx.owner.query(
      `SELECT count(*)::int AS n FROM tenants WHERE slug = 'wao-club-race'`,
    );
    expect((rows[0] as { n: number }).n).toBe(1);
  });

  it("a mere MEMBER re-submitting the slug gets SLUG_TAKEN (not the tenant id)", async () => {
    const owner = await loginTelegram(ctx.appPool, freshLogin("1111"));
    const tenantId = await provisionTenant(ctx.appPool, {
      slug: "wao-club-c",
      name: "WAO Club C",
      personId: owner.personId,
    });
    const member = await loginTelegram(ctx.appPool, freshLogin("1212"));
    await ctx.owner.query(
      `INSERT INTO memberships (tenant_id, person_id, status) VALUES ($1, $2, 'active')`,
      [tenantId, member.personId],
    );
    await expect(
      provisionTenant(ctx.appPool, {
        slug: "wao-club-c",
        name: "WAO Club C",
        personId: member.personId,
      }),
    ).rejects.toThrow(SlugTakenError);
  });

  it("invalid slug is rejected (routing-grade input only)", async () => {
    const { personId } = await loginTelegram(ctx.appPool, freshLogin("1010"));
    await expect(
      provisionTenant(ctx.appPool, { slug: "Bad Slug!", name: "X", personId }),
    ).rejects.toThrow();
  });
});

describe("onboardingSnapshot (tenant scoping — DD-31 SI-3)", () => {
  it("returns the caller's OWN run even under a superuser connection that bypasses RLS", async () => {
    await ctx.owner.query(
      `INSERT INTO onboarding_runs (tenant_id, status) VALUES ($1, 'completed')`,
      [ctx.tenantA],
    );
    // inserted AFTER A's row: the globally-latest row belongs to tenant B.
    await ctx.owner.query(
      `INSERT INTO onboarding_runs (tenant_id, status) VALUES ($1, 'abandoned')`,
      [ctx.tenantB],
    );

    const viaApp = await onboardingSnapshot(ctx.appDb.db, ctx.tenantA);
    expect(viaApp?.runStatus).toBe("completed");

    // superuser bypasses RLS entirely — only the explicit tenant_id predicate
    // stops this from falling back to the globally-latest run (tenant B's).
    const viaSuperuser = await onboardingSnapshot(ctx.superuserDb.db, ctx.tenantA);
    expect(viaSuperuser?.runStatus).toBe("completed");
  });

  it("keeps only the MOST RECENT row per step when a retry leaves duplicates", async () => {
    const run = await ctx.owner.query(
      `INSERT INTO onboarding_runs (tenant_id, status) VALUES ($1, 'in_progress') RETURNING id`,
      [ctx.tenantA],
    );
    const runId = (run.rows[0] as { id: string }).id;

    await ctx.owner.query(
      `INSERT INTO onboarding_steps (run_id, step, status, idempotency_key, created_at)
       VALUES ($1, 'bank_connect', 'error', 'attempt-1', now() - interval '1 hour')`,
      [runId],
    );
    await ctx.owner.query(
      `INSERT INTO onboarding_steps (run_id, step, status, idempotency_key, created_at)
       VALUES ($1, 'bank_connect', 'verified', 'attempt-2', now())`,
      [runId],
    );

    const snapshot = await onboardingSnapshot(ctx.appDb.db, ctx.tenantA);
    const bankStep = snapshot?.steps.find((s) => s.step === "bank_connect");
    expect(bankStep?.status).toBe("verified");
    expect(snapshot?.steps.filter((s) => s.step === "bank_connect")).toHaveLength(1);
  });

  it("breaks an EXACT created_at tie deterministically via seq, not arbitrary Postgres tie-resolution (codex round-11)", async () => {
    const run = await ctx.owner.query(
      `INSERT INTO onboarding_runs (tenant_id, status) VALUES ($1, 'in_progress') RETURNING id`,
      [ctx.tenantA],
    );
    const runId = (run.rows[0] as { id: string }).id;

    // Force a genuine created_at TIE (transaction-stable now()) between an
    // older-intent 'error' row and a newer-intent 'verified' row for the
    // SAME step — exactly the scenario migration-0013 backfill / same-
    // transaction retries can produce. seq still orders them correctly.
    await ctx.owner.query(
      `WITH tied_now AS (SELECT now() AS t)
       INSERT INTO onboarding_steps (run_id, step, status, idempotency_key, created_at)
       SELECT $1, 'tg_bind', 'error', 'attempt-1', t FROM tied_now`,
      [runId],
    );
    await ctx.owner.query(
      `INSERT INTO onboarding_steps (run_id, step, status, idempotency_key, created_at)
       SELECT $1, 'tg_bind', 'verified', 'attempt-2', created_at
       FROM onboarding_steps WHERE run_id = $1 AND step = 'tg_bind'`,
      [runId],
    );

    const tie = await ctx.owner.query(
      `SELECT count(DISTINCT created_at)::int AS distinct_timestamps
       FROM onboarding_steps WHERE run_id = $1 AND step = 'tg_bind'`,
      [runId],
    );
    expect((tie.rows[0] as { distinct_timestamps: number }).distinct_timestamps).toBe(1); // confirms the tie is real

    const snapshot = await onboardingSnapshot(ctx.appDb.db, ctx.tenantA);
    const tgStep = snapshot?.steps.find((s) => s.step === "tg_bind");
    expect(tgStep?.status).toBe("verified"); // the row inserted SECOND (higher seq), despite the created_at tie
  });

  it("app role can insert a step row relying on seq's default nextval (codex round-12)", async () => {
    // MUST run as the REAL `app` role (ctx.appDb, inside withTenant so RLS's
    // WITH CHECK passes) — a bigserial's implicit sequence is a SEPARATE
    // grantable object from its table, and every other test in this file
    // inserts via the owner connection, which would never catch a missing
    // sequence grant (app has table INSERT via 0009, but not sequence USAGE
    // unless migration 0013 grants it explicitly).
    const run = await ctx.owner.query(
      `INSERT INTO onboarding_runs (tenant_id, status) VALUES ($1, 'in_progress') RETURNING id`,
      [ctx.tenantA],
    );
    const runId = (run.rows[0] as { id: string }).id;

    const { withTenant } = await import("./tenant.js");
    const { sql } = await import("drizzle-orm");
    await expect(
      withTenant(ctx.appDb.db, ctx.tenantA, (tx) =>
        tx.execute(sql`
          INSERT INTO onboarding_steps (run_id, step, status, idempotency_key)
          VALUES (${runId}, 'club_config', 'verified', 'app-write-1')
        `),
      ),
    ).resolves.not.toThrow();
  });
});

describe("SECURITY DEFINER search_path hardening (codex round-15)", () => {
  // A pg.Pool does not guarantee the same physical connection across calls,
  // but CREATE TEMP TABLE is SESSION-scoped — this probe MUST hold one
  // checked-out client for setup + the function call, or the temp table
  // would silently not even be visible to the second query regardless of
  // whether the vulnerability exists.
  it("auth_resolve_web_session ignores an attacker's same-named temp table (pg_temp shadow attempt)", async () => {
    const { accountId } = await loginTelegram(ctx.appPool, freshLogin("shadow-victim"));
    // A SECOND real account — the shadow row points here, so if the function
    // is fooled, the join still succeeds (proving cross-account confusion)
    // instead of just failing to join a fabricated id.
    const attacker = await loginTelegram(ctx.appPool, freshLogin("shadow-attacker"));
    const tokenHash = sha(randomBytes(32).toString("hex"));
    await createWebSession(ctx.appPool, {
      accountId,
      tokenHash,
      csrfSecret: "real-csrf",
      ttlSeconds: 900,
    });

    const client = await ctx.appPool.connect();
    try {
      // Attacker (same `app` role — no elevated privilege needed, TEMP is
      // PUBLIC-grantable by default) shadows the real table with a temp one
      // matching its columns, seeded with attacker-controlled rows.
      await client.query(`
        CREATE TEMP TABLE web_sessions (
          id uuid, account_id uuid, token_hash text, csrf_secret text,
          expires_at timestamptz, rotated_from uuid, revoked_at timestamptz,
          created_at timestamptz
        )
      `);
      await client.query(
        `INSERT INTO web_sessions (id, account_id, token_hash, csrf_secret, expires_at, created_at)
         VALUES (gen_random_uuid(), $2, $1, 'attacker-csrf', now() + interval '1 day', now())`,
        [tokenHash, attacker.accountId],
      );

      const { rows } = await client.query(
        `SELECT session_id, account_id, csrf_secret FROM auth_resolve_web_session($1)`,
        [tokenHash],
      );

      // If vulnerable: rows[0].account_id would be the ATTACKER's account
      // and csrf_secret "attacker-csrf" instead of the REAL session's values.
      expect(rows).toHaveLength(1);
      expect((rows[0] as { account_id: string }).account_id).toBe(accountId);
      expect((rows[0] as { csrf_secret: string }).csrf_secret).toBe("real-csrf");
    } finally {
      await client.query(`DROP TABLE IF EXISTS web_sessions`); // pg_temp cleanup
      client.release();
    }
  });
});

/**
 * D0a — account-session epoch core (DD-80 v1.88, migration 0015).
 * G3 §8 acceptance matrix: internal helper/grant (D0-1/2), rotated-chain
 * regression (D0-6), audit atomicity (D0-8), schema mirror drift closure
 * (D0-9), the revoke-all index (D0-13), epoch backfill/catalog (D0-14),
 * resolve equality fail-closed (D0-15), the concurrency barriers (D0-7/16-19),
 * atomic failure/overflow (D0-20), exact materialization (D0-21) and forward
 * rollback safety (D0-22). D0-10 (lock order) is proven by the documented
 * final-state assertions in every barrier below (a session-first
 * implementation would produce a different, wrong outcome for at least one
 * ordering of each race) plus `waitUntilBlockedByHolder` pinning the waiter's
 * block to the EXACT expected holder connection via `pg_blocking_pids()`
 * (codex round-01 [P2] — a bare `wait_event_type` check would also pass for
 * a waiter blocked on something unrelated/incidental). D0-3/4/5/11/12 are D0b
 * (web boundary) or already-covered 0012-era regression and are NOT
 * re-tested here. The audit-shape UNKNOWN/NULL CHECK gap is a codex round-01
 * finding, fixed in the migration and covered by a dedicated regression test
 * below. `auth_revoke_all_web_sessions`'s own re-validation went through TWO
 * revisions: round-01 made it require `revoked_at IS NULL` on the re-read
 * (closing a real race with the pre-existing single-session revoke), but
 * round-06 proved that predicate itself wrong — G3-I1 makes epoch equality
 * the SOLE validity authority, and requiring `revoked_at IS NULL` also wrongly
 * aborted the "rotate wins the account lock first" row of G3 §5. The final
 * re-validation checks epoch equality only; both races are covered below.
 */
describe("auth_revoke_account_sessions (internal helper, D0-1/D0-2)", () => {
  it("revokes exactly the target account's live sessions, leaves another account untouched (D0-1)", async () => {
    const a = await loginTelegram(ctx.appPool, freshLogin("revoke-a"));
    const b = await loginTelegram(ctx.appPool, freshLogin("revoke-b"));
    for (let i = 0; i < 3; i++) {
      await createWebSession(ctx.appPool, {
        accountId: a.accountId,
        tokenHash: sha(`revoke-a-session-${i}`),
        csrfSecret: `csrf-${i}`,
        ttlSeconds: 900,
      });
    }
    await createWebSession(ctx.appPool, {
      accountId: b.accountId,
      tokenHash: sha("revoke-b-session"),
      csrfSecret: "csrf-b",
      ttlSeconds: 900,
    });

    const { rows } = await ctx.owner.query(`SELECT auth_revoke_account_sessions($1) AS count`, [
      a.accountId,
    ]);
    expect((rows[0] as { count: number }).count).toBe(3);

    const aRevoked = await ctx.owner.query(
      `SELECT count(*)::int AS n FROM web_sessions WHERE account_id = $1 AND revoked_at IS NOT NULL`,
      [a.accountId],
    );
    expect((aRevoked.rows[0] as { n: number }).n).toBe(3);

    const bLive = await ctx.owner.query(
      `SELECT count(*)::int AS n FROM web_sessions WHERE account_id = $1 AND revoked_at IS NULL`,
      [b.accountId],
    );
    expect((bLive.rows[0] as { n: number }).n).toBe(1);
  });

  it("app/readonly roles have NO grant on the internal helper (D0-2 / G3-A11)", async () => {
    const { accountId } = await loginTelegram(ctx.appPool, freshLogin("revoke-denied"));
    await expect(
      ctx.appPool.query(`SELECT auth_revoke_account_sessions($1)`, [accountId]),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      ctx.readonlyPool.query(`SELECT auth_revoke_account_sessions($1)`, [accountId]),
    ).rejects.toThrow(/permission denied/i);
  });

  it("app role has NO grant on auth_audit_events directly (G3-I8)", async () => {
    await expect(ctx.appPool.query(`SELECT * FROM auth_audit_events`)).rejects.toThrow(
      /permission denied/i,
    );
  });
});

describe("rotated chain then logout-all (D0-6)", () => {
  it("both the rotated-away token and the current token fail to resolve after logout-all", async () => {
    const { accountId } = await loginTelegram(ctx.appPool, freshLogin("chain"));
    const oldHash = sha(randomBytes(32).toString("hex"));
    await createWebSession(ctx.appPool, {
      accountId,
      tokenHash: oldHash,
      csrfSecret: "old",
      ttlSeconds: 900,
    });
    const newHash = sha(randomBytes(32).toString("hex"));
    await rotateWebSession(ctx.appPool, {
      oldTokenHash: oldHash,
      newTokenHash: newHash,
      newCsrfSecret: "new",
      ttlSeconds: 900,
      accountId,
    });

    expect(await revokeAllWebSessions(ctx.appPool, newHash)).toBe(1);
    expect(await resolveWebSession(ctx.appPool, oldHash)).toBeNull();
    expect(await resolveWebSession(ctx.appPool, newHash)).toBeNull();
  });
});

describe("logout_all audit is atomic and redacted (D0-8)", () => {
  it("records exact account, before/after epoch and count in the same transaction; no raw token", async () => {
    const { accountId } = await loginTelegram(ctx.appPool, freshLogin("audit"));
    const tokenHash = sha(randomBytes(32).toString("hex"));
    const sessionId = await createWebSession(ctx.appPool, {
      accountId,
      tokenHash,
      csrfSecret: "c",
      ttlSeconds: 900,
    });

    const count = await revokeAllWebSessions(ctx.appPool, tokenHash);
    expect(count).toBe(1);

    const { rows } = await ctx.owner.query(
      `SELECT event_type, account_id, actor_class, outcome_class, sessions_revoked, request_ref,
              session_epoch_before::int AS before, session_epoch_after::int AS after
       FROM auth_audit_events WHERE account_id = $1 AND event_type = 'logout_all'`,
      [accountId],
    );
    expect(rows).toHaveLength(1);
    const row = rows[0] as {
      account_id: string;
      actor_class: string;
      outcome_class: string;
      sessions_revoked: number;
      request_ref: string;
      before: number;
      after: number;
    };
    expect(row.account_id).toBe(accountId);
    expect(row.actor_class).toBe("account_self");
    expect(row.outcome_class).toBe("success");
    expect(row.sessions_revoked).toBe(1);
    expect(row.request_ref).toBe(sessionId); // opaque current-session id, not the raw token
    expect(row.before).toBe(0);
    expect(row.after).toBe(1);

    const cols = await ctx.owner.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'auth_audit_events'`,
    );
    const names = (cols.rows as { column_name: string }[]).map((r) => r.column_name);
    expect(names.some((n) => /token|csrf|secret/i.test(n))).toBe(false);
  });

  it("a denied (already-revoked) replay writes zero mutation and zero new audit rows", async () => {
    const { accountId } = await loginTelegram(ctx.appPool, freshLogin("audit-denied"));
    const tokenHash = sha(randomBytes(32).toString("hex"));
    await createWebSession(ctx.appPool, {
      accountId,
      tokenHash,
      csrfSecret: "c",
      ttlSeconds: 900,
    });
    expect(await revokeAllWebSessions(ctx.appPool, tokenHash)).toBe(1);

    const before = await ctx.owner.query(
      `SELECT count(*)::int AS n FROM auth_audit_events WHERE account_id = $1`,
      [accountId],
    );
    expect(await revokeAllWebSessions(ctx.appPool, tokenHash)).toBeNull();
    const after = await ctx.owner.query(
      `SELECT count(*)::int AS n FROM auth_audit_events WHERE account_id = $1`,
      [accountId],
    );
    expect((after.rows[0] as { n: number }).n).toBe((before.rows[0] as { n: number }).n);
  });

  it("an invalid/unknown token is denied with zero mutation", async () => {
    expect(await revokeAllWebSessions(ctx.appPool, sha("never-issued"))).toBeNull();
  });
});

describe("schema mirror closes the 0012 drift (D0-9)", () => {
  it("auth_login_nonces / auth_login_state / rate_limit_hits columns match the Drizzle mirror", async () => {
    const expected: Record<string, string[]> = {
      auth_login_nonces: ["login_hash", "seen_at"],
      auth_login_state: ["state_hash", "expires_at", "consumed_at", "created_at"],
      rate_limit_hits: ["bucket", "at"],
    };
    for (const [table, cols] of Object.entries(expected)) {
      const { rows } = await ctx.owner.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
        [table],
      );
      const names = (rows as { column_name: string }[]).map((r) => r.column_name).sort();
      expect(names).toEqual([...cols].sort());
    }
  });
});

describe("revoke-all partial index (D0-13)", () => {
  it("idx_web_sessions_account_active exists as a partial index on live rows", async () => {
    const { rows } = await ctx.owner.query(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'web_sessions' AND indexname = 'idx_web_sessions_account_active'`,
    );
    expect(rows).toHaveLength(1);
    const indexdef = (rows[0] as { indexdef: string }).indexdef;
    expect(indexdef).toMatch(/\(account_id\)/);
    expect(indexdef).toMatch(/WHERE \(revoked_at IS NULL\)/);
  });
});

describe("auth_audit_events retention index (codex round-03)", () => {
  it("auth_audit_events_created_at_idx exists on created_at", async () => {
    const { rows } = await ctx.owner.query(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'auth_audit_events' AND indexname = 'auth_audit_events_created_at_idx'`,
    );
    expect(rows).toHaveLength(1);
    expect((rows[0] as { indexdef: string }).indexdef).toMatch(/\(created_at\)/);
  });
});

describe("epoch columns: defaults, CHECKs, backfill (D0-14)", () => {
  it("accounts.session_epoch and web_sessions.minted_epoch default to 0 and are non-negative", async () => {
    const { accountId } = await loginTelegram(ctx.appPool, freshLogin("epoch-default"));
    const tokenHash = sha(randomBytes(32).toString("hex"));
    await createWebSession(ctx.appPool, {
      accountId,
      tokenHash,
      csrfSecret: "c",
      ttlSeconds: 900,
    });

    const acct = await ctx.owner.query(
      `SELECT session_epoch::int AS e FROM accounts WHERE id = $1`,
      [accountId],
    );
    expect((acct.rows[0] as { e: number }).e).toBe(0);
    const sess = await ctx.owner.query(
      `SELECT minted_epoch::int AS e FROM web_sessions WHERE token_hash = $1`,
      [tokenHash],
    );
    expect((sess.rows[0] as { e: number }).e).toBe(0);

    const checks = await ctx.owner.query(
      `SELECT conname FROM pg_constraint WHERE contype = 'c'
       AND conname IN ('accounts_session_epoch_chk','web_sessions_minted_epoch_chk')`,
    );
    expect((checks.rows as { conname: string }[]).map((r) => r.conname).sort()).toEqual(
      ["accounts_session_epoch_chk", "web_sessions_minted_epoch_chk"].sort(),
    );

    await expect(
      ctx.owner.query(`UPDATE accounts SET session_epoch = -1 WHERE id = $1`, [accountId]),
    ).rejects.toThrow(/accounts_session_epoch_chk/);

    expect(await resolveWebSession(ctx.appPool, tokenHash)).not.toBeNull();
  });
});

describe("resolve equality fail-closed (D0-15)", () => {
  it("only exact minted_epoch = session_epoch resolves; lower/higher fixtures do not", async () => {
    const { accountId } = await loginTelegram(ctx.appPool, freshLogin("epoch-equal"));
    const tokenHash = sha(randomBytes(32).toString("hex"));
    await createWebSession(ctx.appPool, {
      accountId,
      tokenHash,
      csrfSecret: "c",
      ttlSeconds: 900,
    });
    expect(await resolveWebSession(ctx.appPool, tokenHash)).not.toBeNull();

    await ctx.owner.query(`UPDATE web_sessions SET minted_epoch = 5 WHERE token_hash = $1`, [
      tokenHash,
    ]);
    expect(await resolveWebSession(ctx.appPool, tokenHash)).toBeNull();

    await ctx.owner.query(`UPDATE web_sessions SET minted_epoch = 0 WHERE token_hash = $1`, [
      tokenHash,
    ]);
    await ctx.owner.query(`UPDATE accounts SET session_epoch = 3 WHERE id = $1`, [accountId]);
    expect(await resolveWebSession(ctx.appPool, tokenHash)).toBeNull();

    await ctx.owner.query(`UPDATE web_sessions SET minted_epoch = 3 WHERE token_hash = $1`, [
      tokenHash,
    ]);
    expect(await resolveWebSession(ctx.appPool, tokenHash)).not.toBeNull();
  });
});

describe("create(X) x logout-all(X) barrier (D0-16)", () => {
  it("create-first: the newly created row is revoked once logout-all commits", async () => {
    const { accountId } = await loginTelegram(ctx.appPool, freshLogin("barrier-16a"));
    const existingHash = sha(randomBytes(32).toString("hex"));
    await createWebSession(ctx.appPool, {
      accountId,
      tokenHash: existingHash,
      csrfSecret: "existing",
      ttlSeconds: 900,
    });

    const connA = await ctx.appPool.connect();
    const connB = await ctx.appPool.connect();
    // Declared here (not `const` inside try) so `finally` can await/settle
    // whatever query connB has in flight before releasing it — otherwise a
    // throw between issuing this query and awaiting it (e.g. the barrier
    // timing out, or an assertion on its result failing) would release a
    // pooled client with a query still in flight, letting an unrelated later
    // test inherit it mid-query (codex round-05 [P2]).
    let pendingB: Promise<pg.QueryResult> | undefined;
    try {
      const newHash = sha(randomBytes(32).toString("hex"));
      await connA.query("BEGIN");
      await connA.query(
        `SELECT auth_create_web_session($1, $2, $3, make_interval(secs => $4)) AS id`,
        [accountId, newHash, "new-csrf", 900],
      );

      const pidA = await backendPid(connA);
      const pidB = await backendPid(connB);
      pendingB = connB.query(`SELECT auth_revoke_all_web_sessions($1) AS count`, [existingHash]);
      await waitUntilBlockedByHolder(ctx.owner, pidA, pidB);

      await connA.query("COMMIT");
      const { rows } = await pendingB;
      expect((rows[0] as { count: number }).count).toBeGreaterThanOrEqual(1);

      expect(await resolveWebSession(ctx.appPool, newHash)).toBeNull();
      expect(await resolveWebSession(ctx.appPool, existingHash)).toBeNull();
    } finally {
      // If an assertion/timeout threw before COMMIT, connA is still inside
      // (possibly aborted) transaction state; a plain release() would hand
      // that state back to the pool for an unrelated later test to inherit
      // (codex round-02 [P2]). ROLLBACK on an already-committed connection is
      // a harmless no-op warning, so this is safe on every exit path.
      await connA.query("ROLLBACK").catch(() => {});
      connA.release();
      // Settle connB's in-flight query (if the barrier/assertions above threw
      // before it was awaited) before releasing it — otherwise the pool can
      // hand an unrelated later test a client with a query still running
      // against it (codex round-05 [P2]).
      if (pendingB) await pendingB.catch(() => {});
      connB.release();
    }
  });

  it("logout-first: a session created AFTER logout-all commits stamps the new epoch and survives", async () => {
    const { accountId } = await loginTelegram(ctx.appPool, freshLogin("barrier-16b"));
    const existingHash = sha(randomBytes(32).toString("hex"));
    await createWebSession(ctx.appPool, {
      accountId,
      tokenHash: existingHash,
      csrfSecret: "existing",
      ttlSeconds: 900,
    });

    const connA = await ctx.appPool.connect();
    const connB = await ctx.appPool.connect();
    // Declared here (not `const` inside try) so `finally` can await/settle
    // whatever query connB has in flight before releasing it — otherwise a
    // throw between issuing this query and awaiting it (e.g. the barrier
    // timing out, or an assertion on its result failing) would release a
    // pooled client with a query still in flight, letting an unrelated later
    // test inherit it mid-query (codex round-05 [P2]).
    let pendingB: Promise<pg.QueryResult> | undefined;
    try {
      await connA.query("BEGIN");
      await connA.query(`SELECT auth_revoke_all_web_sessions($1) AS count`, [existingHash]);

      const newHash = sha(randomBytes(32).toString("hex"));
      const pidA = await backendPid(connA);
      const pidB = await backendPid(connB);
      pendingB = connB.query(
        `SELECT auth_create_web_session($1, $2, $3, make_interval(secs => $4)) AS id`,
        [accountId, newHash, "new-csrf", 900],
      );
      await waitUntilBlockedByHolder(ctx.owner, pidA, pidB);

      await connA.query("COMMIT");
      await pendingB;

      expect(await resolveWebSession(ctx.appPool, newHash)).not.toBeNull();
      expect(await resolveWebSession(ctx.appPool, existingHash)).toBeNull();
    } finally {
      // If an assertion/timeout threw before COMMIT, connA is still inside
      // (possibly aborted) transaction state; a plain release() would hand
      // that state back to the pool for an unrelated later test to inherit
      // (codex round-02 [P2]). ROLLBACK on an already-committed connection is
      // a harmless no-op warning, so this is safe on every exit path.
      await connA.query("ROLLBACK").catch(() => {});
      connA.release();
      // Settle connB's in-flight query (if the barrier/assertions above threw
      // before it was awaited) before releasing it — otherwise the pool can
      // hand an unrelated later test a client with a query still running
      // against it (codex round-05 [P2]).
      if (pendingB) await pendingB.catch(() => {});
      connB.release();
    }
  });
});

describe("rotate(X->X) x logout-all(X) barrier (D0-7)", () => {
  it("rotate-first: the replacement session is minted then revoked by logout-all", async () => {
    const { accountId } = await loginTelegram(ctx.appPool, freshLogin("barrier-7a"));
    const oldHash = sha(randomBytes(32).toString("hex"));
    const otherHash = sha(randomBytes(32).toString("hex"));
    await createWebSession(ctx.appPool, {
      accountId,
      tokenHash: oldHash,
      csrfSecret: "old",
      ttlSeconds: 900,
    });
    await createWebSession(ctx.appPool, {
      accountId,
      tokenHash: otherHash,
      csrfSecret: "other",
      ttlSeconds: 900,
    });

    const connA = await ctx.appPool.connect();
    const connB = await ctx.appPool.connect();
    // Declared here (not `const` inside try) so `finally` can await/settle
    // whatever query connB has in flight before releasing it — otherwise a
    // throw between issuing this query and awaiting it (e.g. the barrier
    // timing out, or an assertion on its result failing) would release a
    // pooled client with a query still in flight, letting an unrelated later
    // test inherit it mid-query (codex round-05 [P2]).
    let pendingB: Promise<pg.QueryResult> | undefined;
    try {
      const newHash = sha(randomBytes(32).toString("hex"));
      await connA.query("BEGIN");
      await connA.query(
        `SELECT auth_rotate_web_session($1, $2, $3, make_interval(secs => $4), $5) AS id`,
        [oldHash, newHash, "new-csrf", 900, accountId],
      );

      const pidA = await backendPid(connA);
      const pidB = await backendPid(connB);
      pendingB = connB.query(`SELECT auth_revoke_all_web_sessions($1) AS count`, [otherHash]);
      await waitUntilBlockedByHolder(ctx.owner, pidA, pidB);

      await connA.query("COMMIT");
      await pendingB;

      expect(await resolveWebSession(ctx.appPool, newHash)).toBeNull();
      expect(await resolveWebSession(ctx.appPool, oldHash)).toBeNull();
    } finally {
      // If an assertion/timeout threw before COMMIT, connA is still inside
      // (possibly aborted) transaction state; a plain release() would hand
      // that state back to the pool for an unrelated later test to inherit
      // (codex round-02 [P2]). ROLLBACK on an already-committed connection is
      // a harmless no-op warning, so this is safe on every exit path.
      await connA.query("ROLLBACK").catch(() => {});
      connA.release();
      // Settle connB's in-flight query (if the barrier/assertions above threw
      // before it was awaited) before releasing it — otherwise the pool can
      // hand an unrelated later test a client with a query still running
      // against it (codex round-05 [P2]).
      if (pendingB) await pendingB.catch(() => {});
      connB.release();
    }
  });

  it("logout-first: the stale old token fails revalidation and rotate mints nothing", async () => {
    const { accountId } = await loginTelegram(ctx.appPool, freshLogin("barrier-7b"));
    const oldHash = sha(randomBytes(32).toString("hex"));
    const otherHash = sha(randomBytes(32).toString("hex"));
    await createWebSession(ctx.appPool, {
      accountId,
      tokenHash: oldHash,
      csrfSecret: "old",
      ttlSeconds: 900,
    });
    await createWebSession(ctx.appPool, {
      accountId,
      tokenHash: otherHash,
      csrfSecret: "other",
      ttlSeconds: 900,
    });

    const connA = await ctx.appPool.connect();
    const connB = await ctx.appPool.connect();
    // Declared here (not `const` inside try) so `finally` can await/settle
    // whatever query connB has in flight before releasing it — otherwise a
    // throw between issuing this query and awaiting it (e.g. the barrier
    // timing out, or an assertion on its result failing) would release a
    // pooled client with a query still in flight, letting an unrelated later
    // test inherit it mid-query (codex round-05 [P2]).
    let pendingB: Promise<pg.QueryResult> | undefined;
    try {
      await connA.query("BEGIN");
      await connA.query(`SELECT auth_revoke_all_web_sessions($1) AS count`, [otherHash]);

      const newHash = sha(randomBytes(32).toString("hex"));
      const pidA = await backendPid(connA);
      const pidB = await backendPid(connB);
      pendingB = connB.query(
        `SELECT auth_rotate_web_session($1, $2, $3, make_interval(secs => $4), $5) AS id`,
        [oldHash, newHash, "new-csrf", 900, accountId],
      );
      await waitUntilBlockedByHolder(ctx.owner, pidA, pidB);

      await connA.query("COMMIT");
      const { rows } = await pendingB;
      expect((rows[0] as { id: string | null }).id).toBeNull();
      expect(await resolveWebSession(ctx.appPool, newHash)).toBeNull();
    } finally {
      // If an assertion/timeout threw before COMMIT, connA is still inside
      // (possibly aborted) transaction state; a plain release() would hand
      // that state back to the pool for an unrelated later test to inherit
      // (codex round-02 [P2]). ROLLBACK on an already-committed connection is
      // a harmless no-op warning, so this is safe on every exit path.
      await connA.query("ROLLBACK").catch(() => {});
      connA.release();
      // Settle connB's in-flight query (if the barrier/assertions above threw
      // before it was awaited) before releasing it — otherwise the pool can
      // hand an unrelated later test a client with a query still running
      // against it (codex round-05 [P2]).
      if (pendingB) await pendingB.catch(() => {});
      connB.release();
    }
  });
});

describe("rotate(A->B) x logout-all(A) barrier (D0-17)", () => {
  it("rotate-first: B's session commits; logout-all(A) still succeeds on A's remaining state but never touches B's session", async () => {
    const a = await loginTelegram(ctx.appPool, freshLogin("barrier-17a-A"));
    const b = await loginTelegram(ctx.appPool, freshLogin("barrier-17a-B"));
    const tA = sha(randomBytes(32).toString("hex"));
    await createWebSession(ctx.appPool, {
      accountId: a.accountId,
      tokenHash: tA,
      csrfSecret: "a",
      ttlSeconds: 900,
    });

    const connA = await ctx.appPool.connect();
    const connB = await ctx.appPool.connect();
    // Declared here (not `const` inside try) so `finally` can await/settle
    // whatever query connB has in flight before releasing it — otherwise a
    // throw between issuing this query and awaiting it (e.g. the barrier
    // timing out, or an assertion on its result failing) would release a
    // pooled client with a query still in flight, letting an unrelated later
    // test inherit it mid-query (codex round-05 [P2]).
    let pendingB: Promise<pg.QueryResult> | undefined;
    try {
      const tNew = sha(randomBytes(32).toString("hex"));
      await connA.query("BEGIN");
      await connA.query(
        `SELECT auth_rotate_web_session($1, $2, $3, make_interval(secs => $4), $5) AS id`,
        [tA, tNew, "new-csrf", 900, b.accountId],
      );

      const pidA = await backendPid(connA);
      const pidB = await backendPid(connB);
      pendingB = connB.query(`SELECT auth_revoke_all_web_sessions($1) AS count`, [tA]);
      await waitUntilBlockedByHolder(ctx.owner, pidA, pidB);

      await connA.query("COMMIT");
      const { rows } = await pendingB;
      // logout-all(A) is called with tA, which the concurrent rotate has
      // already carried to account B by the time this re-check runs. Per
      // G3 §5 "rotate locks {A,B} first" — A's epoch never moved (rotate
      // doesn't bump), so the account-A-wide intent still holds: it must
      // succeed (not null), even though tA itself is already gone. A had
      // only that one session, so nothing additional is left to flip.
      expect((rows[0] as { count: number }).count).toBe(0);

      const epochA = await ctx.owner.query(
        `SELECT session_epoch::int AS e FROM accounts WHERE id = $1`,
        [a.accountId],
      );
      expect((epochA.rows[0] as { e: number }).e).toBe(1);

      // B's independently authenticated session must never be touched by a
      // logout-all(A) call — different account entirely.
      expect(await resolveWebSession(ctx.appPool, tNew)).not.toBeNull();
    } finally {
      // If an assertion/timeout threw before COMMIT, connA is still inside
      // (possibly aborted) transaction state; a plain release() would hand
      // that state back to the pool for an unrelated later test to inherit
      // (codex round-02 [P2]). ROLLBACK on an already-committed connection is
      // a harmless no-op warning, so this is safe on every exit path.
      await connA.query("ROLLBACK").catch(() => {});
      connA.release();
      // Settle connB's in-flight query (if the barrier/assertions above threw
      // before it was awaited) before releasing it — otherwise the pool can
      // hand an unrelated later test a client with a query still running
      // against it (codex round-05 [P2]).
      if (pendingB) await pendingB.catch(() => {});
      connB.release();
    }
  });

  it("logout-first: A's old token fails locked revalidation; rotate mints zero B session", async () => {
    const a = await loginTelegram(ctx.appPool, freshLogin("barrier-17b-A"));
    const b = await loginTelegram(ctx.appPool, freshLogin("barrier-17b-B"));
    const tA = sha(randomBytes(32).toString("hex"));
    await createWebSession(ctx.appPool, {
      accountId: a.accountId,
      tokenHash: tA,
      csrfSecret: "a",
      ttlSeconds: 900,
    });

    const connA = await ctx.appPool.connect();
    const connB = await ctx.appPool.connect();
    // Declared here (not `const` inside try) so `finally` can await/settle
    // whatever query connB has in flight before releasing it — otherwise a
    // throw between issuing this query and awaiting it (e.g. the barrier
    // timing out, or an assertion on its result failing) would release a
    // pooled client with a query still in flight, letting an unrelated later
    // test inherit it mid-query (codex round-05 [P2]).
    let pendingB: Promise<pg.QueryResult> | undefined;
    try {
      await connA.query("BEGIN");
      await connA.query(`SELECT auth_revoke_all_web_sessions($1) AS count`, [tA]);

      const tNew = sha(randomBytes(32).toString("hex"));
      const pidA = await backendPid(connA);
      const pidB = await backendPid(connB);
      pendingB = connB.query(
        `SELECT auth_rotate_web_session($1, $2, $3, make_interval(secs => $4), $5) AS id`,
        [tA, tNew, "new-csrf", 900, b.accountId],
      );
      await waitUntilBlockedByHolder(ctx.owner, pidA, pidB);

      await connA.query("COMMIT");
      const { rows } = await pendingB;
      expect((rows[0] as { id: string | null }).id).toBeNull();
      expect(await resolveWebSession(ctx.appPool, tNew)).toBeNull();
    } finally {
      // If an assertion/timeout threw before COMMIT, connA is still inside
      // (possibly aborted) transaction state; a plain release() would hand
      // that state back to the pool for an unrelated later test to inherit
      // (codex round-02 [P2]). ROLLBACK on an already-committed connection is
      // a harmless no-op warning, so this is safe on every exit path.
      await connA.query("ROLLBACK").catch(() => {});
      connA.release();
      // Settle connB's in-flight query (if the barrier/assertions above threw
      // before it was awaited) before releasing it — otherwise the pool can
      // hand an unrelated later test a client with a query still running
      // against it (codex round-05 [P2]).
      if (pendingB) await pendingB.catch(() => {});
      connB.release();
    }
  });
});

describe("rotate(A->B) x logout-all(B) barrier (D0-18)", () => {
  it("rotate-first: B's freshly minted session is then revoked by logout-all(B)", async () => {
    const a = await loginTelegram(ctx.appPool, freshLogin("barrier-18a-A"));
    const b = await loginTelegram(ctx.appPool, freshLogin("barrier-18a-B"));
    const tA = sha(randomBytes(32).toString("hex"));
    const tB0 = sha(randomBytes(32).toString("hex"));
    await createWebSession(ctx.appPool, {
      accountId: a.accountId,
      tokenHash: tA,
      csrfSecret: "a",
      ttlSeconds: 900,
    });
    await createWebSession(ctx.appPool, {
      accountId: b.accountId,
      tokenHash: tB0,
      csrfSecret: "b0",
      ttlSeconds: 900,
    });

    const connA = await ctx.appPool.connect();
    const connB = await ctx.appPool.connect();
    // Declared here (not `const` inside try) so `finally` can await/settle
    // whatever query connB has in flight before releasing it — otherwise a
    // throw between issuing this query and awaiting it (e.g. the barrier
    // timing out, or an assertion on its result failing) would release a
    // pooled client with a query still in flight, letting an unrelated later
    // test inherit it mid-query (codex round-05 [P2]).
    let pendingB: Promise<pg.QueryResult> | undefined;
    try {
      const tNew = sha(randomBytes(32).toString("hex"));
      await connA.query("BEGIN");
      await connA.query(
        `SELECT auth_rotate_web_session($1, $2, $3, make_interval(secs => $4), $5) AS id`,
        [tA, tNew, "new-csrf", 900, b.accountId],
      );

      const pidA = await backendPid(connA);
      const pidB = await backendPid(connB);
      pendingB = connB.query(`SELECT auth_revoke_all_web_sessions($1) AS count`, [tB0]);
      await waitUntilBlockedByHolder(ctx.owner, pidA, pidB);

      await connA.query("COMMIT");
      const { rows } = await pendingB;
      expect((rows[0] as { count: number }).count).toBeGreaterThanOrEqual(1);

      expect(await resolveWebSession(ctx.appPool, tNew)).toBeNull();
    } finally {
      // If an assertion/timeout threw before COMMIT, connA is still inside
      // (possibly aborted) transaction state; a plain release() would hand
      // that state back to the pool for an unrelated later test to inherit
      // (codex round-02 [P2]). ROLLBACK on an already-committed connection is
      // a harmless no-op warning, so this is safe on every exit path.
      await connA.query("ROLLBACK").catch(() => {});
      connA.release();
      // Settle connB's in-flight query (if the barrier/assertions above threw
      // before it was awaited) before releasing it — otherwise the pool can
      // hand an unrelated later test a client with a query still running
      // against it (codex round-05 [P2]).
      if (pendingB) await pendingB.catch(() => {});
      connB.release();
    }
  });

  it("logout-first: rotate stamps B's bumped epoch and the new session survives", async () => {
    const a = await loginTelegram(ctx.appPool, freshLogin("barrier-18b-A"));
    const b = await loginTelegram(ctx.appPool, freshLogin("barrier-18b-B"));
    const tA = sha(randomBytes(32).toString("hex"));
    const tB0 = sha(randomBytes(32).toString("hex"));
    await createWebSession(ctx.appPool, {
      accountId: a.accountId,
      tokenHash: tA,
      csrfSecret: "a",
      ttlSeconds: 900,
    });
    await createWebSession(ctx.appPool, {
      accountId: b.accountId,
      tokenHash: tB0,
      csrfSecret: "b0",
      ttlSeconds: 900,
    });

    const connA = await ctx.appPool.connect();
    const connB = await ctx.appPool.connect();
    // Declared here (not `const` inside try) so `finally` can await/settle
    // whatever query connB has in flight before releasing it — otherwise a
    // throw between issuing this query and awaiting it (e.g. the barrier
    // timing out, or an assertion on its result failing) would release a
    // pooled client with a query still in flight, letting an unrelated later
    // test inherit it mid-query (codex round-05 [P2]).
    let pendingB: Promise<pg.QueryResult> | undefined;
    try {
      await connA.query("BEGIN");
      await connA.query(`SELECT auth_revoke_all_web_sessions($1) AS count`, [tB0]);

      const tNew = sha(randomBytes(32).toString("hex"));
      const pidA = await backendPid(connA);
      const pidB = await backendPid(connB);
      pendingB = connB.query(
        `SELECT auth_rotate_web_session($1, $2, $3, make_interval(secs => $4), $5) AS id`,
        [tA, tNew, "new-csrf", 900, b.accountId],
      );
      await waitUntilBlockedByHolder(ctx.owner, pidA, pidB);

      await connA.query("COMMIT");
      const { rows } = await pendingB;
      expect((rows[0] as { id: string | null }).id).not.toBeNull();

      expect(await resolveWebSession(ctx.appPool, tNew)).not.toBeNull();
    } finally {
      // If an assertion/timeout threw before COMMIT, connA is still inside
      // (possibly aborted) transaction state; a plain release() would hand
      // that state back to the pool for an unrelated later test to inherit
      // (codex round-02 [P2]). ROLLBACK on an already-committed connection is
      // a harmless no-op warning, so this is safe on every exit path.
      await connA.query("ROLLBACK").catch(() => {});
      connA.release();
      // Settle connB's in-flight query (if the barrier/assertions above threw
      // before it was awaited) before releasing it — otherwise the pool can
      // hand an unrelated later test a client with a query still running
      // against it (codex round-05 [P2]).
      if (pendingB) await pendingB.catch(() => {});
      connB.release();
    }
  });
});

describe("concurrent logout-all replay (D0-19)", () => {
  it("exactly one of two simultaneous calls on the SAME token bumps/audits; the other is a no-op", async () => {
    const { accountId } = await loginTelegram(ctx.appPool, freshLogin("barrier-19"));
    const tokenHash = sha(randomBytes(32).toString("hex"));
    await createWebSession(ctx.appPool, {
      accountId,
      tokenHash,
      csrfSecret: "c",
      ttlSeconds: 900,
    });

    const connA = await ctx.appPool.connect();
    const connB = await ctx.appPool.connect();
    // Declared here (not `const` inside try) so `finally` can await/settle
    // whatever query connB has in flight before releasing it — otherwise a
    // throw between issuing this query and awaiting it (e.g. the barrier
    // timing out, or an assertion on its result failing) would release a
    // pooled client with a query still in flight, letting an unrelated later
    // test inherit it mid-query (codex round-05 [P2]).
    let pendingB: Promise<pg.QueryResult> | undefined;
    try {
      await connA.query("BEGIN");
      await connA.query(`SELECT auth_revoke_all_web_sessions($1) AS count`, [tokenHash]);

      const pidA = await backendPid(connA);
      const pidB = await backendPid(connB);
      pendingB = connB.query(`SELECT auth_revoke_all_web_sessions($1) AS count`, [tokenHash]);
      await waitUntilBlockedByHolder(ctx.owner, pidA, pidB);

      await connA.query("COMMIT");
      const { rows } = await pendingB;
      expect((rows[0] as { count: number | null }).count).toBeNull();

      const epoch = await ctx.owner.query(
        `SELECT session_epoch::int AS e FROM accounts WHERE id = $1`,
        [accountId],
      );
      expect((epoch.rows[0] as { e: number }).e).toBe(1);

      const audits = await ctx.owner.query(
        `SELECT count(*)::int AS n FROM auth_audit_events WHERE account_id = $1 AND event_type = 'logout_all'`,
        [accountId],
      );
      expect((audits.rows[0] as { n: number }).n).toBe(1);
    } finally {
      // If an assertion/timeout threw before COMMIT, connA is still inside
      // (possibly aborted) transaction state; a plain release() would hand
      // that state back to the pool for an unrelated later test to inherit
      // (codex round-02 [P2]). ROLLBACK on an already-committed connection is
      // a harmless no-op warning, so this is safe on every exit path.
      await connA.query("ROLLBACK").catch(() => {});
      connA.release();
      // Settle connB's in-flight query (if the barrier/assertions above threw
      // before it was awaited) before releasing it — otherwise the pool can
      // hand an unrelated later test a client with a query still running
      // against it (codex round-05 [P2]).
      if (pendingB) await pendingB.catch(() => {});
      connB.release();
    }
  });
});

describe("logout-all's own validity signal is epoch equality, not revoked_at (codex round-06 [P1])", () => {
  it("a sequential replay with an ALREADY-dead token still fails at step 1 (D0-4-style, unaffected)", async () => {
    const { accountId } = await loginTelegram(ctx.appPool, freshLogin("single-revoke-sequential"));
    const tokenHash = sha(randomBytes(32).toString("hex"));
    await createWebSession(ctx.appPool, {
      accountId,
      tokenHash,
      csrfSecret: "c",
      ttlSeconds: 900,
    });
    expect(await revokeWebSession(ctx.appPool, tokenHash)).toBe(true);

    // By the time logout-all's OWN step-1 read runs, tokenHash is ALREADY
    // committed-dead — indistinguishable from a plain replay, correctly NULL.
    expect(await revokeAllWebSessions(ctx.appPool, tokenHash)).toBeNull();
  });

  it("still succeeds when a CONCURRENT single-session revoke of the SAME token races it, since the account epoch never moves", async () => {
    const { accountId } = await loginTelegram(ctx.appPool, freshLogin("single-revoke-race"));
    const tokenHash = sha(randomBytes(32).toString("hex"));
    await createWebSession(ctx.appPool, {
      accountId,
      tokenHash,
      csrfSecret: "c",
      ttlSeconds: 900,
    });

    const connA = await ctx.appPool.connect();
    const connB = await ctx.appPool.connect();
    let pendingB: Promise<pg.QueryResult> | undefined;
    try {
      // connA holds the single-session revoke's row lock open (uncommitted).
      // logout-all's own step-1 read (no lock) still sees tokenHash as live
      // under MVCC; the actual contention happens later, inside the internal
      // helper's bulk UPDATE, which also targets this exact row.
      await connA.query("BEGIN");
      await connA.query(`SELECT auth_revoke_web_session($1) AS ok`, [tokenHash]);

      const pidA = await backendPid(connA);
      const pidB = await backendPid(connB);
      pendingB = connB.query(`SELECT auth_revoke_all_web_sessions($1) AS count`, [tokenHash]);
      await waitUntilBlockedByHolder(ctx.owner, pidA, pidB);

      await connA.query("COMMIT");
      const { rows } = await pendingB;
      // G3-I1: epoch equality is the sole validity authority, not
      // revoked_at. Once connA commits, the bulk UPDATE's WHERE clause
      // re-evaluates against the now-revoked row and excludes it — nothing
      // ELSE was live to flip — but the call itself must still succeed (an
      // earlier revision required revoked_at IS NULL on its own re-read and
      // wrongly returned NULL here).
      expect((rows[0] as { count: number }).count).toBe(0);

      const epoch = await ctx.owner.query(
        `SELECT session_epoch::int AS e FROM accounts WHERE id = $1`,
        [accountId],
      );
      expect((epoch.rows[0] as { e: number }).e).toBe(1); // bumped anyway
    } finally {
      await connA.query("ROLLBACK").catch(() => {});
      connA.release();
      if (pendingB) await pendingB.catch(() => {});
      connB.release();
    }
  });
});

describe("rotate(X->X) races logout-all called with the EXACT rotated token (codex round-06 [P1])", () => {
  it("rotate wins the account lock first: logout-all still succeeds and revokes the replacement (G3 §5)", async () => {
    const { accountId } = await loginTelegram(ctx.appPool, freshLogin("barrier-round06-a"));
    const tokenHash = sha(randomBytes(32).toString("hex"));
    await createWebSession(ctx.appPool, {
      accountId,
      tokenHash,
      csrfSecret: "c",
      ttlSeconds: 900,
    });

    const connA = await ctx.appPool.connect();
    const connB = await ctx.appPool.connect();
    let pendingB: Promise<pg.QueryResult> | undefined;
    try {
      const newHash = sha(randomBytes(32).toString("hex"));
      await connA.query("BEGIN");
      // Rotate the EXACT token that logout-all will be called with. The
      // account lock rotate acquires internally stays held open (connA has
      // not committed) even though this single call has already revoked
      // tokenHash and inserted newHash.
      await connA.query(
        `SELECT auth_rotate_web_session($1, $2, $3, make_interval(secs => $4), $5) AS id`,
        [tokenHash, newHash, "new-csrf", 900, accountId],
      );

      const pidA = await backendPid(connA);
      const pidB = await backendPid(connB);
      // logout-all's OWN step-1 read (no lock) still sees tokenHash as live —
      // connA's revoke of it is uncommitted and thus invisible under MVCC.
      pendingB = connB.query(`SELECT auth_revoke_all_web_sessions($1) AS count`, [tokenHash]);
      await waitUntilBlockedByHolder(ctx.owner, pidA, pidB);

      await connA.query("COMMIT");
      const { rows } = await pendingB;
      // Must NOT be null: the account-wide intent survives the race.
      expect((rows[0] as { count: number }).count).toBe(1); // newHash flipped

      expect(await resolveWebSession(ctx.appPool, tokenHash)).toBeNull();
      expect(await resolveWebSession(ctx.appPool, newHash)).toBeNull();

      const epoch = await ctx.owner.query(
        `SELECT session_epoch::int AS e FROM accounts WHERE id = $1`,
        [accountId],
      );
      expect((epoch.rows[0] as { e: number }).e).toBe(1);
    } finally {
      await connA.query("ROLLBACK").catch(() => {});
      connA.release();
      if (pendingB) await pendingB.catch(() => {});
      connB.release();
    }
  });
});

describe("a token that expires while queued on the account lock performs zero mutation (codex round-08 [P2])", () => {
  it("re-checks expiry under the lock, not just at the initial read (G3 §4.5 step 4)", async () => {
    const { accountId } = await loginTelegram(ctx.appPool, freshLogin("expires-during-lock-wait"));
    const tokenHash = sha(randomBytes(32).toString("hex"));
    await createWebSession(ctx.appPool, {
      accountId,
      tokenHash,
      csrfSecret: "c",
      ttlSeconds: 900,
    });

    // `accounts` has zero grant to `app` — hold the lock through a properly
    // granted SECURITY DEFINER function instead of raw SQL. A decoy session
    // create on the SAME account locks it (G3 §4.1) without ever touching
    // tokenHash's row.
    const decoyHash = sha(randomBytes(32).toString("hex"));

    const connA = await ctx.appPool.connect();
    const connB = await ctx.appPool.connect();
    let pendingB: Promise<pg.QueryResult> | undefined;
    try {
      // connA holds the account lock open (via the decoy create) so connB's
      // logout-all call is guaranteed to still be queued (post step-1, pre
      // step-3) when we mutate expires_at below — this deterministically
      // reproduces "the token expires while waiting for the lock" without
      // relying on real wall-clock timing.
      await connA.query("BEGIN");
      await connA.query(
        `SELECT auth_create_web_session($1, $2, $3, make_interval(secs => $4)) AS id`,
        [accountId, decoyHash, "decoy-csrf", 900],
      );

      const pidA = await backendPid(connA);
      const pidB = await backendPid(connB);
      pendingB = connB.query(`SELECT auth_revoke_all_web_sessions($1) AS count`, [tokenHash]);
      await waitUntilBlockedByHolder(ctx.owner, pidA, pidB);

      // Simulate the token crossing its expiry threshold during the wait.
      await ctx.owner.query(
        `UPDATE web_sessions SET expires_at = now() - interval '1 second' WHERE token_hash = $1`,
        [tokenHash],
      );

      await connA.query("COMMIT");
      const { rows } = await pendingB;
      expect((rows[0] as { count: number | null }).count).toBeNull();

      const epoch = await ctx.owner.query(
        `SELECT session_epoch::int AS e FROM accounts WHERE id = $1`,
        [accountId],
      );
      expect((epoch.rows[0] as { e: number }).e).toBe(0); // never bumped

      const audits = await ctx.owner.query(
        `SELECT count(*)::int AS n FROM auth_audit_events WHERE account_id = $1`,
        [accountId],
      );
      expect((audits.rows[0] as { n: number }).n).toBe(0); // zero mutation, zero audit
    } finally {
      await connA.query("ROLLBACK").catch(() => {});
      connA.release();
      if (pendingB) await pendingB.catch(() => {});
      connB.release();
    }
  });
});

describe("the locked expiry re-check uses real wall-clock time, not the frozen transaction now() (codex round-09 [P2])", () => {
  it("logout-all: a token that naturally crosses its expiry DURING the lock wait performs zero mutation", async () => {
    const { accountId } = await loginTelegram(ctx.appPool, freshLogin("expires-naturally-logout"));
    const tokenHash = sha(randomBytes(32).toString("hex"));
    // Short-lived on purpose: this session must genuinely expire, in real
    // wall-clock time, while connB is queued on the account lock below.
    await createWebSession(ctx.appPool, {
      accountId,
      tokenHash,
      csrfSecret: "c",
      ttlSeconds: 5,
    });

    const decoyHash = sha(randomBytes(32).toString("hex"));
    const connA = await ctx.appPool.connect();
    const connB = await ctx.appPool.connect();
    let pendingB: Promise<pg.QueryResult> | undefined;
    try {
      // connA locks the account (via a decoy create) and then holds a REAL
      // 8s delay before committing — comfortably longer than tokenHash's 5s
      // TTL (codex round-10 [P2]: wide margin so pool checkout / setup
      // overhead on a loaded CI runner can never itself eat the TTL before
      // connB even reaches its own step-1 read), so real time definitely
      // crosses its expiry while connB sits blocked on the SAME account
      // lock. now() is frozen at whatever moment connB's own call began
      // (well before expiry); only clock_timestamp(), read after the lock
      // releases, sees the token as
      // expired. This is a deliberate, bounded, non-racy wall-clock gap —
      // not a guess-and-hope sleep for synchronization (blocking is still
      // confirmed via the deterministic pg_blocking_pids barrier below).
      await connA.query("BEGIN");
      await connA.query(
        `SELECT auth_create_web_session($1, $2, $3, make_interval(secs => $4)) AS id`,
        [accountId, decoyHash, "decoy-csrf", 900],
      );

      const pidA = await backendPid(connA);
      const pidB = await backendPid(connB);
      pendingB = connB.query(`SELECT auth_revoke_all_web_sessions($1) AS count`, [tokenHash]);
      await waitUntilBlockedByHolder(ctx.owner, pidA, pidB);

      await connA.query(`SELECT pg_sleep(8)`);
      await connA.query("COMMIT");

      const { rows } = await pendingB;
      expect((rows[0] as { count: number | null }).count).toBeNull();

      const epoch = await ctx.owner.query(
        `SELECT session_epoch::int AS e FROM accounts WHERE id = $1`,
        [accountId],
      );
      expect((epoch.rows[0] as { e: number }).e).toBe(0); // never bumped
    } finally {
      await connA.query("ROLLBACK").catch(() => {});
      connA.release();
      if (pendingB) await pendingB.catch(() => {});
      connB.release();
    }
  });

  it("rotate: a token that naturally crosses its expiry DURING the lock wait mints nothing", async () => {
    const { accountId } = await loginTelegram(ctx.appPool, freshLogin("expires-naturally-rotate"));
    const oldHash = sha(randomBytes(32).toString("hex"));
    await createWebSession(ctx.appPool, {
      accountId,
      tokenHash: oldHash,
      csrfSecret: "old",
      ttlSeconds: 5,
    });

    const decoyHash = sha(randomBytes(32).toString("hex"));
    const connA = await ctx.appPool.connect();
    const connB = await ctx.appPool.connect();
    let pendingB: Promise<pg.QueryResult> | undefined;
    try {
      await connA.query("BEGIN");
      await connA.query(
        `SELECT auth_create_web_session($1, $2, $3, make_interval(secs => $4)) AS id`,
        [accountId, decoyHash, "decoy-csrf", 900],
      );

      const newHash = sha(randomBytes(32).toString("hex"));
      const pidA = await backendPid(connA);
      const pidB = await backendPid(connB);
      pendingB = connB.query(
        `SELECT auth_rotate_web_session($1, $2, $3, make_interval(secs => $4), $5) AS id`,
        [oldHash, newHash, "new-csrf", 900, accountId],
      );
      await waitUntilBlockedByHolder(ctx.owner, pidA, pidB);

      await connA.query(`SELECT pg_sleep(8)`);
      await connA.query("COMMIT");

      const { rows } = await pendingB;
      expect((rows[0] as { id: string | null }).id).toBeNull();
      expect(await resolveWebSession(ctx.appPool, newHash)).toBeNull();
    } finally {
      await connA.query("ROLLBACK").catch(() => {});
      connA.release();
      if (pendingB) await pendingB.catch(() => {});
      connB.release();
    }
  });
});

describe("atomic failure and overflow (D0-20)", () => {
  it("a failure between the epoch bump and the audit insert rolls back the ENTIRE transaction", async () => {
    const { accountId } = await loginTelegram(ctx.appPool, freshLogin("atomic-fail"));
    const tokenHash = sha(randomBytes(32).toString("hex"));
    await createWebSession(ctx.appPool, {
      accountId,
      tokenHash,
      csrfSecret: "c",
      ttlSeconds: 900,
    });

    await ctx.owner.query("BEGIN");
    try {
      await ctx.owner.query(`SELECT auth_revoke_account_sessions($1)`, [accountId]);
      // Simulate a failure landing between the bump and the audit insert: a
      // shape-violating audit row (before==after breaks the +1 CHECK).
      await expect(
        ctx.owner.query(
          `INSERT INTO auth_audit_events(event_type, account_id, outcome_class, actor_class,
             request_ref, sessions_revoked, session_epoch_before, session_epoch_after)
           VALUES ('logout_all', $1, 'success', 'account_self', 'test-ref', 1, 5, 5)`,
          [accountId],
        ),
      ).rejects.toThrow(/auth_audit_events_epoch_shape_chk/);
    } finally {
      await ctx.owner.query("ROLLBACK");
    }

    const epoch = await ctx.owner.query(
      `SELECT session_epoch::int AS e FROM accounts WHERE id = $1`,
      [accountId],
    );
    expect((epoch.rows[0] as { e: number }).e).toBe(0);

    const revoked = await ctx.owner.query(
      `SELECT revoked_at FROM web_sessions WHERE token_hash = $1`,
      [tokenHash],
    );
    expect((revoked.rows[0] as { revoked_at: Date | null }).revoked_at).toBeNull();
  });

  it("the epoch-shape CHECK rejects a ONE-SIDED null (codex round-01: UNKNOWN must not pass)", async () => {
    const { accountId } = await loginTelegram(ctx.appPool, freshLogin("epoch-one-sided"));
    await expect(
      ctx.owner.query(
        `INSERT INTO auth_audit_events(event_type, account_id, outcome_class, actor_class,
           request_ref, session_epoch_before, session_epoch_after)
         VALUES ('logout_all', $1, 'success', 'account_self', 'test-ref', 5, NULL)`,
        [accountId],
      ),
    ).rejects.toThrow(/auth_audit_events_epoch_shape_chk/);
    await expect(
      ctx.owner.query(
        `INSERT INTO auth_audit_events(event_type, account_id, outcome_class, actor_class,
           request_ref, session_epoch_before, session_epoch_after)
         VALUES ('logout_all', $1, 'success', 'account_self', 'test-ref', NULL, 6)`,
        [accountId],
      ),
    ).rejects.toThrow(/auth_audit_events_epoch_shape_chk/);
  });

  it("bigint overflow at the max epoch boundary aborts rather than wrapping", async () => {
    const { accountId } = await loginTelegram(ctx.appPool, freshLogin("overflow"));
    await ctx.owner.query(`UPDATE accounts SET session_epoch = 9223372036854775807 WHERE id = $1`, [
      accountId,
    ]);

    await expect(
      ctx.owner.query(`SELECT auth_revoke_account_sessions($1)`, [accountId]),
    ).rejects.toThrow(/out of range/i);

    const epoch = await ctx.owner.query(
      `SELECT session_epoch::text AS e FROM accounts WHERE id = $1`,
      [accountId],
    );
    expect((epoch.rows[0] as { e: string }).e).toBe("9223372036854775807");
  });
});

describe("exact revoke materialization and count via the public wrapper (D0-21)", () => {
  it("A has 3 live sessions, B has 1; logout-all(A) bumps once and revokes exactly A's 3, B untouched", async () => {
    const a = await loginTelegram(ctx.appPool, freshLogin("materialize-A"));
    const b = await loginTelegram(ctx.appPool, freshLogin("materialize-B"));
    const aHashes = [0, 1, 2].map((i) =>
      sha(`materialize-a-${i}-${randomBytes(8).toString("hex")}`),
    );
    for (const h of aHashes) {
      await createWebSession(ctx.appPool, {
        accountId: a.accountId,
        tokenHash: h,
        csrfSecret: "a",
        ttlSeconds: 900,
      });
    }
    const bHash = sha(randomBytes(32).toString("hex"));
    await createWebSession(ctx.appPool, {
      accountId: b.accountId,
      tokenHash: bHash,
      csrfSecret: "b",
      ttlSeconds: 900,
    });

    const count = await revokeAllWebSessions(ctx.appPool, aHashes[0]!);
    expect(count).toBe(3);

    const aRows = await ctx.owner.query(
      `SELECT DISTINCT revoked_at FROM web_sessions WHERE account_id = $1`,
      [a.accountId],
    );
    expect(aRows.rows).toHaveLength(1);

    const aEpoch = await ctx.owner.query(
      `SELECT session_epoch::int AS e FROM accounts WHERE id = $1`,
      [a.accountId],
    );
    expect((aEpoch.rows[0] as { e: number }).e).toBe(1);

    expect(await resolveWebSession(ctx.appPool, bHash)).not.toBeNull();
    const bEpoch = await ctx.owner.query(
      `SELECT session_epoch::int AS e FROM accounts WHERE id = $1`,
      [b.accountId],
    );
    expect((bEpoch.rows[0] as { e: number }).e).toBe(0);
  });
});

describe("forward rollback safety (D0-22)", () => {
  it("dropping the epoch predicate cannot resurrect a session already materialized as revoked", async () => {
    const { accountId } = await loginTelegram(ctx.appPool, freshLogin("rollback-safety"));
    const tokenHash = sha(randomBytes(32).toString("hex"));
    await createWebSession(ctx.appPool, {
      accountId,
      tokenHash,
      csrfSecret: "c",
      ttlSeconds: 900,
    });
    expect(await revokeAllWebSessions(ctx.appPool, tokenHash)).toBe(1);

    // The EXACT pre-0015 predicate, with no epoch comparison at all.
    const { rows } = await ctx.owner.query(
      `SELECT id FROM web_sessions
       WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
      [tokenHash],
    );
    expect(rows).toHaveLength(0);
  });
});

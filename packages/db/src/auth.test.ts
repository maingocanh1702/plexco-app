import { createCipheriv, createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  LoginReplayError,
  onboardingSnapshot,
  rateLimitCheck,
  SlugTakenError,
  consumeLoginState,
  createWebSession,
  decryptEmailEnc,
  deriveEmailArtifacts,
  deriveProviderIdempotencyKey,
  InvalidEmailError,
  issueLoginState,
  loginTelegram,
  normalizeEmail,
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

// ===========================================================================
// D1 — account-email + credential + token core (migration 0016, CODE DARK).
// Acceptance matrix D1E-1..D1E-22 (feature_web_auth_onboarding_tech.md §5);
// every `it` is tagged with its ID. All run on REAL PostgreSQL. The `app` role
// has ZERO grant on the 0016 tables, so every fixture/assertion here uses the
// owner/superuser connection (that is the point of the code-dark design). The
// concurrency rows (D1E-16/17/18) use the same deterministic two-connection
// barrier as the D0a suite — never pg_sleep.
// ===========================================================================

/** Canonical, unpadded standard-base64 of n random bytes (a real argon2 salt/hash shape). */
const b64 = (n: number) => randomBytes(n).toString("base64").replace(/=+$/, "");
/** A structurally valid, policy-conformant Argon2id PHC (m=19456,t=2,p=1). */
const validPhc = () => `$argon2id$v=19$m=19456,t=2,p=1$${b64(16)}$${b64(32)}`;

async function seedAccount(): Promise<{ personId: string; accountId: string }> {
  const { rows } = await ctx.owner.query(
    `WITH p AS (INSERT INTO persons DEFAULT VALUES RETURNING id)
     INSERT INTO accounts(person_id) SELECT id FROM p RETURNING id AS account_id, person_id`,
  );
  const r = rows[0] as { account_id: string; person_id: string };
  return { accountId: r.account_id, personId: r.person_id };
}

async function seedEmail(
  opts: { verified?: boolean; lookupHash?: string; pendingExpiresInSec?: number } = {},
): Promise<{ accountId: string; personId: string; accountEmailId: string }> {
  const { accountId, personId } = await seedAccount();
  const lookup = opts.lookupHash ?? `lk-${randomBytes(8).toString("hex")}`;
  const { rows } = await ctx.owner.query(
    `INSERT INTO account_emails(account_id, email_lookup_hash, email_enc, kms_key_version, verified_at, pending_expires_at)
     VALUES ($1, $2, '\\x00'::bytea, 'v1',
             CASE WHEN $3 THEN now() ELSE NULL END,
             CASE WHEN $3 THEN NULL ELSE now() + make_interval(secs => $4) END)
     RETURNING id`,
    [accountId, lookup, opts.verified ?? false, opts.pendingExpiresInSec ?? 86400],
  );
  return { accountId, personId, accountEmailId: (rows[0] as { id: string }).id };
}

async function seedAttempt(
  accountEmailId: string,
  opts: { regKeyHash?: string; expiresInSec?: number } = {},
): Promise<string> {
  const { rows } = await ctx.owner.query(
    `INSERT INTO auth_pending_email_registrations(account_email_id, password_phc, registration_key_hash, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(secs => $4)) RETURNING id`,
    [
      accountEmailId,
      validPhc(),
      opts.regKeyHash ?? `rk-${randomBytes(8).toString("hex")}`,
      opts.expiresInSec ?? 86400,
    ],
  );
  return (rows[0] as { id: string }).id;
}

async function seedResetToken(
  accountEmailId: string,
  opts: { tokenHash?: string; expiresInSec?: number } = {},
): Promise<string> {
  const th = opts.tokenHash ?? `rst-${randomBytes(16).toString("hex")}`;
  await ctx.owner.query(
    `INSERT INTO auth_email_tokens(account_email_id, purpose, token_hash, expires_at)
     VALUES ($1, 'password_reset', $2, now() + make_interval(secs => $3))`,
    [accountEmailId, th, opts.expiresInSec ?? 900],
  );
  return th;
}

async function seedVerifyToken(
  accountEmailId: string,
  pendingId: string,
  opts: { tokenHash?: string; expiresInSec?: number } = {},
): Promise<string> {
  const th = opts.tokenHash ?? `vfy-${randomBytes(16).toString("hex")}`;
  await ctx.owner.query(
    `INSERT INTO auth_email_tokens(account_email_id, pending_registration_id, purpose, token_hash, expires_at)
     VALUES ($1, $2, 'verify_email', $3, now() + make_interval(secs => $4))`,
    [accountEmailId, pendingId, th, opts.expiresInSec ?? 1800],
  );
  return th;
}

async function seedLinkCode(personId: string): Promise<string> {
  const ci = await ctx.owner.query(
    `INSERT INTO channel_identities(person_id, platform, platform_user_id_enc, platform_user_lookup_hash)
     VALUES ($1, 'telegram', '\\x00'::bytea, $2) RETURNING id`,
    [personId, `ci-${randomBytes(6).toString("hex")}`],
  );
  const lc = await ctx.owner.query(
    `INSERT INTO link_codes(source_person_id, source_channel_identity_id, code_lookup_hash, code_hash, salt, expires_at)
     VALUES ($1, $2, $3, '\\x00'::bytea, '\\x00'::bytea, now() + interval '1 hour') RETURNING id`,
    [personId, (ci.rows[0] as { id: string }).id, `lc-${randomBytes(6).toString("hex")}`],
  );
  return (lc.rows[0] as { id: string }).id;
}

async function consumeAs(
  client: pg.ClientBase,
  tokenHash: string,
  purpose: string,
): Promise<{ account_email_id: string; pending_registration_id: string | null }[]> {
  const { rows } = await client.query(
    `SELECT account_email_id, pending_registration_id FROM _auth_consume_email_token($1, $2)`,
    [tokenHash, purpose],
  );
  return rows as { account_email_id: string; pending_registration_id: string | null }[];
}

describe("D1 storage shape + constraints (D1E-1..D1E-10)", () => {
  it("D1E-1: 0016 applied on top of 0015 — the five tables + owned objects exist", async () => {
    const { rows } = await ctx.owner.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1)`,
      [
        [
          "account_emails",
          "email_password_credentials",
          "auth_pending_email_registrations",
          "auth_email_tokens",
          "auth_email_deliveries",
        ],
      ],
    );
    expect((rows as { table_name: string }[]).map((r) => r.table_name).sort()).toEqual(
      [
        "account_emails",
        "auth_email_deliveries",
        "auth_email_tokens",
        "auth_pending_email_registrations",
        "email_password_credentials",
      ].sort(),
    );
    // 0016 recorded in the immutable ledger (idempotency proven in rls-invariants).
    const mig = await ctx.owner.query(
      `SELECT 1 FROM schema_migrations WHERE name = '0016_account_email_token_core.sql'`,
    );
    expect(mig.rows).toHaveLength(1);
  });

  it("D1E-2: account_emails — mutually-exclusive verified/pending CHECK + UNIQUE(account_id)", async () => {
    const { accountId } = await seedAccount();
    // both NULL -> reject
    await expect(
      ctx.owner.query(
        `INSERT INTO account_emails(account_id, email_lookup_hash, email_enc, kms_key_version)
         VALUES ($1, 'lk-a', '\\x00'::bytea, 'v1')`,
        [accountId],
      ),
    ).rejects.toThrow(/account_emails_lifecycle_chk/);
    // both NOT NULL -> reject
    await expect(
      ctx.owner.query(
        `INSERT INTO account_emails(account_id, email_lookup_hash, email_enc, kms_key_version, verified_at, pending_expires_at)
         VALUES ($1, 'lk-b', '\\x00'::bytea, 'v1', now(), now() + interval '1h')`,
        [accountId],
      ),
    ).rejects.toThrow(/account_emails_lifecycle_chk/);
    // exactly-one-set (verified) inserts, and a SECOND email for the same account is rejected.
    await ctx.owner.query(
      `INSERT INTO account_emails(account_id, email_lookup_hash, email_enc, kms_key_version, verified_at)
       VALUES ($1, 'lk-c', '\\x00'::bytea, 'v1', now())`,
      [accountId],
    );
    await expect(
      ctx.owner.query(
        `INSERT INTO account_emails(account_id, email_lookup_hash, email_enc, kms_key_version, pending_expires_at)
         VALUES ($1, 'lk-d', '\\x00'::bytea, 'v1', now() + interval '1h')`,
        [accountId],
      ),
    ).rejects.toThrow(/account_emails_account_uq/);
  });

  it("D1E-3: one owner per normalized email — duplicate email_lookup_hash is rejected", async () => {
    const shared = `lk-shared-${randomBytes(6).toString("hex")}`;
    await seedEmail({ verified: true, lookupHash: shared });
    const second = await seedAccount();
    await expect(
      ctx.owner.query(
        `INSERT INTO account_emails(account_id, email_lookup_hash, email_enc, kms_key_version, verified_at)
         VALUES ($1, $2, '\\x00'::bytea, 'v1', now())`,
        [second.accountId, shared],
      ),
    ).rejects.toThrow(/account_emails_email_lookup_hash_key|unique/i);
  });

  it("D1E-4: a credential may exist ONLY for a verified email (verified-gate trigger)", async () => {
    const pending = await seedEmail({ verified: false });
    await expect(
      ctx.owner.query(
        `INSERT INTO email_password_credentials(account_email_id, password_phc) VALUES ($1, $2)`,
        [pending.accountEmailId, validPhc()],
      ),
    ).rejects.toThrow(/requires a verified account_email/);
    const missing = await ctx.owner.query(
      `SELECT 1 FROM email_password_credentials WHERE account_email_id = $1`,
      [pending.accountEmailId],
    );
    expect(missing.rows).toHaveLength(0);

    // ...and a credential for a VERIFIED email is accepted.
    const verified = await seedEmail({ verified: true });
    await ctx.owner.query(
      `INSERT INTO email_password_credentials(account_email_id, password_phc) VALUES ($1, $2)`,
      [verified.accountEmailId, validPhc()],
    );
  });

  it("D1E-4: verified_at is MONOTONIC — un-verifying an email is unconditionally rejected (codex round-01 [P2] / round-02 [P1])", async () => {
    // Un-verification is forbidden UNCONDITIONALLY (not merely when a credential
    // exists), which is race-free: there is no valid verified->pending
    // transition to serialize against a concurrent credential insert.
    const verified = await seedEmail({ verified: true });
    await ctx.owner.query(
      `INSERT INTO email_password_credentials(account_email_id, password_phc) VALUES ($1, $2)`,
      [verified.accountEmailId, validPhc()],
    );
    await expect(
      ctx.owner.query(
        `UPDATE account_emails SET verified_at = NULL, pending_expires_at = now() + interval '1h' WHERE id = $1`,
        [verified.accountEmailId],
      ),
    ).rejects.toThrow(/verified_at is monotonic/);
    // still verified, still owns its credential
    const row = await ctx.owner.query(`SELECT verified_at FROM account_emails WHERE id = $1`, [
      verified.accountEmailId,
    ]);
    expect((row.rows[0] as { verified_at: string | null }).verified_at).not.toBeNull();

    // ...and un-verifying is rejected even with NO credential (unconditional).
    const bare = await seedEmail({ verified: true });
    await expect(
      ctx.owner.query(
        `UPDATE account_emails SET verified_at = NULL, pending_expires_at = now() + interval '1h' WHERE id = $1`,
        [bare.accountEmailId],
      ),
    ).rejects.toThrow(/verified_at is monotonic/);
  });

  it("D1E-5: pending attempt lifecycle CHECK — active carries both candidates; terminal is XOR + candidates NULL", async () => {
    const { accountEmailId } = await seedEmail({ verified: false });
    // active but password_phc NULL -> reject
    await expect(
      ctx.owner.query(
        `INSERT INTO auth_pending_email_registrations(account_email_id, password_phc, registration_key_hash, expires_at)
         VALUES ($1, NULL, 'rk-x', now() + interval '24h')`,
        [accountEmailId],
      ),
    ).rejects.toThrow(/lifecycle_chk/);
    // active with both candidates -> ok
    const id = await seedAttempt(accountEmailId, { regKeyHash: "rk-active" });
    // terminal (superseded) with candidates NULL -> ok
    await ctx.owner.query(
      `UPDATE auth_pending_email_registrations
       SET superseded_at = now(), password_phc = NULL, registration_key_hash = NULL WHERE id = $1`,
      [id],
    );
    // terminal but a candidate still set -> reject
    await expect(
      ctx.owner.query(
        `UPDATE auth_pending_email_registrations SET registration_key_hash = 'rk-leak' WHERE id = $1`,
        [id],
      ),
    ).rejects.toThrow(/lifecycle_chk/);
    // both consumed AND superseded (not XOR) -> reject
    const id2 = await seedAttempt(accountEmailId, { regKeyHash: "rk-active-2" });
    await expect(
      ctx.owner.query(
        `UPDATE auth_pending_email_registrations
         SET consumed_at = now(), superseded_at = now(), password_phc = NULL, registration_key_hash = NULL WHERE id = $1`,
        [id2],
      ),
    ).rejects.toThrow(/lifecycle_chk/);
  });

  it("D1E-6: two register commands = two INDEPENDENT attempts + tokens; registration_key_hash is UNIQUE", async () => {
    const { accountEmailId } = await seedEmail({ verified: false });
    const a1 = await seedAttempt(accountEmailId, { regKeyHash: "rk-browser-1" });
    const a2 = await seedAttempt(accountEmailId, { regKeyHash: "rk-browser-2" });
    const t1 = await seedVerifyToken(accountEmailId, a1);
    const t2 = await seedVerifyToken(accountEmailId, a2);
    // neither supersedes the other — both attempts + both tokens are still active.
    const active = await ctx.owner.query(
      `SELECT count(*)::int AS n FROM auth_email_tokens
       WHERE account_email_id = $1 AND consumed_at IS NULL AND superseded_at IS NULL`,
      [accountEmailId],
    );
    expect((active.rows[0] as { n: number }).n).toBe(2);
    expect(t1).not.toBe(t2);
    // registration_key_hash is globally unique (no last-writer-wins on the slot).
    await expect(
      ctx.owner.query(
        `INSERT INTO auth_pending_email_registrations(account_email_id, password_phc, registration_key_hash, expires_at)
         VALUES ($1, $2, 'rk-browser-1', now() + interval '24h')`,
        [accountEmailId, validPhc()],
      ),
    ).rejects.toThrow(/registration_key_hash|unique/i);
  });

  it("D1E-7: token purpose binding + composite FK to the attempt's SAME account_email", async () => {
    const emailA = await seedEmail({ verified: false });
    const attemptA = await seedAttempt(emailA.accountEmailId);
    // verify_email WITHOUT a pending attempt -> reject
    await expect(
      ctx.owner.query(
        `INSERT INTO auth_email_tokens(account_email_id, purpose, token_hash, expires_at)
         VALUES ($1, 'verify_email', 'no-attempt', now() + interval '30m')`,
        [emailA.accountEmailId],
      ),
    ).rejects.toThrow(/purpose_reg_chk/);
    // password_reset WITH a pending attempt -> reject
    await expect(
      ctx.owner.query(
        `INSERT INTO auth_email_tokens(account_email_id, pending_registration_id, purpose, token_hash, expires_at)
         VALUES ($1, $2, 'password_reset', 'reset-with-attempt', now() + interval '30m')`,
        [emailA.accountEmailId, attemptA],
      ),
    ).rejects.toThrow(/purpose_reg_chk/);
    // composite FK: a verify token whose attempt belongs to a DIFFERENT email -> reject
    const emailB = await seedEmail({ verified: false });
    await expect(
      ctx.owner.query(
        `INSERT INTO auth_email_tokens(account_email_id, pending_registration_id, purpose, token_hash, expires_at)
         VALUES ($1, $2, 'verify_email', 'cross-attempt', now() + interval '30m')`,
        [emailB.accountEmailId, attemptA],
      ),
    ).rejects.toThrow(/auth_email_tokens_attempt_fk|foreign key/i);
  });

  it("D1E-8: one ACTIVE verify token per attempt; supersede-then-insert succeeds", async () => {
    const { accountEmailId } = await seedEmail({ verified: false });
    const attempt = await seedAttempt(accountEmailId);
    await seedVerifyToken(accountEmailId, attempt, { tokenHash: "vfy-1" });
    // second active verify token for the SAME attempt -> rejected by the partial unique index
    await expect(
      ctx.owner.query(
        `INSERT INTO auth_email_tokens(account_email_id, pending_registration_id, purpose, token_hash, expires_at)
         VALUES ($1, $2, 'verify_email', 'vfy-2', now() + interval '30m')`,
        [accountEmailId, attempt],
      ),
    ).rejects.toThrow(/one_active_verify_per_attempt_uq/);
    // supersede the first, then insert -> ok
    await ctx.owner.query(
      `UPDATE auth_email_tokens SET superseded_at = now() WHERE token_hash = 'vfy-1'`,
    );
    await ctx.owner.query(
      `INSERT INTO auth_email_tokens(account_email_id, pending_registration_id, purpose, token_hash, expires_at)
       VALUES ($1, $2, 'verify_email', 'vfy-2', now() + interval '30m')`,
      [accountEmailId, attempt],
    );
  });

  it("D1E-9: one ACTIVE reset token per email; index is now()-INDEPENDENT (an EXPIRED-but-unswept token still holds the slot)", async () => {
    const { accountEmailId } = await seedEmail({ verified: true });
    // an already-EXPIRED but unsuperseded reset token still occupies the active slot.
    await ctx.owner.query(
      `INSERT INTO auth_email_tokens(account_email_id, purpose, token_hash, expires_at)
       VALUES ($1, 'password_reset', 'reset-expired', now() - interval '1 min')`,
      [accountEmailId],
    );
    await expect(
      ctx.owner.query(
        `INSERT INTO auth_email_tokens(account_email_id, purpose, token_hash, expires_at)
         VALUES ($1, 'password_reset', 'reset-new', now() + interval '15m')`,
        [accountEmailId],
      ),
    ).rejects.toThrow(/one_active_reset_uq/);
    // supersede-before-insert (the issue path) succeeds even though the old one was expired-unswept.
    await ctx.owner.query(
      `UPDATE auth_email_tokens SET superseded_at = now() WHERE token_hash = 'reset-expired'`,
    );
    await ctx.owner.query(
      `INSERT INTO auth_email_tokens(account_email_id, purpose, token_hash, expires_at)
       VALUES ($1, 'password_reset', 'reset-new', now() + interval '15m')`,
      [accountEmailId],
    );
  });

  it("D1E-10: a token cannot be both consumed AND superseded", async () => {
    const { accountEmailId } = await seedEmail({ verified: true });
    const th = await seedResetToken(accountEmailId);
    await expect(
      ctx.owner.query(
        `UPDATE auth_email_tokens SET consumed_at = now(), superseded_at = now() WHERE token_hash = $1`,
        [th],
      ),
    ).rejects.toThrow(/auth_email_tokens_terminal_chk/);
  });
});

describe("D1 PHC validator + constraint triggers (D1E-11..D1E-12)", () => {
  const assertPhc = (phc: string) => ctx.owner.query(`SELECT _auth_assert_password_phc($1)`, [phc]);

  it("D1E-11: only the exact benchmarked tuple passes; every other cell raises and rolls back", async () => {
    const salt = b64(16);
    const hash = b64(32);
    // accept
    await expect(assertPhc(`$argon2id$v=19$m=19456,t=2,p=1$${salt}$${hash}`)).resolves.toBeTruthy();
    // reject matrix
    const reject: [string, RegExp][] = [
      [`$argon2i$v=19$m=19456,t=2,p=1$${salt}$${hash}`, /malformed/], // wrong algorithm
      [`$argon2id$v=18$m=19456,t=2,p=1$${salt}$${hash}`, /malformed/], // wrong version
      [`$argon2id$v=19$m=19456,t=2$${salt}$${hash}`, /malformed/], // missing p
      [`$argon2id$v=19$m=19456,t=2,p=1,x=1$${salt}$${hash}`, /malformed/], // extra param
      [`$argon2id$v=19$m=19456,t=2,p=1$${"A".repeat(21)}B$${hash}`, /non-canonical/], // non-zero trailing bits
      [`$argon2id$v=19$m=19456,t=2,p=1$${"A".repeat(21)}$${hash}`, /invalid base64/], // length % 4 = 1
      [`$argon2id$v=19$m=19456,t=2,p=1$${b64(12)}$${hash}`, /salt too short/], // 12-byte salt
      [`$argon2id$v=19$m=19456,t=2,p=1$${salt}$${b64(20)}`, /output too short/], // 20-byte output
      [`$argon2id$v=19$m=19455,t=2,p=1$${salt}$${hash}`, /below policy floor/], // m below floor
      [`$argon2id$v=19$m=19456,t=1,p=1$${salt}$${hash}`, /below policy floor/], // t below floor
      [`$argon2id$v=19$m=19457,t=2,p=1$${salt}$${hash}`, /above policy ceiling/], // m above ceiling
      [`$argon2id$v=19$m=19456,t=3,p=1$${salt}$${hash}`, /above policy ceiling/], // t above ceiling
      // out-of-int-range m: generic "above ceiling", NOT a native 22003 that
      // echoes the numeric text (codex round-09 [P2]).
      [`$argon2id$v=19$m=99999999999999999999,t=2,p=1$${salt}$${hash}`, /above policy ceiling/],
    ];
    for (const [phc, pattern] of reject) {
      await expect(assertPhc(phc), `must reject: ${phc.slice(0, 40)}...`).rejects.toThrow(pattern);
    }
    // the oversized numeric text never appears in the error (D1E-22 contract)
    let overflowMsg = "";
    try {
      await assertPhc(`$argon2id$v=19$m=99999999999999999999,t=2,p=1$${salt}$${hash}`);
    } catch (e) {
      overflowMsg = String((e as Error).message) + String((e as { cause?: unknown }).cause ?? "");
    }
    expect(overflowMsg).not.toContain("99999999999999999999");
    expect(overflowMsg).not.toMatch(/22003|out of range/i);
  });

  it("D1E-12: the PHC trigger fires on BOTH write paths; direct UPDATE with a malformed PHC is rejected", async () => {
    const verified = await seedEmail({ verified: true });
    await ctx.owner.query(
      `INSERT INTO email_password_credentials(account_email_id, password_phc) VALUES ($1, $2)`,
      [verified.accountEmailId, validPhc()],
    );
    // credential write path
    await expect(
      ctx.owner.query(
        `UPDATE email_password_credentials SET password_phc = 'downgraded' WHERE account_email_id = $1`,
        [verified.accountEmailId],
      ),
    ).rejects.toThrow(/password PHC: malformed/);
    // pending-attempt write path
    const pending = await seedEmail({ verified: false });
    const attempt = await seedAttempt(pending.accountEmailId);
    await expect(
      ctx.owner.query(
        `UPDATE auth_pending_email_registrations SET password_phc = 'downgraded' WHERE id = $1`,
        [attempt],
      ),
    ).rejects.toThrow(/password PHC: malformed/);
    // NULLing the candidate as part of a terminal transition is still allowed (lifecycle CHECK owns NULL).
    await ctx.owner.query(
      `UPDATE auth_pending_email_registrations
       SET superseded_at = now(), password_phc = NULL, registration_key_hash = NULL WHERE id = $1`,
      [attempt],
    );
  });
});

describe("D1 grant matrix (D1E-13)", () => {
  it("D1E-13: app is denied direct DML on password_phc and EXECUTE on the internal helpers", async () => {
    const verified = await seedEmail({ verified: true });
    await ctx.owner.query(
      `INSERT INTO email_password_credentials(account_email_id, password_phc) VALUES ($1, $2)`,
      [verified.accountEmailId, validPhc()],
    );
    // INSERT / UPDATE password_phc via `app` -> permission denied (no table grant at all)
    await expect(
      ctx.appPool.query(
        `INSERT INTO email_password_credentials(account_email_id, password_phc) VALUES ($1, $2)`,
        [verified.accountEmailId, validPhc()],
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      ctx.appPool.query(`UPDATE email_password_credentials SET password_phc = $1`, [validPhc()]),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      ctx.appPool.query(`UPDATE auth_pending_email_registrations SET password_phc = $1`, [
        validPhc(),
      ]),
    ).rejects.toThrow(/permission denied/i);
    // EXECUTE the internal helpers via `app`/`readonly` -> permission denied
    await expect(
      ctx.appPool.query(`SELECT _auth_assert_password_phc($1)`, [validPhc()]),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      ctx.appPool.query(`SELECT * FROM _auth_consume_email_token('x', 'password_reset')`),
    ).rejects.toThrow(/permission denied/i);
    for (const fn of [
      "_auth_email_delivery_cleanup",
      "_auth_email_attempt_terminalize",
      "_auth_email_token_retention",
      "_auth_email_attempt_retention",
      "_auth_email_orphan_cleanup",
    ]) {
      await expect(
        ctx.appPool.query(`SELECT ${fn}()`),
        `app must be denied EXECUTE on ${fn}`,
      ).rejects.toThrow(/permission denied/i);
    }
  });
});

describe("D1 consume boundary (D1E-14..D1E-15)", () => {
  it("D1E-14: happy path consumes exactly once with consumed_at = transaction_timestamp()", async () => {
    // reset token -> returns (account_email_id, NULL)
    const email = await seedEmail({ verified: true });
    const th = await seedResetToken(email.accountEmailId);
    await ctx.owner.query("BEGIN");
    const consumed = await consumeAs(ctx.owner, th, "password_reset");
    const txn = await ctx.owner.query(`SELECT transaction_timestamp() AS ts`);
    await ctx.owner.query("COMMIT");
    expect(consumed).toHaveLength(1);
    expect(consumed[0]!.account_email_id).toBe(email.accountEmailId);
    expect(consumed[0]!.pending_registration_id).toBeNull();
    const row = await ctx.owner.query(
      `SELECT consumed_at FROM auth_email_tokens WHERE token_hash = $1`,
      [th],
    );
    expect(new Date((row.rows[0] as { consumed_at: string }).consumed_at).getTime()).toBe(
      new Date((txn.rows[0] as { ts: string }).ts).getTime(),
    );

    // verify token -> returns (account_email_id, pending_registration_id)
    const pemail = await seedEmail({ verified: false });
    const attempt = await seedAttempt(pemail.accountEmailId);
    const vth = await seedVerifyToken(pemail.accountEmailId, attempt);
    const v = await consumeAs(ctx.owner, vth, "verify_email");
    expect(v).toHaveLength(1);
    expect(v[0]!.account_email_id).toBe(pemail.accountEmailId);
    expect(v[0]!.pending_registration_id).toBe(attempt);
  });

  it("D1E-15: fail-closed matrix — wrong purpose, expired, consumed, superseded, unknown hash all return zero rows", async () => {
    // A distinct email per cell: the now()-independent one-active-reset index means
    // an expired-but-unswept token still occupies the slot (D1E-9), so two active
    // reset tokens cannot share an email.
    // wrong purpose (token is reset, ask for verify)
    const e1 = await seedEmail({ verified: true });
    const thPurpose = await seedResetToken(e1.accountEmailId);
    expect(await consumeAs(ctx.owner, thPurpose, "verify_email")).toEqual([]);
    // expired
    const e2 = await seedEmail({ verified: true });
    const thExpired = await seedResetToken(e2.accountEmailId, { expiresInSec: -60 });
    expect(await consumeAs(ctx.owner, thExpired, "password_reset")).toEqual([]);
    // already consumed
    const e3 = await seedEmail({ verified: true });
    const thConsumed = await seedResetToken(e3.accountEmailId);
    expect(await consumeAs(ctx.owner, thConsumed, "password_reset")).toHaveLength(1);
    expect(await consumeAs(ctx.owner, thConsumed, "password_reset")).toEqual([]);
    // already superseded
    const e4 = await seedEmail({ verified: true });
    const thSup = await seedResetToken(e4.accountEmailId);
    await ctx.owner.query(
      `UPDATE auth_email_tokens SET superseded_at = now() WHERE token_hash = $1`,
      [thSup],
    );
    expect(await consumeAs(ctx.owner, thSup, "password_reset")).toEqual([]);
    // unknown hash
    expect(await consumeAs(ctx.owner, "fc-never-existed", "password_reset")).toEqual([]);
    // the wrong-purpose token was NOT mutated by any of the above
    const stillActive = await ctx.owner.query(
      `SELECT count(*)::int AS n FROM auth_email_tokens
       WHERE token_hash = $1 AND consumed_at IS NULL AND superseded_at IS NULL`,
      [thPurpose],
    );
    expect((stillActive.rows[0] as { n: number }).n).toBe(1);
  });

  it("D1E-15: a verify token whose ATTEMPT is no longer active is not consumable (codex round-01 [P1])", async () => {
    // A token can outlive its attempt: supersede the attempt WITHOUT touching
    // the token (a competing verify winner, or the cleanup sweep). The consume
    // helper must revalidate the attempt under the lock and refuse.
    const email = await seedEmail({ verified: false });
    const attempt = await seedAttempt(email.accountEmailId);
    const vth = await seedVerifyToken(email.accountEmailId, attempt);
    await ctx.owner.query(
      `UPDATE auth_pending_email_registrations
       SET superseded_at = now(), password_phc = NULL, registration_key_hash = NULL WHERE id = $1`,
      [attempt],
    );
    // token is still active, but its attempt is superseded -> zero rows, zero mutation
    expect(await consumeAs(ctx.owner, vth, "verify_email")).toEqual([]);
    const tok = await ctx.owner.query(
      `SELECT consumed_at FROM auth_email_tokens WHERE token_hash = $1`,
      [vth],
    );
    expect((tok.rows[0] as { consumed_at: string | null }).consumed_at).toBeNull();

    // ...and an EXPIRED attempt is likewise refused even with an active token.
    const email2 = await seedEmail({ verified: false });
    const expiredAttempt = await seedAttempt(email2.accountEmailId, { expiresInSec: -60 });
    const vth2 = await seedVerifyToken(email2.accountEmailId, expiredAttempt);
    expect(await consumeAs(ctx.owner, vth2, "verify_email")).toEqual([]);
  });
});

describe("D1 parent-first lock hierarchy + barriers (D1E-16..D1E-18)", () => {
  it("D1E-16: the consume path blocks on the accounts PARENT lock (parent-first, not child-first)", async () => {
    const email = await seedEmail({ verified: true });
    const th = await seedResetToken(email.accountEmailId);
    const holder = await ctx.superuserDb.pool.connect();
    const waiter = await ctx.superuserDb.pool.connect();
    let pending: Promise<pg.QueryResult> | undefined;
    try {
      // Holder takes the accounts parent row. If the consume were child-first it
      // could reach and lock the token without waiting on accounts.
      await holder.query("BEGIN");
      await holder.query(`SELECT 1 FROM accounts WHERE id = $1 FOR UPDATE`, [email.accountId]);
      const pidHolder = await backendPid(holder);
      const pidWaiter = await backendPid(waiter);
      pending = waiter.query(
        `SELECT account_email_id FROM _auth_consume_email_token($1, 'password_reset')`,
        [th],
      );
      // Proven blocked SPECIFICALLY by the accounts holder.
      await waitUntilBlockedByHolder(ctx.owner, pidHolder, pidWaiter);
      await holder.query("COMMIT");
      const rows = (await pending).rows;
      expect(rows).toHaveLength(1);
      // token consumed exactly once after the parent was released
      const t = await ctx.owner.query(
        `SELECT consumed_at FROM auth_email_tokens WHERE token_hash = $1`,
        [th],
      );
      expect((t.rows[0] as { consumed_at: string | null }).consumed_at).not.toBeNull();
    } finally {
      await holder.query("ROLLBACK").catch(() => {});
      holder.release();
      if (pending) await pending.catch(() => {});
      waiter.release();
    }
  });

  it("D1E-16: two concurrent consumes of the SAME token do not deadlock; exactly one consumes", async () => {
    const email = await seedEmail({ verified: true });
    const th = await seedResetToken(email.accountEmailId);
    const [r1, r2] = await Promise.all([
      consumeAs(ctx.owner, th, "password_reset"),
      (async () => {
        const c = await ctx.superuserDb.pool.connect();
        try {
          return await consumeAs(c, th, "password_reset");
        } finally {
          c.release();
        }
      })(),
    ]);
    // exactly one winner; no deadlock (both settled)
    expect(r1.length + r2.length).toBe(1);
  });

  it("D1E-17: reset-issue supersede-all × consume barrier — exactly one wins, loser is zero-mutation, no partial state", async () => {
    // (A) reset-issue (supersede-all) commits first -> consume sees superseded, zero mutation.
    {
      const email = await seedEmail({ verified: true });
      const th = await seedResetToken(email.accountEmailId);
      const issuer = await ctx.superuserDb.pool.connect();
      const consumer = await ctx.superuserDb.pool.connect();
      let pending: Promise<pg.QueryResult> | undefined;
      try {
        // issuer takes parent-first locks then supersedes the active reset token (the issue path's supersede-before-insert).
        await issuer.query("BEGIN");
        await issuer.query(`SELECT 1 FROM accounts WHERE id = $1 FOR UPDATE`, [email.accountId]);
        await issuer.query(`SELECT 1 FROM account_emails WHERE id = $1 FOR UPDATE`, [
          email.accountEmailId,
        ]);
        await issuer.query(
          `UPDATE auth_email_tokens SET superseded_at = now()
           WHERE account_email_id = $1 AND purpose = 'password_reset'
             AND consumed_at IS NULL AND superseded_at IS NULL`,
          [email.accountEmailId],
        );
        const pidIssuer = await backendPid(issuer);
        const pidConsumer = await backendPid(consumer);
        pending = consumer.query(
          `SELECT account_email_id FROM _auth_consume_email_token($1, 'password_reset')`,
          [th],
        );
        await waitUntilBlockedByHolder(ctx.owner, pidIssuer, pidConsumer);
        await issuer.query("COMMIT");
        expect((await pending).rows).toHaveLength(0); // consume lost
      } finally {
        await issuer.query("ROLLBACK").catch(() => {});
        issuer.release();
        if (pending) await pending.catch(() => {});
        consumer.release();
      }
      const final = await ctx.owner.query(
        `SELECT consumed_at, superseded_at FROM auth_email_tokens WHERE token_hash = $1`,
        [th],
      );
      const row = final.rows[0] as { consumed_at: string | null; superseded_at: string | null };
      expect(row.superseded_at).not.toBeNull();
      expect(row.consumed_at).toBeNull(); // superseded XOR consumed — never both
    }

    // (B) consume commits first -> reset-issue's supersede finds nothing active, zero mutation on that token.
    {
      const email = await seedEmail({ verified: true });
      const th = await seedResetToken(email.accountEmailId);
      const consumer = await ctx.superuserDb.pool.connect();
      const issuer = await ctx.superuserDb.pool.connect();
      let pending: Promise<pg.QueryResult> | undefined;
      try {
        await consumer.query("BEGIN");
        const consumed = await consumeAs(consumer, th, "password_reset"); // holds accounts + token lock
        expect(consumed).toHaveLength(1);
        const pidConsumer = await backendPid(consumer);
        const pidIssuer = await backendPid(issuer);
        // issuer follows the SAME parent-first order: it takes the accounts
        // parent FIRST (an explicit statement, not an unreferenced locking CTE
        // — Postgres would prune that), so it blocks on the consumer's lock.
        await issuer.query("BEGIN");
        pending = issuer.query(`SELECT 1 FROM accounts WHERE id = $1 FOR UPDATE`, [
          email.accountId,
        ]);
        await waitUntilBlockedByHolder(ctx.owner, pidConsumer, pidIssuer);
        await consumer.query("COMMIT");
        await pending; // issuer now holds accounts
        // ...then supersedes active reset tokens — the token is already consumed, so zero rows.
        await issuer.query(`SELECT 1 FROM account_emails WHERE id = $1 FOR UPDATE`, [
          email.accountEmailId,
        ]);
        const sup = await issuer.query(
          `UPDATE auth_email_tokens SET superseded_at = now()
           WHERE account_email_id = $1 AND purpose = 'password_reset'
             AND consumed_at IS NULL AND superseded_at IS NULL`,
          [email.accountEmailId],
        );
        expect(sup.rowCount).toBe(0); // nothing left active to supersede
        await issuer.query("COMMIT");
      } finally {
        await consumer.query("ROLLBACK").catch(() => {});
        consumer.release();
        if (pending) await pending.catch(() => {});
        await issuer.query("ROLLBACK").catch(() => {});
        issuer.release();
      }
      const final = await ctx.owner.query(
        `SELECT consumed_at, superseded_at FROM auth_email_tokens WHERE token_hash = $1`,
        [th],
      );
      const row = final.rows[0] as { consumed_at: string | null; superseded_at: string | null };
      expect(row.consumed_at).not.toBeNull();
      expect(row.superseded_at).toBeNull();
    }
  });

  it("D1E-18 (PARTIAL, order-4 deferred): the email-token consume (production) is parent-first and composes with a §5.2-step-5-ordered peer without inversion", async () => {
    // SCOPE HONESTY (codex round-02 [P1]): the REAL account-issued link_code
    // consume + durable merge-plan lifecycle is ORDER-4 and is EXPLICITLY out of
    // this slice (manifest negative_scope; link_codes has no source_account_id
    // yet). This test therefore exercises the PRODUCTION email-token consume
    // (`_auth_consume_email_token`) on one side and SIMULATES the peer's
    // §5.2-step-5 lock order on the other (a channel-issued link_codes row stood
    // in as the peer's child tier). It proves the property THIS slice owns — the
    // email-token consume takes `accounts` BEFORE any child, so it can never be
    // the side that inverts. The full merge barrier (the real account-issued
    // consume creating a merge plan, racing the email-token consume, both
    // all-or-nothing) lands with the serialized identity companion slice; D1E-18
    // stays OPEN until then (see the READY report's deferred-coverage note).
    // (A) peer holds accounts+link_code; email consume blocks on accounts, then proceeds.
    {
      const email = await seedEmail({ verified: true });
      const th = await seedResetToken(email.accountEmailId);
      const linkCodeId = await seedLinkCode(email.personId);
      const linkPath = await ctx.superuserDb.pool.connect();
      const consumer = await ctx.superuserDb.pool.connect();
      let pending: Promise<pg.QueryResult> | undefined;
      try {
        await linkPath.query("BEGIN");
        await linkPath.query(`SELECT 1 FROM accounts WHERE id = $1 FOR UPDATE`, [email.accountId]);
        await linkPath.query(`SELECT 1 FROM link_codes WHERE id = $1 FOR UPDATE`, [linkCodeId]);
        const pidLink = await backendPid(linkPath);
        const pidConsumer = await backendPid(consumer);
        pending = consumer.query(
          `SELECT account_email_id FROM _auth_consume_email_token($1, 'password_reset')`,
          [th],
        );
        await waitUntilBlockedByHolder(ctx.owner, pidLink, pidConsumer);
        await linkPath.query("COMMIT");
        expect((await pending).rows).toHaveLength(1); // consume proceeds after accounts released
      } finally {
        await linkPath.query("ROLLBACK").catch(() => {});
        linkPath.release();
        if (pending) await pending.catch(() => {});
        consumer.release();
      }
    }
    // (B) reverse order: email consume holds accounts; link_code path blocks on accounts (no inversion).
    {
      const email = await seedEmail({ verified: true });
      const th = await seedResetToken(email.accountEmailId);
      const linkCodeId = await seedLinkCode(email.personId);
      const consumer = await ctx.superuserDb.pool.connect();
      const linkPath = await ctx.superuserDb.pool.connect();
      let pending: Promise<pg.QueryResult> | undefined;
      try {
        await consumer.query("BEGIN");
        expect(await consumeAs(consumer, th, "password_reset")).toHaveLength(1); // holds accounts
        const pidConsumer = await backendPid(consumer);
        const pidLink = await backendPid(linkPath);
        // link_code path takes the accounts parent FIRST (explicit statement,
        // not a prunable locking CTE), so it blocks on the consumer's lock —
        // proving both descend from accounts before any child (no inversion).
        await linkPath.query("BEGIN");
        pending = linkPath.query(`SELECT 1 FROM accounts WHERE id = $1 FOR UPDATE`, [
          email.accountId,
        ]);
        await waitUntilBlockedByHolder(ctx.owner, pidConsumer, pidLink);
        await consumer.query("COMMIT");
        await pending; // link path acquires accounts…
        await linkPath.query(`SELECT 1 FROM link_codes WHERE id = $1 FOR UPDATE`, [linkCodeId]); // …then its child
        await linkPath.query("COMMIT"); // no deadlock
      } finally {
        await consumer.query("ROLLBACK").catch(() => {});
        consumer.release();
        if (pending) await pending.catch(() => {});
        await linkPath.query("ROLLBACK").catch(() => {});
        linkPath.release();
      }
    }
  });

  it("D1E-16: the cleanup sweep is PARENT-FIRST — it takes the accounts parent before terminalizing an attempt (codex round-01 [P1])", async () => {
    // an expired active attempt puts this email in the sweep's scope.
    const email = await seedEmail({ verified: false });
    const attempt = await seedAttempt(email.accountEmailId, { expiresInSec: -60 });
    const holder = await ctx.superuserDb.pool.connect();
    const cleaner = await ctx.superuserDb.pool.connect();
    let pending: Promise<pg.QueryResult> | undefined;
    try {
      // Hold the accounts parent. On a child-first sweep the bulk attempt UPDATE
      // would proceed WITHOUT this lock (never blocking); the parent-first sweep
      // must block here.
      await holder.query("BEGIN");
      await holder.query(`SELECT 1 FROM accounts WHERE id = $1 FOR UPDATE`, [email.accountId]);
      const pidHolder = await backendPid(holder);
      const pidCleaner = await backendPid(cleaner);
      pending = cleaner.query(`SELECT _auth_email_attempt_terminalize()`);
      await waitUntilBlockedByHolder(ctx.owner, pidHolder, pidCleaner);
      await holder.query("COMMIT");
      await pending; // sweep completes once the parent is released
    } finally {
      await holder.query("ROLLBACK").catch(() => {});
      holder.release();
      if (pending) await pending.catch(() => {});
      cleaner.release();
    }
    // the expired attempt is now terminalized with its candidates NULLed
    const row = await ctx.owner.query(
      `SELECT superseded_at, password_phc, registration_key_hash
       FROM auth_pending_email_registrations WHERE id = $1`,
      [attempt],
    );
    const r = row.rows[0] as {
      superseded_at: string | null;
      password_phc: string | null;
      registration_key_hash: string | null;
    };
    expect(r.superseded_at).not.toBeNull();
    expect(r.password_phc).toBeNull();
    expect(r.registration_key_hash).toBeNull();
  });
});

describe("D1 delivery binding + cleanup (D1E-19..D1E-20)", () => {
  const insertDelivery = (cols: Record<string, unknown>) => {
    const base: Record<string, unknown> = {
      kind: "verify_email",
      command_id: randomUUID(),
      command_owner_hash: `owner-${randomBytes(4).toString("hex")}`,
      command_operation: "register",
      command_target_fingerprint: `fp-${randomBytes(4).toString("hex")}`,
      provider_idempotency_key: `pik-${randomBytes(8).toString("hex")}`,
      provider_key_version: "pk-v1",
      outcome: "queued",
      expires_at: new Date(Date.now() + 86400e3),
      payload_enc: Buffer.from([0]),
      kms_key_version: "kms-v1",
      ...cols,
    };
    const keys = Object.keys(base);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
    return ctx.owner.query(
      `INSERT INTO auth_email_deliveries(${keys.join(", ")}) VALUES (${placeholders})`,
      keys.map((k) => base[k]),
    );
  };

  it("D1E-19: command receipt ≠ provider key; operation↔kind and terminal/payload CHECKs", async () => {
    const sharedCommandId = randomUUID();
    const sharedPik = `pik-shared-${randomBytes(6).toString("hex")}`;
    await insertDelivery({ command_id: sharedCommandId, provider_idempotency_key: sharedPik });
    // command_id UNIQUE
    await expect(insertDelivery({ command_id: sharedCommandId })).rejects.toThrow(
      /command_id|unique/i,
    );
    // provider_idempotency_key UNIQUE and independent of command_id
    await expect(insertDelivery({ provider_idempotency_key: sharedPik })).rejects.toThrow(
      /provider_idempotency_key|unique/i,
    );
    // operation ↔ kind
    await expect(
      insertDelivery({ command_operation: "register", kind: "password_reset" }),
    ).rejects.toThrow(/operation_kind_chk/);
    await expect(
      insertDelivery({ command_operation: "forgot", kind: "verify_email" }),
    ).rejects.toThrow(/operation_kind_chk/);
    // terminal ⇒ terminal_at (delivered without it -> reject; queued WITH it -> reject)
    await expect(
      insertDelivery({ outcome: "delivered", payload_enc: null, kms_key_version: null }),
    ).rejects.toThrow(/terminal_chk/);
    await expect(insertDelivery({ outcome: "queued", terminal_at: new Date() })).rejects.toThrow(
      /terminal_chk/,
    );
    // payload/key present only for queued|dead_letter
    await expect(
      insertDelivery({ outcome: "queued", payload_enc: null, kms_key_version: null }),
    ).rejects.toThrow(/payload_chk/);
    await expect(
      insertDelivery({
        outcome: "delivered",
        terminal_at: new Date(),
        payload_enc: Buffer.from([0]),
        kms_key_version: "kms-v1",
      }),
    ).rejects.toThrow(/payload_chk/);
    // a valid terminal-delivered row (payload/key NULLed) is accepted.
    await insertDelivery({
      outcome: "delivered",
      terminal_at: new Date(),
      payload_enc: null,
      kms_key_version: null,
      command_operation: "forgot",
      kind: "password_reset",
    });
  });

  it("D1E-20: cleanup terminalizes expired candidates, batch-deletes past-retention rows, and guards pending-email deletion", async () => {
    // expired ACTIVE attempt -> should be superseded + candidates NULLed immediately
    const pending = await seedEmail({ verified: false });
    const expiredAttempt = await seedAttempt(pending.accountEmailId, {
      expiresInSec: -60,
      regKeyHash: "rk-exp",
    });
    // expired QUEUED delivery -> should become failed_terminal + ciphertext NULLed
    await insertDelivery({
      command_operation: "register",
      kind: "verify_email",
      outcome: "queued",
      expires_at: new Date(Date.now() - 60e3),
    });
    // past-retention terminal rows (31d) -> should be batch-deleted
    const retEmail = await seedEmail({ verified: true });
    await ctx.owner.query(
      `INSERT INTO auth_email_tokens(account_email_id, purpose, token_hash, expires_at, superseded_at)
       VALUES ($1, 'password_reset', 'ret-token', now() - interval '31 days', now() - interval '31 days')`,
      [retEmail.accountEmailId],
    );
    await ctx.owner.query(
      `INSERT INTO auth_email_deliveries(kind, command_id, command_owner_hash, command_operation,
         command_target_fingerprint, provider_idempotency_key, provider_key_version, outcome, expires_at,
         terminal_at, payload_enc, kms_key_version)
       VALUES ('verify_email', $1, 'o', 'register', 'f', $2, 'pk', 'failed_terminal',
               now() - interval '31 days', now() - interval '31 days', NULL, NULL)`,
      [randomUUID(), `pik-ret-${randomBytes(4).toString("hex")}`],
    );
    // a pending email with NO active attempt (all superseded) + past pending_expires -> deletable
    const orphan = await seedEmail({ verified: false, pendingExpiresInSec: -60 });
    const orphanAttempt = await seedAttempt(orphan.accountEmailId, { regKeyHash: "rk-orphan" });
    await ctx.owner.query(
      `UPDATE auth_pending_email_registrations
       SET superseded_at = now(), password_phc = NULL, registration_key_hash = NULL WHERE id = $1`,
      [orphanAttempt],
    );

    // the sweep is now five single-concern, deadlock-free functions (codex
    // round-03/04); the order-4 job calls them bottom-up so children drain
    // before parents.
    const scalar = async (fn: string) =>
      Number((await ctx.owner.query(`SELECT ${fn}() AS n`)).rows[0].n);
    const del = (await ctx.owner.query(`SELECT * FROM _auth_email_delivery_cleanup()`))
      .rows[0] as Record<string, number>;
    const terminalized = await scalar("_auth_email_attempt_terminalize");
    const tokensDeleted = await scalar("_auth_email_token_retention");
    const attemptsDeleted = await scalar("_auth_email_attempt_retention");
    const emailsDeleted = await scalar("_auth_email_orphan_cleanup");
    expect(terminalized).toBeGreaterThanOrEqual(1);
    expect(del.deliveries_terminalized).toBeGreaterThanOrEqual(1);
    expect(tokensDeleted).toBeGreaterThanOrEqual(1);
    expect(attemptsDeleted).toBeGreaterThanOrEqual(0); // runs cleanly (no retention-terminal attempt seeded)
    expect(del.deliveries_deleted).toBeGreaterThanOrEqual(1);
    expect(emailsDeleted).toBeGreaterThanOrEqual(1);

    // expired attempt is now terminal with candidates NULLed immediately
    const term = await ctx.owner.query(
      `SELECT superseded_at, password_phc, registration_key_hash FROM auth_pending_email_registrations WHERE id = $1`,
      [expiredAttempt],
    );
    const tr = term.rows[0] as {
      superseded_at: string | null;
      password_phc: string | null;
      registration_key_hash: string | null;
    };
    expect(tr.superseded_at).not.toBeNull();
    expect(tr.password_phc).toBeNull();
    expect(tr.registration_key_hash).toBeNull();
    // past-retention token is gone
    expect(
      (await ctx.owner.query(`SELECT 1 FROM auth_email_tokens WHERE token_hash = 'ret-token'`))
        .rows,
    ).toHaveLength(0);
    // orphan pending email deleted, but its ACCOUNT and PERSON are untouched (no cascade into business tables)
    expect(
      (await ctx.owner.query(`SELECT 1 FROM account_emails WHERE id = $1`, [orphan.accountEmailId]))
        .rows,
    ).toHaveLength(0);
    expect(
      (await ctx.owner.query(`SELECT 1 FROM accounts WHERE id = $1`, [orphan.accountId])).rows,
    ).toHaveLength(1);
    expect(
      (await ctx.owner.query(`SELECT 1 FROM persons WHERE id = $1`, [orphan.personId])).rows,
    ).toHaveLength(1);
  });
});

describe("D1 schema mirror + catalog (D1E-21)", () => {
  it("D1E-21: constraint triggers, partial indexes, and helper grant-denials exist in the catalog (not just column shape)", async () => {
    // constraint triggers on BOTH write paths + the verified-email gate
    const triggers = await ctx.owner.query(
      `SELECT tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       WHERE NOT t.tgisinternal AND c.relname IN ('auth_pending_email_registrations','email_password_credentials')`,
    );
    const tgnames = (triggers.rows as { tgname: string }[]).map((r) => r.tgname);
    for (const tg of [
      "auth_pending_email_registrations_phc_trg",
      "email_password_credentials_phc_trg",
      "email_password_credentials_verified_trg",
    ]) {
      expect(tgnames, `trigger ${tg} must exist`).toContain(tg);
    }

    // the two partial UNIQUE indexes, WITH their partial predicate (not a plain unique)
    const idx = await ctx.owner.query(
      `SELECT indexname, indexdef FROM pg_indexes
       WHERE tablename = 'auth_email_tokens' AND indexname = ANY($1)`,
      [
        [
          "auth_email_tokens_one_active_verify_per_attempt_uq",
          "auth_email_tokens_one_active_reset_uq",
        ],
      ],
    );
    const defs = new Map(
      (idx.rows as { indexname: string; indexdef: string }[]).map((r) => [r.indexname, r.indexdef]),
    );
    expect(defs.get("auth_email_tokens_one_active_verify_per_attempt_uq")).toMatch(/UNIQUE/);
    expect(defs.get("auth_email_tokens_one_active_verify_per_attempt_uq")).toMatch(
      /WHERE .*verify_email/,
    );
    expect(defs.get("auth_email_tokens_one_active_reset_uq")).toMatch(/WHERE .*password_reset/);

    // grants: `app` has NO EXECUTE on ANY internal helper (validator, consume,
    // and every cleanup function).
    for (const sig of [
      "_auth_assert_password_phc(text)",
      "_auth_consume_email_token(text,text)",
      "_auth_email_delivery_cleanup(integer)",
      "_auth_email_attempt_terminalize(integer)",
      "_auth_email_token_retention(integer)",
      "_auth_email_attempt_retention(integer)",
      "_auth_email_orphan_cleanup(integer)",
    ]) {
      const r = await ctx.owner.query(
        `SELECT has_function_privilege('app', $1, 'EXECUTE') AS granted`,
        [sig],
      );
      expect((r.rows[0] as { granted: boolean }).granted, `app must NOT execute ${sig}`).toBe(
        false,
      );
    }
  });
});

describe("D1 no secret leakage (D1E-22)", () => {
  it("D1E-22: helpers never echo raw email/token/password/PHC/salt in errors or returns", async () => {
    const marker = "SUPERSECRETdoNOTleak";
    // PHC validator error must be generic — never the raw input
    let phcMsg = "";
    try {
      await ctx.owner.query(`SELECT _auth_assert_password_phc($1)`, [`plaintext-${marker}`]);
    } catch (e) {
      phcMsg = String((e as Error).message);
    }
    expect(phcMsg).toMatch(/password PHC: malformed/);
    expect(phcMsg).not.toContain(marker);

    // consume of an unknown token reveals nothing (empty set, no error carrying the hash)
    const res = await ctx.owner.query(
      `SELECT * FROM _auth_consume_email_token($1, 'password_reset')`,
      [`tok-${marker}`],
    );
    expect(res.rows).toEqual([]);

    // this slice's helpers write NO auth_audit_events rows (auditing is order-4); prove none leaked
    const audit = await ctx.owner.query(
      `SELECT count(*)::int AS n FROM auth_audit_events WHERE request_ref LIKE '%' || $1 || '%'`,
      [marker],
    );
    expect((audit.rows[0] as { n: number }).n).toBe(0);
  });
});

describe("deriveEmailArtifacts + provider key (auth.ts, B0 §3.3/§3.4)", () => {
  const keys = {
    lookupHmacKey: Buffer.from("lookup-hmac-key-fixture-0000000000", "utf8"),
    encKey: Buffer.alloc(32, 7),
    kmsKeyVersion: "kms-v1",
  };

  it("normalizeEmail: lowercases the domain (IDNA), NFC-normalizes + preserves local-part case, rejects invalid", () => {
    expect(normalizeEmail("  User.Name@Example.COM ")).toBe("User.Name@example.com");
    // no Gmail dot/plus folding — local part is preserved verbatim (NFC only)
    expect(normalizeEmail("a.b+tag@gmail.com")).toBe("a.b+tag@gmail.com");
    // a valid IDN domain still converts to its A-label
    expect(normalizeEmail("user@münchen.de")).toBe("user@xn--mnchen-3ya.de");
    for (const bad of [
      "",
      "no-at",
      "@nodomain.com",
      "local@",
      "two@@at.com",
      "has space@x.com",
      "local@nodot",
      // domainToASCII would TRUNCATE these at the URL delimiter and bind mail to
      // a different real address — they must be rejected, not silently accepted
      // (codex round-01 [P1]).
      "u@good.example#evil.com",
      "u@good.example/evil.com",
      "u@good.example?evil.com",
      "u@good.example\\evil.com",
      "u@good.example:25",
      "u@[192.168.0.1]",
      // invalid local parts that providers reject (codex round-02 [P2])
      ".user@example.com",
      "user.@example.com",
      "user..name@example.com",
      `${"x".repeat(65)}@example.com`, // local part > 64 octets
      // unsupported mailbox syntax rejected by the allowlist grammar + the
      // whole-mailbox 254-octet cap (codex round-03 [P2])
      "a,b@example.com",
      "a(b)@example.com",
      "a<b>@example.com",
      'a"b@example.com',
      "a;b@example.com",
      // domainToASCII percent-DECODES, so "%2E" would collapse onto a real
      // address ("good.example.com") — reject percent escapes (codex round-04 [P2])
      "user@good%2Eexample.com",
      "user@good%2eexample.com",
      // domainToASCII normalizes IPv4 shorthand/integer to a dotted IP that would
      // otherwise pass the hostname regex — reject IP-address results (codex round-06 [P2])
      "user@2130706433",
      "user@127.1",
      "user@0x7f.1",
      "user@127.0.0.1",
      // 64-octet local + a valid domain whose labels push the total past 254
      `${"x".repeat(64)}@${`${"a".repeat(60)}.`.repeat(3)}aaa.example`,
    ]) {
      expect(() => normalizeEmail(bad), `must reject ${JSON.stringify(bad)}`).toThrow(
        InvalidEmailError,
      );
    }
    // the truncation attack must NOT resolve to the legitimate prefix
    expect(() => normalizeEmail("u@good.example#evil.com")).toThrow();
    // a normal address well within limits still passes
    expect(normalizeEmail("first.last+tag@sub.example.co.uk")).toBe(
      "first.last+tag@sub.example.co.uk",
    );
  });

  it("deriveEmailArtifacts: deterministic lookup hash; ciphertext round-trips under the bound AAD", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const a = deriveEmailArtifacts("Alice@Example.com", id, keys);
    const b = deriveEmailArtifacts("  alice@example.COM  ", id, keys);
    // canonical + lookup hash are deterministic across equivalent raw inputs
    // (domain case-folds; local-part case is preserved so these two differ on case).
    expect(a.canonicalEmail).toBe("Alice@example.com");
    expect(b.canonicalEmail).toBe("alice@example.com");
    expect(a.emailLookupHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.emailLookupHash).not.toBe(b.emailLookupHash); // case-sensitive local part
    // same input twice -> identical lookup hash (deterministic), different ciphertext (random iv)
    const a2 = deriveEmailArtifacts("Alice@Example.com", id, keys);
    expect(a2.emailLookupHash).toBe(a.emailLookupHash);
    expect(a2.emailEnc.equals(a.emailEnc)).toBe(false);
    // round-trip decrypt under the exact AAD
    expect(decryptEmailEnc(a.emailEnc, id, a.emailLookupHash, keys)).toBe("Alice@example.com");
    // AAD tamper (wrong id) fails the auth tag
    expect(() =>
      decryptEmailEnc(a.emailEnc, "22222222-2222-4222-8222-222222222222", a.emailLookupHash, keys),
    ).toThrow();
  });

  it("decryptEmailEnc: rejects a row whose ciphertext decrypts to a DIFFERENT address than its lookup hash (§3.3, codex round-01 [P2])", () => {
    const id = "44444444-4444-4444-8444-444444444444";
    // reproduce the two derivations the §3.3 boundary relies on
    const lookupHashOf = (canonical: string) =>
      createHmac("sha256", keys.lookupHmacKey)
        .update("plexco:account-email:v1:" + canonical, "utf8")
        .digest("hex");
    const aadOf = (lookupHash: string) =>
      Buffer.from(`plexco:account-email-aad:v1:${id}:${lookupHash}:${keys.kmsKeyVersion}`, "utf8");

    // craft a malicious row: ciphertext of attacker@evil.com, but AAD + stored
    // lookup hash of victim@good.com — GCM still authenticates (the hash is part
    // of the AAD) yet the decrypted identity does not match the stored hash.
    const victimHash = lookupHashOf("victim@good.com");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", keys.encKey, iv);
    cipher.setAAD(aadOf(victimHash));
    const ct = Buffer.concat([cipher.update("attacker@evil.com", "utf8"), cipher.final()]);
    const crafted = Buffer.concat([iv, cipher.getAuthTag(), ct]);

    expect(() => decryptEmailEnc(crafted, id, victimHash, keys)).toThrow(
      /does not match its lookup hash/,
    );

    // a correctly-derived row still round-trips
    const good = deriveEmailArtifacts("victim@good.com", id, keys);
    expect(decryptEmailEnc(good.emailEnc, id, good.emailLookupHash, keys)).toBe("victim@good.com");
  });

  it("UUID id is canonicalized into the AAD — an uppercase spelling still decrypts under the Postgres-canonical lowercase (codex round-06 [P2])", () => {
    const upper = "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE";
    const lower = upper.toLowerCase();
    // encrypt with the uppercase spelling the caller might pass...
    const art = deriveEmailArtifacts("Person@example.com", upper, keys);
    // ...and decrypt under the lowercase form Postgres renders — same AAD, so it works.
    expect(decryptEmailEnc(art.emailEnc, lower, art.emailLookupHash, keys)).toBe(
      "Person@example.com",
    );
    // a non-UUID id is rejected outright (never silently bound into the AAD)
    expect(() => deriveEmailArtifacts("Person@example.com", "not-a-uuid", keys)).toThrow(/UUID/);
  });

  it("deriveProviderIdempotencyKey: derived from delivery id+kind, NOT the command receipt; domain-separated", () => {
    const key = {
      providerSendKey: Buffer.from("provider-send-key-fixture", "utf8"),
      keyVersion: "pk-v1",
    };
    const id = "33333333-3333-4333-8333-333333333333";
    const k1 = deriveProviderIdempotencyKey({ deliveryId: id, kind: "verify_email" }, key);
    const k2 = deriveProviderIdempotencyKey({ deliveryId: id, kind: "verify_email" }, key);
    const k3 = deriveProviderIdempotencyKey({ deliveryId: id, kind: "password_reset" }, key);
    expect(k1).toBe(k2); // deterministic per (delivery id, kind)
    expect(k1).not.toBe(k3); // kind is part of the key
    expect(k1).toMatch(/^[A-Za-z0-9_-]+$/); // base64url
  });
});

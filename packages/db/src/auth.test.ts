import { createHash, randomBytes } from "node:crypto";
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
    await ctx.owner.query(`INSERT INTO onboarding_runs (tenant_id, status) VALUES ($1, 'completed')`, [
      ctx.tenantA,
    ]);
    // inserted AFTER A's row: the globally-latest row belongs to tenant B.
    await ctx.owner.query(`INSERT INTO onboarding_runs (tenant_id, status) VALUES ($1, 'abandoned')`, [
      ctx.tenantB,
    ]);

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

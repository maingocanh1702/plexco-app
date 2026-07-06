import type pg from "pg";

/**
 * Auth/identity service — typed wrappers over the 0012 SECURITY DEFINER
 * functions. This is the ONLY doorway to the protected global tables
 * (persons/accounts/web_sessions/account_identities); the `app` role holds
 * EXECUTE on these functions and nothing else (0009/0012).
 * All token parameters are HASHES — raw session tokens never reach SQL.
 */

export interface LoginResult {
  accountId: string;
  personId: string;
  created: boolean;
}

export interface ResolvedSession {
  sessionId: string;
  accountId: string;
  personId: string;
  csrfSecret: string;
  expiresAt: Date;
}

export class LoginReplayError extends Error {
  constructor() {
    super("telegram login payload already used");
  }
}

export class SlugTakenError extends Error {
  constructor() {
    super("tenant slug already taken by another owner");
  }
}

export async function loginTelegram(
  pool: pg.Pool,
  input: { platformUserHash: string; displayName: string | null; loginHash: string },
): Promise<LoginResult> {
  try {
    const { rows } = await pool.query(
      `SELECT account_id, person_id, created FROM auth_login_telegram($1, $2, $3)`,
      [input.platformUserHash, input.displayName, input.loginHash],
    );
    const r = rows[0] as { account_id: string; person_id: string; created: boolean };
    return { accountId: r.account_id, personId: r.person_id, created: r.created };
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new LoginReplayError();
    throw error;
  }
}

/**
 * Login-state CSRF binding (DD-31 SI-1). `stateHash` is sha256(raw token) —
 * the raw token lives only in the pre-auth cookie, never here. Plain hash is
 * fine: the raw token is high-entropy random, not a low-entropy enumerable
 * id (that constraint applies to SI-2's platform-hash, not this).
 */
export async function issueLoginState(
  pool: pg.Pool,
  input: { stateHash: string; ttlSeconds: number },
): Promise<void> {
  await pool.query(`SELECT auth_login_state_issue($1, make_interval(secs => $2))`, [
    input.stateHash,
    input.ttlSeconds,
  ]);
}

/** true = the state existed, was unexpired and unconsumed, and is now consumed. */
export async function consumeLoginState(pool: pg.Pool, stateHash: string): Promise<boolean> {
  const { rows } = await pool.query(`SELECT auth_login_state_consume($1) AS ok`, [stateHash]);
  return Boolean((rows[0] as { ok: boolean | null }).ok);
}

export async function createWebSession(
  pool: pg.Pool,
  input: { accountId: string; tokenHash: string; csrfSecret: string; ttlSeconds: number },
): Promise<string> {
  const { rows } = await pool.query(
    `SELECT auth_create_web_session($1, $2, $3, make_interval(secs => $4)) AS id`,
    [input.accountId, input.tokenHash, input.csrfSecret, input.ttlSeconds],
  );
  return (rows[0] as { id: string }).id;
}

export async function resolveWebSession(
  pool: pg.Pool,
  tokenHash: string,
): Promise<ResolvedSession | null> {
  const { rows } = await pool.query(
    `SELECT session_id, account_id, person_id, csrf_secret, expires_at
     FROM auth_resolve_web_session($1)`,
    [tokenHash],
  );
  if (rows.length === 0) return null;
  const r = rows[0] as {
    session_id: string;
    account_id: string;
    person_id: string;
    csrf_secret: string;
    expires_at: Date;
  };
  return {
    sessionId: r.session_id,
    accountId: r.account_id,
    personId: r.person_id,
    csrfSecret: r.csrf_secret,
    expiresAt: r.expires_at,
  };
}

/** Revoke old + mint linked replacement; null when the old session is gone. */
export async function rotateWebSession(
  pool: pg.Pool,
  input: {
    oldTokenHash: string;
    newTokenHash: string;
    newCsrfSecret: string;
    ttlSeconds: number;
    /** the account the user JUST authenticated as — the new session binds here */
    accountId: string;
  },
): Promise<string | null> {
  const { rows } = await pool.query(
    `SELECT auth_rotate_web_session($1, $2, $3, make_interval(secs => $4), $5) AS id`,
    [
      input.oldTokenHash,
      input.newTokenHash,
      input.newCsrfSecret,
      input.ttlSeconds,
      input.accountId,
    ],
  );
  return (rows[0] as { id: string | null }).id;
}

export async function revokeWebSession(pool: pg.Pool, tokenHash: string): Promise<boolean> {
  const { rows } = await pool.query(`SELECT auth_revoke_web_session($1) AS ok`, [tokenHash]);
  return Boolean((rows[0] as { ok: boolean | null }).ok);
}

export async function provisionTenant(
  pool: pg.Pool,
  input: { slug: string; name: string; timezone?: string; locale?: string; personId: string },
): Promise<string> {
  try {
    const { rows } = await pool.query(`SELECT tenant_provision($1, $2, $3, $4, $5) AS id`, [
      input.slug,
      input.name,
      input.timezone ?? null,
      input.locale ?? null,
      input.personId,
    ]);
    return (rows[0] as { id: string }).id;
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new SlugTakenError();
    throw error;
  }
}

export interface OnboardingSnapshot {
  runStatus: string;
  steps: { step: string; status: string }[];
}

/**
 * Latest onboarding run + step statuses. Scoped by withTenant/RLS AND an
 * explicit tenant_id predicate — belt-and-suspenders (DD-31 SI-3), so a
 * privileged or misconfigured connection can never fall back to the newest
 * run globally.
 */
export async function onboardingSnapshot(
  db: import("./client.js").Db,
  tenantId: string,
): Promise<OnboardingSnapshot | null> {
  const { withTenant } = await import("./tenant.js");
  const { sql } = await import("drizzle-orm");
  const rows = await withTenant(db, tenantId, async (tx) => {
    const result = await tx.execute(sql`
      WITH latest AS (
        SELECT id, status FROM onboarding_runs
        WHERE tenant_id = ${tenantId}
        ORDER BY created_at DESC
        LIMIT 1
      ),
      latest_steps AS (
        -- retries legitimately leave multiple rows per step (unique on
        -- run_id/step/idempotency_key) — keep only the MOST RECENT per step.
        -- Ordered by seq (bigserial), NOT created_at (codex round-11):
        -- Postgres now() is transaction-stable and migration 0013 backfilled
        -- every pre-existing row with one shared value, so created_at alone
        -- can tie with no deterministic winner; seq is a sequence allocation
        -- and is always strictly monotonic regardless of transaction timing.
        SELECT DISTINCT ON (s.step) s.step, s.status
        FROM onboarding_steps s
        WHERE s.run_id = (SELECT id FROM latest)
        ORDER BY s.step, s.seq DESC
      )
      SELECT latest.status AS run_status, latest_steps.step, latest_steps.status AS step_status
      FROM latest
      LEFT JOIN latest_steps ON true
    `);
    return result.rows as { run_status: string; step: string | null; step_status: string | null }[];
  });
  if (rows.length === 0) return null;
  return {
    runStatus: rows[0]!.run_status,
    steps: rows
      .filter((r) => r.step !== null)
      .map((r) => ({ step: r.step!, status: r.step_status ?? "not_configured" })),
  };
}

export async function tenantsForPerson(
  pool: pg.Pool,
  personId: string,
): Promise<{ tenantId: string; role: string }[]> {
  const { rows } = await pool.query(`SELECT tenant_id, role FROM tenant_ids_for_person($1)`, [
    personId,
  ]);
  return rows.map((r: { tenant_id: string; role: string }) => ({
    tenantId: r.tenant_id,
    role: r.role,
  }));
}

/** Shared sliding-window limiter (all replicas hit one store). true = allowed. */
export async function rateLimitCheck(
  pool: pg.Pool,
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT rate_limit_check($1, $2, make_interval(secs => $3)) AS allowed`,
    [bucket, limit, windowSeconds],
  );
  return Boolean((rows[0] as { allowed: boolean }).allowed);
}

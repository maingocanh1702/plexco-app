import { createHash, randomBytes } from "node:crypto";
import { createDb, createWebSession, migrate, type DbHandle } from "@plexco/db";
import { cookies } from "next/headers";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  leaseTestRolePasswords,
  ROLE_PW,
  withDefinerReadLock,
  type TestRolePasswordLease,
} from "../../../../../../packages/db/src/test-harness.js";
import { appDb, SESSION_COOKIE } from "../../../../lib/session-cookies";
import { POST } from "./route";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

/**
 * Real-Postgres boundary suite for POST /api/auth/logout-all. Unlike the
 * single-session logout test (which mocks the wrapper), logout-all must be
 * proven end-to-end against the real `revokeAllWebSessions` DB wrapper so
 * D0-3 ("all sessions revoked") and D0-4 ("zero mutation on replay") are
 * asserted from actual row/epoch state, not a spy.
 *
 * setupRlsTestContext lives in packages/db and is neither exported nor
 * modifiable by this slice, so the web boundary provisions its own minimal
 * throwaway database from the SAME DATABASE_URL_TEST superuser url — a unique
 * db name that can never collide with the packages/db suites' own DROP/CREATE.
 */
const DB_NAME = "plexco_web_logout_all_check";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

function testUrl(base: string, opts: { db?: string; user?: string; password?: string }): string {
  const url = new URL(base);
  if (opts.db) url.pathname = `/${opts.db}`;
  if (opts.user) {
    url.username = opts.user;
    url.password = opts.password ?? "";
  }
  return url.toString();
}

let admin: DbHandle; // superuser INTO the base db — DROP/CREATE the throwaway
let owner: DbHandle; // superuser INTO the throwaway db — seeds + assertions
let originalDatabaseUrl: string | undefined;
let passwords: TestRolePasswordLease | undefined;

beforeAll(async () => {
  const base = process.env.DATABASE_URL_TEST;
  if (!base) {
    throw new Error(
      "DATABASE_URL_TEST is required for the logout-all boundary suite (locally: " +
        "docker compose -f infra/docker-compose.yml up -d postgres and export " +
        "DATABASE_URL_TEST=postgres://plexco:plexco_dev@localhost:5432/plexco_test)",
    );
  }

  admin = createDb(base, { max: 2 });
  await admin.pool.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
  await admin.pool.query(`CREATE DATABASE ${DB_NAME}`);

  const migrationUrl = testUrl(base, { db: DB_NAME });
  // The reader side of every definer lock this migrate() reaches, like setupRlsTestContext.
  await withDefinerReadLock(base, () => migrate(migrationUrl));
  // 0000 created the app role; its test password is leased until afterAll.
  passwords = await leaseTestRolePasswords(base);

  owner = createDb(migrationUrl, { max: 2 });

  // The route's appDb() reads DATABASE_URL and memoises a singleton — point it
  // at the throwaway db AS the app role BEFORE the route first calls appDb().
  originalDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = testUrl(base, { db: DB_NAME, user: "app", password: ROLE_PW.app });
  vi.stubEnv("DB_EXPECTED_ROLE", "app");
}, 120_000);

afterAll(async () => {
  await appDb()
    .close()
    .catch(() => {});
  await passwords?.release(); // after the only pool that logs in as app closed
  await owner?.close();
  await admin?.close();
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  vi.unstubAllEnvs();
});

describe("appDb role gate — real pg Pool and Drizzle", () => {
  const roleSql = "SELECT current_user AS u, session_user AS s";
  const appRoles = [{ u: "app", s: "app" }];

  it("allows native Promise query and checkout as app", async () => {
    const pool = appDb().pool;
    expect((await pool.query(roleSql)).rows).toEqual(appRoles);
    const client = await pool.connect();
    try {
      expect((await client.query(roleSql)).rows).toEqual(appRoles);
    } finally {
      client.release();
    }
  });

  it("preserves parameterized callback query and callback checkout/release", async () => {
    const pool = appDb().pool;
    const queryCallback = vi.fn();
    const rows = await new Promise<unknown[]>((resolve, reject) => {
      const returned = pool.query("SELECT $1::int AS n", [7], (error, result) => {
        queryCallback();
        if (error) reject(error);
        else resolve(result.rows);
      });
      expect(returned).toBeUndefined();
    });
    expect(rows).toEqual([{ n: 7 }]);
    expect(queryCallback).toHaveBeenCalledOnce();
    const checkoutCallback = vi.fn();
    const roles = await new Promise<unknown[]>((resolve, reject) => {
      const returned = pool.connect((error, client, release) => {
        checkoutCallback();
        if (error) return reject(error);
        if (!client) return reject(new Error("pool returned no client"));
        client.query(roleSql).then(
          (result) => {
            release();
            resolve(result.rows);
          },
          (failure) => {
            release(failure);
            reject(failure);
          },
        );
      });
      expect(returned).toBeUndefined();
    });
    expect(roles).toEqual(appRoles);
    expect(checkoutCallback).toHaveBeenCalledOnce();
  });

  it("releases Drizzle commits/rollbacks and preserves native SQL errors", async () => {
    const db = appDb();
    const committed = await db.db.transaction((tx) => tx.execute(roleSql));
    expect(committed.rows).toEqual(appRoles);
    await expect(
      db.db.transaction(async (tx) => {
        expect((await tx.execute(roleSql)).rows).toEqual(appRoles);
        throw new Error("intentional rollback");
      }),
    ).rejects.toThrow("intentional rollback");
    await expect(db.pool.query("SELECT 1 / 0")).rejects.toMatchObject({ code: "22012" });
    expect((await db.pool.query(roleSql)).rows).toEqual(appRoles);
    expect(db.pool.idleCount).toBe(db.pool.totalCount);
  });
});

async function seedAccountWithSession(
  csrfSecret: string,
): Promise<{ rawToken: string; accountId: string }> {
  // Mint a bare person+account directly (superuser seed). This used to go through
  // loginTelegram(); the Telegram login path was removed from apps/web (DD-37, audit
  // 2026-09-06 W-1) and a logout test has no business depending on any provider.
  const person = await owner.pool.query(`INSERT INTO persons DEFAULT VALUES RETURNING id`);
  const personId = (person.rows[0] as { id: string }).id;
  const account = await owner.pool.query(
    `INSERT INTO accounts (person_id) VALUES ($1) RETURNING id`,
    [personId],
  );
  const accountId = (account.rows[0] as { id: string }).id;
  const rawToken = randomBytes(32).toString("base64url");
  await createWebSession(owner.pool, {
    accountId,
    tokenHash: sha(rawToken),
    csrfSecret,
    ttlSeconds: 3600,
  });
  return { rawToken, accountId };
}

async function addSession(accountId: string): Promise<void> {
  await createWebSession(owner.pool, {
    accountId,
    tokenHash: sha(randomBytes(32).toString("base64url")),
    csrfSecret: "second-secret",
    ttlSeconds: 3600,
  });
}

async function activeCount(accountId: string): Promise<number> {
  const { rows } = await owner.pool.query(
    `SELECT count(*)::int AS n FROM web_sessions WHERE account_id = $1 AND revoked_at IS NULL`,
    [accountId],
  );
  return (rows[0] as { n: number }).n;
}

/** session_epoch as text ("0", "1", ...) — a second logout bump would move it. */
async function sessionEpoch(accountId: string): Promise<string> {
  const { rows } = await owner.pool.query(
    `SELECT session_epoch::text AS e FROM accounts WHERE id = $1`,
    [accountId],
  );
  return (rows[0] as { e: string }).e;
}

function mockCookieStore(value: string | undefined) {
  const store = {
    get: vi.fn(() => (value === undefined ? undefined : { value })),
    set: vi.fn(),
    delete: vi.fn(),
  };
  vi.mocked(cookies).mockResolvedValue(store as never);
  return store;
}

function req(csrfHeader?: string): Request {
  const headers: Record<string, string> = {};
  if (csrfHeader !== undefined) headers["x-csrf-token"] = csrfHeader;
  return new Request("https://plexco.app/api/auth/logout-all", { method: "POST", headers });
}

describe("POST /api/auth/logout-all — real DB wrapper", () => {
  it("D0-3/G3-B4: valid session + CSRF revokes ALL account sessions, clears cookie, account derived from token", async () => {
    const csrf = `csrf-${randomBytes(6).toString("hex")}`;
    const { rawToken, accountId } = await seedAccountWithSession(csrf);
    await addSession(accountId); // this account now has 2 live sessions
    const bystander = await seedAccountWithSession("bystander-csrf"); // another account, 1 live
    expect(await activeCount(accountId)).toBe(2);
    expect(await activeCount(bystander.accountId)).toBe(1);

    const store = mockCookieStore(rawToken);
    const res = await POST(req(csrf));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeNull();
    expect(body.data.revoked).toBe(2); // exactly this account's two sessions
    expect(await activeCount(accountId)).toBe(0); // all revoked in the real DB
    // account was derived server-side from the token — the bystander is untouched
    expect(await activeCount(bystander.accountId)).toBe(1);
    expect(store.set).toHaveBeenCalledWith(
      SESSION_COOKIE,
      "",
      expect.objectContaining({ maxAge: 0, path: "/", httpOnly: true }),
    ); // cleared as an expiring SET: a bare delete() omits Secure and a prefixed cookie ignores it
  });

  it("D0-4: replaying the revoked cookie returns 401 AUTH_INVALID with zero mutation", async () => {
    const csrf = `csrf-${randomBytes(6).toString("hex")}`;
    const { rawToken, accountId } = await seedAccountWithSession(csrf);

    mockCookieStore(rawToken);
    const first = await POST(req(csrf));
    expect(first.status).toBe(200);
    const epochAfterFirst = await sessionEpoch(accountId);
    expect(await activeCount(accountId)).toBe(0);

    // replay the SAME (now revoked) cookie
    const store = mockCookieStore(rawToken);
    const res = await POST(req(csrf));

    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("AUTH_INVALID");
    // zero mutation: no second epoch bump, still zero active sessions
    expect(await sessionEpoch(accountId)).toBe(epochAfterFirst);
    expect(await activeCount(accountId)).toBe(0);
    // resolves to null BEFORE the wrapper → nothing to clear again
    expect(store.delete).not.toHaveBeenCalled();
  });

  it("D0-5/G3-B5: wrong CSRF returns 403 CSRF_INVALID before any mutation", async () => {
    const csrf = `csrf-${randomBytes(6).toString("hex")}`;
    const { rawToken, accountId } = await seedAccountWithSession(csrf);
    const epochBefore = await sessionEpoch(accountId);
    const store = mockCookieStore(rawToken);

    const res = await POST(req("WRONG-SECRET"));

    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("CSRF_INVALID");
    expect(await activeCount(accountId)).toBe(1); // untouched — zero mutation
    expect(await sessionEpoch(accountId)).toBe(epochBefore); // no epoch bump
    expect(store.delete).not.toHaveBeenCalled();
  });

  it("D0-5: missing CSRF header returns 403 CSRF_INVALID, zero mutation", async () => {
    const csrf = `csrf-${randomBytes(6).toString("hex")}`;
    const { rawToken, accountId } = await seedAccountWithSession(csrf);
    mockCookieStore(rawToken);

    const res = await POST(req()); // no x-csrf-token header

    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("CSRF_INVALID");
    expect(await activeCount(accountId)).toBe(1);
  });

  it("no session cookie returns 401 AUTH_INVALID", async () => {
    mockCookieStore(undefined);

    const res = await POST(req("anything"));

    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("AUTH_INVALID");
  });
});

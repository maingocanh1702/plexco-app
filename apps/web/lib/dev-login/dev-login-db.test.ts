import { createHash, randomUUID } from "node:crypto";
import { createDb } from "@plexco/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  setupRlsTestContext,
  type RlsTestContext,
} from "../../../../packages/db/src/test-harness.js";

/**
 * Real Postgres, real `app` role (NOBYPASSRLS), real migrations, real route handlers:
 *   seed (twice) -> dev login -> the same session issuer, cookie and web_sessions row as Google
 *   sign-in -> an owner action through the normal API path -> the player refused by authorize().
 * Only next/headers (no request scope in vitest) and the network-exposure probe (it needs a live
 * listening server; the dev-server smoke exercises it for real) are stubbed.
 */
type CookieSet = { name: string; value: string; options: Record<string, unknown> };
const jar = vi.hoisted(() => ({ values: new Map<string, string>(), sets: [] as CookieSet[] }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.values.has(name) ? { name, value: jar.values.get(name)! } : undefined,
    set: (name: string, value: string, options: Record<string, unknown>) => {
      jar.sets.push({ name, value, options });
      if (options.maxAge === 0) jar.values.delete(name);
      else jar.values.set(name, value);
    },
  }),
}));
vi.mock("./network-exposure", () => ({ devServerLoopbackOnly: async () => true }));

import { GET as sessionInfo } from "../../app/api/auth/session/route";
import { POST as createSessionRoute } from "../../app/api/sessions/route";
import { __resetAuthSecretCacheForTest } from "../auth-secrets";
import {
  appDb,
  issueSession,
  resetDbRoleViolationForTests,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} from "../session-cookies";
import { DEV_LOGIN_CSRF_COOKIE } from "./csrf";
import { handleDevLoginPage, handleDevLoginSession } from "./handlers";
import { runDevSeed, type DevSeedResult } from "./seed";

const KEY = Buffer.alloc(32, 42).toString("base64");
const HOST = "127.0.0.1:3000";
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

let ctx: RlsTestContext;
let appUrl: string;
let seeded: DevSeedResult;

function injected(): Record<string, string> {
  return {
    host: HOST,
    "x-forwarded-for": "127.0.0.1",
    "x-forwarded-host": HOST,
    "x-forwarded-port": "3000",
    "x-forwarded-proto": "http",
  };
}

/** GET the page (sets the double-submit cookie), then POST the persona form exactly as a browser. */
async function devLogin(persona: string): Promise<Response> {
  await handleDevLoginPage(
    new Request("http://localhost:3000/internal-dev-login/page", { headers: injected() }),
  );
  const csrf = jar.values.get(DEV_LOGIN_CSRF_COOKIE)!;
  return handleDevLoginSession(
    new Request("http://localhost:3000/internal-dev-login/session", {
      method: "POST",
      headers: {
        ...injected(),
        origin: `http://${HOST}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ persona, csrf }).toString(),
    }),
  );
}

async function sessionCsrf(): Promise<{ csrfToken: string; tenants: { tenantId: string }[] }> {
  const response = await sessionInfo();
  expect(response.status).toBe(200);
  return (await response.json()).data;
}

function createSessionRequest(tenantId: string, csrf: string): Request {
  const startsAt = new Date(Date.now() + 7 * 24 * 3600 * 1000);
  return new Request(`http://localhost:3000/api/sessions?tenant=${tenantId}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": csrf },
    body: JSON.stringify({
      commandId: randomUUID(),
      sportId: ctx.badmintonSportId,
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + 2 * 3600 * 1000).toISOString(),
      timezone: "Asia/Ho_Chi_Minh",
      priceAmount: 100000,
      slotsMax: 8,
      visibility: "private",
      area: "Dev area",
      venueName: "Dev Court (fake)",
    }),
  });
}

async function counts(): Promise<Record<string, number>> {
  const { rows } = await ctx.owner.query(
    `SELECT (SELECT count(*)::int FROM persons) persons,
            (SELECT count(*)::int FROM accounts) accounts,
            (SELECT count(*)::int FROM account_emails) account_emails,
            (SELECT count(*)::int FROM account_identities) account_identities,
            (SELECT count(*)::int FROM tenants) tenants,
            (SELECT count(*)::int FROM memberships) memberships,
            (SELECT count(*)::int FROM tenant_admins) tenant_admins,
            (SELECT count(*)::int FROM subscriptions) subscriptions,
            (SELECT count(*)::int FROM onboarding_runs) onboarding_runs,
            (SELECT count(*)::int FROM web_sessions) web_sessions`,
  );
  return rows[0] as Record<string, number>;
}

const DB_NAME = `plexco_dev_login_${process.pid}`;
const optIn = (on: boolean) =>
  ctx.owner.query(
    on
      ? `ALTER DATABASE ${DB_NAME} SET plexco.dev_login = 'on'`
      : `ALTER DATABASE ${DB_NAME} RESET plexco.dev_login`,
  );
/** A database setting reaches only NEW connections: drop the web pool so the next query reconnects. */
async function freshAppPool(): Promise<void> {
  await appDb()
    .close()
    .catch(() => {});
  resetDbRoleViolationForTests();
}

beforeAll(async () => {
  ctx = await setupRlsTestContext(DB_NAME);
  // The database owner's deliberate opt-in (database-guard.ts), before any app connection exists.
  await optIn(true);
  appUrl = String(ctx.appPool.options.connectionString);
  vi.stubEnv("DATABASE_URL", appUrl);
  vi.stubEnv("DB_EXPECTED_ROLE", "app");
  vi.stubEnv("ENCRYPTION_KEY", KEY);
  vi.stubEnv("KMS_PROVIDER", "local");
  vi.stubEnv("KMS_KEY_ID", "");
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("PLEXCO_DEV_LOGIN", "1");
  vi.stubEnv("TRUSTED_INGRESS_PROVIDER", "direct");
  // Bind evidence as `next dev -H 127.0.0.1 -p 3000` writes it (measured shape).
  vi.stubEnv("__NEXT_PRIVATE_ORIGIN", "http://127.0.0.1:3000");
  vi.stubEnv("PORT", "3000");
  resetDbRoleViolationForTests();
  __resetAuthSecretCacheForTest();
  seeded = await runDevSeed(process.env);
}, 180_000);

afterAll(async () => {
  try {
    await appDb()
      .close()
      .catch(() => {});
  } finally {
    resetDbRoleViolationForTests();
    __resetAuthSecretCacheForTest();
    try {
      await ctx?.teardown();
    } finally {
      vi.unstubAllEnvs();
      // The shared harness never drops its database; this suite names one per pid, so drop it here
      // or every run leaves a plexco_dev_login_<pid> database behind.
      const base = process.env.DATABASE_URL_TEST;
      if (base) {
        const admin = createDb(base, { max: 1 });
        try {
          await admin.pool.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
        } finally {
          await admin.close();
        }
      }
    }
  }
}, 120_000);

beforeEach(() => {
  jar.values.clear();
  jar.sets.length = 0;
});

describe("pnpm dev:seed against a real database", () => {
  it("connects as the RLS-enforced app role (not the superuser)", async () => {
    expect(new URL(appUrl).username).toBe("app");
    const { rows } = await appDb().pool.query("SELECT current_user AS u, session_user AS s");
    expect(rows).toEqual([{ u: "app", s: "app" }]);
  });

  it("creates Dev Club and the three personas through the product's own entry points", async () => {
    const tenant = await ctx.owner.query(`SELECT name, slug, status FROM tenants WHERE id = $1`, [
      seeded.tenantId,
    ]);
    expect(tenant.rows).toEqual([{ name: "Dev Club", slug: "dev-club", status: "active" }]);

    const admins = await ctx.owner.query(
      `SELECT platform_user_lookup_hash AS person, role FROM tenant_admins
        WHERE tenant_id = $1 AND platform = 'web' AND active ORDER BY role`,
      [seeded.tenantId],
    );
    expect(admins.rows).toEqual([
      { person: seeded.personas.co_admin.personId, role: "co_admin" },
      { person: seeded.personas.owner.personId, role: "owner" },
    ]);
    const members = await ctx.owner.query(
      `SELECT person_id FROM memberships WHERE tenant_id = $1 AND status = 'active' ORDER BY person_id`,
      [seeded.tenantId],
    );
    expect(members.rows.map((r: { person_id: string }) => r.person_id)).toEqual(
      [seeded.personas.owner, seeded.personas.co_admin, seeded.personas.player]
        .map((p) => p.personId)
        .sort(),
    );

    // account -> Person exactly as cell 1 of auth_login_google writes it: verified email, one
    // 'google' identity per account, fake display names.
    for (const key of ["owner", "co_admin", "player"] as const) {
      const ids = seeded.personas[key];
      const row = await ctx.owner.query(
        `SELECT a.person_id, p.display_name,
                (SELECT count(*)::int FROM account_emails e WHERE e.account_id = a.id AND e.verified_at IS NOT NULL) verified_emails,
                (SELECT count(*)::int FROM account_identities i WHERE i.account_id = a.id AND i.platform = 'google') identities
           FROM accounts a JOIN persons p ON p.id = a.person_id WHERE a.id = $1`,
        [ids.accountId],
      );
      expect(row.rows).toHaveLength(1);
      expect(row.rows[0]).toMatchObject({
        person_id: ids.personId,
        verified_emails: 1,
        identities: 1,
      });
      expect(row.rows[0].display_name).toMatch(/^DEV .*\(fake\)$/);
    }
    const subs = await ctx.owner.query(
      `SELECT plan_key, status FROM subscriptions WHERE tenant_id = $1`,
      [seeded.tenantId],
    );
    expect(subs.rows).toEqual([{ plan_key: "free", status: "active" }]);
  });

  it("is idempotent: a second run keeps every id and creates nothing but the definer's audit rows", async () => {
    const before = await counts();
    const auditBefore = await ctx.owner.query(
      `SELECT count(*)::int n FROM auth_audit_events WHERE request_ref LIKE 'dev_seed_%'`,
    );
    const again = await runDevSeed(process.env);
    expect(again.tenantId).toBe(seeded.tenantId);
    for (const key of ["owner", "co_admin", "player"] as const) {
      expect(again.personas[key].accountId).toBe(seeded.personas[key].accountId);
      expect(again.personas[key].personId).toBe(seeded.personas[key].personId);
    }
    expect(again.personas.co_admin.membershipId).toBe(seeded.personas.co_admin.membershipId);
    expect(again.personas.player.membershipId).toBe(seeded.personas.player.membershipId);
    expect(await counts()).toEqual(before);
    const auditAfter = await ctx.owner.query(
      `SELECT count(*)::int n FROM auth_audit_events WHERE request_ref LIKE 'dev_seed_%'`,
    );
    expect(auditAfter.rows[0].n - auditBefore.rows[0].n).toBe(3);
  });
});

describe("dev login takes the Google sign-in session path", () => {
  it("owner: the cookie and the web_sessions row are exactly what issueSession() produces", async () => {
    const response = await devLogin("owner");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/");

    const sessionSets = jar.sets.filter((s) => s.name === SESSION_COOKIE);
    expect(sessionSets).toHaveLength(1);
    const devCookie = sessionSets[0]!;
    expect(devCookie.options).toEqual({
      httpOnly: true,
      secure: false, // non-production, same as Google sign-in in dev (cookieSecure())
      sameSite: "strict",
      path: "/",
      maxAge: SESSION_TTL_SECONDS,
    });

    const row = await ctx.owner.query(
      `SELECT account_id, csrf_secret, revoked_at, rotated_from,
              (expires_at - created_at) BETWEEN interval '29 days 23 hours' AND interval '30 days 1 hour' AS ttl_30d
         FROM web_sessions WHERE token_hash = $1`,
      [sha256(devCookie.value)],
    );
    expect(row.rows).toEqual([
      {
        account_id: seeded.personas.owner.accountId,
        csrf_secret: expect.stringMatching(/^[A-Za-z0-9_-]{32}$/),
        revoked_at: null,
        rotated_from: null,
        ttl_30d: true,
      },
    ]);

    // The reference: issueSession() called directly for the same account (cookie-less, create
    // branch) sets the identical attribute set and the identical row shape.
    jar.values.clear();
    jar.sets.length = 0;
    await issueSession(seeded.personas.owner.accountId);
    const reference = jar.sets.find((s) => s.name === SESSION_COOKIE)!;
    expect(reference.options).toEqual(devCookie.options);
    const refRow = await ctx.owner.query(
      `SELECT account_id, revoked_at, rotated_from FROM web_sessions WHERE token_hash = $1`,
      [sha256(reference.value)],
    );
    expect(refRow.rows).toEqual([
      { account_id: seeded.personas.owner.accountId, revoked_at: null, rotated_from: null },
    ]);
  });

  it("records the login in the DB through the existing definer path (login_success / google / dev_login_<uuid>)", async () => {
    await devLogin("owner");
    const audit = await ctx.owner.query(
      `SELECT event_type, outcome_class, actor_class, request_ref FROM auth_audit_events
        WHERE account_id = $1 AND request_ref LIKE 'dev_login_%' ORDER BY created_at DESC LIMIT 1`,
      [seeded.personas.owner.accountId],
    );
    expect(audit.rows).toEqual([
      {
        event_type: "login_success",
        outcome_class: "success",
        actor_class: "google",
        request_ref: expect.stringMatching(/^dev_login_[0-9a-f-]{36}$/),
      },
    ]);
  });

  it("owner performs an owner action through the normal API path (authorize session.manage -> 200)", async () => {
    await devLogin("owner");
    const me = await sessionCsrf();
    expect(me.tenants.map((t) => t.tenantId)).toContain(seeded.tenantId);
    const response = await createSessionRoute(createSessionRequest(seeded.tenantId, me.csrfToken));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.session.status).toBe("draft");
    const created = await ctx.owner.query(`SELECT tenant_id FROM sessions WHERE id = $1`, [
      body.data.session.id,
    ]);
    expect(created.rows).toEqual([{ tenant_id: seeded.tenantId }]);
  });

  it("co_admin: the seeded admin row is honoured by authorize() too (session.manage is preset)", async () => {
    await devLogin("co_admin");
    const me = await sessionCsrf();
    const response = await createSessionRoute(createSessionRequest(seeded.tenantId, me.csrfToken));
    expect(response.status).toBe(200);
  });

  it("player: authorize() refuses the same owner action (403 FORBIDDEN), nothing is written", async () => {
    await devLogin("player");
    const me = await sessionCsrf();
    expect(me.tenants).toEqual([]); // a member, not a web admin of any club
    const before = await ctx.owner.query(
      `SELECT count(*)::int n FROM sessions WHERE tenant_id = $1`,
      [seeded.tenantId],
    );
    const response = await createSessionRoute(createSessionRequest(seeded.tenantId, me.csrfToken));
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("FORBIDDEN");
    const after = await ctx.owner.query(
      `SELECT count(*)::int n FROM sessions WHERE tenant_id = $1`,
      [seeded.tenantId],
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it("switching persona while signed in goes through issueSession's rotate branch (old session revoked)", async () => {
    await devLogin("owner");
    const ownerToken = jar.values.get(SESSION_COOKIE)!;
    await devLogin("player");
    const playerToken = jar.values.get(SESSION_COOKIE)!;
    expect(playerToken).not.toBe(ownerToken);
    const { rows } = await ctx.owner.query(
      `SELECT o.account_id AS old_account, o.revoked_at IS NOT NULL AS old_revoked,
              n.account_id AS new_account, n.rotated_from = o.id AS linked
         FROM web_sessions o, web_sessions n WHERE o.token_hash = $1 AND n.token_hash = $2`,
      [sha256(ownerToken), sha256(playerToken)],
    );
    expect(rows).toEqual([
      {
        old_account: seeded.personas.owner.accountId,
        old_revoked: true,
        new_account: seeded.personas.player.accountId,
        linked: true,
      },
    ]);
  });
});

describe("database-side refusals (no write, no session)", () => {
  const superuserUrl = () => {
    const url = new URL(process.env.DATABASE_URL_TEST!);
    url.pathname = `/${DB_NAME}`;
    return url.toString();
  };

  it("the seed refuses the superuser URL even though its host is local", async () => {
    await expect(runDevSeed({ ...process.env, DATABASE_URL: superuserUrl() })).rejects.toThrow(
      /superuser or BYPASSRLS/,
    );
  });

  it("the seed and dev login refuse a database whose owner has not opted in", async () => {
    await optIn(false);
    try {
      await expect(runDevSeed(process.env)).rejects.toThrow(/not opted in to dev-login/);
      await freshAppPool();
      const sessionsBefore = (await counts()).web_sessions;
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const page = await handleDevLoginPage(
        new Request("http://localhost:3000/internal-dev-login/page", { headers: injected() }),
      );
      expect(page.status).toBe(404);
      expect(jar.sets).toEqual([]); // not even the CSRF cookie
      expect(JSON.stringify(warn.mock.calls)).toContain("database_not_opted_in");
      warn.mockRestore();
      expect((await counts()).web_sessions).toBe(sessionsBefore);
    } finally {
      await optIn(true);
      await freshAppPool();
    }
  });

  it("dev login refuses when the web process itself runs as the superuser", async () => {
    vi.stubEnv("DATABASE_URL", superuserUrl());
    vi.stubEnv("DB_EXPECTED_ROLE", "");
    await freshAppPool();
    try {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const page = await handleDevLoginPage(
        new Request("http://localhost:3000/internal-dev-login/page", { headers: injected() }),
      );
      expect(page.status).toBe(404);
      expect(jar.sets).toEqual([]);
    } finally {
      vi.stubEnv("DATABASE_URL", appUrl);
      vi.stubEnv("DB_EXPECTED_ROLE", "app");
      await freshAppPool();
    }
  });
});

describe("the opt-in is the DATABASE's own setting, and both roles must honour RLS (R2-B)", () => {
  const superuserUrl = () => {
    const url = new URL(process.env.DATABASE_URL_TEST!);
    url.pathname = `/${DB_NAME}`;
    return url.toString();
  };
  async function pageStatus(): Promise<number> {
    const page = await handleDevLoginPage(
      new Request("http://localhost:3000/internal-dev-login/page", { headers: injected() }),
    );
    return page.status;
  }
  /** Run `fn` with PGOPTIONS set for NEW connections (node-postgres reads it at connect). */
  async function withPgOptions<T>(options: string, fn: () => Promise<T>): Promise<T> {
    vi.stubEnv("PGOPTIONS", options);
    await freshAppPool();
    try {
      return await fn();
    } finally {
      vi.stubEnv("PGOPTIONS", "");
      delete process.env.PGOPTIONS;
      await freshAppPool();
    }
  }

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("the database-level opt-in is accepted", async () => {
    expect(await pageStatus()).toBe(200);
  });

  it("an owner's RESET is refused on the very next request, through the same warm pool", async () => {
    expect(await pageStatus()).toBe(200); // the pool is warm now
    await optIn(false);
    try {
      expect(await pageStatus()).toBe(404);
    } finally {
      await optIn(true);
    }
    expect(await pageStatus()).toBe(200);
  });

  it("a forged session value (PGOPTIONS='-c plexco.dev_login=on') does not opt a database in", async () => {
    await optIn(false);
    try {
      await withPgOptions("-c plexco.dev_login=on", async () => {
        // The forgery is real: the session sees the value...
        const { rows } = await appDb().pool.query(
          "SELECT current_setting('plexco.dev_login', true) AS v",
        );
        expect(rows).toEqual([{ v: "on" }]);
        // ...and it still counts for nothing.
        expect(await pageStatus()).toBe(404);
        await expect(runDevSeed(process.env)).rejects.toThrow(/not opted in to dev-login/);
      });
    } finally {
      await optIn(true);
    }
  });

  it("a role-level setting (ALTER ROLE app IN DATABASE … SET) does not opt a database in", async () => {
    await optIn(false);
    await ctx.owner.query(`ALTER ROLE app IN DATABASE ${DB_NAME} SET plexco.dev_login = 'on'`);
    try {
      await freshAppPool();
      const { rows } = await appDb().pool.query(
        "SELECT current_setting('plexco.dev_login', true) AS v",
      );
      expect(rows).toEqual([{ v: "on" }]); // the role-level default reached the session
      expect(await pageStatus()).toBe(404);
    } finally {
      await ctx.owner.query(`ALTER ROLE app IN DATABASE ${DB_NAME} RESET plexco.dev_login`);
      await optIn(true);
      await freshAppPool();
    }
  });

  it("a superuser login switched to `-c role=app` is refused (session_user is checked too)", async () => {
    vi.stubEnv("DATABASE_URL", superuserUrl());
    vi.stubEnv("DB_EXPECTED_ROLE", "");
    try {
      await withPgOptions("-c role=app", async () => {
        const { rows } = await appDb().pool.query("SELECT current_user AS c, session_user AS s");
        expect(rows).toEqual([{ c: "app", s: new URL(process.env.DATABASE_URL_TEST!).username }]);
        expect(await pageStatus()).toBe(404);
        await expect(runDevSeed({ ...process.env, DATABASE_URL: superuserUrl() })).rejects.toThrow(
          /superuser or BYPASSRLS/,
        );
      });
    } finally {
      vi.stubEnv("DATABASE_URL", appUrl);
      vi.stubEnv("DB_EXPECTED_ROLE", "app");
      await freshAppPool();
    }
  });
});

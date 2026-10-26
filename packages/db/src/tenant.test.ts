import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { setupRlsTestContext, type RlsTestContext } from "./test-harness.js";
import { sql } from "drizzle-orm";
import {
  ensureTenantContext,
  TenantContextMismatchError,
  tenantLocale,
  tenantRepo,
} from "./tenant.js";
import { stripInvisibleChars } from "./text-safety.js";

/**
 * THE DIAGNOSTIC. v1 of this lane shipped a no-op and every gate it ran was green: lint,
 * typecheck, format and 1191 tests all passed while the feature did not work at all.
 *
 * The reason nothing caught it is that no test ever ran as the identity production uses.
 * v1's own tenant.test.ts connected with DATABASE_URL_TEST, which is the OWNER role, and its
 * strongest assertion was `value === null || typeof value === "string"` — which accepts every
 * failure mode there is. The web-side test mocked tenantLocale outright.
 *
 * So this suite runs as `app`, the restricted runtime role, via the same harness the RLS
 * invariants use ("REAL runtime roles (app / readonly), never superuser"). The owner seat is
 * used ONLY to insert fixtures, never to read the value under test.
 *
 * Measured on 2026-08-26 against base 8e668a1:
 *   has_table_privilege('app','tenants','SELECT') = false
 *   GRANT statements naming `tenants` across every migration = zero
 * and 0027_resolve_tenant_status_locked.sql's header opens by stating it outright: "the `app`
 * role holds zero privileges on `tenants`". The first test below MUST be RED until 0035 adds a
 * SECURITY DEFINER reader. If it is GREEN, the capability premise is wrong AGAIN and this lane
 * stops rather than proceeding — that is a registered stop condition.
 */
describe("tenantLocale — read as the app role, the identity production actually uses", () => {
  let ctx: RlsTestContext;

  beforeAll(async () => {
    ctx = await setupRlsTestContext("plexco_tenant_locale_approle");
    // Owner seat: fixture setup only. `app` cannot write here, which is the whole point.
    await ctx.owner.query(`UPDATE tenants SET locale = 'en' WHERE id = $1`, [ctx.tenantA]);
    await ctx.owner.query(`UPDATE tenants SET locale = 'vi' WHERE id = $1`, [ctx.tenantB]);
  }, 120_000);

  afterAll(async () => {
    await ctx?.teardown();
  });

  it("RED UNTIL 0035: an 'en' tenant read as `app` returns 'en', not null", async () => {
    // The production-shaped call: the restricted role reading a tenant it is authorized for.
    // v1 returns null here because the permission error is swallowed by its catch, so every
    // English tenant silently falls back to Vietnamese. This asserts the END STATE we want, so
    // it fails now and passes once the definer function exists.
    const locale = await tenantLocale(ctx.appDb.db, ctx.tenantA);
    expect(locale).toBe("en");
  });

  it("a 'vi' tenant read as `app` returns 'vi' — proving the read works, not just that it is non-null", async () => {
    // Without this, a reader that returned a constant 'en' would pass the test above. Two
    // tenants with DIFFERENT stored values is what makes the assertion load-bearing.
    const locale = await tenantLocale(ctx.appDb.db, ctx.tenantB);
    expect(locale).toBe("vi");
  });

  it("a well-formed id matching no visible tenant returns null — the ordinary absent-row path", async () => {
    // NOT the only null path: an invalid UUID and a logged unexpected failure also return null,
    // each covered by its own test below. null means "undetermined", never "no such tenant".
    // v1's defect was that a PRIVILEGE error also landed here, silently, making the three
    // indistinguishable; 0035 removes that class and the log distinguishes what remains.
    const locale = await tenantLocale(ctx.appDb.db, "11111111-1111-4111-8111-111111111111");
    expect(locale).toBeNull();
  });

  it("an UNEXPECTED failure returns null but is LOGGED — the amendment's whole point", async () => {
    // Round-1 finding 2. The never-throws guarantee is kept, so this still resolves to null; what
    // changed is that it can no longer be SILENT. v1's catch-all is exactly how a permission
    // error masqueraded as "no such tenant" for an entire lane. Asserting the log is asserting
    // that the next unexpected class announces itself instead of degrading quietly.
    const errors: unknown[][] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });
    try {
      const exploding = {
        execute: () => Promise.reject(new Error("connection reset by peer")),
      } as unknown as Parameters<typeof tenantLocale>[0];
      await expect(
        tenantLocale(exploding, "11111111-1111-4111-8111-111111111111"),
      ).resolves.toBeNull();
      expect(errors).toHaveLength(1);
      expect(String(errors[0]?.[0])).toContain("[tenantLocale]");
      expect(String(errors[0]?.[1])).toContain("connection reset by peer");
    } finally {
      spy.mockRestore();
    }
  });

  it("a non-UUID id short-circuits WITHOUT touching the database and without logging", async () => {
    // The benign case must not be noisy, or the log above stops meaning "something is wrong".
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const touched = { execute: () => Promise.reject(new Error("must not be called")) };
    try {
      await expect(
        tenantLocale(touched as unknown as Parameters<typeof tenantLocale>[0], "not-a-uuid"),
      ).resolves.toBeNull();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("the definer function's SECURITY posture is asserted against the CATALOG, not the migration text", async () => {
    // Round-1 finding 1. 0035's header makes four security claims in prose; prose cannot fail.
    // An accidental `GRANT EXECUTE ... TO readonly` in some later migration would leave every
    // other test in this repo green. These read pg_proc/pg ACLs directly, so they fail if the
    // LIVE posture drifts, regardless of what any migration file says.
    const { rows } = await ctx.owner.query<{
      secdef: boolean;
      config: string[] | null;
      app_exec: boolean;
      worker_exec: boolean;
      readonly_exec: boolean;
      public_exec: boolean;
    }>(
      `SELECT p.prosecdef                                        AS secdef,
              p.proconfig                                        AS config,
              has_function_privilege('app',        p.oid, 'EXECUTE') AS app_exec,
              has_function_privilege('app_worker', p.oid, 'EXECUTE') AS worker_exec,
              has_function_privilege('readonly',   p.oid, 'EXECUTE') AS readonly_exec,
              has_function_privilege('public',     p.oid, 'EXECUTE') AS public_exec
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.proname = 'tenant_locale' AND n.nspname = 'public'`,
    );

    expect(rows).toHaveLength(1); // exactly one overload — no shadowing definition
    const fn = rows[0]!;
    expect(fn.secdef).toBe(true); // SECURITY DEFINER, or it cannot read tenants at all
    expect(fn.config).toContain("search_path=public, pg_temp"); // pinned, not inherited
    expect(fn.app_exec).toBe(true); // the one role that may call it
    expect(fn.worker_exec).toBe(false); // job seat has no business reading tenant config
    expect(fn.readonly_exec).toBe(false); // public-projection seat, never the tenant root
    expect(fn.public_exec).toBe(false); // REVOKE ALL FROM PUBLIC actually took effect
  });

  it("READ-ONLY FOREVER: the function body contains no write statement", async () => {
    // The migration header promises "no UPDATE branch". Asserted against the stored definition so
    // a later CREATE OR REPLACE that adds one is caught here rather than in production.
    const { rows } = await ctx.owner.query<{ src: string }>(
      `SELECT prosrc AS src FROM pg_proc WHERE proname = 'tenant_locale'`,
    );
    const body = rows[0]!.src.toLowerCase();
    for (const forbidden of ["insert", "update", "delete", "truncate", "for share", "for update"]) {
      expect(body, `tenant_locale must stay read-only; found ${forbidden}`).not.toContain(
        forbidden,
      );
    }
  });

  it("never throws at the request boundary — a non-UUID id resolves rather than raising", async () => {
    // The request-time guarantee survives the amendment: a throw inside the actor-authorization
    // choke-point is an outage. What is amended is that never-throws must not mean "every
    // failure becomes null" — hence the two distinguishing tests above.
    await expect(tenantLocale(ctx.appDb.db, "not-a-uuid")).resolves.toBeNull();
  });
});

/**
 * Audit 2026-09-06 D-15 — the two guards around tenant context and the direct session writer.
 */
describe("ensureTenantContext — set-or-assert (audit D-15)", () => {
  let ctx: RlsTestContext;
  beforeAll(async () => {
    ctx = await setupRlsTestContext("plexco_tenant_context_guard");
  });
  afterAll(async () => {
    await ctx?.teardown();
  });

  it("sets the GUC on an unscoped transaction and is a no-op when it already matches", async () => {
    await ctx.appDb.db.transaction(async (tx) => {
      await ensureTenantContext(tx, ctx.tenantA);
      const r1 = await tx.execute(sql`SELECT current_setting('app.tenant_id', true) AS t`);
      expect((r1.rows[0] as { t: string }).t).toBe(ctx.tenantA);
      await ensureTenantContext(tx, ctx.tenantA.toUpperCase()); // case-insensitive equality
      await ensureTenantContext(tx, ctx.tenantA);
    });
  });

  it("REFUSES to re-scope a transaction already set to another tenant (the silent re-scope the audit named)", async () => {
    await expect(
      ctx.appDb.db.transaction(async (tx) => {
        await ensureTenantContext(tx, ctx.tenantA);
        await ensureTenantContext(tx, ctx.tenantB);
      }),
    ).rejects.toBeInstanceOf(TenantContextMismatchError);
  });
});

describe("tenantRepo().sessions.create is a TEST-ONLY seam (audit D-15)", () => {
  it("has no caller under apps/ and none in a non-test module of packages/db", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === ".next" || entry === "dist") continue;
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx|mjs)$/.test(entry) && !/\.test\.(ts|tsx|mjs)$/.test(entry)) {
          if (readFileSync(full, "utf8").includes("tenantRepo("))
            hits.push(path.relative(root, full));
        }
      }
    };
    walk(path.join(root, "apps"));
    walk(path.join(root, "packages", "db", "src"));
    // tenant.ts DEFINES it; nothing else may call it outside tests.
    expect(hits).toEqual(["packages/db/src/tenant.ts"]);
  });
});

describe("tenantRepo().sessions.create strips area and venueName like SessionService (L42)", () => {
  let ctx: RlsTestContext;
  beforeAll(async () => {
    ctx = await setupRlsTestContext("plexco_tenant_repo_session_strip");
  });
  afterAll(async () => {
    await ctx?.teardown();
  });

  it("stores stripInvisibleChars of a pasted area and venue name, and keeps null as null", async () => {
    // Built from numbers so the source stays ASCII: area "Qu<U+1EAD>n 1" with a U+200B inside,
    // a venue with a leading U+FEFF and a U+202E + U+200B tail (the strip keeps U+202E, bidi).
    const cps = (...codePoints: number[]): string => String.fromCodePoint(...codePoints);
    const area = `Qu${cps(0x1ead)}n${cps(0x200b)} 1`;
    const venueName = `${cps(0xfeff)}San Ky Hoa${cps(0x202e, 0x200b)}`;
    expect(stripInvisibleChars(area)).not.toBe(area);
    expect(stripInvisibleChars(venueName)).not.toBe(venueName);
    const repo = tenantRepo(ctx.appDb.db, ctx.tenantA);
    const create = (hour: number, names: { area?: string | null; venueName?: string | null }) =>
      repo.sessions.create({
        sportId: ctx.badmintonSportId,
        startsAt: new Date(`2026-07-11T${hour}:00:00Z`),
        endsAt: new Date(`2026-07-11T${hour + 2}:00:00Z`),
        timezone: "Asia/Ho_Chi_Minh",
        priceAmount: 110000,
        status: "open",
        ...names,
      });
    const pasted = await create(10, { area, venueName });
    expect(await repo.sessions.getById(pasted.id)).toMatchObject({
      area: stripInvisibleChars(area),
      venueName: stripInvisibleChars(venueName),
    });
    const blank = await create(14, { area: null }); // venueName left undefined
    expect(await repo.sessions.getById(blank.id)).toMatchObject({ area: null, venueName: null });
  });
});

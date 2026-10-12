import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { authorize } from "./tenant-capability-authority.js";
import { withTenant } from "./tenant.js";
import pg from "pg";
import {
  setupNonSuperuserOwnerContext,
  setupRlsTestContext,
  withJobDefinerLock,
  type RlsTestContext,
} from "./test-harness.js";

/**
 * authorize() (0049) -- BE spec feature_tenant_routing_authz_tech.md §5 rows #21-#28 and #32, plus
 * the cross-tenant / inactive-admin / GUC-binding / hostile-input cases the session routes rely on.
 * Every call runs as the REAL `app` role inside withTenant, exactly like the routes.
 */

let ctx: RlsTestContext;
beforeAll(async () => {
  ctx = await setupRlsTestContext("plexco_tenant_capability_authorize");
}, 120_000);
afterAll(async () => {
  await ctx?.teardown();
});

const PRESET = [
  "session.manage",
  "content.manage",
  "member.manage_routine",
  "member.ban",
  "money.read",
  "money.mark_paid",
  "chat.channel.manage",
  "chat.channel.post_restricted",
  "chat.message.moderate",
  "chat.member.mute",
];
const GRANTABLE = [
  "money.correct",
  "money.refund",
  "money.waive_or_void",
  "bank_account.manage",
  "connector.secret_manage",
  "billing.manage",
];

async function person(): Promise<string> {
  const { rows } = await ctx.owner.query<{ id: string }>(
    `INSERT INTO persons (display_name) VALUES ($1) RETURNING id`,
    [`p-${randomUUID()}`],
  );
  return rows[0]!.id;
}
async function admin(tenantId: string, role: string, active = true): Promise<string> {
  const id = await person();
  await ctx.owner.query(
    `INSERT INTO tenant_admins (tenant_id, platform, platform_user_lookup_hash, role, active)
     VALUES ($1, 'web', $2, $3, $4)`,
    [tenantId, id, role, active],
  );
  return id;
}
/** Grant row via the owner connection; offsets are SQL intervals relative to now. */
async function grant(
  tenantId: string,
  grantee: string,
  by: string,
  action: string,
  opts: { grantedAgo?: string; expiresIn?: string; revoked?: boolean } = {},
): Promise<string> {
  const { rows } = await ctx.owner.query<{ id: string }>(
    `INSERT INTO tenant_capability_grants
       (tenant_id, grantee_person_id, action_key, reason, granted_by_person_id,
        granted_at, expires_at, revoked_at)
     VALUES ($1, $2, $3, 'test', $4,
        clock_timestamp() - $5::interval, clock_timestamp() + $6::interval,
        CASE WHEN $7 THEN clock_timestamp() ELSE NULL END)
     RETURNING id`,
    [
      tenantId,
      grantee,
      action,
      by,
      opts.grantedAgo ?? "1 minute",
      opts.expiresIn ?? "7 days",
      opts.revoked ?? false,
    ],
  );
  return rows[0]!.id;
}
const run = (tenantId: string, action: string, actor: string, scopeTenant = tenantId) =>
  withTenant(ctx.appDb.db, scopeTenant, (tx) =>
    authorize(tx, { tenantId, action, actorPersonId: actor }),
  );

describe("authorize(): default preset (#21)", () => {
  it("owner, admin and co_admin get the identical allow set over every preset key", async () => {
    const owner = await admin(ctx.tenantA, "owner");
    const adm = await admin(ctx.tenantA, "admin");
    const co = await admin(ctx.tenantA, "co_admin");
    for (const action of PRESET) {
      expect(await run(ctx.tenantA, action, owner), action).toEqual({
        allowed: true,
        role: "owner",
      });
      expect(await run(ctx.tenantA, action, adm), action).toEqual({ allowed: true, role: "admin" });
      expect(await run(ctx.tenantA, action, co), action).toEqual({
        allowed: true,
        role: "co_admin",
      });
    }
  });

  it("co_admin is allowed session.manage (DD-56 default preset)", async () => {
    const co = await admin(ctx.tenantA, "co_admin");
    expect((await run(ctx.tenantA, "session.manage", co)).allowed).toBe(true);
  });

  it("neither admin nor co_admin inherits owner-only role.manage; owner has it", async () => {
    const owner = await admin(ctx.tenantA, "owner");
    for (const role of ["admin", "co_admin"]) {
      const id = await admin(ctx.tenantA, role);
      expect(await run(ctx.tenantA, "role.manage", id)).toEqual({
        allowed: false,
        reason: "not_permitted",
      });
    }
    expect((await run(ctx.tenantA, "role.manage", owner)).allowed).toBe(true);
  });
});

describe("authorize(): sensitive actions (#22, #23, #24)", () => {
  it("denies every delegable action without a grant for admin and co_admin; owner is allowed", async () => {
    const owner = await admin(ctx.tenantA, "owner");
    for (const role of ["admin", "co_admin"]) {
      const id = await admin(ctx.tenantA, role);
      for (const action of GRANTABLE) {
        expect(await run(ctx.tenantA, action, id), `${role} ${action}`).toEqual({
          allowed: false,
          reason: "grant_required",
        });
      }
    }
    for (const action of GRANTABLE)
      expect((await run(ctx.tenantA, action, owner)).allowed).toBe(true);
  });

  it("a current grant allows exactly that action for exactly that grantee", async () => {
    const owner = await admin(ctx.tenantA, "owner");
    const co = await admin(ctx.tenantA, "co_admin");
    const other = await admin(ctx.tenantA, "co_admin");
    for (const action of GRANTABLE) await grant(ctx.tenantA, co, owner, action);
    for (const action of GRANTABLE) {
      expect(await run(ctx.tenantA, action, co), action).toEqual({
        allowed: true,
        role: "co_admin",
      });
      expect((await run(ctx.tenantA, action, other)).allowed, `other ${action}`).toBe(false);
    }
    // A refund grant never widens into a sibling action.
    const solo = await admin(ctx.tenantA, "admin");
    await grant(ctx.tenantA, solo, owner, "money.refund");
    expect((await run(ctx.tenantA, "money.correct", solo)).allowed).toBe(false);
  });

  it("an expired grant and a revoked grant both deny", async () => {
    const owner = await admin(ctx.tenantA, "owner");
    const expired = await admin(ctx.tenantA, "co_admin");
    const revoked = await admin(ctx.tenantA, "co_admin");
    await grant(ctx.tenantA, expired, owner, "money.refund", {
      grantedAgo: "2 days",
      expiresIn: "-1 day",
    });
    await grant(ctx.tenantA, revoked, owner, "money.refund", { revoked: true });
    expect(await run(ctx.tenantA, "money.refund", expired)).toEqual({
      allowed: false,
      reason: "grant_required",
    });
    expect(await run(ctx.tenantA, "money.refund", revoked)).toEqual({
      allowed: false,
      reason: "grant_required",
    });
  });

  it("a grant for tenant A confers nothing in tenant B (wrong-tenant grant)", async () => {
    const ownerA = await admin(ctx.tenantA, "owner");
    const coA = await admin(ctx.tenantA, "co_admin");
    await grant(ctx.tenantA, coA, ownerA, "money.refund");
    // coA is also an admin of B, with no grant there.
    await ctx.owner.query(
      `INSERT INTO tenant_admins (tenant_id, platform, platform_user_lookup_hash, role)
       VALUES ($1, 'web', $2, 'co_admin')`,
      [ctx.tenantB, coA],
    );
    expect((await run(ctx.tenantA, "money.refund", coA)).allowed).toBe(true);
    expect(await run(ctx.tenantB, "money.refund", coA)).toEqual({
      allowed: false,
      reason: "grant_required",
    });
  });

  it("a grant without an active admin row does not authorize (grantee must still be a member)", async () => {
    const owner = await admin(ctx.tenantA, "owner");
    const ghost = await person();
    await grant(ctx.tenantA, ghost, owner, "money.refund");
    expect(await run(ctx.tenantA, "money.refund", ghost)).toEqual({
      allowed: false,
      reason: "not_a_member",
    });
  });
});

describe("authorize(): closed registry (#26, #27, #32)", () => {
  it("unknown keys, PlatformAdmin-only global actions and typo aliases deny -- never a role fallback", async () => {
    const owner = await admin(ctx.tenantA, "owner");
    for (const action of [
      "nope.nothing",
      "billing.override_global",
      "tenant.freeze",
      "tenant.split",
      "session.read",
      "SESSION.MANAGE",
      " session.manage",
      "chat.channel.post",
      "chat.moderate",
      "chat.member.mute ",
      "",
    ]) {
      expect(await run(ctx.tenantA, action, owner), JSON.stringify(action)).toEqual({
        allowed: false,
        reason: "unknown_action",
      });
    }
  });

  it("the four exact Chat keys resolve for co_admin", async () => {
    const co = await admin(ctx.tenantA, "co_admin");
    for (const action of PRESET.filter((k) => k.startsWith("chat."))) {
      expect((await run(ctx.tenantA, action, co)).allowed, action).toBe(true);
    }
  });

  it("prototype-pollution-shaped actions and non-string input are plain denials", async () => {
    const owner = await admin(ctx.tenantA, "owner");
    for (const action of ["__proto__", "constructor", "toString", "hasOwnProperty", "prototype"]) {
      expect(await run(ctx.tenantA, action, owner), action).toEqual({
        allowed: false,
        reason: "unknown_action",
      });
    }
    const hostile = { toString: () => "session.manage" } as unknown as string;
    expect(await run(ctx.tenantA, hostile, owner)).toEqual({
      allowed: false,
      reason: "unknown_action",
    });
    expect((await run(ctx.tenantA, "session.manage", "__proto__")).allowed).toBe(false);
  });
});

describe("authorize(): actor and tenant binding", () => {
  it("a cross-tenant actor is denied (admin of A only, asked about B)", async () => {
    const onlyA = await admin(ctx.tenantA, "owner");
    expect(await run(ctx.tenantB, "session.manage", onlyA)).toEqual({
      allowed: false,
      reason: "not_a_member",
    });
  });

  it("an inactive admin is denied; a person with no admin row is denied", async () => {
    const inactive = await admin(ctx.tenantA, "owner", false);
    expect(await run(ctx.tenantA, "session.manage", inactive)).toEqual({
      allowed: false,
      reason: "not_a_member",
    });
    expect((await run(ctx.tenantA, "session.manage", await person())).allowed).toBe(false);
  });

  it("a non-web platform admin row never authorizes (same predicate as tenant_ids_for_person)", async () => {
    const id = await person();
    await ctx.owner.query(
      `INSERT INTO tenant_admins (tenant_id, platform, platform_user_lookup_hash, role)
       VALUES ($1, 'telegram', $2, 'owner')`,
      [ctx.tenantA, id],
    );
    expect((await run(ctx.tenantA, "session.manage", id)).allowed).toBe(false);
  });

  it("agrees with tenant_ids_for_person() for every role/active shape", async () => {
    const cases = [
      await admin(ctx.tenantA, "owner"),
      await admin(ctx.tenantA, "admin"),
      await admin(ctx.tenantA, "co_admin"),
      await admin(ctx.tenantA, "co_admin", false),
      await person(),
    ];
    for (const id of cases) {
      const { rows } = await ctx.appPool.query<{ tenant_id: string; role: string }>(
        `SELECT tenant_id, role FROM tenant_ids_for_person($1)`,
        [id],
      );
      const mapped = rows.find((r) => r.tenant_id === ctx.tenantA)?.role ?? null;
      const d = await run(ctx.tenantA, "session.manage", id);
      expect(d.allowed, id).toBe(mapped !== null);
      if (d.allowed) expect(d.role).toBe(mapped);
    }
  });

  it("GUC mismatch: param tenant B inside a tenant-A transaction is denied tenant_context", async () => {
    const ownerB = await admin(ctx.tenantB, "owner");
    expect(await run(ctx.tenantB, "session.manage", ownerB, ctx.tenantA)).toEqual({
      allowed: false,
      reason: "tenant_context",
    });
  });

  it("no tenant GUC at all is denied tenant_context (never another tenant's answer)", async () => {
    const owner = await admin(ctx.tenantA, "owner");
    const d = await ctx.appDb.db.transaction((tx) =>
      authorize(tx, { tenantId: ctx.tenantA, action: "session.manage", actorPersonId: owner }),
    );
    expect(d).toEqual({ allowed: false, reason: "tenant_context" });
  });

  it("a malformed app.tenant_id GUC fails closed", async () => {
    const owner = await admin(ctx.tenantA, "owner");
    const d = await ctx.appDb.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.tenant_id', 'not-a-uuid', true)`);
      return authorize(tx, {
        tenantId: ctx.tenantA,
        action: "session.manage",
        actorPersonId: owner,
      });
    });
    expect(d).toEqual({ allowed: false, reason: "tenant_context" });
  });

  it("a non-UUID tenantId is rejected before reaching SQL", async () => {
    await expect(
      ctx.appDb.db.transaction((tx) =>
        authorize(tx, {
          tenantId: "x'; --",
          action: "session.manage",
          actorPersonId: randomUUID(),
        }),
      ),
    ).rejects.toThrow(/UUID/);
  });
});

describe("authorize(): re-check under lock (#28)", () => {
  it("a grant that expires mid-transaction passes the first call and denies the second", async () => {
    const owner = await admin(ctx.tenantA, "owner");
    const co = await admin(ctx.tenantA, "co_admin");
    await grant(ctx.tenantA, co, owner, "money.refund", { expiresIn: "700 milliseconds" });
    await withTenant(ctx.appDb.db, ctx.tenantA, async (tx) => {
      const first = await authorize(tx, {
        tenantId: ctx.tenantA,
        action: "money.refund",
        actorPersonId: co,
      });
      expect(first.allowed).toBe(true);
      await new Promise((r) => setTimeout(r, 1000));
      const second = await authorize(tx, {
        tenantId: ctx.tenantA,
        action: "money.refund",
        actorPersonId: co,
      });
      expect(second).toEqual({ allowed: false, reason: "grant_required" });
    });
  });

  it("holds FOR SHARE on the actor's tenant_admins row until the caller commits", async () => {
    const co = await admin(ctx.tenantA, "co_admin");
    await withTenant(ctx.appDb.db, ctx.tenantA, async (tx) => {
      expect(
        (
          await authorize(tx, {
            tenantId: ctx.tenantA,
            action: "session.manage",
            actorPersonId: co,
          })
        ).allowed,
      ).toBe(true);
      await ctx.owner.query("BEGIN");
      try {
        await ctx.owner.query(`SET LOCAL lock_timeout = '300ms'`);
        await expect(
          ctx.owner.query(
            `UPDATE tenant_admins SET active = false
              WHERE tenant_id = $1 AND platform_user_lookup_hash = $2`,
            [ctx.tenantA, co],
          ),
        ).rejects.toMatchObject({ code: "55P03" });
      } finally {
        await ctx.owner.query("ROLLBACK");
      }
    });
  });
});

describe("authorize(): grant row lock (#28, lock half)", () => {
  it("holds FOR SHARE on the matching grant row until the caller commits", async () => {
    const owner = await admin(ctx.tenantA, "owner");
    const co = await admin(ctx.tenantA, "co_admin");
    const grantId = await grant(ctx.tenantA, co, owner, "money.refund");
    await withTenant(ctx.appDb.db, ctx.tenantA, async (tx) => {
      const d = await authorize(tx, {
        tenantId: ctx.tenantA,
        action: "money.refund",
        actorPersonId: co,
      });
      expect(d.allowed).toBe(true);
      await ctx.owner.query("BEGIN");
      try {
        await ctx.owner.query(`SET LOCAL lock_timeout = '300ms'`);
        await expect(
          ctx.owner.query(
            `UPDATE tenant_capability_grants SET revoked_at = clock_timestamp() WHERE id = $1`,
            [grantId],
          ),
        ).rejects.toMatchObject({ code: "55P03" });
      } finally {
        await ctx.owner.query("ROLLBACK");
      }
    });
  });
});

describe("authorize(): under a NOSUPERUSER NOBYPASSRLS migration owner (0037 D-2 incident class)", () => {
  it("an owner is allowed and a stranger is denied when the definer's owner is subject to FORCE RLS", async () => {
    const nsCtx = await setupNonSuperuserOwnerContext("plexco_authorize_nonsuper");
    let appPool: pg.Pool | undefined;
    try {
      await withJobDefinerLock(process.env.DATABASE_URL_TEST!, async () => {
        await nsCtx.bootstrapJobDefinerForOwner();
        await nsCtx.bootstrapChatDefinerForOwner();
        await nsCtx.runMigration();
      });
      await nsCtx.superuser.query(`ALTER ROLE app WITH LOGIN PASSWORD 'plexco_test_app'`);
      const url = new URL(process.env.DATABASE_URL_TEST!);
      url.pathname = `/${nsCtx.dbName}`;
      url.username = "app";
      url.password = "plexco_test_app";
      appPool = new pg.Pool({ connectionString: url.toString(), max: 2 });

      // Fixtures the production way: a person (owner connection; persons has no runtime grant)
      // and tenant_provision() as `app`, which creates the owner tenant_admins row under FORCE RLS.
      const personRow = await nsCtx.ownerPool.query<{ id: string }>(
        `INSERT INTO persons (display_name) VALUES ('NS Owner') RETURNING id`,
      );
      const stranger = (
        await nsCtx.ownerPool.query<{ id: string }>(
          `INSERT INTO persons (display_name) VALUES ('NS Stranger') RETURNING id`,
        )
      ).rows[0]!.id;
      const ownerPerson = personRow.rows[0]!.id;
      const tenant = (
        await appPool.query<{ id: string }>(
          `SELECT tenant_provision($1, 'NS Club', 'Asia/Ho_Chi_Minh', 'vi', $2::uuid) AS id`,
          [`ns-club-${randomUUID().slice(0, 8)}`, ownerPerson],
        )
      ).rows[0]!.id;

      const decide = async (person: string) => {
        const c = await appPool!.connect();
        try {
          await c.query("BEGIN");
          await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant]);
          const { rows } = await c.query(
            `SELECT allowed, role, reason FROM tenant_capability_authorize($1::uuid, 'session.manage', $2::uuid)`,
            [tenant, person],
          );
          await c.query("ROLLBACK");
          return rows[0] as { allowed: boolean; role: string | null; reason: string | null };
        } finally {
          c.release();
        }
      };
      expect(await decide(ownerPerson)).toEqual({ allowed: true, role: "owner", reason: null });
      expect(await decide(stranger)).toEqual({
        allowed: false,
        role: null,
        reason: "not_a_member",
      });
    } finally {
      await appPool?.end();
      await nsCtx.teardown();
    }
  }, 120_000);
});

describe("authorize(): infrastructure errors are rethrown, never allow", () => {
  it("a failing query propagates", async () => {
    const failing = {
      execute: async () => {
        throw new Error("connection reset");
      },
    } as unknown as Parameters<typeof authorize>[0];
    await expect(
      authorize(failing, {
        tenantId: ctx.tenantA,
        action: "session.manage",
        actorPersonId: randomUUID(),
      }),
    ).rejects.toThrow(/connection reset/);
  });

  it("a malformed result row throws instead of allowing", async () => {
    const bad = {
      execute: async () => ({ rows: [{ allowed: true, role: "superuser", reason: null }] }),
    } as unknown as Parameters<typeof authorize>[0];
    await expect(
      authorize(bad, {
        tenantId: ctx.tenantA,
        action: "session.manage",
        actorPersonId: randomUUID(),
      }),
    ).rejects.toThrow(/recognised role/);
  });
});

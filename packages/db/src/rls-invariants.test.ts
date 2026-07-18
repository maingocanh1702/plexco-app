import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sessions } from "../schema.js";
import { tenantRepo, withTenant } from "./tenant.js";
import {
  expectErrorChainToMatch,
  setupRlsTestContext,
  type RlsTestContext,
} from "./test-harness.js";

/**
 * KEYSTONE invariant suite (INV-1/INV-3, HR1/HR2, BL-TEN-1/2, DD-12).
 * Every test name states the invariant it protects. Connections run as the
 * REAL runtime roles (app / readonly), never superuser.
 */

let ctx: RlsTestContext;

beforeAll(async () => {
  ctx = await setupRlsTestContext("plexco_rls_check");
}, 120_000);

afterAll(async () => {
  await ctx?.teardown();
});

const createIn = (tenantId: string, startHour: number) =>
  tenantRepo(ctx.appDb.db, tenantId).sessions.create({
    sportId: ctx.badmintonSportId,
    startsAt: new Date(`2026-07-10T${String(startHour).padStart(2, "0")}:00:00Z`),
    endsAt: new Date(`2026-07-10T${String(startHour + 2).padStart(2, "0")}:00:00Z`),
    timezone: "Asia/Ho_Chi_Minh",
    priceAmount: 110000,
    status: "open",
  });

describe("migrations", () => {
  it("apply clean on a fresh database and are idempotent on re-run", async () => {
    expect(ctx.migrateResult.applied.length).toBe(15); // 0000..0014
    const second = await ctx.remigrate();
    expect(second.applied).toEqual([]);
    expect(second.skipped.length).toBe(15);
  });

  it("RLS is FORCED on every tenant-scoped table (silent-rollback guard)", async () => {
    const { rows } = await ctx.owner.query(
      `SELECT relname FROM pg_class c
       WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace
         AND relrowsecurity AND relforcerowsecurity`,
    );
    const forced = new Set(rows.map((r: { relname: string }) => r.relname));
    for (const t of [
      "sessions",
      "players",
      "memberships",
      "charges",
      "bank_transactions",
      "payment_allocations",
      "bank_accounts",
      "outbox_events",
      "processed_commands",
      "join_requests",
      "subscriptions",
      "session_occurrences",
      "onboarding_steps",
    ]) {
      expect(forced.has(t), `${t} must have ENABLE+FORCE RLS`).toBe(true);
    }
  });
});

describe("tenant isolation (INV-1: security boundary, not a filter)", () => {
  it("tenant A's sessions are invisible to tenant B through the repo", async () => {
    const created = await createIn(ctx.tenantA, 10);
    expect(created.tenantId).toBe(ctx.tenantA);

    const seenByB = await tenantRepo(ctx.appDb.db, ctx.tenantB).sessions.list();
    expect(seenByB.find((s) => s.id === created.id)).toBeUndefined();

    const cross = await tenantRepo(ctx.appDb.db, ctx.tenantB).sessions.getById(created.id);
    expect(cross).toBeNull();

    const seenByA = await tenantRepo(ctx.appDb.db, ctx.tenantA).sessions.list();
    expect(seenByA.some((s) => s.id === created.id)).toBe(true);
  });

  it("a tenant-A context cannot write a row claiming tenant B (WITH CHECK)", async () => {
    await expectErrorChainToMatch(
      withTenant(ctx.appDb.db, ctx.tenantA, (tx) =>
        tx.insert(sessions).values({
          tenantId: ctx.tenantB, // spoof attempt
          sportId: ctx.badmintonSportId,
          startsAt: new Date("2026-07-11T10:00:00Z"),
          endsAt: new Date("2026-07-11T12:00:00Z"),
          timezone: "Asia/Ho_Chi_Minh",
        }),
      ),
      /row-level security/i,
    );
  });

  it("a wrong-but-valid tenant id sees nothing it does not own", async () => {
    const ghost = "00000000-0000-4000-8000-000000000000";
    const rows = await tenantRepo(ctx.appDb.db, ghost).sessions.list();
    expect(rows).toEqual([]);
  });
});

describe("fail-closed without tenant context (BL-TEN-1)", () => {
  it("app-role reads OUTSIDE withTenant return 0 rows even though rows exist", async () => {
    await createIn(ctx.tenantA, 14);
    // plain pool query — no transaction, no GUC
    const { rows } = await ctx.appPool.query(`SELECT id FROM sessions`);
    expect(rows).toEqual([]);
  });

  it("app-role writes OUTSIDE withTenant are rejected", async () => {
    await expect(
      ctx.appPool.query(
        `INSERT INTO sessions (tenant_id, sport_id, starts_at, ends_at, timezone)
         VALUES ($1, $2, now(), now() + interval '2 hours', 'Asia/Ho_Chi_Minh')`,
        [ctx.tenantA, ctx.badmintonSportId],
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("pool reuse never leaks a previous SET LOCAL tenant context", async () => {
    // exhaust the pool with tenant-A transactions so every connection has
    // carried the GUC at least once…
    await Promise.all([createIn(ctx.tenantA, 16), createIn(ctx.tenantA, 18)]);
    // …then every bare read on those same reused connections still sees nothing
    for (let i = 0; i < 8; i++) {
      const { rows } = await ctx.appPool.query(`SELECT id FROM sessions`);
      expect(rows).toEqual([]);
    }
  });
});

describe("public read model (INV-3 / HR2 / DD-12)", () => {
  it("public_sessions columns are EXACTLY the approved whitelist", async () => {
    const { rows } = await ctx.owner.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'public_sessions'`,
    );
    const cols = rows.map((r: { column_name: string }) => r.column_name).sort();
    expect(cols).toEqual(
      [
        "id",
        "session_id",
        "tenant_id",
        "sport_key",
        "starts_at",
        "ends_at",
        "area",
        "skill_level",
        "price_amount",
        "slots_open",
        "club_display_name",
        "host_display_name",
        "join_policy",
        "projected_at",
        "expires_at",
      ].sort(),
    );
  });

  it("no public column smells like money/PII/roster", async () => {
    const { rows } = await ctx.owner.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'public_sessions'
         AND column_name ~* '(phone|email|debt|paid|roster|member|account|secret|token|venue_address)'`,
    );
    expect(rows).toEqual([]);
  });

  it("readonly role reads public_sessions but has ZERO grant on canonical tables", async () => {
    await expect(
      ctx.readonlyPool.query(`SELECT count(*) FROM public_sessions`),
    ).resolves.toBeTruthy();
    for (const table of ["sessions", "charges", "memberships", "bank_transactions", "persons"]) {
      await expect(
        ctx.readonlyPool.query(`SELECT * FROM ${table} LIMIT 1`),
        `readonly must be denied on ${table}`,
      ).rejects.toThrow(/permission denied/i);
    }
  });

  it("app role has NO grant on protected global identity tables", async () => {
    for (const table of ["persons", "channel_identities", "link_codes", "merge_audit"]) {
      await expect(
        ctx.appPool.query(`SELECT * FROM ${table} LIMIT 1`),
        `app must be denied on ${table}`,
      ).rejects.toThrow(/permission denied/i);
    }
  });
});

describe("dual-parent child rows (session_occurrences)", () => {
  it("tenant A cannot attach its recurrence rule to tenant B's session", async () => {
    const { sessionRecurrenceRules, sessionOccurrences } = await import("../schema.js");
    // A's rule, B's session
    const ruleA = await withTenant(ctx.appDb.db, ctx.tenantA, async (tx) => {
      const rows = await tx
        .insert(sessionRecurrenceRules)
        .values({ tenantId: ctx.tenantA, rrule: "FREQ=WEEKLY", timezone: "Asia/Ho_Chi_Minh" })
        .returning();
      return rows[0]!;
    });
    const sessionB = await createIn(ctx.tenantB, 20);

    await expectErrorChainToMatch(
      withTenant(ctx.appDb.db, ctx.tenantA, (tx) =>
        tx.insert(sessionOccurrences).values({
          recurrenceRuleId: ruleA.id,
          sessionId: sessionB.id, // cross-tenant link attempt
          localOccurrenceKey: "2026-07-17",
        }),
      ),
      /row-level security/i,
    );

    // same-tenant link works
    const sessionA = await createIn(ctx.tenantA, 8);
    await withTenant(ctx.appDb.db, ctx.tenantA, (tx) =>
      tx.insert(sessionOccurrences).values({
        recurrenceRuleId: ruleA.id,
        sessionId: sessionA.id,
        localOccurrenceKey: "2026-07-18",
      }),
    );
  });
});

describe("choke-point hygiene", () => {
  it("withTenant refuses a non-UUID tenant id (routing must supply it)", async () => {
    await expect(
      withTenant(ctx.appDb.db, "1 OR 1=1" as string, async () => undefined),
    ).rejects.toThrow(/UUID/);
  });
});

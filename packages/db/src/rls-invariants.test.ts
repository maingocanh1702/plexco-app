import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  aliases,
  charges,
  joinRequests,
  players,
  sessions,
  sessionSurfaceRefs,
} from "../schema.js";
import { migrate } from "./migrate.js";
import { tenantRepo, withTenant } from "./tenant.js";
import {
  expectErrorChainToMatch,
  setupRlsTestContext,
  type RlsTestContext,
} from "./test-harness.js";

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");

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
    expect(ctx.migrateResult.applied.length).toBe(20); // 0000..0019 (0019 = DD-68 tenant-integrity FKs)
    const second = await ctx.remigrate();
    expect(second.applied).toEqual([]);
    expect(second.skipped.length).toBe(20);
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
    for (const table of [
      "persons",
      "channel_identities",
      "link_codes",
      "merge_audit",
      "auth_audit_events",
      // 0016 email-token-core tables are function-only (code dark) — zero app grant.
      "account_emails",
      "email_password_credentials",
      "auth_pending_email_registrations",
      "auth_email_tokens",
      "auth_email_deliveries",
    ]) {
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

/**
 * DD-68 tenant-integrity composite FKs (migration 0019).
 *
 * The money-path children reference their parents by single-column FK only, so
 * `players(tenant_id = B, session_id = <A's session>)` proves the session
 * EXISTS but not that it belongs to tenant B. 0019 adds a composite FK
 * `(tenant_id, fk_id) -> parent(tenant_id, id)` per relationship so that row is
 * unrepresentable at the DB — the HR1 fail-closed choke-point. RI checks are not
 * subject to RLS, so the constraint holds on the real `app`-role runtime path,
 * not just for a superuser.
 *
 * Parents (persons/memberships/sessions/players used as FK targets) are seeded
 * via the owner connection; the write UNDER TEST always runs as the `app` role
 * through withTenant, per TI-1's "real runtime path" requirement.
 */
async function ownerInsertId(text: string, params: unknown[] = []): Promise<string> {
  const { rows } = await ctx.owner.query(text, params);
  return (rows[0] as { id: string }).id;
}
const makePerson = () =>
  ownerInsertId(`INSERT INTO persons (display_name) VALUES ('ti-fixture') RETURNING id`);
async function makeMembership(tenantId: string): Promise<string> {
  const personId = await makePerson();
  return ownerInsertId(
    `INSERT INTO memberships (tenant_id, person_id, status) VALUES ($1, $2, 'active') RETURNING id`,
    [tenantId, personId],
  );
}
const makeSession = (tenantId: string) =>
  ownerInsertId(
    `INSERT INTO sessions (tenant_id, sport_id, starts_at, ends_at, timezone)
     VALUES ($1, $2, now(), now() + interval '2 hours', 'Asia/Ho_Chi_Minh') RETURNING id`,
    [tenantId, ctx.badmintonSportId],
  );
const makePlayer = (tenantId: string, sessionId: string, membershipId: string) =>
  ownerInsertId(
    `INSERT INTO players (tenant_id, session_id, membership_id) VALUES ($1, $2, $3) RETURNING id`,
    [tenantId, sessionId, membershipId],
  );

describe("tenant-integrity composite FKs (DD-68 / TI-1..TI-5, TI-9)", () => {
  // Same-tenant fixtures in A and B; the cross-tenant writes below reference them.
  let sessionA: string;
  let sessionB: string;
  let membershipA: string;
  let membershipB: string;
  let playerA: string; // a real player in A, referenced cross-tenant from a B charge
  let playerB: string; // a real player in B, so charges can isolate a single cross leg
  let personX: string;

  beforeAll(async () => {
    sessionA = await makeSession(ctx.tenantA);
    sessionB = await makeSession(ctx.tenantB);
    membershipA = await makeMembership(ctx.tenantA);
    membershipB = await makeMembership(ctx.tenantB);
    playerA = await makePlayer(ctx.tenantA, sessionA, membershipA);
    playerB = await makePlayer(ctx.tenantB, sessionB, membershipB);
    personX = await makePerson();
  }, 60_000);

  it("TI-1: every composite FK rejects a cross-tenant child insert via the app role (withTenant)", async () => {
    // 1. session_surface_refs (tenant_id, session_id) — session belongs to A
    await expectErrorChainToMatch(
      withTenant(ctx.appDb.db, ctx.tenantB, (tx) =>
        tx.insert(sessionSurfaceRefs).values({
          tenantId: ctx.tenantB,
          sessionId: sessionA,
          platform: "web",
          target: "t-ti1",
        }),
      ),
      /session_surface_refs_tenant_session_fk/,
    );
    // 2. players (tenant_id, session_id) — membership leg same-tenant (B) isolates the session leg
    await expectErrorChainToMatch(
      withTenant(ctx.appDb.db, ctx.tenantB, (tx) =>
        tx
          .insert(players)
          .values({ tenantId: ctx.tenantB, sessionId: sessionA, membershipId: membershipB }),
      ),
      /players_tenant_session_fk/,
    );
    // 3. players (tenant_id, membership_id) — session leg same-tenant (B) isolates the membership leg
    await expectErrorChainToMatch(
      withTenant(ctx.appDb.db, ctx.tenantB, (tx) =>
        tx
          .insert(players)
          .values({ tenantId: ctx.tenantB, sessionId: sessionB, membershipId: membershipA }),
      ),
      /players_tenant_membership_fk/,
    );
    // 4. charges (tenant_id, session_id) — player leg same-tenant (B), membership NULL
    await expectErrorChainToMatch(
      withTenant(ctx.appDb.db, ctx.tenantB, (tx) =>
        tx.insert(charges).values({
          tenantId: ctx.tenantB,
          sessionId: sessionA,
          playerId: playerB,
          amountDue: 100000,
        }),
      ),
      /charges_tenant_session_fk/,
    );
    // 5. charges (tenant_id, membership_id) — session leg same-tenant (B), membership cross (A)
    await expectErrorChainToMatch(
      withTenant(ctx.appDb.db, ctx.tenantB, (tx) =>
        tx.insert(charges).values({
          tenantId: ctx.tenantB,
          sessionId: sessionB,
          playerId: playerB,
          membershipId: membershipA,
          amountDue: 100000,
        }),
      ),
      /charges_tenant_membership_fk/,
    );
    // 5b. charges (tenant_id, player_id) — session leg same-tenant (B), membership NULL, player cross (A)
    await expectErrorChainToMatch(
      withTenant(ctx.appDb.db, ctx.tenantB, (tx) =>
        tx.insert(charges).values({
          tenantId: ctx.tenantB,
          sessionId: sessionB,
          playerId: playerA,
          amountDue: 100000,
        }),
      ),
      /charges_tenant_player_fk/,
    );
    // 6. join_requests (tenant_id, session_id)
    await expectErrorChainToMatch(
      withTenant(ctx.appDb.db, ctx.tenantB, (tx) =>
        tx.insert(joinRequests).values({
          tenantId: ctx.tenantB,
          sessionId: sessionA,
          personId: personX,
          expiresAt: new Date(Date.now() + 3_600_000),
        }),
      ),
      /join_requests_tenant_session_fk/,
    );
    // 7. aliases (tenant_id, membership_id)
    await expectErrorChainToMatch(
      withTenant(ctx.appDb.db, ctx.tenantB, (tx) =>
        tx
          .insert(aliases)
          .values({ tenantId: ctx.tenantB, membershipId: membershipA, aliasNorm: "ti1-x" }),
      ),
      /aliases_tenant_membership_fk/,
    );
  });

  it("TI-2: legitimate same-tenant writes still succeed via the app role", async () => {
    const sA = await makeSession(ctx.tenantA);
    const mA = await makeMembership(ctx.tenantA);
    const created = await withTenant(ctx.appDb.db, ctx.tenantA, async (tx) => {
      const rows = await tx
        .insert(players)
        .values({ tenantId: ctx.tenantA, sessionId: sA, membershipId: mA })
        .returning();
      return rows[0]!;
    });
    expect(created.tenantId).toBe(ctx.tenantA);
    // a same-tenant charge WITH a membership set (both composite legs enforced) also succeeds
    await withTenant(ctx.appDb.db, ctx.tenantA, (tx) =>
      tx.insert(charges).values({
        tenantId: ctx.tenantA,
        sessionId: sA,
        playerId: created.id,
        membershipId: mA,
        amountDue: 50000,
      }),
    );
  });

  it("TI-3: charges.membership_id NULL is accepted (MATCH SIMPLE); a foreign-tenant membership is rejected", async () => {
    const sA = await makeSession(ctx.tenantA);
    const mA = await makeMembership(ctx.tenantA);
    const playerA = await withTenant(ctx.appDb.db, ctx.tenantA, async (tx) => {
      const rows = await tx
        .insert(players)
        .values({ tenantId: ctx.tenantA, sessionId: sA, membershipId: mA })
        .returning();
      return rows[0]!.id;
    });
    // membership_id NULL -> composite unenforced -> succeeds (preserves "charge without membership")
    await withTenant(ctx.appDb.db, ctx.tenantA, (tx) =>
      tx
        .insert(charges)
        .values({ tenantId: ctx.tenantA, sessionId: sA, playerId: playerA, amountDue: 25000 }),
    );
    // a distinct session/player (the charges unique is (tenant, session, player)) with a foreign membership -> rejected
    const sA2 = await makeSession(ctx.tenantA);
    const playerA2 = await withTenant(ctx.appDb.db, ctx.tenantA, async (tx) => {
      const rows = await tx
        .insert(players)
        .values({ tenantId: ctx.tenantA, sessionId: sA2, membershipId: mA })
        .returning();
      return rows[0]!.id;
    });
    await expectErrorChainToMatch(
      withTenant(ctx.appDb.db, ctx.tenantA, (tx) =>
        tx.insert(charges).values({
          tenantId: ctx.tenantA,
          sessionId: sA2,
          playerId: playerA2,
          membershipId: membershipB, // foreign tenant
          amountDue: 25000,
        }),
      ),
      /charges_tenant_membership_fk/,
    );
  });

  it("TI-4: sessions and memberships each carry a UNIQUE (tenant_id, id) candidate key (pg_constraint)", async () => {
    for (const [table, conname] of [
      ["sessions", "sessions_tenant_id_candidate_key"],
      ["memberships", "memberships_tenant_id_candidate_key"],
      ["players", "players_tenant_id_candidate_key"],
    ] as const) {
      const { rows } = await ctx.owner.query(
        // attname is of type `name`; cast to text so array_agg returns text[]
        // (which node-pg parses to a JS array) rather than an unparsed name[].
        `SELECT (SELECT array_agg(a.attname::text ORDER BY k.ord)
                   FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
                   JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS cols
           FROM pg_constraint c
          WHERE c.conrelid = $1::regclass AND c.contype = 'u' AND c.conname = $2`,
        [table, conname],
      );
      expect(rows.length, `${conname} must exist as a UNIQUE constraint`).toBe(1);
      expect((rows[0] as { cols: string[] }).cols).toEqual(["tenant_id", "id"]);
    }
  });

  it("TI-5: every pre-0019 single-column money-path FK still exists (ON DELETE unchanged)", async () => {
    const singleColFkCount = async (
      child: string,
      col: string,
      parent: string,
    ): Promise<number> => {
      const { rows } = await ctx.owner.query(
        `SELECT 1 FROM pg_constraint c
          WHERE c.conrelid = $1::regclass AND c.contype = 'f'
            AND c.confrelid = $3::regclass
            AND array_length(c.conkey, 1) = 1
            AND (SELECT a.attname FROM pg_attribute a
                  WHERE a.attrelid = c.conrelid AND a.attnum = c.conkey[1]) = $2`,
        [child, col, parent],
      );
      return rows.length;
    };
    for (const [child, col, parent] of [
      ["session_surface_refs", "session_id", "sessions"],
      ["players", "session_id", "sessions"],
      ["players", "membership_id", "memberships"],
      ["charges", "session_id", "sessions"],
      ["charges", "membership_id", "memberships"],
      ["charges", "player_id", "players"],
      ["join_requests", "session_id", "sessions"],
      ["aliases", "membership_id", "memberships"],
    ] as const) {
      expect(
        await singleColFkCount(child, col, parent),
        `${child}.${col} single-column FK -> ${parent} must survive 0019`,
      ).toBe(1);
    }
  });

  it("TI-9: session_occurrences gains no tenant_id column and no composite FK", async () => {
    const col = await ctx.owner.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'session_occurrences' AND column_name = 'tenant_id'`,
    );
    expect(col.rows.length, "session_occurrences must NOT have a tenant_id column").toBe(0);
    const compositeFk = await ctx.owner.query(
      `SELECT conname FROM pg_constraint
        WHERE conrelid = 'session_occurrences'::regclass AND contype = 'f' AND array_length(conkey, 1) > 1`,
    );
    expect(compositeFk.rows, "session_occurrences must have NO composite FK").toEqual([]);
  });
});

/**
 * TI-6 (probe named-halt) + TI-7 (immutability) exercise migration 0019
 * DIRECTLY against throwaway databases, using the REAL migration file bytes:
 *   - TI-6 applies 0000..0018, seeds a cross-tenant players row, then applies
 *     0019 and asserts the wrapped VALIDATE RAISEs a NAMED halt (table +
 *     relationship + offending key) and rolls back cleanly — proving 0019 halts
 *     an owner rather than aborting mid-way or silently deleting/re-parenting.
 *   - TI-7 applies 0000..0019 through the real runner, proves every recorded
 *     sha256 equals the on-disk file (0000..0018 byte-identical after 0019), and
 *     that a tampered applied file is still hard-rejected.
 * Own superuser connection + uniquely-named databases (vitest fileParallelism).
 */
describe("tenant-integrity migration 0019 direct behaviour (TI-6 probe halt · TI-7 immutability)", () => {
  const BASE = process.env.DATABASE_URL_TEST;
  let admin: pg.Client;

  const url = (db: string): string => {
    const u = new URL(BASE!);
    u.pathname = `/${db}`;
    return u.toString();
  };
  const connect = async (cs: string): Promise<pg.Client> => {
    const c = new pg.Client({ connectionString: cs });
    await c.connect();
    return c;
  };

  beforeAll(async () => {
    if (!BASE)
      throw new Error("DATABASE_URL_TEST is required for the tenant-integrity migration suite");
    admin = await connect(BASE);
  }, 120_000);

  afterAll(async () => {
    await admin?.end();
  });

  it("TI-6: applying 0019 over a pre-existing cross-tenant players row raises a NAMED halt (table + row id)", async () => {
    const dbName = "plexco_ti6_probe_check";
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${dbName}`);
    const c = await connect(url(dbName));
    try {
      // apply every migration BEFORE 0019 (numeric prefix < 19), in filename order
      const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
      for (const f of files) {
        if (Number.parseInt(f.slice(0, 4), 10) >= 19) continue;
        await c.query(await readFile(path.join(MIGRATIONS_DIR, f), "utf8"));
      }
      // seed a cross-tenant players row: tenant B, session belonging to A.
      // Single-column FKs are satisfied (both parents exist); no composite FK yet.
      const t = await c.query(
        `INSERT INTO tenants (name, slug, status)
         VALUES ('TI6 A', 'ti6-a', 'active'), ('TI6 B', 'ti6-b', 'active') RETURNING id`,
      );
      const tA = (t.rows[0] as { id: string }).id;
      const tB = (t.rows[1] as { id: string }).id;
      const person = await c.query(
        `INSERT INTO persons (display_name) VALUES ('ti6') RETURNING id`,
      );
      const membB = await c.query(
        `INSERT INTO memberships (tenant_id, person_id, status) VALUES ($1, $2, 'active') RETURNING id`,
        [tB, (person.rows[0] as { id: string }).id],
      );
      const sport = await c.query(`SELECT id FROM sports WHERE key = 'badminton'`);
      const sessA = await c.query(
        `INSERT INTO sessions (tenant_id, sport_id, starts_at, ends_at, timezone)
         VALUES ($1, $2, now(), now() + interval '2 hours', 'Asia/Ho_Chi_Minh') RETURNING id`,
        [tA, (sport.rows[0] as { id: string }).id],
      );
      const sessAId = (sessA.rows[0] as { id: string }).id;
      await c.query(
        `INSERT INTO players (tenant_id, session_id, membership_id) VALUES ($1, $2, $3)`,
        [tB, sessAId, (membB.rows[0] as { id: string }).id],
      );

      // apply 0019 — the wrapped VALIDATE must halt with a NAMED error
      const sql0019 = await readFile(
        path.join(MIGRATIONS_DIR, "0019_tenant_integrity_fks.sql"),
        "utf8",
      );
      let err: unknown;
      await c.query("BEGIN");
      try {
        await c.query(sql0019);
      } catch (e) {
        err = e;
      }
      await c.query("ROLLBACK");

      const msg = String((err as Error | undefined)?.message ?? err);
      expect(msg).toMatch(/tenant-integrity halt \(0019\)/);
      expect(msg).toMatch(/\bplayers\b/);
      expect(msg).toContain("(tenant_id, session_id)");
      // the offending cross-tenant key — tenant B pointing at tenant A's session — is surfaced
      expect(msg).toContain(sessAId);
      expect(msg).toContain(tB);

      // rolled back cleanly — the composite constraint was NOT left behind
      const left = await c.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'players_tenant_session_fk'`,
      );
      expect(left.rows.length).toBe(0);
    } finally {
      await c.end();
      await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    }
  }, 120_000);

  it("TI-7: 0000..0018 stay byte-identical after 0019 applies, and a tampered applied file is rejected", async () => {
    const dbName = "plexco_ti7_immut_check";
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${dbName}`);
    try {
      const res = await migrate(url(dbName));
      expect(res.applied.length).toBe(20); // 0000..0019

      const c = await connect(url(dbName));
      try {
        const { rows } = await c.query(`SELECT name, sha256 FROM schema_migrations ORDER BY name`);
        expect(rows.length).toBe(20);
        for (const row of rows as { name: string; sha256: string }[]) {
          const disk = createHash("sha256")
            .update(await readFile(path.join(MIGRATIONS_DIR, row.name), "utf8"))
            .digest("hex");
          expect(row.sha256, `${row.name} recorded sha must equal the on-disk file`).toBe(disk);
        }
        // tamper an already-applied file's recorded hash → the runner hard-errors on the next run
        await c.query(
          `UPDATE schema_migrations SET sha256 = 'tampered' WHERE name = '0014_players_waitlist.sql'`,
        );
      } finally {
        await c.end();
      }
      await expect(migrate(url(dbName))).rejects.toThrow(/changed after being applied/);
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    }
  }, 120_000);
});

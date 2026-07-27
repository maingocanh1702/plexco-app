import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  aliases,
  bankAccounts,
  bankTransactions,
  charges,
  joinRequests,
  memberships,
  notificationDeliveries,
  outboxEvents,
  paymentAllocations,
  players,
  sessions,
  sessionSurfaceRefs,
  zaloReplyContexts,
} from "../schema.js";
import { migrate } from "./migrate.js";
import { tenantRepo, withTenant } from "./tenant.js";
import {
  bootstrapJobDefiner,
  expectErrorChainToMatch,
  setupNonSuperuserOwnerContext,
  setupRlsTestContext,
  withJobDefinerLock,
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
    expect(ctx.migrateResult.applied.length).toBe(25); // 0000..0024 (0024 = public-visibility-capacity-check)
    const second = await ctx.remigrate();
    expect(second.applied).toEqual([]);
    expect(second.skipped.length).toBe(25);
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
/* Ledger fixtures (0020). Parents are seeded via the owner connection like the
 * session-domain makers above; the write UNDER TEST always runs as `app`. */
const makeProviderConnection = (tenantId: string) =>
  ownerInsertId(
    `INSERT INTO provider_connections (tenant_id, provider, auth_mode)
     VALUES ($1, 'sepay', 'api_key') RETURNING id`,
    [tenantId],
  );
const makeBankAccount = (tenantId: string, fingerprint: string) =>
  ownerInsertId(
    `INSERT INTO bank_accounts
       (tenant_id, provider, account_number_enc, account_fingerprint, webhook_token, webhook_secret_enc)
     VALUES ($1, 'sepay', $2, $3, $4, $2) RETURNING id`,
    [tenantId, Buffer.from("ti-enc"), fingerprint, `wh-${fingerprint}`],
  );
const makeBankTxn = (tenantId: string, bankAccountId: string, externalId: string) =>
  ownerInsertId(
    `INSERT INTO bank_transactions
       (tenant_id, bank_account_id, provider, external_id, amount, unallocated_amount, occurred_at, raw_payload_enc)
     VALUES ($1, $2, 'sepay', $3, 100000, 100000, now(), $4) RETURNING id`,
    [tenantId, bankAccountId, externalId, Buffer.from("ti-raw")],
  );
const makeCharge = (tenantId: string, sessionId: string, playerId: string) =>
  ownerInsertId(
    `INSERT INTO charges (tenant_id, session_id, player_id, amount_due)
     VALUES ($1, $2, $3, 100000) RETURNING id`,
    [tenantId, sessionId, playerId],
  );
const makeCashAllocation = (tenantId: string, chargeId: string, createdBy: string) =>
  ownerInsertId(
    `INSERT INTO payment_allocations (tenant_id, charge_id, amount, source, created_by)
     VALUES ($1, $2, 50000, 'cash', $3) RETURNING id`,
    [tenantId, chargeId, createdBy],
  );
/* Non-money (Zalo/notification) fixtures (0021). Parents are seeded via the
 * owner connection like the session-domain/ledger makers above; the write
 * UNDER TEST always runs as `app`. zalo_bots.tenant_id is UNIQUE (one bot per
 * tenant), so each tenant gets exactly one bot fixture. */
const makeZaloBot = (tenantId: string, webhookToken: string) =>
  ownerInsertId(
    `INSERT INTO zalo_bots (tenant_id, bot_token_enc, webhook_token) VALUES ($1, 'nmti-token', $2) RETURNING id`,
    [tenantId, webhookToken],
  );
const makeNotificationIntent = (tenantId: string, personId: string, intentKey: string) =>
  ownerInsertId(
    `INSERT INTO notification_intents (tenant_id, type, aggregate_id, state_version, person_id, intent_key)
     VALUES ($1, 'reminder', gen_random_uuid(), 1, $2, $3) RETURNING id`,
    [tenantId, personId, intentKey],
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
 * DD-68 ledger tenant-integrity composite FKs (migration 0020) — the deferred
 * payment-ledger leg 0019's header documents. Same mechanism, one level deeper:
 * bank_transactions -> bank_accounts, payment_allocations -> charges /
 * bank_transactions / payment_allocations (reversal self-reference), and
 * bank_accounts -> provider_connections. Fixtures seed same-tenant parents via
 * the owner connection; the write UNDER TEST always runs as the `app` role
 * through withTenant (TI-1's "real runtime path" requirement).
 */
describe("ledger tenant-integrity composite FKs (0020 / LTI-1..LTI-5)", () => {
  let provConnA: string;
  let bankAccountA: string;
  let bankTxnA: string;
  let chargeA: string;
  let allocA: string; // a real allocation in A, referenced cross-tenant from a B reversal
  let chargeB: string; // a real charge in B, so allocations can isolate a single cross leg
  let actorPerson: string;

  beforeAll(async () => {
    actorPerson = await makePerson();
    provConnA = await makeProviderConnection(ctx.tenantA);
    bankAccountA = await makeBankAccount(ctx.tenantA, "lti-fp-a");
    bankTxnA = await makeBankTxn(ctx.tenantA, bankAccountA, "lti-ext-a");
    const sessA = await makeSession(ctx.tenantA);
    const membA = await makeMembership(ctx.tenantA);
    const playA = await makePlayer(ctx.tenantA, sessA, membA);
    chargeA = await makeCharge(ctx.tenantA, sessA, playA);
    allocA = await makeCashAllocation(ctx.tenantA, chargeA, actorPerson);
    const sessB = await makeSession(ctx.tenantB);
    const membB = await makeMembership(ctx.tenantB);
    const playB = await makePlayer(ctx.tenantB, sessB, membB);
    chargeB = await makeCharge(ctx.tenantB, sessB, playB);
  }, 60_000);

  it("LTI-1: every 0020 composite FK rejects a cross-tenant child insert via the app role (withTenant)", async () => {
    // 1. bank_transactions (tenant_id, bank_account_id) — account belongs to A
    await expectErrorChainToMatch(
      withTenant(ctx.appDb.db, ctx.tenantB, (tx) =>
        tx.insert(bankTransactions).values({
          tenantId: ctx.tenantB,
          bankAccountId: bankAccountA,
          provider: "sepay",
          externalId: "lti1-ext-b",
          amount: 100000,
          unallocatedAmount: 100000,
          occurredAt: new Date(),
          rawPayloadEnc: Buffer.from("lti1"),
        }),
      ),
      /bank_transactions_tenant_bank_account_fk/,
    );
    // 2. payment_allocations (tenant_id, charge_id) — cash keeps the bank and
    //    reverses legs NULL so only the charge leg can fire
    await expectErrorChainToMatch(
      withTenant(ctx.appDb.db, ctx.tenantB, (tx) =>
        tx.insert(paymentAllocations).values({
          tenantId: ctx.tenantB,
          chargeId: chargeA,
          amount: 50000,
          source: "cash",
          createdBy: actorPerson,
        }),
      ),
      /payment_allocations_tenant_charge_fk/,
    );
    // 3. payment_allocations (tenant_id, bank_transaction_id) — charge leg
    //    same-tenant (B) isolates the bank-transaction leg (A)
    await expectErrorChainToMatch(
      withTenant(ctx.appDb.db, ctx.tenantB, (tx) =>
        tx.insert(paymentAllocations).values({
          tenantId: ctx.tenantB,
          chargeId: chargeB,
          bankTransactionId: bankTxnA,
          amount: 50000,
          source: "auto",
        }),
      ),
      /payment_allocations_tenant_bank_transaction_fk/,
    );
    // 4. payment_allocations (tenant_id, reverses_allocation_id) — charge leg
    //    same-tenant (B), reversal points at A's allocation
    await expectErrorChainToMatch(
      withTenant(ctx.appDb.db, ctx.tenantB, (tx) =>
        tx.insert(paymentAllocations).values({
          tenantId: ctx.tenantB,
          chargeId: chargeB,
          amount: -50000,
          source: "reversal",
          reversesAllocationId: allocA,
        }),
      ),
      /payment_allocations_tenant_reverses_allocation_fk/,
    );
    // 5. bank_accounts (tenant_id, provider_connection_id) — connection is A's
    await expectErrorChainToMatch(
      withTenant(ctx.appDb.db, ctx.tenantB, (tx) =>
        tx.insert(bankAccounts).values({
          tenantId: ctx.tenantB,
          provider: "sepay",
          accountNumberEnc: Buffer.from("lti1-num"),
          accountFingerprint: "lti1-fp-b",
          webhookToken: "lti1-wh-b",
          webhookSecretEnc: Buffer.from("lti1-sec"),
          providerConnectionId: provConnA,
        }),
      ),
      /bank_accounts_tenant_provider_connection_fk/,
    );
  });

  it("LTI-2: a legitimate same-tenant ledger chain succeeds via the app role", async () => {
    const provConnB = await makeProviderConnection(ctx.tenantB);
    // bank account WITH its own tenant's provider connection (enforced leg, match)
    const bankAccountB = await withTenant(ctx.appDb.db, ctx.tenantB, async (tx) => {
      const rows = await tx
        .insert(bankAccounts)
        .values({
          tenantId: ctx.tenantB,
          provider: "sepay",
          accountNumberEnc: Buffer.from("lti2-num"),
          accountFingerprint: "lti2-fp-b",
          webhookToken: "lti2-wh-b",
          webhookSecretEnc: Buffer.from("lti2-sec"),
          providerConnectionId: provConnB,
        })
        .returning();
      return rows[0]!.id;
    });
    const bankTxnB = await withTenant(ctx.appDb.db, ctx.tenantB, async (tx) => {
      const rows = await tx
        .insert(bankTransactions)
        .values({
          tenantId: ctx.tenantB,
          bankAccountId: bankAccountB,
          provider: "sepay",
          externalId: "lti2-ext-b",
          amount: 100000,
          unallocatedAmount: 100000,
          occurredAt: new Date(),
          rawPayloadEnc: Buffer.from("lti2"),
        })
        .returning();
      return rows[0]!.id;
    });
    // auto allocation binds an all-same-tenant charge + bank transaction
    await withTenant(ctx.appDb.db, ctx.tenantB, (tx) =>
      tx.insert(paymentAllocations).values({
        tenantId: ctx.tenantB,
        chargeId: chargeB,
        bankTransactionId: bankTxnB,
        amount: 50000,
        source: "auto",
      }),
    );
    // cash allocation, then a same-tenant reversal referencing it
    const cashAllocB = await withTenant(ctx.appDb.db, ctx.tenantB, async (tx) => {
      const rows = await tx
        .insert(paymentAllocations)
        .values({
          tenantId: ctx.tenantB,
          chargeId: chargeB,
          amount: 25000,
          source: "cash",
          createdBy: actorPerson,
        })
        .returning();
      return rows[0]!.id;
    });
    await withTenant(ctx.appDb.db, ctx.tenantB, (tx) =>
      tx.insert(paymentAllocations).values({
        tenantId: ctx.tenantB,
        chargeId: chargeB,
        amount: -25000,
        source: "reversal",
        reversesAllocationId: cashAllocB,
      }),
    );
  });

  it("LTI-3: NULL fk legs stay accepted (MATCH SIMPLE) — pre-onboarding bank account, cash allocation", async () => {
    // bank account BEFORE connector onboarding: provider_connection_id NULL
    await withTenant(ctx.appDb.db, ctx.tenantA, (tx) =>
      tx.insert(bankAccounts).values({
        tenantId: ctx.tenantA,
        provider: "sepay",
        accountNumberEnc: Buffer.from("lti3-num"),
        accountFingerprint: "lti3-fp-a",
        webhookToken: "lti3-wh-a",
        webhookSecretEnc: Buffer.from("lti3-sec"),
      }),
    );
    // cash allocation: bank_transaction_id NULL and reverses_allocation_id NULL
    await withTenant(ctx.appDb.db, ctx.tenantA, (tx) =>
      tx.insert(paymentAllocations).values({
        tenantId: ctx.tenantA,
        chargeId: chargeA,
        amount: 10000,
        source: "cash",
        createdBy: actorPerson,
      }),
    );
  });

  it("LTI-4: each ledger parent carries a UNIQUE (tenant_id, id) candidate key (pg_constraint)", async () => {
    for (const [table, conname] of [
      ["bank_accounts", "bank_accounts_tenant_id_candidate_key"],
      ["bank_transactions", "bank_transactions_tenant_id_candidate_key"],
      ["charges", "charges_tenant_id_candidate_key"],
      ["payment_allocations", "payment_allocations_tenant_id_candidate_key"],
      ["provider_connections", "provider_connections_tenant_id_candidate_key"],
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

  it("LTI-5: every pre-0020 single-column ledger FK still exists (ON DELETE unchanged)", async () => {
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
      ["bank_transactions", "bank_account_id", "bank_accounts"],
      ["payment_allocations", "charge_id", "charges"],
      ["payment_allocations", "bank_transaction_id", "bank_transactions"],
      ["payment_allocations", "reverses_allocation_id", "payment_allocations"],
      ["bank_accounts", "provider_connection_id", "provider_connections"],
    ] as const) {
      expect(
        await singleColFkCount(child, col, parent),
        `${child}.${col} single-column FK -> ${parent} must survive 0020`,
      ).toBe(1);
    }
  });
});

/**
 * Non-money tenant-integrity composite FKs (migration 0021) — the remaining
 * non-money leg 0019/0020 did not enumerate, surfaced by this slice's own
 * exhaustive scan (schema.ts AND live SQL `REFERENCES` clauses — the SQL-level
 * pass caught a schema.ts mirror drift on `memberships.merged_into_membership_id`,
 * codex round-02 [P1]): zalo_reply_contexts -> zalo_bots,
 * notification_deliveries -> notification_intents, and memberships'
 * self-referencing merge pointer -> memberships. The first two relationships
 * are NOT NULL on both legs (always enforced); the membership merge pointer is
 * nullable, so — like TI-3/LTI-3 — NMTI-3 below covers that MATCH SIMPLE case
 * on its own.
 */
describe("non-money tenant-integrity composite FKs (0021 / NMTI-1..NMTI-5)", () => {
  let zaloBotA: string;
  let notifIntentA: string;
  let personY: string;
  let membershipA: string; // a real membership in A, merge-target for the same-tenant/cross-tenant cases

  beforeAll(async () => {
    personY = await makePerson();
    zaloBotA = await makeZaloBot(ctx.tenantA, "nmti-wh-a");
    await makeZaloBot(ctx.tenantB, "nmti-wh-b"); // tenant B's own bot (unused directly, proves the fixture is tenant-scoped)
    notifIntentA = await makeNotificationIntent(ctx.tenantA, personY, "nmti-intent-a");
    membershipA = await makeMembership(ctx.tenantA);
  }, 60_000);

  it("NMTI-1: every 0021 composite FK rejects a cross-tenant child insert via the app role (withTenant)", async () => {
    // 1. zalo_reply_contexts (tenant_id, bot_id) — bot belongs to A
    await expectErrorChainToMatch(
      withTenant(ctx.appDb.db, ctx.tenantB, (tx) =>
        tx.insert(zaloReplyContexts).values({
          personId: personY,
          tenantId: ctx.tenantB,
          botId: zaloBotA,
          itemIds: [],
          expiresAt: new Date(Date.now() + 3_600_000),
        }),
      ),
      /zalo_reply_contexts_tenant_bot_fk/,
    );
    // 2. notification_deliveries (tenant_id, intent_id) — intent belongs to A
    await expectErrorChainToMatch(
      withTenant(ctx.appDb.db, ctx.tenantB, (tx) =>
        tx.insert(notificationDeliveries).values({
          tenantId: ctx.tenantB,
          intentId: notifIntentA,
          platform: "zalo",
          deliveryKey: "nmti1-delivery-b",
        }),
      ),
      /notification_deliveries_tenant_intent_fk/,
    );
    // 3. memberships (tenant_id, merged_into_membership_id) — a tenant-B
    //    membership cannot merge into tenant A's membership
    const personZ = await makePerson();
    await expectErrorChainToMatch(
      withTenant(ctx.appDb.db, ctx.tenantB, (tx) =>
        tx.insert(memberships).values({
          tenantId: ctx.tenantB,
          personId: personZ,
          status: "merged",
          mergedIntoMembershipId: membershipA,
        }),
      ),
      /memberships_tenant_merged_into_fk/,
    );
  });

  it("NMTI-2: legitimate same-tenant writes still succeed via the app role", async () => {
    await withTenant(ctx.appDb.db, ctx.tenantA, (tx) =>
      tx.insert(zaloReplyContexts).values({
        personId: personY,
        tenantId: ctx.tenantA,
        botId: zaloBotA,
        itemIds: [],
        expiresAt: new Date(Date.now() + 3_600_000),
      }),
    );
    await withTenant(ctx.appDb.db, ctx.tenantA, (tx) =>
      tx.insert(notificationDeliveries).values({
        tenantId: ctx.tenantA,
        intentId: notifIntentA,
        platform: "zalo",
        deliveryKey: "nmti2-delivery-a",
      }),
    );
    // a same-tenant membership merge (both composite legs same tenant) also succeeds
    const personW = await makePerson();
    await withTenant(ctx.appDb.db, ctx.tenantA, (tx) =>
      tx.insert(memberships).values({
        tenantId: ctx.tenantA,
        personId: personW,
        status: "merged",
        mergedIntoMembershipId: membershipA,
      }),
    );
  });

  it("NMTI-3: memberships.merged_into_membership_id NULL is accepted (MATCH SIMPLE); a foreign-tenant merge target is rejected", async () => {
    // NULL merged_into_membership_id -> composite unenforced -> succeeds (an ordinary non-merged membership)
    const personV = await makePerson();
    await withTenant(ctx.appDb.db, ctx.tenantA, (tx) =>
      tx.insert(memberships).values({ tenantId: ctx.tenantA, personId: personV, status: "active" }),
    );
    // a distinct membership merging into a FOREIGN tenant's membership -> rejected
    const foreignTargetB = await makeMembership(ctx.tenantB);
    const personU = await makePerson();
    await expectErrorChainToMatch(
      withTenant(ctx.appDb.db, ctx.tenantA, (tx) =>
        tx.insert(memberships).values({
          tenantId: ctx.tenantA,
          personId: personU,
          status: "merged",
          mergedIntoMembershipId: foreignTargetB,
        }),
      ),
      /memberships_tenant_merged_into_fk/,
    );
  });

  it("NMTI-4: zalo_bots and notification_intents each carry a UNIQUE (tenant_id, id) candidate key (pg_constraint)", async () => {
    for (const [table, conname] of [
      ["zalo_bots", "zalo_bots_tenant_id_candidate_key"],
      ["notification_intents", "notification_intents_tenant_id_candidate_key"],
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

  it("NMTI-5: every pre-0021 single-column FK still exists (ON DELETE unchanged)", async () => {
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
      ["zalo_reply_contexts", "bot_id", "zalo_bots"],
      ["notification_deliveries", "intent_id", "notification_intents"],
      ["memberships", "merged_into_membership_id", "memberships"],
    ] as const) {
      expect(
        await singleColFkCount(child, col, parent),
        `${child}.${col} single-column FK -> ${parent} must survive 0021`,
      ).toBe(1);
    }
  });
});

/**
 * TI-6/LTI-6/NMTI-6 (probe named-halt) + TI-7 (immutability) exercise
 * migrations 0019, 0020, and 0021 DIRECTLY against throwaway databases, using
 * the REAL migration bytes:
 *   - TI-6 applies 0000..0018, seeds a cross-tenant players row, then applies
 *     0019 and asserts the wrapped VALIDATE RAISEs a NAMED halt (table +
 *     relationship + offending key) and rolls back cleanly — proving 0019 halts
 *     an owner rather than aborting mid-way or silently deleting/re-parenting.
 *   - LTI-6 does the same for 0020: applies 0000..0019, seeds a cross-tenant
 *     bank_transactions row, then applies 0020 and asserts the same named-halt
 *     contract on the ledger leg.
 *   - NMTI-6 does the same for 0021: applies 0000..0020, seeds a cross-tenant
 *     zalo_reply_contexts row, then applies 0021 and asserts the same
 *     named-halt contract on the non-money leg.
 *   - TI-7 applies 0000..0021 through the real runner, proves every recorded
 *     sha256 equals the on-disk file (0000..0020 byte-identical after 0021), and
 *     that a tampered applied file is still hard-rejected.
 * Own superuser connection + uniquely-named databases (vitest fileParallelism).
 */
describe("tenant-integrity migrations 0019/0020/0021 direct behaviour (TI-6/LTI-6/NMTI-6 probe halts · TI-7 immutability)", () => {
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

  it("LTI-6: applying 0020 over a pre-existing cross-tenant bank_transactions row raises a NAMED halt (table + row id)", async () => {
    const dbName = "plexco_lti6_probe_check";
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${dbName}`);
    const c = await connect(url(dbName));
    try {
      // apply every migration BEFORE 0020 (numeric prefix < 20), in filename order
      const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
      for (const f of files) {
        if (Number.parseInt(f.slice(0, 4), 10) >= 20) continue;
        await c.query(await readFile(path.join(MIGRATIONS_DIR, f), "utf8"));
      }
      // seed a cross-tenant ledger row: tenant B's transaction on tenant A's
      // bank account. The 0003 single-column FK is satisfied (the account
      // exists); no composite FK yet.
      const t = await c.query(
        `INSERT INTO tenants (name, slug, status)
         VALUES ('LTI6 A', 'lti6-a', 'active'), ('LTI6 B', 'lti6-b', 'active') RETURNING id`,
      );
      const tA = (t.rows[0] as { id: string }).id;
      const tB = (t.rows[1] as { id: string }).id;
      const acc = await c.query(
        `INSERT INTO bank_accounts
           (tenant_id, provider, account_number_enc, account_fingerprint, webhook_token, webhook_secret_enc)
         VALUES ($1, 'sepay', $2, 'lti6-fp', 'lti6-wh', $2) RETURNING id`,
        [tA, Buffer.from("lti6")],
      );
      const accId = (acc.rows[0] as { id: string }).id;
      await c.query(
        `INSERT INTO bank_transactions
           (tenant_id, bank_account_id, provider, external_id, amount, unallocated_amount, occurred_at, raw_payload_enc)
         VALUES ($1, $2, 'sepay', 'lti6-ext', 100000, 100000, now(), $3)`,
        [tB, accId, Buffer.from("lti6")],
      );

      // apply 0020 — the wrapped VALIDATE must halt with a NAMED error
      const sql0020 = await readFile(
        path.join(MIGRATIONS_DIR, "0020_ledger_tenant_integrity_fks.sql"),
        "utf8",
      );
      let err: unknown;
      await c.query("BEGIN");
      try {
        await c.query(sql0020);
      } catch (e) {
        err = e;
      }
      await c.query("ROLLBACK");

      const msg = String((err as Error | undefined)?.message ?? err);
      expect(msg).toMatch(/tenant-integrity halt \(0020\)/);
      expect(msg).toMatch(/\bbank_transactions\b/);
      expect(msg).toContain("(tenant_id, bank_account_id)");
      // the offending cross-tenant key — tenant B pointing at tenant A's account — is surfaced
      expect(msg).toContain(accId);
      expect(msg).toContain(tB);

      // rolled back cleanly — the composite constraint was NOT left behind
      const left = await c.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'bank_transactions_tenant_bank_account_fk'`,
      );
      expect(left.rows.length).toBe(0);
    } finally {
      await c.end();
      await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    }
  }, 120_000);

  it("NMTI-6: applying 0021 over a pre-existing cross-tenant zalo_reply_contexts row raises a NAMED halt (table + row id)", async () => {
    const dbName = "plexco_nmti5_probe_check";
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${dbName}`);
    const c = await connect(url(dbName));
    try {
      // apply every migration BEFORE 0021 (numeric prefix < 21), in filename order
      const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
      for (const f of files) {
        if (Number.parseInt(f.slice(0, 4), 10) >= 21) continue;
        await c.query(await readFile(path.join(MIGRATIONS_DIR, f), "utf8"));
      }
      // seed a cross-tenant zalo_reply_contexts row: tenant B's context on
      // tenant A's bot. The 0004 single-column FK is satisfied (the bot
      // exists); no composite FK yet.
      const t = await c.query(
        `INSERT INTO tenants (name, slug, status)
         VALUES ('NMTI5 A', 'nmti5-a', 'active'), ('NMTI5 B', 'nmti5-b', 'active') RETURNING id`,
      );
      const tA = (t.rows[0] as { id: string }).id;
      const tB = (t.rows[1] as { id: string }).id;
      const person = await c.query(
        `INSERT INTO persons (display_name) VALUES ('nmti5') RETURNING id`,
      );
      const bot = await c.query(
        `INSERT INTO zalo_bots (tenant_id, bot_token_enc, webhook_token) VALUES ($1, 'nmti5-token', 'nmti5-wh') RETURNING id`,
        [tA],
      );
      const botId = (bot.rows[0] as { id: string }).id;
      await c.query(
        `INSERT INTO zalo_reply_contexts (person_id, tenant_id, bot_id, item_ids, expires_at)
         VALUES ($1, $2, $3, '[]', now() + interval '1 hour')`,
        [(person.rows[0] as { id: string }).id, tB, botId],
      );

      // apply 0021 — the wrapped VALIDATE must halt with a NAMED error
      const sql0021 = await readFile(
        path.join(MIGRATIONS_DIR, "0021_non_money_tenant_integrity_fks.sql"),
        "utf8",
      );
      let err: unknown;
      await c.query("BEGIN");
      try {
        await c.query(sql0021);
      } catch (e) {
        err = e;
      }
      await c.query("ROLLBACK");

      const msg = String((err as Error | undefined)?.message ?? err);
      expect(msg).toMatch(/tenant-integrity halt \(0021\)/);
      expect(msg).toMatch(/\bzalo_reply_contexts\b/);
      expect(msg).toContain("(tenant_id, bot_id)");
      // the offending cross-tenant key — tenant B pointing at tenant A's bot — is surfaced
      expect(msg).toContain(botId);
      expect(msg).toContain(tB);

      // rolled back cleanly — the composite constraint was NOT left behind
      const left = await c.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'zalo_reply_contexts_tenant_bot_fk'`,
      );
      expect(left.rows.length).toBe(0);
    } finally {
      await c.end();
      await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    }
  }, 120_000);

  it("TI-7: 0000..0020 stay byte-identical after 0021 applies, and a tampered applied file is rejected", async () => {
    const dbName = "plexco_ti7_immut_check";
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${dbName}`);
    try {
      // job_definer must exist (correctly) before this reaches 0022 — this describe block uses
      // its own local `admin` connection (not setupRlsTestContext), so bootstrap+migrate need the
      // same lock protection as everywhere else 0022 is reached for the first time.
      const res = await withJobDefinerLock(BASE!, async () => {
        await bootstrapJobDefiner(admin);
        return migrate(url(dbName));
      });
      expect(res.applied.length).toBe(25); // 0000..0024

      const c = await connect(url(dbName));
      try {
        const { rows } = await c.query(`SELECT name, sha256 FROM schema_migrations ORDER BY name`);
        expect(rows.length).toBe(25);
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

/**
 * PVC-1..PVC-8 — public visibility x capacity CHECK (0024,
 * docs/autopilot-manifests/db-public-visibility-capacity-check.json). PVC-4
 * (migration-count advance) lives in migrate.test.ts + the "migrations"
 * describe block above (both places that assert the count). PVC-6 (probe
 * halt on pre-existing violating data) mirrors the TI-6/LTI-6/NMTI-6
 * throwaway-database pattern above with its own local admin/connect/url,
 * since that pattern is local to each describe block in this file. Every
 * other PVC runs against the already-migrated `ctx` database; PVC-1/PVC-2 go
 * through the real `app` role via tenantRepo/withTenant (this file's stated
 * "real runtime path" convention — a CHECK constraint fires identically for
 * every role, so this is strictly better evidence than a superuser probe).
 * PVC-3/PVC-5/PVC-7 probe the constraint/catalog/column directly via the
 * owner connection, mirroring how sessions_vis_chk-adjacent tests elsewhere
 * in this file use `ctx.owner.query` for structural checks.
 */
describe("PVC-1..PVC-8 public visibility x capacity CHECK (0024)", () => {
  const createSession = (
    tenantId: string,
    opts: { visibility?: "private" | "public"; slotsMax?: number | null } = {},
  ) =>
    tenantRepo(ctx.appDb.db, tenantId).sessions.create({
      sportId: ctx.badmintonSportId,
      startsAt: new Date("2026-08-01T10:00:00Z"),
      endsAt: new Date("2026-08-01T12:00:00Z"),
      timezone: "Asia/Ho_Chi_Minh",
      ...opts,
    });

  it("PVC-1: creating a public session with slots_max NULL is rejected", async () => {
    await expectErrorChainToMatch(
      createSession(ctx.tenantA, { visibility: "public", slotsMax: null }),
      /sessions_public_capacity_chk/,
    );
  });

  it("PVC-1: updating an existing private-unlimited session to public is rejected", async () => {
    const row = await createSession(ctx.tenantA, { visibility: "private", slotsMax: null });
    await expectErrorChainToMatch(
      withTenant(ctx.appDb.db, ctx.tenantA, (tx) =>
        tx.update(sessions).set({ visibility: "public" }).where(eq(sessions.id, row.id)),
      ),
      /sessions_public_capacity_chk/,
    );
    // rejected atomically — the row is unchanged
    const after = await tenantRepo(ctx.appDb.db, ctx.tenantA).sessions.getById(row.id);
    expect(after?.visibility).toBe("private");
    expect(after?.slotsMax).toBeNull();
  });

  it("PVC-2: every valid visibility x capacity combination still succeeds", async () => {
    const publicFinite = await createSession(ctx.tenantA, { visibility: "public", slotsMax: 8 });
    expect(publicFinite.visibility).toBe("public");
    expect(publicFinite.slotsMax).toBe(8);

    const privateFinite = await createSession(ctx.tenantA, {
      visibility: "private",
      slotsMax: 4,
    });
    expect(privateFinite.visibility).toBe("private");
    expect(privateFinite.slotsMax).toBe(4);

    // the combination a too-broad constraint would break: private + unlimited stays valid
    const privateUnlimited = await createSession(ctx.tenantA, {
      visibility: "private",
      slotsMax: null,
    });
    expect(privateUnlimited.visibility).toBe("private");
    expect(privateUnlimited.slotsMax).toBeNull();
  });

  it("PVC-3: the visibility and slots_max CHECK constraints still reject their own original violations", async () => {
    // raw SQL at the owner connection: CreateSessionInput's TS type does not admit an invalid
    // visibility literal or a non-positive slots_max, so the DB constraints are probed directly —
    // they fire identically regardless of role, so a superuser probe is representative here.
    //
    // Matched by BEHAVIOUR (the violation is rejected), not by schema.ts's declared names
    // sessions_vis_chk/sessions_slots_chk — live pg_constraint shows the ORIGINAL 0002 inline
    // column CHECKs never got those names; Postgres auto-named them sessions_visibility_check and
    // sessions_slots_max_check (same class of drift schema.ts:107-111 already documents as fixed
    // for players in 0014 — it was never fixed for sessions). Pre-existing, out of this slice's
    // scope (which only adds sessions_public_capacity_chk and must not touch these two);
    // discovered while writing this test and flagged in the READY report, not silently corrected
    // here.
    await expect(
      ctx.owner.query(
        `INSERT INTO sessions (tenant_id, sport_id, starts_at, ends_at, timezone, visibility)
         VALUES ($1, $2, now(), now() + interval '1 hour', 'Asia/Ho_Chi_Minh', 'secret')`,
        [ctx.tenantA, ctx.badmintonSportId],
      ),
    ).rejects.toThrow(/violates check constraint "sessions_visibility_check"/);

    await expect(
      ctx.owner.query(
        `INSERT INTO sessions (tenant_id, sport_id, starts_at, ends_at, timezone, slots_max)
         VALUES ($1, $2, now(), now() + interval '1 hour', 'Asia/Ho_Chi_Minh', 0)`,
        [ctx.tenantA, ctx.badmintonSportId],
      ),
    ).rejects.toThrow(/violates check constraint "sessions_slots_max_check"/);
  });

  it("PVC-5: sessions_public_capacity_chk is live, named per convention, and shaped as expected", async () => {
    const { rows } = await ctx.owner.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'sessions_public_capacity_chk'`,
    );
    expect(rows.length).toBe(1);
    const def = (rows[0] as { def: string }).def;
    expect(def).toContain("visibility");
    expect(def).toContain("slots_max");
    expect(def).toContain("IS NULL");
  });

  it("PVC-6: applying 0024 over a pre-existing public+unlimited row raises a NAMED halt naming a remediation query, and mutates nothing", async () => {
    const BASE = process.env.DATABASE_URL_TEST;
    if (!BASE) throw new Error("DATABASE_URL_TEST is required for the PVC-6 probe");
    const admin = new pg.Client({ connectionString: BASE });
    await admin.connect();
    const urlFor = (db: string): string => {
      const u = new URL(BASE);
      u.pathname = `/${db}`;
      return u.toString();
    };
    const dbName = "plexco_pvc6_probe_check";
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${dbName}`);
    const c = new pg.Client({ connectionString: urlFor(dbName) });
    await c.connect();
    try {
      // migrations 0022/0023 ASSERT (never create) the cluster-global job_definer role, so this
      // replay must bootstrap it first and hold the same advisory lock every other path that
      // reaches 0022 holds (codex round-02 [P1]) — job_definer is CLUSTER-global, so a concurrent
      // vitest file (migrate.test.ts's JCL-2/JCL-3) that deliberately renames/breaks it for its
      // own negative-path assertion would otherwise race this replay and fail it for the wrong
      // reason. Bootstraps via `admin` (the stable BASE connection), not `c` (the throwaway
      // per-test database) — the role is cluster-global, so either connection creates it
      // identically, and every other caller in this file bootstraps via the stable connection too.
      await withJobDefinerLock(BASE, async () => {
        await bootstrapJobDefiner(admin);
        // apply every migration BEFORE 0024 (numeric prefix < 24), in filename order
        const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
        for (const f of files) {
          if (Number.parseInt(f.slice(0, 4), 10) >= 24) continue;
          await c.query(await readFile(path.join(MIGRATIONS_DIR, f), "utf8"));
        }
      });
      // seed a pre-existing invalid row: public + unlimited. sessions_vis_chk/sessions_slots_chk
      // (already applied via 0002) do not reject it — only the new 0024 constraint does.
      const t = await c.query(
        `INSERT INTO tenants (name, slug, status) VALUES ('PVC6', 'pvc6', 'active') RETURNING id`,
      );
      const tenantId = (t.rows[0] as { id: string }).id;
      const sport = await c.query(`SELECT id FROM sports WHERE key = 'badminton'`);
      await c.query(
        `INSERT INTO sessions (tenant_id, sport_id, starts_at, ends_at, timezone, visibility, slots_max)
         VALUES ($1, $2, now(), now() + interval '2 hours', 'Asia/Ho_Chi_Minh', 'public', NULL)`,
        [tenantId, (sport.rows[0] as { id: string }).id],
      );

      // apply 0024 — the wrapped VALIDATE must halt with a NAMED error
      const sql0024 = await readFile(
        path.join(MIGRATIONS_DIR, "0024_public_visibility_capacity_check.sql"),
        "utf8",
      );
      let err: unknown;
      await c.query("BEGIN");
      try {
        await c.query(sql0024);
      } catch (e) {
        err = e;
      }
      await c.query("ROLLBACK");

      const msg = String((err as Error | undefined)?.message ?? err);
      expect(msg).toMatch(/capacity-visibility halt \(0024\)/);
      expect(msg).toMatch(/\bsessions\b/);
      expect(msg).toContain("SELECT id, tenant_id, visibility, slots_max FROM sessions");

      // rolled back cleanly — the constraint was NOT left behind
      const left = await c.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'sessions_public_capacity_chk'`,
      );
      expect(left.rows.length).toBe(0);
      // and the seeded row is untouched — this migration never mutates/deletes on halt
      const stillThere = await c.query(
        `SELECT visibility, slots_max FROM sessions WHERE tenant_id = $1`,
        [tenantId],
      );
      expect(stillThere.rows).toEqual([{ visibility: "public", slots_max: null }]);
    } finally {
      await c.end();
      await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await admin.end();
    }
  }, 120_000);

  it("PVC-7: no RLS/role/grant change and slots_max stays nullable", async () => {
    // structural check against the migration file itself — 0024 must not introduce any
    // RLS/role/grant statement (it is a CHECK-only expand migration).
    const sqlText = await readFile(
      path.join(MIGRATIONS_DIR, "0024_public_visibility_capacity_check.sql"),
      "utf8",
    );
    const ddl = sqlText.replace(/--.*$/gm, ""); // strip comment lines before scanning for DDL keywords
    expect(ddl).not.toMatch(
      /\b(GRANT|REVOKE|CREATE POLICY|ALTER POLICY|DROP POLICY|OWNER TO|ALTER ROLE)\b/i,
    );

    const { rows } = await ctx.owner.query(
      `SELECT is_nullable FROM information_schema.columns
       WHERE table_name = 'sessions' AND column_name = 'slots_max'`,
    );
    expect((rows[0] as { is_nullable: string }).is_nullable).toBe("YES");
  });
});

/**
 * JCL-1, JCL-4..JCL-12 — job-infra lease/reclaim/audit/delivery acceptance matrix (0022,
 * docs/autopilot-db-job-claim-lease-core.md §5). JCL-2/JCL-3 (migration fail-closed on
 * job_definer preconditions) live in migrate.test.ts, which already uses a genuinely
 * non-superuser context; JCL-13/JCL-13b (bootstrap) are covered by the design-probe.md
 * empirical proof plus the fresh-volume/idempotent-rerun checks run during implementation.
 *
 * Every test here calls claim_outbox_batch/claim_projector_delivery_batch with p_limit=100
 * and filters results to its OWN seeded ids (WHERE event_id = ANY($1)) — this file's tests run
 * sequentially within one describe tree but share ONE database (`ctx`), so a test must never
 * assume it is the only source of unclaimed rows and must not leave any of its own rows
 * unclaimed at the end (a stray unclaimed row would compete for a later test's LIMIT window).
 */
describe("JCL-1/JCL-4..JCL-12 job-infra lease/reclaim/audit/delivery (0022)", () => {
  async function seedOutboxEvent(tenantId: string, type = "jcl.test.event"): Promise<string> {
    const { rows } = await ctx.owner.query(
      `INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, sequence, type, payload)
       VALUES ($1, 'jcl_test', gen_random_uuid(), 1, $2, '{}'::jsonb) RETURNING id`,
      [tenantId, type],
    );
    return (rows[0] as { id: string }).id;
  }

  it("JCL-1: a non-superuser migration run leaves all five named functions job_definer-owned", async () => {
    const nsCtx = await setupNonSuperuserOwnerContext("plexco_rls_jcl1_nonsuper");
    try {
      // bootstrap + migrate + the ownership verification below all reference job_definer BY NAME
      // (grant; the 0022 assertion and ownership transfers; pg_get_userbyid comparison) — one
      // continuous lock hold, matching setupRlsTestContext / JCL-4 / JCL-12.
      await withJobDefinerLock(process.env.DATABASE_URL_TEST!, async () => {
        await nsCtx.bootstrapJobDefinerForOwner();
        const res = await nsCtx.runMigration();
        expect(res.applied[res.applied.length - 1]).toBe(
          "0024_public_visibility_capacity_check.sql",
        );

        const { rows } = await nsCtx.ownerPool.query(
          `SELECT p.proname FROM pg_proc p WHERE pg_get_userbyid(p.proowner) = 'job_definer' ORDER BY p.proname`,
        );
        expect((rows as { proname: string }[]).map((r) => r.proname).sort()).toEqual(
          [
            "ack_outbox_event",
            "claim_outbox_batch",
            "claim_projector_delivery_batch",
            "complete_projector_delivery",
            "forbid_job_audit_mutation",
            "job_prepare_projector_delivery",
          ].sort(),
        );
      });
    } finally {
      await nsCtx.teardown();
    }
  }, 60_000);

  it("JCL-4: job_definer ownership is what fixes the latent cross-tenant RLS defect", async () => {
    const evA = await seedOutboxEvent(ctx.tenantA);
    const evB = await seedOutboxEvent(ctx.tenantB);

    // Reassign ownership to a plain NOSUPERUSER/NOBYPASSRLS role — reproducing the ORIGINAL
    // defect this slice fixes (design-probe.md). Restored in `finally`: every other test in this
    // describe block depends on claim_outbox_batch staying job_definer-owned. Both the steal and
    // the restore reference "job_definer" BY NAME (ALTER FUNCTION ... OWNER TO job_definer) — the
    // whole steal/test/restore sequence holds ONE lock so a concurrent migrate.test.ts JCL-2 rename
    // can never land in the gap and make the restore silently fail (see withJobDefinerLock).
    await withJobDefinerLock(process.env.DATABASE_URL_TEST!, async () => {
      await ctx.owner.query(`DROP ROLE IF EXISTS jcl4_plain_owner`);
      await ctx.owner.query(`CREATE ROLE jcl4_plain_owner NOSUPERUSER NOBYPASSRLS NOLOGIN`);
      await ctx.owner.query(`GRANT SELECT, UPDATE ON outbox_events TO jcl4_plain_owner`);
      // the function's OWN audit insert also runs as its owner — without SELECT+INSERT here it
      // fails closed on job_audit_events before ever reaching the RLS check this test is proving.
      // SELECT is required even though the statement only INSERTs: the primary query JOINs against
      // the INSERT CTE's RETURNING output (`JOIN audited a ON a.job_id = u.id`), and Postgres checks
      // table-level SELECT for that reference in addition to INSERT for the write itself.
      // job_definer never needs this grant explicitly — it OWNS job_audit_events, implying both.
      await ctx.owner.query(`GRANT SELECT, INSERT ON job_audit_events TO jcl4_plain_owner`);
      await ctx.owner.query(`ALTER FUNCTION claim_outbox_batch(integer) OWNER TO jcl4_plain_owner`);
      try {
        const zero = await ctx.workerPool.query(
          `SELECT event_id FROM claim_outbox_batch(100) WHERE event_id = ANY($1)`,
          [[evA, evB]],
        );
        expect(zero.rows.length).toBe(0);
      } finally {
        await ctx.owner.query(`ALTER FUNCTION claim_outbox_batch(integer) OWNER TO job_definer`);
        await ctx.owner.query(`REVOKE SELECT, UPDATE ON outbox_events FROM jcl4_plain_owner`);
        await ctx.owner.query(`REVOKE SELECT, INSERT ON job_audit_events FROM jcl4_plain_owner`);
        await ctx.owner.query(`DROP ROLE jcl4_plain_owner`);
      }
    });

    // job_definer-owned again: the SAME rows are now claimable (and consumed, so they don't
    // linger unclaimed for a later test).
    const restored = await ctx.workerPool.query(
      `SELECT event_id FROM claim_outbox_batch(100) WHERE event_id = ANY($1)`,
      [[evA, evB]],
    );
    const restoredIds = new Set((restored.rows as { event_id: string }[]).map((r) => r.event_id));
    expect(restoredIds.has(evA)).toBe(true);
    expect(restoredIds.has(evB)).toBe(true);
  });

  it("JCL-5: app_worker claims one row per eligible event across tenants; audit rows match", async () => {
    const evA = await seedOutboxEvent(ctx.tenantA);
    const evB = await seedOutboxEvent(ctx.tenantB);
    const { rows } = await ctx.workerPool.query(
      `SELECT event_id, tenant_id FROM claim_outbox_batch(100) WHERE event_id = ANY($1)`,
      [[evA, evB]],
    );
    expect(rows.length).toBe(2);
    const byId = new Map(
      (rows as { event_id: string; tenant_id: string }[]).map((r) => [r.event_id, r.tenant_id]),
    );
    expect(byId.get(evA)).toBe(ctx.tenantA);
    expect(byId.get(evB)).toBe(ctx.tenantB);

    const audit = await ctx.owner.query(
      `SELECT job_id, tenant_id, actor, reason, fn_name FROM job_audit_events
       WHERE job_id = ANY($1) ORDER BY job_id`,
      [[evA, evB]],
    );
    expect(audit.rows.length).toBe(2);
    for (const row of audit.rows as {
      job_id: string;
      tenant_id: string;
      actor: string;
      reason: string;
      fn_name: string;
    }[]) {
      expect(row.actor).toBe("system");
      expect(row.reason).toBe("outbox_claimed");
      expect(row.fn_name).toBe("claim_outbox_batch");
      expect(row.tenant_id).toBe(row.job_id === evA ? ctx.tenantA : ctx.tenantB);
    }
  });

  it("JCL-6: an expired lease is reclaimed and re-claimable; two audit rows for the same job_id are accepted", async () => {
    const ev = await seedOutboxEvent(ctx.tenantA);
    const first = await ctx.workerPool.query(
      `SELECT event_id FROM claim_outbox_batch(100) WHERE event_id = $1`,
      [ev],
    );
    expect(first.rows.length).toBe(1);

    // force the lease into the past — simulates a crashed worker past its 5-minute lease
    await ctx.owner.query(
      `UPDATE outbox_events SET lease_expires_at = now() - interval '1 second' WHERE id = $1`,
      [ev],
    );

    const second = await ctx.workerPool.query(
      `SELECT event_id FROM claim_outbox_batch(100) WHERE event_id = $1`,
      [ev],
    );
    expect(second.rows.length).toBe(1); // reclaimed AND re-claimed in the same call

    const audit = await ctx.owner.query(
      `SELECT reason FROM job_audit_events WHERE job_id = $1 ORDER BY created_at`,
      [ev],
    );
    const reasons = (audit.rows as { reason: string }[]).map((r) => r.reason);
    // codex round-11 [P2]: the reclaim + new-claim rows from the SECOND claim_outbox_batch call
    // are inserted in the same transaction, so created_at DEFAULT now() ties them — ORDER BY
    // created_at has no defined order between ties. Only the first call's row is genuinely,
    // temporally first; assert the tied pair as a set instead of assuming a fixed order.
    expect(reasons[0]).toBe("outbox_claimed");
    expect(reasons.slice(1).sort()).toEqual(["outbox_claimed", "outbox_lease_reclaimed"]);
  });

  it("JCL-7: two concurrent claimers never both receive the same event", async () => {
    const ev = await seedOutboxEvent(ctx.tenantA);
    const [a, b] = await Promise.all([
      ctx.workerPool.query(`SELECT event_id FROM claim_outbox_batch(100) WHERE event_id = $1`, [
        ev,
      ]),
      ctx.workerPool.query(`SELECT event_id FROM claim_outbox_batch(100) WHERE event_id = $1`, [
        ev,
      ]),
    ]);
    expect(a.rows.length + b.rows.length).toBe(1);
  });

  it("JCL-8: p_limit outside 1..100 is a deterministic error with no mutation, for both claim functions", async () => {
    const ev = await seedOutboxEvent(ctx.tenantA);
    await expect(ctx.workerPool.query(`SELECT * FROM claim_outbox_batch(0)`)).rejects.toThrow(
      /p_limit/,
    );
    await expect(ctx.workerPool.query(`SELECT * FROM claim_outbox_batch(101)`)).rejects.toThrow(
      /p_limit/,
    );

    await ctx.workerPool.query(`SELECT job_prepare_projector_delivery($1, 'jcl8_projector')`, [ev]);
    await expect(
      ctx.workerPool.query(`SELECT * FROM claim_projector_delivery_batch('jcl8_projector', 0)`),
    ).rejects.toThrow(/p_limit/);
    await expect(
      ctx.workerPool.query(`SELECT * FROM claim_projector_delivery_batch('jcl8_projector', 101)`),
    ).rejects.toThrow(/p_limit/);

    // no mutation: the outbox event is still unclaimed, the delivery row still pending
    const outboxState = await ctx.owner.query(
      `SELECT claimed_at FROM outbox_events WHERE id = $1`,
      [ev],
    );
    expect((outboxState.rows[0] as { claimed_at: Date | null }).claimed_at).toBeNull();
    const deliveryState = await ctx.owner.query(
      `SELECT status FROM projector_deliveries WHERE event_id = $1 AND projector = 'jcl8_projector'`,
      [ev],
    );
    expect((deliveryState.rows[0] as { status: string }).status).toBe("pending");

    // cleanup: claim it so it doesn't linger unclaimed for later tests
    await ctx.workerPool.query(`SELECT event_id FROM claim_outbox_batch(100) WHERE event_id = $1`, [
      ev,
    ]);
  });

  it("JCL-8b: a NULL projector/result is rejected explicitly, not silently accepted (codex round-05 [P2])", async () => {
    const ev = await seedOutboxEvent(ctx.tenantA);

    // NULL !~ pattern is SQL NULL, not TRUE — each function must check IS NULL explicitly.
    await expect(
      ctx.workerPool.query(`SELECT job_prepare_projector_delivery($1, NULL)`, [ev]),
    ).rejects.toThrow(/lower snake_case identifier/);
    await expect(
      ctx.workerPool.query(`SELECT * FROM claim_projector_delivery_batch(NULL, 100)`),
    ).rejects.toThrow(/lower snake_case identifier/);

    await ctx.workerPool.query(`SELECT job_prepare_projector_delivery($1, 'jcl8b_projector')`, [
      ev,
    ]);
    const claimed = await ctx.workerPool.query(
      `SELECT claim_token FROM claim_projector_delivery_batch('jcl8b_projector', 100) WHERE event_id = $1`,
      [ev],
    );
    const token = (claimed.rows[0] as { claim_token: string }).claim_token;
    // NULL NOT IN (...) is SQL NULL, not TRUE — would otherwise fall through to the dlq branch.
    await expect(
      ctx.workerPool.query(
        `SELECT complete_projector_delivery($1, 'jcl8b_projector', $2, NULL, NULL, NULL, NULL)`,
        [ev, token],
      ),
    ).rejects.toThrow(/result must be delivered, retry or dlq/);

    // cleanup: claim the outbox event so it doesn't linger unclaimed for later tests
    await ctx.workerPool.query(`SELECT event_id FROM claim_outbox_batch(100) WHERE event_id = $1`, [
      ev,
    ]);
  });

  it("JCL-9: app_worker has zero direct DML on outbox/projector/audit tables — only EXECUTE succeeds", async () => {
    const denied: readonly (readonly [string, unknown[]])[] = [
      ["SELECT * FROM outbox_events LIMIT 1", []],
      [
        `INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, sequence, type, payload)
         VALUES ($1, 'x', gen_random_uuid(), 1, 'x', '{}')`,
        [ctx.tenantA],
      ],
      ["UPDATE outbox_events SET claimed_at = now() WHERE false", []],
      ["UPDATE outbox_events SET claim_token = gen_random_uuid() WHERE false", []],
      ["UPDATE outbox_events SET acked_at = now() WHERE false", []],
      ["DELETE FROM outbox_events WHERE false", []],
      ["SELECT * FROM projector_deliveries LIMIT 1", []],
      [
        "INSERT INTO projector_deliveries (event_id, projector) VALUES (gen_random_uuid(), 'x')",
        [],
      ],
      ["UPDATE projector_deliveries SET status = 'pending' WHERE false", []],
      ["DELETE FROM projector_deliveries WHERE false", []],
      ["SELECT * FROM job_audit_events LIMIT 1", []],
      [
        `INSERT INTO job_audit_events (job_id, tenant_id, reason, fn_name, operation_id)
         VALUES (gen_random_uuid(), $1, 'x', 'x', gen_random_uuid())`,
        [ctx.tenantA],
      ],
    ];
    for (const [sql, params] of denied) {
      await expect(ctx.workerPool.query(sql, params), sql).rejects.toThrow(/permission denied/i);
    }

    // only EXECUTE succeeds
    const ev = await seedOutboxEvent(ctx.tenantA);
    await ctx.workerPool.query(`SELECT event_id FROM claim_outbox_batch(100) WHERE event_id = $1`, [
      ev,
    ]);
  });

  it("JCL-9b: app keeps INSERT/SELECT on outbox_events for the producer side, but UPDATE/DELETE are revoked and lease fields cannot be set on insert (codex round-03/round-04 [P1])", async () => {
    const created = await withTenant(ctx.appDb.db, ctx.tenantA, async (tx) => {
      const rows = await tx
        .insert(outboxEvents)
        .values({
          tenantId: ctx.tenantA,
          aggregateType: "jcl_app_seat",
          aggregateId: randomUUID(),
          sequence: 1,
          type: "jcl.app.seat",
          payload: {},
        })
        .returning();
      return rows[0]!;
    });
    expect(created.tenantId).toBe(ctx.tenantA);

    const seen = await withTenant(ctx.appDb.db, ctx.tenantA, (tx) =>
      tx.select().from(outboxEvents).where(eq(outboxEvents.id, created.id)),
    );
    expect(seen.length).toBe(1);

    // codex round-04 [P1]: app must not be able to set claimed_at/lease_expires_at on ITS OWN
    // insert — that would satisfy the shape CHECK while suppressing the event from
    // claim_outbox_batch with no outbox_claimed audit row. Enforced by
    // outbox_events_producer_lease_boundary_chk (current_user = 'app' -> all lease/ack columns
    // must be NULL), not a column-level grant (rejected — see the migration's own comment on this
    // constraint). claimToken is set too (0023): the shape CHECK is now a strict triple, so a
    // claimed_at/lease_expires_at-only insert would trip THAT check instead of isolating the
    // producer-boundary violation this test targets — satisfying the triple keeps the row
    // shape-valid so only the boundary CHECK fires.
    await expectErrorChainToMatch(
      withTenant(ctx.appDb.db, ctx.tenantA, (tx) =>
        tx.insert(outboxEvents).values({
          tenantId: ctx.tenantA,
          aggregateType: "jcl_app_seat_bad",
          aggregateId: randomUUID(),
          sequence: 1,
          type: "jcl.app.seat.bad",
          payload: {},
          claimedAt: new Date(),
          leaseExpiresAt: new Date(Date.now() + 5 * 60_000),
          claimToken: randomUUID(),
        }),
      ),
      /outbox_events_producer_lease_boundary_chk/,
    );

    await expectErrorChainToMatch(
      withTenant(ctx.appDb.db, ctx.tenantA, (tx) =>
        tx
          .update(outboxEvents)
          .set({ claimedAt: new Date() })
          .where(eq(outboxEvents.id, created.id)),
      ),
      /permission denied/i,
    );
    await expectErrorChainToMatch(
      withTenant(ctx.appDb.db, ctx.tenantA, (tx) =>
        tx.delete(outboxEvents).where(eq(outboxEvents.id, created.id)),
      ),
      /permission denied/i,
    );

    // cleanup: claim it via the real function so it doesn't linger unclaimed for later tests
    await ctx.workerPool.query(`SELECT event_id FROM claim_outbox_batch(100) WHERE event_id = $1`, [
      created.id,
    ]);
  });

  it("JCL-10: prepare is idempotent; claim once; complete delivered with the exact token succeeds once", async () => {
    const ev = await seedOutboxEvent(ctx.tenantA);
    await ctx.workerPool.query(`SELECT job_prepare_projector_delivery($1, 'jcl10_projector')`, [
      ev,
    ]);
    await ctx.workerPool.query(`SELECT job_prepare_projector_delivery($1, 'jcl10_projector')`, [
      ev,
    ]); // duplicate, no-op

    const count = await ctx.owner.query(
      `SELECT count(*)::int AS n FROM projector_deliveries WHERE event_id = $1 AND projector = 'jcl10_projector'`,
      [ev],
    );
    expect((count.rows[0] as { n: number }).n).toBe(1); // exactly one delivery row despite two prepares

    const claimed = await ctx.workerPool.query(
      `SELECT claim_token FROM claim_projector_delivery_batch('jcl10_projector', 100) WHERE event_id = $1`,
      [ev],
    );
    expect(claimed.rows.length).toBe(1);
    const token = (claimed.rows[0] as { claim_token: string }).claim_token;

    const completed = await ctx.workerPool.query(
      `SELECT complete_projector_delivery($1, 'jcl10_projector', $2, 'delivered', NULL, 'prov-ref-1', NULL) AS ok`,
      [ev, token],
    );
    expect((completed.rows[0] as { ok: boolean }).ok).toBe(true);

    // a late/duplicate completion with the SAME (now-stale) token is a no-op — no state overwrite
    const dup = await ctx.workerPool.query(
      `SELECT complete_projector_delivery($1, 'jcl10_projector', $2, 'delivered', NULL, 'prov-ref-2', NULL) AS ok`,
      [ev, token],
    );
    expect((dup.rows[0] as { ok: boolean }).ok).toBe(false);

    const final = await ctx.owner.query(
      `SELECT status, provider_ref, attempts FROM projector_deliveries WHERE event_id = $1 AND projector = 'jcl10_projector'`,
      [ev],
    );
    const f = final.rows[0] as { status: string; provider_ref: string; attempts: number };
    expect(f.status).toBe("delivered");
    expect(f.provider_ref).toBe("prov-ref-1"); // NOT overwritten by the duplicate completion
    expect(f.attempts).toBe(1); // incremented exactly once
  });

  it("JCL-11: retry-then-reclaim increments attempts once per completion; stale token rejected after re-claim; dlq is terminal", async () => {
    const ev = await seedOutboxEvent(ctx.tenantA);
    await ctx.workerPool.query(`SELECT job_prepare_projector_delivery($1, 'jcl11_projector')`, [
      ev,
    ]);

    const claim1 = await ctx.workerPool.query(
      `SELECT claim_token FROM claim_projector_delivery_batch('jcl11_projector', 100) WHERE event_id = $1`,
      [ev],
    );
    const token1 = (claim1.rows[0] as { claim_token: string }).claim_token;

    const future = new Date(Date.now() + 60_000);
    const retryOk = await ctx.workerPool.query(
      `SELECT complete_projector_delivery($1, 'jcl11_projector', $2, 'retry', $3, NULL, 'jcl11_transient') AS ok`,
      [ev, token1, future],
    );
    expect((retryOk.rows[0] as { ok: boolean }).ok).toBe(true);

    // stale token cannot complete after this point, even before re-claim
    const staleBeforeReclaim = await ctx.workerPool.query(
      `SELECT complete_projector_delivery($1, 'jcl11_projector', $2, 'delivered', NULL, 'x', NULL) AS ok`,
      [ev, token1],
    );
    expect((staleBeforeReclaim.rows[0] as { ok: boolean }).ok).toBe(false);

    // make the retry due, then re-claim -> fresh token
    await ctx.owner.query(
      `UPDATE projector_deliveries SET next_attempt_at = now() - interval '1 second'
       WHERE event_id = $1 AND projector = 'jcl11_projector'`,
      [ev],
    );
    const claim2 = await ctx.workerPool.query(
      `SELECT claim_token, attempts FROM claim_projector_delivery_batch('jcl11_projector', 100) WHERE event_id = $1`,
      [ev],
    );
    expect(claim2.rows.length).toBe(1);
    const { claim_token: token2, attempts: attemptsAtClaim2 } = claim2.rows[0] as {
      claim_token: string;
      attempts: number;
    };
    expect(token2).not.toBe(token1);
    expect(attemptsAtClaim2).toBe(1); // incremented once by the retry completion, not by claiming

    // the OLD token still cannot complete after re-claim
    const staleAfterReclaim = await ctx.workerPool.query(
      `SELECT complete_projector_delivery($1, 'jcl11_projector', $2, 'delivered', NULL, 'x', NULL) AS ok`,
      [ev, token1],
    );
    expect((staleAfterReclaim.rows[0] as { ok: boolean }).ok).toBe(false);

    // dlq with the CURRENT token is terminal
    const dlqOk = await ctx.workerPool.query(
      `SELECT complete_projector_delivery($1, 'jcl11_projector', $2, 'dlq', NULL, NULL, 'jcl11_permanent') AS ok`,
      [ev, token2],
    );
    expect((dlqOk.rows[0] as { ok: boolean }).ok).toBe(true);

    // dlq never becomes claimable again
    const afterDlq = await ctx.workerPool.query(
      `SELECT event_id FROM claim_projector_delivery_batch('jcl11_projector', 100) WHERE event_id = $1`,
      [ev],
    );
    expect(afterDlq.rows.length).toBe(0);

    const final = await ctx.owner.query(
      `SELECT status, attempts FROM projector_deliveries WHERE event_id = $1 AND projector = 'jcl11_projector'`,
      [ev],
    );
    const f = final.rows[0] as { status: string; attempts: number };
    expect(f.status).toBe("dlq");
    expect(f.attempts).toBe(2); // one increment per completion (retry, then dlq)
  });

  it("JCL-12: job_definer's function-owner allowlist is exact; no LOGIN; no lingering schema CREATE", async () => {
    // Every assertion below resolves "job_definer" BY NAME (pg_get_userbyid comparison, pg_roles
    // lookup, has_schema_privilege) — a concurrent migrate.test.ts JCL-2 rename would make the
    // name transiently resolve to nothing (functions keep their OID/owner; only pg_catalog's
    // NAME-based lookups go blank), so the whole read runs under the same lock as the writers.
    await withJobDefinerLock(process.env.DATABASE_URL_TEST!, async () => {
      const { rows } = await ctx.owner.query(
        `SELECT p.proname FROM pg_proc p WHERE pg_get_userbyid(p.proowner) = 'job_definer' ORDER BY p.proname`,
      );
      expect((rows as { proname: string }[]).map((r) => r.proname).sort()).toEqual(
        [
          "ack_outbox_event",
          "claim_outbox_batch",
          "claim_projector_delivery_batch",
          "complete_projector_delivery",
          "forbid_job_audit_mutation",
          "job_prepare_projector_delivery",
        ].sort(),
      );

      const role = await ctx.owner.query(
        `SELECT rolcanlogin FROM pg_roles WHERE rolname = 'job_definer'`,
      );
      expect((role.rows[0] as { rolcanlogin: boolean }).rolcanlogin).toBe(false);

      const schemaCreate = await ctx.owner.query(
        `SELECT has_schema_privilege('job_definer', 'public', 'CREATE') AS has_create`,
      );
      expect((schemaCreate.rows[0] as { has_create: boolean }).has_create).toBe(false);
    });
  });
});

/**
 * OAM-1..OAM-11 — outbox_events completion/ack marker (0023,
 * docs/autopilot-manifests/db-outbox-ack-marker.json,
 * .autopilot/state/db-outbox-ack-marker/design-probe.md). Closes 0022:166-181's hard blocking
 * requirement: an acked event must stop being reclaimed, so a growing set of done-but-still-leased
 * events can no longer starve newer ones from ever being claimed.
 *
 * Same conventions as the JCL block above: real app_worker seat via ctx.workerPool for every
 * functional call, ctx.owner (superuser) only for setup/direct verification, and every test filters
 * to its own seeded ids since this file's tests share ONE database.
 */
describe("OAM-1..OAM-11 outbox ack marker (0023)", () => {
  async function seedOutboxEvent(tenantId: string, type = "oam.test.event"): Promise<string> {
    const { rows } = await ctx.owner.query(
      `INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, sequence, type, payload)
       VALUES ($1, 'oam_test', gen_random_uuid(), 1, $2, '{}'::jsonb) RETURNING id`,
      [tenantId, type],
    );
    return (rows[0] as { id: string }).id;
  }

  /** claims a freshly-seeded event via the real app_worker seat and returns its claim_token. */
  async function claimOne(eventId: string): Promise<string> {
    const { rows } = await ctx.workerPool.query(
      `SELECT claim_token FROM claim_outbox_batch(100) WHERE event_id = $1`,
      [eventId],
    );
    expect(rows.length).toBe(1);
    return (rows[0] as { claim_token: string }).claim_token;
  }

  async function expireLease(eventId: string): Promise<void> {
    await ctx.owner.query(
      `UPDATE outbox_events SET lease_expires_at = now() - interval '1 second' WHERE id = $1`,
      [eventId],
    );
  }

  it("OAM-1: an acked event is NOT reclaimed after its lease expires", async () => {
    const ev = await seedOutboxEvent(ctx.tenantA);
    const token = await claimOne(ev);
    const acked = await ctx.workerPool.query(
      `SELECT ack_outbox_event($1, ARRAY[]::text[], $2) AS ok`,
      [ev, token],
    );
    expect((acked.rows[0] as { ok: boolean }).ok).toBe(true);

    await expireLease(ev);

    const reclaim = await ctx.workerPool.query(
      `SELECT event_id FROM claim_outbox_batch(100) WHERE event_id = $1`,
      [ev],
    );
    expect(reclaim.rows.length).toBe(0); // acked -> never comes back, this is the fix
  });

  it("OAM-2: STARVATION REGRESSION — acked-and-expired older events do not starve a newer unacked one", async () => {
    // Older rows are backdated far into the past so they are provably the oldest rows in the
    // whole shared test database, making the assertion deterministic regardless of any other
    // test's residual state: with a p_limit exactly matching the older count, the pre-fix
    // behavior (reclaim resets these to available, ORDER BY created_at re-claims them ahead of
    // anything else) would leave zero room in that SAME limit for the newer row.
    const farPast = new Date("2020-01-01T00:00:00Z");
    const olderIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { rows } = await ctx.owner.query(
        `INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, sequence, type, payload, created_at)
         VALUES ($1, 'oam_test', gen_random_uuid(), 1, 'oam2.older', '{}'::jsonb, $2) RETURNING id`,
        [ctx.tenantA, new Date(farPast.getTime() + i * 1000)],
      );
      const ev = (rows[0] as { id: string }).id;
      const token = await claimOne(ev);
      await ctx.workerPool.query(`SELECT ack_outbox_event($1, ARRAY[]::text[], $2)`, [ev, token]);
      await expireLease(ev);
      olderIds.push(ev);
    }
    const newer = await seedOutboxEvent(ctx.tenantA, "oam2.newer");

    const claimed = await ctx.workerPool.query(`SELECT event_id FROM claim_outbox_batch($1)`, [
      olderIds.length,
    ]);
    const claimedIds = (claimed.rows as { event_id: string }[]).map((r) => r.event_id);
    expect(claimedIds).toContain(newer);
    for (const older of olderIds) {
      expect(claimedIds).not.toContain(older); // acked — never reclaimed, never re-appears
    }
  });

  it("OAM-3: an unacked event whose lease expired IS still reclaimed (crash recovery unchanged)", async () => {
    const ev = await seedOutboxEvent(ctx.tenantA);
    await claimOne(ev); // claimed, never acked
    await expireLease(ev);

    const reclaimed = await ctx.workerPool.query(
      `SELECT event_id FROM claim_outbox_batch(100) WHERE event_id = $1`,
      [ev],
    );
    expect(reclaimed.rows.length).toBe(1);
  });

  it("OAM-4: job_audit_events stops growing for an event once it is acked", async () => {
    const ev = await seedOutboxEvent(ctx.tenantA);
    const token = await claimOne(ev);
    await ctx.workerPool.query(`SELECT ack_outbox_event($1, ARRAY[]::text[], $2)`, [ev, token]);
    await expireLease(ev);

    const countFor = async () => {
      const r = await ctx.owner.query(
        `SELECT count(*)::int AS n FROM job_audit_events WHERE job_id = $1`,
        [ev],
      );
      return (r.rows[0] as { n: number }).n;
    };
    const before = await countFor();
    // several more claim cycles — pre-fix, each would reclaim this row (2 audit rows/cycle)
    for (let i = 0; i < 3; i++) {
      await ctx.workerPool.query(
        `SELECT event_id FROM claim_outbox_batch(100) WHERE event_id = $1`,
        [ev],
      );
    }
    expect(await countFor()).toBe(before); // acked -> excluded from reclaim, no new audit rows
  });

  it("OAM-5: ack_outbox_event is EXECUTE-only for app_worker; role app cannot call it at all", async () => {
    const ev = await seedOutboxEvent(ctx.tenantA);
    const token = await claimOne(ev);

    const ok = await ctx.workerPool.query(
      `SELECT ack_outbox_event($1, ARRAY[]::text[], $2) AS ok`,
      [ev, token],
    );
    expect((ok.rows[0] as { ok: boolean }).ok).toBe(true);

    // role `app` has no EXECUTE grant at all — denied regardless of tenant context
    await expect(
      ctx.appPool.query(`SELECT ack_outbox_event($1, ARRAY[]::text[], gen_random_uuid())`, [ev]),
    ).rejects.toThrow(/permission denied/i);
  });

  it("OAM-6: extended shape/ack/producer-boundary CHECKs still exist and reject their violations", async () => {
    const tenantId = ctx.tenantA;

    // triple shape: claimed_at/lease_expires_at set but claim_token NULL violates the extended
    // outbox_events_lease_shape_chk (still rejects the ORIGINAL pair-only violation too, by
    // construction — a partial pair is a subset of a partial triple).
    await expectErrorChainToMatch(
      ctx.owner.query(
        `INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, sequence, type, payload, claimed_at, lease_expires_at, claim_token)
         VALUES ($1, 'oam_test', gen_random_uuid(), 1, 'oam6.partial_triple', '{}'::jsonb, now(), now() + interval '5 minutes', NULL)`,
        [tenantId],
      ),
      /outbox_events_lease_shape_chk/,
    );

    // ack-shape: acked_at set without claimed_at violates the new outbox_events_ack_shape_chk
    await expectErrorChainToMatch(
      ctx.owner.query(
        `INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, sequence, type, payload, acked_at)
         VALUES ($1, 'oam_test', gen_random_uuid(), 1, 'oam6.ack_without_claim', '{}'::jsonb, now())`,
        [tenantId],
      ),
      /outbox_events_ack_shape_chk/,
    );

    // producer boundary: `app` still cannot set claimed_at/lease_expires_at (original violation,
    // still rejected) and now also cannot set claim_token or acked_at on its own insert. Each row
    // below is otherwise shape-valid (satisfies the triple, and acked_at implies claimed_at) so
    // the ONLY violated CHECK is the producer boundary being isolated — a partial-shape row would
    // trip outbox_events_lease_shape_chk / outbox_events_ack_shape_chk first instead.
    await expectErrorChainToMatch(
      withTenant(ctx.appDb.db, tenantId, (tx) =>
        tx.insert(outboxEvents).values({
          tenantId,
          aggregateType: "oam_test",
          aggregateId: randomUUID(),
          sequence: 1,
          type: "oam6.app.claim_token",
          payload: {},
          claimedAt: new Date(),
          leaseExpiresAt: new Date(Date.now() + 5 * 60_000),
          claimToken: randomUUID(),
        }),
      ),
      /outbox_events_producer_lease_boundary_chk/,
    );

    await expectErrorChainToMatch(
      withTenant(ctx.appDb.db, tenantId, (tx) =>
        tx.insert(outboxEvents).values({
          tenantId,
          aggregateType: "oam_test",
          aggregateId: randomUUID(),
          sequence: 1,
          type: "oam6.app.acked_at",
          payload: {},
          claimedAt: new Date(),
          leaseExpiresAt: new Date(Date.now() + 5 * 60_000),
          claimToken: randomUUID(),
          ackedAt: new Date(),
        }),
      ),
      /outbox_events_producer_lease_boundary_chk/,
    );
  });

  it("OAM-7: ack idempotency and failure semantics — never a silent partial write", async () => {
    // non-existent event -> RAISE
    await expectErrorChainToMatch(
      ctx.workerPool.query(`SELECT ack_outbox_event($1, ARRAY[]::text[], gen_random_uuid())`, [
        randomUUID(),
      ]),
      /ack_outbox_event: outbox event .* does not exist/,
    );

    const ev = await seedOutboxEvent(ctx.tenantA);
    const token = await claimOne(ev);

    // NULL p_required_projectors -> RAISE (never silently treated as "zero required")
    await expectErrorChainToMatch(
      ctx.workerPool.query(`SELECT ack_outbox_event($1, NULL, $2)`, [ev, token]),
      /p_required_projectors must not be NULL/,
    );

    // missing required projector delivery -> RAISE, fails closed
    await expectErrorChainToMatch(
      ctx.workerPool.query(`SELECT ack_outbox_event($1, ARRAY['oam7_missing'], $2)`, [ev, token]),
      /missing prepared delivery/,
    );

    // explicit empty array (zero required projectors) is a valid assertion -> succeeds
    const first = await ctx.workerPool.query(
      `SELECT ack_outbox_event($1, ARRAY[]::text[], $2) AS ok`,
      [ev, token],
    );
    expect((first.rows[0] as { ok: boolean }).ok).toBe(true);

    const countAudits = async () => {
      const r = await ctx.owner.query(
        `SELECT count(*)::int AS n FROM job_audit_events WHERE job_id = $1 AND reason = 'outbox_acked'`,
        [ev],
      );
      return (r.rows[0] as { n: number }).n;
    };
    expect(await countAudits()).toBe(1);

    // double-ack with the SAME token is an idempotent no-op — false, no new audit row
    const second = await ctx.workerPool.query(
      `SELECT ack_outbox_event($1, ARRAY[]::text[], $2) AS ok`,
      [ev, token],
    );
    expect((second.rows[0] as { ok: boolean }).ok).toBe(false);
    expect(await countAudits()).toBe(1); // unchanged
  });

  it("OAM-11: STALE-TOKEN REGRESSION — a token superseded by reclaim-and-reclaim cannot ack", async () => {
    const ev = await seedOutboxEvent(ctx.tenantA);
    const staleToken = await claimOne(ev);

    // force the lease into the past so the NEXT claim_outbox_batch call reclaims-then-reclaims it
    await expireLease(ev);
    const reclaim = await ctx.workerPool.query(
      `SELECT claim_token FROM claim_outbox_batch(100) WHERE event_id = $1`,
      [ev],
    );
    expect(reclaim.rows.length).toBe(1);
    const freshToken = (reclaim.rows[0] as { claim_token: string }).claim_token;
    expect(freshToken).not.toBe(staleToken);

    // the FIRST (now-stale) token must be a no-op, never acking over the current claimant
    const staleAck = await ctx.workerPool.query(
      `SELECT ack_outbox_event($1, ARRAY[]::text[], $2) AS ok`,
      [ev, staleToken],
    );
    expect((staleAck.rows[0] as { ok: boolean }).ok).toBe(false);

    const stillUnacked = await ctx.owner.query(`SELECT acked_at FROM outbox_events WHERE id = $1`, [
      ev,
    ]);
    expect((stillUnacked.rows[0] as { acked_at: Date | null }).acked_at).toBeNull();

    // the CURRENT (fresh) token acks successfully
    const freshAck = await ctx.workerPool.query(
      `SELECT ack_outbox_event($1, ARRAY[]::text[], $2) AS ok`,
      [ev, freshToken],
    );
    expect((freshAck.rows[0] as { ok: boolean }).ok).toBe(true);
  });

  it("OAM-12: claim_outbox_batch stamps the lease from a live clock, not a frozen transaction-start now() (codex round-01 [P2])", async () => {
    // 0022's original claim stamp used now(), frozen at transaction start — harmless for 0022
    // alone, but a caller running claim_outbox_batch inside an explicit transaction open more than
    // five minutes would receive an already-expired lease, and ack_outbox_event's live
    // clock_timestamp() guard would then reject a correctly-processed event forever. A real aged
    // transaction is 5+ minutes old; a short pg_sleep is enough to prove which clock the function
    // actually reads without slowing the suite down.
    const ev = await seedOutboxEvent(ctx.tenantA, "oam12.aged_txn");

    const client = await ctx.workerPool.connect();
    try {
      await client.query("BEGIN");
      const { rows: nowRows } = await client.query("SELECT now() AS t0");
      const t0 = (nowRows[0] as { t0: string }).t0;

      await client.query("SELECT pg_sleep(1.5)"); // now() stays frozen at t0; clock_timestamp() moves on

      const claimed = await client.query(
        `SELECT event_id FROM claim_outbox_batch(100) WHERE event_id = $1`,
        [ev],
      );
      expect(claimed.rows.length).toBe(1);
      await client.query("COMMIT");

      // claim_outbox_batch's RETURNS TABLE doesn't expose lease_expires_at, and app_worker has no
      // direct SELECT on outbox_events (JCL-9) — read the committed stamp via ctx.owner instead.
      const stamped = await ctx.owner.query(
        `SELECT lease_expires_at FROM outbox_events WHERE id = $1`,
        [ev],
      );
      const leaseExpiresAt = (stamped.rows[0] as { lease_expires_at: Date }).lease_expires_at;

      // now()-based stamp would be EXACTLY t0 + 5min; clock_timestamp()-based must be measurably
      // later (by ~1.5s), proving the live clock was read.
      const t0Plus5Min = new Date(t0).getTime() + 5 * 60_000;
      expect(leaseExpiresAt.getTime()).toBeGreaterThan(t0Plus5Min);
    } finally {
      client.release();
    }
  });

  it("OAM-13: ack_outbox_event and its audit row use a live clock too — never causally before claimed_at, even in the same aged transaction (codex round-02 [P2])", async () => {
    // round-01 fixed claimed_at/lease_expires_at to read a live clock; this proves the dependent
    // stamps (acked_at, and both audit rows' created_at) stay consistent with it — claim and ack
    // called back-to-back inside ONE aged transaction, the exact scenario round-01's fix targets.
    const ev = await seedOutboxEvent(ctx.tenantA, "oam13.aged_txn_ack");

    const client = await ctx.workerPool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_sleep(1.5)"); // age the transaction before claim+ack both run

      const claimed = await client.query(
        `SELECT claim_token FROM claim_outbox_batch(100) WHERE event_id = $1`,
        [ev],
      );
      expect(claimed.rows.length).toBe(1);
      const claimToken = (claimed.rows[0] as { claim_token: string }).claim_token;

      const acked = await client.query(`SELECT ack_outbox_event($1, ARRAY[]::text[], $2) AS ok`, [
        ev,
        claimToken,
      ]);
      expect((acked.rows[0] as { ok: boolean }).ok).toBe(true);

      await client.query("COMMIT");
    } finally {
      client.release();
    }

    const row = await ctx.owner.query(
      `SELECT claimed_at, acked_at FROM outbox_events WHERE id = $1`,
      [ev],
    );
    const { claimed_at: claimedAt, acked_at: ackedAt } = row.rows[0] as {
      claimed_at: Date;
      acked_at: Date;
    };
    expect(ackedAt.getTime()).toBeGreaterThanOrEqual(claimedAt.getTime());

    const audits = await ctx.owner.query(
      `SELECT reason, created_at FROM job_audit_events WHERE job_id = $1 ORDER BY created_at`,
      [ev],
    );
    const rows = audits.rows as { reason: string; created_at: Date }[];
    const claimedAudit = rows.find((r) => r.reason === "outbox_claimed")!;
    const ackedAudit = rows.find((r) => r.reason === "outbox_acked")!;
    expect(claimedAudit.created_at.getTime()).toBeGreaterThanOrEqual(claimedAt.getTime());
    expect(ackedAudit.created_at.getTime()).toBeGreaterThanOrEqual(
      claimedAudit.created_at.getTime(),
    );
  });
});

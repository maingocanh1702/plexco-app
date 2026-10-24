import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
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
// Namespace import ALONGSIDE the named imports above (not a replacement) — the CND regression
// guard (below) must enumerate EVERY table schema.ts declares, not just the ones other describe
// blocks in this file already import by name.
import * as schemaModule from "../schema.js";
import { migrate } from "./migrate.js";
import { tenantRepo, withTenant } from "./tenant.js";
import {
  bootstrapJobDefiner,
  expectErrorChainToMatch,
  setupNonSuperuserOwnerContext,
  setupRlsTestContext,
  withDefinerReadLock,
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
    expect(ctx.migrateResult.applied.length).toBe(72); // 0000..0071 (0071 zalo dm promotion start definer, 0070 member name control chars, 0069 member name invisible chars, 0068 public name invisible chars,0067 session venue visibility, 0066 account club chat context, 0065 chat message author label, 0064 channel identity link gate, 0063 chat message commands, 0062 gender pricing, 0061 public sessions projector writer, 0060 tenant public alias, 0059 me player reads definers, 0058 player self-join definer + player.promoted route, 0057 zalo delivery targets definer, 0056 outbox projector registry + DLQ replay, 0055 me settings definers, 0054 link_code reparent empty person, 0050 attested_transfer allocation source, 0051 host-add person definer, 0052 tenant profile definers, 0053 zalo ingress)
    const second = await ctx.remigrate();
    expect(second.applied).toEqual([]);
    expect(second.skipped.length).toBe(72);
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
  it("public_sessions columns are EXACTLY the approved whitelist, and the guarded view EXACTLY its 17", async () => {
    const columnsOf = async (rel: string) =>
      (
        await ctx.owner.query(
          `SELECT column_name FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
          [rel],
        )
      ).rows.map((r: { column_name: string }) => r.column_name);
    // 0061: skill_level (BL-DSC-1 retired), club_display_name (served live from the
    // tenant's approved alias) and host_display_name (persons are never projected) are
    // dropped; the 8 DD-41 columns and the opaque public_listing_id are added.
    expect((await columnsOf("public_sessions")).sort()).toEqual(
      [
        "id",
        "session_id",
        "tenant_id",
        "sport_key",
        "starts_at",
        "ends_at",
        "area",
        "price_amount",
        "slots_open",
        "join_policy",
        "projected_at",
        "expires_at",
        // control metadata (non-PII, 0033): a monotonic version counter that the
        // replaced view never serves (0061).
        "public_projection_version",
        "title",
        "session_type",
        "level_min_rank",
        "level_max_rank",
        "level_strict",
        "gender_restriction",
        "age_min",
        "age_max",
        "public_listing_id",
        // 0067 (DD-139 / owner decision B1): the projected venue, NULL whenever the
        // session's hide_exact_address option is ON.
        "venue_name",
        "venue_address",
      ].sort(),
    );
    // The view serves exactly these, in order: never session_id, tenant_id,
    // public_projection_version, a share slug, host_display_name or confirmed_count.
    expect(await columnsOf("public_session_share_v")).toEqual([
      "public_listing_id",
      "sport_key",
      "starts_at",
      "ends_at",
      "area",
      "price_amount",
      "slots_open",
      "club_display_name",
      "join_policy",
      "title",
      "session_type",
      "level_min_rank",
      "level_max_rank",
      "level_strict",
      "gender_restriction",
      "age_min",
      "age_max",
      // 0067 (DD-139 / owner decision B1): the projected venue, NULL whenever the
      // session's hide_exact_address option is ON.
      "venue_name",
      "venue_address",
    ]);
  });

  it("no public column smells like money/PII/roster", async () => {
    // venue_address left this list in 0067: the venue is public by default (DD-139 / owner
    // decision B1), and the writer projects NULL while hide_exact_address is ON.
    const { rows } = await ctx.owner.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'public_sessions'
         AND column_name ~* '(phone|email|debt|paid|roster|member|account|secret|token)'`,
    );
    expect(rows).toEqual([]);
  });

  it("readonly is DENIED on the public_sessions BASE (moved off it by 0033) and reads the guarded view instead; ZERO grant on canonical tables", async () => {
    // DD-12 / DD-73 Q5 immediate-deny cutover: 0033 REVOKEs readonly's base
    // SELECT and grants the guarded view public_session_share_v. A base read
    // would bypass the fence (decisions.md:269), so it must now be denied.
    await expect(
      ctx.readonlyPool.query(`SELECT * FROM public_sessions LIMIT 1`),
      "readonly must be denied on the public_sessions BASE after the 0033 REVOKE",
    ).rejects.toThrow(/permission denied/i);
    await expect(
      ctx.readonlyPool.query(`SELECT count(*) FROM public_session_share_v`),
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

describe("public projection fences — immediate-deny path (DD-12 / DD-73 Q5 / DD-75, migration 0033)", () => {
  // Seed a REAL session (raise verifies tenant ownership against sessions) and a
  // public_sessions projection row for it. The projection's starts_at/expires_at
  // are its OWN values (a real projector would set them); the fence only needs a
  // live, non-expired public row to deny.
  async function seedProjectedSession(
    tenantId: string,
    hour: number,
    opts: { expiresInPast?: boolean } = {},
  ): Promise<string> {
    const session = await createIn(tenantId, hour);
    const expires = opts.expiresInPast ? "now() - interval '1 minute'" : "now() + interval '1 day'";
    // 0061: the view serves club_display_name live from the tenant's approved alias and
    // hides tenants without one, so the seed approves an alias instead of storing a name.
    await ctx.owner.query(
      `UPDATE tenants SET public_alias = 'Club A', public_alias_status = 'approved' WHERE id = $1`,
      [tenantId],
    );
    await ctx.owner.query(
      `INSERT INTO public_sessions
         (id, session_id, tenant_id, sport_key, starts_at, ends_at, area,
          price_amount, slots_open, join_policy, expires_at)
       VALUES ($1, $1, $2, 'badminton', now(), now() + interval '2 hours', 'D1',
          110000, 4, 'open', ${expires})`,
      [session.id, tenantId],
    );
    return session.id;
  }

  // Call raise_public_session_fence AS app inside a real transaction with a
  // tenant GUC (set_config local — deterministic, unlike a possibly-stale pooled
  // GUC). tenantId "" exercises the fail-closed empty-context path.
  const raiseAs = async (tenantId: string, sessionId: string, reason: string): Promise<void> => {
    const client = await ctx.appPool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      await client.query(`SELECT raise_public_session_fence($1::uuid, $2)`, [sessionId, reason]);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  };

  // 0061: the view never serves session_id; the owner reads the row's opaque
  // public_listing_id from the base, then the view is read by that id as readonly.
  const viewRows = async (sessionId: string) => {
    const base = await ctx.owner.query(
      `SELECT public_listing_id FROM public_sessions WHERE session_id = $1`,
      [sessionId],
    );
    if (base.rows.length === 0) return [];
    return (
      await ctx.readonlyPool.query(
        `SELECT * FROM public_session_share_v WHERE public_listing_id = $1`,
        [base.rows[0].public_listing_id],
      )
    ).rows;
  };
  const baseRows = async (sessionId: string) =>
    (await ctx.owner.query(`SELECT * FROM public_sessions WHERE session_id = $1`, [sessionId]))
      .rows;
  // D3 (s1 S-1): no runtime role may observe or clear a fence; only the 0061 writer does, as
  // job_definer. These helpers exercise the 0033 functions themselves on the owner connection.
  const observeToken = async (sessionId: string) =>
    (await ctx.owner.query(`SELECT current_public_session_fence_token($1::uuid) AS t`, [sessionId]))
      .rows[0].t as string | null;
  const clearFence = async (sessionId: string, token: string) =>
    (
      await ctx.owner.query(`SELECT clear_public_session_fence($1::uuid, $2::uuid) AS cleared`, [
        sessionId,
        token,
      ])
    ).rows[0].cleared as boolean;

  it("(a) IMMEDIATE DENY: after a private/cancel raise and BEFORE any projector run, the row is gone from the guarded view while the base projection row still exists", async () => {
    const sid = await seedProjectedSession(ctx.tenantA, 3);
    // pre-raise: the discovery consumer sees the row through the guarded view
    expect((await viewRows(sid)).length).toBe(1);
    // the privacy-reducing transition raises the fence in the SAME source tx
    await raiseAs(ctx.tenantA, sid, "cancelled");
    // read-time deny is IMMEDIATE — the view no longer returns it ...
    expect((await viewRows(sid)).length).toBe(0);
    // ... yet the base projection row is untouched: the async projector has NOT
    // run. This is exactly the leak window this slice closes at READ time.
    expect((await baseRows(sid)).length).toBe(1);
  });

  it("(b) after 0033 NO runtime role can read the base table, and the fence table is global-protected (zero direct grant)", async () => {
    // NO runtime role may SELECT the base after 0033 — a base read would bypass
    // the immediate-deny fence (decisions.md:269). readonly and app_worker never
    // had it (or lost it); `app` — the generic HTTP/bot runtime role — is revoked
    // here too, so ordinary app code cannot read a stale fenced row. `app` also
    // has ZERO INSERT/UPDATE/DELETE as of 0036_revoke_app_dml_public_sessions.sql
    // (asserted separately, in the catalog test below).
    for (const pool of [ctx.appPool, ctx.readonlyPool, ctx.workerPool]) {
      await expect(pool.query(`SELECT * FROM public_sessions LIMIT 1`)).rejects.toThrow(
        /permission denied/i,
      );
    }
    // fence table: no direct grant to ANY runtime role — access only via the
    // narrow SECURITY DEFINER functions.
    for (const pool of [ctx.appPool, ctx.readonlyPool, ctx.workerPool]) {
      await expect(pool.query(`SELECT * FROM public_projection_fences LIMIT 1`)).rejects.toThrow(
        /permission denied/i,
      );
    }
  });

  it("catalog: EXACT effective privileges — fence table zero-grant of any type to every runtime role; no runtime role has base SELECT at table OR column level; app has ZERO grant of any kind on the base (0036_revoke_app_dml_public_sessions.sql); only readonly reads the guarded view", async () => {
    // A `SELECT *` probe alone (test (b)) misses column-level SELECT and never
    // checks INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER — a stray write grant
    // would bypass the typed raise/CAS functions. Assert the exact effective
    // privilege catalog for every runtime role.
    const TABLE_PRIVS = [
      "SELECT",
      "INSERT",
      "UPDATE",
      "DELETE",
      "TRUNCATE",
      "REFERENCES",
      "TRIGGER",
    ];
    const ROLES = ["app", "app_worker", "readonly"];
    const hasTable = async (role: string, table: string, priv: string) =>
      (await ctx.owner.query(`SELECT has_table_privilege($1, $2, $3) AS ok`, [role, table, priv]))
        .rows[0].ok as boolean;

    // fence table — zero privilege of ANY type for EVERY runtime role.
    for (const role of ROLES) {
      for (const priv of TABLE_PRIVS) {
        expect(
          await hasTable(role, "public_projection_fences", priv),
          `${role} must have NO ${priv} on the fence table`,
        ).toBe(false);
      }
    }

    // base public_sessions — NO runtime role may SELECT at table level ...
    for (const role of ROLES) {
      expect(
        await hasTable(role, "public_sessions", "SELECT"),
        `${role} must have NO table SELECT on the base`,
      ).toBe(false);
    }
    // ... nor at COLUMN level (has_table_privilege('SELECT') alone misses a per-column grant).
    const baseCols = (
      await ctx.owner.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema='public' AND table_name='public_sessions'`,
      )
    ).rows.map((r: { column_name: string }) => r.column_name);
    for (const role of ROLES) {
      for (const col of baseCols) {
        const ok = (
          await ctx.owner.query(
            `SELECT has_column_privilege($1, 'public_sessions', $2, 'SELECT') AS ok`,
            [role, col],
          )
        ).rows[0].ok as boolean;
        expect(ok, `${role} must have NO column SELECT on public_sessions.${col}`).toBe(false);
      }
    }
    // app has ZERO direct DML on the base (0036_revoke_app_dml_public_sessions.sql,
    // applying DD-12:274's surgical-grant principle to the half-revoke 0033
    // left open: SELECT was already revoked there, INSERT/UPDATE/DELETE were
    // an unclaimed leftover from 0009's original "projector writes" grant).
    for (const priv of ["INSERT", "UPDATE", "DELETE"]) {
      expect(
        await hasTable("app", "public_sessions", priv),
        `app must have NO ${priv} on the base`,
      ).toBe(false);
    }
    // ... nor at COLUMN level (round-1 [P1] finding: has_table_privilege alone
    // misses a per-column INSERT/UPDATE/REFERENCES grant -- DELETE and TRIGGER
    // have no column-level form in Postgres, so they are not checked here.
    // REFERENCES added per round-2 [P2] finding: the round-1 fix checked
    // INSERT/UPDATE only, missing that REFERENCES also has a column-level
    // form). 0009's original grant and 0036's revoke were both table-level
    // statements with no column list, so no column-level grant is expected to
    // exist independently -- this proves that rather than assuming it.
    for (const col of baseCols) {
      for (const priv of ["INSERT", "UPDATE", "REFERENCES"]) {
        const ok = (
          await ctx.owner.query(
            `SELECT has_column_privilege($1, 'public_sessions', $2, $3) AS ok`,
            ["app", col, priv],
          )
        ).rows[0].ok as boolean;
        expect(ok, `app must have NO column ${priv} on public_sessions.${col}`).toBe(false);
      }
    }
    for (const priv of ["TRUNCATE", "REFERENCES", "TRIGGER"]) {
      expect(
        await hasTable("app", "public_sessions", priv),
        `app must have NO ${priv} on the base`,
      ).toBe(false);
    }
    // app_worker + readonly hold nothing at all on the base.
    for (const role of ["app_worker", "readonly"]) {
      for (const priv of TABLE_PRIVS) {
        expect(
          await hasTable(role, "public_sessions", priv),
          `${role} must have NO ${priv} on the base`,
        ).toBe(false);
      }
    }
    // guarded view — only readonly reads it.
    expect(await hasTable("readonly", "public_session_share_v", "SELECT")).toBe(true);
    expect(await hasTable("app", "public_session_share_v", "SELECT")).toBe(false);
    expect(await hasTable("app_worker", "public_session_share_v", "SELECT")).toBe(false);
  });

  it("ABSENCE: app cannot INSERT/UPDATE/DELETE public_sessions directly (0036_revoke_app_dml_public_sessions.sql) — a live attempt is rejected, not just a catalog check", async () => {
    const sid = randomUUID();
    // the privilege check happens before row-matching, so a live attempt against
    // an id that does not even exist still proves the grant is gone -- no
    // sanctioned writer path exists on this table to seed a row through.
    await expect(
      ctx.appPool.query(
        `INSERT INTO public_sessions
           (id, session_id, tenant_id, sport_key, starts_at, ends_at, area,
            price_amount, slots_open, join_policy, expires_at)
         VALUES ($1, $1, $2, 'badminton', now(), now() + interval '2 hours', 'D1',
            1, 1, 'open', now() + interval '1 day')`,
        [sid, ctx.tenantA],
      ),
      "app must be denied direct INSERT on public_sessions",
    ).rejects.toThrow(/permission denied/i);
    // round-1 [P1] finding: a WHERE id = $1 clause requires SELECT(id), which
    // app already lacked before this migration (0033) -- that probe could pass
    // for the wrong reason even if UPDATE/DELETE were still granted. Unconditional
    // statements (no WHERE, no RETURNING) isolate the UPDATE/DELETE check from
    // the pre-existing SELECT revoke; the privilege check still fires before any
    // row-matching, so this needs no seeded row and affecting zero rows either
    // way does not weaken the assertion.
    await expect(
      ctx.appPool.query(`UPDATE public_sessions SET slots_open = 0`),
      "app must be denied direct UPDATE on public_sessions",
    ).rejects.toThrow(/permission denied/i);
    await expect(
      ctx.appPool.query(`DELETE FROM public_sessions`),
      "app must be denied direct DELETE on public_sessions",
    ).rejects.toThrow(/permission denied/i);
  });

  it("(c) the guarded view exposes EXACTLY the BL-DSC-1 fields + the DD-41 columns + public_listing_id — no session_id, no public_projection_version, no host name, no retired skill_level, no expires_at, no tenant_id, no money/PII, no fence/token", async () => {
    const { rows } = await ctx.owner.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'public_session_share_v'`,
    );
    const cols = (rows as { column_name: string }[]).map((r) => r.column_name).sort();
    // DD-73:914 — the guarded view follows BL-DSC-1, NOT 0006. 0061 replaces it:
    // the row identity is the opaque public_listing_id (never session_id), the
    // control column is no longer served, club_display_name is the live approved
    // alias, and persons (host_display_name) are never projected.
    expect(cols).toEqual(
      [
        "public_listing_id",
        "sport_key",
        "starts_at",
        "ends_at",
        "area",
        "price_amount",
        "slots_open",
        "club_display_name",
        "join_policy",
        "title",
        "session_type",
        "level_min_rank",
        "level_max_rank",
        "level_strict",
        "gender_restriction",
        "age_min",
        "age_max",
        // 0067 (DD-139 / owner decision B1): the projected venue, NULL whenever the
        // session's hide_exact_address option is ON.
        "venue_name",
        "venue_address",
      ].sort(),
    );
    for (const hidden of [
      "session_id",
      "public_projection_version",
      "host_display_name",
      "confirmed_count",
      "skill_level", // DD-73:914 retired — must not resurface in the guarded view
      "tenant_id", // HR2: internal routing, never serialized
    ]) {
      expect(cols).not.toContain(hidden);
    }
    // venue_address left this list in 0067: the venue is public by default (DD-139 / owner
    // decision B1), and the writer projects NULL while hide_exact_address is ON.
    const smelly = cols.filter((c) =>
      /(phone|email|debt|paid|roster|member|account|secret|token|fence)/i.test(c),
    );
    expect(smelly).toEqual([]);
  });

  it("the guarded view is a security_barrier view — a caller's non-leakproof predicate cannot be pushed below the fence/expiry filters to observe a denied row", async () => {
    const { rows } = await ctx.owner.query(
      `SELECT c.reloptions FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = 'public_session_share_v' AND c.relkind = 'v'`,
    );
    expect(rows.length).toBe(1);
    expect((rows[0] as { reloptions: string[] | null }).reloptions ?? []).toContain(
      "security_barrier=true",
    );
  });

  it("public_sessions enforces id = session_id — the view's session_id fence anti-join cannot diverge from raise's canonical-id fence (a divergent row would leak a fenced session)", async () => {
    // matched id=session_id inserts already succeed throughout this block via
    // seedProjectedSession ($1,$1). A divergent row is rejected by the named CHECK.
    await expect(
      ctx.owner.query(
        `INSERT INTO public_sessions
           (id, session_id, tenant_id, sport_key, starts_at, ends_at, area,
            price_amount, slots_open, join_policy, expires_at)
         VALUES ($1, $2, $3, 'badminton', now(), now() + interval '2 hours', 'D1',
            110000, 4, 'open', now() + interval '1 day')`,
        [randomUUID(), randomUUID(), ctx.tenantA],
      ),
    ).rejects.toThrow(/public_sessions_id_session_id_chk/);
  });

  it("CAS-clear: a stale token is a no-op (fence persists, view stays denied); the observed token clears it (row visible again); a re-raise wins with a fresh token", async () => {
    const sid = await seedProjectedSession(ctx.tenantA, 4);
    await raiseAs(ctx.tenantA, sid, "visibility_private");
    expect((await viewRows(sid)).length).toBe(0);

    const token1 = await observeToken(sid);
    expect(token1).toBeTruthy();

    // stale/unknown token → clear no-ops, deny persists (new token wins)
    expect(await clearFence(sid, randomUUID())).toBe(false);
    expect((await viewRows(sid)).length).toBe(0);

    // exact observed token → clears; the row is visible again (projector converged)
    expect(await clearFence(sid, token1!)).toBe(true);
    expect((await viewRows(sid)).length).toBe(1);

    // re-raise REPLACES with a fresh token so a stale worker cannot resurrect it
    await raiseAs(ctx.tenantA, sid, "closed");
    const token2 = await observeToken(sid);
    expect(token2).not.toBe(token1);
    expect(await clearFence(sid, token1!)).toBe(false); // old token no longer current
    expect((await viewRows(sid)).length).toBe(0);
  });

  it("fence race (CONCURRENT two-client lock-wait + recheck, decisions.md:923, D3) — the WRITER observes T1, blocks at its last-statement CAS-clear behind a newer raise, re-checks under READ COMMITTED and keeps T2 so denial survives; its next run clears T2 and converges", async () => {
    const sid = await seedProjectedSession(ctx.tenantA, 9);
    // createIn makes a past private session: make it eligible so the writer takes the rotated path.
    await ctx.owner.query(
      `UPDATE sessions SET visibility = 'public', area = 'D1', slots_max = 8, join_policy = 'open',
              starts_at = now() + interval '1 day', ends_at = now() + interval '1 day 2 hours'
        WHERE id = $1`,
      [sid],
    );
    await raiseAs(ctx.tenantA, sid, "cancelled");
    const t1 = await observeToken(sid);
    expect((await viewRows(sid)).length).toBe(0);

    const source = await ctx.appPool.connect(); // client A — the source transition (raise)
    const worker = await ctx.workerPool.connect(); // client B — the projector writer
    try {
      const workerPid = (await worker.query(`SELECT pg_backend_pid() AS pid`)).rows[0]
        .pid as number;

      // A raises a NEWER token (T2) and holds the fence-row lock uncommitted.
      await source.query("BEGIN");
      await source.query(`SELECT set_config('app.tenant_id', $1, true)`, [ctx.tenantA]);
      await source.query(`SELECT raise_public_session_fence($1::uuid, 'closed')`, [sid]);

      // B's writer observes the committed T1, rotates, then blocks at its CAS-clear of T1 on
      // A's uncommitted upsert (D3: the clear is the writer's last statement).
      const writerRun = worker.query(
        `SELECT public_sessions_project_session($1::uuid, NULL) AS d`,
        [sid],
      );
      writerRun.catch(() => undefined); // awaited below; never an unhandled rejection meanwhile
      // Deterministically wait until B is genuinely blocked ON A (not a fixed sleep).
      for (let i = 0; ; i++) {
        const { rows } = await ctx.owner.query(
          `SELECT COALESCE(array_length(pg_blocking_pids($1), 1), 0) AS n`,
          [workerPid],
        );
        if ((rows[0].n as number) > 0) break;
        if (i > 200)
          throw new Error("writer's CAS-clear never blocked on the source's fence-row lock");
        await new Promise((r) => setTimeout(r, 25));
      }
      // Commit A → T2 is now current. B unblocks and re-checks its WHERE against the
      // committed row (token is T2, not T1) under READ COMMITTED → deletes nothing.
      await source.query("COMMIT");
      expect((await writerRun).rows[0].d).toBe("rotated");
      expect((await viewRows(sid)).length).toBe(0); // denial SURVIVED the writer's stale clear
      const t2 = await observeToken(sid);
      expect(t2).toBeTruthy();
      expect(t2).not.toBe(t1);

      // B's next run observes T2 and clears it as its last statement → converges, row visible.
      const next = await worker.query(
        `SELECT public_sessions_project_session($1::uuid, NULL) AS d`,
        [sid],
      );
      expect(next.rows[0].d).toBe("rotated");
      expect(await observeToken(sid)).toBeNull();
      expect((await viewRows(sid)).length).toBe(1);
    } finally {
      await source.query("ROLLBACK").catch(() => {});
      source.release();
      worker.release();
    }
  });

  it("EXECUTE grants: only app may raise; NO runtime role may observe/clear (D3: only the 0061 writer, as job_definer); readonly may call none", async () => {
    const sid = await seedProjectedSession(ctx.tenantA, 5);
    const anyUuid = randomUUID();
    // readonly cannot raise / observe / clear
    await expect(
      ctx.readonlyPool.query(`SELECT raise_public_session_fence($1::uuid, 'cancelled')`, [sid]),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      ctx.readonlyPool.query(`SELECT current_public_session_fence_token($1::uuid)`, [sid]),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      ctx.readonlyPool.query(`SELECT clear_public_session_fence($1::uuid, $2::uuid)`, [
        sid,
        anyUuid,
      ]),
    ).rejects.toThrow(/permission denied/i);
    // app_worker cannot raise (source-transaction-only)
    await expect(
      ctx.workerPool.query(`SELECT raise_public_session_fence($1::uuid, 'cancelled')`, [sid]),
    ).rejects.toThrow(/permission denied/i);
    // neither app nor app_worker can observe / clear (D3, s1 S-1: the clear runs only inside
    // public_sessions_project_session, after a canonical recompute)
    for (const pool of [ctx.appPool, ctx.workerPool]) {
      await expect(
        pool.query(`SELECT current_public_session_fence_token($1::uuid)`, [sid]),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        pool.query(`SELECT clear_public_session_fence($1::uuid, $2::uuid)`, [sid, anyUuid]),
      ).rejects.toThrow(/permission denied/i);
    }
  });

  it("raise is tenant-scoped and fail-closed: a session outside the caller tenant, and a call with no tenant context, are both refused and write no fence (DD-75 derive+verify server-side)", async () => {
    const sid = await seedProjectedSession(ctx.tenantA, 6);
    // tenant B cannot fence tenant A's session
    await expect(raiseAs(ctx.tenantB, sid, "cancelled")).rejects.toThrow(
      /not in the caller tenant/i,
    );
    // empty tenant context (fail-closed on missing GUC)
    await expect(raiseAs("", sid, "cancelled")).rejects.toThrow(/not in the caller tenant/i);
    // nothing was fenced — the view still shows the row
    expect((await viewRows(sid)).length).toBe(1);
  });

  it("raise rejects an unknown reason (closed enum: visibility_private|cancelled|closed) and writes no fence", async () => {
    const sid = await seedProjectedSession(ctx.tenantA, 7);
    await expect(raiseAs(ctx.tenantA, sid, "deleted")).rejects.toThrow(/reason must be/i);
    expect((await viewRows(sid)).length).toBe(1);
  });

  it("the guarded view also hides an EXPIRED projection row even without a fence (expires_at gate), while the base row remains", async () => {
    const sid = await seedProjectedSession(ctx.tenantA, 8, { expiresInPast: true });
    expect((await viewRows(sid)).length).toBe(0);
    expect((await baseRows(sid)).length).toBe(1);
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
      // same lock protection as everywhere else 0022 is reached for the first time. The reader side
      // of chat_definer's too (codex round-03 [P2]): this full replay reaches 0030, which needs
      // chat_definer the ROLE to exist by NAME (admin is a superuser, so no membership needed,
      // unlike the non-superuser-owner contexts) — a sibling file's negative test renaming it away
      // could otherwise race this exact moment.
      const res = await withDefinerReadLock(BASE!, async () => {
        await bootstrapJobDefiner(admin);
        return migrate(url(dbName));
      });
      expect(res.applied.length).toBe(72); // 0000..0071

      const c = await connect(url(dbName));
      try {
        const { rows } = await c.query(`SELECT name, sha256 FROM schema_migrations ORDER BY name`);
        expect(rows.length).toBe(72);
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
    // Matched by schema.ts's declared names sessions_vis_chk/sessions_slots_chk as of 0025
    // (db-check-constraint-naming-drift). Before 0025, live pg_constraint showed the ORIGINAL 0002
    // inline column CHECKs never got those names — Postgres auto-named them
    // sessions_visibility_check and sessions_slots_max_check (same class of drift schema.ts:107-111
    // already documented as fixed for players in 0014, never fixed for sessions until now). Found
    // while writing THIS test in the prior slice and deliberately deferred as out of that slice's
    // scope; 0025 is the sweep that closes it.
    await expect(
      ctx.owner.query(
        `INSERT INTO sessions (tenant_id, sport_id, starts_at, ends_at, timezone, visibility)
         VALUES ($1, $2, now(), now() + interval '1 hour', 'Asia/Ho_Chi_Minh', 'secret')`,
        [ctx.tenantA, ctx.badmintonSportId],
      ),
    ).rejects.toThrow(/violates check constraint "sessions_vis_chk"/);

    await expect(
      ctx.owner.query(
        `INSERT INTO sessions (tenant_id, sport_id, starts_at, ends_at, timezone, slots_max)
         VALUES ($1, $2, now(), now() + interval '1 hour', 'Asia/Ho_Chi_Minh', 0)`,
        [ctx.tenantA, ctx.badmintonSportId],
      ),
    ).rejects.toThrow(/violates check constraint "sessions_slots_chk"/);
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
      // continuous lock hold, matching setupRlsTestContext / JCL-4 / JCL-12. Also chat_definer
      // (2026-08-05, owner-authorized scope amendment): migrate() now reaches 0030
      // (chat-dm-safety-authority-core), which does ALTER FUNCTION ... OWNER TO chat_definer and
      // mechanically requires nsCtx's owner role to already be a member of chat_definer.
      //
      // codex round-05 [P1]: bootstrapChatDefinerForOwner now acquires and holds the chat lock
      // itself, internally, through nsCtx.teardown() (see test-harness.ts's own comment) — nesting
      // withChatDefinerLock here would deadlock (two different connections each waiting on the
      // same session-scoped advisory lock the other holds). job_definer has no such internal hold
      // (its own bootstrap never revokes an existing member), so withJobDefinerLock still wraps
      // this whole sequence explicitly.
      await withJobDefinerLock(process.env.DATABASE_URL_TEST!, async () => {
        await nsCtx.bootstrapJobDefinerForOwner();
        await nsCtx.bootstrapChatDefinerForOwner();
        const res = await nsCtx.runMigration();
        expect(res.applied[res.applied.length - 1]).toBe(
          "0071_zalo_dm_promotion_start_definer.sql",
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
            // 0041 (audit X-5): worker business liveness, same job_definer posture.
            "job_worker_heartbeat",
            "job_worker_liveness",
            // 0056 (Phase 3 L3): projector registry, DLQ owner path, schedule live check, draft expiry.
            "outbox_required_projectors",
            "projector_is_enabled",
            "outbox_projector_set_enabled",
            "outbox_claimed_event",
            "outbox_dlq_list",
            "outbox_dlq_replay",
            "outbox_dispatch_schedule_live",
            "job_expire_stale_drafts",
            // 0057 (Phase 3 L4): zalo_dm delivery targets + per-recipient record.
            "zalo_dm_delivery_targets",
            "zalo_dm_record_recipient",
            // 0061 (Phase 3 L10): public_sessions writer, occupancy, share-slug registry, lookups.
            "session_occupancy",
            "public_sessions_project_session",
            "public_sessions_tenant_candidates",
            "public_sessions_sweep_expired",
            "public_session_share_slug_rotate",
            "public_session_share_slug_revoke",
            "public_share_slug_resolve",
            "public_listing_resolve",
            // 0071 (L34, DD-146 amendment): zalo_dm promotion DM start check.
            "zalo_dm_promotion_seconds_to_start",
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
    // Under the reader lock, as JRD-11: a breaker window grants job_definer to app_worker.
    await withJobDefinerLock(process.env.DATABASE_URL_TEST!, async () => {
      for (const [sql, params] of denied) {
        await expect(ctx.workerPool.query(sql, params), sql).rejects.toThrow(/permission denied/i);
      }
    });

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
          // 0041 (audit X-5): worker business liveness, same job_definer posture.
          "job_worker_heartbeat",
          "job_worker_liveness",
          // 0056 (Phase 3 L3): projector registry, DLQ owner path, schedule live check, draft expiry.
          "outbox_required_projectors",
          "projector_is_enabled",
          "outbox_projector_set_enabled",
          "outbox_claimed_event",
          "outbox_dlq_list",
          "outbox_dlq_replay",
          "outbox_dispatch_schedule_live",
          "job_expire_stale_drafts",
          // 0057 (Phase 3 L4): zalo_dm delivery targets + per-recipient record.
          "zalo_dm_delivery_targets",
          "zalo_dm_record_recipient",
          // 0061 (Phase 3 L10): public_sessions writer, occupancy, share-slug registry, lookups.
          "session_occupancy",
          "public_sessions_project_session",
          "public_sessions_tenant_candidates",
          "public_sessions_sweep_expired",
          "public_session_share_slug_rotate",
          "public_session_share_slug_revoke",
          "public_share_slug_resolve",
          "public_listing_resolve",
          // 0071 (L34, DD-146 amendment): zalo_dm promotion DM start check.
          "zalo_dm_promotion_seconds_to_start",
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

/**
 * CND-1..CND-11 — check constraint naming drift (0025, design-probe.md).
 *
 * 40 auto-generated CHECK constraint names, across 23 tables, renamed to the name schema.ts
 * already declares. Zero predicate change — every pair below was matched by exact referenced-
 * column-set identity, then read manually, before 0025 was written (design-probe.md appendix).
 * 12 of the 40 are money-path (charges/bank_transactions/payment_allocations/bank_accounts) and
 * get CND-4 coverage as individually named tests, not folded into the generic loop, per CND-5.
 */
describe("CND-1..CND-11 check constraint naming drift (0025)", () => {
  const RENAMED: { table: string; oldAuto: string; newDeclared: string; money: boolean }[] = [
    {
      table: "persons",
      oldAuto: "persons_status_check",
      newDeclared: "persons_status_chk",
      money: false,
    },
    {
      table: "channel_identities",
      oldAuto: "channel_identities_platform_check",
      newDeclared: "channel_identities_platform_chk",
      money: false,
    },
    {
      table: "auth_email_tokens",
      oldAuto: "auth_email_tokens_purpose_check",
      newDeclared: "auth_email_tokens_purpose_chk",
      money: false,
    },
    {
      table: "auth_email_deliveries",
      oldAuto: "auth_email_deliveries_kind_check",
      newDeclared: "auth_email_deliveries_kind_chk",
      money: false,
    },
    {
      table: "auth_email_deliveries",
      oldAuto: "auth_email_deliveries_command_operation_check",
      newDeclared: "auth_email_deliveries_operation_chk",
      money: false,
    },
    {
      table: "auth_email_deliveries",
      oldAuto: "auth_email_deliveries_outcome_check",
      newDeclared: "auth_email_deliveries_outcome_chk",
      money: false,
    },
    {
      table: "tenants",
      oldAuto: "tenants_status_check",
      newDeclared: "tenants_status_chk",
      money: false,
    },
    {
      table: "memberships",
      oldAuto: "memberships_status_check",
      newDeclared: "memberships_status_chk",
      money: false,
    },
    {
      table: "sessions",
      oldAuto: "sessions_check",
      newDeclared: "sessions_time_chk",
      money: false,
    },
    {
      table: "sessions",
      oldAuto: "sessions_price_amount_check",
      newDeclared: "sessions_price_chk",
      money: false,
    },
    {
      table: "sessions",
      oldAuto: "sessions_slots_max_check",
      newDeclared: "sessions_slots_chk",
      money: false,
    },
    {
      table: "sessions",
      oldAuto: "sessions_visibility_check",
      newDeclared: "sessions_vis_chk",
      money: false,
    },
    {
      table: "sessions",
      oldAuto: "sessions_join_policy_check",
      newDeclared: "sessions_join_chk",
      money: false,
    },
    {
      table: "sessions",
      oldAuto: "sessions_status_check",
      newDeclared: "sessions_status_chk",
      money: false,
    },
    {
      table: "telegram_links",
      oldAuto: "telegram_links_kind_check",
      newDeclared: "telegram_links_kind_chk",
      money: false,
    },
    {
      table: "tenant_admins",
      oldAuto: "tenant_admins_role_check",
      newDeclared: "tenant_admins_role_chk",
      money: false,
    },
    {
      table: "bank_accounts",
      oldAuto: "bank_accounts_provider_check",
      newDeclared: "bank_accounts_provider_chk",
      money: true,
    },
    {
      table: "charges",
      oldAuto: "charges_amount_due_check",
      newDeclared: "charges_due_chk",
      money: true,
    },
    {
      table: "charges",
      oldAuto: "charges_amount_allocated_check",
      newDeclared: "charges_alloc_chk",
      money: true,
    },
    {
      table: "charges",
      oldAuto: "charges_check",
      newDeclared: "charges_alloc_le_due_chk",
      money: true,
    },
    {
      table: "charges",
      oldAuto: "charges_status_check",
      newDeclared: "charges_status_chk",
      money: true,
    },
    {
      table: "bank_transactions",
      oldAuto: "bank_transactions_amount_check",
      newDeclared: "bank_txn_amount_chk",
      money: true,
    },
    {
      table: "bank_transactions",
      oldAuto: "bank_transactions_unallocated_amount_check",
      newDeclared: "bank_txn_unalloc_chk",
      money: true,
    },
    {
      table: "bank_transactions",
      oldAuto: "bank_transactions_check",
      newDeclared: "bank_txn_unalloc_le_chk",
      money: true,
    },
    {
      table: "bank_transactions",
      oldAuto: "bank_transactions_reconcile_status_check",
      newDeclared: "bank_txn_reconcile_chk",
      money: true,
    },
    {
      table: "payment_allocations",
      oldAuto: "payment_allocations_amount_check",
      newDeclared: "alloc_amount_nonzero_chk",
      money: true,
    },
    {
      table: "payment_allocations",
      oldAuto: "payment_allocations_source_check",
      newDeclared: "alloc_source_chk",
      money: true,
    },
    {
      table: "payment_allocations",
      oldAuto: "payment_allocations_check",
      newDeclared: "alloc_shape_chk",
      money: true,
    },
    {
      table: "provider_connections",
      oldAuto: "provider_connections_provider_check",
      newDeclared: "provider_connections_provider_chk",
      money: false,
    },
    {
      table: "provider_connections",
      oldAuto: "provider_connections_auth_mode_check",
      newDeclared: "provider_connections_auth_chk",
      money: false,
    },
    {
      table: "projector_deliveries",
      oldAuto: "projector_deliveries_status_check",
      newDeclared: "projector_status_chk",
      money: false,
    },
    {
      table: "join_requests",
      oldAuto: "join_requests_status_check",
      newDeclared: "join_requests_status_chk",
      money: false,
    },
    { table: "plans", oldAuto: "plans_plan_key_check", newDeclared: "plans_key_chk", money: false },
    {
      table: "subscriptions",
      oldAuto: "subscriptions_selected_extra_channel_check",
      newDeclared: "subscriptions_extra_chk",
      money: false,
    },
    {
      table: "subscriptions",
      oldAuto: "subscriptions_status_check",
      newDeclared: "subscriptions_status_chk",
      money: false,
    },
    {
      table: "subscription_invoices",
      oldAuto: "subscription_invoices_status_check",
      newDeclared: "subscription_invoices_status_chk",
      money: false,
    },
    {
      table: "notification_intents",
      oldAuto: "notification_intents_status_check",
      newDeclared: "notif_intents_status_chk",
      money: false,
    },
    {
      table: "notification_deliveries",
      oldAuto: "notification_deliveries_status_check",
      newDeclared: "notif_deliveries_status_chk",
      money: false,
    },
    {
      table: "onboarding_runs",
      oldAuto: "onboarding_runs_status_check",
      newDeclared: "onboarding_runs_status_chk",
      money: false,
    },
    {
      table: "onboarding_steps",
      oldAuto: "onboarding_steps_status_check",
      newDeclared: "onboarding_steps_status_chk",
      money: false,
    },
  ];

  /** table.name -> pg_get_constraintdef, for every live CHECK constraint in the public schema. */
  async function allLiveCheckDefs(client: pg.Client): Promise<Map<string, string>> {
    const { rows } = await client.query<{ t: string; n: string; d: string }>(
      `SELECT rel.relname AS t, con.conname AS n, pg_get_constraintdef(con.oid) AS d
       FROM pg_constraint con
       JOIN pg_class rel ON rel.oid = con.conrelid
       JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
       WHERE con.contype = 'c' AND nsp.nspname = 'public'`,
    );
    return new Map(rows.map((r) => [`${r.t}.${r.n}`, r.d]));
  }

  /**
   * Every "table.check-name" key schema.ts declares, walking its own exports — not a
   * hand-maintained list. Table-QUALIFIED (codex round-01 [P2]): PostgreSQL constraint names are
   * only unique PER TABLE, not globally, so a name-only guard would false-pass a declared
   * constraint that is missing from ITS table but happens to share a name with a constraint that
   * exists on a DIFFERENT table.
   */
  function declaredCheckKeys(): Set<string> {
    const keys = new Set<string>();
    for (const val of Object.values(schemaModule)) {
      if (
        val &&
        typeof val === "object" &&
        (val as unknown as Record<symbol, unknown>)[Symbol.for("drizzle:Name")] !== undefined
      ) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cfg = getTableConfig(val as any);
        for (const c of cfg.checks) keys.add(`${cfg.name}.${c.name}`);
      }
    }
    return keys;
  }

  it("CND-1/CND-2/CND-3: every renamed constraint exists under its declared name, the auto-generated name is gone, predicate identity confirmed by comparing the PRE-0025 catalog definition against the POST-0025 one (codex round-01 [P2] — not just existence)", async () => {
    const live = await allLiveCheckDefs(ctx.owner);
    for (const r of RENAMED) {
      expect(
        live.has(`${r.table}.${r.newDeclared}`),
        `${r.table}.${r.newDeclared} must exist live`,
      ).toBe(true);
      expect(
        live.has(`${r.table}.${r.oldAuto}`),
        `${r.table}.${r.oldAuto} must no longer exist (duplicate enforcement)`,
      ).toBe(false);
    }

    // Predicate identity, proven from first principles rather than assumed: migrate a DEDICATED
    // throwaway database only through 0024 (the tail BEFORE this slice), capture every renamed
    // constraint's definition under its auto-generated name, then compare byte-for-byte against
    // the POST-0025 definition under its declared name in `ctx` (already migrated to the current
    // tail). A hand-transcription error in a predicate would show up here even though RENAME
    // CONSTRAINT itself cannot introduce one (there is no predicate clause to transcribe at all —
    // this test guards the CLASS of bug, not just this migration's specific technique).
    const dbName = "plexco_cnd3_predicate_snapshot";
    const BASE = process.env.DATABASE_URL_TEST!;
    const admin = new pg.Client({ connectionString: BASE });
    await admin.connect();
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await admin.query(`CREATE DATABASE ${dbName}`);
      const url = new URL(BASE);
      url.pathname = `/${dbName}`;
      const c = new pg.Client({ connectionString: url.toString() });
      await c.connect();
      try {
        // migrations 0022/0023 ASSERT (never create) the cluster-global job_definer role, so this
        // replay must bootstrap it first and hold the same advisory lock every other path that
        // reaches 0022 holds (codex round-02 [P1], same class PVC-6 already fixed) — job_definer is
        // CLUSTER-global, so a concurrent vitest file (migrate.test.ts's JCL-2/JCL-3) that
        // deliberately breaks it for its own negative-path assertion would otherwise race this
        // replay and fail it for the wrong reason. Bootstraps via `admin` (the stable BASE
        // connection), not `c` (the throwaway per-test database) — the role is cluster-global, so
        // either connection creates it identically, matching every other caller in this file.
        await withJobDefinerLock(BASE, async () => {
          await bootstrapJobDefiner(admin);
          const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
          for (const f of files) {
            if (Number.parseInt(f.slice(0, 4), 10) >= 25) continue; // stop BEFORE 0025
            await c.query(await readFile(path.join(MIGRATIONS_DIR, f), "utf8"));
          }
        });
        const before = await allLiveCheckDefs(c);
        for (const r of RENAMED) {
          const beforeDef = before.get(`${r.table}.${r.oldAuto}`);
          const afterDef = live.get(`${r.table}.${r.newDeclared}`);
          expect(beforeDef, `${r.table}.${r.oldAuto} must exist pre-0025`).toBeDefined();
          // 0050 (web MVP M2c) intentionally widens the two payment_allocations CHECK predicates with
          // the DD-40 `attested_transfer` source -- same exemption class as plans_key_chk: the name
          // identity assertions still apply, only predicate byte-identity is exempt (the final
          // predicates are pinned by the 0050 test below).
          if (
            r.table === "payment_allocations" &&
            (r.newDeclared === "alloc_source_chk" || r.newDeclared === "alloc_shape_chk")
          ) {
            continue;
          }
          if (r.table === "plans" && r.newDeclared === "plans_key_chk") {
            // DD-29 (packages/db/migrations/0028_dd29_capability_registry_expand.sql +
            // 0029_dd29_capability_registry_contract.sql) intentionally DROP+ADDs this
            // exact constraint's PREDICATE later — 4-tier plan_key set narrowed to
            // 2-tier — a real, intentional business change unrelated to 0025's pure
            // rename. "byte-identical to its pre-0025 predicate" no longer holds for
            // this one entry by design; the name-identity assertions above (exists
            // under the declared name, auto-generated name gone) still apply
            // unconditionally to it, only this predicate-byte-identity check is
            // exempted here.
            continue;
          }
          expect(
            afterDef,
            `${r.table}.${r.newDeclared} predicate must be byte-identical to ${r.oldAuto}'s pre-0025 predicate`,
          ).toBe(beforeDef);
        }
      } finally {
        await c.end();
      }
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await admin.end();
    }
  }, 60_000);

  it("DD29-6: plans_key_chk's final predicate is exactly the DD-29 target (free, host_pro) — the one entry CND-1/2/3 excludes from its pre-0025 byte-identity check, because 0028/0029 intentionally narrow it later", async () => {
    const live = await allLiveCheckDefs(ctx.owner);
    expect(live.get("plans.plans_key_chk")).toBe(
      "CHECK ((plan_key = ANY (ARRAY['free'::text, 'host_pro'::text])))",
    );
  });

  it("0050-1: schema.ts's alloc_source_chk / alloc_shape_chk COMPILE (PgDialect, then Postgres) to the byte-identical live definitions (the entries CND-1/2/3 exempts from pre-0025 identity)", async () => {
    const live = await allLiveCheckDefs(ctx.owner);
    const cfg = getTableConfig(schemaModule.paymentAllocations);
    const dbName = "plexco_0050_alloc_predicates";
    await ctx.owner.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await ctx.owner.query(`CREATE DATABASE ${dbName}`);
    const url = new URL(process.env.DATABASE_URL_TEST!);
    url.pathname = `/${dbName}`;
    const c = new pg.Client({ connectionString: url.toString() });
    await c.connect();
    try {
      // Same table + column names as the real table so identifier resolution matches; types match
      // the real columns so the canonical definition renders identically.
      await c.query(
        `CREATE TABLE payment_allocations (source text, amount integer, bank_transaction_id uuid, created_by uuid, reverses_allocation_id uuid)`,
      );
      for (const name of ["alloc_source_chk", "alloc_shape_chk"]) {
        const check = cfg.checks.find((k) => k.name === name);
        expect(check, `schema.ts must declare ${name}`).toBeDefined();
        const { sql: predicateSql, params } = new PgDialect().sqlToQuery(
          check!.value as Parameters<PgDialect["sqlToQuery"]>[0],
        );
        await c.query(
          `ALTER TABLE payment_allocations ADD CONSTRAINT ${name} CHECK (${predicateSql})`,
          params,
        );
        const { rows } = await c.query<{ d: string }>(
          `SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = $1`,
          [name],
        );
        expect(rows[0]?.d, name).toBe(live.get(`payment_allocations.${name}`));
        expect(rows[0]?.d, name).toContain("attested_transfer");
      }
    } finally {
      await c.end();
      await ctx.owner.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    }
  }, 30_000);

  it("CND-6: sessions_public_capacity_chk (0024) is untouched by 0025", async () => {
    const live = await allLiveCheckDefs(ctx.owner);
    expect(live.get("sessions.sessions_public_capacity_chk")).toBe(
      "CHECK ((NOT ((visibility = 'public'::text) AND (slots_max IS NULL))))",
    );
  });

  it("CND-9: 0025 changes only CHECK constraint identity — no RLS/role/grant/column/type/nullability statement", async () => {
    // structural check against the migration file itself, same style as PVC-7 (0024) — 0025 must
    // be a pure CHECK-constraint-identity rename, nothing else. RENAME CONSTRAINT (codex round-01
    // [P1], not DROP+ADD — see the migration's own header) makes this trivially true by
    // construction (a rename statement cannot carry a predicate/column/grant clause at all), but
    // the structural check still guards against a future hand-edit of this file drifting from
    // that shape.
    const sqlText = await readFile(
      path.join(MIGRATIONS_DIR, "0025_check_constraint_naming_drift.sql"),
      "utf8",
    );
    const ddl = sqlText.replace(/--.*$/gm, ""); // strip comment lines before scanning for DDL keywords
    expect(ddl).not.toMatch(
      /\b(GRANT|REVOKE|CREATE POLICY|ALTER POLICY|DROP POLICY|OWNER TO|ALTER ROLE|ADD COLUMN|DROP COLUMN|ALTER COLUMN|CREATE TABLE|CREATE INDEX|DROP INDEX|SET NOT NULL|DROP NOT NULL|FOREIGN KEY|DROP CONSTRAINT|ADD CONSTRAINT|CHECK\s*\()\b/i,
    );
    const renameCount = (ddl.match(/ALTER TABLE \w+ RENAME CONSTRAINT \w+ TO \w+;/g) ?? []).length;
    expect(renameCount).toBe(40);
  });

  /**
   * CND-4/CND-5 — money-path behavioral coverage, EXPLICIT and INDIVIDUAL (never folded into a
   * loop that could skip a case silently). Each test attempts the real violation the renamed
   * constraint exists to reject, and a valid write, against the real table.
   */
  describe("CND-4/CND-5 money-path — explicit, individual behavioral coverage", () => {
    async function chargeParents(): Promise<{ sessionId: string; playerId: string }> {
      const sessionId = await makeSession(ctx.tenantA);
      const membershipId = await makeMembership(ctx.tenantA);
      const playerId = await makePlayer(ctx.tenantA, sessionId, membershipId);
      return { sessionId, playerId };
    }

    it("bank_accounts_provider_chk rejects an unsupported provider and accepts sepay/apipay", async () => {
      const insert = (provider: string) =>
        ctx.owner.query(
          `INSERT INTO bank_accounts
             (tenant_id, provider, account_number_enc, account_fingerprint, webhook_token, webhook_secret_enc)
           VALUES ($1, $2, '\\x00'::bytea, $3, $3, '\\x00'::bytea)`,
          [ctx.tenantA, provider, randomUUID()],
        );
      await insert("apipay"); // valid
      await expect(insert("paypal")).rejects.toThrow(
        /violates check constraint "bank_accounts_provider_chk"/,
      );
    });

    it("charges_due_chk rejects a negative amount_due and accepts zero", async () => {
      const { sessionId, playerId } = await chargeParents();
      const insert = (amountDue: number) =>
        ctx.owner.query(
          `INSERT INTO charges (tenant_id, session_id, player_id, amount_due) VALUES ($1,$2,$3,$4)`,
          [ctx.tenantA, sessionId, playerId, amountDue],
        );
      await insert(0); // valid (>= 0 boundary)
      // amount_allocated defaults to 0, so amount_due=-1 ALSO makes 0 <= amount_due false —
      // charges_alloc_le_due_chk co-fires alongside charges_due_chk by construction (amount_due
      // going negative can never keep allocated<=due once allocated's floor is 0); asserting
      // either name still proves this rename did not break enforcement.
      await expect(insert(-1)).rejects.toThrow(
        /violates check constraint "(charges_due_chk|charges_alloc_le_due_chk)"/,
      );
    });

    it("charges_alloc_chk rejects a negative amount_allocated and accepts zero", async () => {
      const { sessionId, playerId } = await chargeParents();
      const insert = (amountAllocated: number) =>
        ctx.owner.query(
          `INSERT INTO charges (tenant_id, session_id, player_id, amount_due, amount_allocated) VALUES ($1,$2,$3,100000,$4)`,
          [ctx.tenantA, sessionId, playerId, amountAllocated],
        );
      await insert(0); // valid
      await expect(insert(-1)).rejects.toThrow(/violates check constraint "charges_alloc_chk"/);
    });

    it("charges_alloc_le_due_chk rejects amount_allocated exceeding amount_due and accepts equal", async () => {
      const { sessionId, playerId } = await chargeParents();
      const insert = (amountAllocated: number) =>
        ctx.owner.query(
          `INSERT INTO charges (tenant_id, session_id, player_id, amount_due, amount_allocated) VALUES ($1,$2,$3,100000,$4)`,
          [ctx.tenantA, sessionId, playerId, amountAllocated],
        );
      await insert(100000); // valid (equal boundary)
      await expect(insert(100001)).rejects.toThrow(
        /violates check constraint "charges_alloc_le_due_chk"/,
      );
    });

    it("charges_status_chk rejects an unsupported status and accepts void", async () => {
      const { sessionId, playerId } = await chargeParents();
      const insert = (status: string) =>
        ctx.owner.query(
          `INSERT INTO charges (tenant_id, session_id, player_id, amount_due, status) VALUES ($1,$2,$3,100000,$4)`,
          [ctx.tenantA, sessionId, playerId, status],
        );
      await insert("void"); // valid
      await expect(insert("refunded")).rejects.toThrow(
        /violates check constraint "charges_status_chk"/,
      );
    });

    it("bank_txn_amount_chk rejects a non-positive amount and accepts a positive one", async () => {
      const bankAccountId = await makeBankAccount(ctx.tenantA, randomUUID());
      const insert = (amount: number) =>
        ctx.owner.query(
          `INSERT INTO bank_transactions
             (tenant_id, bank_account_id, provider, external_id, amount, unallocated_amount, occurred_at, raw_payload_enc)
           VALUES ($1,$2,'sepay',$3,$4,$4,now(),'\\x00'::bytea)`,
          [ctx.tenantA, bankAccountId, randomUUID(), amount],
        );
      await insert(1); // valid
      await expect(insert(0)).rejects.toThrow(/violates check constraint "bank_txn_amount_chk"/);
    });

    it("bank_txn_unalloc_chk rejects a negative unallocated_amount and accepts zero", async () => {
      const bankAccountId = await makeBankAccount(ctx.tenantA, randomUUID());
      const insert = (unallocatedAmount: number) =>
        ctx.owner.query(
          `INSERT INTO bank_transactions
             (tenant_id, bank_account_id, provider, external_id, amount, unallocated_amount, occurred_at, raw_payload_enc)
           VALUES ($1,$2,'sepay',$3,100000,$4,now(),'\\x00'::bytea)`,
          [ctx.tenantA, bankAccountId, randomUUID(), unallocatedAmount],
        );
      await insert(0); // valid
      await expect(insert(-1)).rejects.toThrow(/violates check constraint "bank_txn_unalloc_chk"/);
    });

    it("bank_txn_unalloc_le_chk rejects unallocated_amount exceeding amount and accepts equal", async () => {
      const bankAccountId = await makeBankAccount(ctx.tenantA, randomUUID());
      const insert = (unallocatedAmount: number) =>
        ctx.owner.query(
          `INSERT INTO bank_transactions
             (tenant_id, bank_account_id, provider, external_id, amount, unallocated_amount, occurred_at, raw_payload_enc)
           VALUES ($1,$2,'sepay',$3,100000,$4,now(),'\\x00'::bytea)`,
          [ctx.tenantA, bankAccountId, randomUUID(), unallocatedAmount],
        );
      await insert(100000); // valid (equal boundary)
      await expect(insert(100001)).rejects.toThrow(
        /violates check constraint "bank_txn_unalloc_le_chk"/,
      );
    });

    it("bank_txn_reconcile_chk rejects an unsupported reconcile_status and accepts pending", async () => {
      const bankAccountId = await makeBankAccount(ctx.tenantA, randomUUID());
      const insert = (reconcileStatus: string) =>
        ctx.owner.query(
          `INSERT INTO bank_transactions
             (tenant_id, bank_account_id, provider, external_id, amount, unallocated_amount, occurred_at, raw_payload_enc, reconcile_status)
           VALUES ($1,$2,'sepay',$3,100000,50000,now(),'\\x00'::bytea,$4)`,
          [ctx.tenantA, bankAccountId, randomUUID(), reconcileStatus],
        );
      await insert("pending"); // valid
      await expect(insert("archived")).rejects.toThrow(
        /violates check constraint "bank_txn_reconcile_chk"/,
      );
    });

    it("alloc_amount_nonzero_chk rejects a zero amount and accepts a nonzero one", async () => {
      const { sessionId, playerId } = await chargeParents();
      const chargeId = await makeCharge(ctx.tenantA, sessionId, playerId);
      const personId = await makePerson();
      const insert = (amount: number) =>
        ctx.owner.query(
          `INSERT INTO payment_allocations (tenant_id, charge_id, amount, source, created_by) VALUES ($1,$2,$3,'cash',$4)`,
          [ctx.tenantA, chargeId, amount, personId],
        );
      await insert(1); // valid
      await expect(insert(0)).rejects.toThrow(
        /violates check constraint "alloc_amount_nonzero_chk"/,
      );
    });

    it("alloc_source_chk rejects an unsupported source (co-fires with alloc_shape_chk by schema design — no source value satisfies shape's per-branch source membership test either) and accepts cash", async () => {
      const { sessionId, playerId } = await chargeParents();
      const chargeId = await makeCharge(ctx.tenantA, sessionId, playerId);
      const personId = await makePerson();
      const insert = (source: string) =>
        ctx.owner.query(
          `INSERT INTO payment_allocations (tenant_id, charge_id, amount, source, created_by) VALUES ($1,$2,50000,$3,$4)`,
          [ctx.tenantA, chargeId, source, personId],
        );
      await insert("cash"); // valid
      await expect(insert("crypto")).rejects.toThrow(
        /violates check constraint "(alloc_source_chk|alloc_shape_chk)"/,
      );
    });

    it("alloc_shape_chk rejects a cash allocation missing created_by (source itself stays valid) and accepts one with it", async () => {
      const { sessionId, playerId } = await chargeParents();
      const chargeId = await makeCharge(ctx.tenantA, sessionId, playerId);
      const personId = await makePerson();
      await ctx.owner.query(
        // valid: cash + positive amount + no bank_transaction_id + created_by set
        `INSERT INTO payment_allocations (tenant_id, charge_id, amount, source, created_by) VALUES ($1,$2,50000,'cash',$3)`,
        [ctx.tenantA, chargeId, personId],
      );
      await expect(
        ctx.owner.query(
          // invalid: cash but created_by NULL — source membership is satisfied, only shape fails
          `INSERT INTO payment_allocations (tenant_id, charge_id, amount, source) VALUES ($1,$2,50000,'cash')`,
          [ctx.tenantA, chargeId],
        ),
      ).rejects.toThrow(/violates check constraint "alloc_shape_chk"/);
    });

    it("0050 attested_transfer: accepted ONLY as amount>0, bank_transaction_id NULL, created_by set (DD-40 dedicated source)", async () => {
      const { sessionId, playerId } = await chargeParents();
      const chargeId = await makeCharge(ctx.tenantA, sessionId, playerId);
      const personId = await makePerson();
      await ctx.owner.query(
        `INSERT INTO payment_allocations (tenant_id, charge_id, amount, source, created_by) VALUES ($1,$2,50000,'attested_transfer',$3)`,
        [ctx.tenantA, chargeId, personId],
      );
      // no actor
      await expect(
        ctx.owner.query(
          `INSERT INTO payment_allocations (tenant_id, charge_id, amount, source) VALUES ($1,$2,50000,'attested_transfer')`,
          [ctx.tenantA, chargeId],
        ),
      ).rejects.toThrow(/violates check constraint "alloc_shape_chk"/);
      // negative amount
      await expect(
        ctx.owner.query(
          `INSERT INTO payment_allocations (tenant_id, charge_id, amount, source, created_by) VALUES ($1,$2,-5,'attested_transfer',$3)`,
          [ctx.tenantA, chargeId, personId],
        ),
      ).rejects.toThrow(/violates check constraint "alloc_shape_chk"/);
    });
  });

  /**
   * CND-4 non-money — data-driven, since CND-5 only requires MONEY-path individuality; these 28
   * constraints get the same real catalog-fires-a-real-violation coverage via a shared loop.
   * `alsoMayViolate` names sibling constraints on the SAME table whose predicate also references
   * the checked column, so an out-of-domain value co-fires them too (verified by reading each
   * predicate — see design-probe.md appendix) — asserting on that co-fire, not hiding it.
   */
  describe("CND-4 non-money — data-driven behavioral coverage", () => {
    async function seedAccountEmailId(): Promise<string> {
      const { rows: p } = await ctx.owner.query(`INSERT INTO persons DEFAULT VALUES RETURNING id`);
      const { rows: a } = await ctx.owner.query(
        `INSERT INTO accounts(person_id) VALUES ($1) RETURNING id`,
        [(p[0] as { id: string }).id],
      );
      const { rows: e } = await ctx.owner.query(
        `INSERT INTO account_emails(account_id, email_lookup_hash, email_enc, kms_key_version, pending_expires_at)
         VALUES ($1,$2,'\\x00'::bytea,'v1', now() + interval '1 day') RETURNING id`,
        [(a[0] as { id: string }).id, `cnd-${randomUUID()}`],
      );
      return (e[0] as { id: string }).id;
    }

    async function insertDelivery(overrides: {
      kind?: string;
      commandOperation?: string;
      outcome?: string;
    }): Promise<void> {
      await ctx.owner.query(
        `INSERT INTO auth_email_deliveries
           (kind, command_id, command_owner_hash, command_operation, command_target_fingerprint,
            provider_idempotency_key, provider_key_version, outcome, expires_at, payload_enc, kms_key_version)
         VALUES ($1, $2, 'o', $3, 'f', $4, 'pk', $5, now() + interval '1 day', '\\x00'::bytea, 'v1')`,
        [
          overrides.kind ?? "verify_email",
          randomUUID(),
          overrides.commandOperation ?? "register",
          `pik-${randomUUID()}`,
          overrides.outcome ?? "queued",
        ],
      );
    }

    async function makeFreshTenant(): Promise<string> {
      const { rows } = await ctx.owner.query(
        `INSERT INTO tenants (name, slug, status) VALUES ('cnd-fixture', $1, 'active') RETURNING id`,
        [`cnd-${randomUUID()}`],
      );
      return (rows[0] as { id: string }).id;
    }

    async function makeOnboardingRun(tenantId: string): Promise<string> {
      const { rows } = await ctx.owner.query(
        `INSERT INTO onboarding_runs (tenant_id) VALUES ($1) RETURNING id`,
        [tenantId],
      );
      return (rows[0] as { id: string }).id;
    }

    /** private/open/draft/positive-price/positive-slots golden baseline; overrides isolate one check at a time. */
    async function insertSession(
      overrides: Partial<{
        visibility: string;
        joinPolicy: string;
        status: string;
        priceAmount: number;
        slotsMax: number | null;
        startsAt: Date;
        endsAt: Date;
      }>,
    ): Promise<void> {
      await ctx.owner.query(
        `INSERT INTO sessions
           (tenant_id, sport_id, starts_at, ends_at, timezone, visibility, join_policy, status, price_amount, slots_max)
         VALUES ($1,$2,$3,$4,'Asia/Ho_Chi_Minh',$5,$6,$7,$8,$9)`,
        [
          ctx.tenantA,
          ctx.badmintonSportId,
          overrides.startsAt ?? new Date("2026-08-01T10:00:00Z"),
          overrides.endsAt ?? new Date("2026-08-01T12:00:00Z"),
          overrides.visibility ?? "private",
          overrides.joinPolicy ?? "open",
          overrides.status ?? "draft",
          overrides.priceAmount ?? 100000,
          overrides.slotsMax === undefined ? 10 : overrides.slotsMax,
        ],
      );
    }

    /** Deterministic, collision-free bigint source for telegram_links.chat_id fixtures. */
    let telegramChatIdCounter = 8_000_000_000;
    const nextTelegramChatId = () => telegramChatIdCounter++;
    /** Deterministic, collision-free integer source for plans.version fixtures. */
    let planVersionCounter = 900_000;
    const nextPlanVersion = () => planVersionCounter++;

    type EnumCase = {
      name: string;
      table: string;
      validValue: string;
      invalidValue: string;
      alsoMayViolate?: string[];
      insert: (value: string) => Promise<void>;
    };

    const CASES: EnumCase[] = [
      {
        name: "persons_status_chk",
        table: "persons",
        validValue: "merged",
        invalidValue: "bogus",
        insert: async (v) => {
          await ctx.owner.query(`INSERT INTO persons (display_name, status) VALUES ('cnd', $1)`, [
            v,
          ]);
        },
      },
      {
        name: "channel_identities_platform_chk",
        table: "channel_identities",
        validValue: "zalo",
        invalidValue: "bogus",
        insert: async (v) => {
          const personId = await makePerson();
          await ctx.owner.query(
            `INSERT INTO channel_identities (person_id, platform, platform_user_id_enc, platform_user_lookup_hash)
             VALUES ($1,$2,'\\x00'::bytea,$3)`,
            [personId, v, randomUUID()],
          );
        },
      },
      {
        name: "auth_email_tokens_purpose_chk",
        table: "auth_email_tokens",
        validValue: "password_reset",
        invalidValue: "bogus",
        // out-of-domain purpose fails BOTH OR-branches of purpose_reg_chk regardless of
        // pending_registration_id — see design-probe.md appendix, this table's checks overlap.
        alsoMayViolate: ["auth_email_tokens_purpose_reg_chk"],
        insert: async (v) => {
          const accountEmailId = await seedAccountEmailId();
          await ctx.owner.query(
            `INSERT INTO auth_email_tokens (account_email_id, purpose, token_hash, expires_at)
             VALUES ($1,$2,$3,now() + interval '1 day')`,
            [accountEmailId, v, `cnd-tok-${randomUUID()}`],
          );
        },
      },
      {
        name: "auth_email_deliveries_kind_chk",
        table: "auth_email_deliveries",
        validValue: "verify_email",
        invalidValue: "bogus",
        alsoMayViolate: ["auth_email_deliveries_operation_kind_chk"],
        insert: (v) => insertDelivery({ kind: v }),
      },
      {
        name: "auth_email_deliveries_operation_chk",
        table: "auth_email_deliveries",
        validValue: "register",
        invalidValue: "bogus",
        alsoMayViolate: ["auth_email_deliveries_operation_kind_chk"],
        insert: (v) => insertDelivery({ commandOperation: v }),
      },
      {
        name: "auth_email_deliveries_outcome_chk",
        table: "auth_email_deliveries",
        validValue: "queued",
        invalidValue: "bogus",
        alsoMayViolate: ["auth_email_deliveries_payload_chk", "auth_email_deliveries_terminal_chk"],
        insert: (v) => insertDelivery({ outcome: v }),
      },
      {
        name: "tenants_status_chk",
        table: "tenants",
        validValue: "suspended",
        invalidValue: "bogus",
        insert: async (v) => {
          await ctx.owner.query(`INSERT INTO tenants (name, slug, status) VALUES ('cnd', $1, $2)`, [
            `cnd-${randomUUID()}`,
            v,
          ]);
        },
      },
      {
        name: "memberships_status_chk",
        table: "memberships",
        validValue: "guest",
        invalidValue: "bogus",
        insert: async (v) => {
          const personId = await makePerson();
          await ctx.owner.query(
            `INSERT INTO memberships (tenant_id, person_id, status) VALUES ($1,$2,$3)`,
            [ctx.tenantA, personId, v],
          );
        },
      },
      {
        name: "sessions_vis_chk",
        table: "sessions",
        validValue: "public",
        invalidValue: "bogus",
        insert: (v) => insertSession({ visibility: v }),
      },
      {
        name: "sessions_join_chk",
        table: "sessions",
        validValue: "approval",
        invalidValue: "bogus",
        insert: (v) => insertSession({ joinPolicy: v }),
      },
      {
        name: "sessions_status_chk",
        table: "sessions",
        validValue: "open",
        invalidValue: "bogus",
        insert: (v) => insertSession({ status: v }),
      },
      {
        name: "telegram_links_kind_chk",
        table: "telegram_links",
        validValue: "channel",
        invalidValue: "bogus",
        insert: async (v) => {
          const tenantId = await makeFreshTenant();
          await ctx.owner.query(
            `INSERT INTO telegram_links (tenant_id, chat_id, kind) VALUES ($1,$2,$3)`,
            [tenantId, nextTelegramChatId(), v],
          );
        },
      },
      {
        name: "tenant_admins_role_chk",
        table: "tenant_admins",
        validValue: "co_admin",
        invalidValue: "bogus",
        insert: async (v) => {
          const tenantId = await makeFreshTenant();
          await ctx.owner.query(
            `INSERT INTO tenant_admins (tenant_id, platform_user_lookup_hash, role) VALUES ($1,$2,$3)`,
            [tenantId, randomUUID(), v],
          );
        },
      },
      {
        name: "provider_connections_provider_chk",
        table: "provider_connections",
        validValue: "apipay",
        invalidValue: "bogus",
        insert: async (v) => {
          const tenantId = await makeFreshTenant();
          await ctx.owner.query(
            `INSERT INTO provider_connections (tenant_id, provider, auth_mode) VALUES ($1,$2,'api_key')`,
            [tenantId, v],
          );
        },
      },
      {
        name: "provider_connections_auth_chk",
        table: "provider_connections",
        validValue: "oauth2",
        invalidValue: "bogus",
        insert: async (v) => {
          const tenantId = await makeFreshTenant();
          await ctx.owner.query(
            `INSERT INTO provider_connections (tenant_id, provider, auth_mode) VALUES ($1,'sepay',$2)`,
            [tenantId, v],
          );
        },
      },
      {
        name: "projector_status_chk",
        table: "projector_deliveries",
        validValue: "claimed",
        invalidValue: "bogus",
        insert: async (v) => {
          const { rows } = await ctx.owner.query(
            `INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, sequence, type, payload)
             VALUES ($1,'cnd_test',gen_random_uuid(),1,'cnd.test.event','{}'::jsonb) RETURNING id`,
            [ctx.tenantA],
          );
          await ctx.owner.query(
            `INSERT INTO projector_deliveries (event_id, projector, status) VALUES ($1,'cnd-projector',$2)`,
            [(rows[0] as { id: string }).id, v],
          );
        },
      },
      {
        name: "join_requests_status_chk",
        table: "join_requests",
        validValue: "approved",
        invalidValue: "bogus",
        insert: async (v) => {
          const sessionId = await makeSession(ctx.tenantA);
          const personId = await makePerson();
          await ctx.owner.query(
            `INSERT INTO join_requests (tenant_id, session_id, person_id, expires_at, status)
             VALUES ($1,$2,$3,now() + interval '1 day',$4)`,
            [ctx.tenantA, sessionId, personId, v],
          );
        },
      },
      {
        name: "plans_key_chk",
        table: "plans",
        validValue: "host_pro",
        invalidValue: "bogus",
        insert: async (v) => {
          await ctx.owner.query(
            `INSERT INTO plans (plan_key, version, price) VALUES ($1,$2,100000)`,
            [v, nextPlanVersion()],
          );
        },
      },
      {
        name: "subscriptions_status_chk",
        table: "subscriptions",
        validValue: "past_due",
        invalidValue: "bogus",
        insert: async (v) => {
          const tenantId = await makeFreshTenant();
          await ctx.owner.query(
            `INSERT INTO subscriptions (tenant_id, plan_key, plan_version, period_start, period_end, status)
             VALUES ($1,'free',1,now(),now() + interval '30 days',$2)`,
            [tenantId, v],
          );
        },
      },
      {
        name: "subscription_invoices_status_chk",
        table: "subscription_invoices",
        validValue: "overdue",
        invalidValue: "bogus",
        insert: async (v) => {
          const tenantId = await makeFreshTenant();
          await ctx.owner.query(
            `INSERT INTO subscription_invoices (tenant_id, invoice_code, amount_due, due_at, period_key, status)
             VALUES ($1,$2,100000,now() + interval '7 days',$3,$4)`,
            [tenantId, `cnd-${randomUUID()}`, `cnd-${randomUUID()}`, v],
          );
        },
      },
      {
        name: "notif_intents_status_chk",
        table: "notification_intents",
        validValue: "dispatched",
        invalidValue: "bogus",
        insert: async (v) => {
          const personId = await makePerson();
          await ctx.owner.query(
            `INSERT INTO notification_intents (tenant_id, type, aggregate_id, state_version, person_id, intent_key, status)
             VALUES ($1,'reminder',gen_random_uuid(),1,$2,$3,$4)`,
            [ctx.tenantA, personId, `cnd-${randomUUID()}`, v],
          );
        },
      },
      {
        name: "notif_deliveries_status_chk",
        table: "notification_deliveries",
        validValue: "sent",
        invalidValue: "bogus",
        insert: async (v) => {
          const personId = await makePerson();
          const intentId = await makeNotificationIntent(
            ctx.tenantA,
            personId,
            `cnd-${randomUUID()}`,
          );
          await ctx.owner.query(
            `INSERT INTO notification_deliveries (tenant_id, intent_id, platform, delivery_key, status)
             VALUES ($1,$2,'telegram',$3,$4)`,
            [ctx.tenantA, intentId, `cnd-${randomUUID()}`, v],
          );
        },
      },
      {
        name: "onboarding_runs_status_chk",
        table: "onboarding_runs",
        validValue: "abandoned",
        invalidValue: "bogus",
        insert: async (v) => {
          const tenantId = await makeFreshTenant();
          await ctx.owner.query(`INSERT INTO onboarding_runs (tenant_id, status) VALUES ($1,$2)`, [
            tenantId,
            v,
          ]);
        },
      },
      {
        name: "onboarding_steps_status_chk",
        table: "onboarding_steps",
        validValue: "verified",
        invalidValue: "bogus",
        insert: async (v) => {
          const tenantId = await makeFreshTenant();
          const runId = await makeOnboardingRun(tenantId);
          await ctx.owner.query(
            `INSERT INTO onboarding_steps (run_id, step, status) VALUES ($1,'cnd',$2)`,
            [runId, v],
          );
        },
      },
    ];

    it("every non-money enum-style renamed constraint rejects an out-of-domain value and accepts a valid one", async () => {
      for (const c of CASES) {
        await c.insert(c.validValue); // must succeed
        const namesPattern = [c.name, ...(c.alsoMayViolate ?? [])].join("|");
        await expect(
          c.insert(c.invalidValue),
          `${c.table}.${c.name} must reject "${c.invalidValue}"`,
        ).rejects.toThrow(new RegExp(`violates check constraint "(${namesPattern})"`));
      }
    });

    it("subscriptions_extra_chk accepts NULL or a member value, and rejects a non-member non-null value", async () => {
      const insert = async (value: string | null) => {
        const tenantId = await makeFreshTenant();
        await ctx.owner.query(
          `INSERT INTO subscriptions (tenant_id, plan_key, plan_version, period_start, period_end, selected_extra_channel)
           VALUES ($1,'free',1,now(),now() + interval '30 days',$2)`,
          [tenantId, value],
        );
      };
      await insert(null); // valid — NULL branch
      await insert("messenger"); // valid — membership branch
      await expect(insert("bogus")).rejects.toThrow(
        /violates check constraint "subscriptions_extra_chk"/,
      );
    });

    it("sessions_time_chk rejects ends_at <= starts_at and accepts ends_at > starts_at", async () => {
      await insertSession({}); // valid — default 2-hour window
      await expect(
        insertSession({
          startsAt: new Date("2026-08-01T12:00:00Z"),
          endsAt: new Date("2026-08-01T10:00:00Z"),
        }),
      ).rejects.toThrow(/violates check constraint "sessions_time_chk"/);
    });

    it("sessions_price_chk rejects a negative price_amount and accepts zero", async () => {
      await insertSession({ priceAmount: 0 }); // valid boundary
      await expect(insertSession({ priceAmount: -1 })).rejects.toThrow(
        /violates check constraint "sessions_price_chk"/,
      );
    });

    it("sessions_slots_chk rejects a non-positive slots_max and accepts NULL or a positive value", async () => {
      await insertSession({ slotsMax: null }); // valid — NULL branch
      await insertSession({ slotsMax: 1 }); // valid — positive branch
      await expect(insertSession({ slotsMax: 0 })).rejects.toThrow(
        /violates check constraint "sessions_slots_chk"/,
      );
    });
  });

  /**
   * Regression guard (design-probe.md item (d)) — prevents a 28th unnamed CHECK from recurring.
   *
   * PRIMARY: every schema.ts check() name must exist live (the manifest's direct ask — the exact
   * failure mode 0014 documents and this slice fixes: a declaration silently not applied under
   * its own name).
   *
   * SECONDARY (founder-conditioned): every live CHECK must be declared, or explicitly allowlisted.
   * The allowlist is CLOSED and finite, never an open enumeration — each entry would carry a
   * reason so it cannot calcify into permanent noise nobody dares shrink (founder's explicit
   * condition on approving this guard). It held exactly 6 entries (design-probe.md item (e)) from
   * when this guard was added (0025) until db-undeclared-check-constraints-schema-mirror (0026)
   * declared and renamed all 6 — see that slice's design-probe.md. The allowlist is empty by
   * measurement, not by assumption: UCC-5 (below) re-derives declared==live==73 rather than
   * hard-coding it, so a future undeclared constraint would show up as a SECONDARY violation, not
   * silently pass through a stale allowlist.
   */
  describe("regression guard — prevents a 28th unnamed CHECK (design-probe.md item d)", () => {
    const KNOWN_UNDECLARED_LIVE_CHECKS: { table: string; name: string; reason: string }[] = [];
    const ALLOWLIST_KEYS = new Set(KNOWN_UNDECLARED_LIVE_CHECKS.map((e) => `${e.table}.${e.name}`));

    /**
     * PRIMARY: declared "table.name" keys missing from the live catalog. Empty = guard passes.
     * Table-qualified throughout (codex round-01 [P2]) — a declared constraint missing from ITS
     * OWN table is a real violation even if a same-named constraint happens to exist elsewhere.
     */
    async function primaryGuardViolations(client: pg.Client): Promise<string[]> {
      const live = await allLiveCheckDefs(client);
      const violations: string[] = [];
      for (const key of declaredCheckKeys()) {
        if (!live.has(key)) violations.push(key);
      }
      return violations;
    }

    /** SECONDARY: live constraints that are neither declared nor allowlisted. Empty = guard passes. */
    async function secondaryGuardViolations(client: pg.Client): Promise<string[]> {
      const live = await allLiveCheckDefs(client);
      const declared = declaredCheckKeys();
      const violations: string[] = [];
      for (const key of live.keys()) {
        if (!declared.has(key) && !ALLOWLIST_KEYS.has(key)) violations.push(key);
      }
      return violations;
    }

    it("primary: every schema.ts check() name exists live", async () => {
      expect(await primaryGuardViolations(ctx.owner)).toEqual([]);
    });

    it("secondary: every live CHECK is declared or in the reasoned allowlist", async () => {
      expect(await secondaryGuardViolations(ctx.owner)).toEqual([]);
    });

    it("every allowlist entry names a real live constraint (the allowlist cannot drift stale-and-unused)", async () => {
      const live = await allLiveCheckDefs(ctx.owner);
      for (const entry of KNOWN_UNDECLARED_LIVE_CHECKS) {
        expect(
          live.has(`${entry.table}.${entry.name}`),
          `${entry.table}.${entry.name} must still be live`,
        ).toBe(true);
        expect(
          entry.reason.length,
          `${entry.name} allowlist entry must carry a non-trivial reason`,
        ).toBeGreaterThan(20);
      }
    });

    it("CND-7: both guards catch a reintroduced unnamed CHECK (proof the guard is not vacuous)", async () => {
      // Dedicated throwaway database, isolated from `ctx` — never corrupt the shared suite database.
      const dbName = "plexco_cnd7_guard_proof";
      const BASE = process.env.DATABASE_URL_TEST!;
      const admin = new pg.Client({ connectionString: BASE });
      await admin.connect();
      try {
        await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
        await admin.query(`CREATE DATABASE ${dbName}`);
        const url = new URL(BASE);
        url.pathname = `/${dbName}`;
        // The reader side of chat_definer's lock too (codex round-03 [P2]): this migrate() reaches 0030.
        await withDefinerReadLock(BASE, async () => {
          await bootstrapJobDefiner(admin);
          await migrate(url.toString());
        });

        const c = new pg.Client({ connectionString: url.toString() });
        await c.connect();
        try {
          // Reintroduce the EXACT historical bug pattern: drop the correctly-named constraint and
          // re-add the identical predicate UNNAMED, so Postgres auto-generates a name — mirroring
          // exactly how 0002-0008 produced the class this slice fixes (design-probe.md item (b)).
          await c.query(`ALTER TABLE bank_accounts DROP CONSTRAINT bank_accounts_provider_chk`);
          await c.query(`ALTER TABLE bank_accounts ADD CHECK (provider IN ('sepay','apipay'))`);

          const primary = await primaryGuardViolations(c);
          expect(primary, "primary guard must name the now-missing declared constraint").toContain(
            "bank_accounts.bank_accounts_provider_chk",
          );

          const secondary = await secondaryGuardViolations(c);
          expect(
            secondary,
            "secondary guard must name the new auto-generated constraint",
          ).toContain("bank_accounts.bank_accounts_provider_check");
        } finally {
          await c.end();
        }
      } finally {
        await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
        await admin.end();
      }
    }, 60_000);

    it("UCC-6: both guards catch a reintroduced unnamed CHECK on zalo_bots_status_chk — same proof as CND-7, for a constraint THIS slice (0026) declared rather than one 0025 renamed", async () => {
      // Dedicated throwaway database, isolated from `ctx` — never corrupt the shared suite database.
      const dbName = "plexco_ucc6_guard_proof";
      const BASE = process.env.DATABASE_URL_TEST!;
      const admin = new pg.Client({ connectionString: BASE });
      await admin.connect();
      try {
        await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
        await admin.query(`CREATE DATABASE ${dbName}`);
        const url = new URL(BASE);
        url.pathname = `/${dbName}`;
        // The reader side of chat_definer's lock too (codex round-03 [P2]): this migrate() reaches 0030.
        await withDefinerReadLock(BASE, async () => {
          await bootstrapJobDefiner(admin);
          await migrate(url.toString());
        });

        const c = new pg.Client({ connectionString: url.toString() });
        await c.connect();
        try {
          // Reintroduce the EXACT historical bug pattern this slice fixed: drop the correctly-
          // named constraint and re-add the identical predicate UNNAMED, so Postgres auto-generates
          // a name — mirroring exactly how 0001/0003/0004 produced the class this slice fixes
          // (design-probe.md item (e), the six constraints 0025 explicitly excluded).
          await c.query(`ALTER TABLE zalo_bots DROP CONSTRAINT zalo_bots_status_chk`);
          await c.query(
            `ALTER TABLE zalo_bots ADD CHECK (status IN ('connecting','registered','active','drift','error','revoked'))`,
          );

          const primary = await primaryGuardViolations(c);
          expect(primary, "primary guard must name the now-missing declared constraint").toContain(
            "zalo_bots.zalo_bots_status_chk",
          );

          const secondary = await secondaryGuardViolations(c);
          expect(
            secondary,
            "secondary guard must name the new auto-generated constraint",
          ).toContain("zalo_bots.zalo_bots_status_check");
        } finally {
          await c.end();
        }
      } finally {
        await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
        await admin.end();
      }
    }, 60_000);
  });

  /**
   * UCC-1..UCC-10 — undeclared CHECK constraint schema mirror
   * (0026, db-undeclared-check-constraints-schema-mirror/design-probe.md).
   *
   * OPPOSITE direction from CND (0025) above: CND renamed live constraints to match names
   * schema.ts ALREADY declared. This slice ADDS a schema.ts check() declaration for six live
   * constraints that had NO declaration at all — 0025 explicitly excluded them (0025:33-40) because
   * schema.ts had no declared name to rename them TO. All six were applied inline/unnamed by
   * 0001/0003/0004 and enforce correctly today under their auto-generated name; migration 0026 is a
   * naming/declaration-identity fix, not a behavior fix. Four of the six share one 6-value enum
   * (connecting|registered|active|drift|error|revoked); two do NOT — channel_identities_status is
   * (active|inactive) and oauth_transactions_provider is the single literal 'sepay' (design-probe.md
   * pin 2) — UCC-4 asserts those two individually so a test that treated all six alike could not
   * pass while being wrong about two of them.
   */
  describe("UCC-1..UCC-10 undeclared check constraint schema mirror (0026)", () => {
    const DECLARED: { table: string; oldAuto: string; newDeclared: string }[] = [
      {
        table: "bank_accounts",
        oldAuto: "bank_accounts_webhook_status_check",
        newDeclared: "bank_accounts_webhook_status_chk",
      },
      {
        table: "channel_identities",
        oldAuto: "channel_identities_status_check",
        newDeclared: "channel_identities_status_chk",
      },
      {
        table: "messenger_pages",
        oldAuto: "messenger_pages_status_check",
        newDeclared: "messenger_pages_status_chk",
      },
      {
        table: "oauth_transactions",
        oldAuto: "oauth_transactions_provider_check",
        newDeclared: "oauth_transactions_provider_chk",
      },
      {
        table: "provider_connections",
        oldAuto: "provider_connections_status_check",
        newDeclared: "provider_connections_status_chk",
      },
      {
        table: "zalo_bots",
        oldAuto: "zalo_bots_status_check",
        newDeclared: "zalo_bots_status_chk",
      },
    ];

    async function makeFreshTenant(): Promise<string> {
      const { rows } = await ctx.owner.query(
        `INSERT INTO tenants (name, slug, status) VALUES ('ucc-fixture', $1, 'active') RETURNING id`,
        [`ucc-${randomUUID()}`],
      );
      return (rows[0] as { id: string }).id;
    }

    it("UCC-1: all six constraints exist in pg_constraint under their new _chk name, and the auto-generated name is gone (catalog, never schema.ts source text)", async () => {
      const live = await allLiveCheckDefs(ctx.owner);
      for (const r of DECLARED) {
        expect(
          live.has(`${r.table}.${r.newDeclared}`),
          `${r.table}.${r.newDeclared} must exist live`,
        ).toBe(true);
        expect(
          live.has(`${r.table}.${r.oldAuto}`),
          `${r.table}.${r.oldAuto} must no longer exist (duplicate enforcement)`,
        ).toBe(false);
      }
    });

    it("UCC-2: pg_get_constraintdef for each of the six is byte-identical before (0025 tail) and after (0026) the rename", async () => {
      const live = await allLiveCheckDefs(ctx.owner);

      // Predicate identity, proven from first principles: migrate a DEDICATED throwaway database
      // only through 0025 (the tail BEFORE this slice), capture every constraint's definition
      // under its auto-generated name, then compare byte-for-byte against the POST-0026 definition
      // under its declared name in `ctx` (already migrated to the current tail). Same method as
      // CND-1/2/3 above, cutoff moved from 0024/0025 to 0025/0026.
      const dbName = "plexco_ucc2_predicate_snapshot";
      const BASE = process.env.DATABASE_URL_TEST!;
      const admin = new pg.Client({ connectionString: BASE });
      await admin.connect();
      try {
        await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
        await admin.query(`CREATE DATABASE ${dbName}`);
        const url = new URL(BASE);
        url.pathname = `/${dbName}`;
        const c = new pg.Client({ connectionString: url.toString() });
        await c.connect();
        try {
          await withJobDefinerLock(BASE, async () => {
            await bootstrapJobDefiner(admin);
            const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
            for (const f of files) {
              if (Number.parseInt(f.slice(0, 4), 10) >= 26) continue; // stop BEFORE 0026
              await c.query(await readFile(path.join(MIGRATIONS_DIR, f), "utf8"));
            }
          });
          const before = await allLiveCheckDefs(c);
          for (const r of DECLARED) {
            const beforeDef = before.get(`${r.table}.${r.oldAuto}`);
            const afterDef = live.get(`${r.table}.${r.newDeclared}`);
            expect(beforeDef, `${r.table}.${r.oldAuto} must exist pre-0026`).toBeDefined();
            expect(
              afterDef,
              `${r.table}.${r.newDeclared} predicate must be byte-identical to ${r.oldAuto}'s pre-0026 predicate`,
            ).toBe(beforeDef);
          }
        } finally {
          await c.end();
        }
      } finally {
        await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
        await admin.end();
      }
    }, 60_000);

    it("UCC-5: declared check() keys and live CHECK constraints are the exact same set (re-derived, not hard-coded — see UCC-1..UCC-10 docstring)", async () => {
      const live = await allLiveCheckDefs(ctx.owner);
      const declared = declaredCheckKeys();
      expect(declared.size, "declared check() count must equal live CHECK count").toBe(live.size);
      for (const key of declared) {
        expect(live.has(key), `declared ${key} must exist live (declared⇒live)`).toBe(true);
      }
      for (const key of live.keys()) {
        expect(declared.has(key), `live ${key} must be declared (live⇒declared)`).toBe(true);
      }
    });

    /**
     * UCC-5's name-only comparison (declaredCheckKeys() discards each check's SQL value) cannot
     * catch a same-name PREDICATE drift — codex round-01 [P2]: a future schema.ts edit that keeps
     * `zalo_bots_status_chk`'s name but changes its enum would pass UCC-1 through UCC-5 unnoticed,
     * because those only ever read the UNCHANGED live predicate, never schema.ts's own value.
     * UCC-5b closes that gap by asking Postgres itself, not string comparison: render each of the
     * six declarations' SQL via PgDialect (drizzle-orm's own compiler, no re-implementation), apply
     * it as a CHECK on a throwaway table sharing the real table+column name so identifier
     * resolution matches, then compare the resulting `pg_get_constraintdef` — already-canonicalized
     * by Postgres on BOTH sides — against the live migrated constraint's definition. A raw text
     * diff (e.g. Drizzle's `IN (...)` vs Postgres's stored `= ANY (ARRAY[...])`) would never match
     * even when semantically identical, which is why this compiles rather than string-compares.
     */
    async function compiledPredicateDef(
      client: pg.Client,
      table: string,
      column: string,
      chunk: unknown,
    ) {
      const dbName = `plexco_ucc5b_${table}`;
      await client.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await client.query(`CREATE DATABASE ${dbName}`);
      const url = new URL(process.env.DATABASE_URL_TEST!);
      url.pathname = `/${dbName}`;
      const c = new pg.Client({ connectionString: url.toString() });
      await c.connect();
      try {
        const { sql: predicateSql, params } = new PgDialect().sqlToQuery(
          chunk as Parameters<PgDialect["sqlToQuery"]>[0],
        );
        await c.query(`CREATE TABLE ${table} (${column} text)`);
        await c.query(
          `ALTER TABLE ${table} ADD CONSTRAINT ucc5b_probe_chk CHECK (${predicateSql})`,
          params,
        );
        const { rows } = await c.query<{ d: string }>(
          `SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'ucc5b_probe_chk'`,
        );
        return rows[0]?.d;
      } finally {
        await c.end();
        await client.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      }
    }

    const SIX_COLUMNS: Record<string, string> = {
      bank_accounts: "webhook_status",
      channel_identities: "status",
      messenger_pages: "status",
      oauth_transactions: "provider",
      provider_connections: "status",
      zalo_bots: "status",
    };

    function sixTableExports(): Map<string, unknown> {
      const found = new Map<string, unknown>();
      for (const val of Object.values(schemaModule)) {
        if (
          val &&
          typeof val === "object" &&
          (val as unknown as Record<symbol, unknown>)[Symbol.for("drizzle:Name")] !== undefined
        ) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const name = getTableConfig(val as any).name;
          if (name in SIX_COLUMNS) found.set(name, val);
        }
      }
      return found;
    }

    it("UCC-5b: each of the six schema.ts predicates COMPILES (via drizzle's own PgDialect, never re-implemented) to the byte-identical live pg_get_constraintdef", async () => {
      const live = await allLiveCheckDefs(ctx.owner);
      const exports = sixTableExports();
      expect(exports.size, "all six table exports must be found in schema.ts").toBe(6);
      for (const r of DECLARED) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cfg = getTableConfig(exports.get(r.table) as any);
        const check = cfg.checks.find((c) => c.name === r.newDeclared);
        expect(check, `${r.table} must declare ${r.newDeclared}`).toBeDefined();
        const compiled = await compiledPredicateDef(
          ctx.owner,
          r.table,
          SIX_COLUMNS[r.table]!,
          check!.value,
        );
        expect(
          compiled,
          `schema.ts's ${r.newDeclared} predicate, compiled by Postgres, must equal the live definition`,
        ).toBe(live.get(`${r.table}.${r.newDeclared}`));
      }
    }, 30_000);

    it("UCC-5c: UCC-5b is SEEN to fail on a same-name predicate drift (proof it is not vacuous, same discipline as UCC-6/CND-7)", async () => {
      // A deliberately WRONG predicate for the same declared name — reintroduces exactly the class
      // codex round-01 flagged: a same-name schema.ts edit that silently changes the enum.
      const dbName = "plexco_ucc5c_wrong_predicate";
      const admin = ctx.owner;
      await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await admin.query(`CREATE DATABASE ${dbName}`);
      const url = new URL(process.env.DATABASE_URL_TEST!);
      url.pathname = `/${dbName}`;
      const c = new pg.Client({ connectionString: url.toString() });
      await c.connect();
      try {
        await c.query(`CREATE TABLE zalo_bots (status text)`);
        // Same NAME (zalo_bots_status_chk) as the real declaration, deliberately WRONG predicate
        // (drops 'revoked') — proves UCC-5b's comparison, not just its existence check, fails red.
        await c.query(
          `ALTER TABLE zalo_bots ADD CONSTRAINT zalo_bots_status_chk CHECK (status IN ('connecting','registered','active','drift','error'))`,
        );
        const { rows } = await c.query<{ d: string }>(
          `SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'zalo_bots_status_chk'`,
        );
        const live = await allLiveCheckDefs(ctx.owner);
        expect(
          rows[0]?.d,
          "a same-name wrong predicate must NOT byte-match the live definition — proves UCC-5b would catch it",
        ).not.toBe(live.get("zalo_bots.zalo_bots_status_chk"));
      } finally {
        await c.end();
        await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      }
    }, 30_000);

    type UccCase = {
      name: string;
      table: string;
      validValues: string[];
      invalidValue: string;
      insert: (value: string) => Promise<void>;
    };

    const UCC_CASES: UccCase[] = [
      {
        name: "bank_accounts_webhook_status_chk",
        table: "bank_accounts",
        validValues: ["active"],
        invalidValue: "bogus",
        insert: async (v) => {
          const tenantId = await makeFreshTenant();
          await ctx.owner.query(
            `INSERT INTO bank_accounts
               (tenant_id, provider, account_number_enc, account_fingerprint, webhook_token, webhook_secret_enc, webhook_status)
             VALUES ($1,'sepay','\\x00'::bytea,$2,$3,'\\x00'::bytea,$4)`,
            [tenantId, randomUUID(), randomUUID(), v],
          );
        },
      },
      {
        name: "messenger_pages_status_chk",
        table: "messenger_pages",
        validValues: ["active"],
        invalidValue: "bogus",
        insert: async (v) => {
          const tenantId = await makeFreshTenant();
          await ctx.owner.query(
            `INSERT INTO messenger_pages (tenant_id, page_id, page_token_enc, status)
             VALUES ($1,$2,'\\x00'::bytea,$3)`,
            [tenantId, randomUUID(), v],
          );
        },
      },
      {
        name: "provider_connections_status_chk",
        table: "provider_connections",
        validValues: ["active"],
        invalidValue: "bogus",
        insert: async (v) => {
          const tenantId = await makeFreshTenant();
          await ctx.owner.query(
            `INSERT INTO provider_connections (tenant_id, provider, auth_mode, status)
             VALUES ($1,'sepay','api_key',$2)`,
            [tenantId, v],
          );
        },
      },
      {
        name: "zalo_bots_status_chk",
        table: "zalo_bots",
        validValues: ["active"],
        invalidValue: "bogus",
        insert: async (v) => {
          const tenantId = await makeFreshTenant();
          await ctx.owner.query(
            `INSERT INTO zalo_bots (tenant_id, bot_token_enc, webhook_token, webhook_secret_enc, status)
             VALUES ($1,'ucc-bot-token',$2,'\\x00'::bytea,$3)`,
            [tenantId, randomUUID(), v],
          );
        },
      },
      {
        // Non-uniform predicate (2-value, not the 6-value enum) — also covered individually by
        // UCC-4a below, which additionally proves BOTH valid values and the specific rejection of
        // 'connecting' (a value valid for the other four).
        name: "channel_identities_status_chk",
        table: "channel_identities",
        validValues: ["active", "inactive"],
        invalidValue: "connecting",
        insert: async (v) => {
          const personId = await makePerson();
          await ctx.owner.query(
            `INSERT INTO channel_identities (person_id, platform, platform_user_id_enc, platform_user_lookup_hash, status)
             VALUES ($1,'zalo','\\x00'::bytea,$2,$3)`,
            [personId, randomUUID(), v],
          );
        },
      },
      {
        // Non-uniform predicate (single literal) — also covered individually by UCC-4b below,
        // which additionally proves rejection of 'google' (valid on the UNRELATED
        // auth_oauth_transactions table's same-named provider column, design-probe.md pin 3).
        name: "oauth_transactions_provider_chk",
        table: "oauth_transactions",
        validValues: ["sepay"],
        invalidValue: "apipay",
        insert: async (v) => {
          const tenantId = await makeFreshTenant();
          await ctx.owner.query(
            `INSERT INTO oauth_transactions (state, tenant_id, provider, code_verifier_enc, redirect_uri, created_by, expires_at)
             VALUES ($1,$2,$3,'\\x00'::bytea,'https://example.test/callback',$4, now() + interval '1 day')`,
            [randomUUID(), tenantId, v, randomUUID()],
          );
        },
      },
    ];

    it("UCC-3: every newly-declared constraint accepts its valid value(s) and rejects an out-of-domain value", async () => {
      for (const c of UCC_CASES) {
        for (const valid of c.validValues) {
          await c.insert(valid); // must succeed
        }
        await expect(
          c.insert(c.invalidValue),
          `${c.table}.${c.name} must reject "${c.invalidValue}"`,
        ).rejects.toThrow(new RegExp(`violates check constraint "${c.name}"`));
      }
    });

    it("UCC-4a: channel_identities_status_chk accepts BOTH active and inactive, and rejects 'connecting' — proof it does NOT share the other five's 6-value enum", async () => {
      const insert = async (v: string) => {
        const personId = await makePerson();
        await ctx.owner.query(
          `INSERT INTO channel_identities (person_id, platform, platform_user_id_enc, platform_user_lookup_hash, status)
           VALUES ($1,'zalo','\\x00'::bytea,$2,$3)`,
          [personId, randomUUID(), v],
        );
      };
      await insert("active");
      await insert("inactive");
      await expect(insert("connecting")).rejects.toThrow(
        /violates check constraint "channel_identities_status_chk"/,
      );
    });

    it("UCC-4b: oauth_transactions_provider_chk accepts ONLY 'sepay' — rejects 'google', which the UNRELATED auth_oauth_transactions table's own provider column DOES accept", async () => {
      const insert = async (v: string) => {
        const tenantId = await makeFreshTenant();
        await ctx.owner.query(
          `INSERT INTO oauth_transactions (state, tenant_id, provider, code_verifier_enc, redirect_uri, created_by, expires_at)
           VALUES ($1,$2,$3,'\\x00'::bytea,'https://example.test/callback',$4, now() + interval '1 day')`,
          [randomUUID(), tenantId, v, randomUUID()],
        );
      };
      await insert("sepay");
      await expect(insert("google")).rejects.toThrow(
        /violates check constraint "oauth_transactions_provider_chk"/,
      );
    });

    it("UCC-7: 0000..0025 stay byte-identical after 0026 applies (recorded sha256 == on-disk content)", async () => {
      const { rows } = await ctx.owner.query(
        `SELECT name, sha256 FROM schema_migrations WHERE name < '0026' ORDER BY name`,
      );
      expect(rows.length).toBe(26);
      for (const row of rows as { name: string; sha256: string }[]) {
        const disk = createHash("sha256")
          .update(await readFile(path.join(MIGRATIONS_DIR, row.name), "utf8"))
          .digest("hex");
        expect(row.sha256, `${row.name} recorded sha must equal the on-disk file`).toBe(disk);
      }
    });

    it("UCC-8: MIGRATION_COUNT (72) matches the actual migrations/ directory listing, and the tail is 0071", async () => {
      const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
      expect(files.length).toBe(72);
      expect(files[files.length - 1]).toBe("0071_zalo_dm_promotion_start_definer.sql");
    });

    it("UCC-9: 0026 changes only CHECK constraint identity — no RLS/role/grant/column/type/nullability statement, zero DROP/ADD CONSTRAINT, exactly 6 RENAME CONSTRAINT", async () => {
      const sqlText = await readFile(
        path.join(MIGRATIONS_DIR, "0026_undeclared_check_constraint_names.sql"),
        "utf8",
      );
      const ddl = sqlText.replace(/--.*$/gm, "");
      expect(ddl).not.toMatch(
        /\b(GRANT|REVOKE|CREATE POLICY|ALTER POLICY|DROP POLICY|OWNER TO|ALTER ROLE|ADD COLUMN|DROP COLUMN|ALTER COLUMN|CREATE TABLE|CREATE INDEX|DROP INDEX|SET NOT NULL|DROP NOT NULL|FOREIGN KEY|DROP CONSTRAINT|ADD CONSTRAINT|CHECK\s*\()\b/i,
      );
      const renameCount = (ddl.match(/ALTER TABLE \w+ RENAME CONSTRAINT \w+ TO \w+;/g) ?? [])
        .length;
      expect(renameCount).toBe(6);
    });
  });
});

/**
 * Audit 2026-09-06 D-11 — the FORCE-RLS guard above is a HAND-LIST (13 names) while the catalog
 * holds 37 tables carrying `tenant_id`. A new tenant table added without ENABLE+FORCE RLS would
 * pass that list forever. This block derives the population from the catalog instead:
 *
 *   every relation with a tenant_id column is EITHER
 *     (a) ENABLE + FORCE RLS with ≥1 policy (the HARD RULE #1 shape), OR
 *     (b) in the CLOSED allowlist below, each entry carrying a reason that is itself verified live:
 *         "definer-only" = ZERO table privileges for app / app_worker / readonly (0009 header:
 *         "Global protected tables … NO blanket grant to app"), so the table is unreachable
 *         except through SECURITY DEFINER functions or the owner.
 *
 * The allowlist cannot rot into permanent noise: an entry that stops being definer-only (someone
 * GRANTs a runtime role on it) fails the reason check, and an entry that gains RLS is reported as
 * no longer needing the exemption. Measured 2026-09-06 on a replay of 0000..0039: exactly these
 * six are non-RLS tenant tables, and all six have zero runtime-role privileges.
 */
describe("RLS catalog invariant — every tenant_id table is FORCE-RLS or provably definer-only (audit D-11)", () => {
  const DEFINER_ONLY_TENANT_TABLES: { table: string; reason: string }[] = [
    {
      table: "billing_overrides",
      reason: "0009 global-protected: owner-only ledger override; no runtime grant",
    },
    {
      table: "job_audit_events",
      reason: "0022 job runtime: written by job_definer functions only",
    },
    {
      table: "oauth_transactions",
      reason: "0010: reached only via create/consume_oauth_transaction definers",
    },
    {
      table: "player_chat_context",
      reason: "0009 global-protected: identity service / definer only",
    },
    {
      table: "public_sessions",
      reason: "0033+0036: base table has ZERO grants; reads go through public_session_share_v",
    },
    { table: "routing_audit", reason: "0009 global-protected: audit sink, no runtime grant" },
  ];
  const RUNTIME_ROLES = ["app", "app_worker", "readonly"] as const;

  async function tenantTables(): Promise<{ relname: string; forced: boolean; policies: number }[]> {
    const { rows } = await ctx.owner.query(
      `SELECT c.relname,
              (c.relrowsecurity AND c.relforcerowsecurity) AS forced,
              (SELECT count(*)::int FROM pg_policies p
                WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
         FROM pg_class c
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
        WHERE c.relkind = 'r' AND c.relnamespace = 'public'::regnamespace
        ORDER BY c.relname`,
    );
    return rows as { relname: string; forced: boolean; policies: number }[];
  }

  async function runtimePrivileges(table: string): Promise<string[]> {
    const { rows } = await ctx.owner.query(
      `SELECT grantee || ':' || privilege_type AS p
         FROM information_schema.role_table_grants
        WHERE table_schema = 'public' AND table_name = $1 AND grantee = ANY($2::text[])
        ORDER BY 1`,
      [table, [...RUNTIME_ROLES]],
    );
    return (rows as { p: string }[]).map((r) => r.p);
  }

  it("every tenant_id table is FORCE-RLS with a policy, or allowlisted as definer-only", async () => {
    const allow = new Set(DEFINER_ONLY_TENANT_TABLES.map((e) => e.table));
    const violations: string[] = [];
    for (const t of await tenantTables()) {
      if (t.forced && t.policies > 0) continue;
      if (allow.has(t.relname)) continue;
      violations.push(`${t.relname} (forced=${t.forced}, policies=${t.policies})`);
    }
    expect(violations, "tenant_id tables that are neither FORCE-RLS nor allowlisted").toEqual([]);
  });

  it("the population is larger than the hand-list above — the catalog is what this guard reads", async () => {
    const all = await tenantTables();
    expect(all.length).toBeGreaterThanOrEqual(37);
    expect(all.filter((t) => t.forced).length).toBeGreaterThanOrEqual(31);
  });

  it("every allowlist entry is a real non-RLS tenant table with ZERO privileges for app/app_worker/readonly", async () => {
    const live = new Map((await tenantTables()).map((t) => [t.relname, t]));
    for (const entry of DEFINER_ONLY_TENANT_TABLES) {
      const t = live.get(entry.table);
      expect(
        t,
        `${entry.table} must exist and carry tenant_id (else drop it from the allowlist)`,
      ).toBeDefined();
      expect(t!.forced, `${entry.table} gained FORCE RLS — remove it from the allowlist`).toBe(
        false,
      );
      expect(
        await runtimePrivileges(entry.table),
        `${entry.table} is allowlisted as definer-only but a runtime role holds a privilege on it`,
      ).toEqual([]);
    }
  });

  it("a tenant-scoped table read by app under the wrong GUC returns nothing — the property the catalog guard protects", async () => {
    // Spot-check the shape on the two newest FORCE-RLS tables the hand-list never named.
    for (const table of ["session_surface_refs", "zalo_reply_contexts"]) {
      await ctx.appPool.query(`SELECT set_config('app.tenant_id', '', false)`);
      const { rows } = await ctx.appPool.query(`SELECT count(*)::int AS n FROM ${table}`);
      expect((rows[0] as { n: number }).n, `${table} without GUC`).toBe(0);
    }
  });
});

describe("0049 tenant_capability_authorize definer ACL (DD-56 authorize primitive)", () => {
  const FN = "public.tenant_capability_authorize(uuid, text, uuid)";

  it("EXECUTE: app only -- PUBLIC, app_worker and readonly are refused", async () => {
    const can = async (role: string) =>
      (await ctx.owner.query(`SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok`, [role, FN]))
        .rows[0].ok as boolean;
    expect(await can("app")).toBe(true);
    expect(await can("app_worker")).toBe(false);
    expect(await can("readonly")).toBe(false);
    const { rows } = await ctx.owner.query(
      `SELECT p.proacl::text AS acl FROM pg_proc p WHERE p.oid = $1::regprocedure`,
      [FN],
    );
    // A NULL ACL means the PUBLIC default (EXECUTE for everyone) was never revoked.
    expect(rows[0].acl).not.toBeNull();
    expect(rows[0].acl).not.toMatch(/(^|[{,])=X/);
  });

  it("is SECURITY DEFINER with search_path pinned to pg_catalog, public, pg_temp (pg_temp LAST, 0048 lesson)", async () => {
    const { rows } = await ctx.owner.query(
      `SELECT p.prosecdef, p.proconfig FROM pg_proc p WHERE p.oid = $1::regprocedure`,
      [FN],
    );
    expect(rows[0].prosecdef).toBe(true);
    expect(rows[0].proconfig).toContain("search_path=pg_catalog, public, pg_temp");
  });
});

describe("0051 create_host_added_person definer (web MVP M2c host-add)", () => {
  const FN = "public.create_host_added_person(uuid, uuid, text)";

  it("EXECUTE: app only; SECURITY DEFINER with search_path pinned (pg_temp LAST)", async () => {
    const can = async (role: string) =>
      (await ctx.owner.query(`SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok`, [role, FN]))
        .rows[0].ok as boolean;
    expect(await can("app")).toBe(true);
    expect(await can("app_worker")).toBe(false);
    expect(await can("readonly")).toBe(false);
    const { rows } = await ctx.owner.query(
      `SELECT p.prosecdef, p.proconfig, p.proacl::text AS acl FROM pg_proc p WHERE p.oid = $1::regprocedure`,
      [FN],
    );
    expect(rows[0].prosecdef).toBe(true);
    expect(rows[0].proconfig).toContain("search_path=pg_catalog, public, pg_temp");
    expect(rows[0].acl).not.toBeNull();
    expect(rows[0].acl).not.toMatch(/(^|[{,])=X/);
  });

  it("refuses an unscoped caller, a mismatched tenant GUC and a non-admin actor; mints a person only for an active admin", async () => {
    const admin = (
      await ctx.owner.query(`INSERT INTO persons (display_name) VALUES ('adm') RETURNING id`)
    ).rows[0].id as string;
    await ctx.owner.query(
      `INSERT INTO tenant_admins (tenant_id, platform, platform_user_lookup_hash, role, active) VALUES ($1,'web',$2,'owner',true)`,
      [ctx.tenantA, admin],
    );
    const client = await ctx.appPool.connect();
    try {
      const call = (tenant: string, actor: string, name: string) =>
        client.query(`SELECT public.create_host_added_person($1::uuid, $2::uuid, $3) AS id`, [
          tenant,
          actor,
          name,
        ]);
      await client.query(`SELECT set_config('app.tenant_id', '', false)`);
      await expect(call(ctx.tenantA, admin, "X")).rejects.toThrow(/tenant context mismatch/);
      await client.query(`SELECT set_config('app.tenant_id', $1, false)`, [ctx.tenantB]);
      await expect(call(ctx.tenantA, admin, "X")).rejects.toThrow(/tenant context mismatch/);
      await client.query(`SELECT set_config('app.tenant_id', $1, false)`, [ctx.tenantA]);
      await expect(call(ctx.tenantA, randomUUID(), "X")).rejects.toThrow(
        /not an active tenant admin/,
      );
      await expect(call(ctx.tenantA, admin, "   ")).rejects.toThrow(/display name/);
      await expect(call(ctx.tenantA, admin, "x".repeat(101))).rejects.toThrow(/display name/);
      const ok = await call(ctx.tenantA, admin, "  Lan  ");
      const id = ok.rows[0].id as string;
      const p = await ctx.owner.query(`SELECT display_name, status FROM persons WHERE id = $1`, [
        id,
      ]);
      expect(p.rows[0]).toEqual({ display_name: "Lan", status: "active" });
    } finally {
      await client.query(`SELECT set_config('app.tenant_id', '', false)`);
      client.release();
    }
  });
});

// 0058 (Phase 3 L8): the one narrow definer that gives a person a guest membership in the caller's
// own club. `persons` has no grant to `app` (0009), so a self-join by a person without a membership
// (and L10b's join-by-slug) can only mint one here. A-7, definer half: GUC binding, active person,
// live membership reused, ONE guest row under concurrency, never a name match, app-only EXECUTE.
describe("0058 create_guest_membership definer (Phase 3 L8 self-join, A-7)", () => {
  const FN = "public.create_guest_membership(uuid, uuid)";
  const CALL = `SELECT public.create_guest_membership($1::uuid, $2::uuid) AS id`;
  const person = async (name: string) =>
    (await ctx.owner.query(`INSERT INTO persons (display_name) VALUES ($1) RETURNING id`, [name]))
      .rows[0].id as string;
  const seed = async (tenant: string, who: string, status: string, name: string | null) =>
    (
      await ctx.owner.query(
        `INSERT INTO memberships (tenant_id, person_id, status, display_name) VALUES ($1, $2, $3, $4) RETURNING id`,
        [tenant, who, status, name],
      )
    ).rows[0].id as string;

  it("EXECUTE: app only; SECURITY DEFINER with search_path pinned (pg_temp LAST), owned like 0051; app still cannot read persons", async () => {
    const can = async (role: string) =>
      (await ctx.owner.query(`SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok`, [role, FN]))
        .rows[0].ok as boolean;
    expect(await can("app")).toBe(true);
    expect(await can("app_worker")).toBe(false);
    expect(await can("readonly")).toBe(false);
    const { rows } = await ctx.owner.query(
      `SELECT p.prosecdef, p.proconfig, p.proacl::text AS acl, p.proowner = q.proowner AS same_owner
         FROM pg_proc p, pg_proc q
        WHERE p.oid = $1::regprocedure
          AND q.oid = 'public.create_host_added_person(uuid, uuid, text)'::regprocedure`,
      [FN],
    );
    expect(rows[0].prosecdef).toBe(true);
    expect(rows[0].proconfig).toContain("search_path=pg_catalog, public, pg_temp");
    expect(rows[0].acl).not.toBeNull();
    expect(rows[0].acl).not.toMatch(/(^|[{,])=X/);
    expect(rows[0].same_owner).toBe(true);
    const priv = await ctx.owner.query(
      `SELECT has_table_privilege('app', 'persons', 'SELECT') AS s`,
    );
    expect(priv.rows[0].s).toBe(false);
  });

  it("refuses an unset, malformed or foreign tenant GUC and a person who is not active; writes nothing", async () => {
    const p = await person("Khách");
    const gone = await person("Đã xoá");
    await ctx.owner.query(`UPDATE persons SET status = 'deleted' WHERE id = $1`, [gone]);
    const client = await ctx.appPool.connect();
    try {
      const call = (tenant: string, who: string) => client.query(CALL, [tenant, who]);
      for (const guc of ["", "not-a-uuid", ctx.tenantB]) {
        await client.query(`SELECT set_config('app.tenant_id', $1, false)`, [guc]);
        await expect(call(ctx.tenantA, p), guc).rejects.toThrow(/tenant context mismatch/);
      }
      await client.query(`SELECT set_config('app.tenant_id', $1, false)`, [ctx.tenantA]);
      for (const who of [gone, randomUUID()]) {
        await expect(call(ctx.tenantA, who)).rejects.toThrow(/person is not active/);
      }
    } finally {
      await client.query(`SELECT set_config('app.tenant_id', '', false)`);
      client.release();
    }
    const n = await ctx.owner.query(
      `SELECT count(*)::int AS n FROM memberships WHERE person_id = ANY($1::uuid[])`,
      [[p, gone]],
    );
    expect(n.rows[0].n).toBe(0);
  });

  it("returns a live (active or guest) membership as is, else inserts ONE guest row named from persons; idempotent; never a name match; nothing else touched", async () => {
    const member = await person("Thành viên");
    const guest = await person("Khách cũ");
    const visitor = await person("Khách vãng lai");
    const namesake = await person("Khách vãng lai");
    const mActive = await seed(ctx.tenantA, member, "active", "Tên ở CLB");
    const mGuest = await seed(ctx.tenantA, guest, "guest", null);
    const mLeft = await seed(ctx.tenantA, visitor, "left", "cũ");
    const mOther = await seed(ctx.tenantB, visitor, "active", "Ở CLB B");
    const mNamesake = await seed(ctx.tenantA, namesake, "active", "Khách vãng lai");
    const snapshot = async () =>
      (
        await ctx.owner.query(
          `SELECT id, tenant_id, person_id, status, display_name FROM memberships WHERE person_id = ANY($1::uuid[]) ORDER BY id`,
          [[member, guest, visitor, namesake]],
        )
      ).rows;
    const before = await snapshot();
    const client = await ctx.appPool.connect();
    try {
      await client.query(`SELECT set_config('app.tenant_id', $1, false)`, [ctx.tenantA]);
      const call = async (who: string) =>
        (await client.query(CALL, [ctx.tenantA, who])).rows[0].id as string;
      expect(await call(member)).toBe(mActive);
      expect(await call(guest)).toBe(mGuest);
      const created = await call(visitor);
      expect([mActive, mGuest, mLeft, mOther, mNamesake]).not.toContain(created);
      expect(await call(visitor)).toBe(created);
      const after = await snapshot();
      expect(after.filter((r) => r.id !== created)).toEqual(before);
      expect(after.find((r) => r.id === created)).toEqual({
        id: created,
        tenant_id: ctx.tenantA,
        person_id: visitor,
        status: "guest",
        display_name: "Khách vãng lai",
      });
    } finally {
      await client.query(`SELECT set_config('app.tenant_id', '', false)`);
      client.release();
    }
  });

  it("two concurrent first calls for one (tenant, person) end with ONE guest membership and the same id", async () => {
    const who = await person("Song song");
    const c1 = await ctx.appPool.connect();
    const c2 = await ctx.appPool.connect();
    try {
      for (const c of [c1, c2]) {
        await c.query("BEGIN");
        await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [ctx.tenantA]);
      }
      const first = (await c1.query(CALL, [ctx.tenantA, who])).rows[0].id as string;
      const pid2 = (await c2.query("SELECT pg_backend_pid() AS pid")).rows[0].pid as number;
      const second = c2.query(CALL, [ctx.tenantA, who]);
      // Keep c1 open until c2 waits on c1's uncommitted unique-index entry, so this exercises the
      // ON CONFLICT DO NOTHING + re-read branch rather than a sequential second call.
      let blocked = false;
      for (let i = 0; i < 150 && !blocked; i++) {
        const w = await ctx.owner.query(
          `SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1`,
          [pid2],
        );
        blocked = w.rows[0]?.wait_event_type === "Lock";
        if (!blocked) await new Promise((r) => setTimeout(r, 20));
      }
      expect(blocked).toBe(true);
      await c1.query("COMMIT");
      expect((await second).rows[0].id).toBe(first);
      await c2.query("COMMIT");
      const n = await ctx.owner.query(
        `SELECT count(*)::int AS n FROM memberships WHERE tenant_id = $1 AND person_id = $2`,
        [ctx.tenantA, who],
      );
      expect(n.rows[0].n).toBe(1);
    } finally {
      for (const c of [c1, c2]) {
        await c.query("ROLLBACK").catch(() => undefined);
        c.release();
      }
    }
  });
});

describe("0052 tenant profile definers ACL (M1b club configuration)", () => {
  const FNS = [
    "public.tenant_profile_read(uuid)",
    "public.tenant_profile_update(uuid, uuid, text, text, text)",
  ];

  it("EXECUTE: app only -- PUBLIC, app_worker and readonly are refused", async () => {
    for (const fn of FNS) {
      const can = async (role: string) =>
        (
          await ctx.owner.query(`SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok`, [
            role,
            fn,
          ])
        ).rows[0].ok as boolean;
      expect(await can("app"), fn).toBe(true);
      expect(await can("app_worker"), fn).toBe(false);
      expect(await can("readonly"), fn).toBe(false);
      const { rows } = await ctx.owner.query(
        `SELECT p.proacl::text AS acl FROM pg_proc p WHERE p.oid = $1::regprocedure`,
        [fn],
      );
      expect(rows[0].acl, fn).not.toBeNull();
      expect(rows[0].acl, fn).not.toMatch(/(^|[{,])=X/);
    }
  });

  it("both are SECURITY DEFINER with search_path pinned (pg_temp last); app still has no privilege on tenants", async () => {
    for (const fn of FNS) {
      const { rows } = await ctx.owner.query(
        `SELECT p.prosecdef, p.proconfig FROM pg_proc p WHERE p.oid = $1::regprocedure`,
        [fn],
      );
      expect(rows[0].prosecdef, fn).toBe(true);
      expect(rows[0].proconfig, fn).toContain("search_path=pg_catalog, public, pg_temp");
    }
    const priv = await ctx.owner.query(
      `SELECT has_table_privilege('app','tenants','SELECT') s, has_table_privilege('app','tenants','UPDATE') u`,
    );
    expect(priv.rows[0]).toEqual({ s: false, u: false });
  });

  it.each([
    ["unset", ""],
    ["malformed", "not-a-uuid"],
  ])("read/update refuse a caller whose GUC is %s", async (_label, guc) => {
    const c = await ctx.appPool.connect();
    try {
      for (const q of [
        `SELECT * FROM tenant_profile_read('${ctx.tenantA}')`,
        `SELECT * FROM tenant_profile_update('${ctx.tenantA}', '${ctx.tenantA}', 'n', NULL, NULL)`,
      ]) {
        await c.query("BEGIN");
        await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [guc]);
        await expect(c.query(q)).rejects.toThrow(/context mismatch/);
        await c.query("ROLLBACK");
      }
    } finally {
      c.release();
    }
  });

  it("read/update refuse a caller whose GUC is not the requested tenant; update refuses a non-member", async () => {
    const stranger = await ctx.owner.query(
      `INSERT INTO persons (display_name) VALUES ('x') RETURNING id`,
    );
    const c = await ctx.appPool.connect();
    try {
      await c.query("BEGIN");
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [ctx.tenantA]);
      await expect(c.query(`SELECT * FROM tenant_profile_read($1)`, [ctx.tenantB])).rejects.toThrow(
        /context mismatch/,
      );
      await c.query("ROLLBACK");
      await c.query("BEGIN");
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [ctx.tenantA]);
      await expect(
        c.query(`SELECT * FROM tenant_profile_update($1, $2, 'n', NULL, NULL)`, [
          ctx.tenantA,
          stranger.rows[0].id,
        ]),
      ).rejects.toThrow(/not permitted/);
      await c.query("ROLLBACK");
    } finally {
      c.release();
    }
  });
});

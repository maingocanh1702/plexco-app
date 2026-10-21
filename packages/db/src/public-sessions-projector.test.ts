import { createHash, randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { PgDialect } from "drizzle-orm/pg-core";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sessions } from "../schema.js";
import { clearPublicSessionFence } from "./public-session-fence.js";
import { getSessionOccupancy, occupiedCountSql } from "./session-occupancy.js";
import { withTenant } from "./tenant.js";
import { setupRlsTestContext, withJobDefinerLock, type RlsTestContext } from "./test-harness.js";

// 0061 (public sessions projector writer, session_occupancy, share-slug registry, replaced view)
// as the real roles app / app_worker / readonly and the trusted owner path. Real PG;
// DATABASE_URL_TEST required. Contract: docs/sessions/web-mvp-phase3-readiness-p3-m9-public-projector.md
// sections 4 and 7 (PSP-1..PSP-11).
const DB_NAME = "plexco_public_sessions_projector";
const BASE = process.env.DATABASE_URL_TEST!;
const HOUR = 3_600_000;
// Every person, guest and tenant name fixture carries SECRET; the venue fixture no longer does:
// the venue is public by default under DD-139 (owner decision B1), so the view serves it.
const SECRET = "Secret";
let ctx: RlsTestContext;

beforeAll(async () => {
  ctx = await setupRlsTestContext(DB_NAME);
});
afterAll(async () => {
  await ctx?.teardown();
});

type Row = Record<string, unknown>;
const owner = async (sql: string, params: unknown[] = []) =>
  (await ctx.owner.query(sql, params)).rows as Row[];
const worker = async (sql: string, params: unknown[] = []) =>
  (await ctx.workerPool.query(sql, params)).rows as Row[];
const reader = async (sql: string, params: unknown[] = []) =>
  (await ctx.readonlyPool.query(sql, params)).rows as Row[];
const sqlState = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: unknown) => String((e as { code?: string }).code),
  );
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

const TABLE_COLS = [
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
  "venue_name",
  "venue_address",
];
const VIEW_COLS = [
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
  "venue_name",
  "venue_address",
];
// The eight DD-41 columns (written NULL, P-1); the venue after them is projected (DD-139 / B1).
const DD41_COLS = VIEW_COLS.slice(9, 17);

/** One app transaction with the tenant GUC set (or deliberately unset), like withTenant. */
async function asApp<T>(tenantId: string | null, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await ctx.appPool.connect();
  try {
    await c.query("BEGIN");
    if (tenantId) await c.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await fn(c);
    await c.query("COMMIT");
    return result;
  } catch (error) {
    await c.query("ROLLBACK");
    throw error;
  } finally {
    c.release();
  }
}

async function club(alias: string | null = "CLB Q7", aliasStatus = "approved"): Promise<string> {
  const [t] = await owner(
    `INSERT INTO tenants (name, slug, public_alias, public_alias_status) VALUES ($1, $2, $3, $4) RETURNING id`,
    [
      `${SECRET} Tenant ${randomUUID()}`,
      `psp-${randomUUID()}`,
      alias,
      alias === null ? null : aliasStatus,
    ],
  );
  return t!.id as string;
}
interface SessionSeed {
  status?: string;
  visibility?: string;
  startsInHours?: number;
  area?: string;
  slotsMax?: number | null;
}
async function session(tenantId: string, s: SessionSeed = {}): Promise<string> {
  const starts = new Date(Date.now() + (s.startsInHours ?? 24) * HOUR);
  const [r] = await owner(
    `INSERT INTO sessions (tenant_id, sport_id, starts_at, ends_at, timezone, venue_name, venue_address, area,
       price_amount, slots_max, visibility, join_policy, status)
     VALUES ($1, $2, $3, $3::timestamptz + interval '2 hours', 'Asia/Ho_Chi_Minh', $4, '1 Public Street', $5, 50000, $6, $7, 'open', $8)
     RETURNING id`,
    [
      tenantId,
      ctx.badmintonSportId,
      starts,
      "Public Venue",
      s.area ?? "Quan 7",
      s.slotsMax === undefined ? 10 : s.slotsMax,
      s.visibility ?? "public",
      s.status ?? "open",
    ],
  );
  return r!.id as string;
}
let rank = 0;
async function seat(tenantId: string, sessionId: string, status: "active" | "waitlisted" | "left") {
  const [p] = await owner(`INSERT INTO persons (display_name) VALUES ($1) RETURNING id`, [
    `${SECRET} Person`,
  ]);
  const [m] = await owner(
    `INSERT INTO memberships (tenant_id, person_id, status) VALUES ($1, $2, 'active') RETURNING id`,
    [tenantId, p!.id],
  );
  await owner(
    `INSERT INTO players (tenant_id, session_id, membership_id, status, waitlist_position) VALUES ($1, $2, $3, $4, $5)`,
    [tenantId, sessionId, m!.id, status, status === "waitlisted" ? ++rank : null],
  );
}
async function guest(tenantId: string, sessionId: string) {
  const [p] = await owner(`INSERT INTO persons (display_name) VALUES ($1) RETURNING id`, [
    `${SECRET} Host`,
  ]);
  await owner(
    `INSERT INTO session_guest_notes (tenant_id, session_id, created_by_person_id, guest_name) VALUES ($1, $2, $3, $4)`,
    [tenantId, sessionId, p!.id, `${SECRET} Guest`],
  );
}

/** The writer, as the real app_worker seat (the projector's identity). */
const project = async (sid: string, eventId: string | null = null) =>
  (await worker("SELECT public_sessions_project_session($1, $2) AS d", [sid, eventId]))[0]!
    .d as string;
const baseRow = async (sid: string) =>
  (await owner("SELECT * FROM public_sessions WHERE id = $1", [sid]))[0];
const listingId = async (sid: string) => (await baseRow(sid))!.public_listing_id as string;
const viewRow = async (lid: string) =>
  (await reader("SELECT * FROM public_session_share_v WHERE public_listing_id = $1", [lid]))[0];
const raise = (tenantId: string, sid: string) =>
  asApp(tenantId, (c) =>
    c.query("SELECT raise_public_session_fence($1, 'visibility_private')", [sid]),
  );
/** D3: no runtime role may observe or clear a fence (only the writer, as job_definer); the owner reads it. */
const fenceToken = async (sid: string) =>
  (await owner("SELECT current_public_session_fence_token($1) AS t", [sid]))[0]!.t as string | null;
/** Resolves once backend `pid` waits on a lock another session holds (no fixed sleep). */
async function blockedOn(pid: number): Promise<void> {
  for (let i = 0; i <= 200; i++) {
    const [r] = await owner("SELECT cardinality(pg_blocking_pids($1)) AS n", [pid]);
    if ((r!.n as number) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`backend ${pid} never blocked`);
}
const rotate = (tenantId: string | null, sid: string) =>
  asApp(
    tenantId,
    async (c) =>
      (await c.query("SELECT public_session_share_slug_rotate($1) AS s", [sid])).rows[0]
        .s as string,
  );
const revoke = (tenantId: string, sid: string) =>
  asApp(
    tenantId,
    async (c) =>
      (await c.query("SELECT public_session_share_slug_revoke($1) AS ok", [sid])).rows[0]
        .ok as boolean,
  );
const resolveSlug = (slug: string | null) =>
  reader("SELECT * FROM public_share_slug_resolve($1)", [slug]);
const resolveListing = (lid: string) => reader("SELECT * FROM public_listing_resolve($1)", [lid]);
const columns = async (rel: string) =>
  (
    await owner(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position",
      [rel],
    )
  ).map((r) => r.column_name as string);

describe("PSP-1 whitelist of the table, the view and the projector's writes (A-1, A-2)", () => {
  it("PSP-1a: the table holds exactly the 24 approved columns and the view exactly the 19, in order", async () => {
    expect((await columns("public_sessions")).sort()).toEqual([...TABLE_COLS].sort());
    expect(await columns("public_session_share_v")).toEqual(VIEW_COLS);
  });

  it("PSP-1b: an eligible session is upserted with slots_open = slots_max - occupancy and served through the view", async () => {
    const t = await club("CLB Q7");
    const sid = await session(t, { slotsMax: 10 });
    await seat(t, sid, "active");
    await guest(t, sid);
    expect(await project(sid)).toBe("upserted");
    const row = (await baseRow(sid))!;
    expect(Object.keys(row).sort()).toEqual([...TABLE_COLS].sort());
    expect(row).toMatchObject({
      session_id: sid,
      tenant_id: t,
      sport_key: "badminton",
      area: "Quan 7",
      price_amount: 50000,
      slots_open: 8,
      join_policy: "open",
    });
    expect(Number(row.public_projection_version)).toBe(1);
    expect((row.expires_at as Date).getTime()).toBe((row.starts_at as Date).getTime());
    for (const c of DD41_COLS) expect(row[c]).toBeNull();
    const v = (await viewRow(row.public_listing_id as string))!;
    expect(Object.keys(v)).toEqual(VIEW_COLS);
    expect(v).toMatchObject({ club_display_name: "CLB Q7", slots_open: 8, price_amount: 50000 });
    const served = JSON.stringify(v);
    for (const leak of [SECRET, t, sid]) expect(served).not.toContain(leak);
    // A-1 at the view: the venue is public by default (DD-139 / owner decision B1).
    expect(v.venue_name).toBe("Public Venue");
    expect(v.venue_address).toBe("1 Public Street");
  });
});

describe("PSP-2 ineligible sessions get no row (A-3)", () => {
  const variants: [string, string, unknown[]][] = [
    ["draft", "UPDATE sessions SET status = 'draft' WHERE id = $1", []],
    ["private", "UPDATE sessions SET visibility = 'private' WHERE id = $1", []],
    ["closed", "UPDATE sessions SET status = 'closed' WHERE id = $1", []],
    ["cancelled", "UPDATE sessions SET status = 'cancelled' WHERE id = $1", []],
    [
      "past",
      "UPDATE sessions SET starts_at = now() - interval '1 hour', ends_at = now() + interval '1 hour' WHERE id = $1",
      [],
    ],
    ["blank area", "UPDATE sessions SET area = '   ' WHERE id = $1", []],
    [
      "suspended tenant",
      "UPDATE tenants SET status = 'suspended' WHERE id = (SELECT tenant_id FROM sessions WHERE id = $1)",
      [],
    ],
    [
      "unapproved alias",
      "UPDATE tenants SET public_alias_status = 'pending' WHERE id = (SELECT tenant_id FROM sessions WHERE id = $1)",
      [],
    ],
  ];
  it.each(variants)(
    "PSP-2 %s: an existing row is deleted, then absent; a sibling club row is unaffected",
    async (_label, update) => {
      const sibling = await session(await club("Sibling"));
      expect(await project(sibling)).toBe("upserted");
      const sid = await session(await club());
      expect(await project(sid)).toBe("upserted");
      await owner(update, [sid]);
      expect(await project(sid)).toBe("deleted");
      expect(await project(sid)).toBe("absent");
      expect(await baseRow(sid)).toBeUndefined();
      expect(await viewRow(await listingId(sibling))).toBeDefined();
    },
  );

  it("PSP-2b: a draft that is already public, and a tenant without any alias, are never projected", async () => {
    const t = await club();
    expect(await project(await session(t, { status: "draft" }))).toBe("absent");
    expect(await project(await session(await club(null)))).toBe("absent");
  });
});

describe("PSP-3 NULL slots_max is audited, never projected (A-4, R-1)", () => {
  it("PSP-3: disposition ineligible_unlimited, the row is deleted, one audit row per event id and none for NULL", async () => {
    const t = await club();
    const sid = await session(t);
    expect(await project(sid)).toBe("upserted");
    const slug = await rotate(t, sid); // D6 (r1 N-3): a host slug minted before the R-1 branch
    const [ev] = await owner(
      `INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, sequence, type, payload)
       VALUES ($1, 'session', $2, 1, 'session.updated', '{}') RETURNING id`,
      [t, sid],
    );
    const q = (sql: string, params: unknown[] = []) => ctx.owner.query(sql, params);
    await q("BEGIN");
    try {
      await q("ALTER TABLE sessions DROP CONSTRAINT sessions_public_capacity_chk");
      await q("UPDATE sessions SET slots_max = NULL WHERE id = $1", [sid]);
      await q("SET LOCAL ROLE app_worker");
      const withEvent = (
        await q("SELECT public_sessions_project_session($1, $2) AS d", [sid, ev!.id])
      ).rows[0].d;
      const backfill = (await q("SELECT public_sessions_project_session($1, NULL) AS d", [sid]))
        .rows[0].d;
      await q("RESET ROLE");
      expect([withEvent, backfill]).toEqual(["ineligible_unlimited", "ineligible_unlimited"]);
      expect((await q("SELECT 1 FROM public_sessions WHERE id = $1", [sid])).rowCount).toBe(0);
      const audits = await q(
        "SELECT job_id, tenant_id, actor, fn_name FROM job_audit_events WHERE reason = 'public_projection_ineligible_unlimited'",
      );
      expect(audits.rows).toEqual([
        {
          job_id: ev!.id,
          tenant_id: t,
          actor: "system",
          fn_name: "public_sessions_project_session",
        },
      ]);
      const tomb = await q(
        "SELECT revoked_at FROM public_session_share_slugs WHERE session_id = $1",
        [sid],
      );
      expect(tomb.rows).toHaveLength(1);
      expect(tomb.rows[0].revoked_at).not.toBeNull(); // the R-1 branch tombstones the active slug
      expect((await q("SELECT * FROM public_share_slug_resolve($1)", [slug])).rowCount).toBe(0);
    } finally {
      await q("ROLLBACK");
    }
  });
});

describe("PSP-4 an alias rejection hides the club at once, with no projector run (A-5)", () => {
  it("PSP-4: rejected or pending hides every row of the club through the view; re-approval serves the live alias", async () => {
    const t = await club("CLB Cu");
    const sids = [await session(t), await session(t)];
    for (const sid of sids) expect(await project(sid)).toBe("upserted");
    const lids = await Promise.all(sids.map(listingId));
    const visible = async () => (await Promise.all(lids.map(viewRow))).filter(Boolean).length;
    expect(await visible()).toBe(2);
    await owner("UPDATE tenants SET public_alias_status = 'rejected' WHERE id = $1", [t]);
    expect(await visible()).toBe(0);
    expect(await baseRow(sids[0]!)).toBeDefined(); // the base row is still there: the live filter hid it
    await owner(
      "UPDATE tenants SET public_alias = 'CLB Moi', public_alias_status = 'pending' WHERE id = $1",
      [t],
    );
    expect(await visible()).toBe(0);
    await owner("UPDATE tenants SET public_alias_status = 'approved' WHERE id = $1", [t]);
    expect((await viewRow(lids[0]!))!.club_display_name).toBe("CLB Moi");
    await owner("UPDATE tenants SET status = 'suspended' WHERE id = $1", [t]);
    expect(await visible()).toBe(0);
  });
});

describe("PSP-5 fence immediate-deny then the writer's CAS-clear (A-7, D3)", () => {
  it("PSP-5: a raise hides the row at once; the writer clears only the token it observed, so a raise committed after that observation stays", async () => {
    const t = await club();
    const sid = await session(t);
    expect(await project(sid)).toBe("upserted");
    const lid = await listingId(sid);
    await raise(t, sid);
    expect(await viewRow(lid)).toBeUndefined(); // immediate deny, before any projector run
    const observed = (await fenceToken(sid))!;
    // The owner holds the row, so the writer blocks at its first write, AFTER its observation.
    const w = await ctx.workerPool.connect();
    await ctx.owner.query("BEGIN");
    try {
      const pid = (await w.query("SELECT pg_backend_pid() AS pid")).rows[0].pid as number;
      await ctx.owner.query("SELECT 1 FROM public_sessions WHERE id = $1 FOR UPDATE", [sid]);
      const run = w.query("SELECT public_sessions_project_session($1, NULL) AS d", [sid]);
      run.catch(() => undefined);
      await blockedOn(pid);
      await raise(t, sid); // committed while the writer waits, after its observation
      const newer = (await fenceToken(sid))!;
      expect(newer).not.toBe(observed);
      await ctx.owner.query("COMMIT");
      expect((await run).rows[0].d).toBe("rotated");
      expect(await fenceToken(sid)).toBe(newer); // the newer raise stays
      expect(await viewRow(await listingId(sid))).toBeUndefined();
    } finally {
      await ctx.owner.query("ROLLBACK").catch(() => undefined);
      w.release();
    }
    expect(await project(sid)).toBe("rotated"); // the next run observes and clears the newer token
    expect(await fenceToken(sid)).toBeNull();
    expect(await viewRow(await listingId(sid))).toBeDefined();
  });

  it("PSP-5b: app_worker and app get 42501 on both fence functions (the S-1 bare clear is refused); the TS CAS wrapper serves the owner only", async () => {
    const t = await club();
    const sid = await session(t);
    expect(await project(sid)).toBe("upserted");
    const lid = await listingId(sid);
    await raise(t, sid);
    const token = (await fenceToken(sid))!;
    // s1 S-1: a compromised worker un-fencing a just-privatised session without a recompute.
    const s1 = "SELECT clear_public_session_fence($1, current_public_session_fence_token($1))";
    expect(await sqlState(ctx.workerPool.query(s1, [sid]))).toBe("42501");
    for (const pool of [ctx.workerPool, ctx.appPool]) {
      const observe = pool.query("SELECT current_public_session_fence_token($1)", [sid]);
      expect(await sqlState(observe)).toBe("42501");
      const clear = pool.query("SELECT clear_public_session_fence($1, $2)", [sid, token]);
      expect(await sqlState(clear)).toBe("42501");
    }
    const drizzleState = (p: Promise<unknown>) =>
      p.then(
        () => "ok",
        (e: { code?: string; cause?: { code?: string } }) => String(e.cause?.code ?? e.code),
      );
    const viaWorker = clearPublicSessionFence(drizzle(ctx.workerPool), sid, token);
    expect(await drizzleState(viaWorker)).toBe("42501");
    const viaApp = withTenant(ctx.appDb.db, t, (tx) => clearPublicSessionFence(tx, sid, token));
    expect(await drizzleState(viaApp)).toBe("42501");
    expect(await fenceToken(sid)).toBe(token);
    expect(await viewRow(lid)).toBeUndefined();
    // The wrapper's CAS semantics on the owner connection (owner tooling and tests only).
    const ownerDb = drizzle(ctx.owner);
    await raise(t, sid); // a newer raise: the stale token clears nothing
    expect(await clearPublicSessionFence(ownerDb, sid, token)).toBe(false);
    const current = (await fenceToken(sid))!;
    expect(await clearPublicSessionFence(ownerDb, sid, current)).toBe(true);
    expect(await clearPublicSessionFence(ownerDb, sid, current)).toBe(false); // already gone
    expect(await viewRow(lid)).toBeDefined();
  });
});

describe("PSP-5c the writer runs only under READ COMMITTED (D8, s2 S2-SF-1)", () => {
  /** The writer's outcome on client `c`: its disposition, or the SQLSTATE it failed with. */
  const outcomeOn = async (c: pg.PoolClient, sid: string) => {
    try {
      const r = await c.query("SELECT public_sessions_project_session($1, NULL) AS d", [sid]);
      return r.rows[0].d as string;
    } catch (e) {
      return String((e as { code?: string }).code);
    }
  };

  it("PSP-5c (a): app_worker inside REPEATABLE READ or SERIALIZABLE gets 25000 and the writer changes nothing", async () => {
    const t = await club();
    const sid = await session(t);
    expect(await project(sid)).toBe("upserted");
    await raise(t, sid); // under READ COMMITTED the writer would rotate the row and clear this fence
    const row = await baseRow(sid);
    const token = (await fenceToken(sid))!;
    for (const level of ["REPEATABLE READ", "SERIALIZABLE"]) {
      const w = await ctx.workerPool.connect();
      let outcome: string | undefined;
      try {
        await w.query(`BEGIN ISOLATION LEVEL ${level}`);
        outcome = await outcomeOn(w, sid);
        await w.query("COMMIT"); // after a failed call Postgres turns it into a rollback
      } finally {
        await w.query("ROLLBACK").catch(() => undefined);
        w.release();
      }
      expect(await baseRow(sid)).toEqual(row);
      expect(await fenceToken(sid)).toBe(token);
      expect(outcome).toBe("25000");
    }
  });

  it("PSP-5c (b): a REPEATABLE READ snapshot taken while S was public cannot replay it after the delete and the clear", async () => {
    const t = await club();
    const sid = await session(t);
    expect(await project(sid)).toBe("upserted");
    const lid = await listingId(sid);
    expect(await viewRow(lid)).toBeDefined();
    const a = await ctx.workerPool.connect();
    let outcome: string | undefined;
    try {
      await a.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
      await a.query("SELECT pg_current_snapshot()"); // A's snapshot: S public and projected
      // The host flip: private plus the DD-12 raise in one source transaction (session-service).
      await asApp(t, async (c) => {
        await c.query("UPDATE sessions SET visibility = 'private' WHERE id = $1", [sid]);
        await c.query("SELECT raise_public_session_fence($1, 'visibility_private')", [sid]);
      });
      expect(await project(sid)).toBe("deleted"); // B: autocommit, READ COMMITTED
      expect(await fenceToken(sid)).toBeNull();
      outcome = await outcomeOn(a, sid);
      await a.query("COMMIT"); // after a failed call Postgres turns it into a rollback
    } finally {
      await a.query("ROLLBACK").catch(() => undefined);
      a.release();
    }
    // The leak first (red at f46e832: A's stale upsert, under a fresh public_listing_id, is served):
    // every view row the public reader sees, mapped to its session through the public lookup.
    const served = await reader(
      `SELECT v.public_listing_id FROM public_session_share_v v
         CROSS JOIN LATERAL public_listing_resolve(v.public_listing_id) r WHERE r.session_id = $1`,
      [sid],
    );
    expect(served).toEqual([]);
    expect(await resolveListing(lid)).toEqual([]);
    expect(await baseRow(sid)).toBeUndefined();
    expect(outcome).toBe("25000");
  });
});

describe("PSP-6 idempotent writer; a forged event recomputes from canonical rows only (A-10)", () => {
  it("PSP-6: re-delivery is unchanged with no version bump; a real change bumps by one; forged ids write nothing", async () => {
    const t = await club();
    const sid = await session(t);
    expect(await project(sid)).toBe("upserted");
    const first = (await baseRow(sid))!;
    expect(await project(sid, randomUUID())).toBe("unchanged");
    const again = (await baseRow(sid))!;
    expect(Number(again.public_projection_version)).toBe(1);
    expect(again.public_listing_id).toBe(first.public_listing_id);
    await owner("UPDATE sessions SET price_amount = 60000 WHERE id = $1", [sid]);
    expect(await project(sid)).toBe("upserted");
    const changed = (await baseRow(sid))!;
    expect([Number(changed.public_projection_version), changed.price_amount]).toEqual([2, 60000]);
    expect(changed.public_listing_id).toBe(first.public_listing_id);
    const priv = await session(t, { visibility: "private" });
    expect(await project(priv, randomUUID())).toBe("absent");
    expect(await project(randomUUID(), randomUUID())).toBe("absent");
    expect(await baseRow(priv)).toBeUndefined();
  });
});

describe("PSP-7 slots_open parity with fixture literal counts (A-13)", () => {
  it("PSP-7: getSessionOccupancy (app, RLS), session_occupancy and the projected slots_open agree with literal counts", async () => {
    const t = await club();
    const other = await club("Other");
    const sid = await session(t, { slotsMax: 12 });
    for (const s of ["active", "active", "active", "waitlisted", "waitlisted", "left"] as const)
      await seat(t, sid, s);
    await guest(t, sid);
    await guest(t, sid);
    const sid2 = await session(other, { slotsMax: 4 });
    await seat(other, sid2, "active");
    await guest(other, sid2);
    const full = await session(t, { slotsMax: 3 });
    for (const s of ["active", "active", "active"] as const) await seat(t, full, s);
    await guest(t, full);
    const cases: [string, string, number, number][] = [
      [t, sid, 5, 7], // 3 active + 2 guest notes; waitlisted and left never occupy
      [other, sid2, 2, 2], // a second tenant counts only its own rows
      [t, full, 4, 0], // over-booked fixture: slots_open floors at 0
    ];
    for (const [tenant, s, occupied, open] of cases) {
      expect(await withTenant(ctx.appDb.db, tenant, (tx) => getSessionOccupancy(tx, s))).toBe(
        occupied,
      );
      const viaFn = await asApp(tenant, async (c) =>
        Number((await c.query("SELECT session_occupancy($1) AS n", [s])).rows[0].n),
      );
      expect(viaFn).toBe(occupied);
      expect(await project(s)).toBe("upserted");
      expect((await baseRow(s))!.slots_open).toBe(open);
    }
    // under app RLS another tenant's GUC sees none of the session's rows
    expect(
      await asApp(other, async (c) =>
        Number((await c.query("SELECT session_occupancy($1) AS n", [sid])).rows[0].n),
      ),
    ).toBe(0);
  });

  it("PSP-7b: occupiedCountSql emits session_occupancy(x) for a bound id and for the list's correlated column", () => {
    const dialect = new PgDialect();
    const sid = randomUUID();
    expect(dialect.sqlToQuery(occupiedCountSql(sid))).toMatchObject({
      sql: "session_occupancy($1)",
      params: [sid],
    });
    expect(dialect.sqlToQuery(occupiedCountSql(sessions.id, randomUUID()))).toMatchObject({
      sql: 'session_occupancy("sessions"."id")',
      params: [],
    });
  });
});

describe("PSP-8 catalog of every 0061 function, the base deny and the view columns (A-12, A-14, A-17)", () => {
  const FNS: [string, boolean, string[]][] = [
    ["session_occupancy(uuid)", false, ["app", "job_definer"]],
    ["public_sessions_project_session(uuid,uuid)", true, ["app_worker", "job_definer"]],
    ["public_sessions_tenant_candidates(uuid)", true, ["app_worker", "job_definer"]],
    ["public_sessions_sweep_expired(integer)", true, ["app_worker", "job_definer"]],
    ["public_session_share_slug_rotate(uuid)", true, ["app", "job_definer"]],
    ["public_session_share_slug_revoke(uuid)", true, ["app", "job_definer"]],
    ["public_share_slug_resolve(text)", true, ["job_definer", "readonly"]],
    ["public_listing_resolve(uuid)", true, ["job_definer", "readonly"]],
  ];
  it.each(FNS)(
    "PSP-8 %s: owner job_definer, prosecdef %s, search_path pinned, EXECUTE exactly %j",
    async (sig, secdef, execs) => {
      const [p] = await withJobDefinerLock(BASE, () =>
        owner(
          `SELECT pg_get_userbyid(p.proowner) AS owner, p.prosecdef AS secdef, p.proconfig AS cfg,
         ARRAY(SELECT (CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END)::text
               FROM aclexplode(p.proacl) a WHERE a.privilege_type = 'EXECUTE') AS execs
       FROM pg_proc p WHERE p.oid = $1::regprocedure`,
          [sig],
        ),
      );
      expect(p).toMatchObject({
        owner: "job_definer",
        secdef,
        cfg: ["search_path=public, pg_temp"],
      });
      expect([...(p!.execs as string[])].sort()).toEqual(execs);
    },
  );

  it("PSP-8b: no runtime role holds any privilege on the base table or the slug registry; only readonly reads the view", async () => {
    await withJobDefinerLock(BASE, async () => {
      for (const role of ["app", "app_worker", "readonly"]) {
        const [r] = await owner(
          `SELECT has_table_privilege($1, 'public_sessions', 'SELECT,INSERT,UPDATE,DELETE') AS t,
                has_any_column_privilege($1, 'public_sessions', 'SELECT,INSERT,UPDATE') AS c,
                has_table_privilege($1, 'public_session_share_slugs', 'SELECT,INSERT,UPDATE,DELETE') AS s,
                has_table_privilege($1, 'public_session_share_v', 'SELECT') AS v`,
          [role],
        );
        expect(r).toEqual({ t: false, c: false, s: false, v: role === "readonly" });
      }
      const owners = await owner(
        "SELECT relname, pg_get_userbyid(relowner) AS o FROM pg_class WHERE relname IN ('public_session_share_v', 'public_session_share_slugs') ORDER BY 1",
      );
      expect(owners).toEqual([
        { relname: "public_session_share_slugs", o: "job_definer" },
        { relname: "public_session_share_v", o: "job_definer" },
      ]);
      expect(await sqlState(ctx.readonlyPool.query("SELECT * FROM public_sessions"))).toBe("42501");
      expect(await sqlState(ctx.appPool.query("SELECT 1 FROM public_sessions"))).toBe("42501");
      expect(await sqlState(ctx.appPool.query("DELETE FROM public_sessions"))).toBe("42501");
      expect(await sqlState(ctx.workerPool.query("SELECT 1 FROM public_session_share_slugs"))).toBe(
        "42501",
      );
    });
  });

  it("PSP-8c: session_occupancy runs as job_definer (the writer's owner) under BYPASSRLS", async () => {
    const t = await club();
    const sid = await session(t);
    await seat(t, sid, "active");
    const n = await withJobDefinerLock(BASE, async () => {
      await ctx.owner.query("BEGIN");
      try {
        await ctx.owner.query("SET LOCAL ROLE job_definer");
        return Number(
          (await ctx.owner.query("SELECT session_occupancy($1) AS n", [sid])).rows[0].n,
        );
      } finally {
        await ctx.owner.query("ROLLBACK");
      }
    });
    expect(n).toBe(1);
  });
});

describe("PSP-9 share slugs: hash-only, shown once, revoke and rotate (A-15)", () => {
  it("PSP-9a: rotate returns a 22-char slug once; only its domain-separated sha256 is stored; it resolves to the listing", async () => {
    const t = await club();
    const sid = await session(t);
    expect(await project(sid)).toBe("upserted");
    const lid = await listingId(sid);
    const s1 = await rotate(t, sid);
    expect(s1).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(await columns("public_session_share_slugs")).toEqual([
      "slug_hash",
      "session_id",
      "created_at",
      "revoked_at",
    ]);
    const stored = await owner(
      "SELECT encode(slug_hash, 'hex') AS h, revoked_at FROM public_session_share_slugs WHERE session_id = $1",
      [sid],
    );
    expect(stored).toEqual([{ h: sha(`plexco/session-share-slug/v1:${s1}`), revoked_at: null }]);
    expect(await resolveSlug(s1)).toEqual([
      { tenant_id: t, session_id: sid, public_listing_id: lid },
    ]);
    const s2 = await rotate(t, sid);
    expect(s2).not.toBe(s1);
    expect(await resolveSlug(s1)).toEqual([]);
    expect(await resolveSlug(s2)).toHaveLength(1);
    expect(await revoke(t, sid)).toBe(true);
    expect(await revoke(t, sid)).toBe(false);
    expect(await resolveSlug(s2)).toEqual([]);
    for (const bad of [
      null,
      "",
      "short",
      `${s2}x`,
      `${s2.slice(0, 21)}!`,
      `${s2.slice(0, 21)}${String.fromCodePoint(0x202e)}`,
    ]) {
      expect(await resolveSlug(bad)).toEqual([]);
    }
  });

  it("PSP-9b: rotate fails closed without a tenant GUC, for another tenant, and for a session not visible in the view", async () => {
    const t = await club();
    const sid = await session(t);
    expect(await project(sid)).toBe("upserted");
    expect(await sqlState(rotate(null, sid))).toBe("P0001");
    expect(await sqlState(rotate(await club("Other"), sid))).toBe("P0001");
    expect(await sqlState(rotate(t, await session(t, { visibility: "private" })))).toBe("55000");
    await raise(t, sid);
    expect(await sqlState(rotate(t, sid))).toBe("55000");
  });

  it("PSP-9c: deleting the listing tombstones its active slug in the same transaction (P-17)", async () => {
    const t = await club();
    const sid = await session(t);
    expect(await project(sid)).toBe("upserted");
    const s = await rotate(t, sid);
    await owner("UPDATE sessions SET visibility = 'private' WHERE id = $1", [sid]);
    expect(await project(sid)).toBe("deleted");
    expect(await resolveSlug(s)).toEqual([]);
    const [r] = await owner(
      "SELECT revoked_at FROM public_session_share_slugs WHERE session_id = $1",
      [sid],
    );
    expect(r!.revoked_at).not.toBeNull();
  });
});

describe("PSP-10 public_listing_id is unique, 128-bit and rotated on leaving public (A-16, P-16)", () => {
  it("PSP-10: a new id after leaving and re-entering public, and after a fence; old ids and slugs resolve nothing", async () => {
    const unique = await owner(
      "SELECT indexdef FROM pg_indexes WHERE tablename = 'public_sessions' AND indexdef LIKE 'CREATE UNIQUE INDEX%(public_listing_id)'",
    );
    expect(unique).toHaveLength(1);
    // r1 N-2: the DEFAULT is 128 CSPRNG bits (gen_random_uuid() would carry only 122).
    const [def] = await owner(
      `SELECT pg_get_expr(d.adbin, d.adrelid) AS e FROM pg_attrdef d
         JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
        WHERE d.adrelid = 'public_sessions'::regclass AND a.attname = 'public_listing_id'`,
    );
    expect(def!.e).toMatch(/^\(encode\((public\.)?gen_random_bytes\(16\), 'hex'::text\)\)::uuid$/);
    const t = await club();
    const sid = await session(t);
    expect(await project(sid)).toBe("upserted");
    const lid1 = await listingId(sid);
    expect(lid1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(await resolveListing(lid1)).toEqual([{ tenant_id: t, session_id: sid }]);
    await owner("UPDATE sessions SET visibility = 'private' WHERE id = $1", [sid]);
    expect(await project(sid)).toBe("deleted");
    await owner("UPDATE sessions SET visibility = 'public' WHERE id = $1", [sid]);
    expect(await project(sid)).toBe("upserted");
    const lid2 = await listingId(sid);
    expect(lid2).not.toBe(lid1);
    expect(await resolveListing(lid1)).toEqual([]);
    const slug = await rotate(t, sid); // r1 SF-1: a host slug minted for the second listing
    await raise(t, sid); // a public -> private -> public flip the projector only sees afterwards
    expect(await project(sid)).toBe("rotated");
    const lid3 = await listingId(sid);
    expect(new Set([lid1, lid2, lid3]).size).toBe(3);
    // D3: the writer CAS-cleared the fence it observed, so the replaced row is served at once ...
    expect(await fenceToken(sid)).toBeNull();
    expect(await resolveListing(lid3)).toEqual([{ tenant_id: t, session_id: sid }]);
    expect(await resolveListing(lid2)).toEqual([]);
    // ... and the slug minted for the old listing resolves nothing: the rotation tombstoned it.
    expect(await resolveSlug(slug)).toEqual([]);
    const [tomb] = await owner(
      "SELECT revoked_at FROM public_session_share_slugs WHERE session_id = $1",
      [sid],
    );
    expect(tomb!.revoked_at).not.toBeNull();
  });
});

describe("PSP-11 expiry sweep, tenant candidates, the 15 routes and the disabled registry row (A-18, A-19)", () => {
  it("PSP-11a: an expired row is hidden before the sweep; the sweep deletes it and tombstones its slug", async () => {
    const t = await club();
    const sid = await session(t);
    expect(await project(sid)).toBe("upserted");
    const lid = await listingId(sid);
    const slug = await rotate(t, sid);
    await owner(
      "UPDATE public_sessions SET expires_at = now() - interval '1 minute' WHERE id = $1",
      [sid],
    );
    expect(await viewRow(lid)).toBeUndefined();
    expect(await resolveSlug(slug)).toEqual([]);
    const [swept] = await worker("SELECT public_sessions_sweep_expired(100) AS n");
    expect(Number(swept!.n)).toBeGreaterThanOrEqual(1);
    expect(await baseRow(sid)).toBeUndefined();
    const [r] = await owner(
      "SELECT revoked_at FROM public_session_share_slugs WHERE session_id = $1",
      [sid],
    );
    expect(r!.revoked_at).not.toBeNull();
  });

  it("PSP-11b: tenant candidates = the tenant's projected rows plus its open public future sessions", async () => {
    const t = await club();
    const projected = await session(t);
    expect(await project(projected)).toBe("upserted");
    const pending = await session(t);
    const gone = await session(t);
    expect(await project(gone)).toBe("upserted");
    await owner("UPDATE sessions SET visibility = 'private' WHERE id = $1", [gone]);
    await session(t, { visibility: "private" });
    await session(await club("Other"));
    const ids = (await worker("SELECT c FROM public_sessions_tenant_candidates($1) AS c", [t])).map(
      (r) => r.c,
    );
    expect([...ids].sort()).toEqual([projected, pending, gone].sort());
  });

  it("PSP-11c: exactly the 15 public_sessions routes exist and the registry row is disabled", async () => {
    const routes = await owner(
      "SELECT aggregate_type || ':' || event_type AS r FROM outbox_projector_routes WHERE projector = 'public_sessions' ORDER BY 1",
    );
    const expected = [
      ...[
        "session.published",
        "session.updated",
        "session.visibility_changed",
        "session.closed",
        "session.cancelled",
        "player.added",
        "player.waitlisted",
        "player.removed",
        "player.promoted",
        "guest_note.created",
        "guest_note.deleted",
        "join_request.approved",
      ].map((e) => `session:${e}`),
      ...[
        "tenant.public_alias_set",
        "tenant.public_alias_approved",
        "tenant.public_alias_rejected",
      ].map((e) => `tenant:${e}`),
    ].sort();
    expect(routes.map((r) => r.r as string).sort()).toEqual(expected);
    expect(
      await owner("SELECT enabled FROM outbox_projectors WHERE name = 'public_sessions'"),
    ).toEqual([{ enabled: false }]);
  });
});

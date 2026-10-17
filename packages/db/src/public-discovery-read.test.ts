import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DISCOVERY_PAGE_LIMIT_MAX,
  listDiscoveryListings,
  readDiscoveryListing,
  readDiscoveryListingByShareSlug,
  resolveDiscoveryListing,
  type DiscoveryListFilter,
  type DiscoveryListPage,
} from "./public-discovery-read.js";
import { setupRlsTestContext, type RlsTestContext } from "./test-harness.js";

// The anonymous discovery read (L10b) over the 0061 guarded view, read AS the real readonly role.
// Real PG; DATABASE_URL_TEST required. Contract:
// docs/sessions/web-mvp-phase3-readiness-p3-m9-discovery-read.md sections 4.2, 4.4, 4.5 and 6
// (rows A-1, A-2, A-3, A-4, A-15). Rows are seeded the way public-sessions-projector.test.ts
// seeds them: canonical rows as the owner, then public_sessions_project_session as app_worker.
const DB_NAME = "plexco_public_discovery_read";
const HOUR = 3_600_000;
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
const sqlState = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: unknown) => String((e as { code?: string }).code),
  );

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
];

/** One app transaction with the tenant GUC set, like withTenant. */
async function asApp<T>(tenantId: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await ctx.appPool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
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

async function club(alias = "CLB Discover"): Promise<string> {
  const [t] = await owner(
    `INSERT INTO tenants (name, slug, public_alias, public_alias_status) VALUES ($1, $2, $3, 'approved') RETURNING id`,
    [`Tenant ${randomUUID()}`, `pdr-${randomUUID()}`, alias],
  );
  return t!.id as string;
}
interface SessionSeed {
  startsAt?: Date;
  area?: string;
  price?: number;
  slotsMax?: number;
}
async function session(tenantId: string, s: SessionSeed = {}): Promise<string> {
  const [r] = await owner(
    `INSERT INTO sessions (tenant_id, sport_id, starts_at, ends_at, timezone, venue_name, venue_address, area,
       price_amount, slots_max, visibility, join_policy, status)
     VALUES ($1, $2, $3, $3::timestamptz + interval '2 hours', 'Asia/Ho_Chi_Minh', 'Venue', 'Venue', $4, $5, $6,
       'public', 'open', 'open')
     RETURNING id`,
    [
      tenantId,
      ctx.badmintonSportId,
      s.startsAt ?? new Date(Date.now() + 24 * HOUR),
      s.area ?? "Quan 7",
      s.price ?? 50000,
      s.slotsMax ?? 10,
    ],
  );
  return r!.id as string;
}
/** One active seat, so a slots_max 1 session projects slots_open 0. */
async function seat(tenantId: string, sessionId: string) {
  const [p] = await owner(`INSERT INTO persons (display_name) VALUES ('Person') RETURNING id`);
  const [m] = await owner(
    `INSERT INTO memberships (tenant_id, person_id, status) VALUES ($1, $2, 'active') RETURNING id`,
    [tenantId, p!.id],
  );
  await owner(
    `INSERT INTO players (tenant_id, session_id, membership_id, status) VALUES ($1, $2, $3, 'active')`,
    [tenantId, sessionId, m!.id],
  );
}
/** The writer, as the real app_worker seat (the projector's identity). */
const project = async (sid: string) =>
  (await ctx.workerPool.query("SELECT public_sessions_project_session($1, NULL) AS d", [sid]))
    .rows[0].d as string;
const listingId = async (sid: string) =>
  (await owner("SELECT public_listing_id FROM public_sessions WHERE id = $1", [sid]))[0]!
    .public_listing_id as string;
const rotate = (tenantId: string, sid: string) =>
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
const raiseFence = (tenantId: string, sid: string) =>
  asApp(tenantId, (c) =>
    c.query("SELECT raise_public_session_fence($1, 'visibility_private')", [sid]),
  );

const list = (f: DiscoveryListFilter) => listDiscoveryListings(ctx.readonlyPool, f);
const detail = (lid: string) => readDiscoveryListing(ctx.readonlyPool, lid);
const share = (slug: string) => readDiscoveryListingByShareSlug(ctx.readonlyPool, slug);
const resolve = (lid: string) => resolveDiscoveryListing(ctx.readonlyPool, lid);
const ids = (p: DiscoveryListPage) => p.rows.map((r) => r.public_listing_id);
/** The keyset text the list returns: UTC with microseconds (a whole-ms Date gains "000"). */
const usText = (d: Date) => d.toISOString().replace(/Z$/, "000Z");
/** A whole-second instant `h` hours from now, so a JS Date round-trips exactly. */
const at = (h: number) => new Date(Math.floor(Date.now() / 1000) * 1000 + h * HOUR);

/** A listed session with an active share slug, checked to resolve through every read. */
async function listed(tenantId: string, s: SessionSeed = {}) {
  const sid = await session(tenantId, s);
  expect(await project(sid)).toBe("upserted");
  const lid = await listingId(sid);
  const slug = await rotate(tenantId, sid);
  expect(await detail(lid)).not.toBeNull();
  expect(await share(slug)).not.toBeNull();
  expect(await resolve(lid)).toEqual({ tenantId, sessionId: sid });
  return { sid, lid, slug };
}
async function miss(lid: string | null, slug: string | null) {
  if (lid !== null) {
    expect(await detail(lid)).toBeNull();
    expect(await resolve(lid)).toBeNull();
  }
  if (slug !== null) expect(await share(slug)).toBeNull();
}

describe("PDR-1 the whitelist, read as readonly (A-1)", () => {
  it("A-1: list, detail and share return exactly the 17 view columns with golden values; resolve returns only the target", async () => {
    const area = `A1 ${randomUUID()}`;
    const startsAt = at(30);
    const t = await club("CLB Golden");
    const { sid, lid, slug } = await listed(t, { area, startsAt });
    const golden = {
      public_listing_id: lid,
      sport_key: "badminton",
      starts_at: startsAt,
      ends_at: new Date(startsAt.getTime() + 2 * HOUR),
      area,
      price_amount: 50000,
      slots_open: 10,
      club_display_name: "CLB Golden",
      join_policy: "open",
      title: null,
      session_type: null,
      level_min_rank: null,
      level_max_rank: null,
      level_strict: null,
      gender_restriction: null,
      age_min: null,
      age_max: null,
    };
    const page = await list({ area, limit: 20 });
    expect(page).toEqual({ rows: [golden], next: null });
    for (const row of [page.rows[0], await detail(lid), await share(slug)]) {
      expect(row).toEqual(golden);
      expect(Object.keys(row!)).toEqual(VIEW_COLS);
    }
    expect(await resolve(lid)).toStrictEqual({ tenantId: t, sessionId: sid });
  });
});

describe("PDR-2 no base table for readonly, no lookup for app (A-2)", () => {
  it("A-2: readonly gets 42501 on public_sessions, sessions and tenants; app gets 42501 on both lookups and every read", async () => {
    for (const rel of ["public_sessions", "sessions", "tenants"]) {
      expect(await sqlState(ctx.readonlyPool.query(`SELECT 1 FROM ${rel} LIMIT 1`))).toBe("42501");
    }
    const slug = "A".repeat(22);
    expect(
      await sqlState(ctx.appPool.query("SELECT * FROM public_listing_resolve($1)", [randomUUID()])),
    ).toBe("42501");
    expect(
      await sqlState(ctx.appPool.query("SELECT * FROM public_share_slug_resolve($1)", [slug])),
    ).toBe("42501");
    expect(await sqlState(resolveDiscoveryListing(ctx.appPool, randomUUID()))).toBe("42501");
    expect(await sqlState(readDiscoveryListingByShareSlug(ctx.appPool, slug))).toBe("42501");
    expect(await sqlState(readDiscoveryListing(ctx.appPool, randomUUID()))).toBe("42501");
    expect(await sqlState(listDiscoveryListings(ctx.appPool, { limit: 1 }))).toBe("42501");
  });
});

describe("PDR-3 every miss resolves nothing (A-3)", () => {
  it("A-3: unknown, rotated, revoked, wrong-shape, raw uuid, fenced, replaced, expired, rejected, suspended, cancelled", async () => {
    await miss(randomUUID(), "A".repeat(22));
    const t = await club();
    const a = await listed(t);
    const fresh = await rotate(t, a.sid);
    await miss(null, a.slug); // rotated away
    expect(await share(fresh)).not.toBeNull();
    expect(await revoke(t, a.sid)).toBe(true);
    await miss(null, fresh); // revoked
    for (const bad of [
      "",
      "short",
      `${fresh}x`,
      `${fresh.slice(0, 21)}!`,
      `${fresh.slice(0, 21)}${String.fromCodePoint(0x202e)}`,
      a.sid,
      a.lid,
    ]) {
      await miss(null, bad);
    }
    await miss(a.sid, null); // a raw session uuid in place of a listing id

    const b = await listed(t);
    await raiseFence(t, b.sid);
    await miss(b.lid, b.slug); // fenced: the view's anti-join
    expect(await project(b.sid)).toBe("rotated"); // the fenced recompute replaces the id
    const replaced = await listingId(b.sid);
    expect(replaced).not.toBe(b.lid);
    await miss(b.lid, b.slug);
    expect(await detail(replaced)).not.toBeNull();

    const c = await listed(t);
    await owner(
      "UPDATE public_sessions SET expires_at = now() - interval '1 minute' WHERE id = $1",
      [c.sid],
    );
    await miss(c.lid, c.slug); // expired

    for (const change of [
      "UPDATE tenants SET public_alias_status = 'rejected' WHERE id = $1",
      "UPDATE tenants SET status = 'suspended' WHERE id = $1",
      "UPDATE tenants SET status = 'cancelled' WHERE id = $1",
    ]) {
      const tx = await club();
      const d = await listed(tx);
      await owner(change, [tx]);
      await miss(d.lid, d.slug);
    }
  });
});

describe("PDR-4 keyset pages and the accepted filters (A-4)", () => {
  it("A-4: starts_at ASC then public_listing_id ASC, an equal-starts_at tie across a page boundary, the last page and each filter", async () => {
    const area = `A4 ${randomUUID()}`;
    const t = await club();
    const early = await session(t, { area, startsAt: at(24) });
    const tieA = await session(t, { area, startsAt: at(48) });
    const tieB = await session(t, { area, startsAt: at(48) });
    const late = await session(t, { area, startsAt: at(72), price: 80000, slotsMax: 1 });
    await seat(t, late); // full: slots_open 0
    for (const sid of [early, tieA, tieB, late]) expect(await project(sid)).toBe("upserted");
    const ties = [await listingId(tieA), await listingId(tieB)].sort();
    const order = [await listingId(early), ...ties, await listingId(late)];

    const p1 = await list({ area, limit: 2 });
    expect(ids(p1)).toEqual(order.slice(0, 2));
    expect(p1.next).toEqual({ startsAt: usText(at(48)), publicListingId: ties[0] });
    const p2 = await list({ area, limit: 2, after: p1.next! });
    expect(ids(p2)).toEqual(order.slice(2));
    expect(p2.next).toBeNull(); // the last page
    expect(await list({ area, limit: 4 })).toMatchObject({ next: null });
    expect((await list({ area, limit: 3 })).next).toEqual({
      startsAt: usText(at(48)),
      publicListingId: ties[1],
    });
    expect(ids(await list({ area, limit: DISCOVERY_PAGE_LIMIT_MAX }))).toEqual(order);
    for (const limit of [0, DISCOVERY_PAGE_LIMIT_MAX + 1, 1.5]) {
      await expect(list({ area, limit })).rejects.toThrow(RangeError);
    }

    const f = (extra: Partial<DiscoveryListFilter>) =>
      list({ area, limit: 50, ...extra }).then(ids);
    expect(await f({ sport: "badminton" })).toEqual(order);
    expect(await f({ sport: "zz_unknown" })).toEqual([]);
    expect(await f({ area: area.slice(0, -1) })).toEqual([]); // exact match only
    expect(await f({ startAfter: at(48) })).toEqual(order.slice(1)); // >= inclusive
    expect(await f({ startBefore: at(48) })).toEqual(order.slice(0, 1)); // < exclusive
    expect(await f({ startAfter: at(24), startBefore: at(72) })).toEqual(order.slice(0, 3));
    expect(await f({ maxPrice: 50000 })).toEqual(order.slice(0, 3)); // <= inclusive
    expect(await f({ maxPrice: 49999 })).toEqual([]);
    expect(await f({ availableOnly: true })).toEqual(order.slice(0, 3));
    expect(await f({ availableOnly: false })).toEqual(order);
  });
});

describe("PDR-5 the live alias filter (A-15)", () => {
  it("A-15: an alias rejected or edited after projection hides the listing and its slug at once, with no re-projection", async () => {
    for (const change of [
      "UPDATE tenants SET public_alias_status = 'rejected' WHERE id = $1",
      "UPDATE tenants SET public_alias = 'CLB Edited', public_alias_status = 'pending' WHERE id = $1",
    ]) {
      const area = `A15 ${randomUUID()}`;
      const t = await club("CLB Live");
      const { sid, lid, slug } = await listed(t, { area });
      expect(ids(await list({ area, limit: 20 }))).toEqual([lid]);
      await owner(change, [t]);
      expect(await list({ area, limit: 20 })).toEqual({ rows: [], next: null });
      await miss(lid, slug);
      // No projector ran: the base row is still there, the live view filter hid it.
      expect(await owner("SELECT 1 FROM public_sessions WHERE id = $1", [sid])).toHaveLength(1);
    }
  });
});

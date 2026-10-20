import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import {
  listMyClubs,
  listMyJoinRequests,
  listMySessions,
  readMyCharges,
} from "./me-player-reads.js";
import {
  seedPersonAccount,
  setupNonSuperuserOwnerContext,
  withJobDefinerLock,
  type NonSuperuserOwnerContext,
} from "./test-harness.js";

/**
 * 0059 and 0066 (CC-14) under a NOSUPERUSER NOBYPASSRLS migration owner (A-14). The rest of the
 * suite migrates as a
 * superuser, so there the definers bypass tenant RLS and isolation rests on their explicit person
 * and tenant predicates. Here FORCE RLS binds the owner too: a definer sees a tenant's rows only
 * while it has set app.tenant_id to that tenant itself. A's reads returning A's rows of BOTH clubs
 * prove the per-tenant GUC loop works without any bypass; B (same session in club one) never appears.
 */
let ns: NonSuperuserOwnerContext;
let app: pg.Pool;
// ns.superuser is connected to the BASE database (it creates/drops the throwaway one), so seeds go
// through a superuser connection INTO the owner-context database.
let su: pg.Client;

beforeAll(async () => {
  ns = await setupNonSuperuserOwnerContext("plexco_me_player_reads_nobypass");
  await withJobDefinerLock(process.env.DATABASE_URL_TEST!, async () => {
    await ns.bootstrapJobDefinerForOwner();
    await ns.bootstrapChatDefinerForOwner();
    await ns.runMigration();
  });
  app = await ns.connectAsApp();
  const url = new URL(process.env.DATABASE_URL_TEST!);
  url.pathname = `/${ns.dbName}`;
  su = new pg.Client({ connectionString: url.toString() });
  await su.connect();
}, 240_000);
afterAll(async () => {
  await su?.end();
  await ns?.teardown();
});

const FNS = [
  "account_my_clubs",
  "account_my_join_requests",
  "account_my_open_charges",
  "account_my_sessions",
];
const B_NAME = "Bee Nobypass Name";

async function insertId(sql: string, params: unknown[]): Promise<string> {
  return (await su.query<{ id: string }>(sql, params)).rows[0]!.id;
}

const seed = {} as Record<
  "t1" | "t2" | "mA1" | "mA2" | "mB1" | "s1" | "s2" | "s3" | "s4" | "jrA" | "jrB",
  string
> & { a: { accountId: string; personId: string }; b: { accountId: string; personId: string } };

beforeAll(async () => {
  const sportId = await insertId(`SELECT id FROM sports WHERE key = 'badminton'`, []);
  const club = (name: string, slug: string) =>
    insertId(`INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id`, [name, slug]);
  const member = (tenantId: string, personId: string) =>
    insertId(
      `INSERT INTO memberships (tenant_id, person_id, display_name, status)
       VALUES ($1, $2, 'Alias', 'active') RETURNING id`,
      [tenantId, personId],
    );
  const session = (tenantId: string, startsInHours: number) =>
    insertId(
      `INSERT INTO sessions (tenant_id, sport_id, starts_at, ends_at, timezone, venue_name, area, status)
       VALUES ($1, $2, now() + make_interval(hours => $3::int), now() + make_interval(hours => $3::int + 2),
               'Asia/Ho_Chi_Minh', 'Hall', 'Quan 3', 'open') RETURNING id`,
      [tenantId, sportId, startsInHours],
    );
  const seat = async (tenantId: string, sessionId: string, membershipId: string, due: number) => {
    const playerId = await insertId(
      `INSERT INTO players (tenant_id, session_id, membership_id) VALUES ($1, $2, $3) RETURNING id`,
      [tenantId, sessionId, membershipId],
    );
    await su.query(
      `INSERT INTO charges (tenant_id, session_id, player_id, amount_due) VALUES ($1, $2, $3, $4)`,
      [tenantId, sessionId, playerId, due],
    );
  };
  const request = (tenantId: string, sessionId: string, personId: string) =>
    insertId(
      `INSERT INTO join_requests (tenant_id, session_id, person_id, status, expires_at)
       VALUES ($1, $2, $3, 'pending', now() + interval '1 day') RETURNING id`,
      [tenantId, sessionId, personId],
    );

  seed.t1 = await club("L9 Club One", "l9-nb-one");
  seed.t2 = await club("L9 Club Two", "l9-nb-two");
  seed.a = await seedPersonAccount(su, "l9-nb-a", { displayName: "Ana" });
  seed.b = await seedPersonAccount(su, "l9-nb-b", { displayName: B_NAME });
  seed.mA1 = await member(seed.t1, seed.a.personId);
  seed.mA2 = await member(seed.t2, seed.a.personId);
  seed.mB1 = await member(seed.t1, seed.b.personId);
  seed.s1 = await session(seed.t1, 24);
  seed.s2 = await session(seed.t2, 26);
  seed.s3 = await session(seed.t2, 28);
  seed.s4 = await session(seed.t1, 30);
  await seat(seed.t1, seed.s1, seed.mA1, 50_000);
  await seat(seed.t1, seed.s1, seed.mB1, 77_000);
  await seat(seed.t2, seed.s2, seed.mA2, 30_000);
  seed.jrA = await request(seed.t2, seed.s3, seed.a.personId);
  seed.jrB = await request(seed.t1, seed.s4, seed.b.personId);
});

async function readAll(accountId: string) {
  return {
    clubs: await listMyClubs(app, accountId),
    sessions: await listMySessions(app, accountId),
    charges: await readMyCharges(app, accountId),
    requests: await listMyJoinRequests(app, accountId),
  };
}

const items = (r: Awaited<ReturnType<typeof readAll>>) =>
  r.charges.clubs.flatMap((c) =>
    c.status.kind === "known_amount" ? c.status.items.map((i) => [c.clubRef, i.amountDue]) : [],
  );

describe("0059 and 0066 under a NOBYPASSRLS migration owner (A-14)", () => {
  it("the premise: owner and app cannot bypass RLS, the definers are the owner's, and the owner alone reads 0 memberships", async () => {
    const roles = await su.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname IN ($1, 'app')`,
      [ns.ownerRole],
    );
    expect(roles.rows).toEqual([
      { rolsuper: false, rolbypassrls: false },
      { rolsuper: false, rolbypassrls: false },
    ]);
    const owners = await su.query(
      `SELECT p.proname, pg_get_userbyid(p.proowner) AS owner, p.prosecdef
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = ANY($1::text[]) ORDER BY p.proname`,
      [FNS],
    );
    expect(owners.rows).toEqual(
      FNS.map((proname) => ({ proname, owner: ns.ownerRole, prosecdef: true })),
    );
    const total = await su.query<{ n: number }>(`SELECT count(*)::int AS n FROM memberships`);
    expect(total.rows[0]!.n).toBe(3);
    const ownerView = await ns.ownerPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM memberships`,
    );
    expect(ownerView.rows[0]!.n).toBe(0);
  });

  it("A's four reads hold A's rows of both clubs; B, in the same session of club one, never appears", async () => {
    const r = await readAll(seed.a.accountId);
    expect(r.clubs).toEqual({
      clubs: [
        { clubRef: "l9-nb-one", clubLabel: "L9 Club One", membershipStatus: "active" },
        { clubRef: "l9-nb-two", clubLabel: "L9 Club Two", membershipStatus: "active" },
      ],
      truncated: false,
    });
    expect(r.sessions.truncated).toBe(false);
    expect(r.sessions.sessions.map((s) => [s.sessionId, s.clubRef, s.myStatus])).toEqual([
      [seed.s1, "l9-nb-one", "active"],
      [seed.s2, "l9-nb-two", "active"],
      [seed.s3, "l9-nb-two", "pending"],
    ]);
    expect(items(r)).toEqual([
      ["l9-nb-one", 50_000],
      ["l9-nb-two", 30_000],
    ]);
    expect(r.charges.summary).toMatchObject({
      kind: "known_amount",
      totalOutstanding: 80_000,
      clubCount: 2,
    });
    expect(r.requests).toEqual({
      requests: [expect.objectContaining({ requestId: seed.jrA, sessionId: seed.s3 })],
      truncated: false,
    });
    const json = JSON.stringify(r);
    for (const secret of [B_NAME, seed.b.personId, seed.b.accountId, seed.mB1, seed.jrB, seed.s4]) {
      expect(json).not.toContain(secret);
    }
  });

  it("B's four reads hold only club one; A's club two, sessions, request and charges never appear", async () => {
    const r = await readAll(seed.b.accountId);
    expect(r.clubs.clubs.map((c) => c.clubRef)).toEqual(["l9-nb-one"]);
    expect(r.sessions.sessions.map((s) => [s.sessionId, s.myStatus])).toEqual([
      [seed.s1, "active"],
      [seed.s4, "pending"],
    ]);
    expect(items(r)).toEqual([["l9-nb-one", 77_000]]);
    expect(r.charges.summary).toMatchObject({ kind: "known_amount", totalOutstanding: 77_000 });
    expect(r.requests.requests.map((q) => q.requestId)).toEqual([seed.jrB]);
    const json = JSON.stringify(r);
    for (const secret of ["l9-nb-two", seed.a.personId, seed.mA1, seed.mA2, seed.s2, seed.s3]) {
      expect(json).not.toContain(secret);
    }
  });

  it("the caller's own app.tenant_id is restored after each call inside its transaction; no tenant is left behind", async () => {
    const c = await app.connect();
    try {
      await c.query("BEGIN");
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [seed.t1]);
      const clubs = await c.query<{ club_ref: string }>(
        `SELECT club_ref FROM account_my_clubs($1::uuid) ORDER BY club_ref`,
        [seed.a.accountId],
      );
      expect(clubs.rows.map((x) => x.club_ref)).toEqual(["l9-nb-one", "l9-nb-two"]);
      for (const fn of FNS) {
        await c.query(`SELECT count(*) FROM ${fn}($1::uuid)`, [seed.a.accountId]);
        const now = await c.query<{ v: string }>(`SELECT current_setting('app.tenant_id') AS v`);
        expect(now.rows[0]!.v).toBe(seed.t1);
      }
      await c.query("ROLLBACK");

      // No pre-set tenant: after the call the caller is still scoped to no tenant at all.
      await c.query("BEGIN");
      await c.query(`SELECT count(*) FROM account_my_open_charges($1::uuid)`, [seed.a.accountId]);
      const leaked = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM memberships`);
      expect(leaked.rows[0]!.n).toBe(0);
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  });

  it("CC-14 (D14): 0066 account_club_chat_context under this owner: A's active membership is still one row, B's missing one still none", async () => {
    const tz = await su.query<{ timezone: string }>(`SELECT timezone FROM tenants WHERE id = $1`, [
      seed.t1,
    ]);
    const call = async (accountId: string, slug: string) =>
      (
        await app.query(`SELECT * FROM account_club_chat_context($1::uuid, $2::text)`, [
          accountId,
          slug,
        ])
      ).rows;
    expect(await call(seed.a.accountId, "l9-nb-one")).toEqual([
      { tenant_id: seed.t1, timezone: tz.rows[0]!.timezone },
    ]);
    // B holds no membership in club two
    expect(await call(seed.b.accountId, "l9-nb-two")).toEqual([]);
  });
});

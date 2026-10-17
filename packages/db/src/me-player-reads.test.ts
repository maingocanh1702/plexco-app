import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type pg from "pg";
import {
  OPEN_CHARGES_CAP,
  REQUESTS_CAP,
  SESSIONS_CAP,
  listMyClubs,
  listMyJoinRequests,
  listMySessions,
  readMyCharges,
} from "./me-player-reads.js";
import { chargeRemaining } from "./payment-manual.js";
import { seedPersonAccount, setupRlsTestContext, type RlsTestContext } from "./test-harness.js";

/**
 * Real-Postgres tests for 0059 (Phase 3 lane L9): the signed-in player's own cross-club reads.
 * Runtime calls go through ctx.appPool (role `app`, NOBYPASSRLS); seeds and catalog inspection go
 * through ctx.owner. This suite migrates as a superuser, so the definers bypass tenant RLS here and
 * isolation rests on their explicit person and tenant predicates; me-player-reads-nobypass.test.ts
 * proves the per-tenant app.tenant_id loop under a NOSUPERUSER NOBYPASSRLS owner (A-14).
 */
let ctx: RlsTestContext;
let sportKey: string;

beforeAll(async () => {
  ctx = await setupRlsTestContext("plexco_me_player_reads");
  const sport = await ctx.owner.query<{ key: string }>(`SELECT key FROM sports WHERE id = $1`, [
    ctx.badmintonSportId,
  ]);
  sportKey = sport.rows[0]!.key;
}, 180_000);
afterAll(async () => {
  await ctx?.teardown();
});

const FNS = [
  "account_my_clubs",
  "account_my_join_requests",
  "account_my_open_charges",
  "account_my_sessions",
];
// Seeded on persons, memberships and sessions; none may ever reach a DTO (A-9).
const B_NAME = "Bee Secret Name";
const ALIAS = "Alias Secret";
const PHONE_HASH = "phone-hash-secret";
const VENUE = "Secret Venue Hall";
const ADDRESS = "77 Secret Street";
const AREA = "Quan 1";
const payCodes: string[] = [];

async function insertId(sql: string, params: unknown[]): Promise<string> {
  return (await ctx.owner.query<{ id: string }>(sql, params)).rows[0]!.id;
}

async function club(name: string): Promise<{ id: string; slug: string }> {
  const slug = `l9-${randomUUID()}`;
  const sql = `INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id`;
  return { id: await insertId(sql, [name, slug]), slug };
}

async function person(name: string): Promise<{ accountId: string; personId: string }> {
  const p = await seedPersonAccount(ctx.owner, randomUUID(), { displayName: name });
  await ctx.owner.query(`UPDATE persons SET phone_enc = $2, phone_lookup_hash = $3 WHERE id = $1`, [
    p.personId,
    Buffer.from("0900000001"),
    `${PHONE_HASH}-${p.personId}`,
  ]);
  return p;
}

async function member(tenantId: string, personId: string, status = "active"): Promise<string> {
  const payCode = `PS${randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`;
  payCodes.push(payCode);
  return insertId(
    `INSERT INTO memberships (tenant_id, person_id, display_name, pay_code, status)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [tenantId, personId, ALIAS, payCode, status],
  );
}

/** Starts `startsInHours` from now and lasts two hours. */
function session(tenantId: string, startsInHours = 24, status = "open"): Promise<string> {
  return insertId(
    `INSERT INTO sessions
       (tenant_id, sport_id, starts_at, ends_at, timezone, venue_name, venue_address, area, status)
     VALUES ($1, $2, now() + make_interval(hours => $3::int), now() + make_interval(hours => $3::int + 2),
             'Asia/Ho_Chi_Minh', $4, $5, $6, $7) RETURNING id`,
    [tenantId, ctx.badmintonSportId, startsInHours, VENUE, ADDRESS, AREA, status],
  );
}

function player(
  tenantId: string,
  sessionId: string,
  membershipId: string,
  status = "active",
  position: number | null = null,
): Promise<string> {
  return insertId(
    `INSERT INTO players (tenant_id, session_id, membership_id, status, waitlist_position)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [tenantId, sessionId, membershipId, status, position],
  );
}

function charge(
  tenantId: string,
  sessionId: string,
  playerId: string,
  due: number,
  allocated = 0,
  status = "open",
): Promise<string> {
  return insertId(
    `INSERT INTO charges (tenant_id, session_id, player_id, amount_due, amount_allocated, status)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [tenantId, sessionId, playerId, due, allocated, status],
  );
}

/** A new session with an active seat for the membership and an open charge of `due`. */
async function seat(tenantId: string, membershipId: string, due: number, startsInHours = 24) {
  const s = await session(tenantId, startsInHours);
  await charge(tenantId, s, await player(tenantId, s, membershipId), due);
  return s;
}

/** `n` open sessions starting 1..n hours from now, each seating the membership (+ a 1 000 charge). */
async function bulkSeats(tenantId: string, membershipId: string, n: number, charged: boolean) {
  await ctx.owner.query(
    `WITH s AS (
       INSERT INTO sessions (tenant_id, sport_id, starts_at, ends_at, timezone, status)
       SELECT $1::uuid, $2::uuid, now() + make_interval(hours => g), now() + make_interval(hours => g + 1),
              'Asia/Ho_Chi_Minh', 'open'
         FROM generate_series(1, $4::int) g
       RETURNING id),
     p AS (
       INSERT INTO players (tenant_id, session_id, membership_id)
       SELECT $1::uuid, s.id, $3::uuid FROM s
       RETURNING id, session_id)
     INSERT INTO charges (tenant_id, session_id, player_id, amount_due)
     SELECT $1::uuid, p.session_id, p.id, 1000 FROM p WHERE $5::boolean`,
    [tenantId, ctx.badmintonSportId, membershipId, n, charged],
  );
}

async function allocate(tenantId: string, chargeId: string, amount: number): Promise<void> {
  await ctx.owner.query(
    `INSERT INTO payment_allocations (tenant_id, charge_id, amount, source, created_by)
     VALUES ($1, $2, $3, 'cash', $4)`,
    [tenantId, chargeId, amount, randomUUID()],
  );
}

function joinRequest(
  tenantId: string,
  sessionId: string,
  personId: string,
  status = "pending",
  minutesAgo = 0,
): Promise<string> {
  return insertId(
    `INSERT INTO join_requests (tenant_id, session_id, person_id, status, expires_at, decided_at, created_at)
     VALUES ($1, $2, $3, $4::text, now() + interval '1 day',
             CASE WHEN $4::text IN ('approved', 'rejected') THEN now() END,
             now() - make_interval(mins => $5::int))
     RETURNING id`,
    [tenantId, sessionId, personId, status, minutesAgo],
  );
}

async function readAll(accountId: string) {
  return {
    clubs: await listMyClubs(ctx.appPool, accountId),
    sessions: await listMySessions(ctx.appPool, accountId),
    charges: await readMyCharges(ctx.appPool, accountId),
    requests: await listMyJoinRequests(ctx.appPool, accountId),
  };
}
const keys = (o: object) => Object.keys(o).sort();
const unknown = (reasonCode: string, retryable = false) => ({
  kind: "unknown",
  reasonCode,
  retryable,
});
const zero = { kind: "known_zero", currency: "VND", asOf: expect.any(String) };

describe("0059 catalog (A-12, A-13, M-5)", () => {
  it("A-12: four SECURITY DEFINER plpgsql VOLATILE functions, one uuid argument, pinned search_path, owned like person_profile_read", async () => {
    const { rows } = await ctx.owner.query(
      `SELECT p.proname, p.prosecdef, p.provolatile, p.proconfig, l.lanname,
              pg_get_function_identity_arguments(p.oid) AS args, pg_get_userbyid(p.proowner) AS owner
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         JOIN pg_language l ON l.oid = p.prolang
        WHERE n.nspname = 'public' AND p.proname = ANY($1::text[])
        ORDER BY p.proname`,
      [FNS],
    );
    const ref = await ctx.owner.query<{ owner: string }>(
      `SELECT pg_get_userbyid(proowner) AS owner FROM pg_proc WHERE proname = 'person_profile_read'`,
    );
    expect(rows.map((r) => r.proname)).toEqual(FNS);
    for (const r of rows) {
      expect(r, r.proname).toMatchObject({
        prosecdef: true,
        provolatile: "v",
        lanname: "plpgsql",
        args: "p_account_id uuid",
        owner: ref.rows[0]!.owner,
        proconfig: ["search_path=pg_catalog, public, pg_temp"],
      });
    }
  });

  it("A-13: EXECUTE is revoked from PUBLIC and held by exactly the owner and app (no app_worker, readonly or other role)", async () => {
    for (const fn of FNS) {
      const { rows } = await ctx.owner.query<{ owner: string; execute_grantees: string[] }>(
        `SELECT has_function_privilege('app', $1::text, 'EXECUTE') AS app,
                has_function_privilege('app_worker', $1::text, 'EXECUTE') AS worker,
                has_function_privilege('readonly', $1::text, 'EXECUTE') AS ro,
                p.proacl IS NOT NULL AS explicit_acl,
                EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0) AS public_grant,
                pg_get_userbyid(p.proowner)::text AS owner,
                ARRAY(SELECT (CASE WHEN a.grantee = 0 THEN 'PUBLIC'
                                   ELSE pg_get_userbyid(a.grantee) END)::text
                        FROM aclexplode(p.proacl) a
                       WHERE a.privilege_type = 'EXECUTE') AS execute_grantees
           FROM pg_proc p WHERE p.oid = $1::text::regprocedure`,
        [`public.${fn}(uuid)`],
      );
      const { owner, execute_grantees: grantees, ...flags } = rows[0]!;
      // the exact grantee set, owner derived from proowner: a stray GRANT EXECUTE to any role fails
      expect([...grantees].sort(), fn).toEqual([owner, "app"].sort());
      expect(flags, fn).toEqual({
        app: true,
        worker: false,
        ro: false,
        explicit_acl: true,
        public_grant: false,
      });
    }
  });

  it("M-5: each capped definer's per-tenant SQL LIMIT is its TypeScript cap + 1, so raising one side alone fails here", async () => {
    const caps: Record<string, number> = {
      account_my_sessions: SESSIONS_CAP,
      account_my_open_charges: OPEN_CHARGES_CAP,
      account_my_join_requests: REQUESTS_CAP,
    };
    for (const [fn, cap] of Object.entries(caps)) {
      const { rows } = await ctx.owner.query<{ def: string }>(
        `SELECT pg_get_functiondef($1::text::regprocedure) AS def`,
        [`public.${fn}(uuid)`],
      );
      const limits = [...rows[0]!.def.matchAll(/\bLIMIT\s+(\d+)/gi)].map((m) => Number(m[1]));
      expect(limits, fn).toEqual([cap + 1]);
    }
  });
});

describe("isolation (A-1, A-2)", () => {
  it("A-1: A and B in one session: A's four reads hold only A's rows; B's request, charge and name never appear", async () => {
    const t = await club("Club One");
    const a = await person("Alice One");
    const b = await person(B_NAME);
    const ma = await member(t.id, a.personId);
    const mb = await member(t.id, b.personId);
    const s1 = await session(t.id, 10);
    const s2 = await session(t.id, 20);
    await charge(t.id, s1, await player(t.id, s1, ma), 100_000);
    await charge(t.id, s1, await player(t.id, s1, mb), 70_000);
    await joinRequest(t.id, s2, b.personId);

    const mine = await readAll(a.accountId);
    expect(mine.clubs).toEqual({
      clubs: [{ clubRef: t.slug, clubLabel: "Club One", membershipStatus: "active" }],
      truncated: false,
    });
    expect(mine.sessions.sessions.map((s) => [s.sessionId, s.myStatus])).toEqual([[s1, "active"]]);
    expect(mine.requests).toEqual({ requests: [], truncated: false });
    expect(mine.charges.clubs).toHaveLength(1);
    expect(mine.charges.clubs[0]!.status).toMatchObject({
      kind: "known_amount",
      totalOutstanding: 100_000,
      chargeCount: 1,
    });
    expect(mine.charges.summary).toMatchObject({ totalOutstanding: 100_000, clubCount: 1 });
    expect(JSON.stringify(mine)).not.toContain(B_NAME);

    const theirs = await readAll(b.accountId);
    expect(theirs.requests.requests.map((r) => r.sessionId)).toEqual([s2]);
    expect(theirs.sessions.sessions.map((s) => [s.sessionId, s.myStatus])).toEqual([
      [s1, "active"],
      [s2, "pending"],
    ]);
    expect(theirs.charges.summary).toMatchObject({
      kind: "known_amount",
      totalOutstanding: 70_000,
    });
  });

  it("A-2: only the caller's own tenants appear in every read", async () => {
    const t1 = await club("Two A");
    const t2 = await club("Two B");
    const t3 = await club("Two C");
    const a = await person("Alice Two");
    const c = await person("Carol Two");
    const seeds: [string, string, string][] = [
      [t1.id, await member(t1.id, a.personId), a.personId],
      [t2.id, await member(t2.id, a.personId), a.personId],
      [t3.id, await member(t3.id, c.personId), c.personId],
    ];
    for (const [tenantId, membershipId, personId] of seeds) {
      await seat(tenantId, membershipId, 50_000, 10);
      await joinRequest(tenantId, await session(tenantId, 30), personId);
    }
    const mine = await readAll(a.accountId);
    const refs = [
      ...mine.clubs.clubs.map((x) => x.clubRef),
      ...mine.sessions.sessions.map((x) => x.clubRef),
      ...mine.requests.requests.map((x) => x.clubRef),
      ...mine.charges.clubs.map((x) => x.clubRef),
    ];
    expect(refs).toHaveLength(2 + 4 + 2 + 2);
    expect(new Set(refs)).toEqual(new Set([t1.slug, t2.slug]));
    expect(mine.charges.summary).toMatchObject({ totalOutstanding: 100_000, clubCount: 2 });
  });
});

describe("sessions and requests (A-3, M-3, M-4, M-5)", () => {
  it("A-3: venue only when active; waitlisted area + position; pending area only; left, ended, draft, closed, cancelled absent", async () => {
    const t = await club("Three");
    const a = await person("Alice Three");
    const m = await member(t.id, a.personId);
    const live = await session(t.id, -1); // started an hour ago, still running (M-3)
    const s1 = await session(t.id, 1);
    const s2 = await session(t.id, 2);
    const s3 = await session(t.id, 3);
    const s4 = await session(t.id, 4);
    const s5 = await session(t.id, 6);
    await player(t.id, live, m);
    await player(t.id, s1, m);
    await player(t.id, s2, m, "waitlisted", 3);
    await joinRequest(t.id, s3, a.personId);
    await player(t.id, s4, m, "left");
    await player(t.id, s5, m); // a players row wins over a pending request on the same session
    await joinRequest(t.id, s5, a.personId);
    for (const status of ["draft", "closed", "cancelled"]) {
      await player(t.id, await session(t.id, 5, status), m);
    }
    await player(t.id, await session(t.id, -5), m); // ended

    const row = (sessionId: string, myStatus: string, position: number | null, venue: boolean) => ({
      sessionId,
      clubRef: t.slug,
      clubLabel: "Three",
      sportKey,
      startsAt: expect.any(String),
      endsAt: expect.any(String),
      timezone: "Asia/Ho_Chi_Minh",
      area: AREA,
      myStatus,
      waitlistPosition: position,
      venueName: venue ? VENUE : null,
      venueAddress: venue ? ADDRESS : null,
    });
    expect(await listMySessions(ctx.appPool, a.accountId)).toEqual({
      sessions: [
        row(live, "active", null, true),
        row(s1, "active", null, true),
        row(s2, "waitlisted", 3, false),
        row(s3, "pending", null, false),
        row(s5, "active", null, true),
      ],
      truncated: false,
    });
  });

  it("M-4: own requests pending, approved, rejected on sessions not ended, newest first; expired, cancelled, ended absent", async () => {
    const t = await club("Requests");
    const a = await person("Alice Four");
    const pending = await joinRequest(t.id, await session(t.id), a.personId, "pending", 1);
    const approved = await joinRequest(t.id, await session(t.id), a.personId, "approved", 2);
    const rejected = await joinRequest(t.id, await session(t.id), a.personId, "rejected", 3);
    await joinRequest(t.id, await session(t.id), a.personId, "expired", 4);
    await joinRequest(t.id, await session(t.id), a.personId, "cancelled", 5);
    await joinRequest(t.id, await session(t.id, -5), a.personId, "approved", 6);
    const { requests, truncated } = await listMyJoinRequests(ctx.appPool, a.accountId);
    expect(truncated).toBe(false);
    expect(requests.map((r) => [r.requestId, r.status, r.decidedAt === null])).toEqual([
      [pending, "pending", true],
      [approved, "approved", false],
      [rejected, "rejected", false],
    ]);
    expect(requests[0]).toMatchObject({ clubRef: t.slug, clubLabel: "Requests", area: AREA });
  });

  it("M-5: sessions past the cap of 50 are cut to the first 50 by start time and flagged truncated", async () => {
    const t = await club("Five Cap");
    const a = await person("Alice Cap");
    await bulkSeats(t.id, await member(t.id, a.personId), 51, false);
    const { sessions, truncated } = await listMySessions(ctx.appPool, a.accountId);
    expect(truncated).toBe(true);
    expect(sessions).toHaveLength(50);
    const starts = sessions.map((s) => s.startsAt);
    expect([...starts].sort()).toEqual(starts);
  });
});

describe("own money (A-4 .. A-8)", () => {
  it("A-4: open and partial come back with amountDue, amountAllocated and chargeRemaining; paid, void and B's do not", async () => {
    const t = await club("Four");
    const a = await person("Alice Five");
    const b = await person(B_NAME);
    const m = await member(t.id, a.personId);
    const mb = await member(t.id, b.personId);
    const sOpen = await session(t.id, 1);
    await charge(t.id, sOpen, await player(t.id, sOpen, m), 100_000);
    await charge(t.id, sOpen, await player(t.id, sOpen, mb), 90_000);
    const sPartial = await session(t.id, 2);
    const partial = await charge(
      t.id,
      sPartial,
      await player(t.id, sPartial, m),
      100_000,
      40_000,
      "partial",
    );
    await allocate(t.id, partial, 40_000);
    const sPaid = await session(t.id, 3);
    const paid = await charge(t.id, sPaid, await player(t.id, sPaid, m), 50_000, 50_000, "paid");
    await allocate(t.id, paid, 50_000);
    const sVoid = await session(t.id, 4);
    await charge(t.id, sVoid, await player(t.id, sVoid, m), 80_000, 0, "void");

    const item = (
      sessionRef: string,
      due: number,
      allocated: number,
      status: "open" | "partial",
    ) => ({
      sessionRef,
      startsAt: expect.any(String),
      amountDue: due,
      amountAllocated: allocated,
      remaining: chargeRemaining(due, allocated, status),
      status,
    });
    expect(await readMyCharges(ctx.appPool, a.accountId)).toEqual({
      clubs: [
        {
          clubRef: t.slug,
          clubLabel: "Four",
          status: {
            kind: "known_amount",
            currency: "VND",
            totalOutstanding: 160_000,
            chargeCount: 2,
            items: [item(sOpen, 100_000, 0, "open"), item(sPartial, 100_000, 40_000, "partial")],
            asOf: expect.any(String),
          },
        },
      ],
      summary: {
        kind: "known_amount",
        currency: "VND",
        totalOutstanding: 160_000,
        clubCount: 1,
        asOf: expect.any(String),
      },
    });
  });

  it("A-5: a drifted ledger or a status the ledger contradicts makes that club unknown, and the summary unknown with no partial total", async () => {
    const t1 = await club("Five A");
    const t2 = await club("Five B");
    const t3 = await club("Five C");
    const a = await person("Alice Six");
    await seat(t1.id, await member(t1.id, a.personId), 100_000);
    const s2 = await session(t2.id);
    const p2 = await player(t2.id, s2, await member(t2.id, a.personId));
    // ledger SUM 20 000 <> stored amount_allocated 30 000 (allocation not intact, BE edge #15)
    await allocate(t2.id, await charge(t2.id, s2, p2, 100_000, 30_000, "partial"), 20_000);
    const s3 = await session(t3.id);
    const p3 = await player(t3.id, s3, await member(t3.id, a.personId));
    // amounts agree, but 20 000 of 100 000 is "partial" while the row says "open"
    await allocate(t3.id, await charge(t3.id, s3, p3, 100_000, 20_000, "open"), 20_000);

    const r = await readMyCharges(ctx.appPool, a.accountId);
    expect(r.clubs.map((c) => [c.clubRef, c.status.kind])).toEqual([
      [t1.slug, "known_amount"],
      [t2.slug, "unknown"],
      [t3.slug, "unknown"],
    ]);
    expect(r.clubs[1]!.status).toEqual(unknown("LEDGER_INCONSISTENT"));
    expect(r.summary).toEqual(unknown("LEDGER_INCONSISTENT"));
  });

  it("A-6: every club known_zero gives a known_zero summary", async () => {
    const t1 = await club("Six A");
    const t2 = await club("Six B");
    const a = await person("Alice Seven");
    await member(t1.id, a.personId);
    await member(t2.id, a.personId, "guest");
    expect(await readMyCharges(ctx.appPool, a.accountId)).toEqual({
      clubs: [
        { clubRef: t1.slug, clubLabel: "Six A", status: zero },
        { clubRef: t2.slug, clubLabel: "Six B", status: zero },
      ],
      summary: zero,
    });
  });

  it("A-6: a failed read is unknown READ_FAILED (retryable), rolled back, and the client is discarded", async () => {
    const release = vi.fn();
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith("SELECT")) throw new Error("connection reset");
      return { rows: [] };
    });
    const pool = { connect: async () => ({ query, release }) } as unknown as pg.Pool;
    expect(await readMyCharges(pool, randomUUID())).toEqual({
      clubs: [],
      summary: unknown("READ_FAILED", true),
    });
    expect(query).toHaveBeenCalledWith("ROLLBACK");
    expect(release).toHaveBeenCalledWith(true);
  });

  it("A-6: more than 200 open charges is unknown TOO_MANY_OPEN_CHARGES, never a partial sum", async () => {
    const t = await club("Six C");
    const a = await person("Alice Eight");
    await bulkSeats(t.id, await member(t.id, a.personId), 201, true);
    expect(await readMyCharges(ctx.appPool, a.accountId)).toEqual({
      clubs: [],
      summary: unknown("TOO_MANY_OPEN_CHARGES"),
    });
  });

  it("A-7: no person, a merged person, a person with no membership and an unknown account read as empty and known_zero", async () => {
    const t = await club("Seven");
    const noPerson = await insertId(
      `INSERT INTO accounts (person_id) VALUES (NULL) RETURNING id`,
      [],
    );
    const merged = await person("Merged Mia");
    const survivor = await person("Survivor");
    await seat(t.id, await member(t.id, merged.personId), 40_000);
    await joinRequest(t.id, await session(t.id), merged.personId);
    await ctx.owner.query(
      `UPDATE persons SET status = 'merged', merged_into_person_id = $2 WHERE id = $1`,
      [merged.personId, survivor.personId],
    );
    const lonely = await person("Lonely");
    for (const accountId of [noPerson, merged.accountId, lonely.accountId, randomUUID()]) {
      expect(await readAll(accountId)).toEqual({
        clubs: { clubs: [], truncated: false },
        sessions: { sessions: [], truncated: false },
        charges: { clubs: [], summary: zero },
        requests: { requests: [], truncated: false },
      });
    }
  });

  it("A-8: left and merged memberships are not clubs or sessions, but their open charges still count (M-2)", async () => {
    const t4 = await club("Eight Left");
    const t5 = await club("Eight Merged");
    const a = await person("Alice Nine");
    await seat(t4.id, await member(t4.id, a.personId, "left"), 30_000);
    await seat(t5.id, await member(t5.id, a.personId, "merged"), 20_000);
    expect(await listMyClubs(ctx.appPool, a.accountId)).toEqual({ clubs: [], truncated: false });
    expect(await listMySessions(ctx.appPool, a.accountId)).toEqual({
      sessions: [],
      truncated: false,
    });
    const r = await readMyCharges(ctx.appPool, a.accountId);
    expect(r.clubs.map((c) => [c.clubRef, c.status.kind])).toEqual([
      [t4.slug, "known_amount"],
      [t5.slug, "known_amount"],
    ]);
    expect(r.summary).toMatchObject({
      kind: "known_amount",
      totalOutstanding: 50_000,
      clubCount: 2,
    });
  });
});

describe("DTO allowlist (A-9)", () => {
  it("A-9: exact key sets; no phone, pay code, alias, internal id or other person's name in any read", async () => {
    const t = await club("Nine");
    const a = await person("Alice Ten");
    const b = await person(B_NAME);
    const m = await member(t.id, a.personId);
    const mb = await member(t.id, b.personId);
    const s = await seat(t.id, m, 10_000, 1);
    await charge(t.id, s, await player(t.id, s, mb), 10_000);
    await joinRequest(t.id, await session(t.id, 2), a.personId);

    const all = await readAll(a.accountId);
    expect(keys(all.clubs)).toEqual(["clubs", "truncated"]);
    expect(keys(all.clubs.clubs[0]!)).toEqual(["clubLabel", "clubRef", "membershipStatus"]);
    expect(keys(all.sessions)).toEqual(["sessions", "truncated"]);
    expect(all.sessions.sessions).toHaveLength(2);
    for (const row of all.sessions.sessions) {
      expect(keys(row)).toEqual([
        "area",
        "clubLabel",
        "clubRef",
        "endsAt",
        "myStatus",
        "sessionId",
        "sportKey",
        "startsAt",
        "timezone",
        "venueAddress",
        "venueName",
        "waitlistPosition",
      ]);
    }
    expect(keys(all.requests)).toEqual(["requests", "truncated"]);
    expect(keys(all.requests.requests[0]!)).toEqual([
      "area",
      "clubLabel",
      "clubRef",
      "createdAt",
      "decidedAt",
      "expiresAt",
      "requestId",
      "sessionId",
      "startsAt",
      "status",
    ]);
    expect(keys(all.charges)).toEqual(["clubs", "summary"]);
    expect(keys(all.charges.clubs[0]!)).toEqual(["clubLabel", "clubRef", "status"]);
    const status = all.charges.clubs[0]!.status;
    if (status.kind !== "known_amount")
      throw new Error(`expected known_amount, got ${status.kind}`);
    expect(keys(status)).toEqual([
      "asOf",
      "chargeCount",
      "currency",
      "items",
      "kind",
      "totalOutstanding",
    ]);
    expect(keys(status.items[0]!)).toEqual([
      "amountAllocated",
      "amountDue",
      "remaining",
      "sessionRef",
      "startsAt",
      "status",
    ]);
    expect(keys(all.charges.summary)).toEqual([
      "asOf",
      "clubCount",
      "currency",
      "kind",
      "totalOutstanding",
    ]);
    const wire = JSON.stringify(all);
    const secrets = [B_NAME, "Alice Ten", ALIAS, PHONE_HASH, ...payCodes];
    for (const secret of [...secrets, a.personId, b.personId, a.accountId, t.id, m, mb]) {
      expect(wire).not.toContain(secret);
    }
    expect(wire).not.toMatch(/phone|email|pay_?code|gender|personId|tenantId|membershipId/i);
  });
});

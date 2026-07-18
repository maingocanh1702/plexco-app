import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { withTenant } from "./tenant.js";
import {
  expectErrorChainToMatch,
  setupRlsTestContext,
  type RlsTestContext,
} from "./test-harness.js";

/**
 * DD-45 waitlist DDL invariants (migration 0014).
 *
 * These assert the DATABASE half of the contract only — the half that must hold
 * even when a future service has a bug. Promotion BEHAVIOUR (first-activation
 * derive + exactly-one-charge; DD-49 carry-or-append-at-activation;
 * skip-on-ineligible; fill-available) is deliberately NOT tested here: no
 * SessionService, deriveChargeAmount (DD-39), evaluateSessionEligibility
 * (DD-41), DD-42 restriction source, evaluateJoinRestriction (DD-52),
 * waitlist-entry version or root promotion-retry sweep worker exists yet. 0014 is
 * expand-only with the code dark. See docs/dd-45-waitlist-analysis.md §3.
 *
 * Most assertions run on the OWNER connection: a CHECK constraint binds
 * superusers too, so proving it there proves it for every role. The grant/RLS
 * block at the bottom is the deliberate exception — it runs as the real `app`
 * role through withTenant, because 0013's header records how an owner-only
 * suite masked a missing grant on a newly added column. Owner-only coverage of
 * a new column is exactly that blind spot.
 */

let ctx: RlsTestContext;
let sessionId: string;
let membershipIds: string[] = [];

beforeAll(async () => {
  ctx = await setupRlsTestContext("plexco_waitlist_check");

  const session = await ctx.owner.query(
    `INSERT INTO sessions (tenant_id, sport_id, starts_at, ends_at, timezone, slots_max, status)
     VALUES ($1, $2, now() + interval '1 day', now() + interval '1 day 2 hours',
             'Asia/Ho_Chi_Minh', 4, 'open')
     RETURNING id`,
    [ctx.tenantA, ctx.badmintonSportId],
  );
  sessionId = (session.rows[0] as { id: string }).id;

  // Six people/memberships to draw roster + queue rows from. UNIQUE
  // (tenant_id, session_id, membership_id) means each test needs a distinct
  // membership per player row.
  const persons = await ctx.owner.query(
    `INSERT INTO persons (display_name)
     SELECT 'Waitlist Test ' || g FROM generate_series(1, 6) g
     RETURNING id`,
  );
  const memberships = await ctx.owner.query(
    `INSERT INTO memberships (tenant_id, person_id, display_name)
     SELECT $1, id, 'M-' || left(id::text, 4) FROM unnest($2::uuid[]) AS id
     RETURNING id`,
    [ctx.tenantA, persons.rows.map((r: { id: string }) => r.id)],
  );
  membershipIds = memberships.rows.map((r: { id: string }) => r.id);
}, 120_000);

afterAll(async () => {
  await ctx?.teardown();
});

// Every test starts from an empty roster — the UNIQUE membership constraint
// makes leftover rows from a previous test a false failure.
beforeEach(async () => {
  await ctx.owner.query(`DELETE FROM players WHERE session_id = $1`, [sessionId]);
});

/** Insert one player row; returns the pg promise so callers can assert reject. */
function insertPlayer(
  membershipIdx: number,
  status: string,
  waitlistPosition: number | null,
  joinedAt?: string,
) {
  return ctx.owner.query(
    `INSERT INTO players (tenant_id, session_id, membership_id, status, waitlist_position, joined_at)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, now()))
     RETURNING id`,
    [
      ctx.tenantA,
      sessionId,
      membershipIds[membershipIdx],
      status,
      waitlistPosition,
      joinedAt ?? null,
    ],
  );
}

describe("migration baseline", () => {
  // The migration COUNT is asserted once, in rls-invariants.test.ts. Duplicating
  // it here would mean every future migration has to edit two files.
  it("0014 is applied", () => {
    expect(ctx.migrateResult.applied).toContain("0014_players_waitlist.sql");
  });
});

describe("players.status domain (DD-45)", () => {
  it("accepts the three canonical statuses", async () => {
    await expect(insertPlayer(0, "active", null)).resolves.toBeTruthy();
    await expect(insertPlayer(1, "left", null)).resolves.toBeTruthy();
    await expect(insertPlayer(2, "waitlisted", 1)).resolves.toBeTruthy();
  });

  it("still rejects a status outside the domain", async () => {
    await expect(insertPlayer(0, "pending", null)).rejects.toThrow(/players_status_chk/);
  });

  it("the live constraint carries the name schema.ts declares", async () => {
    const { rows } = await ctx.owner.query(
      `SELECT conname FROM pg_constraint
       WHERE conrelid = 'players'::regclass AND contype = 'c'
       ORDER BY conname`,
    );
    const names = rows.map((r: { conname: string }) => r.conname);
    // 0002 declared the CHECK inline/unnamed, so Postgres auto-named it
    // players_status_check. 0014 drops that and installs the schema.ts name.
    expect(names).toContain("players_status_chk");
    expect(names).not.toContain("players_status_check");
    expect(names).toContain("players_waitlist_shape_chk");
    expect(names).toContain("players_waitlist_position_positive_chk");
  });
});

describe("state-shape invariant: waitlisted <=> has position", () => {
  it("rejects waitlisted WITHOUT a position", async () => {
    await expect(insertPlayer(0, "waitlisted", null)).rejects.toThrow(/players_waitlist_shape_chk/);
  });

  it("rejects active KEEPING a stale position", async () => {
    await expect(insertPlayer(0, "active", 3)).rejects.toThrow(/players_waitlist_shape_chk/);
  });

  it("rejects left KEEPING a stale position", async () => {
    await expect(insertPlayer(0, "left", 3)).rejects.toThrow(/players_waitlist_shape_chk/);
  });

  it("rejects a promotion that flips status but forgets to clear the position", async () => {
    await insertPlayer(0, "waitlisted", 1);
    await expect(
      ctx.owner.query(
        `UPDATE players SET status = 'active' WHERE session_id = $1 AND status = 'waitlisted'`,
        [sessionId],
      ),
    ).rejects.toThrow(/players_waitlist_shape_chk/);
  });

  it("accepts the correct promotion: status and position change together", async () => {
    await insertPlayer(0, "waitlisted", 1);
    await expect(
      ctx.owner.query(
        `UPDATE players SET status = 'active', waitlist_position = NULL
         WHERE session_id = $1 AND status = 'waitlisted'`,
        [sessionId],
      ),
    ).resolves.toBeTruthy();
  });

  it("accepts a waitlisted leave: status and position change together", async () => {
    await insertPlayer(0, "waitlisted", 1);
    await expect(
      ctx.owner.query(
        `UPDATE players SET status = 'left', waitlist_position = NULL
         WHERE session_id = $1 AND status = 'waitlisted'`,
        [sessionId],
      ),
    ).resolves.toBeTruthy();
  });
});

describe("position is a POSITIVE tail rank", () => {
  it("rejects position 0", async () => {
    await expect(insertPlayer(0, "waitlisted", 0)).rejects.toThrow(
      /players_waitlist_position_positive_chk/,
    );
  });

  it("rejects a negative position", async () => {
    await expect(insertPlayer(0, "waitlisted", -1)).rejects.toThrow(
      /players_waitlist_position_positive_chk/,
    );
  });
});

describe("queue total order (waitlist_position, joined_at, id)", () => {
  it("orders by position first, then joined_at", async () => {
    // Gaps are expected (no rank 2 here): tail assignment is max+1 and DD-42
    // deprioritize moves candidates to the tail, so ranks are non-contiguous.
    await insertPlayer(0, "waitlisted", 4, "2026-07-01T10:00:00Z");
    await insertPlayer(1, "waitlisted", 1, "2026-07-01T12:00:00Z");
    await insertPlayer(2, "waitlisted", 3, "2026-07-01T09:00:00Z");
    // Non-waitlisted rows must never appear in the queue read.
    await insertPlayer(3, "active", null);
    await insertPlayer(4, "left", null);

    const { rows } = await ctx.owner.query(
      `SELECT waitlist_position FROM players
       WHERE session_id = $1 AND status = 'waitlisted'
       ORDER BY waitlist_position, joined_at, id`,
      [sessionId],
    );

    expect(rows).toHaveLength(3);
    // Ordered by rank, NOT by joined_at — rank 1 joined last (12:00) and still leads.
    expect(rows.map((r: { waitlist_position: number }) => r.waitlist_position)).toEqual([1, 3, 4]);
  });

  it("resolves a full (position, joined_at) tie by id — the third order key", async () => {
    // The documented total order is (waitlist_position, joined_at, id) and the
    // index carries id as its fifth column. Only a row pair tied on BOTH of the
    // first two keys actually exercises that third key.
    const shared = "2026-07-01T08:00:00Z";
    const a = await insertPlayer(0, "waitlisted", 2, shared);
    const b = await insertPlayer(1, "waitlisted", 2, shared);
    const ids = [a.rows[0].id as string, b.rows[0].id as string];

    const { rows } = await ctx.owner.query(
      `SELECT id FROM players
       WHERE session_id = $1 AND status = 'waitlisted'
       ORDER BY waitlist_position, joined_at, id`,
      [sessionId],
    );

    // Deterministic and total: whichever uuid sorts lower is promoted first,
    // and the result never depends on physical row order.
    expect(rows.map((r: { id: string }) => r.id)).toEqual([...ids].sort());
  });

  it("tail-rank assignment max(position)+1 produces a strictly increasing queue", async () => {
    for (let i = 0; i < 3; i++) {
      await ctx.owner.query(
        `INSERT INTO players (tenant_id, session_id, membership_id, status, waitlist_position)
         VALUES ($1, $2, $3, 'waitlisted',
                 COALESCE((SELECT max(waitlist_position) FROM players WHERE session_id = $2), 0) + 1)`,
        [ctx.tenantA, sessionId, membershipIds[i]],
      );
    }
    const { rows } = await ctx.owner.query(
      `SELECT waitlist_position FROM players
       WHERE session_id = $1 AND status = 'waitlisted'
       ORDER BY waitlist_position`,
      [sessionId],
    );
    expect(rows.map((r: { waitlist_position: number }) => r.waitlist_position)).toEqual([1, 2, 3]);
  });
});

describe("queue index", () => {
  it("idx_players_waitlist_order exists with the promotion query's column order", async () => {
    const { rows } = await ctx.owner.query(
      `SELECT indexdef FROM pg_indexes
       WHERE tablename = 'players' AND indexname = 'idx_players_waitlist_order'`,
    );
    expect(rows).toHaveLength(1);
    expect((rows[0] as { indexdef: string }).indexdef).toMatch(
      /\(session_id, status, waitlist_position, joined_at, id\)/,
    );
  });
});

/**
 * The new column from the REAL runtime seat, not the owner's.
 *
 * 0013's header documents the exact failure this guards: a slice whose tests
 * only ever wrote as owner/superuser shipped a table the `app` role could not
 * actually write. 0009's grants are table-level so waitlist_position should be
 * covered for free — "should be" is the reason this is a test and not a comment.
 */
describe("app role can use the new column under RLS (0009 grants)", () => {
  const insertAsApp = (tenantId: string, membershipIdx: number) =>
    withTenant(ctx.appDb.db, ctx.tenantA, (tx) =>
      tx.execute(sql`
        INSERT INTO players (tenant_id, session_id, membership_id, status, waitlist_position)
        VALUES (${tenantId}::uuid, ${sessionId}::uuid, ${membershipIds[membershipIdx]}::uuid,
                'waitlisted', 1)
      `),
    );

  it("app INSERTs a waitlisted row inside tenant context", async () => {
    await expect(insertAsApp(ctx.tenantA, 0)).resolves.toBeTruthy();
  });

  it("app UPDATEs the promotion pair inside tenant context", async () => {
    await insertAsApp(ctx.tenantA, 0);
    await expect(
      withTenant(ctx.appDb.db, ctx.tenantA, (tx) =>
        tx.execute(sql`
          UPDATE players SET status = 'active', waitlist_position = NULL
          WHERE session_id = ${sessionId}::uuid AND status = 'waitlisted'
        `),
      ),
    ).resolves.toBeTruthy();
  });

  it("app reads the queue inside tenant context", async () => {
    await insertAsApp(ctx.tenantA, 0);
    const rows = await withTenant(ctx.appDb.db, ctx.tenantA, (tx) =>
      tx.execute(sql`
        SELECT waitlist_position FROM players
        WHERE session_id = ${sessionId}::uuid AND status = 'waitlisted'
        ORDER BY waitlist_position, joined_at, id
      `),
    );
    expect(rows.rows).toHaveLength(1);
  });

  it("RLS still rejects a waitlisted write aimed at ANOTHER tenant", async () => {
    // tenant context = A, row claims tenant B → policy WITH CHECK must reject.
    // Chain-walk, not rejects.toThrow: this goes through drizzle, which buries
    // the real pg error under its own "Failed query:" wrapper.
    await expectErrorChainToMatch(insertAsApp(ctx.tenantB, 0), /row-level security/i);
  });

  it("app writes OUTSIDE tenant context are rejected (fail-closed, BL-TEN-1)", async () => {
    // Raw pool query, so the pg error is already top-level — chain-walked
    // anyway to keep one assertion habit across this block.
    await expectErrorChainToMatch(
      ctx.appPool.query(
        `INSERT INTO players (tenant_id, session_id, membership_id, status, waitlist_position)
         VALUES ($1, $2, $3, 'waitlisted', 1)`,
        [ctx.tenantA, sessionId, membershipIds[0]],
      ),
      /row-level security/i,
    );
  });
});

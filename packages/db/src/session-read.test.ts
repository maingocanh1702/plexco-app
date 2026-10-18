import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  SessionReadError,
  clampSessionLimit,
  decodeSessionCursor,
  encodeSessionCursor,
  getSessionDetail,
  listSessions,
} from "./session-read.js";
import { getSessionOccupancy, sessionActiveRosterCount } from "./session-occupancy.js";
import { withTenant } from "./tenant.js";
import { setupRlsTestContext, type RlsTestContext } from "./test-harness.js";

/** Host read models (session-read.ts): RLS isolation, ordering + keyset cursor, filter, clamp, DTO shape. */

let ctx: RlsTestContext;
beforeAll(async () => {
  ctx = await setupRlsTestContext("plexco_session_read");
}, 120_000);
afterAll(async () => {
  await ctx?.teardown();
});

async function seedSession(
  tenantId: string,
  opts: { startsAt: string; status?: string; id?: string; slotsMax?: number | null },
): Promise<string> {
  const { rows } = await ctx.owner.query<{ id: string }>(
    `INSERT INTO sessions (id, tenant_id, sport_id, starts_at, ends_at, timezone, status, price_amount, slots_max)
     VALUES (COALESCE($5::uuid, gen_random_uuid()), $1, $2, $3::timestamptz,
             $3::timestamptz + interval '2 hours', 'Asia/Ho_Chi_Minh', $4, 50000, $6)
     RETURNING id`,
    [
      tenantId,
      ctx.badmintonSportId,
      opts.startsAt,
      opts.status ?? "open",
      opts.id ?? null,
      opts.slotsMax ?? null,
    ],
  );
  return rows[0]!.id;
}

describe("listSessions", () => {
  it("orders newest-first by (starts_at, id), pages with an opaque keyset cursor, and never skips or repeats", async () => {
    // Same starts_at with different ids exercises the id tiebreak; microsecond values exercise
    // the lossless cursor (a JS Date round-trip would truncate to ms and re-serve/skip rows).
    const tenant = ctx.tenantA;
    const ids = [
      await seedSession(tenant, {
        startsAt: "2031-01-01T10:00:00.000001Z",
        id: "00000000-0000-4000-8000-0000000000a1",
      }),
      await seedSession(tenant, {
        startsAt: "2031-01-01T10:00:00.000002Z",
        id: "00000000-0000-4000-8000-0000000000a2",
      }),
      await seedSession(tenant, {
        startsAt: "2031-01-02T10:00:00Z",
        id: "00000000-0000-4000-8000-0000000000a3",
      }),
      await seedSession(tenant, {
        startsAt: "2031-01-02T10:00:00Z",
        id: "00000000-0000-4000-8000-0000000000a4",
      }),
      await seedSession(tenant, {
        startsAt: "2031-01-03T10:00:00Z",
        id: "00000000-0000-4000-8000-0000000000a5",
      }),
    ];
    const expected = [ids[4], ids[3], ids[2], ids[1], ids[0]];
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 10; guard += 1) {
      const page = await listSessions(ctx.appDb.db, { tenantId: tenant, limit: 2, cursor });
      seen.push(...page.sessions.map((s) => s.id));
      if (!page.pageInfo.hasMore) {
        expect(page.pageInfo.nextCursor).toBeNull();
        break;
      }
      expect(page.pageInfo.nextCursor).toEqual(expect.any(String));
      cursor = page.pageInfo.nextCursor!;
    }
    expect(seen.filter((id) => expected.includes(id))).toEqual(expected);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("filters by status", async () => {
    const tenant = ctx.tenantA;
    const draft = await seedSession(tenant, { startsAt: "2032-05-01T10:00:00Z", status: "draft" });
    const page = await listSessions(ctx.appDb.db, { tenantId: tenant, status: "draft", limit: 50 });
    expect(page.sessions.length).toBeGreaterThan(0);
    expect(page.sessions.every((s) => s.status === "draft")).toBe(true);
    expect(page.sessions.map((s) => s.id)).toContain(draft);
  });

  it("rejects an unknown status and a malformed cursor with typed errors", async () => {
    await expect(
      listSessions(ctx.appDb.db, { tenantId: ctx.tenantA, status: "deleted" }),
    ).rejects.toMatchObject({ code: "INVALID_STATUS" });
    for (const cursor of ["!!", "e30", Buffer.from('["x","y"]').toString("base64url")]) {
      await expect(
        listSessions(ctx.appDb.db, { tenantId: ctx.tenantA, cursor }),
      ).rejects.toBeInstanceOf(SessionReadError);
    }
  });

  it("clamps limit to 1..50 and treats junk as the default", async () => {
    expect(clampSessionLimit(1000)).toBe(50);
    expect(clampSessionLimit(0)).toBe(1);
    expect(clampSessionLimit(-5)).toBe(1);
    expect(clampSessionLimit(Number.NaN)).toBe(20);
    expect(clampSessionLimit(undefined)).toBe(20);
    expect(clampSessionLimit(7.9)).toBe(7);
    const page = await listSessions(ctx.appDb.db, { tenantId: ctx.tenantA, limit: 10_000 });
    expect(page.sessions.length).toBeLessThanOrEqual(50);
  });

  it("RLS: tenant B's list never contains tenant A's sessions", async () => {
    const a = await seedSession(ctx.tenantA, { startsAt: "2033-01-01T10:00:00Z" });
    const b = await seedSession(ctx.tenantB, { startsAt: "2033-01-01T10:00:00Z" });
    const listB = await listSessions(ctx.appDb.db, { tenantId: ctx.tenantB, limit: 50 });
    expect(listB.sessions.map((s) => s.id)).toContain(b);
    expect(listB.sessions.map((s) => s.id)).not.toContain(a);
  });

  it("projects the least-disclosure scalar set only (no confirmed_count, no tenant_id)", async () => {
    const page = await listSessions(ctx.appDb.db, { tenantId: ctx.tenantA, limit: 1 });
    expect(Object.keys(page.sessions[0]!).sort()).toEqual(
      [
        "activeCount",
        "allowPlayerInvite",
        "area",
        "createdAt",
        "endsAt",
        "id",
        "joinPolicy",
        "occupiedCount",
        "priceAmount",
        "skillLevel",
        "slotsMax",
        "slotsOpen",
        "sportId",
        "sportKey",
        "sportName",
        "startsAt",
        "status",
        "timezone",
        "updatedAt",
        "venueAddress",
        "venueName",
        "version",
        "visibility",
      ].sort(),
    );
  });
});

describe("listSessions activeCount", () => {
  it("counts ACTIVE players only (not waitlisted/left), per session, within the tenant", async () => {
    const tenant = ctx.tenantA;
    const sessionId = await seedSession(tenant, { startsAt: "2034-01-01T10:00:00Z" });
    const emptyId = await seedSession(tenant, { startsAt: "2034-01-02T10:00:00Z" });
    for (const [i, status] of (["active", "active", "waitlisted", "left"] as const).entries()) {
      const person = (
        await ctx.owner.query<{ id: string }>(
          `INSERT INTO persons (display_name) VALUES ($1) RETURNING id`,
          [`P${i}`],
        )
      ).rows[0]!.id;
      const membership = (
        await ctx.owner.query<{ id: string }>(
          `INSERT INTO memberships (tenant_id, person_id, display_name, status) VALUES ($1, $2, $3, 'active') RETURNING id`,
          [tenant, person, `P${i}`],
        )
      ).rows[0]!.id;
      await ctx.owner.query(
        `INSERT INTO players (tenant_id, session_id, membership_id, status, waitlist_position)
         VALUES ($1, $2, $3, $4, $5)`,
        [tenant, sessionId, membership, status, status === "waitlisted" ? 1 : null],
      );
    }
    const page = await listSessions(ctx.appDb.db, { tenantId: tenant, limit: 50 });
    expect(page.sessions.find((s) => s.id === sessionId)!.activeCount).toBe(2);
    expect(page.sessions.find((s) => s.id === emptyId)!.activeCount).toBe(0);
  });
});

describe("listSessions occupiedCount", () => {
  it("counts active players + guest notes (never waitlisted/left), and never another tenant's notes", async () => {
    const tenant = ctx.tenantA;
    const sessionId = await seedSession(tenant, { startsAt: "2034-02-01T10:00:00Z" });
    const otherTenantSession = await seedSession(ctx.tenantB, { startsAt: "2034-02-01T10:00:00Z" });
    const person = (
      await ctx.owner.query<{ id: string }>(
        `INSERT INTO persons (display_name) VALUES ('Occ') RETURNING id`,
      )
    ).rows[0]!.id;
    for (const [t, sid] of [
      [tenant, sessionId],
      [ctx.tenantB, otherTenantSession],
    ] as const) {
      await ctx.owner.query(
        `INSERT INTO session_guest_notes (tenant_id, session_id, created_by_person_id, guest_name)
         VALUES ($1, $2, $3, 'Khach')`,
        [t, sid, person],
      );
    }
    for (const status of ["active", "waitlisted", "left"] as const) {
      // One person per membership: memberships_active_person_unique is (tenant_id, person_id).
      const memberPerson = (
        await ctx.owner.query<{ id: string }>(
          `INSERT INTO persons (display_name) VALUES ($1) RETURNING id`,
          [`Occ-${status}`],
        )
      ).rows[0]!.id;
      const membership = (
        await ctx.owner.query<{ id: string }>(
          `INSERT INTO memberships (tenant_id, person_id, display_name, status)
           VALUES ($1, $2, $3, 'active') RETURNING id`,
          [tenant, memberPerson, `Occ-${status}`],
        )
      ).rows[0]!.id;
      await ctx.owner.query(
        `INSERT INTO players (tenant_id, session_id, membership_id, status, waitlist_position)
         VALUES ($1, $2, $3, $4, $5)`,
        [tenant, sessionId, membership, status, status === "waitlisted" ? 1 : null],
      );
    }
    const listA = await listSessions(ctx.appDb.db, { tenantId: tenant, limit: 50 });
    const row = listA.sessions.find((s) => s.id === sessionId)!;
    expect(row.activeCount).toBe(1);
    expect(row.occupiedCount).toBe(2); // 1 active player + 1 guest note
    // List and detail share ONE capacity formula.
    const detail = await getSessionDetail(ctx.appDb.db, { tenantId: tenant, sessionId });
    expect(detail!.counts.occupied).toBe(row.occupiedCount);
    expect(listA.sessions.map((s) => s.id)).not.toContain(otherTenantSession);
    const listB = await listSessions(ctx.appDb.db, { tenantId: ctx.tenantB, limit: 50 });
    expect(listB.sessions.find((s) => s.id === otherTenantSession)!.occupiedCount).toBe(1);
    // EQ9 on the helper path: B's note is invisible under A's tenant GUC (RLS), counted under B's.
    const helperIn = (t: string) =>
      withTenant(ctx.appDb.db, t, (tx) => getSessionOccupancy(tx, otherTenantSession));
    expect([await helperIn(tenant), await helperIn(ctx.tenantB)]).toEqual([0, 1]);
  });

  // Equivalence matrix EQ1-EQ8 (OC-7): the helper, the list row and the detail counts give the
  // same numbers for every fixture kind. A pending join request never occupies a slot.
  type Kind = "active" | "waitlisted" | "left" | "note" | "pending";
  const ALL: readonly Kind[] = ["active", "waitlisted", "left", "note", "pending"];
  async function seedKinds(tenantId: string, sessionId: string, kinds: readonly Kind[]) {
    for (const [i, kind] of kinds.entries()) {
      const person = (
        await ctx.owner.query<{ id: string }>(
          `INSERT INTO persons (display_name) VALUES ($1) RETURNING id`,
          [`EQ-${kind}-${i}`],
        )
      ).rows[0]!.id;
      if (kind === "note") {
        await ctx.owner.query(
          `INSERT INTO session_guest_notes (tenant_id, session_id, created_by_person_id, guest_name)
           VALUES ($1, $2, $3, 'Khach')`,
          [tenantId, sessionId, person],
        );
      } else if (kind === "pending") {
        await ctx.owner.query(
          `INSERT INTO join_requests (tenant_id, session_id, person_id, expires_at)
           VALUES ($1, $2, $3, now() + interval '1 day')`,
          [tenantId, sessionId, person],
        );
      } else {
        const membership = (
          await ctx.owner.query<{ id: string }>(
            `INSERT INTO memberships (tenant_id, person_id, display_name, status)
             VALUES ($1, $2, $3, 'active') RETURNING id`,
            [tenantId, person, `EQ-${kind}-${i}`],
          )
        ).rows[0]!.id;
        await ctx.owner.query(
          `INSERT INTO players (tenant_id, session_id, membership_id, status, waitlist_position)
           VALUES ($1, $2, $3, $4, $5)`,
          [tenantId, sessionId, membership, kind, kind === "waitlisted" ? 1 : null],
        );
      }
    }
  }
  interface EqRow {
    id: string;
    kinds: readonly Kind[];
    slotsMax: number | null;
    lowerTo?: number;
    occupied: number;
    open: number | null;
    active: number;
  }
  it.each<EqRow>([
    { id: "EQ1", kinds: ["active"], slotsMax: 2, occupied: 1, open: 1, active: 1 },
    { id: "EQ2", kinds: ["waitlisted"], slotsMax: 2, occupied: 0, open: 2, active: 0 },
    { id: "EQ3", kinds: ["left"], slotsMax: 2, occupied: 0, open: 2, active: 0 },
    { id: "EQ4", kinds: ["note"], slotsMax: 2, occupied: 1, open: 1, active: 0 },
    { id: "EQ5", kinds: ["pending"], slotsMax: 2, occupied: 0, open: 2, active: 0 },
    { id: "EQ6", kinds: ALL, slotsMax: 2, occupied: 2, open: 0, active: 1 },
    { id: "EQ7", kinds: ALL, slotsMax: null, occupied: 2, open: null, active: 1 },
    // Over cap: owner SQL lowers slots_max under 1 active + 1 note; slotsOpen clamps at 0.
    {
      id: "EQ8",
      kinds: ["active", "note"],
      slotsMax: 2,
      lowerTo: 1,
      occupied: 2,
      open: 0,
      active: 1,
    },
  ])("$id: helper = list = detail (occupied $occupied, slotsOpen $open)", async (row) => {
    const tenantId = ctx.tenantA;
    const sessionId = await seedSession(tenantId, {
      startsAt: "2040-01-01T10:00:00Z",
      slotsMax: row.slotsMax,
    });
    await seedKinds(tenantId, sessionId, row.kinds);
    if (row.lowerTo !== undefined) {
      await ctx.owner.query(`UPDATE sessions SET slots_max = $2 WHERE id = $1`, [
        sessionId,
        row.lowerTo,
      ]);
    }
    const db = ctx.appDb.db;
    const list = (await listSessions(db, { tenantId, limit: 50 })).sessions.find(
      (s) => s.id === sessionId,
    )!;
    const detail = (await getSessionDetail(db, { tenantId, sessionId }))!;
    // Occupancy and active count FIRST (the before-run on the base copies passes this one).
    expect({
      occupied: [
        await withTenant(db, tenantId, (tx) => getSessionOccupancy(tx, sessionId)),
        list.occupiedCount,
        detail.counts.occupied,
      ],
      active: [
        await withTenant(db, tenantId, (tx) => sessionActiveRosterCount(tx, sessionId)),
        list.activeCount,
        detail.counts.active,
      ],
    }).toEqual({
      occupied: [row.occupied, row.occupied, row.occupied],
      active: [row.active, row.active, row.active],
    });
    expect([list.slotsOpen, detail.counts.slotsOpen]).toEqual([row.open, row.open]);
  });
});

describe("getSessionDetail", () => {
  it("returns roster, charge, guest notes and counts for the host view", async () => {
    const tenant = ctx.tenantA;
    const sessionId = await seedSession(tenant, { startsAt: "2034-01-01T10:00:00Z" });
    const person = (
      await ctx.owner.query<{ id: string }>(
        `INSERT INTO persons (display_name) VALUES ('P') RETURNING id`,
      )
    ).rows[0]!.id;
    const membership = (
      await ctx.owner.query<{ id: string }>(
        `INSERT INTO memberships (tenant_id, person_id, display_name, status) VALUES ($1, $2, 'Lan', 'active') RETURNING id`,
        [tenant, person],
      )
    ).rows[0]!.id;
    const playerId = (
      await ctx.owner.query<{ id: string }>(
        `INSERT INTO players (tenant_id, session_id, membership_id, status) VALUES ($1, $2, $3, 'active') RETURNING id`,
        [tenant, sessionId, membership],
      )
    ).rows[0]!.id;
    await ctx.owner.query(
      `INSERT INTO charges (tenant_id, session_id, player_id, membership_id, amount_due, amount_allocated, status)
       VALUES ($1, $2, $3, $4, 50000, 20000, 'partial')`,
      [tenant, sessionId, playerId, membership],
    );
    const chargeRow = (
      await ctx.owner.query<{ id: string }>(`SELECT id FROM charges WHERE player_id = $1`, [
        playerId,
      ])
    ).rows[0]!.id;
    // The ledger row behind amount_allocated: the host view derives effective/remaining from it.
    await ctx.owner.query(
      `INSERT INTO payment_allocations (tenant_id, charge_id, amount, source, created_by)
       VALUES ($1, $2, 20000, 'cash', $3)`,
      [tenant, chargeRow, person],
    );
    await ctx.owner.query(
      `INSERT INTO session_guest_notes (tenant_id, session_id, created_by_person_id, guest_name, note)
       VALUES ($1, $2, $3, 'Khach A', 'ban cua Lan')`,
      [tenant, sessionId, person],
    );

    const detail = await getSessionDetail(ctx.appDb.db, { tenantId: tenant, sessionId });
    expect(detail).not.toBeNull();
    expect(detail!.counts).toEqual({
      active: 1,
      waitlisted: 0,
      guestNotes: 1,
      occupied: 2,
      slotsOpen: null, // slots_max NULL = unlimited
    });
    expect(detail!.players).toEqual([
      expect.objectContaining({
        id: playerId,
        membershipId: membership,
        displayName: "Lan",
        status: "active",
        waitlistPosition: null,
        charge: {
          id: expect.any(String),
          amountDue: 50000,
          amountAllocated: 20000,
          status: "partial",
          effectiveAllocated: 20000,
          remaining: 30000,
          allocations: [
            {
              id: expect.any(String),
              source: "cash",
              amount: 20000,
              createdAt: expect.any(Date),
              reasonCode: null,
              reversesAllocationId: null,
            },
          ],
        },
      }),
    ]);
    expect(detail!.guestNotes[0]).toMatchObject({
      guestName: "Khach A",
      note: "ban cua Lan",
      createdByPersonId: person,
    });
    expect(detail!.sportKey).toEqual(expect.any(String));
    expect("confirmedCount" in detail!).toBe(false);
  });

  it("RLS: tenant A cannot read tenant B's session by id (null), and junk ids are null", async () => {
    const b = await seedSession(ctx.tenantB, { startsAt: "2035-01-01T10:00:00Z" });
    expect(
      await getSessionDetail(ctx.appDb.db, { tenantId: ctx.tenantA, sessionId: b }),
    ).toBeNull();
    expect(
      await getSessionDetail(ctx.appDb.db, { tenantId: ctx.tenantB, sessionId: b }),
    ).not.toBeNull();
    expect(
      await getSessionDetail(ctx.appDb.db, { tenantId: ctx.tenantA, sessionId: randomUUID() }),
    ).toBeNull();
    expect(
      await getSessionDetail(ctx.appDb.db, { tenantId: ctx.tenantA, sessionId: "not-a-uuid" }),
    ).toBeNull();
  });

  it("T-26 host read: carries price_male / price_female (both null on a single-price session)", async () => {
    const gendered = await seedSession(ctx.tenantA, { startsAt: "2036-01-01T10:00:00Z" });
    await ctx.owner.query(
      `UPDATE sessions SET price_male = 120000, price_female = 80000 WHERE id = $1`,
      [gendered],
    );
    const single = await seedSession(ctx.tenantA, { startsAt: "2036-01-02T10:00:00Z" });
    const g = await getSessionDetail(ctx.appDb.db, { tenantId: ctx.tenantA, sessionId: gendered });
    expect([g!.priceAmount, g!.priceMale, g!.priceFemale]).toEqual([50000, 120000, 80000]);
    const s = await getSessionDetail(ctx.appDb.db, { tenantId: ctx.tenantA, sessionId: single });
    expect([s!.priceAmount, s!.priceMale, s!.priceFemale]).toEqual([50000, null, null]);
  });
});

describe("cursor codec", () => {
  it("round-trips and rejects forged shapes", () => {
    const id = "00000000-0000-4000-8000-0000000000a1";
    const ts = "2031-01-01T10:00:00.000001Z";
    expect(decodeSessionCursor(encodeSessionCursor(ts, id))).toEqual({ startsAt: ts, id });
    const forged = [
      "2031-13-45T10:00:00.000001Z",
      "2031-02-29T00:00:00.000000Z",
      "2031-04-31T00:00:00.000000Z",
      "2031-01-01T24:00:00.000000Z",
      "0000-01-01T00:00:00.000000Z",
    ].map((x) => encodeSessionCursor(x, id));
    for (const bad of [
      ...forged,
      "",
      "%%%",
      Buffer.from("[]").toString("base64url"),
      Buffer.from(JSON.stringify([ts, "x"])).toString("base64url"),
      Buffer.from(JSON.stringify(["2031-01-01", id])).toString("base64url"),
    ]) {
      expect(decodeSessionCursor(bad)).toBeNull();
    }
  });
});

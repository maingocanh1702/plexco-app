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
  opts: { startsAt: string; status?: string; id?: string },
): Promise<string> {
  const { rows } = await ctx.owner.query<{ id: string }>(
    `INSERT INTO sessions (id, tenant_id, sport_id, starts_at, ends_at, timezone, status, price_amount)
     VALUES (COALESCE($5::uuid, gen_random_uuid()), $1, $2, $3::timestamptz,
             $3::timestamptz + interval '2 hours', 'Asia/Ho_Chi_Minh', $4, 50000)
     RETURNING id`,
    [tenantId, ctx.badmintonSportId, opts.startsAt, opts.status ?? "open", opts.id ?? null],
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
        "priceAmount",
        "skillLevel",
        "slotsMax",
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
        await ctx.owner.query<{ id: string }>(`INSERT INTO persons (display_name) VALUES ($1) RETURNING id`, [
          `P${i}`,
        ])
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
    await ctx.owner.query(
      `INSERT INTO session_guest_notes (tenant_id, session_id, created_by_person_id, guest_name, note)
       VALUES ($1, $2, $3, 'Khach A', 'ban cua Lan')`,
      [tenant, sessionId, person],
    );

    const detail = await getSessionDetail(ctx.appDb.db, { tenantId: tenant, sessionId });
    expect(detail).not.toBeNull();
    expect(detail!.counts).toEqual({ active: 1, waitlisted: 0, guestNotes: 1 });
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
});

describe("cursor codec", () => {
  it("round-trips and rejects forged shapes", () => {
    const id = "00000000-0000-4000-8000-0000000000a1";
    const ts = "2031-01-01T10:00:00.000001Z";
    expect(decodeSessionCursor(encodeSessionCursor(ts, id))).toEqual({ startsAt: ts, id });
    for (const bad of [
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

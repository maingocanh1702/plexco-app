import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { raisePublicSessionFence } from "./public-session-fence.js";
import { withTenant } from "./tenant.js";
import { setupRlsTestContext, type RlsTestContext } from "./test-harness.js";

// Real-PG tests for the shared DD-12 fence core (raisePublicSessionFence). Runs as the `app`
// role via the RLS harness, so it exercises the SECURITY DEFINER raise_public_session_fence
// (migration 0033) end-to-end under a real tenant GUC (DATABASE_URL_TEST required).

let ctx: RlsTestContext;

beforeAll(async () => {
  ctx = await setupRlsTestContext("plexco_public_session_fence");
}, 120_000);

afterAll(async () => {
  await ctx?.teardown();
});

async function seedOpenSession(tenantId: string): Promise<string> {
  const s = await ctx.owner.query(
    `INSERT INTO sessions (tenant_id, sport_id, starts_at, ends_at, timezone, area, slots_max, visibility, price_amount, status)
     VALUES ($1, $2, now() + interval '1 day', now() + interval '1 day' + interval '2 hours',
             'Asia/Ho_Chi_Minh', 'Quận 1', 8, 'public', 120000, 'open')
     RETURNING id`,
    [tenantId, ctx.badmintonSportId],
  );
  return (s.rows[0] as { id: string }).id;
}

const fenceRows = async (sessionId: string) =>
  (
    await ctx.owner.query(
      `SELECT surface, target_kind, target_id, deny_scope, reason
         FROM public_projection_fences WHERE target_id = $1`,
      [sessionId],
    )
  ).rows;

describe("raisePublicSessionFence (DD-12 shared fence core)", () => {
  it("FENCE-1: raises a session_share fence for the session with the given reason, inside the source tx", async () => {
    const sessionId = await seedOpenSession(ctx.tenantA);
    await withTenant(ctx.appDb.db, ctx.tenantA, (tx) =>
      raisePublicSessionFence(tx, sessionId, "visibility_private"),
    );
    const rows = await fenceRows(sessionId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      surface: "session_share",
      target_kind: "session",
      target_id: sessionId,
      deny_scope: "public",
      reason: "visibility_private",
    });
  });

  it("FENCE-2: the shared helper passes each reason literal through verbatim (reuse by cancel/close)", async () => {
    const cancelled = await seedOpenSession(ctx.tenantA);
    const closed = await seedOpenSession(ctx.tenantA);
    await withTenant(ctx.appDb.db, ctx.tenantA, async (tx) => {
      await raisePublicSessionFence(tx, cancelled, "cancelled");
      await raisePublicSessionFence(tx, closed, "closed");
    });
    expect((await fenceRows(cancelled))[0]).toMatchObject({ reason: "cancelled" });
    expect((await fenceRows(closed))[0]).toMatchObject({ reason: "closed" });
  });

  it("FENCE-3: fail-closed -- raising for a session outside the caller's tenant throws and fences nothing", async () => {
    const foreign = await seedOpenSession(ctx.tenantB);
    // GUC = tenantA, but the session belongs to tenantB: the SECURITY DEFINER function finds no
    // matching session in the caller tenant and RAISEs (fail-closed on a wrong-tenant target).
    const err = await withTenant(ctx.appDb.db, ctx.tenantA, (tx) =>
      raisePublicSessionFence(tx, foreign, "visibility_private"),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(await fenceRows(foreign)).toHaveLength(0);
  });
});

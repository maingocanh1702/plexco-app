import { randomUUID } from "node:crypto";
import { addMemberToSession, createWebSession, markPaid } from "@plexco/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  seedPersonAccount,
  setupRlsTestContext,
  type RlsTestContext,
} from "../../../../../../../packages/db/src/test-harness.js";
import { appDb, hashToken, resetDbRoleViolationForTests } from "../../../../../lib/session-cookies";
import { POST } from "./route";

/**
 * POST /api/sessions/:id/close against a REAL database (DATABASE_URL_TEST), as the `app` role, with
 * the REAL authorize() gate: DD-131 OD-1's open-debt refusal reaches the wire as 409
 * CLOSE_BLOCKED_OPEN_DEBT with error.details.openBalancePlayers (ids + display names only), and a
 * caller without session.manage never sees it (403 before the command runs).
 */
const cookieJar = vi.hoisted(() => ({ token: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (cookieJar.token ? { value: cookieJar.token } : undefined),
  }),
}));

let ctx: RlsTestContext;
let runtime: ReturnType<typeof appDb> | undefined;

beforeAll(async () => {
  ctx = await setupRlsTestContext(`plexco_close_route_db_${process.pid}`);
  const url = ctx.appPool.options.connectionString;
  if (typeof url !== "string") throw new Error("Missing isolated app connection string");
  vi.stubEnv("DATABASE_URL", url);
  vi.stubEnv("DB_EXPECTED_ROLE", "app");
  resetDbRoleViolationForTests();
  runtime = appDb();
}, 120_000);

afterAll(async () => {
  try {
    await runtime?.close();
  } finally {
    resetDbRoleViolationForTests();
    try {
      await ctx?.teardown();
    } finally {
      vi.unstubAllEnvs();
    }
  }
}, 120_000);

type Actor = { accountId: string; personId: string; token: string; csrf: string };
type Body = {
  data: { session: { status: string } } | null;
  error: {
    code: string;
    message: string;
    statusCode: number;
    details?: { openBalancePlayers: { playerId: string; displayName: string | null }[] };
  } | null;
};

async function seedTenant(locale = "vi"): Promise<string> {
  const unique = randomUUID();
  const { rows } = await ctx.owner.query<{ id: string }>(
    `INSERT INTO tenants (name, slug, status, locale) VALUES ($1, $2, 'active', $3) RETURNING id`,
    [`Close route ${unique}`, `close-route-${unique}`, locale],
  );
  await ctx.owner.query(
    `INSERT INTO subscriptions (tenant_id, plan_key, plan_version, status, period_start, period_end)
     VALUES ($1, 'free', 1, 'active', now(), now() + interval '30 days')`,
    [rows[0]!.id],
  );
  return rows[0]!.id;
}

/** A signed-in person; `role` adds an ACTIVE web tenant_admins row, `null` a plain membership. */
async function seedActor(tenantId: string, role: "owner" | "admin" | "co_admin" | null) {
  const actor = await seedPersonAccount(ctx.owner, randomUUID());
  if (role === null) {
    await ctx.owner.query(
      `INSERT INTO memberships (tenant_id, person_id, status) VALUES ($1, $2, 'active')`,
      [tenantId, actor.personId],
    );
  } else {
    await ctx.owner.query(
      `INSERT INTO tenant_admins (tenant_id, platform, platform_user_lookup_hash, role, active)
       VALUES ($1, 'web', $2, $3, true)`,
      [tenantId, actor.personId, role],
    );
  }
  const token = randomUUID();
  const csrf = randomUUID();
  await createWebSession(runtime!.pool, {
    accountId: actor.accountId,
    tokenHash: hashToken(token),
    csrfSecret: csrf,
    ttlSeconds: 3600,
  });
  return { accountId: actor.accountId, personId: actor.personId, token, csrf } satisfies Actor;
}

/** An open session with one unpaid player added through the real roster writer. */
async function sessionWithDebt(tenantId: string, owner: Actor) {
  const { rows } = await ctx.owner.query<{ id: string; version: number }>(
    `INSERT INTO sessions (tenant_id, sport_id, starts_at, ends_at, timezone, slots_max,
                           visibility, price_amount, status)
     VALUES ($1, $2, now() + interval '1 day', now() + interval '1 day 2 hours',
             'Asia/Ho_Chi_Minh', 8, 'private', 120000, 'open') RETURNING id, version`,
    [tenantId, ctx.badmintonSportId],
  );
  const added = await addMemberToSession(ctx.appDb.db, {
    tenantId,
    actorPersonId: owner.personId,
    commandId: randomUUID(),
    sessionId: rows[0]!.id,
    member: { displayName: "Lan" },
    source: "host_add",
  });
  return { sessionId: rows[0]!.id, version: rows[0]!.version, playerId: added.playerId };
}

function closeRequest(actor: Actor, tenantId: string, sessionId: string, expectedVersion: number) {
  cookieJar.token = actor.token;
  return POST(
    new Request(`https://plexco.app/api/sessions/${sessionId}/close?tenant=${tenantId}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": actor.csrf },
      body: JSON.stringify({ commandId: randomUUID(), expectedVersion }),
    }),
    { params: Promise.resolve({ id: sessionId }) },
  );
}

const sessionStatus = async (sessionId: string) =>
  (await ctx.owner.query(`SELECT status FROM sessions WHERE id = $1`, [sessionId])).rows[0];

describe("POST /api/sessions/:id/close — open debt (real DB, real authorize)", () => {
  it.each(["owner", "admin", "co_admin"] as const)(
    "%s (session.manage) gets 409 CLOSE_BLOCKED_OPEN_DEBT naming the player who owes; the session stays open",
    async (role) => {
      const tenantId = await seedTenant();
      const owner = await seedActor(tenantId, "owner");
      const caller = role === "owner" ? owner : await seedActor(tenantId, role);
      const s = await sessionWithDebt(tenantId, owner);
      const response = await closeRequest(caller, tenantId, s.sessionId, s.version);
      expect(response.status).toBe(409);
      const body = (await response.json()) as Body;
      expect(body.data).toBeNull();
      expect(body.error).toEqual({
        code: "CLOSE_BLOCKED_OPEN_DEBT",
        message: "Còn người chơi chưa trả đủ tiền — thu đủ trước khi đóng kèo.",
        statusCode: 409,
        details: { openBalancePlayers: [{ playerId: s.playerId, displayName: "Lan" }] },
      });
      expect(JSON.stringify(body)).not.toMatch(/120000|amount/i);
      expect(await sessionStatus(s.sessionId)).toEqual({ status: "open" });
    },
    20_000,
  );

  it("a player (member without session.manage) and another tenant's owner get 403 FORBIDDEN with no list", async () => {
    const tenantId = await seedTenant();
    const owner = await seedActor(tenantId, "owner");
    const s = await sessionWithDebt(tenantId, owner);
    const player = await seedActor(tenantId, null);
    const foreignOwner = await seedActor(await seedTenant(), "owner");
    for (const caller of [player, foreignOwner]) {
      const response = await closeRequest(caller, tenantId, s.sessionId, s.version);
      expect(response.status).toBe(403);
      const raw = await response.text();
      expect((JSON.parse(raw) as Body).error?.code).toBe("FORBIDDEN");
      expect(raw).not.toMatch(/details|openBalancePlayers|Lan/);
      expect(raw).not.toContain(s.playerId);
    }
    expect(await sessionStatus(s.sessionId)).toEqual({ status: "open" });
  }, 20_000);

  it("an English tenant gets the English message with the same list; once paid, the same route closes (200)", async () => {
    const tenantId = await seedTenant("en");
    const owner = await seedActor(tenantId, "owner");
    const s = await sessionWithDebt(tenantId, owner);
    const refused = (await (
      await closeRequest(owner, tenantId, s.sessionId, s.version)
    ).json()) as Body;
    expect(refused.error).toMatchObject({
      code: "CLOSE_BLOCKED_OPEN_DEBT",
      message:
        "Some players have not paid in full — collect their payments before closing the session.",
      details: { openBalancePlayers: [{ playerId: s.playerId, displayName: "Lan" }] },
    });
    await markPaid(ctx.appDb.db, {
      tenantId,
      actorPersonId: owner.personId,
      commandId: randomUUID(),
      sessionId: s.sessionId,
      method: "cash",
      items: [{ playerId: s.playerId, amount: 120000 }],
      preview: false,
      expectedTotal: 120000,
    });
    const closed = await closeRequest(owner, tenantId, s.sessionId, s.version);
    expect(closed.status).toBe(200);
    expect(((await closed.json()) as Body).data?.session.status).toBe("closed");
  }, 20_000);
});

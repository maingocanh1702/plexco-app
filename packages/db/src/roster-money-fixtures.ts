import { randomUUID } from "node:crypto";
import type { RlsTestContext } from "./test-harness.js";

/**
 * Owner-connection fixtures shared by roster-service.test.ts and payment-manual.test.ts. They seed
 * with the superuser `owner` client (setup only); every COMMAND under test runs as the real `app`
 * role through ctx.appDb, exactly like the routes.
 */
export function fixtures(ctx: () => RlsTestContext) {
  const owner = () => ctx().owner;
  const row = async (text: string, params: unknown[] = []) =>
    (await owner().query(text, params)).rows[0];
  const rows = async (text: string, params: unknown[] = []) =>
    (await owner().query(text, params)).rows;

  async function seedTenant(
    tenantStatus = "active",
    subStatus: string | "missing" = "active",
  ): Promise<string> {
    const unique = randomUUID();
    const t = await owner().query(
      `INSERT INTO tenants (name, slug, status) VALUES ($1, $2, $3) RETURNING id`,
      [`Roster Test ${unique}`, `roster-test-${unique}`, tenantStatus],
    );
    const tenantId = (t.rows[0] as { id: string }).id;
    if (subStatus !== "missing") {
      await owner().query(
        `INSERT INTO subscriptions (tenant_id, plan_key, plan_version, status, period_start, period_end)
         VALUES ($1, 'free', 1, $2, now(), now() + interval '30 days')`,
        [tenantId, subStatus],
      );
    }
    return tenantId;
  }

  async function seedPerson(name = `P ${randomUUID()}`): Promise<string> {
    const p = await owner().query(`INSERT INTO persons (display_name) VALUES ($1) RETURNING id`, [
      name,
    ]);
    return (p.rows[0] as { id: string }).id;
  }

  /** An ACTIVE web tenant_admins row; returns the actor's person id. */
  async function seedAdmin(tenantId: string, role = "owner", active = true): Promise<string> {
    const personId = await seedPerson();
    await owner().query(
      `INSERT INTO tenant_admins (tenant_id, platform, platform_user_lookup_hash, role, active)
       VALUES ($1, 'web', $2, $3, $4)`,
      [tenantId, personId, role, active],
    );
    return personId;
  }

  async function seedMembership(tenantId: string, name = "Member"): Promise<string> {
    const personId = await seedPerson(name);
    const m = await owner().query(
      `INSERT INTO memberships (tenant_id, person_id, display_name, status)
       VALUES ($1, $2, $3, 'active') RETURNING id`,
      [tenantId, personId, name],
    );
    return (m.rows[0] as { id: string }).id;
  }

  async function seedSession(
    tenantId: string,
    over: { status?: string; slotsMax?: number | null; priceAmount?: number } = {},
  ): Promise<string> {
    const startsAt = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    const s = await owner().query(
      `INSERT INTO sessions (tenant_id, sport_id, starts_at, ends_at, timezone, area, slots_max, visibility, price_amount, status)
       VALUES ($1, $2, $3, $4, 'Asia/Ho_Chi_Minh', 'Quan 1', $5, 'private', $6, $7) RETURNING id`,
      [
        tenantId,
        ctx().badmintonSportId,
        startsAt,
        new Date(startsAt.getTime() + 2 * 3600 * 1000),
        over.slotsMax === undefined ? 8 : over.slotsMax,
        over.priceAmount ?? 100000,
        over.status ?? "open",
      ],
    );
    return (s.rows[0] as { id: string }).id;
  }

  const counts = (tenantId: string) =>
    row(
      `SELECT (SELECT count(*)::int FROM players WHERE tenant_id = $1) players,
              (SELECT count(*)::int FROM charges WHERE tenant_id = $1) charges,
              (SELECT count(*)::int FROM payment_allocations WHERE tenant_id = $1) allocations,
              (SELECT count(*)::int FROM outbox_events WHERE tenant_id = $1) outbox,
              (SELECT count(*)::int FROM processed_commands WHERE tenant_id = $1) commands,
              (SELECT count(*)::int FROM memberships WHERE tenant_id = $1) memberships`,
      [tenantId],
    );
  const events = (sessionId: string) =>
    rows(
      `SELECT type, sequence, payload FROM outbox_events WHERE aggregate_id = $1 ORDER BY sequence`,
      [sessionId],
    );

  return {
    row,
    rows,
    seedTenant,
    seedPerson,
    seedAdmin,
    seedMembership,
    seedSession,
    counts,
    events,
  };
}

let seq = 0;
export const nextCommandId = (): string => `roster-cmd-${randomUUID()}-${seq++}`;

/**
 * 0057: zalo_dm delivery targets + per-recipient record definers (Phase 3 lane L4, readiness A8, A10,
 * A11, A20, A22-A25, A29). Every call runs as the real caller, app_worker (workerPool); fixtures are
 * written by the superuser seat. Assertions that name job_definer hold the jobd reader lock.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  setupRlsTestContext,
  withDefinerReadLock,
  withJobDefinerLock,
  type RlsTestContext,
} from "./test-harness.js";

const DB_NAME = "plexco_zalo_dm_delivery";
const BASE = process.env.DATABASE_URL_TEST!;
const KV = "local";
let ctx: RlsTestContext;
beforeAll(async () => {
  ctx = await setupRlsTestContext(DB_NAME);
});
afterAll(async () => {
  await ctx?.teardown();
});

type Row = Record<string, unknown>;
const q = async (sql: string, p: unknown[] = []) => (await ctx.owner.query(sql, p)).rows as Row[];
const one = async (sql: string, p: unknown[] = []) => (await q(sql, p))[0]!;
const worker = (sql: string, p: unknown[] = []) => ctx.workerPool.query(sql, p);
async function sqlError(run: Promise<unknown>): Promise<pg.DatabaseError> {
  try {
    await run;
  } catch (error) {
    return error as pg.DatabaseError;
  }
  throw new Error("expected the statement to fail");
}
const ownerPath = <T>(fn: (c: pg.Client) => Promise<T>) =>
  withJobDefinerLock(BASE, async () => {
    await ctx.owner.query("BEGIN");
    try {
      await ctx.owner.query("SET LOCAL ROLE job_definer");
      const result = await fn(ctx.owner);
      await ctx.owner.query("COMMIT");
      return result;
    } catch (error) {
      await ctx.owner.query("ROLLBACK");
      throw error;
    }
  });
const setEnabled = (on: boolean) =>
  ownerPath((c) => c.query("SELECT outbox_projector_set_enabled('zalo_dm', $1)", [on]));

interface Club {
  tenant: string;
  bot: string | null;
  session: string;
}
async function club(botStatus: string | null = "active", sessionStatus = "open", locale = "vi") {
  const slug = `zdm-${randomUUID()}`;
  const t = await one(
    "INSERT INTO tenants (name, slug, status, locale) VALUES ($1, $1, 'active', $2) RETURNING id",
    [slug, locale],
  );
  const bot = botStatus
    ? await one(
        `INSERT INTO zalo_bots (tenant_id, bot_token_enc, webhook_token, status, webhook_secret_enc, key_version)
         VALUES ($1, 'fixture-enc-token', $2, $3, '\\x01', $4) RETURNING id`,
        [t.id, randomUUID(), botStatus, KV],
      )
    : null;
  const s = await one(
    `INSERT INTO sessions (tenant_id, sport_id, starts_at, ends_at, timezone, status)
     VALUES ($1, $2, now() + interval '1 day', now() + interval '1 day 2 hours', 'Asia/Ho_Chi_Minh', $3)
     RETURNING id`,
    [t.id, ctx.badmintonSportId, sessionStatus],
  );
  return { tenant: t.id as string, bot: (bot?.id as string) ?? null, session: s.id as string };
}
async function identity(person: string, botId: string | null, status = "active", age = "0") {
  const r = await one(
    `INSERT INTO channel_identities (person_id, platform, platform_user_id_enc, platform_user_lookup_hash, status, zalo_bot_id, created_at)
     VALUES ($1, 'zalo', '\\x0a0b', $2, $3, $4, now() - ($5 || ' minutes')::interval) RETURNING id`,
    [person, randomUUID(), status, botId, age],
  );
  return r.id as string;
}
interface Member {
  person: string;
  membership: string;
  identity: string | null;
}
async function member(
  c: Club,
  o: { person?: string; membership?: string; bot?: string | null } = {},
) {
  const p = await one("INSERT INTO persons (display_name) VALUES ('Zdm Player') RETURNING id");
  const m = await one(
    "INSERT INTO memberships (tenant_id, person_id, status) VALUES ($1, $2, $3) RETURNING id",
    [c.tenant, p.id, o.membership ?? "active"],
  );
  const bot = o.bot === undefined ? c.bot : o.bot;
  const ci = bot ? await identity(p.id as string, bot) : null;
  if (o.person === "deleted")
    await q("UPDATE persons SET status = 'deleted' WHERE id = $1", [p.id]);
  if (o.person === "merged") {
    const into = await one("INSERT INTO persons (display_name) VALUES ('Zdm Into') RETURNING id");
    await q("UPDATE persons SET status = 'merged', merged_into_person_id = $2 WHERE id = $1", [
      p.id,
      into.id,
    ]);
  }
  return { person: p.id as string, membership: m.id as string, identity: ci };
}
async function player(c: Club, m: Member, status = "active", joined = "now() - interval '1 hour'") {
  const r = await one(
    `INSERT INTO players (tenant_id, session_id, membership_id, status, waitlist_position, joined_at)
     VALUES ($1, $2, $3, $4, $5, ${joined}) RETURNING id`,
    [c.tenant, c.session, m.membership, status, status === "waitlisted" ? 1 : null],
  );
  return r.id as string;
}
async function claimed(c: Club, type: string, payload: Row = {}, tenant = c.tenant) {
  const ev = await one(
    `INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, sequence, type, payload)
     VALUES ($1, 'session', $2, (SELECT coalesce(max(sequence), 0) + 1 FROM outbox_events WHERE aggregate_id = $2), $3, $4)
     RETURNING id`,
    [tenant, c.session, type, { session_id: c.session, ...payload }],
  );
  await worker("SELECT job_prepare_projector_delivery($1, 'zalo_dm')", [ev.id]);
  const batch = await worker("SELECT * FROM claim_projector_delivery_batch('zalo_dm', 100)");
  const row = batch.rows.find((r) => r.event_id === ev.id);
  return { event: ev.id as string, token: (row?.claim_token as string) ?? randomUUID() };
}
const targets = async (e: { event: string; token: string }, kv = KV) =>
  (await worker("SELECT * FROM zalo_dm_delivery_targets($1, $2, $3)", [e.event, e.token, kv]))
    .rows as Row[];
const record = (
  e: { event: string; token: string },
  ci: string,
  outcome: string,
  code: string | null,
) =>
  worker("SELECT zalo_dm_record_recipient($1, $2, $3, $4, $5) AS ok", [
    e.event,
    e.token,
    ci,
    outcome,
    code,
  ]).then((r) => r.rows[0].ok as boolean);
const audits = (tenant: string) =>
  q(
    "SELECT detail FROM routing_audit WHERE tenant_id = $1 AND action = 'zalo.secret_decrypt' ORDER BY detail->>'purpose'",
    [tenant],
  );
const status = (rows: Row[]) =>
  rows.map((r) => [r.disposition, r.bot_token_enc ?? null, r.recipient_user_id_enc ?? null]);

it("A29/A23: four zalo_dm routes (0058 adds player.promoted), zalo_dm disabled, 0056 CHECK intact; definer posture; no runtime grant", async () => {
  const routes = await q(
    "SELECT event_type FROM outbox_projector_routes WHERE projector = 'zalo_dm' ORDER BY 1",
  );
  expect(routes.map((r) => r.event_type)).toEqual([
    "player.promoted",
    "session.announcement_requested",
    "session.cancelled",
    "session.updated",
  ]);
  expect((await one("SELECT enabled FROM outbox_projectors WHERE name = 'zalo_dm'")).enabled).toBe(
    false,
  );
  const bad = await sqlError(
    ownerPath((c) =>
      c.query(
        "INSERT INTO outbox_projector_routes (projector, aggregate_type, event_type) VALUES ('zalo_dm', 'session', 'session.published')",
      ),
    ),
  );
  expect(bad.code).toBe("23514");
  await withDefinerReadLock(BASE, async () => {
    const fns = await q(
      `SELECT p.proname, pg_get_userbyid(p.proowner) AS owner, p.prosecdef, p.proconfig, coalesce(array_to_string(p.proacl, ','), '') AS acl,
              has_function_privilege('app_worker', p.oid, 'EXECUTE') AS w, has_function_privilege('app', p.oid, 'EXECUTE') AS a,
              has_function_privilege('readonly', p.oid, 'EXECUTE') AS r
         FROM pg_proc p WHERE p.proname IN ('zalo_dm_delivery_targets', 'zalo_dm_record_recipient') ORDER BY 1`,
    );
    expect(fns).toHaveLength(2);
    for (const f of fns) {
      expect([f.owner, f.prosecdef, f.proconfig, f.w, f.a, f.r]).toEqual([
        "job_definer",
        true,
        ["search_path=public, pg_temp"],
        true,
        false,
        false,
      ]);
      expect(String(f.acl)).not.toMatch(/(^|,)=X/);
    }
    expect(
      (
        await one(
          "SELECT pg_get_userbyid(relowner) AS o, relrowsecurity FROM pg_class WHERE relname = 'zalo_dm_recipient_deliveries'",
        )
      ).o,
    ).toBe("job_definer");
    for (const role of ["app", "app_worker", "readonly"]) {
      const p = await one(
        `SELECT has_table_privilege($1, 'zalo_dm_recipient_deliveries', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS t,
                has_column_privilege($1, 'zalo_bots', 'bot_token_enc', 'SELECT') AS b,
                has_column_privilege($1, 'channel_identities', 'platform_user_id_enc', 'SELECT') AS c`,
        [role],
      );
      expect([role, p.t]).toEqual([role, false]);
      // app reads both columns at base (zalo-ingress.ts readZaloBotTokenEnc, the webhook); 0057 grants it nothing.
      if (role !== "app") expect([role, p.b, p.c]).toEqual([role, false, false]);
    }
    expect(
      (await one("SELECT rolcanlogin FROM pg_roles WHERE rolname = 'job_definer'")).rolcanlogin,
    ).toBe(false);
  });
});

describe("zalo_dm_delivery_targets / zalo_dm_record_recipient (zalo_dm enabled)", () => {
  beforeAll(async () => {
    await setEnabled(true);
  });

  it("A20/A1/A3: exactly the active, linked, in-tenant roster players (newest identity), audit rows first", async () => {
    const a = await club();
    const b = await club();
    const p1 = await member(a);
    await player(a, p1);
    const p2 = await member(a, { bot: null });
    const older = await identity(p2.person, a.bot, "active", "30");
    const newer = await identity(p2.person, a.bot, "active", "5");
    await player(a, p2);
    for (const [o, st, joined] of [
      [{}, "waitlisted"],
      [{}, "left"],
      [{ bot: b.bot }, "active"],
      [{ person: "deleted" }, "active"],
      [{ person: "merged" }, "active"],
      [{ membership: "left" }, "active"],
      [{ membership: "merged" }, "active"],
      [{ bot: null }, "active"],
      [{}, "active", "now() + interval '1 hour'"],
    ] as [Parameters<typeof member>[1], string, string?][]) {
      await player(a, await member(a, o), st, joined);
    }
    const inactive = await member(a, { bot: null });
    await identity(inactive.person, a.bot, "inactive");
    await player(a, inactive);
    await player(b, await member(b));
    const updated = await targets(
      await claimed(a, "session.updated", { changed_fields: ["starts_at"] }),
    );
    expect(updated.map((r) => r.disposition)).toEqual(["ok", "ok"]);
    expect(new Set(updated.map((r) => r.channel_identity_id))).toEqual(
      new Set([p1.identity, newer]),
    );
    expect(updated.map((r) => r.channel_identity_id)).not.toContain(older);
    expect(Object.keys(updated[0]!).sort()).toEqual([
      "bot_id",
      "bot_token_enc",
      "channel_identity_id",
      "disposition",
      "key_version",
      "locale",
      "recipient_user_id_enc",
      "starts_at",
      "timezone",
    ]);
    expect([
      updated[0]!.bot_id,
      updated[0]!.bot_token_enc,
      updated[0]!.key_version,
      updated[0]!.locale,
      updated[0]!.timezone,
    ]).toEqual([a.bot, "fixture-enc-token", KV, "vi", "Asia/Ho_Chi_Minh"]);
    expect((await audits(a.tenant)).map((r) => r.detail)).toEqual([
      { botId: a.bot, purpose: "bot_token" },
      { botId: a.bot, purpose: "channel_user" },
    ]);
    await q("UPDATE sessions SET status = 'cancelled' WHERE id = $1", [a.session]);
    const cancelled = await targets(
      await claimed(a, "session.cancelled", { cancel_reason: "host" }),
    );
    expect(new Set(cancelled.map((r) => r.channel_identity_id))).toEqual(
      new Set([p1.identity, newer]),
    );
  });

  it("A4: nobody linked -> one no_recipients row and no audit", async () => {
    const a = await club();
    await player(a, await member(a, { bot: null }));
    await player(a, await member(a), "waitlisted");
    expect(
      status(
        await targets(await claimed(a, "session.updated", { changed_fields: ["venue_name"] })),
      ),
    ).toEqual([["no_recipients", null, null]]);
    expect(await audits(a.tenant)).toEqual([]);
  });

  it("A10: no bot, a bot not registered/active, or a key_version mismatch -> bot_unavailable, no secret, no audit", async () => {
    for (const st of [null, "connecting", "drift", "error", "revoked", "active"]) {
      const a = await club(st);
      await player(a, await member(a, { bot: a.bot }));
      const rows = await targets(
        await claimed(a, "session.updated", { changed_fields: ["price_amount"] }),
        st === "active" ? "kms:other" : KV,
      );
      expect([st, ...status(rows)]).toEqual([st, ["bot_unavailable", null, null]]);
      expect(await audits(a.tenant)).toEqual([]);
    }
  });

  it("A25: ended session, status mismatch or a session outside the event tenant -> stale, no audit", async () => {
    const ended = await club();
    await q(
      "UPDATE sessions SET starts_at = now() - interval '3 hours', ends_at = now() - interval '1 hour' WHERE id = $1",
      [ended.session],
    );
    const cancelledSession = await club("active", "cancelled");
    const open = await club();
    const other = await club();
    const cases: [Club, string, string?][] = [
      [ended, "session.updated"],
      [cancelledSession, "session.updated"],
      [cancelledSession, "session.announcement_requested"],
      [open, "session.cancelled"],
      [open, "session.updated", other.tenant],
    ];
    for (const [c, type, tenant] of cases) {
      await player(c, await member(c));
      const rows = await targets(
        await claimed(
          c,
          type,
          { changed_fields: ["starts_at"], requested_by_person_id: randomUUID() },
          tenant,
        ),
      );
      expect([type, ...status(rows)]).toEqual([type, ["stale", null, null]]);
      expect(await audits(tenant ?? c.tenant)).toEqual([]);
    }
  });

  it("A22: wrong token, expired lease, zalo_dm disabled or an unrouted type -> zero rows, no audit", async () => {
    const a = await club();
    await player(a, await member(a));
    const e = await claimed(a, "session.updated", { changed_fields: ["timezone"] });
    expect(await targets({ ...e, token: randomUUID() })).toEqual([]);
    await setEnabled(false);
    expect(await targets(e)).toEqual([]);
    await setEnabled(true);
    await q(
      "UPDATE projector_deliveries SET lease_expires_at = now() - interval '1 minute' WHERE event_id = $1",
      [e.event],
    );
    expect(await targets(e)).toEqual([]);
    expect(await targets(await claimed(a, "session.published"))).toEqual([]);
    expect(await audits(a.tenant)).toEqual([]);
  });

  it("A11: an audit insert failure raises: no ciphertext leaves the database", async () => {
    const a = await club();
    await player(a, await member(a));
    const e = await claimed(a, "session.updated", { changed_fields: ["starts_at"] });
    await q(
      "CREATE FUNCTION zdm_block_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'audit blocked'; END$$",
    );
    await q(
      "CREATE TRIGGER zdm_block_audit BEFORE INSERT ON routing_audit FOR EACH ROW EXECUTE FUNCTION zdm_block_audit()",
    );
    try {
      expect((await sqlError(targets(e))).message).toMatch(/audit blocked/);
    } finally {
      await q("DROP TRIGGER zdm_block_audit ON routing_audit");
      await q("DROP FUNCTION zdm_block_audit()");
    }
    expect(await audits(a.tenant)).toEqual([]);
  });

  it("A24/A15: record is idempotent and token/tenant-guarded; recorded recipients are skipped; 22023 on bad input", async () => {
    const a = await club();
    const b = await club();
    const m1 = await member(a);
    const m2 = await member(a);
    await player(a, m1);
    await player(a, m2);
    const foreign = await member(b);
    const e = await claimed(a, "session.updated", { changed_fields: ["starts_at"] });
    expect(await record(e, m1.identity!, "sent", null)).toBe(true);
    expect(await record(e, m1.identity!, "sent", null)).toBe(true);
    expect(await record({ ...e, token: randomUUID() }, m2.identity!, "sent", null)).toBe(false);
    expect(await record(e, foreign.identity!, "sent", null)).toBe(false);
    for (const [outcome, code] of [
      ["bogus", null],
      ["sent", "zalo_rejected"],
      ["terminal", null],
      ["terminal", "Bad-Code"],
    ]) {
      expect((await sqlError(record(e, m2.identity!, outcome!, code!))).code).toBe("22023");
    }
    const rows = await q(
      "SELECT channel_identity_id, outcome, error_code FROM zalo_dm_recipient_deliveries WHERE event_id = $1",
      [e.event],
    );
    expect(rows).toEqual([{ channel_identity_id: m1.identity, outcome: "sent", error_code: null }]);
    expect((await targets(e)).map((r) => r.channel_identity_id)).toEqual([m2.identity]);
    expect(await record(e, m2.identity!, "terminal", "zalo_rejected")).toBe(true);
    const before = (await audits(a.tenant)).length;
    expect(status(await targets(e))).toEqual([["all_recorded", null, null]]);
    expect((await audits(a.tenant)).length).toBe(before);
  });

  it("A5/A7: announcement -> the requesting member only; unlinked or outside the tenant -> requester_unlinked", async () => {
    const a = await club();
    const host = await member(a);
    await player(a, await member(a));
    const rows = await targets(
      await claimed(a, "session.announcement_requested", {
        channel: "zalo",
        requested_by_person_id: host.person,
      }),
    );
    expect(rows.map((r) => [r.disposition, r.channel_identity_id])).toEqual([
      ["ok", host.identity],
    ]);
    const unlinked = await member(a, { bot: null });
    const outsider = await member(await club());
    for (const person of [unlinked.person, outsider.person, "not-a-uuid"]) {
      const r = await targets(
        await claimed(a, "session.announcement_requested", { requested_by_person_id: person }),
      );
      expect(status(r)).toEqual([["requester_unlinked", null, null]]);
    }
  });

  it("A8: 0058 routes player.promoted to zalo_dm; a claim returns only the payload player", async () => {
    // The route row is the real one 0058 ships (L8, DD-134 (c)); this test never inserts or deletes a route row.
    const route = await q(
      "SELECT aggregate_type FROM outbox_projector_routes WHERE projector = 'zalo_dm' AND event_type = 'player.promoted'",
    );
    expect(route.map((r) => r.aggregate_type)).toEqual(["session"]);
    const a = await club();
    const promoted = await member(a);
    const pid = await player(a, promoted);
    await player(a, await member(a));
    const rows = await targets(await claimed(a, "player.promoted", { player_id: pid }));
    expect(rows.map((r) => r.channel_identity_id)).toEqual([promoted.identity]);
  });
});

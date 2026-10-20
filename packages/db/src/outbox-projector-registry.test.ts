/**
 * 0056: outbox projector registry, DLQ owner path, wake trigger, heartbeat schedule flag and the
 * stale-draft auto-expiry definer (Phase 3 lane L3, readiness A1-A22). Every call runs as the real
 * role: app_worker (workerPool), app (appPool), readonly (readonlyPool). The owner path is the
 * superuser seat plus SET ROLE job_definer, which is what scripts/outbox-dlq-replay.mjs does.
 * Assertions that name job_definer or deny a runtime role hold the jobd reader lock (C10).
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cancelSession, publishSession, SessionPublishError } from "./session-service.js";
import { setupRlsTestContext, withJobDefinerLock, type RlsTestContext } from "./test-harness.js";

const DB_NAME = "plexco_outbox_projector_registry";
const BASE = process.env.DATABASE_URL_TEST!;
const HOUR = 3_600_000;
let ctx: RlsTestContext;

beforeAll(async () => {
  ctx = await setupRlsTestContext(DB_NAME);
});
afterAll(async () => {
  await ctx?.teardown();
});

type Row = Record<string, unknown>;
const rows = async (sql: string, params: unknown[] = []) =>
  (await ctx.owner.query(sql, params)).rows as Row[];
const one = async (sql: string, params: unknown[] = []) => (await rows(sql, params))[0]!;
const worker = (sql: string, params: unknown[] = []) => ctx.workerPool.query(sql, params);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function sqlError(run: Promise<unknown>): Promise<pg.DatabaseError> {
  try {
    await run;
  } catch (error) {
    return error as pg.DatabaseError;
  }
  throw new Error("expected the statement to fail");
}

/** The owner path: superuser seat + SET LOCAL ROLE job_definer, under the jobd reader lock. */
async function ownerPath<T>(fn: (c: pg.Client) => Promise<T>, commit = true): Promise<T> {
  return withJobDefinerLock(BASE, async () => {
    await ctx.owner.query("BEGIN");
    try {
      await ctx.owner.query("SET LOCAL ROLE job_definer");
      const result = await fn(ctx.owner);
      await ctx.owner.query(commit ? "COMMIT" : "ROLLBACK");
      return result;
    } catch (error) {
      await ctx.owner.query("ROLLBACK");
      throw error;
    }
  });
}

const setEnabled = (name: string, enabled: boolean) =>
  ownerPath(async (c) => {
    const r = await c.query("SELECT outbox_projector_set_enabled($1, $2) AS changed", [
      name,
      enabled,
    ]);
    return r.rows[0].changed as boolean;
  });

async function addProjector(name: string, routes: [string, string | null][]): Promise<void> {
  await ownerPath(async (c) => {
    await c.query("INSERT INTO outbox_projectors (name) VALUES ($1) ON CONFLICT DO NOTHING", [
      name,
    ]);
    for (const [aggregate, type] of routes) {
      await c.query(
        "INSERT INTO outbox_projector_routes (projector, aggregate_type, event_type) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
        [name, aggregate, type],
      );
    }
  });
}

async function seedEvent(type = "session.updated", aggregateType = "session"): Promise<string> {
  const r = await one(
    `INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, sequence, type, payload)
     VALUES ($1, $2, gen_random_uuid(), 1, $3, '{"k": "v"}'::jsonb) RETURNING id`,
    [ctx.tenantA, aggregateType, type],
  );
  return r.id as string;
}

/** prepare -> claim -> (optional completion) for ONE projector name that owns only this row. */
async function delivery(projector: string, complete?: "delivered" | "retry" | "dlq") {
  const eventId = await seedEvent("jrd.test.event", "jrd_test_aggregate");
  await worker("SELECT job_prepare_projector_delivery($1, $2)", [eventId, projector]);
  if (!complete) return { eventId, token: null as string | null };
  const claim = await worker("SELECT * FROM claim_projector_delivery_batch($1, 1)", [projector]);
  const token = claim.rows[0].claim_token as string;
  const next = complete === "retry" ? new Date(Date.now() + HOUR) : null;
  const code = complete === "delivered" ? null : "test_terminal";
  await worker("SELECT complete_projector_delivery($1, $2, $3, $4, $5, NULL, $6)", [
    eventId,
    projector,
    token,
    complete,
    next,
    code,
  ]);
  return { eventId, token };
}
const dlq = async (projector: string) => (await delivery(projector, "dlq")).eventId;
const required = async (eventId: string) =>
  (await worker("SELECT outbox_required_projectors($1) AS p", [eventId])).rows[0].p as string[];

describe("A1-A3 migration, seeds and route invariants", () => {
  it("A1: 66 migrations apply with tail 0065 and re-run idempotently", async () => {
    expect(ctx.migrateResult.applied.length).toBe(66);
    expect(ctx.migrateResult.applied).toContain("0056_outbox_projector_registry_dlq_replay.sql");
    expect(ctx.migrateResult.applied.at(-1)).toBe("0065_chat_message_author_label.sql");
    const again = await ctx.remigrate();
    expect(again.applied).toEqual([]);
    expect(again.skipped.length).toBe(66);
  });

  // DM-8 (L8): exactly four zalo_dm routes, the three 0057 session types plus 0058's player.promoted
  // (DD-134 (c): the one promotion DM). No other L8 event type (player.added, player.waitlisted,
  // player.removed, join_request.*) gets a zalo_dm route, and every projector stays disabled.
  it("A2: three projectors, all disabled; 0061's fifteen public_sessions routes, the web_realtime wildcard route and the four zalo_dm routes (0057's three + 0058's player.promoted)", async () => {
    expect(await rows("SELECT name, enabled FROM outbox_projectors ORDER BY name")).toEqual([
      { name: "public_sessions", enabled: false },
      { name: "web_realtime", enabled: false },
      { name: "zalo_dm", enabled: false },
    ]);
    // 0061 (readiness 4.7 (e), P-14): twelve session-aggregate routes and three tenant alias routes.
    const publicSessionsRoutes = [
      ...[
        "guest_note.created",
        "guest_note.deleted",
        "join_request.approved",
        "player.added",
        "player.promoted",
        "player.removed",
        "player.waitlisted",
        "session.cancelled",
        "session.closed",
        "session.published",
        "session.updated",
        "session.visibility_changed",
      ].map((event_type) => ({
        projector: "public_sessions",
        aggregate_type: "session",
        event_type,
      })),
      ...[
        "tenant.public_alias_approved",
        "tenant.public_alias_rejected",
        "tenant.public_alias_set",
      ].map((event_type) => ({
        projector: "public_sessions",
        aggregate_type: "tenant",
        event_type,
      })),
    ];
    expect(
      await rows(
        "SELECT projector, aggregate_type, event_type FROM outbox_projector_routes ORDER BY projector, event_type",
      ),
    ).toEqual([
      ...publicSessionsRoutes,
      { projector: "web_realtime", aggregate_type: "session", event_type: null },
      { projector: "zalo_dm", aggregate_type: "session", event_type: "player.promoted" },
      {
        projector: "zalo_dm",
        aggregate_type: "session",
        event_type: "session.announcement_requested",
      },
      { projector: "zalo_dm", aggregate_type: "session", event_type: "session.cancelled" },
      { projector: "zalo_dm", aggregate_type: "session", event_type: "session.updated" },
    ]);
  });

  it("A3: every route and name invariant is enforced by its named constraint", async () => {
    const cases: [string, string, string | null, string, string][] = [
      ["zalo_dm", "session", null, "23514", "outbox_projector_routes_wildcard_chk"],
      ["public_sessions", "session", null, "23514", "outbox_projector_routes_wildcard_chk"],
      ["zalo_dm", "session", "session.created", "23514", "outbox_projector_routes_zalo_dm_chk"],
      ["zalo_dm", "player", "player.promoted", "23514", "outbox_projector_routes_zalo_dm_chk"],
      ["web_realtime", "Session", null, "23514", "outbox_projector_routes_aggregate_type_chk"],
      ["web_realtime", "session", "session", "23514", "outbox_projector_routes_event_type_chk"],
      [
        "web_realtime",
        "session",
        `s.${"x".repeat(127)}`,
        "23514",
        "outbox_projector_routes_event_type_chk",
      ],
      ["web_realtime", "session", null, "23505", "outbox_projector_routes_uq"],
      ["nope", "session", "session.updated", "23503", "outbox_projector_routes_projector_fkey"],
    ];
    const insert = (projector: string, aggregate: string, type: string | null) => (c: pg.Client) =>
      c.query(
        "INSERT INTO outbox_projector_routes (projector, aggregate_type, event_type) VALUES ($1, $2, $3)",
        [projector, aggregate, type],
      );
    for (const [projector, aggregate, type, code, constraint] of cases) {
      const e = await sqlError(ownerPath(insert(projector, aggregate, type)));
      expect(
        { code: e.code, constraint: e.constraint },
        `${projector}/${aggregate}/${type}`,
      ).toEqual({
        code,
        constraint,
      });
    }
    const name = await sqlError(
      ownerPath((c) => c.query("INSERT INTO outbox_projectors (name) VALUES ('Bad-Name')")),
    );
    expect([name.code, name.constraint]).toEqual(["23514", "outbox_projectors_name_chk"]);
    // The four signed DM types are admitted and all four are routed: 0057 (L4) inserted the three
    // session types and 0058 (L8, the promotion lane) inserted player.promoted, so a second insert of
    // any of them passes the CHECK and hits outbox_projector_routes_uq.
    for (const type of [
      "session.updated",
      "session.cancelled",
      "session.announcement_requested",
      "player.promoted",
    ]) {
      const dup = await sqlError(ownerPath(insert("zalo_dm", "session", type), false));
      expect([type, dup.code, dup.constraint]).toEqual([
        type,
        "23505",
        "outbox_projector_routes_uq",
      ]);
    }
    expect(await rows("SELECT projector FROM outbox_projector_routes ORDER BY projector")).toEqual([
      ...Array.from({ length: 15 }, () => ({ projector: "public_sessions" })),
      { projector: "web_realtime" },
      { projector: "zalo_dm" },
      { projector: "zalo_dm" },
      { projector: "zalo_dm" },
      { projector: "zalo_dm" },
    ]);
  });
});

describe("A4-A5 required projector sets", () => {
  it("A4: the set is enabled + routed, exact or wildcard, sorted, duplicate-free, never NULL; unknown id = 23503", async () => {
    const noRoute = await seedEvent("jrd.test.event", "jrd_test_aggregate");
    const created = await seedEvent("session.created");
    const cancelled = await seedEvent("session.cancelled");
    expect(await required(noRoute)).toEqual([]);
    expect(await required(created)).toEqual([]); // routed, but web_realtime is disabled
    await addProjector("a4_exact", [["session", "session.cancelled"]]);
    try {
      await setEnabled("web_realtime", true);
      await setEnabled("a4_exact", true);
      await ownerPath((c) =>
        c.query(
          "INSERT INTO outbox_projector_routes (projector, aggregate_type, event_type) VALUES ('web_realtime', 'session', 'session.cancelled')",
        ),
      );
      expect(await required(created)).toEqual(["web_realtime"]);
      expect(await required(cancelled)).toEqual(["a4_exact", "web_realtime"]);
      expect(await required(noRoute)).toEqual([]);
    } finally {
      await setEnabled("web_realtime", false);
      await setEnabled("a4_exact", false);
      await ownerPath((c) =>
        c.query("DELETE FROM outbox_projector_routes WHERE event_type = 'session.cancelled'"),
      );
    }
    expect(await required(cancelled)).toEqual([]);
    expect((await sqlError(required(randomUUID()))).code).toBe("23503");
  });

  it("A5: an event acked with its set never gains a projector afterwards", async () => {
    const id = await seedEvent("session.updated");
    const claimed = await worker("SELECT * FROM claim_outbox_batch(100)");
    const mine = claimed.rows.find((r) => r.event_id === id)!;
    const set = await required(id);
    expect(set).toEqual([]);
    const ack = await worker("SELECT ack_outbox_event($1, $2, $3) AS ok", [
      id,
      set,
      mine.claim_token,
    ]);
    expect(ack.rows[0].ok).toBe(true);
    try {
      await setEnabled("web_realtime", true);
      await ctx.owner.query(
        "UPDATE outbox_events SET lease_expires_at = now() - interval '1 second' WHERE id = $1",
        [id],
      );
      const again = await worker("SELECT * FROM claim_outbox_batch(100)");
      expect(again.rows.some((r) => r.event_id === id)).toBe(false);
    } finally {
      await setEnabled("web_realtime", false);
    }
    expect(await rows("SELECT 1 FROM projector_deliveries WHERE event_id = $1", [id])).toEqual([]);
  });
});

describe("A6-A8 authorization and catalog posture", () => {
  it("A6: no runtime role reaches the owner path, the worker-only definers or a base table (zero writes)", async () => {
    const eventId = await dlq("a6_proj");
    const state = () =>
      one(`SELECT (SELECT count(*) FROM job_audit_events)::int AS audit,
                  (SELECT string_agg(event_id || projector || status, ',' ORDER BY event_id, projector) FROM projector_deliveries) AS deliveries,
                  (SELECT string_agg(name || enabled, ',' ORDER BY name) FROM outbox_projectors) AS projectors,
                  (SELECT count(*) FROM outbox_projector_routes)::int AS routes`);
    const before = await state();
    const ownerOnly = [
      ["SELECT * FROM outbox_dlq_list()", []],
      ["SELECT outbox_dlq_replay($1, 'a6_proj')", [eventId]],
      ["SELECT outbox_projector_set_enabled('web_realtime', true)", []],
    ] as const;
    const denied: [pg.Pool, string, readonly unknown[]][] = [
      ...[ctx.appPool, ctx.workerPool, ctx.readonlyPool].flatMap((pool) =>
        ownerOnly.map(
          ([sql, params]) => [pool, sql, params] as [pg.Pool, string, readonly unknown[]],
        ),
      ),
      [ctx.appPool, "SELECT outbox_required_projectors($1)", [eventId]],
      [
        ctx.appPool,
        "SELECT * FROM outbox_claimed_event($1, 'a6_proj', $2)",
        [eventId, randomUUID()],
      ],
      [ctx.appPool, "SELECT * FROM job_expire_stale_drafts()", []],
      [ctx.workerPool, "SELECT * FROM projector_deliveries", []],
      [ctx.workerPool, "SELECT * FROM outbox_projectors", []],
      [ctx.workerPool, "SELECT * FROM outbox_projector_routes", []],
      [ctx.workerPool, "UPDATE outbox_projectors SET enabled = true", []],
      [
        ctx.workerPool,
        "INSERT INTO outbox_projector_routes (projector, aggregate_type, event_type) VALUES ('zalo_dm', 'session', 'session.updated')",
        [],
      ],
      [ctx.workerPool, "SELECT id FROM sessions", []],
      [ctx.readonlyPool, "SELECT projector_is_enabled('web_realtime')", []],
      [ctx.readonlyPool, "SELECT outbox_dispatch_schedule_live()", []],
    ];
    await withJobDefinerLock(BASE, async () => {
      for (const [pool, sql, params] of denied) {
        expect((await sqlError(pool.query(sql, [...params]))).code, sql).toBe("42501");
      }
    });
    expect(await state()).toEqual(before);
  });

  it("A7: every 0056 function has its exact owner, definer posture, search_path and EXECUTE list", async () => {
    const migrationRole = (await one("SELECT current_user AS u")).u as string;
    const fns: [string, string, boolean, string[]][] = [
      ["outbox_required_projectors(uuid)", "job_definer", true, ["app_worker"]],
      ["projector_is_enabled(text)", "job_definer", true, ["app", "app_worker"]],
      ["outbox_projector_set_enabled(text, boolean)", "job_definer", true, []],
      ["outbox_claimed_event(uuid, text, uuid)", "job_definer", true, ["app_worker"]],
      ["outbox_dlq_list(text, integer)", "job_definer", true, []],
      ["outbox_dlq_replay(uuid, text)", "job_definer", true, []],
      ["job_worker_heartbeat(text, text, integer, boolean)", "job_definer", true, ["app_worker"]],
      ["outbox_dispatch_schedule_live()", "job_definer", true, ["app", "app_worker"]],
      ["job_expire_stale_drafts(integer)", "job_definer", true, ["app_worker"]],
      ["outbox_events_notify_wake()", migrationRole, false, []],
    ];
    await withJobDefinerLock(BASE, async () => {
      for (const [sig, owner, secdef, exec] of fns) {
        const r = await one(
          `SELECT pg_get_userbyid(p.proowner) AS owner, p.prosecdef AS secdef, p.proconfig AS config,
                  ARRAY(SELECT a.grantee::regrole::text FROM aclexplode(p.proacl) a
                         WHERE a.privilege_type = 'EXECUTE') AS grantees,
                  has_function_privilege('public', p.oid, 'EXECUTE') AS public_exec,
                  has_function_privilege('readonly', p.oid, 'EXECUTE') AS readonly_exec
             FROM pg_proc p WHERE p.oid = $1::regprocedure`,
          [sig],
        );
        expect({ ...r, grantees: [...(r.grantees as string[])].sort() }, sig).toEqual({
          owner,
          secdef,
          config: ["search_path=public, pg_temp"],
          grantees: [owner, ...exec].sort(),
          public_exec: false,
          readonly_exec: false,
        });
      }
      expect(
        (await one("SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'job_worker_heartbeat'"))
          .n,
      ).toBe(1);
      expect(
        (await one("SELECT to_regprocedure('job_worker_heartbeat(text, text, integer)') AS f")).f,
      ).toBeNull();
      const triggers = await rows(
        "SELECT pg_get_triggerdef(oid) AS def FROM pg_trigger WHERE tgrelid = 'outbox_events'::regclass AND NOT tgisinternal",
      );
      expect(triggers).toEqual([
        {
          def: "CREATE TRIGGER trg_outbox_events_wake AFTER INSERT ON public.outbox_events FOR EACH STATEMENT EXECUTE FUNCTION outbox_events_notify_wake()",
        },
      ]);
      expect(
        await rows(
          "SELECT tableowner FROM pg_tables WHERE tablename IN ('outbox_projectors', 'outbox_projector_routes')",
        ),
      ).toEqual([{ tableowner: "job_definer" }, { tableowner: "job_definer" }]);
    });
  });

  it("A8: app_worker holds no table or column privilege outside pgboss; job_definer's new grants are column-narrow", async () => {
    const aclOf = (role: string, where: string) =>
      rows(
        `SELECT c.relname AS rel, NULL::text AS col, a.privilege_type AS priv
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, aclexplode(c.relacl) a
          WHERE a.grantee = $1::regrole AND ${where}
         UNION ALL
         SELECT c.relname, att.attname, a.privilege_type
           FROM pg_attribute att JOIN pg_class c ON c.oid = att.attrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace, aclexplode(att.attacl) a
          WHERE a.grantee = $1::regrole AND ${where}
         ORDER BY 1, 2, 3`,
        [role],
      );
    await withJobDefinerLock(BASE, async () => {
      expect(await aclOf("app_worker", "n.nspname <> 'pgboss'")).toEqual([]);
      const narrow = await aclOf(
        "job_definer",
        `c.relname IN ('sessions', 'players', 'charges', 'outbox_events', 'public_sessions',
                       'tenants', 'sports', 'session_guest_notes', 'public_projection_fences')`,
      );
      const cols = (rel: string, priv: string) =>
        narrow
          .filter((r) => r.rel === rel && r.priv === priv)
          .map((r) => (r.col as string | null) ?? "<table>")
          .sort();
      // 0057 (L4) adds sessions (ends_at, timezone) and the players columns of the zalo_dm targets definer;
      // 0061 adds the six sessions columns the public_sessions writer recomputes from.
      expect(cols("sessions", "SELECT")).toEqual([
        "area",
        "ends_at",
        "id",
        "join_policy",
        "price_amount",
        "slots_max",
        "sport_id",
        "starts_at",
        "status",
        "tenant_id",
        "timezone",
        "version",
        "visibility",
      ]);
      expect(cols("sessions", "UPDATE")).toEqual(["status", "updated_at", "version"]);
      expect(cols("players", "SELECT")).toEqual([
        "id",
        "joined_at",
        "membership_id",
        "session_id",
        "status",
        "tenant_id",
      ]);
      expect(cols("charges", "SELECT")).toEqual(["session_id"]);
      expect(cols("outbox_events", "INSERT")).toEqual([
        "aggregate_id",
        "aggregate_type",
        "payload",
        "sequence",
        "tenant_id",
        "type",
      ]);
      expect(cols("outbox_events", "SELECT")).toEqual(["<table>"]); // 0022, unchanged
      // 0061 (readiness 4.8): the writer definer's grants on public_sessions are column-narrow except
      // DELETE; public_listing_id is never inserted (its DEFAULT) and id, session_id, tenant_id and
      // public_listing_id are never updated.
      const psCols = [
        "age_max",
        "age_min",
        "area",
        "ends_at",
        "expires_at",
        "gender_restriction",
        "id",
        "join_policy",
        "level_max_rank",
        "level_min_rank",
        "level_strict",
        "price_amount",
        "projected_at",
        "public_listing_id",
        "public_projection_version",
        "session_id",
        "session_type",
        "slots_open",
        "sport_key",
        "starts_at",
        "tenant_id",
        "title",
      ];
      const notUpdated = ["id", "public_listing_id", "session_id", "tenant_id"];
      expect(cols("public_sessions", "SELECT")).toEqual(psCols);
      expect(cols("public_sessions", "INSERT")).toEqual(
        psCols.filter((c) => c !== "public_listing_id"),
      );
      expect(cols("public_sessions", "UPDATE")).toEqual(
        psCols.filter((c) => !notUpdated.includes(c)),
      );
      expect(cols("public_sessions", "DELETE")).toEqual(["<table>"]);
      expect(
        [...new Set(narrow.filter((r) => r.rel === "public_sessions").map((r) => r.priv))].sort(),
      ).toEqual(["DELETE", "INSERT", "SELECT", "UPDATE"]);
      // 0061 (r1 N-1, D5): the writer's other canonical reads are column-narrow SELECT only.
      const reads = ["tenants", "sports", "session_guest_notes", "public_projection_fences"];
      expect(cols("tenants", "SELECT")).toEqual([
        "id",
        "public_alias",
        "public_alias_status",
        "status",
      ]);
      expect(cols("sports", "SELECT")).toEqual(["id", "key"]);
      expect(cols("session_guest_notes", "SELECT")).toEqual(["session_id"]);
      expect(cols("public_projection_fences", "SELECT")).toEqual([
        "deny_scope",
        "surface",
        "target_id",
        "target_kind",
      ]);
      expect(narrow.filter((r) => reads.includes(r.rel as string) && r.priv !== "SELECT")).toEqual(
        [],
      );
      expect(
        narrow.filter(
          (r) =>
            ["sessions", "players", "charges", ...reads].includes(r.rel as string) &&
            r.col === null,
        ),
      ).toEqual([]);
      const fence = await one(
        "SELECT has_function_privilege('job_definer', 'raise_public_session_fence(uuid, text)', 'EXECUTE') AS ok",
      );
      expect(fence.ok).toBe(true);
      // D3 (s1 S-1): only the writer's owner (job_definer) may observe or CAS-clear a fence;
      // app_worker's 0033 EXECUTE is revoked, so no runtime role can call either function.
      for (const sig of [
        "current_public_session_fence_token(uuid)",
        "clear_public_session_fence(uuid, uuid)",
      ]) {
        const g = await one(
          `SELECT ARRAY(SELECT a.grantee::regrole::text FROM aclexplode(p.proacl) a
                         WHERE a.privilege_type = 'EXECUTE' AND a.grantee <> p.proowner
                         ORDER BY 1) AS grantees
             FROM pg_proc p WHERE p.oid = $1::regprocedure`,
          [sig],
        );
        expect(g.grantees, sig).toEqual(["job_definer"]);
      }
    });
  });
});

describe("A9-A11 DLQ owner path", () => {
  const deliveries = () =>
    rows(
      "SELECT event_id, projector, status, attempts, next_attempt_at, error_code FROM projector_deliveries ORDER BY event_id, projector",
    );
  const auditCount = async () =>
    (await one("SELECT count(*)::int AS n FROM job_audit_events")).n as number;

  it("A9: replay resets one dlq row to pending/attempts 0, writes one owner audit row, touches nothing else; the next claim redelivers", async () => {
    const eventId = await dlq("a9_proj");
    await dlq("a9_proj"); // a sibling dlq row that must stay dlq
    const before = await deliveries();
    const audit = await auditCount();
    const ok = await ownerPath((c) =>
      c.query("SELECT outbox_dlq_replay($1, 'a9_proj') AS ok", [eventId]),
    );
    expect(ok.rows[0].ok).toBe(true);
    const after = await deliveries();
    const isMine = (r: Row) => r.event_id === eventId && r.projector === "a9_proj";
    expect(after.filter((r) => !isMine(r))).toEqual(before.filter((r) => !isMine(r)));
    expect(after.find(isMine)).toMatchObject({
      status: "pending",
      attempts: 0,
      next_attempt_at: null,
      error_code: "test_terminal",
    });
    expect(await auditCount()).toBe(audit + 1);
    expect(
      await rows(
        "SELECT actor, reason, fn_name, tenant_id FROM job_audit_events WHERE job_id = $1 AND actor = 'owner'",
        [eventId],
      ),
    ).toEqual([
      {
        actor: "owner",
        reason: "projector_delivery_replayed",
        fn_name: "outbox_dlq_replay",
        tenant_id: ctx.tenantA,
      },
    ]);
    const claim = await worker(
      "SELECT event_id, attempts FROM claim_projector_delivery_batch('a9_proj', 10)",
    );
    expect(claim.rows).toEqual([{ event_id: eventId, attempts: 0 }]);
  });

  it("A10: replay refuses a missing pair (P0002) and every non-dlq status (55000, naming it), with zero writes", async () => {
    const pending = await delivery("a10_pending");
    const claimed = await delivery("a10_claimed");
    await worker("SELECT * FROM claim_projector_delivery_batch('a10_claimed', 1)");
    const failed = await delivery("a10_failed", "retry");
    const delivered = await delivery("a10_delivered", "delivered");
    const before = await deliveries();
    const audit = await auditCount();
    const replay = (eventId: string, projector: string) =>
      sqlError(ownerPath((c) => c.query("SELECT outbox_dlq_replay($1, $2)", [eventId, projector])));
    const missing = await replay(randomUUID(), "a10_pending");
    expect([missing.code, missing.message]).toEqual([
      "P0002",
      expect.stringContaining("delivery_not_found"),
    ]);
    for (const [d, projector, status] of [
      [pending, "a10_pending", "pending"],
      [claimed, "a10_claimed", "claimed"],
      [failed, "a10_failed", "failed"],
      [delivered, "a10_delivered", "delivered"],
    ] as const) {
      const e = await replay(d.eventId, projector);
      expect(e.code, status).toBe("55000");
      expect(e.message).toContain("delivery_not_in_dlq");
      expect(e.message).toContain(status);
    }
    expect(await deliveries()).toEqual(before);
    expect(await auditCount()).toBe(audit);
  });

  it("A11: the list returns dlq rows only, filtered, without payload; p_limit outside 1..500 is 22023", async () => {
    const one11 = await dlq("a11_one");
    const two11 = await dlq("a11_two");
    await delivery("a11_one"); // pending, never listed
    const list = (projector: string | null, limit: number | null = 100) =>
      ownerPath((c) => c.query("SELECT * FROM outbox_dlq_list($1, $2)", [projector, limit]));
    const all = await list(null);
    expect(all.fields.map((f) => f.name)).toEqual([
      "event_id",
      "projector",
      "attempts",
      "error_code",
      "event_type",
      "aggregate_type",
      "aggregate_id",
      "tenant_id",
      "event_created_at",
    ]);
    const statuses = await rows(
      "SELECT event_id || projector AS k, status FROM projector_deliveries",
    );
    const statusOf = new Map(statuses.map((r) => [r.k, r.status]));
    expect(all.rows.every((r) => statusOf.get(`${r.event_id}${r.projector}`) === "dlq")).toBe(true);
    expect(all.rows.map((r) => r.event_id)).toEqual(expect.arrayContaining([one11, two11]));
    const filtered = await list("a11_one");
    expect(filtered.rows.map((r) => [r.event_id, r.projector, r.error_code, r.event_type])).toEqual(
      [[one11, "a11_one", "test_terminal", "jrd.test.event"]],
    );
    expect((await list(null, 1)).rows).toHaveLength(1);
    for (const limit of [0, 501, null])
      expect((await sqlError(list(null, limit))).code).toBe("22023");
  });
});

describe("A12-A15 heartbeat, projector switches, envelope and wake trigger", () => {
  it("A12: 3-arg heartbeat records NULL, 4-arg records the flag; the live check counts fresh true only", async () => {
    await ctx.owner.query("DELETE FROM job_worker_heartbeats");
    const live = async (pool: pg.Pool) =>
      (await pool.query("SELECT outbox_dispatch_schedule_live() AS v")).rows[0].v;
    const flag = async (id: string) =>
      (
        await one("SELECT schedule_enabled AS f FROM job_worker_heartbeats WHERE worker_id = $1", [
          id,
        ])
      ).f;
    expect(await live(ctx.workerPool)).toBe(false); // no row
    await worker("SELECT job_worker_heartbeat($1, $2, $3)", ["w-old", "h", 1]);
    expect(await flag("w-old")).toBeNull();
    expect(await live(ctx.workerPool)).toBe(false); // fresh NULL
    await worker("SELECT job_worker_heartbeat($1, $2, $3, $4)", ["w-new", "h", 2, false]);
    expect(await live(ctx.workerPool)).toBe(false); // fresh false
    await worker("SELECT job_worker_heartbeat($1, $2, $3, $4)", ["w-new", "h", 2, true]);
    expect(await flag("w-new")).toBe(true);
    expect([await live(ctx.workerPool), await live(ctx.appPool)]).toEqual([true, true]);
    await ctx.owner.query(
      "UPDATE job_worker_heartbeats SET last_seen_at = clock_timestamp() - interval '91 seconds' WHERE worker_id = 'w-new'",
    );
    expect(await live(ctx.appPool)).toBe(false); // stale true
  });

  it("A13: projector_is_enabled is false for NULL/unknown/disabled, true when enabled; set_enabled reports change, no-op, unknown", async () => {
    const enabled = async (pool: pg.Pool, name: string | null) =>
      (await pool.query("SELECT projector_is_enabled($1) AS v", [name])).rows[0].v;
    for (const pool of [ctx.appPool, ctx.workerPool]) {
      expect([
        await enabled(pool, null),
        await enabled(pool, "nope"),
        await enabled(pool, "zalo_dm"),
      ]).toEqual([false, false, false]);
    }
    const stamp = async () =>
      (await one("SELECT updated_at FROM outbox_projectors WHERE name = 'zalo_dm'"))
        .updated_at as Date;
    const t0 = await stamp();
    try {
      expect(await setEnabled("zalo_dm", true)).toBe(true);
      const t1 = await stamp();
      expect(t1.getTime()).toBeGreaterThan(t0.getTime());
      expect([
        await enabled(ctx.appPool, "zalo_dm"),
        await enabled(ctx.workerPool, "zalo_dm"),
      ]).toEqual([true, true]);
      expect(await setEnabled("zalo_dm", true)).toBe(false); // no-op keeps updated_at
      expect((await stamp()).getTime()).toBe(t1.getTime());
    } finally {
      await setEnabled("zalo_dm", false);
    }
    const unknown = await sqlError(setEnabled("nope", true));
    expect([unknown.code, unknown.message]).toEqual([
      "P0002",
      expect.stringContaining("projector_not_found"),
    ]);
  });

  it("A14: outbox_claimed_event returns the envelope only to the current claimant with a live lease", async () => {
    const envelope = (eventId: string, projector: string, token: string | null) =>
      worker("SELECT * FROM outbox_claimed_event($1, $2, $3)", [eventId, projector, token]).then(
        (r) => r.rows,
      );
    await addProjector("a14_proj", [["jrd_test_aggregate", "jrd.test.event"]]);
    await setEnabled("a14_proj", true); // the read needs a registered, enabled, routed projector
    const { eventId } = await delivery("a14_proj");
    const claim = await worker(
      "SELECT claim_token FROM claim_projector_delivery_batch('a14_proj', 1)",
    );
    const token = claim.rows[0].claim_token as string;
    const [env] = await envelope(eventId, "a14_proj", token);
    expect(env).toMatchObject({
      event_type: "jrd.test.event",
      aggregate_type: "jrd_test_aggregate",
      sequence: 1,
      tenant_id: ctx.tenantA,
      payload: { k: "v" },
    });
    expect(Object.keys(env!)).toEqual([
      "event_type",
      "aggregate_type",
      "aggregate_id",
      "sequence",
      "tenant_id",
      "payload",
      "created_at",
    ]);
    expect(await envelope(eventId, "a14_proj", randomUUID())).toEqual([]);
    expect(await envelope(eventId, "a14_proj", null)).toEqual([]);
    expect(await envelope(eventId, "other_proj", token)).toEqual([]);
    const unclaimed = await delivery("a14_pending");
    expect(await envelope(unclaimed.eventId, "a14_pending", token)).toEqual([]);
    await ctx.owner.query(
      "UPDATE projector_deliveries SET lease_expires_at = now() - interval '1 second' WHERE event_id = $1",
      [eventId],
    );
    expect(await envelope(eventId, "a14_proj", token)).toEqual([]); // expired lease
    const reclaim = await worker(
      "SELECT claim_token FROM claim_projector_delivery_batch('a14_proj', 1)",
    );
    const fresh = reclaim.rows[0].claim_token as string;
    await worker(
      "SELECT complete_projector_delivery($1, 'a14_proj', $2, 'delivered', NULL, NULL, NULL)",
      [eventId, fresh],
    );
    expect(await envelope(eventId, "a14_proj", fresh)).toEqual([]); // completed
  });

  it("A14b: a live claim reads nothing unless its projector is registered, enabled and routed for the event", async () => {
    const claimed = async (projector: string, event?: string) => {
      const eventId = event ?? (await seedEvent("jrd.test.event", "jrd_test_aggregate"));
      await worker("SELECT job_prepare_projector_delivery($1, $2)", [eventId, projector]);
      const claim = await worker("SELECT claim_token FROM claim_projector_delivery_batch($1, 1)", [
        projector,
      ]);
      const args = [eventId, projector, claim.rows[0].claim_token as string];
      return async () =>
        (await worker("SELECT * FROM outbox_claimed_event($1, $2, $3)", args)).rows.length;
    };
    await addProjector("a14b_unrouted", [
      ["jrd_test_aggregate", "jrd.other.event"], // the event's aggregate, another type
      ["jrd_other_aggregate", "jrd.test.event"], // the event's type, another aggregate
    ]);
    await setEnabled("a14b_unrouted", true);
    await addProjector("a14b_proj", [["jrd_test_aggregate", "jrd.test.event"]]);
    const madeUp = await claimed("a14b_made_up"); // never registered: app_worker minted the claim
    const unrouted = await claimed("a14b_unrouted"); // enabled; no route matches aggregate and type
    const proj = await claimed("a14b_proj"); // registered and routed, still disabled
    const reads = [await madeUp(), await unrouted(), await proj()];
    await setEnabled("a14b_proj", true);
    reads.push(await proj()); // the same live claim, now enabled
    await setEnabled("a14b_proj", false);
    reads.push(await proj()); // a disable stops the next read of a claim already held
    await setEnabled("web_realtime", true); // seeded (session, NULL): the only wildcard route
    const wildOwn = await claimed("web_realtime", await seedEvent()); // a session.updated event
    const wildOther = await claimed("web_realtime"); // a jrd event: not the wildcard's aggregate
    reads.push(await wildOwn(), await wildOther());
    await setEnabled("web_realtime", false);
    expect(reads).toEqual([0, 0, 0, 1, 0, 1, 0]);
  });

  it("A15: every committed insert statement notifies outbox_wake once with an empty payload; a rollback notifies nothing", async () => {
    const url = new URL(BASE);
    url.pathname = `/${DB_NAME}`;
    const listener = new pg.Client({ connectionString: url.toString() });
    const got: { channel: string; payload: string | undefined }[] = [];
    listener.on("notification", (n) => got.push({ channel: n.channel, payload: n.payload }));
    await listener.connect();
    try {
      await listener.query("LISTEN outbox_wake");
      const insert = `INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, sequence, type, payload)
                      VALUES ($1, 'session', gen_random_uuid(), 1, 'session.updated', '{}')`;
      const settle = async (n: number) => {
        for (let i = 0; i < 40 && got.length < n; i++) await sleep(25);
        await sleep(150);
        return got.length;
      };
      const app = await ctx.appPool.connect();
      try {
        await app.query("BEGIN");
        await app.query("SELECT set_config('app.tenant_id', $1, true)", [ctx.tenantA]);
        await app.query(insert, [ctx.tenantA]);
        await app.query("COMMIT");
      } finally {
        app.release();
      }
      expect(await settle(1)).toBe(1); // by app
      await ctx.superuserDb.pool.query(insert, [ctx.tenantA]);
      expect(await settle(2)).toBe(2); // by the owner
      await ctx.superuserDb.pool.query(
        `INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, sequence, type, payload)
         SELECT $1, 'session', gen_random_uuid(), 1, 'session.updated', '{}' FROM generate_series(1, 3)`,
        [ctx.tenantA],
      );
      expect(await settle(3)).toBe(3); // one per statement, not per row
      const tx = await ctx.superuserDb.pool.connect();
      try {
        await tx.query("BEGIN");
        await tx.query(insert, [ctx.tenantA]);
        await tx.query("ROLLBACK");
      } finally {
        tx.release();
      }
      expect(await settle(4)).toBe(3); // none on rollback
      expect(got.every((n) => n.channel === "outbox_wake" && n.payload === "")).toBe(true);
    } finally {
      await listener.end();
    }
  });
});

describe("A16-A22 stale-draft auto-expiry (job_expire_stale_drafts)", () => {
  // Every run is cluster-of-this-db global: park other tests' leftover stale drafts first.
  beforeEach(async () => {
    await ctx.owner.query(
      "UPDATE sessions SET status = 'closed' WHERE status = 'draft' AND starts_at <= now()",
    );
  });

  const expire = async (
    limit: number | null = 25,
    pool: pg.Pool | pg.PoolClient = ctx.workerPool,
  ) => (await pool.query("SELECT * FROM job_expire_stale_drafts($1)", [limit])).rows[0];
  const state = (id: string) => one("SELECT status, version FROM sessions WHERE id = $1", [id]);
  const events = (id: string) =>
    rows(
      "SELECT id, aggregate_type, sequence, type, payload FROM outbox_events WHERE aggregate_id = $1 ORDER BY sequence",
      [id],
    );
  const auditFor = (eventId: unknown) =>
    rows("SELECT actor, reason, fn_name, tenant_id FROM job_audit_events WHERE job_id = $1", [
      eventId,
    ]);

  async function seedTenant(): Promise<string> {
    const unique = randomUUID();
    const t = await one(
      "INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'active') RETURNING id",
      [`Expiry ${unique}`, `expiry-${unique}`],
    );
    await ctx.owner.query(
      `INSERT INTO subscriptions (tenant_id, plan_key, plan_version, status, period_start, period_end)
       VALUES ($1, 'free', 1, 'active', now(), now() + interval '30 days')`,
      [t.id],
    );
    return t.id as string;
  }
  async function seedSession(
    tenantId: string,
    status = "draft",
    startsAt = new Date(Date.now() - HOUR),
  ): Promise<string> {
    const s = await one(
      `INSERT INTO sessions (tenant_id, sport_id, starts_at, ends_at, timezone, status)
       VALUES ($1, $2, $3, $4, 'Asia/Ho_Chi_Minh', $5) RETURNING id`,
      [tenantId, ctx.badmintonSportId, startsAt, new Date(startsAt.getTime() + 2 * HOUR), status],
    );
    return s.id as string;
  }
  async function seedPlayer(
    tenantId: string,
    sessionId: string,
    status: "active" | "left" | "waitlisted",
  ) {
    const person = await one(
      "INSERT INTO persons (display_name) VALUES ('Expiry player') RETURNING id",
    );
    const m = await one(
      "INSERT INTO memberships (tenant_id, person_id) VALUES ($1, $2) RETURNING id",
      [tenantId, person.id],
    );
    const p = await one(
      "INSERT INTO players (tenant_id, session_id, membership_id, status, waitlist_position) VALUES ($1, $2, $3, $4, $5) RETURNING id",
      [tenantId, sessionId, m.id, status, status === "waitlisted" ? 1 : null],
    );
    return p.id as string;
  }

  it("A16: an empty past draft is cancelled like a host cancel (cancel_reason auto), fenced and audited; nothing else moves", async () => {
    const tenantId = await seedTenant();
    const auto = await seedSession(tenantId);
    const future = await seedSession(tenantId, "draft", new Date(Date.now() + 24 * HOUR));
    const others = [
      await seedSession(tenantId, "open"),
      await seedSession(tenantId, "closed"),
      await seedSession(tenantId, "cancelled"),
    ];
    const manual = await seedSession(tenantId, "draft", new Date(Date.now() + 48 * HOUR));
    // 0061: the view serves only clubs with an approved alias (read live) and is keyed
    // by the opaque public_listing_id, never session_id.
    await ctx.owner.query(
      "UPDATE tenants SET public_alias = 'Club', public_alias_status = 'approved' WHERE id = $1",
      [tenantId],
    );
    const listing = await one(
      `INSERT INTO public_sessions (id, session_id, tenant_id, sport_key, starts_at, ends_at, area, price_amount, slots_open, join_policy, expires_at)
       VALUES ($1, $1, $2, 'badminton', now(), now() + interval '2 hours', 'D1', 1, 1, 'open', now() + interval '1 day')
       RETURNING public_listing_id`,
      [auto, tenantId],
    );
    const visible = async () =>
      Number(
        (
          await ctx.readonlyPool.query(
            "SELECT count(*) AS n FROM public_session_share_v WHERE public_listing_id = $1",
            [listing.public_listing_id],
          )
        ).rows[0].n,
      );
    expect(await visible()).toBe(1);
    const untouched = () =>
      rows("SELECT id, status, version FROM sessions WHERE id = ANY($1) ORDER BY id", [
        [future, ...others],
      ]);
    const before = await untouched();

    expect(await expire()).toEqual({ cancelled: 1, anomalies: 0 });
    await cancelSession(ctx.appDb.db, {
      tenantId,
      commandId: randomUUID(),
      input: { sessionId: manual, expectedVersion: 1 },
    });

    expect([await state(auto), await state(manual)]).toEqual([
      { status: "cancelled", version: 2 },
      { status: "cancelled", version: 2 },
    ]);
    const [autoEvent, ...extra] = await events(auto);
    const [manualEvent] = await events(manual);
    expect(extra).toEqual([]);
    expect(autoEvent).toMatchObject({
      aggregate_type: "session",
      sequence: 1,
      type: "session.cancelled",
      payload: { session_id: auto, roster_count: 0, has_paid: false, cancel_reason: "auto" },
    });
    expect({ ...(manualEvent!.payload as Row), session_id: auto, cancel_reason: "auto" }).toEqual(
      autoEvent!.payload,
    );
    expect(
      await rows("SELECT reason FROM public_projection_fences WHERE target_id = ANY($1)", [
        [auto, manual],
      ]),
    ).toEqual([{ reason: "cancelled" }, { reason: "cancelled" }]);
    expect(await visible()).toBe(0);
    expect(await auditFor(autoEvent!.id)).toEqual([
      {
        actor: "system",
        reason: "session_draft_auto_cancelled",
        fn_name: "job_expire_stale_drafts",
        tenant_id: tenantId,
      },
    ]);
    expect(await untouched()).toEqual(before);
  });

  it("A17: a second run is a no-op for the cancelled draft", async () => {
    const id = await seedSession(ctx.tenantA);
    expect(await expire()).toEqual({ cancelled: 1, anomalies: 0 });
    const audit = (await one("SELECT count(*)::int AS n FROM job_audit_events")).n;
    expect(await expire()).toEqual({ cancelled: 0, anomalies: 0 });
    expect(await events(id)).toHaveLength(1);
    expect((await one("SELECT count(*)::int AS n FROM job_audit_events")).n).toBe(audit);
    expect(await state(id)).toEqual({ status: "cancelled", version: 2 });
  });

  it("A18: a draft with any player or a charge is never mutated and is reported on every run; an empty draft behind a full batch of anomalies is still cancelled", async () => {
    const t = ctx.tenantA;
    const kinds = ["active", "left", "waitlisted"] as const;
    const withPlayer = await Promise.all(
      kinds.map(async (k) => {
        const id = await seedSession(t);
        await seedPlayer(t, id, k);
        return id;
      }),
    );
    const charged = await seedSession(t);
    const player = await seedPlayer(t, charged, "left");
    await ctx.owner.query(
      "INSERT INTO charges (tenant_id, session_id, player_id, amount_due) VALUES ($1, $2, $3, 1000)",
      [t, charged, player],
    );
    const empty = await seedSession(t);

    expect(await expire(2)).toEqual({ cancelled: 1, anomalies: 1 }); // empty drafts sort first
    expect(await state(empty)).toEqual({ status: "cancelled", version: 2 });
    expect(await expire(25)).toEqual({ cancelled: 0, anomalies: 4 }); // every detection, every run

    let total = 0;
    for (const id of [...withPlayer, charged]) {
      expect(await state(id)).toEqual({ status: "draft", version: 1 });
      const found = await events(id);
      total += found.length;
      for (const e of found) {
        expect(e).toMatchObject({
          type: "session.expiry_anomaly_detected",
          payload: {
            session_id: id,
            tenant_id: t,
            source: "auto",
            anomaly_fields: id === charged ? ["players", "charges"] : ["players"],
          },
        });
        expect(await auditFor(e.id)).toEqual([
          {
            actor: "system",
            reason: "session_draft_expiry_anomaly",
            fn_name: "job_expire_stale_drafts",
            tenant_id: t,
          },
        ]);
      }
    }
    expect(total).toBe(5);
    expect(
      await rows("SELECT 1 FROM public_projection_fences WHERE target_id = ANY($1)", [
        [...withPlayer, charged],
      ]),
    ).toEqual([]);
  });

  it("A19: SKIP LOCKED leaves a draft another transaction holds; a draft the expiry holds makes publishSession wait, then SESSION_NOT_OPEN", async () => {
    const t = await seedTenant();
    const held = await seedSession(t);
    const holder = await ctx.superuserDb.pool.connect();
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT id FROM sessions WHERE id = $1 FOR UPDATE", [held]);
      expect(await expire()).toEqual({ cancelled: 0, anomalies: 0 }); // skipped, did not wait
      await holder.query(
        "UPDATE sessions SET status = 'open', version = version + 1 WHERE id = $1",
        [held],
      );
      await holder.query("COMMIT");
    } finally {
      await holder.query("ROLLBACK").catch(() => {});
      holder.release();
    }
    expect(await expire()).toEqual({ cancelled: 0, anomalies: 0 });
    expect(await state(held)).toEqual({ status: "open", version: 2 });

    const raced = await seedSession(t);
    const job = await ctx.workerPool.connect();
    try {
      await job.query("BEGIN");
      expect(await expire(25, job)).toEqual({ cancelled: 1, anomalies: 0 });
      let settled = false;
      const publish = publishSession(ctx.appDb.db, {
        tenantId: t,
        commandId: randomUUID(),
        input: { sessionId: raced },
      })
        .catch((e: unknown) => e)
        .finally(() => {
          settled = true;
        });
      const lockWaiters = async () =>
        (
          await one(
            "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND usename = 'app' AND wait_event_type = 'Lock'",
          )
        ).n;
      for (let i = 0; i < 100 && (await lockWaiters()) === 0; i++) await sleep(30);
      expect(await lockWaiters()).toBe(1); // publish is blocked on the session row the expiry holds
      expect(settled).toBe(false);
      await job.query("COMMIT");
      const err = await publish;
      expect(err).toBeInstanceOf(SessionPublishError);
      expect((err as SessionPublishError).code).toBe("SESSION_NOT_OPEN");
    } finally {
      await job.query("ROLLBACK").catch(() => {});
      job.release();
    }
    expect(await state(raced)).toEqual({ status: "cancelled", version: 2 });
    expect((await events(raced)).map((e) => e.type)).toEqual(["session.cancelled"]);
  });

  it("A20: concurrent runs cancel each draft exactly once with one event each", async () => {
    const t = ctx.tenantA;
    const first = await Promise.all(Array.from({ length: 6 }, () => seedSession(t)));
    const a = await ctx.workerPool.connect();
    const b = await ctx.workerPool.connect();
    try {
      await a.query("BEGIN");
      const ra = await expire(3, a); // holds three row locks
      const rb = await expire(25, b); // skips them, takes the other three
      await a.query("COMMIT");
      expect([ra, rb]).toEqual([
        { cancelled: 3, anomalies: 0 },
        { cancelled: 3, anomalies: 0 },
      ]);
    } finally {
      await a.query("ROLLBACK").catch(() => {});
      a.release();
      b.release();
    }
    const second = await Promise.all(Array.from({ length: 6 }, () => seedSession(t)));
    const [x, y] = await Promise.all([expire(25), expire(25)]);
    expect(x.cancelled + y.cancelled).toBe(6);
    for (const id of [...first, ...second]) {
      expect(await state(id)).toEqual({ status: "cancelled", version: 2 });
      expect((await events(id)).map((e) => e.type)).toEqual(["session.cancelled"]);
    }
  });

  it("A21: the caller's app.tenant_id is unchanged after the call, on success and on a forced exception", async () => {
    const c = await ctx.workerPool.connect();
    const guc = async () =>
      (await c.query("SELECT current_setting('app.tenant_id', true) AS t")).rows[0].t;
    try {
      await seedSession(ctx.tenantA);
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.tenant_id', $1, true)", [ctx.tenantB]);
      expect(await expire(25, c)).toEqual({ cancelled: 1, anomalies: 0 }); // fenced under tenant A
      expect(await guc()).toBe(ctx.tenantB);
      await c.query("COMMIT");

      const failing = await seedSession(ctx.tenantA);
      await ctx.owner.query(
        `CREATE FUNCTION a21_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'a21 forced failure'; END $$;
         CREATE TRIGGER a21_fail BEFORE INSERT ON public_projection_fences FOR EACH ROW EXECUTE FUNCTION a21_fail();`,
      );
      try {
        await c.query("BEGIN");
        await c.query("SELECT set_config('app.tenant_id', $1, true)", [ctx.tenantB]);
        await c.query("SAVEPOINT s");
        expect((await sqlError(expire(25, c))).message).toContain("a21 forced failure");
        await c.query("ROLLBACK TO SAVEPOINT s");
        expect(await guc()).toBe(ctx.tenantB);
        await c.query("ROLLBACK");
      } finally {
        await ctx.owner.query(
          "DROP TRIGGER a21_fail ON public_projection_fences; DROP FUNCTION a21_fail()",
        );
      }
      expect(await state(failing)).toEqual({ status: "draft", version: 1 });
      expect(await events(failing)).toEqual([]);
    } finally {
      await c.query("ROLLBACK").catch(() => {});
      c.release();
    }
  });

  it("A22: p_limit outside 1..100 raises 22023", async () => {
    for (const limit of [0, 101, null]) expect((await sqlError(expire(limit))).code).toBe("22023");
  });
});

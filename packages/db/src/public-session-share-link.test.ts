import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rotatePublicSessionShareLink } from "./public-session-share-link.js";
import { fixtures, nextCommandId } from "./roster-money-fixtures.js";
import { RosterMoneyError } from "./roster-money-shared.js";
import { setupRlsTestContext, type RlsTestContext } from "./test-harness.js";

// L39 D4a/T5: the host rotate wrapper as the real `app` role (ctx.appDb); DATABASE_URL_TEST.
let ctx: RlsTestContext;
beforeAll(async () => {
  ctx = await setupRlsTestContext("plexco_public_session_share_link");
});
afterAll(async () => {
  await ctx?.teardown();
});
const fx = fixtures(() => ctx);
const db = () => ctx.appDb.db;
const NOT_FOUND = "SESSION_NOT_FOUND: session not found in tenant context";
const NOT_LISTED = { kind: "not_listed" };
async function club(status = "active"): Promise<string> {
  const t = (await fx.row(
    `WITH t AS (INSERT INTO tenants (name, slug, status, public_alias, public_alias_status)
       VALUES ($1, $1, $2, 'CLB L39', 'approved') RETURNING id),
     s AS (INSERT INTO subscriptions (tenant_id, plan_key, plan_version, status, period_start,
       period_end) SELECT id, 'free', 1, 'active', now(), now() + interval '30 days' FROM t)
     SELECT id FROM t`,
    [`l39-${randomUUID()}`, status],
  )) as { id: string };
  return t.id;
}
/** Makes a session public and runs the projector as the app_worker seat (the PSP-9 path). */
async function listed(t: string, existing?: string): Promise<string> {
  const sid = existing ?? (await fx.seedSession(t));
  await fx.row("UPDATE sessions SET visibility='public', join_policy='open' WHERE id=$1", [sid]);
  await ctx.workerPool.query("SELECT public_sessions_project_session($1, $2)", [sid, null]);
  return sid;
}
async function stage() {
  const t = await club();
  return { t, host: await fx.seedAdmin(t), sid: await listed(t) };
}
const rotate = (t: string, a: string, s: string, c = nextCommandId()) =>
  rotatePublicSessionShareLink(db(), { tenantId: t, actorPersonId: a, sessionId: s, commandId: c });
async function mint(t: string, a: string, s: string, c?: string): Promise<string> {
  const r = await rotate(t, a, s, c);
  expect(r.kind).toBe("rotated");
  return (r as { slug: string }).slug;
}
const answer = (p: Promise<unknown>) =>
  p.catch((e: unknown) => (e instanceof RosterMoneyError ? `${e.code}: ${e.message}` : e));
const resolves = (slug: string) =>
  fx.rows("SELECT session_id FROM public_share_slug_resolve($1)", [slug]);
const ledger = (commandId: string) =>
  fx.rows("SELECT result_ref FROM processed_commands WHERE command_id = $1", [commandId]);
const slugs = (sid: string) =>
  fx.rows("SELECT * FROM public_session_share_slugs WHERE session_id = $1", [sid]);

describe("rotatePublicSessionShareLink (L39 D4a/T5)", () => {
  it("mints a 22-char link that resolves; a second rotate kills the first", async () => {
    const { t, host, sid } = await stage();
    const first = await mint(t, host, sid);
    expect(first).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(await resolves(first)).toEqual([{ session_id: sid }]);
    const second = await mint(t, host, sid);
    expect(await resolves(first)).toEqual([]);
    expect(await resolves(second)).toEqual([{ session_id: sid }]);
  });
  it("a commandId replays without mutation, conflicts elsewhere and stores no slug", async () => {
    const { t, host, sid } = await stage();
    const cmd = nextCommandId();
    const slug = await mint(t, host, sid, cmd);
    const before = await slugs(sid);
    expect(before).toHaveLength(1);
    expect(await rotate(t, host, sid, cmd)).toEqual({ kind: "replayed" });
    expect(await slugs(sid)).toEqual(before);
    const conflict = /^COMMAND_ID_CONFLICT: /;
    expect(await answer(rotate(t, host, await listed(t), cmd))).toMatch(conflict);
    expect(await answer(rotate(t, await fx.seedAdmin(t), sid, cmd))).toMatch(conflict);
    expect(await ledger(cmd)).toEqual([{ result_ref: { sessionId: sid, actorPersonId: host } }]);
    for (const table of ["public_session_share_slugs", "processed_commands"]) {
      const hits = await fx.rows(`SELECT 1 FROM ${table} r WHERE strpos(r::text, $1) > 0`, [slug]);
      expect(hits).toEqual([]);
    }
  });
  it("a non-host is FORBIDDEN; unknown, non-UUID and foreign ids are one NOT_FOUND", async () => {
    const { t, host, sid } = await stage();
    const m = await fx.seedMembership(t);
    const member = (await fx.row("SELECT person_id AS p FROM memberships WHERE id = $1", [m])).p;
    expect(await answer(rotate(t, member, sid))).toBe("FORBIDDEN: actor is not authorized");
    const foreign = await listed(await club());
    for (const id of [randomUUID(), "not-a-uuid", foreign]) {
      expect(await answer(rotate(t, host, id))).toBe(NOT_FOUND);
    }
    expect([...(await slugs(sid)), ...(await slugs(foreign))]).toEqual([]);
  });
  it("private is not_listed and rolls back so a retry works; suspended is TENANT_SUSPENDED", async () => {
    const { t, host } = await stage();
    const priv = await fx.seedSession(t);
    const cmd = nextCommandId();
    expect(await rotate(t, host, priv, cmd)).toEqual(NOT_LISTED);
    expect([...(await ledger(cmd)), ...(await slugs(priv))]).toEqual([]);
    await mint(t, host, await listed(t, priv), cmd);
    const s = await club("suspended");
    const refused = nextCommandId();
    expect(await answer(rotate(s, await fx.seedAdmin(s), await listed(s), refused))).toBe(
      "TENANT_SUSPENDED: tenant is not permitted",
    );
    expect(await ledger(refused)).toEqual([]);
  });
  it("two concurrent rotates leave exactly one active link", async () => {
    const { t, host, sid } = await stage();
    const links = await Promise.all([mint(t, host, sid), mint(t, host, sid)]);
    expect((await slugs(sid)).filter((r) => r.revoked_at === null)).toHaveLength(1);
    expect((await Promise.all(links.map(resolves))).flat()).toEqual([{ session_id: sid }]);
  });
});

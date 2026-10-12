import { randomUUID } from "node:crypto";
import { tenantsForPersonWithProfile } from "./auth.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ClubConfigError,
  getClubConfig,
  updateClubConfig,
  type ClubConfigPatch,
} from "./club-config.js";
import { setupRlsTestContext, type RlsTestContext } from "./test-harness.js";

// Real-PG tests as role `app` (DATABASE_URL_TEST required; CI only). Covers authz by action class,
// RLS isolation, idempotent replay, the validation matrix, single step row and settings upsert.
let ctx: RlsTestContext;
let sportKey: string;
let ownerA: string;
let seq = 0;
const cmd = () => `club-cmd-${seq++}`;

async function person(): Promise<string> {
  const { rows } = await ctx.owner.query<{ id: string }>(
    `INSERT INTO persons (display_name) VALUES ($1) RETURNING id`,
    [`p-${randomUUID()}`],
  );
  return rows[0]!.id;
}
async function admin(tenantId: string, role: string): Promise<string> {
  const id = await person();
  await ctx.owner.query(
    `INSERT INTO tenant_admins (tenant_id, platform, platform_user_lookup_hash, role, active)
     VALUES ($1, 'web', $2, $3, true)`,
    [tenantId, id, role],
  );
  return id;
}
const run = (tenantId: string, id: string) =>
  ctx.owner
    .query(`INSERT INTO onboarding_runs (tenant_id) VALUES ($1) RETURNING id`, [tenantId])
    .then(() => id);

const update = (
  patch: ClubConfigPatch,
  over: Partial<{ tenantId: string; actorPersonId: string; commandId: string }> = {},
) =>
  updateClubConfig(ctx.appDb.db, {
    tenantId: ctx.tenantA,
    actorPersonId: ownerA,
    commandId: cmd(),
    patch,
    ...over,
  });
async function expectCode(p: Promise<unknown>, code: string) {
  const e = await p.catch((x: unknown) => x);
  expect(e).toBeInstanceOf(ClubConfigError);
  expect((e as ClubConfigError).code).toBe(code);
}
const stepRows = async (tenantId: string) =>
  (
    await ctx.owner.query(
      `SELECT s.status, s.idempotency_key FROM onboarding_steps s JOIN onboarding_runs r ON r.id = s.run_id
        WHERE r.tenant_id = $1 AND s.step = 'club_config'`,
      [tenantId],
    )
  ).rows;

beforeAll(async () => {
  ctx = await setupRlsTestContext("plexco_club_config");
  sportKey = (
    await ctx.owner.query<{ key: string }>(`SELECT key FROM sports WHERE id = $1`, [
      ctx.badmintonSportId,
    ])
  ).rows[0]!.key;
  ownerA = await admin(ctx.tenantA, "owner");
  await run(ctx.tenantA, ownerA);
  await run(ctx.tenantB, ownerA);
}, 120_000);
afterAll(async () => {
  await ctx?.teardown();
});

describe("updateClubConfig", () => {
  it("owner configures the club: settings written, step verified once", async () => {
    const commandId = cmd();
    const result = await update(
      {
        name: "  CLB Cau Long  ",
        timezone: "Asia/Bangkok",
        locale: "en",
        defaultSportKey: sportKey,
        defaultPriceAmount: 50000,
        defaultVisibility: "public",
      },
      { commandId },
    );
    expect(result).toMatchObject({ step: "verified", replayed: false });
    expect(result.club).toEqual({
      name: "CLB Cau Long",
      timezone: "Asia/Bangkok",
      locale: "en",
      defaultSportKey: sportKey,
      defaultPriceAmount: 50000,
      defaultVisibility: "public",
    });
    const steps = (await stepRows(ctx.tenantA)).filter((s) => s.idempotency_key === commandId);
    expect(steps).toEqual([{ status: "verified", idempotency_key: commandId }]);
  });

  it("replay of the same commandId mutates nothing and reports replayed", async () => {
    const commandId = cmd();
    await update({ defaultPriceAmount: 1 }, { commandId });
    const before = (await ctx.owner.query(`SELECT count(*)::int n FROM onboarding_steps`)).rows[0]
      .n;
    const again = await update({ defaultPriceAmount: 999 }, { commandId });
    expect(again.replayed).toBe(true);
    expect(again.club.defaultPriceAmount).toBe(1);
    expect((await ctx.owner.query(`SELECT count(*)::int n FROM onboarding_steps`)).rows[0].n).toBe(
      before,
    );
  });

  it("a commandId owned by another command type is COMMAND_ID_CONFLICT", async () => {
    const commandId = cmd();
    await ctx.owner.query(
      `INSERT INTO processed_commands (tenant_id, command_id, command_type) VALUES ($1, $2, 'CreateSession')`,
      [ctx.tenantA, commandId],
    );
    await expectCode(update({ defaultPriceAmount: 5 }, { commandId }), "COMMAND_ID_CONFLICT");
  });

  it("writes tenants itself (one authority): partial patch keeps the other columns, locale drives tenant_locale", async () => {
    await update({ name: "Keep", timezone: "Asia/Tokyo", locale: "vi" });
    const { club } = await update({ name: "Renamed", locale: "en" });
    expect(club).toMatchObject({ name: "Renamed", timezone: "Asia/Tokyo", locale: "en" });
    const t = (
      await ctx.owner.query(`SELECT name, timezone, locale, slug FROM tenants WHERE id=$1`, [
        ctx.tenantA,
      ])
    ).rows[0];
    expect(t).toMatchObject({ name: "Renamed", timezone: "Asia/Tokyo", locale: "en" });
    expect(club.slug).toBe(t.slug);
    expect((await ctx.owner.query(`SELECT tenant_locale($1) AS l`, [ctx.tenantA])).rows[0].l).toBe(
      "en",
    );
    // No shadow copy of the profile in settings.
    expect(
      (await ctx.owner.query(`SELECT count(*)::int n FROM settings WHERE key='club.profile'`))
        .rows[0].n,
    ).toBe(0);
    await update({ locale: "vi" });
  });

  it("tenantsForPersonWithProfile lists the club with its profile and keeps the legacy fields", async () => {
    await update({ name: "Listed" });
    const mine = await tenantsForPersonWithProfile(ctx.appDb, ownerA);
    const a = mine.find((m) => m.tenantId === ctx.tenantA);
    expect(a).toMatchObject({ role: "owner", name: "Listed" });
    expect(typeof a?.slug).toBe("string");
    expect(typeof a?.timezone).toBe("string");
    expect(typeof a?.locale).toBe("string");
  });

  it("admin and co_admin (content.manage preset) are allowed", async () => {
    for (const role of ["admin", "co_admin"]) {
      const p = await admin(ctx.tenantA, role);
      await expect(
        update({ defaultVisibility: "private" }, { actorPersonId: p }),
      ).resolves.toMatchObject({ step: "verified" });
    }
  });

  it("denies a non-member, an owner of ANOTHER tenant, and a malformed actor id; writes nothing", async () => {
    const stranger = await person();
    const otherOwner = await admin(ctx.tenantB, "owner");
    const before = (await ctx.owner.query(`SELECT count(*)::int n FROM processed_commands`)).rows[0]
      .n;
    for (const actorPersonId of [stranger, otherOwner, "not-a-uuid"]) {
      await expectCode(update({ name: "Hijack" }, { actorPersonId }), "FORBIDDEN");
    }
    expect(
      (await ctx.owner.query(`SELECT count(*)::int n FROM processed_commands`)).rows[0].n,
    ).toBe(before);
  });

  it("denies authz BEFORE replay: a stranger cannot read a stored result", async () => {
    const commandId = cmd();
    await update({ defaultPriceAmount: 7 }, { commandId });
    await expectCode(
      update({ defaultPriceAmount: 7 }, { commandId, actorPersonId: await person() }),
      "FORBIDDEN",
    );
  });

  it("RLS isolation: tenant A config does not appear in tenant B", async () => {
    await update({ name: "Only A", defaultPriceAmount: 123 });
    const b = await getClubConfig(ctx.appDb.db, { tenantId: ctx.tenantB });
    expect(b.name).toBeNull();
    expect(b.defaultPriceAmount).toBeNull();
  });

  it("no onboarding run -> NO_ONBOARDING_RUN and nothing written", async () => {
    const t = randomUUID();
    await ctx.owner.query(
      `INSERT INTO tenants (id, name, slug, status) VALUES ($1, 'x', $2, 'active')`,
      [t, `s-${t}`],
    );
    const o = await admin(t, "owner");
    await expectCode(update({ name: "N" }, { tenantId: t, actorPersonId: o }), "NO_ONBOARDING_RUN");
    expect(
      (await ctx.owner.query(`SELECT count(*)::int n FROM settings WHERE tenant_id=$1`, [t]))
        .rows[0].n,
    ).toBe(0);
  });

  describe("validation matrix (rejected -> INVALID_INPUT, zero mutation)", () => {
    const cases: [string, Record<string, unknown>][] = [
      ["empty patch", {}],
      ["blank name", { name: "   " }],
      ["name > 120", { name: "x".repeat(121) }],
      ["non-string name", { name: 5 }],
      ["unknown timezone", { timezone: "Mars/Base" }],
      ["bad locale", { locale: "fr" }],
      ["unknown sport", { defaultSportKey: "no-such-sport" }],
      ["negative price", { defaultPriceAmount: -1 }],
      ["fractional price", { defaultPriceAmount: 1.5 }],
      ["price > int4", { defaultPriceAmount: 2_147_483_648 }],
      ["bad visibility", { defaultVisibility: "friends" }],
    ];
    it.each(cases)("%s", async (_label, patch) => {
      const before = (await ctx.owner.query(`SELECT count(*)::int n FROM processed_commands`))
        .rows[0].n;
      await expectCode(update(patch as ClubConfigPatch), "INVALID_INPUT");
      expect(
        (await ctx.owner.query(`SELECT count(*)::int n FROM processed_commands`)).rows[0].n,
      ).toBe(before);
    });

    it("inactive sport is rejected", async () => {
      await ctx.owner.query(`UPDATE sports SET active = false WHERE key = $1`, [sportKey]);
      try {
        await expectCode(update({ defaultSportKey: sportKey }), "INVALID_INPUT");
      } finally {
        await ctx.owner.query(`UPDATE sports SET active = true WHERE key = $1`, [sportKey]);
      }
    });
  });
});
